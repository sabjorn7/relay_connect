# Auth session candidate — BLOCKED

**Не применять в production и не запускать Deploy App.**

[Отчёт](REPORT.txt) · [Полный diff](candidate-NOT-FOR-DEPLOY.diff) · [Результаты](results/summary.json)

База MeetGuru: `e062265304688b744b36b8f2ea021b8270c641ad`.

Пакет содержит отклонённый кандидат. Известный FAIL: `auth-terminal-commit-gap.mjs` для 400/401.

## Локальное воспроизведение

1. Создать чистый checkout базы. Проверить `git apply --check /path/candidate-NOT-FOR-DEPLOY.diff`, затем применить только локально.
2. Скопировать явные файлы из `tests/` пакета в `tests/` checkout. Email/checkout тесты идентичны базе.
3. Выполнить `npm ci --ignore-scripts --no-audit --no-fund` на Node24.
4. Запустить:

```sh
node tests/auth-terminal-race.mjs
node tests/auth-stale-event.mjs
node tests/auth-terminal-commit-gap.mjs  # ожидаемый FAIL, exit 1
node tests/auth-original-adapter-compat.mjs  # ещё один ожидаемый FAIL
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/auth-session-recovery.browser.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs MODES=stale-event node tests/auth-session-recovery.browser.mjs
node tests/auth-email.browser.mjs
node tests/unified-checkout.browser.mjs
./node_modules/.bin/vite build -l warn
```

Playwright не добавлен в зависимости MeetGuru. Использована существующая локальная установка Playwright, Chrome и WebKit cache. Для другого компьютера задайте `PLAYWRIGHT_MODULE`; путь Chrome рассчитан на macOS. Браузерные тесты перехватывают внешние запросы. Не запускать обычный dev server с production API ради проверки.

Полный diff применяется к main; incremental — только сравнение с прежней локальной работой, **не применять оба**. Rollback и ограничения — в отчёте. Серверного установщика нет.
