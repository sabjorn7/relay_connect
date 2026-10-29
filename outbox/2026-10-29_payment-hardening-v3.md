sha256(payload below): 9afbdb48647a9a3822a4806abd50006036aaf59a6bdb145fb658146045977aec

# Усиление оплаты — раунд v3 (ноды + verify v3 с подписками + план фазы)

На ревью. n8n не менял, ничего не выкатывал. ⚠️ = трогает webhook/цены/доступ/выплаты. Секреты/подписи/телефоны/почты не печатаю.
Состояние: в БД применены payment_audit + verify_order_payment v1, затем v2 (владелец добавил `::text` — у `order.course_positions` тип `text[]`, сравнение с `uuid` требует приведения; **это мне надо было поймать самому**). Этап 2a реферальной схемы запущен. Приватный экспорт BuyCourse у владельца есть.

## Файлы
- `2026-10-29_buycourse-added-nodes.json` — чистый импорт в холст n8n: только `nodes` + `connections` между НОВЫМИ нодами. Без секретов.
- `2026-10-29_pending_payment_verify_v3.sql` — verify v3 (добавлена серверная цена подписки). Тело функции **без комментариев**, `::text` во всех сравнениях id. + `..._v3_rollback.sql` (возврат к задеплоенной v2).

## 1. Правки нод по ревью (v3)
1. **`$('Shop').item` → `$('Shop').first()` во всех новых нодах.** Вебхук отдаёт одну запись; `.item` зависит от paired-item и ломается после нод с `onError=continue`/`alwaysOutputData`. `.first()` всегда берёт запись вебхука детерминированно.
2. **`RestoreBody` тривиальна и не падает:** `return [$('Shop').first()];` — возвращает исходный item вебхука, чтобы downstream-нода `Supabase` (set paid) снова видела `$json.body.*`.
3. **AuditWarn / AuditDuplicate: в `detail` добавлен `payment_status`** из тела колбэка (без ПДн — телефон/почта/подпись не кладутся).
4. **Подпись — повторно сверил с официальным Prodamus Hmac SDK.** Порт воспроизводит их схему: рекурсивный `strval` всех листьев (`true→'1'`, `false→''`, `null→''`), рекурсивный `ksort`, затем **`json_encode(..., JSON_UNESCAPED_UNICODE)`** (не query-string), с экранированием `'/'`→`'\/'` (как PHP по умолчанию); `hmac_sha256(json, $env.PRODAMUS_SECRET)`; сравнение регистронезависимо. Подписывается **только тело** (Sign в заголовке — в данные не входит). Пометка «**сверить на реальном колбэке**» остаётся: главный риск — форма `products[]` (PHP numeric-list → JSON `[...]`, а n8n multipart-парсер может дать объект `{"0":…}`); при расхождении правим здесь, до строгого режима.

### Ручные шаги владельцу на холсте (JSON кладёт только ноды и связи между ними)
а. Удалить существующую связь **Shop → Supabase**.
б. Импортировать ноды из файла (Ctrl+V на холст / «Import from clipboard»).
в. Провести связь **Shop → CheckPaid**.
г. Провести связь **RestoreBody → Supabase** (та самая нода set paid).
д. Создать переменную окружения **`PRODAMUS_SECRET`** в n8n (Settings → Variables, или env n8n-процесса) — **значение вводишь сам**, мне не присылать.

