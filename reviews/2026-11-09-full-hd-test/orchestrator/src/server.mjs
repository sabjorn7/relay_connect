import { videoProfile } from './videoQuality.mjs';
// MeetGuru live orchestrator — server-authoritative control plane for multi-host (co-host) rooms.
// Endpoints: /live/token (2.2), /live/start + /live/stop (2.3), /live/invite (2.4),
// /live/remove (2.4b). All gated on a verified Supabase JWT.
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.mjs';
import { requireAuth } from './auth.mjs';
import { getStream, getVideoRun, isFullHdAllowed, reserveVideoStart, holdVideoStart, releaseVideoStart, getUserRole, getMembership, markJoined, getUserName, setStreamLive, setStreamEnded, ensureOwnerMembership, resolveUserByEmail, inviteCohost, removeCohost } from './db.mjs';
import { mintPublishToken, ensureRoom, startEgress, stopEgress, stopUncommittedEgress, isEgressActive, readEgressState, kickParticipant } from './livekit.mjs';
import { createLive, deleteLive } from './peertube.mjs';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '16kb' }));
app.use(cors({ origin: config.allowedOrigins.length ? config.allowedOrigins : true }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'live-orchestrator' }));

const tokenLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
});

// Diagnostics polling must never consume the token-mint limiter's budget.
const diagnosticsLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false,
    message: { error: 'rate_limited' } });

app.post('/live/token', tokenLimiter, requireAuth, async (req, res) => {
    try {
        const sub = req.user.sub;
        const streamId = req.body?.stream_id;
        if (!streamId || !UUID.test(streamId)) return res.status(400).json({ error: 'bad_stream_id' });

        const stream = await getStream(streamId);
        if (!stream) return res.status(404).json({ error: 'stream_not_found' });

        const member = await getMembership(streamId, sub);
        if (!member) return res.status(403).json({ error: 'not_a_cohost' });

        const room = stream.livekit_room || stream.id;
        const name = await getUserName(sub).catch(() => null);
        const { token, expiresAt } = await mintPublishToken({ identity: sub, name, room });

        if (member.status === 'invited') markJoined(streamId, sub).catch((e) => console.warn('[markJoined]', e?.message));

        return res.json({
            token,
            url: config.livekitUrl,
            room,
            identity: sub,
            role: member.role,
            expires_at: expiresAt,
            video_quality: stream.livekit_egress_id ? (await getVideoRun(stream))?.profile || 'hd' : (stream.video_quality === 'full_hd' && !(await isFullHdAllowed(stream)) ? 'hd' : videoProfile(stream.video_quality).id),
            quality_contract: 1,
        });
    } catch (e) {
        console.error('[/live/token]', e);
        return res.status(500).json({ error: 'internal' });
    }
});

async function loadOwnedStream(req, res) {
    const streamId = req.body?.stream_id;
    if (!streamId || !UUID.test(streamId)) { res.status(400).json({ error: 'bad_stream_id' }); return null; }
    const stream = await getStream(streamId);
    if (!stream) { res.status(404).json({ error: 'stream_not_found' }); return null; }
    if (stream.author !== req.user.sub) { res.status(403).json({ error: 'not_owner' }); return null; }
    return stream;
}

app.post('/live/start', requireAuth, async (req, res) => {
    try {
        const stream = await loadOwnedStream(req, res);
        if (!stream) return;

        if (stream.livekit_egress_id && await isEgressActive(stream.livekit_egress_id)) {
            return res.status(409).json({ error: 'already_live', egress_id: stream.livekit_egress_id, peertube_video_id: stream.peertube_video_id });
        }

        const profile = videoProfile(stream.video_quality).id;
        // Admission is checked BEFORE allocating Egress/transcoding resources.
        const reservation = await reserveVideoStart(stream, profile, req.user.sub);
        const room = stream.livekit_room || stream.id;
        let live, egressId, egressRequested = false;
        try {
            await ensureOwnerMembership(stream.id, req.user.sub);
            await ensureRoom(room);
            live = await createLive({ name: stream.title || 'Эфир', saveReplay: true });
            await holdVideoStart(reservation);
            egressRequested = true;
            egressId = await startEgress({ room, streamKey: live.streamKey, profile });
            await setStreamLive(stream, { egressId, videoId: live.video.uuid, profile, reservation, actorId: req.user.sub });
        } catch (error) {
            if (egressRequested && !egressId) throw new Error('video_start_reconciliation_required');
            // Verify commit state before compensation; if reads fail, preserve resources for reconciliation.
            if (egressId) {
                let current;
                try { current = await getStream(stream.id); } catch { throw new Error('video_start_reconciliation_required'); }
                if (current?.livekit_egress_id === egressId) throw new Error('video_start_reconciliation_required');
                try { await stopUncommittedEgress(egressId); } catch { throw new Error('video_start_reconciliation_required'); }
            }
            if (live) await deleteLive(live.video.uuid).catch(() => {});
            await releaseVideoStart(reservation).catch(() => {});
            throw error;
        }
        return res.json({ room, peertube_video_id: live.video.uuid, egress_id: egressId, video_quality: profile });
    } catch (e) {
        const expected = ['full_hd_capacity', 'full_hd_not_enabled', 'full_hd_actor_contract_required', 'not_owner', 'stream_settings_changed', 'stream_start_in_progress', 'video_reservation_expired', 'video_start_reconciliation_required'];
        if (expected.includes(e?.message)) return res.status(409).json({ error: e.message });
        console.error('[/live/start]', e);
        return res.status(500).json({ error: 'internal' });
    }
});

