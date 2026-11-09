// Supabase client on the SERVICE_ROLE key — bypasses RLS so the orchestrator is the only writer
// of the (RLS-locked) stream_cohosts table. All membership/authorization reads go through here.
import { createClient } from '@supabase/supabase-js';
import { config } from './config.mjs';

export const sb = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
});

export async function getStream(id) {
    const { data, error } = await sb
        .from('streams')
        .select('id, author, title, mode, status, livekit_room, livekit_egress_id, peertube_video_id, video_quality')
        .eq('id', id)
        .limit(1);
    if (error) throw error;
    return data?.[0] || null;
}

export async function getVideoRun(stream) {
    if (!stream.livekit_egress_id) return null;
    const { data, error } = await sb.from('stream_video_runs').select('profile,started_at,ended_at').eq('egress_id', stream.livekit_egress_id).eq('stream_id', stream.id).maybeSingle();
    if (error) throw error;
    return data;
}
export async function reserveVideoStart(stream, profile, actorId) {
    const { data, error } = await sb.rpc('reserve_stream_video_start_scoped', { p_stream_id: stream.id, p_actor_id: actorId, p_expected_quality: profile, p_expected_egress_id: stream.livekit_egress_id || null });
    if (error) throw error;
    return data;
}
export async function releaseVideoStart(token) {
    const { error } = await sb.from('stream_video_start_reservations').delete().eq('token', token);
    if (error) throw error;
}
export async function holdVideoStart(token) {
    const { error } = await sb.rpc('hold_stream_video_start', { p_token: token });
    if (error) throw error;
}
export async function getUserRole(userId) {
    const { data, error } = await sb.from('users').select('role').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data?.role;
}
export async function setStreamLive(stream, { egressId, videoId, profile, reservation, actorId }) {
    const { error } = await sb.rpc('mark_stream_video_started_scoped', { p_stream_id: stream.id, p_actor_id: actorId, p_expected_quality: profile,
        p_expected_egress_id: stream.livekit_egress_id || null, p_egress_id: egressId, p_video_id: videoId, p_reservation: reservation });
    if (error) {
        // An HTTP error is not proof of transaction failure. Never stop a possibly committed run.
        const current = await getStream(stream.id);
        if (current?.livekit_egress_id === egressId) {
            const run = await getVideoRun(current);
            if (run?.profile === profile) return;
        }
        throw error;
    }
}

export async function setStreamEnded(streamId) {
    const { error } = await sb
        .from('streams')
        .update({ status: 'ended', livekit_egress_id: null })
        .eq('id', streamId);
    if (error) throw error;
}

export async function ensureOwnerMembership(streamId, userId) {
    const { error } = await sb
        .from('stream_cohosts')
        .upsert(
            { stream: streamId, user: userId, role: 'owner', status: 'joined', invited_by: userId },
            { onConflict: 'stream,user' },
        );
    if (error) throw error;
}

export async function getMembership(streamId, userId) {
    const { data, error } = await sb
        .from('stream_cohosts')
        .select('role, status')
        .eq('stream', streamId)
        .eq('user', userId)
        .in('status', ['invited', 'joined'])
        .in('role', ['owner', 'cohost'])
        .limit(1);
    if (error) throw error;
    return data?.[0] || null;
}

export async function markJoined(streamId, userId) {
    const { error } = await sb
        .from('stream_cohosts')
        .update({ status: 'joined' })
        .eq('stream', streamId)
        .eq('user', userId)
        .eq('status', 'invited');
    if (error) throw error;
}

export async function getUserName(userId) {
    const { data } = await sb.from('users').select('"Name"').eq('id', userId).limit(1);
    return data?.[0]?.Name || null;
}

export async function resolveUserByEmail(email) {
    const { data, error } = await sb.from('users').select('id, "Name", email').ilike('email', email).limit(1);
    if (error) throw error;
    return data?.[0] || null;
}

export async function inviteCohost(streamId, userId, invitedBy) {
    const { data, error } = await sb.from('stream_cohosts')
        .select('role, status').eq('stream', streamId).eq('user', userId).limit(1);
    if (error) throw error;
    const cur = data?.[0];

    if (cur) {
        if (cur.role === 'owner') return { outcome: 'owner', role: 'owner', status: cur.status };
        if (cur.status !== 'removed') return { outcome: 'already_member', role: cur.role, status: cur.status };
        const { error: upErr } = await sb.from('stream_cohosts')
            .update({ status: 'invited', invited_by: invitedBy })
            .eq('stream', streamId).eq('user', userId);
        if (upErr) throw upErr;
        return { outcome: 'reinvited', role: 'cohost', status: 'invited' };
    }

    const { error: insErr } = await sb.from('stream_cohosts')
        .insert({ stream: streamId, user: userId, role: 'cohost', status: 'invited', invited_by: invitedBy });
    if (insErr) throw insErr;
    return { outcome: 'invited', role: 'cohost', status: 'invited' };
}

export async function removeCohost(streamId, userId) {
    const { data, error } = await sb.from('stream_cohosts')
        .select('role, status').eq('stream', streamId).eq('user', userId).limit(1);
    if (error) throw error;
    const cur = data?.[0];
    if (!cur) return { outcome: 'not_a_member' };
    if (cur.role === 'owner') return { outcome: 'owner' };
    if (cur.status === 'removed') return { outcome: 'already_removed' };
    const { error: upErr } = await sb.from('stream_cohosts')
        .update({ status: 'removed' }).eq('stream', streamId).eq('user', userId);
    if (upErr) throw upErr;
    return { outcome: 'removed' };
}

export async function isFullHdAllowed(stream) {
    const { data, error } = await sb.rpc('stream_full_hd_test_allowed', { p_stream_id: stream.id, p_owner_id: stream.author });
    if (error) throw error;
    return data === true;
}
