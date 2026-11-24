# MeetGuru Auth — единый релизный кандидат

**READY к отдельному решению владельца о публикации. Production-публикация не разрешена и не выполнялась.**

Основа — проверенный кандидат 0f2d50c. Текущий GitHub main и release SHA в публичном HTML совпали: `e062265304688b744b36b8f2ea021b8270c641ad`. HTML ответил 200, основной ресурс `/assets/main-COR6BoJY.js`. Это проверка версии frontend, не утверждение о состоянии backend.

Локальная ветка `release/auth-session-20261124` подготовлена в отдельной копии. В основной проект ничего не внесено, commit/push ветки MeetGuru не выполнялись. Публикуется только этот пакет в relay_connect/outbox.

## Состав

- [Единый binary-safe diff относительно production-базы](release.diff).
- [Обратный diff](rollback.diff), проверен на точном состоянии кандидата.
- [Все 29 изменяемых файлов](changed-files.txt).
- [Закреплённый SDK](vendor/auth-js-2.119.2-meetguru.1.tgz), [manifest](vendor/auth-js/manifest.json), [объединённый source patch](vendor/auth-js/meetguru.patch), [скрипт воспроизведения](vendor/auth-js/rebuild.py).
- [Результаты](results/summary.json), [порядок публикации и отката](DEPLOYMENT.md).

Product-код — только authRecovery, confirmedSession, headerAccount и wwPlugin из ранее проверенного кандидата. Сохраняются namespace auth-v2, сериализация envelope, отдельные cookies, защита устаревших событий/ответов и исправления SDK terminal cleanup, Web Locks/logout и superseded refresh. Новая функциональность не добавлялась. Платёжные секции headerAccount не изменялись.

Остальные изменения — package.json/package-lock, одна строка Node в Deploy App, 10 тестовых файлов и 12 vendor-файлов. В тестах абсолютные пути к прежним временным каталогам заменены параметрами окружения; сценарии и критерии не ослаблены. PLAYWRIGHT_MODULE, LEGACY_AUTH_MODULE, LEGACY_HEADER_MODULE и при необходимости CHROME_EXECUTABLE задаются оператором тестов. Дополнительные test runners в зависимости приложения не добавлялись.

## Воспроизводимость

Override: `@supabase/auth-js = file:vendor/auth-js-2.119.2-meetguru.1.tgz`.

Версия SDK: `2.119.2-meetguru.1`. SHA-256 vendor tarball:

```text
8875d3ae22ea6eb3ab7426b66f60c0ed09d6e6da6774f43e9e790db3be5e2964
```

Две независимые сборки SDK из included upstream archive и объединённого patch дали **побайтово одинаковый архив**. Toolchain закреплён отдельным lockfile: TypeScript 5.8.3, @types/node 20.19.9, tslib 2.8.1. Node 24.14.0, npm 11.9.0. Source SHA до/после, patch SHA, конфигурации и integrity записаны в manifest. Upstream MIT license сохранена.

Две чистые установки с разными npm caches выполнили обычный `npm ci` (без ignore-scripts), обе exit 0. Сравнены 375 установленных package records и 198 файлов SDK — идентичны. Относительный file override не требует прежних каталогов. Никаких ручных изменений node_modules/postinstall-патчей.

Сравнение lockfile с production: удалена только старая запись auth-js 2.70.0 и добавлена закреплённая 2.119.2-meetguru.1 под supabase-js. **Все остальные записи lockfile совпадают полностью**, включая версии и integrity. Supabase-js остаётся 2.50.3.

## Итоговые проверки после упаковки

| Проверка | Результат |
|---|---|
| Два независимых SDK rebuild | PASS, одинаковый SHA |
| npm ci в двух чистых каталогах | PASS / PASS |
| Сравнение установленного SDK и прочих зависимостей | PASS |
| 429: по 5 запусков Chrome/WebKit | PASS 10; восстановление 432–455 мс, ровно 429 + 200 |
| Auth: 400/401/409/429/500, несколько вкладок, смена пользователя, logout, offline/online, stale SIGNED_OUT, synthetic sleep | PASS 30, Chrome/WebKit |
| Старый SDK, envelope/cookies, logout offline/500/no-Web-Locks | PASS 12, Chrome/WebKit |
| Terminal cleanup interleavings 400/401 | PASS 16, Chrome/WebKit |
| Email/registration/confirmation/VK | PASS 26, Chrome |
| Checkout с синтетическим провайдером | PASS 12, Chrome |
| Node critical/unit tests | PASS |
| Vite в двух чистых каталогах | PASS / PASS |
| Применение release.diff и rollback.diff | PASS, точное восстановление tracked base |

Всего **106 браузерных проверок PASS**. Критических FAIL после упаковки нет. BEFORE/AFTER самого SDK исправления и предшествующие результаты находятся в 0f2d50c; здесь тесты повторены на vendor-пакете после чистого npm ci.

Vite запускался без npm postbuild: postbuild обращается к production и не был частью разрешённых локальных проверок. Build использовал GIT_DIR отдельной release-копии только для чтения release metadata. Полный GitHub Actions не запускался; Node 24.14.0 проверен локально. CI в основной ветке остаётся прежним до отдельного разрешения.

## Последствия и ограничения для решения владельца

- Новый namespace/envelope требует повторного входа. Старые refresh tokens не импортируются. Никаких серверных сессий миграция не удаляет.
- Старые вкладки не распознают новые records/cookies проверенным scanner-ом. Это не шифрование и не защита от произвольного кода того же origin или localStorage.clear.
- Намеренный серверный global logout того же пользователя может отзывать другие сессии. Это штатная семантика, не обходится исправлением.
- Без Web Locks безопасный persistent refresh/запись не подменяются небезопасным fallback; logout проверен. Полноценный вход в браузерах без этого API не объявлен поддержанным.
- NOT TESTED: физический PWA после реального длительного сна; реальные провайдеры Auth/VK; реальные платежи; backend-потребители cookies вне репозитория. Sleep и no-Web-Locks эмулируются, API/provider — локальные моки. Отдельные email/VK/checkout suites запускались в Chrome, не WebKit.
- SDK является закреплённым сопровождаемым source fork. Любой следующий SDK upgrade требует повторной проверки patch и Auth-матрицы.
- Откат к старому frontend не переносит новые токены обратно и может восстановить прежнюю legacy-сессию, если она сохранилась. Детали и обязательная проверка аккаунта приведены в DEPLOYMENT.md; обратный diff откатывает код, не browser storage.

READY означает готовность пакета к вашему решению с указанными ограничениями. Публикация, merge в main, изменение основного CI и production smoke требуют отдельного согласования. Никаких SQL/RLS, backend, инфраструктурных или платёжных изменений в составе нет.
