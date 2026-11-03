# MeetGuru Splash Screen v3 — локальный технический пакет

База полного changes.diff: `fbfd2e3b81420cac60b5981fcba6616f31e6b8fa`.
Это полный патч v1+v2+v3 от исходной локальной базы, НЕ delta к v2.
Предыдущие reviews/2026-11-03-boot-splash/ и ...-v2/ не изменены.
Новых commit, push, публикаций в relay_connect и deploy в этом этапе нет.
Видимый запрос пользователя обрывался на «Не заявляй о прохождении реальных»;
работа выполнена по полученным требованиям 1–3, без вывода о полном E2E.

## Исправления v3

### Контракт готовности и реальные корни

В App.vue сохранён root marker data-mg-boot-shell, добавлены два скрытых
стабильных DOM-якоря вокруг router-view: data-mg-boot-route-start/end.
Они НЕ создают wrapper и не меняют layout/маршруты. Выборка ограничена реальным
DOM страницы между ними: общий header/footer, чужие dialogs, Splash и один
скрытый marker не могут выдать пустую страницу за готовую.

bootReadiness.inspectBootInterface возвращает отдельно shellRendered,
routeRendered, uiVisible и pageState. pageState='visible' означает отображаемую
поверхность, НЕ завершение API. Явный data-mg-boot-state позволяет loading,
content и error. В AllCoursesPage этот атрибут связан с существующим loading;
данные, порядок загрузки и бизнес-логика не меняются.

Проверяются фактический текст (Range.getClientRects), controls и загруженные
images/video. Рекурсивный обход не требует прямого ребёнка #app с box:
Fragment, bare text и вложенный display:contents поддержаны. Пустой div с
высотой, скрытая страница, одно chrome или root marker не проходят.
Учитываются display:none, реальная visibility, opacity и content-visibility;
box-only opacity/content-visibility не трактуются как скрытие на display:contents.

Для проверки реальной visibility временно поднимается ТОЛЬКО унаследованная
visibility самого Splash gate через --mg-boot-probe-visibility на #app.
Это синхронная проверка; значение и priority возвращаются в finally до конца
JS-задачи. Opacity:0, inert, aria-hidden и блокировка взаимодействий сохраняются;
обычный gate остаётся visibility:hidden. Стили самой страницы visibility:hidden
не обходятся. Chrome проверяет возврат probe и позднее раскрытие после реального
visibility:visible. Для iPhone Safari необходима ручная проверка.

Для Teleport-only интерфейса предусмотрен registerBootSurface(actualElement):
он привязан к текущему #app через ownerDocument и требует disposer на unmount.
Не ищем произвольный видимый DOM в body. Подтверждены реальный Teleport fixture,
отказ доверять незарегистрированному body DOM и disposer. В проверенных собственных
views/chrome Teleport-only корней не обнаружено. Будущая страница, у которой
весь UI находится вне #app, должна явно зарегистрировать эту поверхность.

### Начальная навигация и устаревшие promises

State хранится в WeakMap на конкретный Router, sticky navigationFailed убран.
Используются публичные isNavigationFailure/NavigationFailureType и afterEach;
новые guards, маршруты, auth-решения и автоматические переходы НЕ добавлены.
Existing guest router.replace('/all_course') только наблюдается с передачей router.

- Успех: commit revision растёт; старые failures снимаются.
- Duplicate: не считается ошибкой, но сам по себе не очищает чужую окончательную ошибку.
- Redirect: ожидается итоговый результат promise Vue Router, а не код промежуточного redirect.
- Abort/reject tracked попытки: блокировка до следующего успешного commit или ручного retry.
- Cancellation: состояние unresolved/pending, а не необратимая фатальная ошибка.
  Если replacement тоже не завершился успешно, Splash остаётся закрытым;
  штатный watchdog даёт сообщение и кнопку. При untracked неудачном replacement
  публичный статус может оставаться pending до timeout, блокировка сохраняется.
- Новый успешный маршрут освобождает boot от старого promise, даже если старый
  guard никогда не resolve/reject. Ожидается изменение state, не Promise.all старых guards.
- Поздний abort/reject старой попытки не отменяет уже подтверждённый новый маршрут.
- Учтён sync watcher, начавший B после присваивания currentRoute(A), но до afterEach(A):
  snapshot объекта route сохраняет B ожидающим до его собственного завершения.

