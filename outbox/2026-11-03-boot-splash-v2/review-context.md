# MeetGuru Splash Screen v2 — independent review

Дата: 2026-11-03. Полный changes.diff относительно локального базового commit
`fbfd2e3b81420cac60b5981fcba6616f31e6b8fa`; это НЕ delta к v1 и НЕ заявление о текущем production.
Предыдущий пакет сохранён без изменений в relay_connect, commit
`96c194c8b5752e87a445b0a911171628eac1351f`, outbox/2026-11-03-boot-splash/.
Новый пакет предназначен только для review, не для автоматического применения.

## Состав

Четыре изменённых файла: src/_front/App.vue, src/_front/main.js, template.html,
vite.config.js. Четыре новых файла: scripts/lib/boot-html.mjs,
src/_front/chrome/bootReadiness.js, tests/boot-splash.unit.mjs,
tests/boot-splash.browser.mjs. Все восемь входят в changes.diff, новые целиком.
Unified context 1 исключает огромную неизменённую карту страниц Vite,
сохраняя все изменения. Ни SECURITY_FINDINGS.md, ни другие посторонние
локальные изменения, .env, dist, node_modules, логи и пользовательские данные
в пакет не входят. MeetGuru commit/push/deploy не выполнялись.

## Реализация и исправленные замечания

### P1-1: восстановимая ошибка дочернего Vue-компонента

Глобальный errorHandler сохраняет logException('vue_error', ...).
Он больше не устанавливает безусловный sticky init-error до mount.
Отдельно фатален сбой setup КОРНЕВОГО компонента: проверяются instance.$parent
и info 'setup function' / production runtime-0. Ошибки дочернего onMounted
не блокируют успешно отрисованную оболочку. Root render failure определяется
по отсутствию data-mg-boot-shell в реальном DOM, а не по факту вызова onMounted.
Маркер добавлен в App.vue скрытым span без внешних зависимостей.
Проверка маркера повторяется, поэтому удачный поздний root render может
разрешить раскрытие после прежней render-ошибки. Root setup failure требует
ручного повтора; исключения bootstrap дополнительно логируются как vue_error.

### P1-2: адресное ручное восстановление CSS при Cache Storage / SW

Только явное нажатие запускает восстановление. Если CSS уже готов, кнопка
однократно вызывает reload (например, при отсутствующем JS). При плохом CSS:

1. Берутся только помеченные critical CSS links текущего документа, same-origin,
   pathname /assets/*.css. Иные ресурсы и кеши целиком не удаляются.
2. В Cache Storage перечисляются реальные Request keys. Удаляются только ключи
   с ТОЧНЫМ URL этих ссылок, включая query; ignoreVary применяется лишь при
   удалении найденного ключа. Исходный SW использует CACHE='mg-shell' и
   caches.match(req) по всем кешам; поэтому поиск не ограничен только именем кеша.
3. Очистка ограничена ожиданием 1.5 секунды. При отказе или зависании storage
   процесс не блокируется навсегда.
4. Links заменяются в текущем документе на preload того же CSS с уникальным
   __mg_boot_retry query. На load rel становится stylesheet с тем же URL и CORS.
   SW caches.match(req) не использует ignoreSearch, следовательно поздний put
   СТАРОГО Request не подменит новый retry URL. Один no-store здесь не используется
   как ложная гарантия обхода SW.
5. Раскрытие по-прежнему требует CSS-маркера и готовности оболочки. Ошибка либо
   15 секунд ожидания освобождают кнопку; автоматических повторов/перезагрузок нет.
   Второе нажатие в процессе не создаёт параллельную операцию.

SW не изменён и не отключается. Восстановление CSS не перезагружает документ,
если JS уже работает. Если JS также отсутствует, после успешного CSS-повтора
пользователь может явно нажать кнопку ещё раз для reload.
Поздние/параллельные записи других вкладок не исключены, но не мешают текущему
retry по новому ключу. Это не обещание вечного исправления кеша между вкладками;
обычная последующая загрузка снова проверяет CSS. Ручные retry могут оставить
отдельные CSS query-ключи в существующем кеше; автоматического накопления нет.

### P2-1: контракт готовности

__mgMounted устанавливается после Vue mount, nextTick и завершения tracked
начальной навигации. Existing guest router.replace('/all_course') в App.vue
обёрнут наблюдением promise; условие авторизации, маршрут и решение о переходе
НЕ менялись. Не добавлялись guards или новые redirect decisions.

__mgBootReady — конечный сигнал: mounted, начальный tracked redirect завершён,
root marker присутствует, есть элемент оболочки/страницы с ненулевой геометрией
и display != none, критический CSS загружен и его маркер применён, вкладка видима.
visibility:hidden у #app во время gate намеренно не используется как критерий:
это наследуемое следствие самого Splash. Фоновые вкладки раскрываются на возврате.
API, видео, шрифты и прочие второстепенные ресурсы не ожидаются. Дополнительные
асинхронные редиректы страниц после API не входят в tracked initial redirect.
Проверка DOM/layout подтверждает оболочку или loader, а не готовность контента
и не успешность всех дочерних компонентов.

### P2-2: загрузка и применение CSS

От cssRules.length и чтения CSSOM отказались. В App.vue entry CSS находится
:root { --mg-boot-css: ready-v2; }. Bootstrap читает этот маркер через
getComputedStyle. Inline Splash его НЕ содержит. Дополнительно для всех
critical links проверяются state=loaded, rel=stylesheet, sheet и !disabled.
Пустой HTTP 200 main CSS не содержит маркера и оставляет приложение закрытым.
CSSOM SecurityError ничего не доказывает и теперь вообще не читается.

Build hook записывает ожидаемое количество critical links в data-mg-boot-css
на html. Ноль/пропажа/несовпадение в production не дают ready. В исходном шаблоне
значение dev: отсутствие извлечённых links допустимо, но marker из injected
App.vue CSS всё равно обязателен. В итоговой проверенной сборке все 45 HTML
имеют ровно один critical CSS. Маркер не является криптографической проверкой
целостности CSS и не обнаружит всякое частичное повреждение с сохранённым marker.

### Дополнительная устойчивость

- Два rAF сохраняются; есть ограниченный 250 ms fallback, повторно проверяющий
  актуальные DOM/CSS/visibility условия. Он не раскрывает приложение вслепую.
- Очередь имеет generation token; устаревшие callbacks игнорируются.
- visibilitychange и pageshow сбрасывают ожидающую очередь и повторяют проверку,
  не сбрасывая one-shot диагностические флаги. Native BFCache на Safari не проверен.
- CSS/JS могут завершиться после таймаута. boot_timeout и boot_late отправляются
  один раз каждый на документ. mountedAt и bootReadyAt разделены.
- mg-load-error имеет приоритет и не удаляется. Legacy/nomodule и noscript сохранены.
- Механизм auth_preflight_timeout и источники auth/маршрутизации не переработаны.
- Внешние необязательные шрифты/стили остаются неблокирующими; они могут поздно
  менять типографику. Контракт предотвращает раскрытие без entry CSS, а не все
  возможные визуальные сдвиги от второстепенных ресурсов.

## Что реально проверено

1. node tests/boot-splash.unit.mjs — PASS. Mock HTML DOM/таймеры/Cache Storage
   и реальные установленные Vue + Vue Router (custom renderer, memory history).
   Нормальный запуск; CSS 30/60 секунд, error/empty/late-application; pending JS;
   пустой/отсутствующий production CSS и dev; исключение CSSOM; реальные child
   onMounted/root render/root setup ошибки и сохранение vue_error; guest redirect
   с удержанным beforeEnter; frozen/background/pageshow; stalled rAF; router-error
   overlay/legacy; one-shot beacons; точная очистка Cache Request keys и late put,
   denied/stalled storage; concurrent click suppression и ручной recovery.
2. node tests/freezeguard.unit.mjs — PASS, существующая логика freeze guard.
3. node tests/boot-splash.browser.mjs — PASS, 13 изолированных Chrome/CDP сценариев.
   Реальные DOM, Vue, Router и CSS, локальный HTTP server, отдельный временный профиль,
   внешние DNS заблокированы. Нормальный запуск; CSS 30/60 секунд, 404 и empty 200;
   JS delayed/404/init/render errors + recovery; child onMounted error;
   guest redirect; stalled rAF; реальный неизменённый serviceworker.js с пустым
   Cache Storage CSS + сохранением unrelated.css и успешным ручным recovery.
   Normal CSS загружен один раз (preload -> stylesheet), recovery — один дополнительный
   запрос без reload документа. Для held CSS проверены paint entry и скрытый #app;
   captureScreenshot синхронизирует compositor с CDP virtual time. Это не измерение
   production-производительности и не Safari/BFCache E2E.
4. node --check для main.js, bootReadiness.js, boot-html.mjs и обоих tests — PASS.
5. Прямой Vite build -l warn в отдельной временной копии — PASS. Без npm postbuild,
   без .env production/staging; production API не вызывались. Это проверка компиляции,
   а не полнофункциональный production build. 45 HTML: expected count=1, один
   помеченный preload entry CSS, без blocking entry stylesheet; CSS marker в bundle.
   dist исходного MeetGuru не редактировался. plugins-settings.json скопирован
   в изолированную копию как существующая build-зависимость, в пакет не включён.
6. git diff --check и whitespace-проверки новых исходников — PASS.
   changes.diff как сохранённый unified diff может содержать пробел в пустой
   строке контекста: НЕ удалять его. Для diff-artifact допустимо исключение
   trailing-whitespace; review-context.md проверяется обычным способом.
7. Целостность полного патча проверяется git apply --cached --check на указанной
   базовой ревизии с изолированным временным индексом, без изменения индекса MeetGuru.
   Внешние журналы, секреты и персональные данные не входят в пакет.

## Что осталось до production

Нужны независимый review и ручные iPhone Safari проверки: холодный/тёплый кеш,
private mode/отказ storage, действующий SW, CSS/JS offline и delayed, переключение
Wi-Fi/mobile, фон и возврат, реальный pageshow persisted/BFCache, гостевой вход,
исключения root/child, ручные повторы и отсутствие FOUC. Проверить страницы без
общей шапки и их видимые loaders. CSP должна разрешать существующие inline scripts
и handlers; заголовки production в этой задаче не менялись и не проверялись.
Пиксельную полноту интерфейса, все маршруты и все сочетания многооконного SW-кеша
этими тестами не доказываем. Рискованных изменений SW/auth/routing для v2 не потребовалось.

Не запускать npm build/postbuild или реальное приложение для review без моков:
они могут обращаться к production. Browser test требует локально установленный
Chrome и использует только fixtures; CHROME_BIN задаёт иной путь к Chrome.

## Контекст для независимого чтения

### src/_front/App.vue:1–103

```vue
<template>
    <span hidden data-mg-boot-shell></span>
    <AuthBanner />
    <AppHeader v-if="useNewChrome" />
    <!-- wwFront:start -->
    <router-view />
    <!-- wwFront:end -->
    <AppFooter v-if="useNewChrome" />
    <InstallPrompt v-if="useNewChrome" />
</template>

<script>
import { reactive, computed, provide, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '@/_front/chrome/AppHeader.vue';
import AppFooter from '@/_front/chrome/AppFooter.vue';
import AuthBanner from '@/_front/chrome/AuthBanner.vue';
import InstallPrompt from '@/_front/chrome/InstallPrompt.vue';
import { trackBootNavigation } from '@/_front/chrome/bootReadiness.js';
import { isLikelyLoggedIn } from '@/_front/chrome/headerAccount.js';

// The new MeetGuru chrome (AppHeader/AppFooter) is the DEFAULT on every route. This is a denylist,
// not an allowlist: to fast-rollback a single page to the old WeWeb chrome, add its normalized path
// here (one line, no mechanism change, no full revert). Empty ⇒ new chrome truly everywhere.
//
// Rollout batching: product/auth/dev pages start EXCLUDED (custom layouts, verifiable only live —
// e.g. /courses_manage restyles itself via coursesManageStyle.js). Remove a path from this list
// once that page is verified live with the fixed header. The hand-written pages (streams/faq/legal)
// are content-only now and rely on this chrome, so they are intentionally NOT excluded.
const CHROME_EXCLUDE = [
    // account / product ( /profile, /profile_page, /my_courses and /my_finanse are redesigned — they get the new chrome)
    '/feedback',
    // creator management: courses_manage AND articles_manage are now hand-written pages — they get the new chrome.
    // admin — /superadmin is now the hand-written panel (gets our chrome); the WeWeb legacy fallback
    // lives at /superadmin-legacy and keeps its own WeWeb header.
    '/superadmin-legacy',
    // auth utilities (login is a full-screen dedicated page — its own chrome, no AppHeader/Footer)
    '/login', '/login-demo', '/registration', '/registration-demo', '/reset_pw',
    // multi-host broadcaster room — full-screen call UI, no shared chrome
    '/streams/call',
    // dev / internal
    '/components', '/testpage',
];
// Prefix exclusions for dynamic detail routes (a path is excluded if it STARTS WITH any of these).
// "/course/" uses the hand-written CoursePage, and "/articles/:slug" now uses the hand-written
// ArticlePage — both get the new chrome, so there are no prefix exclusions left.
const CHROME_EXCLUDE_PREFIX = [];

export default {
    components: { AppHeader, AppFooter, AuthBanner, InstallPrompt },
    setup() {
        const wwFrontState = reactive({
            lang: computed(() => wwLib.$store.getters['front/getLang']),
            pageId: computed(() => wwLib.$store.getters['websiteData/getPageId']),
            screenSize: computed(() => wwLib.$store.getters['front/getScreenSize']),
            screenSizes: computed(() => wwLib.$store.getters['front/getScreenSizes']),
        });
        provide('wwFrontState', wwFrontState);

        const route = useRoute();
        const router = useRouter();
        // Normalize the trailing slash: direct hits on the live site (nginx) canonicalize
        // "/about_meet" -> "/about_meet/", which an exact match would miss.
        const normPath = (p) => (p || '').replace(/\/+$/, '') || '/';
        const useNewChrome = computed(() => {
            const p = normPath(route.path);
            return !CHROME_EXCLUDE.includes(p) && !CHROME_EXCLUDE_PREFIX.some((pre) => p.startsWith(pre));
        });
        // Toggle the gate class per route so the (non-scoped) CSS below hides the WeWeb chrome only
        // where our chrome is active, and excluded pages keep their original WeWeb header.
        watch(useNewChrome, (on) => {
            document.documentElement.classList.toggle('mg-newchrome', on);
        }, { immediate: true });

        // The home route "/" is the logged-in dashboard. Guests are redirected to the public catalog
        // instead of an empty "Здравствуйте, undefined" dashboard. The public marketing landing lives
        // on the SEPARATE meetgu.ru build (src/_landing/*), not on app.meetgu.ru. "Logged in?" via
        // isLikelyLoggedIn() (sb-refresh/access cookie OR persisted localStorage; fails OPEN).
        function redirectGuestFromHome(path) {
            if (normPath(path) !== '/') return;
            if (!isLikelyLoggedIn()) trackBootNavigation(router.replace('/all_course'));
        }
        watch(() => route.path, redirectGuestFromHome, { immediate: true });

        return { useNewChrome };
    },
};
</script>

<style>
/* Applied entry CSS contract; deliberately absent from inline splash styles. */
:root { --mg-boot-css: ready-v2; }
/* Site-wide (gate class always on <html>): hide the WeWeb header/footer by their exact, stable
   full-width root uids — the same component is reused on ~30 pages — and reserve space for our
   fixed AppHeader. Pages without that WeWeb header (dashboard/superadmin/promo) simply get ours. */
