sha256(payload below): a6cbce5331e9e3bfca66b25ceb52317f0e92e982c4c238041cf76b313d0268b0

# Усиление оплаты — доработка по ревью (WARN-режим, verify v2, перенос секретов, готовность к строгому)

На ревью. n8n не менял, не выкатывал. Значения секретов нигде не печатаю. ⚠️ = webhook/цены/доступ/выплаты.
Справка: `pending_payment_verify.sql` (v1) уже применён владельцем (payment_audit + verify_order_payment есть).

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
- (3) **мероприятия:** цена из `public.events` (`price`, `deposit_percent`): ожидаемый минимум = депозит (если `deposit_percent>0`) или полная−промо; `ok = paid >= min − 1`. Вместо безусловного ok.
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