Проверка Vue render/setup ошибок, CSS marker/cache recovery, timeout/late,
rAF fallback, background/pageshow и mg-load-error из v2 сохранена.
Service Worker, router.js, авторизация и бизнес-операции не изменены.

## Матрица из фактического локального router config

Обозначения: S — статический анализ маршрута/шаблона; T — Chrome рендер
реального SFC template + scoped styles с ПОДСТАВЛЕННЫМ состоянием; R — настоящий
Vue Router memory-history с изолированными components/guards и функцией guest
redirect из App.vue. Ни S, ни T, ни R не являются полным E2E маршрута MeetGuru.
В T НЕ выполняются script/setup страниц, Auth, Supabase, WeWeb init или платежи.
Минимальная fixture-оболочка воспроизводит границы router-view, а не весь App.

| Маршрут из router.js | Компонент / общая шапка | Ожидаемая стартовая поверхность | Выполнено / ограничения |
|---|---|---|---|
| / | HomePage / да | greeting либо текст загрузки курсов; guest -> /all_course | S,T; R и Chrome guest fixture, включая superseded hanging guard. Реальный auth/API не проверен |
| /all_course | AllCoursesPage / да | счётчик/loader, data-mg-boot-state=loading | S,T; локальный API fixture удержан 60 секунд, Splash уже раскрыт, pageState=loading. Реальный load()/Supabase не выполнялись |
| /course/:slug | CoursePage / да | loader при course=null | S,T с отсутствующим course; slug lookup, покупка и API не выполнялись |
| /login | LoginPage / нет | самостоятельная форма | S,T с ready=true, как после собственного nextTick; login/VK/reset не выполнялись |
| /registration | RegistrationPage / нет | самостоятельная форма | S,T с ready=true; signup/webhooks не выполнялись |
| /profile | ProfileEditPage / да | loading/форма профиля | S,T только loading=true; реальный uid/сохранение не проверены |
| /my_courses | MyCoursePage / да | loader приобретённых курсов | S,T только loading=true; доступ/PeerTube не проверены |
| /courses_manage | CoursesManagePage (lazy) / да | loader кабинета автора | S,T; role/access, editor/upload и API не запускались |
| /streams | StreamsPage / да | список с loader | S,T; API, details и video не запускались |
| /streams/call | StreamCallPage (lazy) / нет | «Подключение к эфиру…» | S,T phase=connecting; LiveKit/media/orchestrator не запускались |
| /dashboard | DashboardPage (lazy) / да | «Загрузка панели…» | S,T loading=true; admin/RPC не выполнялись |
| /superadmin | SuperadminPage (lazy) / да | «Загрузка…» | S,T loading=true; admin/модерация/записи не выполнялись |
| /superadmin-legacy | wwPage, forced legacy route / нет | реальные wwSection после pageLoaded | Только S; настоящие WeWeb state/plugins/sections НЕ запускались. Требуется отдельный изолированный E2E |
| /feedback, /reset_pw | wwPage из designInfo / нет | legacy sections/form | Только S; сценарии forms/auth/runtime НЕ проверены |

