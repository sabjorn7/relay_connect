// Narrow jschannel-compatible Embed API client. Protocol: PeerTube 7 embed-api (scope::method).
// No iframe DOM access, no wildcard targetOrigin, bounded handshake/calls; no viewer telemetry sent.
export function connectPeerTubeQuality(iframe, { window: host = window, timeout = 6000, onResolutions = () => {}, onPlayback = () => {} } = {}) {
    const url = new URL(iframe.src); const origin = url.origin;
    const scope = url.searchParams.get('scope') || 'peertube'; const target = iframe.contentWindow;
    let id = 0; let disposed = false; const pending = new Map();
    const send = message => target?.postMessage(JSON.stringify(message), origin);
    const call = (method, params) => new Promise((resolve, reject) => {
        if (disposed) { reject(new Error('Player closed')); return; }
        const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(new Error('Embed API unavailable')); }, timeout);
        pending.set(key, { resolve, reject, timer }); send({ id: key, method: `${scope}::${method}`, ...(params === undefined ? {} : { params }) });
    });
    function receive(event) {
        if (disposed || event.source !== target || event.origin !== origin) return;
        let message; try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
        if (!message || typeof message !== 'object') return;
        if (message.method === `${scope}::__ready`) {
            if (message.params === 'ping') send({ method: `${scope}::__ready`, params: 'pong' });
            return;
        }
        if (message.method === `${scope}::resolutionUpdate`) { onResolutions(); return; }
        if (message.method === `${scope}::playbackStatusUpdate` || message.method === `${scope}::playbackStatusChange`) {
            const state = message.params?.playbackState;
            onPlayback(['playing', 'paused', 'ended', 'unstarted'].includes(state) ? state : null); return;
        }
        const p = pending.get(message.id);
        if (p) { clearTimeout(p.timer); pending.delete(message.id); message.error ? p.reject(new Error('Embed API error')) : p.resolve(message.result); }
    }
    host.addEventListener('message', receive);
    let pingTimer, rejectReady;
    const ready = new Promise((resolve, reject) => {
        rejectReady = reject;
        const deadline = Date.now() + timeout;
        const ping = async () => {
            if (disposed) { reject(new Error('Player closed')); return; }
            send({ method: `${scope}::__ready`, params: 'ping' });
            try { if (await call('isReady')) { resolve(); return; } } catch { /* graceful fallback */ }
            if (Date.now() >= deadline) { reject(new Error('Embed API unavailable')); return; }
            pingTimer = setTimeout(ping, 300);
        };
        ping();
    });
    return { ready, getResolutions: () => call('getResolutions'), setResolution: value => call('setResolution', value),
        dispose() { disposed = true; clearTimeout(pingTimer); rejectReady(new Error('Player closed')); host.removeEventListener('message', receive); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Player closed')); } pending.clear(); },
    };
}
