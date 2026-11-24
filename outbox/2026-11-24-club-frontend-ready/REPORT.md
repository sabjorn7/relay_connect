# Клубный чат: готовность frontend при выключенных функциях

**READY FOR APPROVAL: публикация только интерфейса с attachments=false и выключенными push triggers. Деплой НЕ запускался.**
Main GitHub проверен: `123cdab5222d42803adc310f53bdfccfde4cc9a9`, совпадает с базой пакета `9a698cf`.
Чистый кандидат: `/private/tmp/mg-club-ui-release-20261124-r2`, ветка `release/club-ui-disabled-20261124`. Продуктовый коммит/PR/push не выполнялись.

## Production после установки SQL

Read-only проверка 24.11.2026 16:16 UTC (19:16 МСК):

- attachments=false; private bucket=true, limit=26214400, ожидаемый MIME allowlist.
- trg_push_web_club_message и trg_push_web_club_post: tgenabled=D.
- Новых вложений=0, queued club messages=0, queued club posts=0.
- Семь новых nullable колонок, пять функций, шесть политик только нового bucket соответствуют frontend-контракту. Тела всех пяти функций точно совпали с согласованным SQL.
- Старые RLS/ACL клубных таблиц/членства/групповых чатов, старые триггеры и Storage policies совпали с сохранённым снимком до установки.
- Существующие разрешения authenticated SELECT/INSERT/DELETE club_chat и INSERT/UPDATE club_posts сохранены. Читаются 25 сообщений и 43 поста (выведены только количества).
- GET /, /club/, /chats/: HTTP 200, HTML содержит module script. Это проверка HTTP, а не авторизованного пользовательского сценария.

BACKUP предоставлен администратором: `/var/lib/mg-deploy/club-chat-prepare/20261124T161242Z-3412516`. Его наличие под root не перепроверялось; он не использовался для внесения изменений.

## Проверки

| Проверка | Результат |
|---|---|
| Схема/RPC/флаги production, неизменность старых прав/триггеров | PASS, read-only |
| Прежние text insert/read/delete и post publish | PASS в изолированном PostgreSQL с фактически установленными определениями функций |
| Реальная запись/удаление/публикация на production | NOT TESTED: тестовые сообщения/посты не создавались, чтобы не вызвать действующие legacy уведомления |
| /club Chrome/WebKit × desktop/mobile, attachments=false | PASS 4: история, текст, удаление, фото popup, профиль-ссылки, отсутствие UI закрытых вложений и upload |
| /club с вложениями=true только в локальных моках | PASS 4: дополнительно PDF/image send + signed URL view |
| Существующие группы Chrome/WebKit | PASS 12, исходник ChatsPage не менялся |
| Чистый frontend Vite build без postbuild | PASS |
| npm ci / полный postbuild | NOT TESTED в этом прогоне; использованы ранее установленные зависимости, postbuild обращается к production |
| Реальная Safari voice capture / физическая PWA delivery | NOT TESTED; прежний WebKit capture NotAllowedError остаётся ограничением |

Production-операции записи не выдаются за проверенные. Проверки подтверждают совместимость схемы и локального интерфейса; перед включением функций нужен согласованный smoke на тестовом участнике/клубе.

## Что входит в публикацию UI

Только frontend-файлы из frontend/FILES.json. Edge, SQL, CI, общие чаты, Auth и оплаты исключены. `changes.diff` + SHA-проверяемая точечная правка page JSON формируют полный кандидат. Новые функции остаются выключенными автоматически; их включение не связано с Deploy App.

Порядок публикации/отката: RELEASE.md. Дальнейшее включение — ENABLE.md и server-next/, исключительно по отдельному разрешению. Массового включения push в этом пакете нет.

Локальная проверка подготовленного pilot SQL: PASS, другой клуб не создаёт enqueue. Это тест плана, не включение production.

Для повторения SQL-тестов: локальный PostgreSQL/pg_config; server SQL из 9a698cf поместить в reviews/2026-11-24-club-finish/server/. Для installed test задать INSTALLED_SCHEMA_JSON абсолютным путём к evidence/schema-after.json; для pilot test — PILOT_SQL к server-next/push-pilot-enable.sql. Используются только временные локальные базы.