### Чек-лист «что должно быть на холсте» и как убедиться, что сохранено/активно
- Цепочка: `Shop → CheckPaid → IF_AlreadyPaid`; из IF **true → AuditDuplicate** (тупик), **false → VerifySign → VerifyAmount → AuditWarn → RestoreBody → Supabase → (дальше как было: Create_Sales / user_course / баланс)`.
- Нода `Supabase` (set paid) и всё после неё — без изменений; вход к ней идёт теперь из `RestoreBody`, а не из `Shop`.
- У `VerifyAmount` в credentials выбран существующий **MeetGuru** (supabaseApi), authentication = *Predefined Credential Type → Supabase*.
- 6 новых нод (CheckPaid, AuditDuplicate, VerifySign, VerifyAmount, AuditWarn, RestoreBody) помечены «Continue (using regular output)» на ошибке + «Always Output Data».
- Сохранено: кнопка **Save** не подсвечена (нет несохранённых изменений); в правом верхнем тумблер **Active = on**.
- Проверка env: открыть `VerifySign` → в выражении `$env.PRODAMUS_SECRET` не пусто (значение не показывать/не логировать).
- Боевая проба — тестовый дешёвый платёж (§3): в `payment_audit` появляется строка, `paid` у заказа ставится, повторный колбэк даёт `event='duplicate'`.

## 2. verify v3 — серверная цена подписки (закрытие дыры #5) + отчёт теста

### Дыра (подтверждена на реальных заказах, задеплоенная v2)
Заказы клубной подписки имеют `order.subscription = true`, `event_id = null`, а `course_positions` — это **строка-метка** (`'Подписка: <название клуба>'` / `'Продление подписки: <название>'`), в 10% случаев **пустой массив**. Shop-позиций нет → серверная цена не считалась → `expected = 0` и проходила **любая** сумma.

Прогон задеплоенной `verify_order_payment` по RPC (service role), суммы — реальные:
```
курс 032c4455            paid 3500 -> ok=true  expected=3500            ✅
мероприятие 26c2734a     paid 600  -> ok=true  expected_min=600 full    ✅
подписка c39e1bfd        paid 1500 -> ok=true  expected=0               ❌ дыра
подписка c39e1bfd        paid 1    -> ok=true  expected=0               ❌ дыра (1 ₽ проходит)
подписка 631f4903        paid 1    -> ok=true  expected=0               ❌ дыра
null-guard               paid null -> ok=false reason=no_paid_amount    ✅
```

### Как v3 берёт серверную цену подписки (без доверия клиентским суммам)
Источник цены — `public.clubs.price` (напр. 1500), резолв клуба по заказу двумя путями:
1. **По метке позиции:** клуб `c`, чьё `title` входит в элемент `course_positions` (`pos LIKE '%'||c.title`) → суммируем `c.price`.
2. **Фолбэк (пустые позиции):** по владельцу через `club_subs` — `join clubs c on c.id=cs.club where cs.suber = order.owner`, самая свежая активная подписка → `c.price`.
3. Если не резолвится ни так, ни так → `ok=false, reason='subscription_unresolved'` (в WARN только лог).
Промо к подписке не применяется (рекуррентный фикс-платёж). `ok = paid >= expected − 1`.

### Отчёт воспроизведения логики v3 (read-only; сама v3 ещё не задеплоена — выполнить вживую не могу, MCP execute_sql read-only, применять не вправе). Курс/мероприятие/null-guard уже прогнаны на боевой функции выше; ветка подписки воспроизведена по тем же таблицам:
```
подписка c39e1bfd  positions=['Продление подписки: Клуб школы доктора Крутова']
   -> expected=1500 (по метке);        оплата 1500: ok=true ;  1 ₽: ok=false  ✅ дыра закрыта
подписка 631f4903  positions=['Подписка: Клуб школы доктора Крутова']
   -> expected=1500 (по метке);        оплата 1500: ok=true ;  1 ₽: ok=false  ✅
подписка 819edfb9  positions=[] (пусто)
   -> expected=1500 (фолбэк club_subs); оплата 1500: ok=true ;  1 ₽: ok=false  ✅
подписка 10f14fd2  positions=[] (пусто), владельца нет в club_subs.suber
   -> expected=null -> reason='subscription_unresolved' (в WARN лог; в строгом заблокировало бы) ⚠️
