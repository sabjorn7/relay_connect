sha256(payload below): 8e2e63d6dd39dd6ac1d5282c715a84389ab0a50df59b9a970a71feab3211cd61

# Закрытие дыр вебхука оплаты — аудит + усиление (на ревью, НИЧЕГО не применено)

Только read-only аудит + подготовка. n8n не менял, не выкатывал. Данные людей/ключи/реквизиты не печатаю.
⚠️ = трогает webhook/цены/доступ/выплаты. Перед любой правкой воркфлоу — спрошу твой ОК.

## 1. Read-only аудит прошлых оплат (886 заказов с paid=true; обезличенно)
- **payment_id = null:** 1 заказ. **invariant (summ ≠ Σ shop.price):** 1 (`ef3ca968`: summ 27900 > Σshop 2900 — похоже удалены строки shop, это НЕ недоплата).
- **paid без sales (платные, не мероприятия):** 3 (`5e4996f6`, `844dec03`, `f01dd9e6`) — вероятно оборванные исполнения вебхука; на ручную проверку.
- **недоплата ниже минимальной серверной цены БЕЗ промокода (не мероприятие):** 86. НО паттерн — ровно ~70% канона (6300/9000, 17500/25000, 2100/3000, 7000/10000 …) = систематические ~30% скидки, а не случайные суммы.
- **Не удалось сверить:** 253 заказа (строки shop уже удалены). event-заказы: 18.

**Были ли признаки злоупотребления? — явных нет, но аудит ненадёжен.**
- 86 «недоплат» почти наверняка — КОНФАУНДЕР: `course.Price` **изменяема и НЕ снимается снимком в заказ**; старые продажи по тогдашней (меньшей) цене + до-промо-кодовые скидки выглядят «недоплатой» против текущей цены. Ровный 30% = не почерк подмены (подмена дала бы произвольные суммы).
- Единичные случаи (1 null payment_id, 3 без sales, 1 inverted) — на ручной спот-чек, но не паттерн фрода.
- **Главное ограничение:** реальный эксплойт — подмена `products[].price` в ссылке Prodamus при «нормальных» `shop.price`/`order.summ` — в БД **не виден вообще** (нужна сверка с Prodamus). Поэтому «нет следов в БД» ≠ «дыры нет». Закрывать надо независимо.

## 2. Усиление вебхука BuyCourse (⚠️) — дизайн на ревью

### Текущая дыра (напоминание)
Нода **«Shop»** (Prodamus-колбэк) → **«Supabase»**: `update order set paid=true, payment_id=body.order_id where id=body.order_num` — без подписи и без сверки суммы; доступ/комиссия на клиент-записанной `shop.price`.

### (а) Проверка подписи Prodamus — HMAC SHA-256
- Prodamus шлёт подпись в заголовке **`Sign`** (тело — `multipart/form-data`; поля: `date, order_id, order_num, domain, sum, customer_phone, customer_email, payment_type, payment_status, products[...]` …).
- ⚠️ **Документация Prodamus не раскрывает точную сериализацию** подписываемой строки. Prodamus поставляет готовый HMAC-хелпер (их PHP/JS `Hmac`): рекурсивная сортировка ключей (`ksort`), приведение bool/null к строкам, `http_build_query`-подобная сериализация, затем `hmac_sha256(data, secret)`. **Порт на JS прилагаю, но его ОБЯЗАТЕЛЬНО сверить на реальном тест-уведомлении** (см. тест-план) — иначе легитимные оплаты будут отвергаться.
- Секрет — **только из n8n** (env `PRODAMUS_SECRET` или credential), НЕ хардкод, мне не присылать.
- JS-нода `VerifySign` (псевдокод, секрет из `$env`):
  ```js
  // вход: $json.body (разобранный multipart), $json.headers['sign']
  const crypto = require('crypto');
  const secret = $env.PRODAMUS_SECRET;           // НЕ хардкодить
  const data = $json.body;                        // объект полей уведомления
  function norm(o){ /* рекурсивный ksort + bool/null→строки + http_build_query (как Hmac Prodamus) */ }
  const calc = crypto.createHmac('sha256', secret).update(norm(data)).digest('hex');
  const got  = ($json.headers['sign'] || '').toLowerCase();
  return [{ json: { sig_ok: calc === got } }];
  ```

### (б) RPC `verify_order_payment(order_id, paid_amount)` — в `pending_payment_verify.sql`
Пересчитывает ОЖИДАЕМУЮ цену серверно из `course` (renewal→`DurationPrice`, Free→0, иначе `Price`) + промо с `order.promo_code_id` — **не из клиентских `shop.price`/`order.summ`**. `paid_amount` = `body.sum` из Prodamus. Возвращает `{ok, expected, paid, is_event, reason}`. Допуск 1₽, переплата ок. Для мероприятий (`event_id`) — не блокирует (депозит), только помечает (депозит-математику добавим отдельно).

