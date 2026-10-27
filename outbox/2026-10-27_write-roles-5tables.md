sha256(payload below): f9f0dc46cbd74f09a5f78d942dc8deb556a5aa37248140142e46eb5344bc621a

# Проверка ролей записи перед закрытием anon/authenticated: sales, withdraw_requests, payment_guard_tier1, articles_logs, one_time_passwords

Только анализ, ничего не менял. Ключи/токены/PII не печатаю (роли JWT декодированы ТОЛЬКО по полю `role`).

## Фронт и edge-функции
Прямых клиентских (hand-written фронт) и edge-функций записей (INSERT/UPDATE/DELETE) в эти 5 таблиц — **нет** (grep по `src/_front`, `src/_common`, `supabase/functions` пуст).

## n8n (воркфлоу) + роли

| Таблица | Кто пишет | Роль записи | Безопасно закрыть запись anon/authenticated |
|---|---|---|---|
| **sales** | n8n **BuyCourse** → узел `Create_Sales` (Supabase-нода, create). Воркфлоу **check** — только `getAll` (чтение). | кредл Supabase **«MeetGuru»** = **service_role** (см. «Как определена роль»). | **ДА.** Пишет только service_role (минует RLS/гранты). Клиент/anon/auth не пишут. |
| **one_time_passwords** | n8n **ResetPw** → узел `Supabase` (create: email/user_id/type=recovery/otp). | кредл **«MeetGuru»** = **service_role**. (В ResetPw ещё два HTTP-узла с инлайн-ключами: `anon` — только ЧТЕНИЕ rpc `check_user_by_email`; `service_role` — `auth/v1/admin/generate_link`. Запись OTP — через service_role-кредл.) | **ДА, и важно.** Запись — service_role; anon используется только для чтения. Открытый anon-INSERT = форж OTP → приоритет закрыть. |
| **payment_guard_tier1** | n8n **PaymentGuard** → узел `PaymentGuardTier1` — **`getAll` (ЧТЕНИЕ)**, не запись. Поля ответа вычисляемые (`anomaly`, `paid_orders_90m`, `fresh_paid_grants_90m`) → похоже на **VIEW**. | — (писателей не найдено; n8n только читает). | **ДА.** Никто не пишет (вероятно view — запись невозможна в принципе). Закрытие anon/auth-записи безопасно/безразлично. |
| **withdraw_requests** | Живого писателя не найдено. Старая таблица; текущий вывод средств идёт в **`withdrawal_requests`** через SECURITY DEFINER RPC (`request_withdrawal`). Прежний путь — WeWeb `/my_finanse` (перекрыт override MyFinancePage → инертен). В BuyCourse узел `AlertEmail_Withdrawal` — это HTTP-письмо, НЕ запись в таблицу. | — (нет живого писателя; при наличии — только definer/service). | **ДА.** Нет живого клиентского/n8n писателя. |
| **articles_logs** | Пишется ВНУТРИ admin-модерации (`admin_approve_article`/`admin_return_article` и т.п. — SECURITY DEFINER), т.е. от владельца функции. n8n/фронт напрямую не пишут (WeWeb-суперадмин перекрыт; хенд-SuperadminPage зовёт эти RPC). | владелец definer-функции (postgres), не anon/authenticated напрямую. | **ДА.** Прямой записи anon/auth нет; лог пишет definer-RPC. |

## Как определена роль кредла «MeetGuru» (service_role)
- Прямое чтение ключа через n8n public API **заблокировано** (`GET /credentials` → 405 NOT_SUPPORTED), поэтому сам JWT я не декодировал.
- Роль **service_role** подтверждена **поведенчески**:
  1. BuyCourse через «MeetGuru» пишет `users."Ammount"` (баланс), `sales`, `user_course`. В шаге **6a** мы ревокнули INSERT/UPDATE/DELETE на `users` у anon/authenticated — если бы кредл был anon/authenticated, денежный поток BuyCourse сломался бы после 6a. Он работает → кредл **минует** гранты → service_role.
  2. ResetPw через тот же кредл пишет `one_time_passwords` (таблица закрыта от клиента) — работает → service_role.
- При желании сверить напрямую — открыть кредл «MeetGuru» (id `A84wclCRDmr3uzKM`) в n8n UI (роль видна в JWT-ключе).

## Вывод
По всем пяти таблицам запись идёт **только под service_role** (n8n BuyCourse/ResetPw) либо **внутри SECURITY DEFINER-функций** (articles_logs), либо **писателя нет** (payment_guard_tier1 — view/чтение; withdraw_requests — legacy-инертно). Ни одна не требует записи у `anon`/`authenticated`.
→ **Закрыть запись у anon и authenticated безопасно для всех пяти** (service_role и definer-пути не затрагиваются). Приоритет — `one_time_passwords` (риск форжа OTP) и `sales`/`withdraw_requests` (деньги).

### Оговорка
Детально разобраны BuyCourse, PaymentGuard, ResetPw, check, VK_Auth. Для `withdraw_requests`/`articles_logs` писателя не нашёл ни во фронте/edge, ни среди основных воркфлоу; полную побайтовую проверку всех 21 воркфлоу не делал, но архитектура (definer-RPC/legacy) указывает на отсутствие anon/auth-писателя. Если хочешь 100% — могу пройтись по оставшимся активным воркфлоу отдельно.
