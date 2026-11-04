# MeetGuru Splash Screen v4 — independent review

Дата: 2026-11-04. Базовая ревизия полного changes.diff:
`fbfd2e3b81420cac60b5981fcba6616f31e6b8fa`.
SHA-256 полного changes.diff: `ed6c03333c25b962f57bdea7a4c003553277d4d83205679231aa4a72495bbb37`.
Это ВСЕ изменения Splash Screen v1–v4 от базы, не delta к v3.

Предыдущий пакет v3: relay_connect commit
`1ff9a0c9ffba52254f009f8cd544aea9260d7eb7`, outbox/2026-11-03-boot-splash-v3/.
Пакеты v1–v3 не изменяются. В relay_connect публикуются только changes.diff и
review-context.md в новом outbox/2026-11-04-boot-splash-v4/.
MeetGuru commit/push/deploy, production API, БД, серверы и workflows не затрагивались.

## Изменения после опубликованного v3

1. template.html/__mgBootRetry: отсутствие ВСЕХ critical CSS links требует
   нового HTML, поэтому явная кнопка делает один location.reload(). Повторное
   нажатие до навигации блокируется. Таймеры/polling reload не вызывают.
   Если CSS links есть, сохранён прежний адресный recovery по уникальному URL
   после удаления только точных CSS Request keys; документ не перезагружается.
2. bootReadiness.js: узко добавлена поддержка настоящей SVG-ссылки без текста.
   Прежние route boundaries, shell marker, Fragment/Teleport/display:contents,
   CSS gate, навигационные ревизии и диагностические флаги не переписаны.
3. tests/boot-legacy.fixture.mjs: добавлены реальные legacy renderer-компоненты
   с изолированными моками данных/services/layout. Browser suite расширен
   missing-CSS и SVG regression cases, включая реальные mouse clicks.

## Legacy: подтверждённые факты

Проверены локальные src/_front/views/wwPage.vue, wwPageLoadProgress.vue,
wwSection.vue, wwSectionComponent.vue, wwLayout.vue, wwElement.vue/
wwElementComponent.vue, экспортированная базовая секция и ww-icon/ww-button.

Фактическая цепочка: wwPage (Fragment) -> website-wrapper -> sections-wrapper ->
placeholder + wwSection -> wwSectionComponent -> базовая секция -> wwLayout ->
wwElement -> динамический элемент. pageLoaded/conditionalRendering влияют на DOM.
Скрытый placeholder и progress bar не являются доказательством готового UI.
ww-icon рендерит v-html SVG внутри a/router-link либо div по результату useLink.
useLink находится в src/wwLib/services/wwElement.js: внешний link даёт a,
внутренний — router-link, popup actions — div. ww-button может иметь icons
и пустую/bound подпись; native BUTTON уже покрывался v3 без изменений.

В router.js designInfo/PAGE_OVERRIDES найдены legacy семейства:
/promo, /feedback, /testpage, /components, /ofertauser, /osteo, /reset_pw,
/contacts, /ofertadogovor, /kinesis, /club и forced /superadmin-legacy.
/superadmin отдельно принадлежит собственному SuperadminPage, старый wwPage
сохранён через forced alias. Ключевые /feedback и /reset_pw не переопределены.

Локальные public/data snapshots исследованы программно без вывода содержимого,
личных данных или значений bindings; в пакет включены только агрегаты:

| Export page | wwObjects | ww-icon objects | Icons с click interactions | ww-button objects |
|---|---:|---:|---:|---:|
| feedback | 196 | 32 | 5 | 11 |
| reset_pw | 196 | 30 | 7 | 10 |
| superadmin (для legacy alias) | 553 | 62 | 3 | 24 |

Снимки также содержат обычные text/input/form элементы. В обследованном
дереве сохранённых link references не найдено полностью icon-only linked subtree;
подписи bindings не вычислялись. Наличие только SVG на ВСЕЙ реальной странице
этими данными не подтверждено. Это снимки репозитория, не факт о production.

