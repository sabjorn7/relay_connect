# Персональный Full HD pilot — локальный кандидат, 2026-11-09

Production НЕ изменён: SQL не применялся, флаг не включался, допуск не назначался, эфиры не создавались, сервисы не перезапускались, commit/push/deploy отсутствуют.

## Подтверждённая база

- Production main сверена через GitHub API: `d3a56150b96cdecb23d20726f9aa6c957e3f1b73` — диагностика; содержит PeerTube hotfix и «Мои трансляции». SSH fetch GitHub завершился Connection closed; для read-only сверки использован публичный API и существующая локальная копия опубликованного коммита, без смены авторизации.
- Production server/db/livekit/auth прочитаны с работающего live-orchestrator, хеши в production-baseline-sha256.json. Кандидат построен от этих файлов, НЕ от устаревшего /Users/arseny/livekit-poc/orchestrator.
- requireAuth проверяет Supabase JWT (HS256, exp, audience, issuer если задан); единственная доверенная identity — req.user.sub. /live/start проверяет stream.author. Роль users.role='admin' даёт прежнее чтение диагностики, но НЕ управление новым допуском. Credentials/config/env не скопированы.
- Production RPC и триггеры качества совпадают с базовой миграцией. streams RLS: INSERT — свой author + существующая роль создателя, UPDATE/DELETE — собственный author; SELECT — public/owner/member. Новая миграция эти политики не меняет.
- На момент чтения: global full_hd_enabled=false, max_full_hd_live=1, live=0, reservations=0.
- PeerTube 7.0.1: live и live transcoding enabled, профиль default, remote runners=false, дополнительные live enabledResolutions=[]. Эффективный always_transcode_original_resolution публичный API не раскрывает; контейнер PeerTube на доступном mg-jump не найден. Его production-значение не подтверждено.
- Успешный реальный HD 1280×720/30, HIGH ~1,72 Мбит/с и звук/видео зрителя подтверждены владельцем, не новыми замерами этого этапа.

## Контракт допуска

`stream_full_hd_test_grants`: stream_id + owner_id + enabled + expires_at. FK на реальные streams/users. RLS включён; anon/authenticated не читают и не пишут. service_role читает, но не имеет прямого INSERT/UPDATE/DELETE. Управление — только привилегированным владельцем через SQL Editor. Нового RPC для назначения/отзыва нет.

Partial unique index разрешает ровно один enabled grant, включая истёкший: перед назначением другого теста старый нужно явно отозвать. Это административное ограничение дополнительно к max_full_hd_live=1.

Действительность: текущий author совпадает с owner_id и переданным сервером actor; mode=multi; enabled=true; срок не истёк. Допуск не переносится вместе с ownership — смена автора отключает его, даже если автор позже возвращён. Для solo/OBS этот pilot не доступен: существующий путь HD/OBS не переписывается.

Глобальный флаг не меняется. Для pilot новая серверная проверка разрешает Full HD только через эту таблицу, а не через global true. Старый global capabilities endpoint сохранён для совместимости, новая UI на него не опирается. Старые RPC reserve/mark оставлены для HD; Full HD через них закрыт ошибкой actor contract required.

Проверки проводятся при сохранении quality/author/mode, reserve, hold перед внешним Egress и mark. Новые service-only scoped reserve/mark получают actor из проверенного JWT, не из HTTP body. Резерв содержит обязательный owner_id. Advisory lock и grant row locks сериализуют старты, отзыв и лимит. Повторные/параллельные вызовы не дают второй слот.

После revoke/expiry работающий Egress/run snapshot и токены уже идущего эфира не понижаются. Следующий старт запрещён до возобновления допуска или выбора HD. Отзыв не останавливает live. У уже прошедшего hold запроса возможен provisional внешний Egress: отказ mark приводит к подтверждённой остановке и компенсации; атомарной транзакции между PostgreSQL и LiveKit нет.

## UI и оркестратор

Новый эфир создаётся в HD. Владелец сначала создаёт скрытый бесплатный multi-host тест, затем оператор назначает допуск этому ID. При открытии настроек UI вызывает только read-only stream_video_quality_for_stream(stream_id): identity выводится из auth.uid(). Не-владелец/несуществующий stream получают одинаковое false; anon не имеет EXECUTE.

Только для разрешённого эфира появляется Full HD с пометкой тестового режима и оговоркой качества камеры/сети/PeerTube. Перед сохранением допуск перечитывается; БД остаётся окончательной защитой. Недоступный backend, поздние ответы и переключение диалогов не включают Full HD. При revoke ранее сохранённый Full HD показывается как будущий HD без автоматической записи в БД и без изменения live snapshot.

Кандидат orchestrator меняет только db.mjs/server.mjs. livekit.mjs/videoQuality.mjs включены как неизменённый контекст. VP8, камера HD 1,7 Мбит/с, Full HD 4,5 Мбит/с, 30 FPS, simulcast/dynacast, H264_720P_30/H264_1080P_30 и Egress 3/4,5 Мбит/с не перенастраивались. Auth/SDK/config/PeerTube-модуль не заменяются. Несовпадение текущего production SHA требует отдельного diff перед релизом.

## Ошибки запуска: важное ограничение

До внешнего запроса резерв имеет TTL 2 минуты; после hold он бессрочно удерживает единственный слот до подтверждения результата. Подтверждённый отказ компенсируется stop NEW Egress → удаление provisional видео → освобождение резерва. При неизвестном результате create/commit/stop возвращается reconciliation_required, а потенциально работающий ресурс НЕ удаляется вслепую.

Это не автоматический reconciler. Возможна ручная разблокировка после потери ответа. Но повторные allocation блокируются, резерв виден в проверочном SQL и max_full_hd_live остаётся 1. Нельзя выдавать TTL/maintenance window за гарантию остановки внешнего Egress. Процедура сверки — deployment.md.

## Изменённые файлы

Frontend:
- src/_front/views/StreamsPage.vue
- src/_front/components/StreamQualityField.vue
- src/_front/streams/streamQualityAccess.js (новый)

SQL:
- supabase/migrations/pending_stream_full_hd_test.sql
- supabase/migrations/verify_stream_full_hd_test.sql
- supabase/migrations/pending_stream_full_hd_test_rollback.sql

Серверный кандидат в этом каталоге:
- orchestrator/src/db.mjs
- orchestrator/src/server.mjs
- livekit.mjs/videoQuality.mjs — неизменённый контекст, не обязательные файлы замены.

Тесты:
- tests/full-hd-test.unit.mjs
- tests/full-hd-test.orchestrator.mjs
- tests/full-hd-test.integration.py
- tests/full-hd-test.browser.mjs

Инструкции: deployment.md, assign-grant.sql, revoke-grant.sql. Изолированные результаты и хеши — results/ и task-files-sha256.json. frontend.diff содержит только изменения задачи относительно снимка начала; его применимость проверена на текущем production main в отдельной копии. Сам патч не является full diff всех незавершённых локальных задач.

## Статус

GO к review/согласованию внедрения этого кандидата. NO-GO к заявлению о подтверждённой end-to-end 1080p: эта медиа-проверка ещё не проводилась. Для production-test нужны отдельно разрешённые SQL/deploy, назначенный stream/owner, проверка исходного разрешения PeerTube и камера/совместимый источник 1080p30. Глобальное включение Full HD не требуется и не предлагается.
