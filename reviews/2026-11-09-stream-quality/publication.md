# Публикация для review — 2026-11-09

Ветка relay_connect: feature/stream-quality-deploy. Это материалы review, не deployable приложение и не разрешение применять SQL. Production и репозиторий MeetGuru этой публикацией не меняются.

## SQL для владельца и ChatGPT

- Полная неизменённая миграция: `supabase/migrations/pending_stream_video_quality.sql`.
- SHA-256 миграции: `5673a56730a1e25b7f20cddf3e438cff9dc0a39bcb248c7da439a12f1e820bb5`.
- Read-only проверка после успешного COMMIT: `supabase/migrations/verify_stream_video_quality.sql`.
- Operational rollback: `supabase/migrations/pending_stream_video_quality_rollback.sql`. Он только выключает Full HD, не удаляет схему и не возвращает старый код.

Миграция добавляет поле качества, таблицы состояния и серверные RPC/триггеры. Старые записи остаются HD; Full HD выключен. Применение владельцем через Supabase SQL Editor — отдельное действие, оно здесь не выполнялось. Перед ним проверить текущую схему, сохранить backup и убедиться в отсутствии активных эфиров. Миграция не идемпотентная: при уже существующих объектах не запускать её повторно вслепую.

После миграции отдельно выполнить штатное обновление PostgREST:

```sql
NOTIFY pgrst, 'reload schema';
```

Затем запустить verify_stream_video_quality.sql. Он не изменяет данные, не включает Full HD и не перезапускает сервисы. Все 12 именованных проверок должны вернуть PASS; дополнительно вручную сверить выведенные CHECK/FK/PK definitions с миграцией. Проверка SQL-каталога не доказывает, что PostgREST уже обновил свой cache: доступность новых RPC проверяется отдельно после NOTIFY. После запуска реальных Full HD начальные проверки «все записи HD / флаг false» уже не являются универсальными проверками здоровья — они предназначены для первого внедрения.

## Состав и применение патчей

Включены связанные SQL, отдельные новые компоненты/helpers, candidate orchestrator/template, исходные task diff, тесты, отчёты и предыдущие результаты. Полные dirty StreamsPage/StreamCallPage/streamsApi/liveApi/visibility из MeetGuru не копируются: в них были другие изменения. Только изменения качества этих файлов представлены frontend.diff. Его база — снимок рабочего дерева начала задачи, НЕ relay_connect/main и НЕ чистый MeetGuru main. Не применять патч в relay_connect как код приложения.

Оригинальный task-files-sha256.json описывает исходный локальный набор, включая файлы, намеренно не опубликованные целиком. Актуальный состав опубликованного пакета и его хеши — publication-files-sha256.json. Новые материалы media-trials-plan.md и production-preflight-20261109.md также включены.

Candidate orchestrator — четыре файла, а не полный сервис. config/auth/PeerTube/credentials и зависимости берутся из соответствующей проверенной версии отдельного сервиса; никаких production env в пакете нет. Код не переносить поверх устаревшего локального orchestrator без сверки production-baseline.

## Реально выполненные проверки этой публикации

- 9 unit и 9 VM/mock-тестов candidate orchestrator PASS, 0 FAIL (повторный запуск).
- Новый verification SQL: временный PostgreSQL 15 на 127.0.0.1, синтетическая schema/stream, настоящая миграция; 12 проверок PASS. После отзыва EXECUTE у service_role проверочный SQL корректно показал FAIL. Временный процесс остановлен.
- Предыдущие результаты PG/PostgREST/Chrome/build хранятся в results/; они не выдаются за повторный запуск или проверку реальной медиапередачи.
- Медиа-цепочка 720p/1080p, нагрузка и Safari в этой публикации не тестировались. Full HD в production остаётся NO-GO до согласованных измерений.

Существующий флаг Full HD глобальный, не allowlist тестовых пользователей. Не включать его для всех, называя это ограниченным тестом. Безопасный порядок внедрения/ограничения — deployment.md, production-preflight-20261109.md и media-trials-plan.md.
