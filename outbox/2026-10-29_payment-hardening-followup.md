sha256(payload below): 282419e5b68de1359897b9a77a73328cb4f17bff31f84c006901dc567dc974ea

# Усиление оплаты — доработка по ревью (WARN-режим, verify v2, перенос секретов, готовность к строгому)

На ревью. n8n не менял, не выкатывал. Значения секретов нигде не печатаю. ⚠️ = webhook/цены/доступ/выплаты.
Справка: `pending_payment_verify.sql` (v1) уже применён владельцем (payment_audit + verify_order_payment есть).

## 0. Правки нод по ревью (v2 JSON — `2026-10-29_buycourse-added-nodes.json`)
1. **RestoreBody добавлена перед `Supabase`.** Проверил текущий воркфлоу: `$json.body.*` относительно входа читает только нода **`Supabase`** (set paid): `where id={{$json.body.order_num}}`, `payment_id={{$json.body.order_id}}`. После `AuditWarn` `$json` = вставленная строка `payment_audit` (без `.body`) → фильтр `update` получил бы `undefined` и **paid бы не выставился**. `RestoreBody` (Code: `return [{json: $('Shop').item.json}]`) возвращает прежнюю форму. Остальные ноды берут данные по имени (`$('Shop')`, `$('GetPositions')`, `$('Code1')` …) — не ломаются; `Code` после `Supabase` читает `$json.course_positions` из вывода `Supabase` — не затронут. false-ветка `IF_AlreadyPaid` тоже идёт через `RestoreBody` (цепочка …→AuditWarn→RestoreBody→Supabase).
2. **Все новые data-ноды** (CheckPaid, VerifySign, VerifyAmount, AuditWarn, AuditDuplicate, RestoreBody): `onError=continueRegularOutput` + `alwaysOutputData=true` — в WARN ни одна ошибка не остановит `set paid`. Если `CheckPaid` не нашёл заказ → `alwaysOutputData` отдаёт пустой item, `IF_AlreadyPaid` (`typeValidation: loose`) видит `paid=undefined`→false → поток идёт дальше как раньше.
3. **Подпись — json_encode, не query-string.** `VerifySign` переписан под Prodamus Hmac SDK: рекурсивно `strval` всех значений (`true→'1'`, `false/null→''`), рекурсивный `ksort`, затем `json_encode(..., JSON_UNESCAPED_UNICODE)` (не `http_build_query`), с экранированием `'/'`→`'\/'` как в PHP по умолчанию; `hmac_sha256(json, $env.PRODAMUS_SECRET)`. Помечено «**сверить на реальном колбэке**»; если не сойдётся — смотреть (а) форму `products[]` (массив PHP vs объект `{"0":…}` у n8n-парсера multipart), (б) набор подписываемых полей, (в) экранирование `/`.
4. **VerifyAmount без второго credential.** Переиспользует существующий `supabaseApi` **MeetGuru** через `predefinedCredentialType` (n8n сам добавит `apikey`+`Authorization` из credential) — отдельный header-credential не нужен. Исправлен `p_paid_amount`: сумма `0` больше **не** превращается в `null` (явная проверка на undefined/null/'' → `null`, иначе `Number(sum)`); фактический `null` ловит v2-SQL.
5. **Мероприятия — различаем полную и депозит.** Признака типа оплаты **на `order` нет** (колонки: course_positions, created_at, event_id, id, logs, num, owner, pageUrl, paid, payment_id, promo_code_id, promo_discount, subscription, summ). Он лежит в **`public.event_registrations`**: `"order"` (FK→order.id), `payment_type` ('full'/'deposit'), `amount_paid/amount_total`. v2-SQL берёт `payment_type` оттуда: `deposit`→минимум = `round(events.price*deposit_percent/100)`; `full`→`events.price − промо`. При полной оплате депозитная сумма **не** пройдёт. Ожидаемую сумму считаем из `events.price/deposit_percent`, не из клиентских `amount_paid`/`order.summ`.

## 1. Режим включения — сначала ВСЁ в WARN (ноды — `2026-10-29_buycourse-added-nodes.json`)
- Подпись (`VerifySign`) и `verify_order_payment` (`VerifyAmount`) **считаются и пишутся в `payment_audit`**, но `paid` ставится как раньше — ветка НЕ блокируется (`AuditWarn` → существующая нода `Supabase`).
- **Идемпотентность включается сразу:** `CheckPaid` → `IF_AlreadyPaid`: если `order.paid=true` → `AuditDuplicate` (event='duplicate') и СТОП (sales/баланс повторно не создаём).
- **Строгий режим — отдельным ОК**, когда подпись сошлась на 20–30 реальных оплатах подряд. Тогда между `AuditWarn` и `Supabase` вставляется `IF PaymentValid (sig_ok && verify.ok)`: true → `Supabase`; false → `Notify` владельцу, БЕЗ `paid`.

