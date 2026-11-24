import { AuthRetryableFetchError } from '@supabase/supabase-js';

// One SDK owns refresh and its Web Lock. Never issue an independent preflight request.
// This adapter only fences SDK storage commits and classifies transport failures.
export function authRecoveryOptions(projectUrl, storageKey, { storage, fetcher = globalThis.fetch, timeoutMs = 8000 } = {}) {
    if (!storage) {
        try { storage = window.localStorage; storage.getItem(storageKey); }
        catch {
            // Same persistence limitation as the SDK fallback: usable for this
            // document only when browser policy denies localStorage entirely.
            const memory = new Map();
            storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
        }
    }
    const endpoint = new URL(`${projectUrl.replace(/\/$/, '')}/auth/v1/token`, window.location.origin);
    const commits = new Map();
    let rejectedRemoval;
    const retryable = () => new AuthRetryableFetchError('Temporary or superseded auth refresh', 0);
    const read = () => {
        const raw = storage.getItem(storageKey);
        try { return JSON.parse(raw || 'null'); } catch { return null; }
    };
    const matches = token => read()?.refresh_token === token;
    const adapter = {
        getItem: key => storage.getItem(key),
        setItem(key, value) {
            if (key === storageKey) {
                let incoming;
                try { incoming = JSON.parse(value); } catch { throw retryable(); }
                const expected = commits.get(incoming?.access_token);
                if (expected !== undefined) {
                    commits.delete(incoming.access_token);
                    if (!matches(expected)) throw retryable();
                }
            }
            storage.setItem(key, value);
        },
        removeItem(key) {
            if (key === storageKey && rejectedRemoval !== undefined) {
                const expected = rejectedRemoval;
                rejectedRemoval = undefined;
                if (!matches(expected)) throw retryable();
            }
            storage.removeItem(key);
        },
    };
    const fetch = async (input, init) => {
        let url;
        try { url = new URL(typeof input === 'string' ? input : input.url, window.location.origin); } catch { return fetcher(input, init); }
        if (url.origin !== endpoint.origin || url.pathname !== endpoint.pathname || url.searchParams.get('grant_type') !== 'refresh_token') return fetcher(input, init);
        let token;
        try { token = JSON.parse(init?.body)?.refresh_token; } catch { throw retryable(); }
        // Includes explicit logout's synchronous storage clear, and login in another tab.
        if (!token || !matches(token)) throw retryable();
        const controller = new AbortController();
        const abort = () => controller.abort();
        init?.signal?.addEventListener('abort', abort, { once: true });
        if (init?.signal?.aborted) abort();
        const timer = setTimeout(abort, timeoutMs);
        try {
            const response = await fetcher(input, { ...init, signal: controller.signal });
            if (!matches(token)) throw retryable();
            if ([409, 429].includes(response.status) || response.status >= 500) {
                await response.body?.cancel();
                throw retryable();
            }
            if (response.ok) {
                const body = await response.clone().json().catch(() => null);
                if (!body?.access_token || !body.refresh_token || !body.user?.id || !Number.isFinite(body.expires_in) || body.expires_in <= 0) throw retryable();
                if (!matches(token)) throw retryable();
                // Bounded, in-memory only. The SDK still validates/normalizes the response.
                if (commits.size >= 8) commits.delete(commits.keys().next().value);
                commits.set(body.access_token, token);
            } else {
                rejectedRemoval = token; // fence terminal SDK cleanup against a newer login
            }
            return response;
        } catch (error) {
            if (controller.signal.aborted) throw retryable();
            throw error;
        } finally {
            clearTimeout(timer);
            init?.signal?.removeEventListener('abort', abort);
        }
    };
    return { auth: { storageKey, storage: adapter, autoRefreshToken: true, persistSession: true }, global: { fetch } };
}

// SDK retries are bounded. A later online/foreground event may try again, at most
// once per 30s (a new offline transition resets this cooldown), without polling/reload.
export function watchAuthRecovery(client, onPending = () => {}, onRecovered = () => {}) {
    let pending = false, last = -Infinity, stopped = false;
    const recover = () => {
        if (stopped || pending || document.visibilityState === 'hidden' || navigator.onLine === false || Date.now() - last < 30000) return;
        pending = true; last = Date.now();
        client.auth.getSession().then(({ error }) => error ? onPending() : onRecovered()).catch(onPending).finally(() => { pending = false; });
    };
    const offline = () => { last = -Infinity; };
    window.addEventListener('offline', offline);
    window.addEventListener('online', recover);
    window.addEventListener('pageshow', recover);
    document.addEventListener('visibilitychange', recover);
    return () => {
        stopped = true;
        window.removeEventListener('online', recover);
        window.removeEventListener('offline', offline);
        window.removeEventListener('pageshow', recover);
        document.removeEventListener('visibilitychange', recover);
    };
}
