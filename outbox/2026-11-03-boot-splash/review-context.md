# Независимая проверка Splash Screen MeetGuru

Дата подготовки: 2026-11-03 (МСК).
Базовый commit (локальный HEAD): `fbfd2e3b81420cac60b5981fcba6616f31e6b8fa`.
Это база локального патча, а не утверждение о текущем production или origin/main.

## Состав пакета

`changes.diff` — полный патч относительно указанного HEAD только для:

- `src/_front/main.js`
- `template.html`
- `vite.config.js`
- `scripts/lib/boot-html.mjs` — новый файл, включён целиком
- `tests/boot-splash.unit.mjs` — новый файл, включён целиком

Для отслеживаемых файлов использован unified context 1: все изменения сохранены,
но исключена огромная неизменённая карта страниц из vite.config.js.
Новые файлы включены обычными new-file hunks от /dev/null, без staging.
Посторонние изменения, SECURITY_FINDINGS.md, старые отчёты, .env, dist,
node_modules, журналы, данные пользователей и диагностические захваты не включены.
Ниже App.vue и serviceworker.js включены целиком как неизменённый контекст;
они не являются частью патча. Номера строк относятся к локальным исходникам.

## Цель и реализация

Показывать независимый от Vue, внешних стилей, изображений и шрифтов Splash
с самого начала загрузки, скрывая приложение до готовности Vue и entry CSS.

- Inline CSS и bootstrap находятся в template.html. Splash вынесен из #app;
  #app скрыт классом mg-boot-pending, inert и aria-hidden.