### Запрос/отчёт готовности к строгому режиму (по `payment_audit`)
```sql
-- A) последние 30 проверок: сошлась ли подпись и сумма (без ПДн)
select created_at, event, (detail->>'sig_ok') as sig_ok,
       expected, paid, order_id
from public.payment_audit
order by created_at desc
limit 30;

-- B) сводка за 14 дней: сколько подписей сошлось/не сошлось
select count(*) filter (where (detail->>'sig_ok')='true')  as sig_true,
       count(*) filter (where (detail->>'sig_ok')='false') as sig_false,
       count(*) filter (where event='amount_mismatch')     as amount_mismatch,
       count(*) filter (where event='duplicate')           as duplicates,
       count(*)                                             as total
from public.payment_audit
where created_at > now() - interval '14 days';

-- C) «подряд без единого sig_false» — максимальная серия успешных подписей с конца
with x as (
  select created_at, (detail->>'sig_ok')='true' as ok
  from public.payment_audit
  where (detail ? 'sig_ok')
  order by created_at desc
)
select count(*) as consecutive_sig_true_from_latest
from (
  select ok, bool_and(ok) over (order by created_at desc rows between unbounded preceding and current row) as streak
  from x
) s
where streak;  -- переходить в строгий режим при >= 20..30 и нуле sig_false за период
```
Критерий перехода: `sig_false=0` и `consecutive_sig_true_from_latest >= 20..30`.

## 2. verify_order_payment v2 — `2026-10-29_pending_payment_verify_v2.sql` (+ откат к v1)
- (1) **null-guard:** `p_paid_amount is null` → `{ok:false, reason:'no_paid_amount'}` (в WARN только логируется).
- (2) **renewal по истории:** вместо клиентского `shop.is_renewal` — `exists(user_course где user=order.owner, course=..., created_at < order.created_at)`. (Требует `user_course.created_at` — есть по умолчанию; если колонки нет, заменить на `end_period is not null`/id-порядок — отмечено.)
- (3) **мероприятия:** цена из `public.events` (`price`, `deposit_percent`); **полная vs депозит — по `event_registrations.payment_type`** (признака на `order` нет, см. §0.5): `deposit`→`round(price*deposit_percent/100)`, `full`→`price−промо`; `ok = paid >= min − 1`. Вместо безусловного ok. Промо на депозит не применяется.
- Откат — `..._v2_rollback.sql` возвращает v1.

## 3. Перенос секретов BuyCourse в n8n credentials (без остановки воркфлоу; значения не печатаю)
В нодах BuyCourse сейчас inline-секреты: **Unisender `api_key`** (ноды писем HTTP Request1/HTTP Request2 и т.п.) и **токен Telegram-бота + chat_id** (нода уведомления). План без простоя:
1. Создать в n8n credentials: (а) для Unisender — Generic **Query Auth** (`name=api_key`, value=ключ) или штатный Unisender-cred; (б) для Telegram — **Telegram API** credential (bot token).
2. По одной ноде: переключить HTTP-ноды писем на Query-Auth-credential (убрать inline `api_key` из параметров); ноду Telegram — на Telegram-ноду/credential (убрать inline токен из URL). Сохранять после каждой.
3. Правка/сохранение узла **не останавливает активный воркфлоу** — вебхук продолжает работать; следующее срабатывание берёт свежую версию. Простоя нет.
4. Проверить одним тестовым прогоном (письмо+уведомление уходят).
5. ⚠️ **После переноса — РОТИРОВАТЬ** засвеченные значения (Unisender-ключ и Telegram-токен были в открытом виде в экспорте): перевыпустить ключ Unisender и токен бота, обновить credentials. Значения — только в n8n, мне не присылать, в репо/чат не класть.
- Это отдельное n8n-изменение (⚠️), независимое от усиления вебхука; делать **только вне эфиров/продаж и по отдельному ОК**.

## 4. Тест-план — как в основном документе (`2026-10-29_payment-webhook-hardening.md`), на ТЕСТОВОМ платеже, вне эфиров/продаж.
Ключевое при включении WARN: убедиться, что `AuditWarn` пишет строку на КАЖДОЙ оплате, `paid` по-прежнему ставится, `duplicate` ловится на повторном колбэке; по серии реальных оплат (запрос выше) оценить `sig_ok` до перехода в строгий.

## Файлы (в outbox)
- `2026-10-29_buycourse-added-nodes.json` — ноды WARN+идемпотентность (без секретов; PRODAMUS_SECRET из `$env`, RPC через header-auth credential).
- `2026-10-29_pending_payment_verify_v2.sql` + `..._v2_rollback.sql` — verify v2 и откат.
- (этот файл) план секретов + запрос готовности к строгому режиму.

## От тебя
ОК на: v2-SQL (запуск), перенос секретов (вне эфиров/продаж), затем — при хорошей серии подписей — переход в строгий режим. Правка воркфлоу BuyCourse — только по твоему отдельному ОК и вне продаж/эфиров.
