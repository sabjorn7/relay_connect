# MeetGuru Splash v4: интеграционная проверка, 4 ноября 2026

**29 PASS, 2 BLOCKED, 0 FAIL после отдельного повтора гостевого редиректа.** Проверено настоящее приложение: main.js, App.vue, Vue Router, реальные страницы, runtime WeWeb и настоящий Service Worker. Компоненты страниц не подменялись тестовыми.

## Окружение и изоляция

Временная копия проекта собрана прямым Vite build без npm postbuild. Только в копии заменены plugin endpoints и credentials на loopback и фиктивные значения; реальные .env не копировались. Chrome направлен через обязательный локальный HTTP/HTTPS proxy без внешнего forwarding: все CONNECT завершаются локальным TLS mock. Неизвестные сервисы получают локальный отказ, WebSocket upgrades блокируются. Внешний DNS, QUIC и непроксируемый WebRTC отключены; WebRTC API запрещён до загрузки приложения. Preflight проверил внешний тестовый HTTPS-домен и запрет WebRTC до запуска приложения.

За полный прогон: 499 CONNECT, 396 локальных TLS mock запросов, externalForwarded=0. Production API и платежи не вызывались. Auth-состояния и данные синтетические; реальные операции записи не выполнялись. Диагностические запросы моделировались локально без сохранения тел. Виртуальные часы проверяют функциональность, а не реальные скорости сети.

SHA-256 защищённых исходников, конфигурации и env совпали до и после прогона. Код приложения не изменён. Существующие локальные изменения сохранены. Добавлен tests/boot-splash.integration.mjs и этот отчёт с results.json. Staging пуст, commit/push/deploy отсутствуют.

## Результаты по каждому тесту

В маршрутных сценариях удерживался настоящий entry JS: проверены ранний Splash, скрытый #app и первый paint. Затем разрешалась загрузка и проверялось раскрытие, а также безопасное действие (фокус поля, переключение видимости пароля/фильтра, меню аккаунта, навигация или выход со страницы звонка).

Фактические маршруты: / → /all_course, /all_course, /course/integration-course, /login, /registration, /profile, /my_courses, /courses_manage, /streams, /streams/call, /dashboard, /superadmin, /feedback, /reset_pw, /superadmin-legacy. Для защищённых страниц использованы фиктивные viewer/creator/admin. Query со служебными фиктивными значениями опущены.

| Тест | Итог | Причина / результат |
|---|---|---|
| isolation-preflight | PASS | External HTTPS locally terminated; WebRTC denied; no upstream connector exists |
| guest-home | PASS | Real app mounted, route UI revealed and user action accepted |
| catalog | PASS | Real app mounted, route UI revealed and user action accepted |
| course | PASS | Real app mounted, route UI revealed and user action accepted |
| login | PASS | Real app mounted, route UI revealed and user action accepted |
| registration | PASS | Real app mounted, route UI revealed and user action accepted |
| profile | PASS | Real app mounted, route UI revealed and user action accepted |
| my-course | PASS | Real app mounted, route UI revealed and user action accepted |
| manage-courses | PASS | Real app mounted, route UI revealed and user action accepted |
| streams | PASS | Real app mounted, route UI revealed and user action accepted |
| stream-call | PASS | Real app mounted, route UI revealed and user action accepted |
| dashboard | PASS | Real app mounted, route UI revealed and user action accepted |
| superadmin | PASS | Real app mounted, route UI revealed and user action accepted |
| feedback | PASS | Real app mounted, route UI revealed and user action accepted |
| reset-password | PASS | Real app mounted, route UI revealed and user action accepted |
| reset-guest-redirect | PASS | Real app mounted, route UI revealed and user action accepted |
| legacy-admin | BLOCKED | Startup PASS; safe action not identified with current mock data |
| cold-and-warm-cache | PASS | Cold app startup and same-context warm reopen passed with real SW |
| slow-css-late-recovery | PASS | Held CSS, visible retry, then late CSS applied and real interface revealed |
| slow-js-late-recovery | PASS | Real entry/dependencies held, timeout shown, late JS boot completed |
| css-empty-manual-recovery | PASS | Broken critical CSS repaired by explicit user click without document reload |
| css-404-manual-recovery | PASS | Broken critical CSS repaired by explicit user click without document reload |
| cache-storage-poisoned-css | PASS | Actual SW served empty cached CSS; targeted repair preserved unrelated entry and document |
| missing-css-links-once | PASS | Explicit HTML reload recovered missing critical link |
| missing-css-links-always | PASS | Persistent missing CSS leaves manual retry; no automatic reload loop |
| missing-main-js-manual-recovery | PASS | Missing real entry JS leaves manual recovery; one explicit reload starts the application |
| stalled-raf | PASS | Real application revealed via bounded timer fallback when requestAnimationFrame never calls back |
| legacy-data-unavailable-recovery | PASS | Real legacy beforeEnter exhausted data retries, showed existing load error, and recovered after explicit click |
| hung-api | PASS | Real catalog API remained unanswered; native page loader visible while global splash released |
| background-and-return | PASS | Native tab hiding and return recovered held CSS/rAF without duplicate boot events |
| bfcache-observation | BLOCKED | Normal back navigation passed; browser did not restore from BFCache, so BFCache path untested |

