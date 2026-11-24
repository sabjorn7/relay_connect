# Refresh 429 — локальная проверка SDK: PASS

**Критерий восстановления выполнен. Кандидат готов к следующему этапу — воспроизводимой упаковке и проверке чистой сборки. Это не согласование production-релиза.**

Основа приложения: ca9bb1f; разрешённый SDK-diff из 5541a34. Патч применён без изменений поверх прежнего локального auth-js 2.119.2. Новый SDK собран в отдельном каталоге и установлен npm только в новый изолированный кандидат. Product-файлы приложения побайтово совпадают с ca9bb1f; authRecovery, wwPlugin, confirmedSession, envelope и cookies не менялись.

## BEFORE / AFTER

| Браузер | BEFORE | AFTER, пять повторов | HTTP refresh на запуск |
|---|---:|---:|---|
| Chrome | 25 656 мс | 432–437 мс | Ровно 2: один 429, один 200 |
| WebKit | 25 669 мс | 432–457 мс | Ровно 2: один 429, один 200 |

BEFORE заново воспроизведён на прежнем SDK. AFTER — по пять повторов с 20-секундным таймаутом. Обе вкладки подтверждают актуальную A без reload; новая сессия сохраняется. Прежние семь повторных попыток старого token внутри backoff больше не удерживают инициализацию. Число сетевых запросов не выросло. Время — от старта тестового документа до подтверждений SDK, локальный mock server, не production-бенчмарк.

Измерения и полные обезличенные трассы находятся в results/before-measurements.json, after-429-measurements.json, before.log и after-429.log. Номер запросной попытки в тесте фиксируется до await задержки, поэтому каждый прогон действительно содержит 429. Нет прежней неоднозначности с двумя ответами 200.

## Исправление

[Минимальный исходный SDK-diff](sdk-retry-supersession.diff), один GoTrueClient.ts:

- существующий storedAtStart передаётся в `_refreshAccessToken`;
- после backoff и до I/O проверяется, не заменена/удалена ли исходная сессия;
- superseded refresh завершается штатным AuthRefreshDiscardedError;
- discard не запускает terminal cleanup и не кешируется как отказ новой сессии.

Обычные 400/401 по-прежнему обрабатываются серверной проверкой и условной очисткой соответствующей сессии. Commit guard остаётся необходим: проверка перед I/O не атомарна относительно последующих изменений storage. Нет runtime monkey-patch, второго SDK-клиента, новой синхронизации, хранилища или сервисов. Сериализация не изменялась.

## Сборка и изоляция

- SDK CJS: PASS, SDK ESM: PASS, TypeScript 5.8.3, Node 24.14.0.
- Test npm package: `2.119.2-mg.retry-test.1`. Архив хранится локально: `/private/tmp/mg-auth-429-verify-20261124/sdk/supabase-auth-js-2.119.2-mg.retry-test.1.tgz`.
- SHA исходника, собранных CJS/ESM и tarball: results/package-manifest.json. В npm registry пакет не публиковался.
- Новый кандидат: `/private/tmp/mg-auth-429-verify-20261124/candidate`. npm ci использовал прежний lockfile с заменой только записи auth-js. Временная file-ссылка существует только в тестовом кандидате и не является способом поставки production-зависимости.
- Оригинальный SDK сохранил SHA `90d5032b62c466b6931f126ee2a07d4f35ffa5f07263cddcbd5821b1f12dff45`; новый исходник — `5124b7ce42938c73ac1f7955ad939a15ca86992efd1f7ce4de19e5d79c722a14`.
- Vite build: PASS, exit 0. Использовался `vite build -l warn`, без npm postbuild и его production-запросов. Пустой vite-build.log соответствует успешному тихому запуску. GIT_DIR исходного candidate worktree передан только для чтения build metadata через rev-parse, исходное дерево не изменялось.
- Production, CI, основной проект, SQL/RLS и платёжные механизмы не менялись. Deploy App не запускался.

## PASS / FAIL / NOT TESTED

