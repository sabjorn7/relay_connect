# Изоляция от legacy scanner: PASS; общая готовность: BLOCKED

Основа: [6c03085](https://github.com/sabjorn7/relay_connect/tree/6c03085/outbox/2026-11-24-auth-session-consumers). Отдельный кандидат `/private/tmp/mg-auth-envelope-20261124/candidate`. Production, CI, рабочая ветка и SDK не менялись. Нового хранилища, сервиса, клиента SDK или синхронизации нет.

## Минимальные изменения

[Incremental diff](serialization-and-cookies.NOT-FOR-DEPLOY.diff), три файла:

1. `authRecovery.js`: существующий adapter преобразует только основную session record в `mg-auth-v2:<base64 UTF-8 JSON>`. SDK получает обратно исходную JSON-строку. Чтение CAS и проверки refresh работают с декодированной сессией. Неизвестный формат, повреждённая кодировка и plain JSON не импортируются. PKCE/user/остальные ключи не преобразуются, удаление по-прежнему точечное.
2. `wwPlugin.js`: имена записываемых/очищаемых cookies изменены с общих `sb-access-token`/`sb-refresh-token` на `mg-auth-v2-access`/`mg-auth-v2-refresh`. Новые токены больше не записываются в прежние cookies. Атрибуты и срок жизни cookies не менялись.
3. `headerAccount.js`: logout удаляет только новые Auth-cookie names; прежние cookies чужой версии не затрагиваются. Identity readers уже используют подтверждённый snapshot плагина из исходного кандидата.

Поиск непосредственно связанных потребителей в исходниках кандидата обнаружил запись токенов только в wwPlugin и очистку в headerAccount. Других чтений старых cookie names в src не найдено. Это вывод по локальному репозиторию, не аудит внешних серверов. Несвязанные cookies и OAuth/PKCE код не изменялись.

## Результаты ДО/ПОСЛЕ

| Проверка | Результат |
|---|---|
| ДО: старая вкладка со scanner и SDK 2.70.0 | FAIL Chrome/WebKit: новая локальная сессия удалена |
| ПОСЛЕ: scanner старой вкладки | PASS Chrome/WebKit: выбирает только старую A |
| ПОСЛЕ: logout старой вкладки | PASS Chrome/WebKit: новая локальная B сохраняется |
| SDK/header/cookie-helper новой версии | PASS Chrome/WebKit: B/B/B |
| Новый logout, HTTP500, offline, отсутствие Web Locks | PASS Chrome/WebKit; весь boundary suite — 12 PASS |
| Unicode roundtrip, удаление, PKCE/user pass-through, отказ от миграции plain JSON, повреждённый envelope | PASS unit |
| Terminal commit gap HTTP400/401 | PASS, B сохранена, stale SIGNED_OUT отсутствует |
| Terminal race и logout B | PASS 400/401 |
| Замещающий adapter и штатный logout | PASS 400/401 |
| Поздний SIGNED_OUT | PASS Node: реальный SDK subscriber path; браузерный повтор NOT TESTED |
| Email/регистрация/confirmation/VK | PASS, 26 Chrome сценариев с синтетическими ответами |
| Checkout | PASS, 12 Chrome сценариев с синтетическими заказами и провайдером |
| Общая Auth-регрессия | 21 записанный PASS в незавершённом общем запуске; отдельный bounded two-tabs-error — **FAIL** |

Старые и новые вкладки — два отдельных документа, один SDK на документ. Это реальные Chrome/WebKit с локальной синтетической сетью. BEFORE заново воспроизведён. Unit-тест подтверждает UTF-8/кириллицу/emoji, отсутствие маркеров access_token и refresh_token в сохраняемой record. Старая вкладка продолжает работать с A; старые токены не переносятся в новый namespace.

Тестовые fixtures адаптированы к новому wire format localStorage; network JSON не менялся. Первый Node terminal-race запуск имел оставшуюся plain JSON запись в fixture и завершился ошибкой декодирования. После исправления только fixture на envelope тест PASS. Это не скрытый product FAIL. Обновлённые тесты приложены. Зависимости в кандидате не менялись.

## Критический FAIL: две новые вкладки, один refresh 429

Отдельный запуск `MODES=two-tabs-error` с таймаутом 20 секунд воспроизвёл:

```text
HTTP refresh requests: 2
tab 1: authenticated=true, uid=A, view=A, guest=false, ready=true, stored=true
tab 2: authenticated=false, uid=null, view=null, guest=true, ready=true, stored=true
Timeout 20000ms exceeded
```

Лог: [two-tabs-error.log](results/two-tabs-error.log). Это не удаление сохранённого refresh token scanner-ом: storage есть, одна новая вкладка уже восстановилась. Вторая не восстановила подтверждённое UI-состояние в пределах теста. Точная последовательность событий, приводящая к этому состоянию, в текущей задаче не установлена. Нельзя утверждать, что причиной является envelope, или что дефект впервые появился здесь. Предыдущая большая матрица не заменяет данный воспроизводимый FAIL.

Первый полный запуск был остановлен вручную без итогового summary. До остановки Chrome two-tabs-error в итоге прошёл без установленного предела ожидания; в лог также попали дальнейшие Chrome-сценарии и часть WebKit (всего 21 записанный PASS). Это плавающая задержка, а не доказательство бесконечного зависания. Затем в тест добавлен 20-секундный предел и обезличенные снимки состояний; отдельный запуск завершился ошибкой. Продуктовые таймауты не менялись.

**По условию пользователя дальнейшие изменения остановлены. Не выполнены упаковка релиза и исправление recovery.** Минимальный следующий предмет работы — порядок invalidation/recovery у существующих authRecovery/wwPlugin/confirmedSession после конкурентного 429 и успешного refresh другой вкладки. Не нужен новый storage, SDK или сервис. Исправление этого поведения не включено в diff.

## Границы проверок и NOT TESTED

- Общий запуск не завершён: Chrome сценарии дошли до sleep-week, WebKit — до two-tabs. Отдельные записи PASS сохранены в recovery.log; итогового PASS всей матрицы нет. Остаток WebKit, browser stale-event и повтор после bounded FAIL — NOT TESTED. Не переносим Chrome результаты на WebKit.
- Email/VK suite проверяет компоненты и синтетические callback/ответы, но не реального VK провайдера и не полноценный переход из старой версии в новую через VK. Такой end-to-end переход — NOT TESTED.
- Полная Vite-сборка нового кандидата, физический PWA, production cookies на HTTPS-домене, серверные logout/revocation — NOT TESTED. Ни одна production-операция не выполнялась.
- Общие ограничения исходного header-кандидата (ранние одноразовые потребители null до SDK confirmation, зависший revoke, push unsubscribe) не объявлены устранёнными.
- Local build использует предыдущий тестовый SDK 2.119.2-mg.isolation-test.1; SDK не пересобирался и не публиковался в этой задаче.

## Ограничения изоляции и повторный вход

Это **совместимость с конкретным старым scanner, не криптографическая защита**. Любой произвольный JS того же origin может декодировать base64 или удалить запись по ключу; защита от такого кода здесь не заявляется. Общий localStorage.clear также удалит запись. Проверенный прежний scanner не распознаёт envelope, а его старый logout удаляет только распознанные records и прежние cookies.

Намеренный серверный global logout аккаунта A может штатно отозвать новые серверные сессии того же аккаунта. Локальная сериализация этого не отменяет и не должна обходить серверный отзыв. При разных A/B прежний проверенный scanner больше не получает B token. Реальный server global logout не тестировался, чтобы не менять production-сессии.

Пользователям потребуется повторный вход. Старые refresh tokens и даже plain JSON под новым namespace не мигрируются. Предыдущие незавершённые OAuth/PKCE flows не обещаются совместимыми до отдельного переходного теста. PKCE-механизм не изменён, но уже авторизованный пользователь старой вкладки не автоматически авторизован в новой.

## Запуск и дальнейший этап

Применять diff только к отдельному кандидату 6c03085. Скопировать приложенные tests и fixtures. Тестовые absolute paths относятся к старому SDK/helper и установленному Playwright, не к продуктовым зависимостям. Внешняя сеть блокируется harness.

```sh
node tests/auth-envelope.unit.mjs
node tests/auth-consumers.browser.mjs
node tests/auth-terminal-commit-gap.mjs
node tests/auth-terminal-race.mjs
node tests/auth-replacement-adapter-compat.mjs
node tests/auth-stale-event.mjs
MODES=two-tabs-error node tests/auth-session-recovery.browser.mjs
node tests/auth-email.browser.mjs
node tests/unified-checkout.browser.mjs
```

К закреплению исправленного SDK и чистой релизной сборке **пока не готово** из-за воспроизведённого recovery FAIL. Откат production не нужен. Локальный откат — вернуться к сохранённому отдельному кандидату 6c03085; формат менялся только в новом временном каталоге. Этот пакет не содержит команд Deploy App или установки production.
