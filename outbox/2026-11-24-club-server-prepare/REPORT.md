# Production club server preparation — 24.11.2026

**BLOCKED: административное одобрение SHA. Установка НЕ выполнена.**
Источник строго `9a698cf4a08863727b6d7b32b50aa972dff07412`, только attachments.proposed.sql + push.proposed.sql. Старый расширенный SQL 5b56ab2 не используется.

## Фактическое состояние

Production проверен через Supabase MCP read-only 15:39–15:44 UTC (18:39–18:44 МСК). PostgreSQL 15.8; необходимые типы столбцов совпадают. pg_net и push_send_key существуют. Новых функций/колонок/триггеров/bucket нет. Конфликтов имён не обнаружено. Снимок определений столбцов, индексов, constraints, ACL/RLS, Storage policies и trigger definitions сохранён в schema-before.json без строк пользовательских данных и значений ключей.

MCP работает как service_role: CREATE public=false, членства в postgres/supabase_admin/supabase_storage_admin нет. SSH sb-edge работает как mgdeploy; sudo разрешён только для /usr/local/sbin/mg-deploy. Этот скрипт проверяет SHA по /etc/mg-deploy/approved.sha до исполнения.

Подготовленные install/rollback загружены в /home/mgdeploy/staging без перезаписи существующих файлов. Их SHA проверены на сервере. Вызов mg-deploy завершился кодом 3: `sha не одобрена`. Скрипт установки не начал выполняться.

Контрольный read-only запрос после отказа: bucket_count=0, new_functions=0, new_columns=0, new_triggers=0; club_chat_rows=25, club_post_rows=43 (как до попытки). Новые уведомления этим пакетом не могли отправиться: их триггеры и обработчик не устанавливались. Не утверждаем отсутствие иных старых каналов уведомлений.

## Реально изменено

Только два staged-файла install/rollback. БД, Storage, сервисы, Edge, frontend не изменены. Подписки/оплата/Auth не затронуты. Root backup на сервере пока НЕ создан: он создаётся установщиком перед DDL после административного одобрения. Локальный структурный snapshot уже сохранён.

## Подготовленный установщик

- Проверяет SHA обоих утверждённых SQL, существование единственного PostgreSQL-контейнера, конфликты объектов, минимальную схему и push dependencies.
- До DDL сохраняет schema-only pg_dump club_chat/club_posts/storage.objects/storage.buckets, preflight JSON, оба SQL и SHA в приватный /var/lib/mg-deploy/club-chat-prepare/<UTC>-<pid>/.
- Объединяет два файла одной транзакцией; убраны только внешние BEGIN/COMMIT каждого файла. DDL/SQL внутри не изменены. lock_timeout=3s, statement_timeout=30s. Нет рестартов.
- До COMMIT проверяет attachments=false, оба push trigger disabled и private bucket 25MiB. При любой SQL-ошибке вся транзакция откатывается автоматически, без частичной установки.
- После COMMIT сохраняет after.json и печатает выключенное состояние.
- Rollback — только безопасное отключение согласно disable.sql согласованного пакета; не удаляет пользовательские данные, колонки или bucket и не меняет старую RLS. Frontend/Edge и так не публикуются этой задачей.

## Проверки

| Проверка | Результат |
|---|---|
| Production schema compatibility / object absence | PASS read-only |
| Source SQL hashes против 9a698cf | PASS |
| Python installer compile, shell bash -n | PASS |
| SHA staged файлов == локальным | PASS |
| Запуск штатного mg-deploy | BLOCKED, SHA not approved, exit 3 |
| Фактическая установка / disabled capability RPC | NOT TESTED: не установлено |
| Текст send/delete, публикация поста после установки | NOT TESTED: установка не состоялась; реальные сообщения/посты не создавались |
| Общие чаты после установки | NOT TESTED: установка не состоялась; их определения сохранены, ничего не менялось |
| Состояние после отказа | PASS, все новые объекты отсутствуют |

После одобрения/установки нужны read-only сверка объектов, RLS/ACL/старых triggers, безопасная проверка существующих операций без реальных рассылок. Не выдавать EXPLAIN или локальную фикстуру за выполненную production-отправку.

## Осталось до включения функций

Сначала завершить эту выключенную установку и проверки. Затем отдельно согласовать Edge, frontend, реальные Safari microphone/PWA device checks и только затем enable. Никакие enable scripts в данном установщике не вызываются. Переработка прав/членства не входит в задачу.