- Build-only post HTML hook преобразует entry /assets/*.css из stylesheet
  в preload as=style. Inline onload переключает rel в stylesheet и помечает loaded;
  onerror помечает failed. Необязательные CDN-стили не входят в этот барьер.
- HTML проверяет CSS load state, rel, sheet, disabled и cssRules, затем
  __mgMounted/__mgBootInitError. После двух rAF снимается блокировка.
- main.js устанавливает __mgMounted сразу после app.mount(); добавлен
  __mgMountedAt и вызов __mgBootCheck. Старый HTML поддерживается fallback.
- До mount Vue errorHandler устанавливает sticky __mgBootInitError.
- Через 15 секунд показываются сообщение и ручная кнопка location.reload().
  Сохранён один повтор окна watchdog при признаках фоновой вкладки/заморозки.
  Автоматических циклов перезагрузки нет.
- Существующие boot_timeout/boot_late обслуживает HTML bootstrap;
  boot_late отправляется после раскрытия приложения, один раз.
  В boot_timeout добавлены mounted и cssReady; mountedAt и bootReadyAt различаются.
- Авторизация, маршруты, Service Worker и бизнес-логика не изменялись.

## Результат технического аудита — проверить независимо

P0 не найдено. Найдены два P1 и два P2. Это вывод локального code review,
а не подтверждение частоты таких проблем у пользователей. Исправления не внесены.

### P1-1. Восстановимая ошибка Vue навсегда блокирует раскрытие

Место: main.js:101–105; template.html:70–76.
Сценарий: дочерний компонент бросает исключение в синхронном onMounted.
errorHandler ставит __mgBootInitError=true до возврата app.mount(). Vue может
продолжить монтирование, но CSS-ready + mounted уже не снимают блокировку:
флаг не сбрасывается. Сценарий следует воспроизвести отдельным тестом.
Минимальное направление: отделить фатальную ошибку корневого рендера от
восстановимой ошибки компонента; подтверждать успешный рендер оболочки,
сохраняя журналирование исключения. Не сбрасывать все ошибки без проверки.

### P1-2. Ручной reload не восстанавливает плохой CSS из SW Cache Storage

Место: template.html:48–66; public/serviceworker.js:44–50 (не изменялся).
Сценарий: в изолированном тестовом профиле кеш содержит пустой HTTP 200 для
критического CSS. SW кеширует res.ok без проверки тела и возвращает кеш первым.
Splash отвергает пустую таблицу; location.reload() получает тот же ответ,
даже если сервер уже отдаёт правильный файл. Наличие такого кеша у реальных
пользователей не установлено.
Минимальное направление: однократное адресное восстановление конкретного CSS
по явному ручному повтору, с обходом повреждённой записи. Не удалять SW
и не очищать всё пользовательское хранилище.

### P2-1. mounted не доказывает готовность первого интерфейса

Место: main.js:130–139; App.vue:77–81.
Сценарий: гость открывает /; immediate watcher запускает router.replace()
во время mount, после предыдущего router.isReady(). Два rAF не ждут завершения
этого перехода или асинхронных загрузок страницы. Не утверждаем, что любой
такой переход обязательно даёт пустой экран: оболочка/loader могут быть видимы.
Минимальное направление: явный контракт готовности оболочки после начального
редиректа и рендера интерфейса либо видимого loader; не ждать всех API-запросов.

### P2-2. Критерий готовности CSS даёт ложные отказы/ложную готовность

Место: template.html:41–55; scripts/lib/boot-html.mjs:7.
Сценарий A: допустимый пустой stylesheet либо недоступный CSSOM блокирует раскрытие.
CSSOM exception не доказывает неприменение стилей; текущий entry CSS same-origin.
Сценарий B: нет помеченных ссылок — ready=true. Это задумано для dev,
но отдельного ограничения dev нет; изменение пути CSS может обойти барьер.
Минимальное направление: явный ожидаемый набор production CSS, отдельный dev path,
проверяемый CSS-маркер применения вместо одного лишь cssRules.length.

## Дополнительные риски и проверенные связи

- Перед раскрытием условия проверяются повторно; CSS и Vue могут завершиться
  в любом порядке. Позднее завершение после таймаута предусмотрено.
- Нативный rAF приостанавливается в фоне. Здесь timeout fallback работает только
  при отсутствии API; отдельного восстановления очереди на pageshow/visibilitychange
  нет. Возврат в Safari/BFCache требует реальной проверки; это риск, не доказанный
  постоянный отказ Safari. Возможная страховка — пересоздать очередь с проверкой
  актуальных условий, не раскрывать приложение безусловно по таймеру.
- На штатном пути флаги предотвращают повторные boot_timeout/boot_late.
  Теперь boot_timeout возможен при mounted=true, но pending CSS; boot_late отражает
  прохождение нового барьера. Семантику учитывать при сравнении старых отчётов.
- auth_preflight_timeout не изменялся. Существующий mg-load-error получает
  приоритет над Splash; его реализация приложена ниже фрагментом.
- Splash одноразовый, последующие переходы не должны включать его повторно.
- Обязательная двойная загрузка CSS из rel-switch не доказана; проверить Network
  в Safari с холодным/тёплым кешем и SW. Необязательные внешние шрифты/стили
  могут менять оформление уже после раскрытия.
- Inline handlers и inline bootstrap требуют совместимой CSP. Изменения CSP
  не выполнялись; проверки production-заголовков в рамках этого пакета нет.

## Проверки и ограничения

При первоначальной реализации ранее сообщалось об успешных проверках:

- node tests/boot-splash.unit.mjs — автономная модель DOM/таймеров в Node vm:
  нормальная/поздняя загрузка, ошибки/пустой CSS, отсутствие JS, init error,
  ручное/позднее восстановление, фоновый контекст, legacy/router overlay.
- Изолированные Chrome fixtures с настоящим Vue runtime, без production API:
  normal, CSS 30/60 секунд, CSS 404/empty 200, поздний/отсутствующий JS,
  ошибки инициализации/рендера, ручное восстановление. Это не полный E2E приложения.
- Изолированная Vite-сборка без npm postbuild: 45 HTML с помеченным entry CSS.
  Старый dist не использовался как корректная база производительности.

Эти прежние browser/build проверки при подготовке пакета не повторялись;
временные fixtures и артефакты сборки не входят в пакет. Новый Node-тест включён.
Результат повторного Node-теста и проверок патча указан ниже после генерации.
Ранее выполненные проверки не закрывают P1-1, повреждённый SW-кеш,
реальный Safari/BFCache и первоначальный гостевой редирект.

Перед production: устранить P1, уточнить контракт готовности; проверить iPhone Safari
на Wi-Fi/мобильной сети, холодный/тёплый кеш, активный SW, задержки CSS/JS,
ошибки/пустые ответы, recoverable lifecycle error, фон/возврат/BFCache,
гостевой редирект, ручной retry, отсутствие FOUC и дублей beacon.
Не выполнять production-операции при независимом review.
Не запускать npm run build/postbuild: они обращаются к production.
Обычный dev server тоже не изолирует API; нужны моки.

## Контекст исходников (не является изменениями)

### src/_front/App.vue:1–99

```vue
<template>
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
            if (!isLikelyLoggedIn()) router.replace('/all_course');
        }
        watch(() => route.path, redirectGuestFromHome, { immediate: true });

        return { useNewChrome };
    },
};
</script>

<style>
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

### public/serviceworker.js:1–130

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
        })());
        return;
    }
    // everything else → native (no respondWith)
});

// ---- Web Push (не меняет стратегию кэша выше) --------------------------------
// showNotification вызывается ВСЕГДА, даже при пустом/битом payload (иначе iOS отзывает подписку).
self.addEventListener('push', (event) => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
    const title = (d && d.title) || 'МитГуру';
    const body = (d && d.body) || 'Новое уведомление';
    const url = (d && d.data && d.data.url) || '/streams';
    let tag;
    if (d && d.event === 'stream_start') tag = `stream-${url}`;
    else if (d && d.event === 'direct_message' && d.data && d.data.chatId) tag = `chat-${d.data.chatId}`;
    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon: '/images/apple-touch-180.png',
            badge: '/images/apple-touch-180.png',
            data: { url },
            tag,
        }).catch(() => {}),
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/streams';
    event.waitUntil((async () => {
        try {
            const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            for (const c of all) {
                if ('focus' in c) { try { await c.navigate(url); } catch (e) { /* ignore */ } return c.focus(); }
            }
            return self.clients.openWindow(url);
        } catch (e) { return self.clients.openWindow('/streams'); }
    })());
});