## Уточнения и ограничения

- /reset_pw проверен с фиктивным recovery token и локальным get_otp_status success. Без токена штатный workflow переводит на /registration. В полном прогоне assertion один раз проверил маршрут раньше завершения этого workflow; после добавления ожидания конечного перехода отдельный повтор PASS. Исходное расхождение не считается доказанной ошибкой приложения. Код маршрутизации не менялся.
- /superadmin-legacy: запуск и раскрытие PASS; взаимодействие BLOCKED. С текущими моками не найден видимый native anchor/button/input/role=button или известный безопасный legacy navigation workflow. Нужен более полный синтетический набор legacy-данных и проверяемый безопасный элемент. Бизнес-операции администрирования не тестировались.
- /streams/call проверен без валидной ссылки: штатное сообщение и безопасный выход. Реальные медиасоединения намеренно запрещены.
- При зависшем API каталога отображался штатный loader после скрытия Splash. При недоступности legacy JSON после штатных retry появлялся существующий mg-load-error; явный повтор восстанавливал приложение.
- Повреждение CSS проверено с настоящим SW и Cache Storage, с очищенным HTTP cache, чтобы memory cache не маскировал повреждение. Ручное адресное восстановление не перезагружало документ и сохраняло постороннюю запись кеша. Отсутствующая CSS-ссылка вызывала только явную перезагрузку; при повторно плохом HTML автоматического цикла нет.
- Фон проверен настоящим переключением активной вкладки, не подменой visibilityState. Зависший requestAnimationFrame проверен отдельно с настоящим приложением и timer fallback.
- BFCache BLOCKED: обычный возврат назад PASS, но pageshow.persisted=false. Реальное восстановление из BFCache не проверено.

## Диагностика

В проверенных поздних загрузках JS/CSS и адресном восстановлении — по одному boot_timeout и boot_late на документ. Дубли не обнаружены; после ручной перезагрузки учитывался новый документ. Контрольные фиктивные query/session/recovery значения не попадали в диагностические URL. Это не полный аудит всех логов приложения. В проверенных сценариях не обнаружены FOUC, автоматические reload-циклы или скрытое приложение без сообщения/ручного восстановления.

## Safari и ручная проверка iPhone

Safari 26.3.1 и safaridriver установлены. Проверенно изолированная Safari-сессия не настроена; браузер не запускался. Первый запуск, повторное открытие, фон, BFCache, CSS preload, SVG getBBox, inert, фокус и retry в Safari: BLOCKED. Результаты Chrome не являются Safari-тестами.

Короткий сценарий после подготовки доступного телефону изолированного mock-origin с блокировкой внешнего трафика:

1. Холодно открыть каталог, вход и legacy: Splash сразу, затем оформленный интерфейс; проверить фокус, inert и клики.
2. Открыть повторно с SW/кешем; уйти в фон, вернуться; перейти назад/вперёд и записать pageshow.persisted.
3. На mock-сервере задержать CSS/JS более 15 секунд: сообщение и retry без FOUC; разрешить ответ и проверить позднее раскрытие.
4. Вернуть пустой CSS, исправить ответ и нажать retry; повторить с отсутствующей critical CSS-ссылкой. Проверить отсутствие циклов.
5. Проверить SVG-ссылку legacy и единичность boot_timeout/boot_late.

Текущий loopback-сервер телефону недоступен; нужен отдельно подготовленный тестовый origin/прокси. Настройки Safari/OS не менялись. Production для инъекции отказов не использовать.

## Границы вывода и воспроизведение

Подтверждённых дефектов Splash в выполненных сценариях нет. Production данные/авторизация, все legacy workflows, полноценные трансляции, реальные Safari/BFCache и бизнес-операции вне подтверждённого покрытия. Восстановимая ошибка Vue, отмена навигации и SVG edge cases ранее покрывались изолированными v4 тестами; в настоящие компоненты этого прогона такие ошибки специально не инжектировались.

Следующий шаг: Safari/iPhone в изолированном окружении и безопасное действие legacy-admin. Эти тесты сами по себе не подтверждают готовность к production.

Воспроизведение: node tests/boot-splash.integration.mjs. Требуются текущие зависимости, Chrome и разрешение локальных серверов/браузера. Новые зависимости не устанавливались. Фокусированный повтор: --only=reset-guest-redirect. node --check tests/boot-splash.integration.mjs и git diff --check прошли.
