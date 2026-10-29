sha256(payload below): 69855d6dad7f5f956006ed507adff6ce1f0f10c1d79c63bfc40be3771d81aaac

# Усиление оплаты v5 — DB-вариант подписи (секрет в БД, не в n8n)

На ревью. На хосте/compose ничего не трогал. BuyCourse не менял (жду ОК). Секреты/подписи/телефоны/почты не печатаю. ⚠️ = webhook/цены/доступ/выплаты.
Причина DB-варианта: живой n8n — standalone docker-compose из `/home/n8n/docker-compose.yml`, файл от 2025-05-01 с битыми маркерами (`—`/`«»`) и `N8N_BASIC_AUTH_ACTIVE=true` при закомментированных кредах — пересоздавать из него опасно. DB-путь не требует env/рестарта/правки compose.

## Файлы
- `2026-10-29_pending_payment_sign_v5.sql` — `payment_secrets` + `verify_prodamus_sign`. Тело функции без комментариев и без пустых строк. + `..._v5_rollback.sql`.
- `2026-10-29_buycourse-added-nodes.json` — ноды v5 (VerifySign сериализует → VerifySignRPC зовёт RPC; секрета и обращения к окружению нет).

## 1. payment_secrets (доступ только service_role / SECURITY DEFINER)
`RLS on` + `revoke all from public, anon, authenticated` + `grant all to service_role`. Политик для anon/authenticated нет → им отказ. Секрет наружу не возвращает ни одна функция (`verify_prodamus_sign` отдаёт только `{valid, secret_present}`).

## 2. verify_prodamus_sign(serialized text, sign text) → jsonb {valid, secret_present}
- `SECURITY DEFINER`, `set search_path = public, extensions`.
- pgcrypto: в Supabase (и в нашем self-host) расширение лежит в схеме **`extensions`** — поэтому `search_path` включает `extensions`, и `hmac(serialized, secret, 'sha256')` резолвится; `encode(...,'hex')` — из `pg_catalog`. ⚠️ Проверить отсюда интроспекцией не смог (MCP `execute_sql`/`list_extensions` зависали) — **контрольный SELECT для сверки после применения** (должен вернуть именно это значение, что подтверждает, что `hmac()` зовётся корректно):
  ```sql
  select encode(hmac('abc','key','sha256'),'hex');
  -- ожидаемо: 9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab
  ```
  Если значение совпало — функция рабочая. Если ошибка `function hmac(...) does not exist` — pgcrypto в другой схеме, скажи, поправлю `search_path`.
- Сравнение регистронезависимое (`lower(sign)=lower(v_calc)`).
- Если секрета нет/пустой → `{valid:false, secret_present:false}` (НЕ ошибка).
- `revoke all from public, anon, authenticated` + `grant execute to service_role`.

## 3. Сериализация в VerifySign — по Prodamus Hmac SDK (ГЛАВНЫЙ РИСК, проверяется в WARN)
Prodamus `Hmac::create`: `array_walk_recursive(strval)` → рекурсивный `ksort` → `json_encode($data, JSON_UNESCAPED_UNICODE)` → `hash_hmac('sha256', …, secret)`.
- **Unicode/кириллица:** флаг `JSON_UNESCAPED_UNICODE` выставлен → кириллица остаётся **как есть (literal UTF-8)**, НЕ в `\uXXXX`. JS `JSON.stringify` по умолчанию тоже не экранирует не-ASCII → совпадает. (Без этого флага PHP выдал бы `\uXXXX` — тогда порт был бы другой; выбор по SDK, не по догадке: флаг стоит.)
- **Слэш `/`:** `JSON_UNESCAPED_SLASHES` у Prodamus НЕ выставлен → PHP экранирует `/`→`\/`. JS не экранирует → в порте добавлено `.replace(/\//g,'\\/')`.
- **Форма `products[]`:** тело приходит form-urlencoded с ПЛОСКИМИ ключами `products[0][name]` (видно в pinData ноды Shop). PHP `$_POST` авто-разворачивает их во вложенный массив, а числовые последовательные ключи `json_encode` рендерит как массив `[...]`. Порт делает то же: `unflatten` + `arrayify` (0..n → массив) до `ksort`/`json_encode`.
- Подписывается **только тело**; `Sign` берётся из заголовка и в данные не входит.
- ⚠️ **Это и есть главный риск:** точный набор подписываемых полей и форма `products[]` у Prodamus подтверждаются только на реальном колбэке. В WARN это видно сразу: `detail.sig_valid`/`secret_present` в `payment_audit`, ничего не блокируется. Если `valid=false` на валидных платежах — правим сериализацию (поле/форма/экранирование) до строгого режима.