| Набор | Результат |
|---|---|
| Гарантированный 429, обе вкладки, 5 повторов каждого движка | PASS 10 |
| Auth Chrome/WebKit: 200/400/401/409/429/500, offline/online, две вкладки, восстановление view, login/logout во время refresh, lock-15s, synthetic sleep-week, stale SIGNED_OUT | PASS 30 |
| Старые вкладки, подтверждённый header, logout/500/offline/no-Web-Locks | PASS 12 |
| Браузерный terminal commit gap: 400/401, два момента interleaving, смена пользователя/токена того же пользователя, logout | PASS 16 |
| Email/password, регистрация, confirmation, синтетические VK ответы | PASS 26, Chrome |
| Существующий checkout с mock API/provider | PASS 12, Chrome |
| Node terminal gap и terminal race 400/401, logout replacement adapter, stale SIGNED_OUT | PASS |
| Envelope/Unicode, no-migration, PKCE pass-through | PASS |
| SDK CJS/ESM и Vite | PASS |

Итого 106 браузерных проверок PASS, включая 10 повторов 429. Критических FAIL после патча не обнаружено. BEFORE демонстрирует нарушение прежнего 20-секундного критерия, но последующее самостоятельное восстановление примерно через 25,6 с; бесконечное зависание не заявляется.

NOT TESTED: реальные серверы Auth/VK и платежи, физический iPhone/PWA после длительного сна, серверный global logout в production. Sleep-week моделирует истёкший token; no-Web-Locks эмулируется отсутствием API и проверяет logout, не успешную авторизацию неподдерживаемого браузера. lock-15s держит прежнюю SDK-блокировку, не заменяет испытание всех отказов новой write-lock. Сценарии email/VK и checkout используют реальные компоненты/локальные fixtures, но не полный production backend. Эти ограничения не скрываются общим числом PASS.

## Влияние и следующий этап

Меняется только завершение устаревшего refresh. Временная ошибка текущей сессии сохраняет прежние ограниченные повторы; новая сессия должна подтверждаться обычным getSession. Logout и смена пользователя не восстанавливают прежний token. Патч исходников зависимости остаётся сопровождаемым нами изменением, поэтому каждый последующий SDK upgrade требует пересмотра.

Можно переходить к закреплению артефакта SDK и чистым установкам в отдельных каталогах. Воспроизводимое production-vendoring и CI Node 20 → поддерживаемая версия ещё не применены. CI и публикация требуют отдельного согласования. Разрешение на тестирование не использовано для выпуска.

Ранее согласованные envelope/namespace означают повторный вход пользователей, без переноса старых refresh tokens. Изоляция от legacy scanner не является шифрованием. Намеренный серверный global logout того же пользователя может штатно отозвать другие его сессии.

## Повторение и откат

Применить приложенный diff к отдельной копии исходника с указанным base SHA. Использовать прежние TypeScript-конфигурации локального SDK из 03e44e2, выполнить npm run build и npm pack --ignore-scripts с отдельным cache. В отдельном ca9bb1f-кандидате заменить только override/lock entry auth-js на этот test tarball, выполнить npm ci --ignore-scripts. Не редактировать node_modules вручную. Скопировать tests и fixtures из пакета; PLAYWRIGHT_MODULE задаёт локальный Playwright, Chrome расположен в стандартном Applications path. Старые SDK/helper paths используются только локальными fixtures старой вкладки.

```sh
MODES=two-tabs-error REPEATS=5 node tests/auth-session-recovery.browser.mjs
node tests/auth-terminal-commit-gap.mjs
node tests/auth-terminal-race.mjs
node tests/auth-replacement-adapter-compat.mjs
node tests/auth-stale-event.mjs
node tests/auth-consumers.browser.mjs
node tests/auth-terminal-gap.browser.mjs
MODES=200,400,401,409,429,500,offline,two-tabs,two-tabs-error,view-recovery,login-during-refresh,logout-during-refresh,lock-15s,sleep-week,stale-event node tests/auth-session-recovery.browser.mjs
node tests/auth-email.browser.mjs
node tests/unified-checkout.browser.mjs
```

В тесте recovery включена обезличенная instrumentation только fixture; product diagnostic transport не менялся. Локальный откат — использовать прежний сохранённый кандидат/SDK, без изменений production. Установочных или deploy-команд в пакете нет.
