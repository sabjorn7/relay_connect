# Результаты локальных проверок

| Сценарий | Результат |
|---|---|
| Полная /club, реальные WeWeb components, Chrome/WebKit, 390/1280 px | PASS 4 конфигурации |
| История, текст, удаление своего сообщения, photo popup, scroll | PASS |
| Отправка приватного PDF/изображения и получение signed URL на полной /club | PASS Chrome/WebKit desktop/mobile |
| Профиль автора | PASS href по ID; реальная учётная запись не использовалась |
| Файлы: gate off, RPC error/retry, без повторного upload, logout clears | PASS Chrome/WebKit |
| Native voice → shared encoder/player → send | PASS Chrome, синтетический аудиопоток |
| Попытка записи в WebKit | FAIL данного окружения: NotAllowedError; успешная Safari-запись NOT TESTED |
| Физический Safari/iPhone/Android микрофон | NOT TESTED |
| Club UI/push unit suites | PASS 13 |
| Attachment helper | PASS: disabled/network/session switch/private retry/TTL/path |
| Существующая web-push-send logic | PASS 24 |
| Existing serviceworker: оба generic payload, icon/badge, click /club | PASS с синтетическими push events |
| Реальный push-provider → PWA устройство | NOT TESTED, никаких реальных отправок |
| Минимальный SQL на PostgreSQL 15 (Unix socket, synthetic data) | PASS: compile, gate, upload/send/idempotence, чужой доступ к attachment отклонён, Storage guards, post publication, edit/reset/reschedule без повторного enqueue, disable |
| Изменения RLS клубных таблиц/подписок | Отсутствуют; local assertion PASS |
| Групповой чат, Chrome/WebKit desktop/mobile | PASS 12; исходник ChatsPage не изменён |
| Vite без postbuild | PASS exit 0 |

Браузеры загружают локальную сборку, все API-моки синтетические, внешняя сеть перехвачена. SQL стенд подменяет storage.objects и net.http_post, поэтому это не тест реального Storage HTTP или провайдера push. Успешная компиляция не подменяет отсутствующие проверки.

## Повторить

На изолированной копии базы применить changes.diff и page/apply-page.py, скопировать tests в tests приложения. server SQL расположить в reviews/2026-11-24-club-finish/server/; production DSN не использовать.

```sh
node tests/club-existing.unit.mjs
node tests/club-attachments.unit.mjs
node tests/club-push-worker.unit.mjs
node supabase/functions/web-push-send/logic.test.mjs
./node_modules/.bin/vite build -l warn
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/club-full.browser.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/club-attachments.browser.mjs
python3 tests/club-minimal-server.local.py
```

Playwright/PostgreSQL должны быть установлены отдельно; зависимости проекта не менялись. Regression group test содержит путь текущего локального Playwright — заменить только этот import перед повтором. В тесте voice есть диагностическое instrumenting локальной сборки для имени ошибки; в продуктовый код оно не входит. NOT TESTED не считается PASS.