## 4. Формат SQL
Тело функции без `--`-комментариев и без пустых строк (вставка в Studio не ломается при схлопывании переносов). Откат — отдельный файл (`drop function` + `drop table`).

## 5. Вставка секрета (значение вводит владелец сам)
Одной строкой (Studio SQL editor):
```sql
insert into payment_secrets(name, value) values ('prodamus', '<ВСТАВЬ_СЕКРЕТ>')
on conflict (name) do update set value = excluded.value;
```
Проверка без показа значения: `select name, length(value) from payment_secrets;` (длина, не значение).

**История Studio / логи:** Studio сохраняет выполненные запросы (локально в браузере) — после вставки удали этот запрос из панели истории/сниппетов SQL-редактора и очисти поле. `pg_stat_statements` хранит запрос с нормализованными литералами (значение НЕ сохраняется). Если у Postgres `log_statement` = `mod`/`all`, литерал попадёт в логи БД — тогда используй способ ниже.

**Способ без значения в истории/логах (psql, предпочтительно):** на хосте БД, значение вводится скрыто и не попадает ни в argv, ни в историю psql:
```bash
IFS= read -rs V
printf "\\set v %s\ninsert into payment_secrets(name,value) values ('prodamus', :'v') on conflict (name) do update set value=excluded.value;\n" "$V" \
  | psql "<строка подключения к БД>"
unset V
```
(`printf` — builtin, значение не видно в `ps`; psql читает из stdin — в `~/.psql_history` не пишется; `:'v'` безопасно квотирует литерал.)

## 6. Ноды v5 (`buycourse-added-nodes.json`)
- `VerifySign` (Code): только сериализует тело (unflatten+arrayify+strval+ksort+json_encode+экранирование `/`) и отдаёт `{serialized, sign}`. Секрета/окружения нет.
- `VerifySignRPC` (httpRequest, credential MeetGuru, predefinedCredentialType): POST `/rest/v1/rpc/verify_prodamus_sign` с `{serialized, sign}` → `{valid, secret_present}`.
- `VerifyAmount` (как раньше): RPC `verify_order_payment`.
- `AuditWarn`: event = `(valid && ok)?'ok':(!valid?'sig_fail':'amount_mismatch')`; detail = `{sig_valid, secret_present, verify, payment_status, mode:'warn'}`.
- Остальные (CheckPaid, IF_AlreadyPaid, AuditDuplicate, RestoreBody) — без изменений. Все новые data-ноды: `onError=continueRegularOutput` + `alwaysOutputData` (в WARN ничего не блокирует set paid).
- **Макро-проводка та же:** Shop→CheckPaid→IF→[true:AuditDuplicate|false:VerifySign→VerifySignRPC→VerifyAmount→AuditWarn→RestoreBody→Supabase]. Единственное отличие от v4 — вставлен VerifySignRPC в сегмент подписи (следствие DB-варианта). Связи Shop→CheckPaid и RestoreBody→Supabase (и удаление Shop→Supabase) внесу при применении — по твоему ОК.

## От тебя
1. ОК на `pending_payment_sign_v5.sql` (ты запускаешь) → сверь контрольный SELECT (§2).
2. Вставь секрет (§5) — значение сам.
3. ОК на внесение нод v5 в BuyCourse (WARN) — внесу сам одним атомарным обновлением, вне эфиров/продаж, с проверкой окна и отчётом.
Строгий режим — отдельным ОК по критерию (sig_valid=true на 20–30 реальных оплатах подряд).
