import { videoProfile } from './videoQuality.mjs';
// Mints a LiveKit access token that grants PUBLISH into one room. Called only after both
// authorization gates pass. identity is forced to the Supabase user id by the caller.
import { AccessToken, EgressClient, RoomServiceClient, StreamOutput, StreamProtocol, EncodingOptionsPreset } from 'livekit-server-sdk';
import { config } from './config.mjs';

const egressClient = new EgressClient(config.livekitInternalUrl, config.livekitApiKey, config.livekitApiSecret);
const roomClient = new RoomServiceClient(config.livekitInternalUrl, config.livekitApiKey, config.livekitApiSecret);

export async function ensureRoom(name) {
    await roomClient.createRoom({ name, emptyTimeout: 300, departureTimeout: 60 });
}

export async function kickParticipant(room, identity) {
    try {
        await roomClient.removeParticipant(room, identity);
        return true;
    } catch (e) {
        console.warn('[kick] removeParticipant ignored:', e?.message);
        return false;
    }
}

export async function mintPublishToken({ identity, name, room }) {
    const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
        identity,
        name: name || undefined,
        ttl: config.tokenTtl,
    });
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });

    const token = await at.toJwt();
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    return { token, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

export async function startEgress({ room, streamKey, profile = 'hd' }) {
    const selected = videoProfile(profile);
    const rtmp = `${config.peertubeRtmpBase.replace(/\/$/, '')}/${streamKey}`;
    const output = new StreamOutput({ protocol: StreamProtocol.RTMP, urls: [rtmp] });
    const info = await egressClient.startRoomCompositeEgress(room, output, {
        layout: 'grid',
        encodingOptions: EncodingOptionsPreset[selected.egressPreset],
        customBaseUrl: config.egressTemplateUrl,
    });
    return info.egressId;
}

export async function stopEgress(egressId) {
    if (!egressId) return;
    try {
        await egressClient.stopEgress(egressId);
    } catch (e) {
        console.warn('[egress] stop failed (ignored):', e?.message);
    }
}

export async function isEgressActive(egressId) {
    if (!egressId) return false;
    try {
        const list = await egressClient.listEgress({ egressId });
        const e = list[0];
        return !!e && (e.status === 0 || e.status === 1);
    } catch {
        return false;
    }
}

export async function readEgressState(egressId) {
    if (!egressId) return { state: 'not_started', error: null };
    const rows = await egressClient.listEgress({ egressId });
    const run = rows[0];
    const states = ['starting', 'active', 'ending', 'complete', 'failed', 'aborted', 'limit_reached'];
    // Never expose EgressInfo.streamResults, output URLs, raw error text or credentials.
    return { state: run ? (states[run.status] || 'unknown') : 'unavailable', error: run?.error ? 'Ошибка Egress; подробности доступны на сервере.' : null };
}

export async function stopUncommittedEgress(egressId) {
    // Used only for our own failed NEW start. Never swallow an ambiguous stop or release capacity early.
    await egressClient.stopEgress(egressId);
    for (let i = 0; i < 10; i++) {
        const rows = await egressClient.listEgress({ egressId });
        if (rows[0] && rows[0].status >= 3) return;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('video_start_reconciliation_required');
}
