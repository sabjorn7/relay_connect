import { getCart, removeProduct, payCart } from '@/_front/checkout/cartApi.js';
// Account + cart data for the shared AppHeader. Uses the same global Supabase client as the rest
// of the app (window.wwLib.wwPlugins.supabase.instance) — the same one used for auth elsewhere.
//
// The existing shop cart is read through owner-bound RPCs. Checkout delegates to the
// shared server-priced endpoint; BuyCourse remains the payment callback.

const SUPABASE_URL = 'https://sb.meetgu.ru';
const AVATAR_BUCKET = 'profile';
const USER_COLS = 'id, email, "Name", "Photo", "Ammount", role, superadmin';

export function getSupabase() {
    return window.wwLib?.wwPlugins?.supabase?.instance || null;
}

// Read the persisted Supabase session straight from localStorage instead of sb.auth.getSession().
// getSession() acquires a Web Locks lock that contends with the app's OWN auth init and can stall
// page data loading (e.g. the course list never fetches for guests). This is a plain, synchronous,
// lock-free read. Returns the session object (with .user / .access_token) or null.
export function readStoredSession() {
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const raw = localStorage.getItem(localStorage.key(i));
            if (!raw || !raw.includes('access_token') || !raw.includes('refresh_token')) continue;
            const parsed = JSON.parse(raw);
            // supabase-js v2 stores the session object directly; older shapes nest it.
            const sess = parsed?.access_token ? parsed : (parsed?.currentSession || parsed?.session || null);
            if (sess?.access_token) return sess;
        }
    } catch (e) { /* malformed / blocked storage -> treat as no session */ }
    return null;
}

// Decode the auth user (id + email) from the sb-access-token JWT cookie. The Supabase auth plugin
// sets sb-access-token / sb-refresh-token on login and removes them on logout, so this is a reliable
// logged-in signal that does NOT touch sb.auth.getSession() (which can hang on Web Locks). Used as a
// fallback when the localStorage session isn't present (stale/cleared storage) but the cookie is.
export function authCookieUser() {
    try {
        const c = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('sb-access-token='));
        if (!c) return null;
        const jwt = decodeURIComponent(c.slice('sb-access-token='.length));
        const payload = jwt.split('.')[1];
        if (!payload) return null;
        // base64url -> base64 (+ padding, which JWTs usually omit and atob otherwise rejects).
        const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
        return json?.sub ? { id: json.sub, email: json.email } : null;
    } catch (e) { return null; }
}

// Reliable "is a user logged in?" check with NO getSession()/Web-Locks dependency: the auth cookie
// OR a persisted localStorage session. Fails OPEN (returns true) on any error so a real user is never
// treated as a guest. Used by the App.vue home guard so logged-in users are never bounced to the
// public catalog even when localStorage is stale, cleared, or blocked.
export function isLikelyLoggedIn() {
    try {
        return !!(authCookieUser() || readStoredSession());
    } catch (e) { return true; }
}

// Resolve the logged-in uid, WAITING briefly for the auth session to be restored. The supabase auth
// plugin restores the localStorage session / sets the cookie asynchronously after boot, so a page that
// reads the uid once in onMounted can lose the race (uid=null) and render empty per-user blocks forever
// («Ваши курсы» empty, greeting with no name). Poll until the uid appears or the timeout elapses.
// Returns the uid, or null for a genuine guest (no session after waiting).
export async function waitForUid(timeoutMs = 3000, stepMs = 150) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const uid = readStoredSession()?.user?.id || authCookieUser()?.id;
        if (uid) return uid;
        if (Date.now() >= deadline) return null;
        await new Promise((r) => setTimeout(r, stepMs));
    }
}

// Resolve the logged-in user's `users` row (users.id == auth uid for this project; fall back to email).
// Guests (no stored session AND no auth cookie) return null WITHOUT any Supabase call, so the header
// never touches auth on public pages.
export async function loadUser(sb) {
    if (!sb) return null;
    const authUser = readStoredSession()?.user || authCookieUser();
    if (!authUser?.id) return null;
    // Retry on an EMPTY result: the users row always exists for a logged-in user, so a transient empty
    // response (observed intermittently, esp. on slow mobile) is a race/hiccup, not "no such user" —
    // falling back to {id,email} here is what makes the header show email-initials ("2M") with no name.
    for (let attempt = 0; attempt < 3; attempt++) {
        let { data } = await sb.from('users').select(USER_COLS).eq('id', authUser.id).limit(1);
        if (!data?.length && authUser.email) {
            ({ data } = await sb.from('users').select(USER_COLS).eq('email', authUser.email).limit(1));
        }
        if (data?.length) return data[0];
        await new Promise((r) => setTimeout(r, 300));
    }
    return { id: authUser.id, email: authUser.email };
}