html.mg-newchrome [data-ww-uid="5d7431c2-133c-4b05-af3f-e3be61b55c8d"],
html.mg-newchrome [data-ww-uid="97853efe-ba2f-4544-9a3e-4681403f71a8"] {
    display: none !important;
}
html.mg-newchrome #app {
    padding-top: 62px;
}
</style>
```

### public/serviceworker.js:1–72

```js
// Caching service worker — makes the app load reliably on flaky mobile networks: after one
// successful load, the big hashed bundle is served from cache, so a dropped connection stops
// producing white screens. Designed to NOT reintroduce the stale-index deploy race:
//   - navigations / HTML  -> NETWORK-FIRST (a fresh deploy always wins), cache fallback only when
//     the network fails (flaky net gets the last-good shell instead of a blank page).
//   - /assets/* hashed chunks -> CACHE-FIRST (immutable file names → safe to serve from cache
//     forever and persist across deploys; this is the ~2.8MB bundle that was stalling).
//   - /sb/* (Supabase API/storage), /data/*, and any non-GET -> BYPASS → always fresh from network.
// Every handler is defensive (never throws); on any cache error it falls through to the network.
const version = 271; // bumped by CI; changing it makes the SW byte-different so browsers update it
const CACHE = 'mg-shell';

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE).then(async (c) => {
            await c.addAll(['/', '/index.html']).catch(() => {});
            await c.add('/offline.html').catch(() => {}); // separate: its failure must not drop the shell cache
        }).catch(() => {}),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        try {
            const keys = await caches.keys();
            // drop caches from any previous scheme; keep the current shell cache
            await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
        } catch (e) { /* ignore */ }
        try { await self.clients.claim(); } catch (e) { /* ignore */ }
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return; // never intercept writes
    let url;
    try { url = new URL(req.url); } catch (e) { return; }
    if (url.origin !== self.location.origin) return;              // cross-origin → native
    if (url.pathname.startsWith('/sb/') || url.pathname.startsWith('/data/')) return; // always fresh

    // hashed /assets/* and version-pinned /vendor/* (e.g. the self-hosted VK SDK) → cache-first
    // (immutable names → safe; only `res.ok` is cached, never a failed/empty response)
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/vendor/')) {
        event.respondWith((async () => {
            const cached = await caches.match(req).catch(() => null);
            if (cached) return cached;
            try {
                const res = await fetch(req);
                if (res && res.ok) { caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {}); }
                return res;
            } catch (e) {
                return cached || Response.error();
            }
        })());
        return;
    }

    // navigations / HTML → network-first, cache fallback (so new deploys win; flaky net still loads)
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
        event.respondWith((async () => {
            try {
                const res = await fetch(req);
                if (res && res.ok) { caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {}); }
                return res;
            } catch (e) {
                const cached = (await caches.match(req).catch(() => null))
                    || (await caches.match('/index.html').catch(() => null))
                    || (await caches.match('/').catch(() => null))
                    || (await caches.match('/offline.html').catch(() => null)); // first-visit-offline
                return cached || Response.error();
            }
```

Service Worker выше — неизменённый контекст. Полный push-handler не требуется для CSS review.

### src/_front/main.js:98–174

```js
const app = createApp(App);

// Vue render/lifecycle errors do NOT reach window.onerror — capture them too, with stack + route,
// so a component crash that white-screens a user leaves a diagnosable record (not just a blank page).
app.config.errorHandler = (err, instance, info) => {
    // Only a root setup failure is fatal independently of DOM. Child lifecycle errors
    // remain recoverable; failed root renders are detected by the shell marker.
    if (!window.__mgMounted && instance && !instance.$parent &&
        (info === 'setup function' || String(info).endsWith('#runtime-0'))) {
        window.__mgBootRootSetupError = true;
    }
    try { logException('vue_error', err, { info, route: location.pathname }); } catch (e) { /* never throw from the handler */ }
    console.error(err);
};

const init = async function () {
    window.vm = app;
    app.use(pinia);
    app.use(store);
    app.use(VueCookieNext);
    app.use(wwElements);
    app.use(globalServices);
    app.config.unwrapInjectedRef = true;
    /* wwFront:start */
    app.use(createHead());
    /* wwFront:end */



    await wwLib.initFront({ store, router });

    app.use(router);

    addMediaQueriesListener(wwLib.$store.getters['front/getScreenSizes'], (screenSize, isActive) => {
        wwLib.$store.dispatch('front/setIsScreenSizeActive', { screenSize, isActive });
    });

    await router.isReady();

    // We select ourself app element, because Vue does not know how to do it properly (Editor + Front Iframe)
    const el = document.getElementById('app');
    app.mount(el);
    await signalBootMounted({ nextTick });

    initHeaderMenuOutsideClick();
    initProfileFollowButton(router);
    initMySubscriptions(router);
    initProfileCity(router);
    initMyFinanseSales(router);
    initCoursesManageStyle(router);
    initArticlesStyle(router);
    initStreamsNavLink(router);

    /* wwFront:start */
    // Needed or reactivity is not working in deployed app
    wwLib.scrollStore.setValues();
    /* wwFront:end */

    wwLib.$emit('wwLib:isMounted');
    wwLib.isMounted = true;
};

init().catch(error => {
    if (!window.__mgMounted) window.__mgBootInitError = true;
    try { logException('vue_error', error, { info: 'bootstrap', route: location.pathname }); } catch (e) {}
    console.error(error);
    if (window.__mgBootCheck) window.__mgBootCheck();
});

/* wwFront:start */
wwLib.getFrontWindow().addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    wwLib.installPwaPrompt = e;
});
/* wwFront:end */