// Браузер обновил подписку — пере-подписаться (ключ из старой подписки) и дёрнуть клиентов,
// чтобы они переслали push_subscribe (сервер-сайд обновит endpoint/ключи).
self.addEventListener('pushsubscriptionchange', (event) => {
    event.waitUntil((async () => {
        try {
            let sub = event.newSubscription || null;
            const old = event.oldSubscription || (await self.registration.pushManager.getSubscription());
            const appKey = old && old.options && old.options.applicationServerKey;
            if (!sub && appKey) {
                sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey }).catch(() => null);
            }
            const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            for (const c of all) c.postMessage({ type: 'pushsubscriptionchange' });
        } catch (e) { /* ignore */ }
    })());
});
```

### src/_front/main.js:97–162

```js
const app = createApp(App);

// Vue render/lifecycle errors do NOT reach window.onerror — capture them too, with stack + route,
// so a component crash that white-screens a user leaves a diagnosable record (not just a blank page).
app.config.errorHandler = (err, instance, info) => {
    // A failed first render must not reveal an empty/partially rendered app behind the splash.
    if (!window.__mgMounted) window.__mgBootInitError = true;
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
    // Notify the HTML splash: mount alone is insufficient while critical CSS is still pending.
    try {
        window.__mgMounted = true;
        window.__mgMountedAt = Math.round(performance.now());
        if (window.__mgBootCheck) window.__mgBootCheck();
        // Compatibility with an older HTML shell that does not own the CSS readiness gate.
        else if (window.__mgBootFired) { try { new Image().src = '/_l?t=boot_late&m=' + encodeURIComponent('mountedAt=' + window.__mgMountedAt + ' vs=' + document.visibilityState + (window.__mgWasHidden ? ' wasHidden=1' : '') + (document.getElementById('mg-load-error') ? ' le=1' : '')); } catch (e) {} }
    } catch (e) { /* never throw */ }

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

init();
```

### src/_front/chrome/bootResilience.js:60–98

```js
    } catch (e) {
        return true; // no sessionStorage (private mode) → don't block the single reload
    }
}

