# Изолированный кандидат — не для деплоя

- [Результат и ограничения](REPORT.md)
- [Точный SDK diff](sdk-terminal-cleanup.proposed.diff)
- [SHA diff/исходников](sdk-terminal-cleanup.proposed.json)
- [Результаты](results/)
- [Тесты](tests/)

Локальная среда сохранена в `/private/tmp/mg-auth-sdk-verify-20261124`: `sdk/` — исходники и сборка, `candidate/` — отдельный MeetGuru, `tools/` — компилятор. Не копировать локальный package-lock в production.

Для повторения использовать отдельную копию кандидата MeetGuru из пакета `9980fa1`, npm SDK 2.119.2 и точный приложенный diff. Проверить SHA исходника из manifest до применения. Собирать SDK в отдельном исходном каталоге, не редактировать установленный node_modules. Конфиги TypeScript взяты из `supabase/supabase-js` тега `v2.119.2`: `tsconfig.base.json`, `packages/core/auth-js/tsconfig.json` и `tsconfig.module.json`. Исправить только относительный extends для отдельного каталога. Компилятор TypeScript 5.8.3, @types/node 20.19.9, tslib 2.8.1. Выполнить `npm run build`, затем `npm pack --ignore-scripts` с отдельным npm cache. В отдельном кандидате установить override auth-js на абсолютный путь полученного tarball и выполнить `npm install --ignore-scripts`. Не публиковать tarball в registry.

Скопировать tests вместе с fixtures в tests отдельного кандидата. Тестовые импорты GoTrueClient используют экспорт установленного @supabase/supabase-js, чтобы проверять именно вложенную patched-зависимость приложения.

```sh
node tests/auth-terminal-commit-gap.mjs
node tests/auth-terminal-race.mjs
node tests/auth-replacement-adapter-compat.mjs
node tests/auth-stale-event.mjs
node tests/auth-terminal-gap.browser.mjs
node tests/auth-session-recovery.browser.mjs
MODES=stale-event node tests/auth-session-recovery.browser.mjs
node tests/auth-email.browser.mjs
node tests/unified-checkout.browser.mjs
./node_modules/.bin/vite build -l warn
```

Браузерные harness требуют уже установленный Playwright и Chrome/WebKit. В текущем окружении Playwright доступен в `/private/tmp/mg-n8n-isolated-20261123.JTawGr/node_modules/playwright/index.mjs`; новые инструменты в рабочий проект не добавлялись.

Кандидат создан git archive, поэтому начальный Vite build остановился из-за отсутствия git metadata. Повтор выполнен с GIT_DIR исходного candidate worktree только для чтения rev-parse HEAD в vite.config.js. Завершение 0, build.log пустой. Postbuild не запускался. Для самостоятельного повторения предпочтительна отдельная git-копия с тем же HEAD.