// Push: поддержание уже существующей подписки (last_seen) + реакция на pushsubscriptionchange от SW.
```

## SHA-256 исходников и артефакта

- `src/_front/App.vue`: `cba29c7d938397c51f43f3650e1a08689445a3bb7260f6b3f7d9f5ca32f7b5ad`
- `src/_front/main.js`: `46c6e31738b2892d0c9bea5a441e8545950d0209155f44ea05b5aadb7045cfdc`
- `template.html`: `62b14d57722f69a8b878d1cf19ff91de23d29e1b4892537512cd9cb2f5bb349c`
- `vite.config.js`: `23697c4ebbcd482d5f8097ce8a9c6a849e3ba10c0a544a14f99fdef7c5f04ce6`
- `scripts/lib/boot-html.mjs`: `7f2183dae8d570fd00e0c92b86e540c91d8f3297de802b644326f5aabf809688`
- `src/_front/chrome/bootReadiness.js`: `58a8ce2f2b1a1c9f5ed88e98ed34407f4b85260754e22e17cfae9d1829351187`
- `tests/boot-splash.unit.mjs`: `4e3040b011c9f547b97d68bf8a788ee0e6086a132e3a349694bd51581ed75b73`
- `tests/boot-splash.browser.mjs`: `da532e673a210d47b5898a4bbfcf77d083784df418aea5483dc86b69e31c965d`
- `public/serviceworker.js`: `12790f925710b3fb83589ce6c02d42eaddf45f4b143a9a1f3d48f267401ec532`
- `src/_front/router.js`: `2b07659d57bc252dfef03527fa78be2e84f0a28097c8647deba156fd7c539c25`
- `changes.diff`: `407664d3b9eb9110f39e53fa66812a982c1bf042e4d6b48092e48f8d6802122d`
