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
            badge: '/images/notification-badge-mg-v2.png',
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
