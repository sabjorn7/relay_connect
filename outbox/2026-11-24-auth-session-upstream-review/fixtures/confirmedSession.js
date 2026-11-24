import { sbWithRetry } from './sbFetch.js';

// Observe the existing SDK client only. Persisted cookies/profile caches are not identity.
// Callbacks are synchronous: consumers must defer SDK work until outside the Auth lock.
export function observeConfirmedSession(client, onChange, onError = () => {}) {
    let uid = null, expiresAt = 0, generation = 0, revision = 0;
    let known = false, stopped = false, timer, subscription, refreshing, lastRecovery = -Infinity;
    function apply(session) {
        clearTimeout(timer);
        const expiry = Number(session?.expires_at) * 1000;
        const next = session?.access_token && Number.isFinite(expiry) && expiry > Date.now()
            ? session.user?.id || null : null;
        expiresAt = next ? expiry : 0;
        const changed = !known || uid !== next;
        known = true;
        uid = next;
        if (changed) { generation++; onChange(uid); }
        if (uid) timer = setTimeout(checkExpiry, Math.min(expiresAt - Date.now(), 2147483647));
    }
    function checkExpiry() {
        if (stopped || !uid) return;
        if (Date.now() >= expiresAt) { revision++; apply(null); }
        else { clearTimeout(timer); timer = setTimeout(checkExpiry, Math.min(expiresAt - Date.now(), 2147483647)); }
    }
    function snapshot() { checkExpiry(); return { uid, generation }; }
    function current(s) { checkExpiry(); return !stopped && !!s?.uid && s.uid === uid && s.generation === generation; }
    function refresh() {
        if (stopped) return Promise.resolve();
        if (refreshing) return refreshing;
        const started = revision;
        refreshing = sbWithRetry('public_page_session', () => client.auth.getSession())
            .then(result => {
                if (stopped || revision !== started) return;
                if (result.error) throw result.error;
                apply(result.data?.session);
            }).catch(error => {
                if (stopped || revision !== started) return;
                apply(null); onError(error);
            }).finally(() => { refreshing = null; });
        return refreshing;
    }
    const result = client.auth.onAuthStateChange((event, session) => {
        if (stopped || (event === 'INITIAL_SESSION' && revision > 0)) return;
        revision++;
        apply(event === 'SIGNED_OUT' ? null : session);
    });
    subscription = result.data?.subscription;
    function recover() {
        checkExpiry();
        if (stopped || document.visibilityState === 'hidden' || navigator.onLine === false || Date.now() - lastRecovery < 30000) return;
        lastRecovery = Date.now();
        refresh();
    }
    document.addEventListener('visibilitychange', recover);
    window.addEventListener('pageshow', recover);
    const offline = () => { lastRecovery = -Infinity; };
    window.addEventListener('offline', offline);
    window.addEventListener('online', recover);
    return { snapshot, current, refresh, stop() {
        stopped = true; generation++; clearTimeout(timer); subscription?.unsubscribe();
        document.removeEventListener('visibilitychange', recover);
        window.removeEventListener('pageshow', recover);
        window.removeEventListener('online', recover);
        window.removeEventListener('offline', offline);
    } };
}