```
⚠️ **Хрупкость:** у ~2 из 20 заказов с пустыми позициями владелец не находится в `club_subs.suber` (там Prodamus `customer_id/email/phone`), и метки нет → не резолвится. В WARN это безопасно (только журнал). **Настоящий фикс — хранить `club_id` прямо в заказе подписки** (отдельная ⚠️-задача по флоу создания подписки); тогда резолв станет однозначным. До этого в строгий режим подписки переводить осторожно (см. §3).

## 3. План следующей фазы (описание, без выполнения)

### 3.1 Включение WARN (по твоему ОК, вне эфиров и продаж)
1. Применить `pending_payment_verify_v3.sql` (вставлять **без** первой `-- sha256`-строки; тело без комментариев — переносы строк не критичны).
2. Создать `PRODAMUS_SECRET` в n8n (значение вводит владелец).
3. Внести ноды + ручные связи (§1), Save, Active=on.
4. Тестовый дешёвый платёж → проверить: строка в `payment_audit`, `paid` ставится, повторный колбэк = `duplicate`.
5. Наблюдать по реальным оплатам (ничего не блокируется).

### 3.2 Как понять, что подпись сходится (запросы к `payment_audit`)
```sql
-- A) последние 30 проверок (без ПДн)
select created_at, event, (detail->>'sig_ok') as sig_ok, (detail->>'payment_status') as pay_status,
       expected, paid, order_id
from public.payment_audit order by created_at desc limit 30;

-- B) сводка за 14 дней
select count(*) filter (where (detail->>'sig_ok')='true')  as sig_true,
       count(*) filter (where (detail->>'sig_ok')='false') as sig_false,
       count(*) filter (where event='amount_mismatch')     as amount_mismatch,
       count(*) filter (where event='duplicate')           as duplicates,
       count(*) as total
from public.payment_audit where created_at > now() - interval '14 days';

-- C) максимальная серия успешных подписей с конца
with x as (
  select created_at, (detail->>'sig_ok')='true' as ok
  from public.payment_audit where (detail ? 'sig_ok') order by created_at desc
)
select count(*) as consecutive_sig_true_from_latest
from (select ok, bool_and(ok) over (order by created_at desc rows between unbounded preceding and current row) as streak from x) s
where streak;
```

### 3.3 Критерий перехода в строгий режим
- `sig_false = 0` за период И `consecutive_sig_true_from_latest >= 20..30` реальных оплат подряд.
- Тогда (отдельный ОК) между `RestoreBody` и `Supabase` вставить `IF PaymentValid (sig_ok && verify.ok)`: true → `Supabase`; false → `Notify` владельцу, **без** set paid.
- Подписки с пустыми позициями и без `club_subs`-совпадения дают `subscription_unresolved` — до появления `club_id` в заказе их в строгом режиме либо исключить из блокировки (трактовать `unresolved` как WARN-only), либо сперва закрыть настоящим фиксом.

## 4. Перенос секретов Unisender и Telegram в credentials + ротация (⚠️, вне эфиров/продаж, по ОК; значения не печатаю)
В нодах BuyCourse сейчас inline: ключ Unisender (ноды писем) и токен Telegram-бота + chat_id (нода уведомления).
1. **Создать credentials:** (а) Unisender — Generic **Query Auth** (`name=api_key`, value — ключ вводит владелец) или штатный Unisender-cred; (б) Telegram — **Telegram API** credential (bot token вводит владелец).
2. **Переключить по одной ноде:** HTTP-ноды писем → на Query-Auth-credential, убрать inline `api_key` из параметров; ноду уведомления → на Telegram-ноду/credential, убрать inline токен из URL. Сохранять после каждой.
3. Правка/сохранение узла активный воркфлоу **не останавливает** — следующее срабатывание берёт свежую версию, простоя нет.
4. Тестовый прогон: письмо + уведомление уходят.
5. ⚠️ **Ротация:** перевыпустить ключ Unisender и токен бота (были в открытом виде в экспорте), обновить credentials. Значения — только в n8n, мне не присылать, в репо/чат не класть.

## От тебя
ОК на: (1) ноды BuyCourse (ручные шаги §1) — вне эфиров/продаж; (2) `pending_payment_verify_v3.sql`; (3) включение WARN; (4) перенос секретов + ротацию. Переход в строгий режим — отдельным ОК по критерию §3.3. Каждое изменение воркфлоу — по твоему ОК.
