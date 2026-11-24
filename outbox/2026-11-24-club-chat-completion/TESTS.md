# Проверки

Все записи, заказы/подписки и сообщения в тестах синтетические. Браузерные API мокированы, внешняя сеть блокируется. Реальные WeWeb wrappers, router, popup и workflows используются в full-club.

| Проверка | Результат |
|---|---|
| Полная /club, Chrome/WebKit × 390/1280 | PASS 4: история 16 сообщений, отправка, удаление, просмотр фото, прокрутка вниз/вверх, без pageerror |
| Исходный строгий тест scroll | FAIL: нижний край не достигался после async layout; исправлен scoped observer, итог PASS |
| Файлы: gate-off, приватный bucket, RPC error/retry same UUID, logout clears | PASS Chrome + WebKit |
| Native MediaRecorder + shared MP3 + отправка синтетического голоса | PASS Chrome |
| Native voice WebKit | NOT TESTED полностью: локальный WebKit отклонил синтетический audio stream, UI корректно показал ошибку микрофона; успешная запись не подтверждена |
| Реальные микрофон, iPhone/Android, фоновый PWA push | NOT TESTED |
| Helper файлов: gate/network error, смена сессии, no owner input, private retry, signed URL TTL, invalid path | PASS |
| Club view/push unit suites | PASS 13 |
| Существующая web-push-send logic | PASS 24 |
| Существующая preview logic | PASS 57 |
| Групповой чат: Chrome/WebKit, свои/чужие, delayed/failing profiles, личный чат, ссылки/файл/audio, timezone | PASS 12; ChatsPage не менялся |
| Изолированный PostgreSQL 15: реальный draft SQL | PASS: компиляция, disabled gates, untrusted membership gate, upload/send, idempotency, outsider/owner spoof denial, restrictive Storage против старой широкой политики, publish transition/dedup, disable |
| Реальный Supabase Storage HTTP и pg_net HTTP → Edge → push provider | NOT TESTED; SQL использует локальные substitutes net.http_post и storage.objects |
| Production RLS/member moderation/likes/comments совместимость | NOT TESTED; явный prerequisite перед применением SQL |
| Vite без postbuild | PASS, exit 0 |
| Diff apply-check + page patch roundtrip | PASS |

Vite build не является проверкой production backend. npm postbuild не запускался. SQL тест не доказывает совместимость реальных действующих политик: серверный пакет требует отдельного согласования.

## Повторение

На отдельной копии базы применить frontend diff и page script; server/edge.diff нужен для unit suites. Тесты скопировать в tests/. Зависимости брать из проекта; Playwright отдельно уже должен быть установлен (не добавлен в package.json).

```sh
node tests/club-existing.unit.mjs
node tests/club-attachments.unit.mjs
node supabase/functions/web-push-send/logic.test.mjs
node tests/chat-previews.unit.mjs
./node_modules/.bin/vite build -l warn
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/club-full.browser.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/club-attachments.browser.mjs
python3 tests/club-server.local.py
```

Для SQL-теста скопировать server/PROPOSED.sql и DISABLE.sql в `reviews/2026-11-24-club-completion/server/` изолированного кандидата.

`club-server.local.py` требует установленного локального PostgreSQL (pg_config), создаёт отдельный temp data dir, слушает только Unix socket и останавливается в finally. Не запускать на production.
В копии regression-group test путь импорта Playwright соответствует текущему локальному стенду; перед повтором заменить только этот путь. Скриншоты содержат исключительно синтетические данные.