// Authenticated diagnostic read: creator/cohost or the existing users.role='admin'.
app.post('/live/quality', diagnosticsLimiter, requireAuth, async (req, res) => {
    try {
        const streamId = req.body?.stream_id;
        if (!UUID.test(streamId || '')) return res.status(400).json({ error: 'bad_stream_id' });
        const stream = await getStream(streamId);
        if (!stream) return res.status(404).json({ error: 'stream_not_found' });
        const member = stream.author === req.user.sub || await getMembership(streamId, req.user.sub);
        if (!member && await getUserRole(req.user.sub) !== 'admin') return res.status(403).json({ error: 'not_a_cohost' });
        const run = await getVideoRun(stream);
        const active = stream.livekit_egress_id ? videoProfile(run?.profile || 'hd') : null;
        const state = await readEgressState(stream.livekit_egress_id);
        return res.json({ requested: videoProfile(stream.video_quality).id, profile: active, ...state,
            measuredBitrate: null, cpuPercent: null, memoryBytes: null });
    } catch { return res.status(503).json({ error: 'quality_unavailable' }); }
});

app.post('/live/stop', requireAuth, async (req, res) => {
    try {
        const stream = await loadOwnedStream(req, res);
        if (!stream) return;

        if (!stream.livekit_egress_id) return res.json({ ok: true, already_stopped: true });

        await stopEgress(stream.livekit_egress_id);
        await setStreamEnded(stream.id);
        return res.json({ ok: true });
    } catch (e) {
        console.error('[/live/stop]', e);
        return res.status(500).json({ error: 'internal' });
    }
});

app.post('/live/invite', requireAuth, async (req, res) => {
    try {
        const stream = await loadOwnedStream(req, res);
        if (!stream) return;

        const email = (req.body?.email || '').trim();
        if (!email || !email.includes('@')) return res.status(400).json({ error: 'bad_email' });

        const user = await resolveUserByEmail(email);
        if (!user) return res.status(404).json({ error: 'user_not_found' });

        const result = await inviteCohost(stream.id, user.id, req.user.sub);
        return res.json({
            cohost: { user_id: user.id, name: user.Name || null, email: user.email, role: result.role, status: result.status },
            outcome: result.outcome,
        });
    } catch (e) {
        console.error('[/live/invite]', e);
        return res.status(500).json({ error: 'internal' });
    }
});

app.post('/live/remove', requireAuth, async (req, res) => {
    try {
        const stream = await loadOwnedStream(req, res);
        if (!stream) return;

        const userId = req.body?.user_id;
        if (!userId || !UUID.test(userId)) return res.status(400).json({ error: 'bad_user_id' });
        if (userId === req.user.sub) return res.status(400).json({ error: 'cannot_remove_owner' });

        const result = await removeCohost(stream.id, userId);
        if (result.outcome === 'owner') return res.status(400).json({ error: 'cannot_remove_owner' });

        const room = stream.livekit_room || stream.id;
        const disconnected = await kickParticipant(room, userId);

        return res.json({ ok: true, user_id: userId, outcome: result.outcome, disconnected });
    } catch (e) {
        console.error('[/live/remove]', e);
        return res.status(500).json({ error: 'internal' });
    }
});

app.listen(config.port, '127.0.0.1', () => {
    console.log(`live-orchestrator listening on http://127.0.0.1:${config.port}`);
});