Подтверждён архитектурный дефект: существующий ww-icon поддерживает полноценную
SVG-ссылку без текста; реальные wwPage/wwSection/wwSectionComponent/base-section
и ww-icon в изолированном renderer воспроизводили uiVisible=false у работающей
ссылки. После v4 она раскрывается автоматически и принимает настоящий CDP
mouse click, без test-only снятия gate/inert. Поэтому исправлена совместимость
с поддерживаемым текущими компонентами интерфейсом; не заявляется массовый
производственный сбой /feedback или /reset_pw.

Потенциально: conditional rendering, bound content и частичные ошибки могут
оставить одни icons. Данные локальных страниц и API текущих пользователей не
вычислялись, поэтому такой runtime state не доказан. Неподтверждённо: частота
SVG-only стартов и их связь с прежними пользовательскими белыми экранами.

## Узкий SVG-контракт v4

Критерий запускается только для A с непустым href, положительным box и без
aria-disabled=true. Схемы javascript/data/vbscript не используются как сигнал.
SVG должна иметь положительную реальную геометрию; внутри проверяются
path/rect/circle/ellipse/line/polyline/polygon, их getBBox и пересечение с SVG box.
Нужны nonzero fill/stroke и ненулевая fill/stroke opacity; transparent paint,
empty path, нулевые размеры, defs/symbol/mask/clipPath/marker/pattern не принимаются.
Проверяются style/visibility/opacity и декоративные aria-hidden/role по цепочке
от shape к ссылке. Stroke-only линия может быть корректным отображаемым icon.
Весь прежний родительский visibility/opacity gate сохраняется.

Без href видимая декоративная SVG не даёт готовность. Пустой SVG с box тоже нет.
SVG за route boundary не читается; Teleport требует прежний registerBootSurface
и принадлежность текущему #app. Произвольный body DOM не участвует.
В v4 не менялись Service Worker, router.js, auth и бизнес-решения. Существующая
обёртка guest redirect в App.vue/bootReadiness — только наблюдение promise.

## Полная последовательность старта v1–v4

- Inline system-font Splash вне #app; #app закрыт opacity/visibility/inert.
- Build hook после Vite помечает emitted entry CSS, переводит в preload->stylesheet
  и записывает ожидаемое количество. Dev HTML допускает отсутствие extracted links.
- Применение CSS подтверждается --mg-boot-css:ready-v2 из App.vue, не cssRules.length.
- Vue mount + nextTick + завершение актуальной начальной навигации + root/route DOM
  и видимое содержимое + critical CSS -> два rAF или проверяемый 250ms fallback.
- Состояния shellRendered/routeRendered/uiVisible/pageState/navigation разделены.
  Loader может раскрыться до API; SVG-ссылка теперь один из допустимых UI signals.
- Root setup/render failure не выпускает пустую оболочку; child lifecycle error
  логируется vue_error и не блокирует успешно отрисованную страницу.
- Успешный новый маршрут снимает устаревший failure и ожидание старого зависшего
  guard. Abort/reject/cancel/duplicate и sync watcher покрыты regression tests.
- Один boot_timeout и один поздний boot_late на документ; freeze rearm и
  mg-load-error сохранены. Ручной retry не создаёт автоматических reload циклов.
- Visibility probe синхронно поднимает только унаследованный gate visibility,
  оставляя opacity/inert и восстанавливая прежний inline style в finally.

## Проверки, выполненные на v4

- node tests/boot-splash.unit.mjs — PASS: предыдущая логика, missing production CSS
  count 0/1 + ручной reload/no loop/exception, реальные Vue child/root errors и
  Router success/duplicate/redirect/abort/reject/cancel/recovery, stale errors,
  never-settling старый guard и sync successor; background/pageshow/rAF модель.