Static sources: PAGE_OVERRIDES и standalone routes в src/_front/router.js,
CHROME_EXCLUDE в App.vue, исходные templates views/*.vue, wwPage.vue и
wwPageLoadProgress.vue. Старая WeWeb progress bar сама по себе не доказывает
наличия интерфейса. Для legacy подтверждено только предполагаемое поведение:
появление текста/controls/images внутри секций позволит раскрытие; пустая
website-wrapper — нет. Ошибки guard имеют сохранённый mg-load-error с ручным
восстановлением. Успешный реальный запуск legacy не заявляется.

## Реально выполненные проверки

- node tests/boot-splash.unit.mjs — PASS. Все v2 regressions плюс явная DOM boundary,
  fragment text, nested/display:contents, empty UI с chrome, загрузчик,
  Teleport registration/disposal; реальные Router success/duplicate/abort/reject/
  redirect/cancel, late stale abort/reject, never-settling старый guard,
  sync successor guard и восстановление после окончательной ошибки.
- node tests/freezeguard.unit.mjs — PASS.
- node tests/boot-splash.browser.mjs — PASS, 31 сценарий: 19 contract/regression
  fixtures, включая настоящий неизменённый SW + empty CSS cache recovery,
  и 12 T-проверок реальных templates/styles (не E2E).
  Изолированный Chrome профиль, local server, внешние DNS заблокированы.
  Для held CSS проверены FCP/opacity/visibility; CDP virtual time не является
  production benchmark. Обычный CSS не скачивается дважды; explicit recovery
  намеренно делает дополнительный запрос. Полного пользовательского API-трафика нет.
- Vite build -l warn — PASS в отдельной временной копии без .env и npm postbuild;
  исходный dist не затронут. 45 HTML, по одному ожидаемому nonblocking critical CSS.
  Сверены SHA исходников сборки и текущих application source.
- node --check, git diff --check, whitespace новых исходников и целостность
  changes.diff на базовом commit через изолированный временный index — PASS.
  Unified diff допускает пробел в пустой context line; не исправлять такой пробел
  внутри самого artifact как будто это обычный исходник.

## Ограничения и действия перед production

1. Полного E2E настоящих маршрутов MeetGuru не было. Для него необходимы моки
   WeWeb/Auth/API и page data или согласованное тестовое окружение. Нельзя открывать
   обычный dev server и считать его изолированным от production.
2. Legacy runtime, реальная авторизация/roles, ошибки API-скриптов, прямые URL
   с реальной начальной инициализацией, iPhone Safari и native BFCache не проверены.
3. Доказательство видимого DOM — эвристика отображаемого содержимого, а не
   доказательство бизнес-работоспособности, всех пикселей/occlusion/clipping.
   CSS-only/canvas-only UI без распознаваемого содержимого потребует явного
   расширения контрактов. Не объявлять пустые boxes готовыми ради такого случая.
4. UI loader может оставаться долго при зависшем API; это отдельная проблема
   загрузки данных страницы, не повод удерживать глобальный Splash над рабочей
   навигацией. Existing API timeout/error handling не менялось.
5. Проверить Safari: синхронный visibility probe с восстановлением inline style,
   forms/focus/inert, Fragment, display:contents, background/BFCache и CSS recovery.
   Отдельно прогнать legacy с реальными моками. После этого — независимый review;
   production готовность пока не подтверждена.

## Состав полного патча

- src/_front/App.vue
- src/_front/main.js
- src/_front/views/AllCoursesPage.vue
- template.html
- vite.config.js
- scripts/lib/boot-html.mjs
- src/_front/chrome/bootReadiness.js
- tests/boot-splash.unit.mjs
- tests/boot-splash.browser.mjs

SECURITY_FINDINGS.md и прочие посторонние изменения исключены.

## SHA-256

- `src/_front/App.vue`: `e1fb258bee9cd5a9a76cb30a644fa59eaf264f867d3e72826e84d846573ad95d`
- `src/_front/main.js`: `63c315a1f3202ce3c8dd2c588f329cb5c8d15967145e8b5fbb8f655f9489b124`
- `src/_front/views/AllCoursesPage.vue`: `d07cd24d27bcbbf8d14a3793c01f08a04d24b4700ce98582efa0995c78a957e5`
- `template.html`: `accc96277f03db94552e884965f97df7d24db6bac66ffb5b4251e25805be1e8e`
- `vite.config.js`: `23697c4ebbcd482d5f8097ce8a9c6a849e3ba10c0a544a14f99fdef7c5f04ce6`
- `scripts/lib/boot-html.mjs`: `7f2183dae8d570fd00e0c92b86e540c91d8f3297de802b644326f5aabf809688`
- `src/_front/chrome/bootReadiness.js`: `5411e24517c1d379bc309a6ebf0ba1890af1180d4b15ffa42ab455985fd6f388`
- `tests/boot-splash.unit.mjs`: `78af24b56b5aec0842f4c67d95c5ed0edb1a18f1ee1f52de7075dae7b3e599fd`
- `tests/boot-splash.browser.mjs`: `dada1387e794df6401c25293b7a96936dc807a9a8aea19a881139673f5a2b997`
- `src/_front/router.js`: `2b07659d57bc252dfef03527fa78be2e84f0a28097c8647deba156fd7c539c25`
- `public/serviceworker.js`: `12790f925710b3fb83589ce6c02d42eaddf45f4b143a9a1f3d48f267401ec532`
- `changes.diff`: `7a2d926d246806097e9e9e19b03b3f0f8b4cdcea841eb3025e82e099ea7d6c5c`