export function avatarUrl(user) {
    const p = user?.Photo;
    if (!p) return '';
    if (/^https?:\/\//.test(p)) return p;
    return `${SUPABASE_URL}/storage/v1/object/public/${AVATAR_BUCKET}/${p}`;
}

export function initials(user) {
    const n = (user?.Name || user?.email || '').trim();
    if (!n) return '·';
    const parts = n.split(/[\s@.]+/).filter(Boolean);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || n[0].toUpperCase();
}

// Cart = shop rows for this owner with status 'cart'. Newest first (matches the WeWeb collection sort).
export async function loadCart(sb, ownerId) {
    if (!sb || !ownerId) return [];
    return getCart(sb);
}

export async function removeCartItem(sb, id) {
    if (!sb || !id) return;
    return removeProduct(sb, id);
}

export function cartTotal(cart) {
    return (cart || []).reduce((s, r) => s + Number(r.price || 0), 0);
}

// The app's canonical auth-plugin (plugin-1fa0dd68 / friendly name "supabaseAuth"). Its signOut()
// removes the sb-access/refresh-token cookies with the exact path/domain it set them and clears the
// app's user state — a raw sb.auth.signOut() does neither.
function getAuthPlugin() {
    const p = window.wwLib?.wwPlugins;
    if (!p) return null;
    if (typeof p.supabaseAuth?.signOut === 'function') return p.supabaseAuth;
    const byId = p['1fa0dd68-5069-436c-9a7d-3b54c340f1fa'];
    return typeof byId?.signOut === 'function' ? byId : null;
}

// Fallback cookie removal (matches setCookies: path '/', domain = hostname; plus '.'+hostname for
// Safari) in case the auth plugin isn't reachable.
function clearAuthCookies() {
    const host = window.location.hostname;
    for (const name of ['sb-access-token', 'sb-refresh-token']) {
        for (const domain of [host, '.' + host, '']) {
            const d = domain ? `; domain=${domain}` : '';
            document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0${d}`;
        }
    }
}

// Remove any persisted supabase session from localStorage (the second source isLikelyLoggedIn reads).
function clearStoredSession() {
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            const v = localStorage.getItem(k);
            if (v && v.includes('access_token') && v.includes('refresh_token')) localStorage.removeItem(k);
        }
    } catch (e) { /* ignore */ }
}

// Full, race-free sign-out. isLikelyLoggedIn() reads the auth COOKIE **or** the localStorage session,
// so logout must clear BOTH before the caller redirects — otherwise a leftover source keeps the app
// "logged in" and it restores the session on the next load (the observed "logout needs two clicks").
// The synchronous clears below are the guarantee; the network signOut is fired best-effort and NOT
// awaited because it acquires the Web Locks auth lock and can hang.
export async function signOutUser(sb) {
    // Push: отписать текущий endpoint ПОКА сессия ещё активна (push_unsubscribe берёт user_id из
    // auth.uid()) — на общих устройствах подписка не должна остаться на прежнем пользователе. Best-effort.
    // rpc берёт auth-lock и может зависнуть — выход из аккаунта НЕ должен ждать (гонка с таймаутом 1500мс).
    try {
        await Promise.race([
            (async () => {
                if (!('serviceWorker' in navigator)) return;
                const r = await navigator.serviceWorker.getRegistration();
                const sub = r && (await r.pushManager.getSubscription());
                if (sub) {
                    try { await sb?.rpc('push_unsubscribe', { p_endpoint: sub.endpoint }); } catch (e) { /* ignore */ }
                    try { await sub.unsubscribe(); } catch (e) { /* ignore */ }
                }
            })(),
            new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
    } catch (e) { /* best-effort */ }
    // Read the access token BEFORE clearing — needed for server-side revocation below.
    const token = readStoredSession()?.access_token || null;
    // Clear local state FIRST and synchronously — network-independent (pure cookie/localStorage ops,
    // no `sb`/getSupabase dependency) — so logout "sticks" and the caller can redirect immediately
    // even if the network sign-out below never responds.
    clearAuthCookies();
    clearStoredSession();
    // Server-side revocation, fire-and-forget with keepalive (survives the imminent redirect). We send
    // it MANUALLY because clearing storage first means auth-js's own signOut() finds no session and
    // sends nothing. Uses the client's own URL+anon key, so it works on every host (/sb proxy or sb.*).
    try {
        // supabase-js doesn't expose supabaseKey; the anon key lives on the GoTrue client's headers.
        const authUrl = sb?.auth?.url || (sb?.supabaseUrl ? `${sb.supabaseUrl}/auth/v1` : null);
        const key = sb?.supabaseKey || sb?.auth?.headers?.apikey || sb?.headers?.apikey || null;
        if (token && authUrl && key) {
            fetch(`${authUrl}/logout`, {
                method: 'POST', keepalive: true,
                headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            }).catch(() => { /* ignore */ });
        }
    } catch (e) { /* ignore */ }
    // Reset the plugin's UI state (user=null / isAuthenticated=false); its network call is a no-op now.
    try { getAuthPlugin()?.signOut(); } catch (e) { /* ignore */ }
    try { sb?.auth?.signOut(); } catch (e) { /* ignore */ }
}

// One server-priced checkout for course, event and stream positions.
export async function checkoutCart(sb, { user, cart, promoCode = null }) {
    if (window.__mgGuestAuth) throw new Error('Нет связи с аккаунтом. Обновите страницу.');
    if (!sb || !user?.id || !cart?.length) return;
    const result = await payCart(sb, { userId: user.id, ids: cart.map(r => r.id), code: promoCode });
    if (result.completed) window.location.assign('/?order=' + encodeURIComponent(result.orderId));
    else window.location.assign(result.payLink);
}