- node tests/freezeguard.unit.mjs — PASS.
- node tests/boot-splash.browser.mjs — PASS, 55 изолированных Chrome сценариев:
  21 startup/recovery/layout сценарий, 4 legacy renderer сценария, 18 SVG и
  12 реальных templates/styles с подставленным состоянием.
  Legacy: form, delayed pageLoaded, empty sections, автоматически раскрытый icon.
  SVG: link, stroke-only, decorative, decorative в link, empty, display:none,
  hidden parent, opacity:0 parent, outside route boundary, registered и
  unregistered Teleport, zero geometry, empty path, no paint, transparent paint,
  hidden shape, defs-only, aria-disabled.
  Положительные случаи принимают реальные mouse clicks; отрицательные остаются
  закрыты с ручным retry. Обычный CSS скачан один раз; recovery — один дополнительный
  CSS запрос без reload. Missing CSS links исправляются ручным reload HTML;
  повторно повреждённый HTML не вызывает автоматического третьего открытия.
- Локальный pending API fixture удержан 60 секунд: loader каталога раскрыт,
  pageState=loading. Реальный API-код страниц не исполнялся.
- Vite build -l warn — PASS в изолированной временной копии, без .env и npm
  postbuild: 45 HTML, по одному ожидаемому nonblocking critical CSS. SHA application
  source сборки совпадает с пакетируемым исходником. dist MeetGuru не затронут.
- node --check helper и test-модулей — PASS; git diff --check и whitespace новых
  source файлов — PASS. Полный patch проверен на точной базе через изолированный
  временный Git index. MeetGuru index не изменялся.
- Проверка известных секретов/token/private-key/email/userinfo patterns — PASS.
  Секретные файлы и пользовательские логи не включены. Числовой loopback адрес
  в browser fixture относится только к локальному серверу.

## Ограничения и готовность

Полного E2E настоящих маршрутов MeetGuru нет. 12 T-проверок рендерят реальные
SFC templates/styles, но scripts/API/Auth/платежи не исполняют. Legacy integration
исполняет реальные renderer-компоненты и ww-icon, однако store/data/head/popup,
component helpers и wwLayout заменены моками. Generated page registration,
workflows и production не запускались. Нельзя выдать это за проверку реального
контента /superadmin-legacy или полного sign-in/signup.

SVG-проверка — консервативный DOM/paint-geometry критерий, не пиксельный аудит
всех CSS masks/clips/перекрытий/фильтров или топологии сложных path. Pure use/image/
foreignObject-only SVG и несемантический div с workflow-click не расширены новым
критерием: произвольный onclick не доказывает работоспособность страницы.
Также остаются прежние ограничения CSS-marker integrity и межвкладочных SW races.

Пакет готов к независимому review, ручным iPhone Safari и полнофункциональным
изолированным E2E-проверкам. Safari/native BFCache не проверены. Проверить real
getBBox/getBoundingClientRect, visibility probe/focus/inert, холодный/тёплый кеш,
background/pageshow, CSS outage/retry, все legacy layouts с согласованными моками
и реальные начальные redirect в безопасном окружении. Production готовность
этими результатами не подтверждается. Не запускать npm build/postbuild без
понимания их production обращений; обычный dev server не изолирует API.

## Файлы полного changes.diff

- src/_front/App.vue
- src/_front/main.js
- src/_front/views/AllCoursesPage.vue
- template.html
- vite.config.js
- scripts/lib/boot-html.mjs
- src/_front/chrome/bootReadiness.js
- tests/boot-splash.unit.mjs
- tests/boot-splash.browser.mjs
- tests/boot-legacy.fixture.mjs

SECURITY_FINDINGS.md, AGENTS.md, предыдущие reviews, dist и все посторонние изменения исключены.

## Неизменённый контекст legacy render

### src/_front/views/wwPage.vue:1–33

