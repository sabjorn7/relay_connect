# Источники и воспроизводимость

Аудит 27.11.2026, read-only. Новые тестовые операции не выполнялись. «PASS» из старых тестовых пакетов не использовался как доказательство текущего production-антифрода.

## Код приложения

Проверенный main: `dd1214f843b73aa1e444516053e50745bd7321e0`.

- [registration.js](https://github.com/sabjorn7/meetclone/blob/dd1214f843b73aa1e444516053e50745bd7321e0/src/_front/auth/registration.js): формат email, исправление опечаток, resend delay и обработка 429; нет проверки подозрительности домена.
- [financeComponents.js](https://github.com/sabjorn7/meetclone/blob/dd1214f843b73aa1e444516053e50745bd7321e0/src/_front/financeComponents.js): существующие RPC реквизитов, истории и запроса вывода.
- [checkout handler](https://github.com/sabjorn7/meetclone/blob/dd1214f843b73aa1e444516053e50745bd7321e0/supabase/functions/checkout-pay-link/handler.mjs): серверная авторизация и параметры заказа, без обнаруженного поведенческого антифрода. Совпадение с фактическим Edge worker не доказано.
- Поиск выполнялся по payment/order/payout/withdrawal/audit/rate-limit/fraud/velocity/fingerprint/disposable/VPN/CAPTCHA в затронутых каталогах; отдельно просмотрены относящиеся к задаче production-функции.

## Supabase — только SELECT

Проверены определения: payment_guard_tier1; request_withdrawal; admin_approve_withdrawal_v2; admin_reject_withdrawal_v2; save_my_requisites; verify_order_payment; fulfill_paid_course_order; club_claim_callback. Проверены относящиеся к order/users/withdrawal_requests триггеры и агрегаты, перечисленные в отчёте.

Повторяемые безопасные примеры запросов:

```sql
SELECT pg_get_viewdef('public.payment_guard_tier1'::regclass, true);
SELECT event, count(*) FROM public.payment_audit GROUP BY event;
SELECT action, count(*) FROM public.admin_money_log GROUP BY action;
SELECT status, count(*) FROM public.withdrawal_requests GROUP BY status;
SELECT count(*) AS receipts,
       count(*) FILTER (WHERE a.event='ok'
         AND a.detail->>'sig_valid'='true'
         AND a.detail->>'payment_status'='success') AS verified_proofs
FROM public.order_access_fulfillments f
LEFT JOIN public.payment_audit a ON a.id=f.proof_id;
```

Не запрашивать `SELECT *` из order.logs, requisites, callback payload или payment_secrets. Не включать их значения в отчёт. Результат чтения auth.audit_log_entries: permission denied; не обходился.

## n8n

`workflow-evidence.json` содержит только метаданные, имена/типы узлов, соединения и названия полей preview. Никаких parameters, credentials, pinData, тел callback или значений заголовков.

Подтверждённый последний просмотренный запуск PaymentGuard: 47864, 27.11.2026 08:10:57 UTC, success. Выполнены schedule → view → IF; AlertEmail не выполнен. BuyCourse 47127/47023/47001/46914: success, путь до FulfillAllAccesses. Subscription 46178/46117 — до нового графа, не доказательство его исполнения после установки.

Активные BuyCourse и Subscription получены повторно через mode=active; nodes/connections совпали с прочитанными графами. activeVersionId=null у используемой версии API. Для PaymentGuard подтверждена активность и фактическое расписание; вручную workflow не запускался.

## nginx / ограничения

Read-only SSH на mg-jump: конфиг и access log доступны для чтения. Сырые access log не читались. Выбраны только директивы лимитов:

- beacon: zone 60r/m; location burst=20, status=429.
- session diagnostic: IP 6r/m burst=3; global 5r/s burst=10; status=429.
- `$remote_addr` присутствует в основном log_format.

Отдельных платёжных/регистрационных limit_req в просмотренных conf/sites-enabled не найдено. Это не проверка GoTrue/Kong или внешнего WAF. Загруженность последней версии nginx config, фактические 429 и сроки хранения логов не тестировались.

## Недоступное / не проверялось

Настройки и содержимое Auth audit; кабинет мерчанта/банка; полный актуальный исходник Edge worker (details API вернул null); фактическая доставка email администратору; ручной регламент расследования; выполнение нового Subscription callback после обновления. Полные PAN/CVV/секреты не нужны для продолжения этой проверки.
