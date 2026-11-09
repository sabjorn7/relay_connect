// Only explicitly allowlisted numeric WebRTC values leave this reducer. No SDP/ICE/IP/token.
const finite = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
export function summarizeVideoStats(report, previous = new Map()) {
    const next = new Map(); const layers = []; let rttMs = null;
    for (const s of report?.values?.() || []) {
        if (s.type === 'remote-inbound-rtp' && (s.kind === 'video' || s.mediaType === 'video')) {
            if (finite(s.roundTripTime) !== null) rttMs = s.roundTripTime * 1000;
        }
    }
    for (const s of report?.values?.() || []) {
        if (s.type !== 'outbound-rtp' || (s.kind !== 'video' && s.mediaType !== 'video') || s.isRemote) continue;
        const old = previous.get(s.id); const dt = old ? s.timestamp - old.timestamp : 0;
        const bytes = finite(s.bytesSent); const sent = finite(s.packetsSent);
        let bitrate = null;
        if (dt > 0 && bytes !== null && finite(old?.bytesSent) !== null && bytes >= old.bytesSent) bitrate = (bytes - old.bytesSent) * 8000 / dt;
        let lossPercent = null; let jitterMs = null;
        const remote = report.get?.(s.remoteId);
        const lost = finite(remote?.packetsLost);
        if (dt > 0 && lost !== null && old?.lost !== null && old?.lost !== undefined && sent !== null && finite(old?.sent) !== null) {
            const dl = lost - old.lost, ds = sent - old.sent;
            if (dl >= 0 && ds > 0) lossPercent = Math.min(100, dl * 100 / ds);
        }
        if (finite(remote?.jitter) !== null) jitterMs = remote.jitter * 1000;
        next.set(s.id, { timestamp: s.timestamp, bytesSent: bytes, sent, lost });
        layers.push({ width: finite(s.frameWidth), height: finite(s.frameHeight), fps: finite(s.framesPerSecond), bitrate, lossPercent, jitterMs,
            limitation: ['none', 'cpu', 'bandwidth', 'other'].includes(s.qualityLimitationReason) ? s.qualityLimitationReason : null });
    }
    return { layers, rttMs, previous: next };
}