```vue
<template>
    <wwPageLoadProgress />
    <div :ww-page-id="page.id" class="website-wrapper">
        <!-- __WW_PAGE_MADE_WITH_WEWEB__ -->
        <div v-if="page && page.pageLoaded" class="sections-wrapper">
            <template v-for="(section, index) in sections" :key="section.uid">
                <!-- wwFront:start -->
                <div class="placeholder-section" :data-placeholder-section-uid="section.uid"></div>
                <!-- wwFront:end -->
                <wwSection
                    :uid="section.uid"
                    :section-index="index"
                    :index="index"
                    :ww-responsive="`ww-section-${index}`"
                />
            </template>
         </div>
         <!-- POPUPS -->
        <transition name="ww-front-popups" tag="div">
            <wwLinkPopup
                v-if="activeLinkPopup"
                :content="activeLinkPopup.content"
                :background="activeLinkPopup.background"
                :section-id="activeLinkPopup.sectionId"
            />
        </transition>
        <wwElement v-for="(popups, uid) in popupStore.stackedPopupUids" :key="uid" :uid="uid" no-interaction>
            <wwFrontPopup v-for="pUid in popups" :key="pUid" :modal="popupStore.instances[pUid]" stacked />
        </wwElement>
        <wwFrontPopup v-for="uid in popupStore.singlePopupUids" :key="uid" :modal="popupStore.instances[uid]" />
    </div>
</template>

```

### src/_front/components/wwPageLoadProgress.vue:1–5

```vue
<template>
    <div class="ww-page-load-progress" :class="{ display: showPageLoadProgress }">
        <div class="progress" :style="{ width: pageLoadProgress + '%', background: pageLoadProgressColor }"></div>
    </div>
</template>
```

### src/components/elements/element-1b1e2173-9b78-42cc-a8ee-a6167caea340/src/wwElement.vue:1–10

```vue
<template>
    <component
        :is="hasLink ? tag : 'div'"
        v-html="iconHTML"
        v-bind="properties"
        :style="style"
        class="ww-icon"
        :class="{ '-link': hasLink }"
    ></component>
</template>
```

## SHA-256 исходников и артефакта

- `src/_front/App.vue`: `e1fb258bee9cd5a9a76cb30a644fa59eaf264f867d3e72826e84d846573ad95d`
- `src/_front/main.js`: `63c315a1f3202ce3c8dd2c588f329cb5c8d15967145e8b5fbb8f655f9489b124`
- `src/_front/views/AllCoursesPage.vue`: `d07cd24d27bcbbf8d14a3793c01f08a04d24b4700ce98582efa0995c78a957e5`
- `template.html`: `28b17e1b33c27699a54da944fc1c79c93f1d33b8d6eda20a9bc2df6e630ccd6a`
- `vite.config.js`: `23697c4ebbcd482d5f8097ce8a9c6a849e3ba10c0a544a14f99fdef7c5f04ce6`
- `scripts/lib/boot-html.mjs`: `7f2183dae8d570fd00e0c92b86e540c91d8f3297de802b644326f5aabf809688`
- `src/_front/chrome/bootReadiness.js`: `ae8044ab2a87458c714caa7a22a04318640858c20d7cea3fc4acf86e0f0598bc`
- `tests/boot-splash.unit.mjs`: `9be396957b958e4a28ac28cb0dbacaac1d15420aa1b97b95c891d1b07bed38ce`
- `tests/boot-splash.browser.mjs`: `92f30f98ba16ca7dedcdf391aed82c477f1de4210518e525fa94621e3f713efd`
- `tests/boot-legacy.fixture.mjs`: `bc4a4dbce20c74fc15bbc2a6c36992b6288ab734c39c23295a10c16ffd92357f`
- `src/_front/router.js`: `2b07659d57bc252dfef03527fa78be2e84f0a28097c8647deba156fd7c539c25`
- `public/serviceworker.js`: `12790f925710b3fb83589ce6c02d42eaddf45f4b143a9a1f3d48f267401ec532`
- `changes.diff`: `ed6c03333c25b962f57bdea7a4c003553277d4d83205679231aa4a72495bbb37`