// Full-screen error overlay in the boot-watchdog visual language (cf. #mg-boot-msg in
// template.html). Shown when a navigation's chunk or data fetch fails after the retry — a Refresh
// button instead of a hung/blank screen. Idempotent; no auto-reload.
let errorShown = false;
export function showLoadError(message) {
    try {
        if (errorShown || (typeof document !== 'undefined' && document.getElementById('mg-load-error'))) return;
        errorShown = true;
        // If the 15s boot watchdog (template.html) already drew its own overlay, remove it so the two
        // never stack — this load-error screen supersedes it.
        const wd = document.getElementById('mg-boot-msg');
        if (wd && wd.parentNode) wd.parentNode.removeChild(wd);
        const box = document.createElement('div');
        box.id = 'mg-load-error';
        box.setAttribute('style', 'position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#fff;color:#1f2733;text-align:center;padding:24px;font:16px/1.45 Raleway,system-ui,-apple-system,sans-serif');
        const msg = document.createElement('div');
        msg.innerHTML = message || 'Не удалось загрузить страницу.<br>Проверьте соединение.';
        const btn = document.createElement('button');
        btn.type = 'button'; btn.textContent = 'Обновить';
        btn.setAttribute('style', 'padding:11px 22px;border:none;border-radius:8px;cursor:pointer;color:#fff;background:#2563eb;font:600 16px Raleway,system-ui,sans-serif');
        btn.onclick = function () { try { errorShown = false; } catch (e) { /* ignore */ } location.reload(); };
        box.appendChild(msg); box.appendChild(btn);
        document.body.appendChild(box);
    } catch (e) { /* a UI helper must never throw */ }
}
```

## Контрольные SHA-256 исходников

- `src/_front/main.js`: `3d8517b4f88eb9caf69d624558d32027c1de126fedc52a16a61d05e2cb39ad26`
- `template.html`: `eb7636a3a01b9d61abf286641e9225c80a6cbf9d4f281efcf199120c0abc844b`
- `vite.config.js`: `23697c4ebbcd482d5f8097ce8a9c6a849e3ba10c0a544a14f99fdef7c5f04ce6`
- `scripts/lib/boot-html.mjs`: `eeffd6616f4195ba9617b3c6cf979f279dd148d3fe2698c40454f3ed8fd170e2`
- `tests/boot-splash.unit.mjs`: `89e5b6104ba0390077e6204bce603d85c551b9d5c5efb7554457cd0f00bcc532`
- `src/_front/App.vue`: `282a60766bcec55b64d57209d2ebfcd2bedbd82ee1ee911fbd6e763b7b1d1d9b`
- `public/serviceworker.js`: `12790f925710b3fb83589ce6c02d42eaddf45f4b143a9a1f3d48f267401ec532`

## Проверки при подготовке пакета

- `git diff --check` — PASS, весь текущий tracked diff.
- Whitespace-проверка обоих новых файлов через `git diff --no-index --check` — PASS.
- `git apply --check --reverse --whitespace=error-all reviews/2026-11-03-boot-splash/changes.diff`
  — PASS: патч соответствует текущим файлам, включая новые; применение не выполнялось.
- `node tests/boot-splash.unit.mjs` — PASS (автономная модель, не Safari/E2E).
- Проверка состава патча — ровно пять перечисленных файлов; посторонние изменения исключены.
- Проверка известных форматов секретов — совпадений нет. .env и секретные файлы не читались.
- SHA-256 перечисленных исходников при упаковке и после проверок совпали.
- Commit, staging, push, deploy, правки исходников и production-обращения не выполнялись.