### (в) При несовпадении подписи ИЛИ суммы — не ставить paid, не выдавать доступ, журнал + уведомление
- IF `sig_ok && verify.ok && !already_paid` → текущая ветка (set paid → sales → user_course → баланс).
- Иначе → `payment_audit`-insert (`event='sig_fail'|'amount_mismatch'`, expected/paid/detail) + уведомление владельцу (Telegram/email через credential) + СТОП (paid не ставим).

### (г) Идемпотичность
- Перед обработкой: если `order.paid` уже `true` → `payment_audit(event='duplicate')` + СТОП (не пере-создавать sales/баланс). Prodamus/ретраи не удваивают продажу/начисление.

### Безопасный порядок включения (чтобы не отвергать легитимные оплаты)
1. **Сразу строго:** проверка подписи (закрывает форж колбэка) + идемпотентность + `paid_amount >= order.summ` (простая сверка, без канона).
2. **Сначала в режиме WARN:** `verify_order_payment` (канон-пересчёт) — только журнал+уведомление, НЕ блокирует; понаблюдать (из-за изменяемых цен/депозитов/эфиров возможны ложные mismatch) → затем перевести в строгий.

## Новые/изменённые ноды n8n (без секретов; JSON-сниппет для вставки)
- `VerifySign` (Code) — HMAC по `Sign` (секрет из `$env.PRODAMUS_SECRET`).
- `CheckPaid` (Supabase get order.paid) + `IF already_paid` → `AuditDuplicate` (Supabase insert payment_audit) + стоп.
- `VerifyAmount` (Supabase `rpc/verify_order_payment` {p_order_id: body.order_num, p_paid_amount: body.sum}).
- `IF PaymentValid` (`sig_ok && !already_paid && verify.ok`) — true → существующая нода «Supabase» (set paid) и дальше; false → `AuditReject` (payment_audit insert) + `Notify` (уведомление владельцу через credential).
Полный JSON добавляемых нод приложу отдельным файлом по твоему ОК на дизайн (без секретов: секрет вебхука — `$env`, уведомление — credential/placeholder).

## Бэкап / откат
- ⚠️ **Полный JSON BuyCourse в репо НЕ кладу:** в нём inline-секреты (Unisender api_key, Telegram bot-token захардкожены в нодах) — утечка. **Бэкап = твой экспорт BuyCourse из n8n UI (Download), хранить ПРИВАТНО.** Рекомендую заодно вынести эти секреты в n8n credentials (отдельно, ⚠️).
- **Откат изменения вебхука:** удалить добавленные ноды (VerifySign/CheckPaid/VerifyAmount/IF/Audit/Notify) и вернуть прямую связь «Shop»→«Supabase», ИЛИ импортировать приватный pre-change экспорт. SQL-откат — `pending_payment_verify_rollback.sql` (drop функции+таблицы).

## Тест-план (на ТЕСТОВОМ платеже, вне эфиров/продаж)
1. Снять реальное Prodamus-уведомление (из логов n8n executions) → сверить HMAC-порт: `calc == Sign` на валидном колбэке (иначе поправить сериализацию `norm()` под SDK Prodamus). Подпись/секрет в логах не печатать.
2. Валидная оплата тестового дешёвого курса → `sig_ok=true`, `verify.ok=true`, paid ставится, sales/доступ создаются, `payment_audit(event='ok')`.
3. Повторный тот же колбэк → `duplicate`, второй раз sales/баланс не создаются.
4. Подделка суммы: колбэк с `sum` ниже → (WARN: журнал+уведомление, paid всё равно ставится; STRICT: paid НЕ ставится, `amount_mismatch`, уведомление).
5. Подделка подписи/левый POST на вебхук → `sig_fail`, paid НЕ ставится, уведомление.
6. Мероприятие с депозитом → не блокируется (`is_event=true`).
7. Эфир (stream-pay-link) → проходит (цена серверная) + тот же вебхук-гейт отрабатывает.
Везде: телефон/почту/подпись/секрет — только маскировать, не печатать.

## Файлы
- `pending_payment_verify.sql` — `verify_order_payment` + `payment_audit` (+ rollback). Аддитивно/инертно до интеграции в n8n. Запуск — ты, по ОК.
- (по ОК на дизайн) отдельный файл с JSON добавляемых нод n8n (без секретов).

## Что нужно от тебя
ОК на дизайн → дам JSON нод. ОК на SQL → запустишь `pending_payment_verify.sql`. ОК на правку BuyCourse → только вне эфиров/продаж, с твоим приватным бэкапом воркфлоу. Деплой вебхука и SQL — по отдельным ОК.
