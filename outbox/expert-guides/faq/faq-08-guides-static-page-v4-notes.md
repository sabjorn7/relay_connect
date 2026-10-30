# /faq/guides 404-фикс — v4 на ревью (2026-10-30)

Файл: `2026-10-30_faq-guides-static-page-v4.diff` (в корне outbox), 19 строк, **только**
`vite.config.js`. Собран от текущего `origin/main` `meetclone` (`4d50728` — уже задеплоенный
коммит FAQ CMS), в одноразовом git-worktree, который после генерации диффа полностью откачен
и удалён. **Не запушено и не задеплоено — ни в relay, ни тем более в `meetclone`, пока нет
вашего ОК.** Миграцию это не затрагивает (чисто фронтенд/билд-конфиг).

## Что чинит

Добавлен один блок в `vite.config.js` — точная копия паттерна `/soglasie`/`/streams` (клонирует
шаблон существующей WeWeb-страницы, добавляет `pages['faq-guides-en']` с
`outputDir: './faq/guides'`), чтобы при сборке появился физический `dist/faq/guides/index.html`.
Без него nginx не находит статический файл для прямого захода/обновления страницы/клика по
ссылке, не перешедшего в SPA-роутинг, и отдаёт 404 — это и наблюдалось на проде.

## Проверено локально

`npm run build` в реальном чекауте (`node_modules` — read-only симлинк на `meetclone`,
lock-файлы идентичны побайтово) — чисто, 0 warnings, тот же лог, что раньше:
```
[postbuild] /article_page: pre-rendered 10 page(s) + _seo.tmpl.html
[postbuild] /course_info: pre-rendered 135 page(s) + _seo.tmpl.html
```
После сборки:
- `dist/faq/guides/index.html` — **существует**, 26 966 байт, `<title>Инструкции для
  экспертов — МитГуру</title>`, ссылается на `main-*.js` корректно.
- `dist/soglasie/index.html` — **существует** (как и раньше, не трогал), 27 008 байт.

## Другие новые маршруты из диффа v3 — проверил, не нуждаются

В v3 `router.js` был добавлен **ровно один** новый маршрут —
`{ path: '/faq/guides', name: 'faq-guides', component: FaqGuidesPage }` (сверил `grep` по
самому файлу диффа — других `path:`/`routes.push` там нет). Три ссылки «Как это сделать?»
(`#course`/`#stream`/`#money`) и два якоря из плана (`#event`/`#club`) — это **хэши на той же
странице** `/faq/guides`, не отдельные server-side маршруты (хэш никогда не уходит на сервер),
поэтому им физический `index.html` не нужен — одного блока для `/faq/guides` достаточно.

Заодно посмотрел полный список уже существующих хендрайтен-блоков в `vite.config.js`:
`streams`, `streams/call`, `events_manage`, `events`, `soglasie`, `vozvrat`,
`superadmin-legacy`, `promo-demo`, `profile-demo`, `course-demo`, `my-finanse-demo`. Среди них
**нет** `podpiska`/`cookie`/`rekvizity`/`documents`/`soglasie-rasprostranenie` — у них, похоже,
та же проблема (404 на прямом заходе), что и была у `/faq/guides` — но это **не из диффа v3**,
предсуществующий пробел, не трогал и не предлагаю трогать в рамках этой задачи (раз попросите
отдельно — почти наверняка тот же самый паттерн правки).

## sha256

См. заголовок коммита (запушу в `relay_connect` по вашему ОК).
