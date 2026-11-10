// Supabase data helpers for the "Трансляции" (live streams) feature.
// Requires pending_stream_visibility.sql for unlisted access; never falls back to broad reads.
import { videoProfile } from './videoQuality.js';
import { STREAM_VIEW_FIELDS, validateVisibility, requireUnlistedSupport } from './visibility.js';

// Roles allowed to create a broadcast (same set as the subscriptions feature).
export const STREAMER_ROLES = ['Спикер', 'Учебное заведение'];

/**
 * Resolve the current user's `users` row on a standalone (non-WeWeb) route, where the WeWeb
 * current-user collection may not be populated. We go through the Supabase auth session and
 * match the `users` row by id (users.id == auth uid for this project), falling back to email.
 */
export async function getCurrentUser(supabase) {
    const { data: sessionData } = await supabase.auth.getSession();
    const authUser = sessionData?.session?.user;
    if (!authUser) return null;

    let { data } = await supabase.from('users').select('*').eq('id', authUser.id).limit(1);
    if (!data?.length && authUser.email) {
        ({ data } = await supabase.from('users').select('*').eq('email', authUser.email).limit(1));
    }
    return data?.[0] ?? null;
}

export function canStream(user) {
    return !!user && STREAMER_ROLES.includes(user.role);
}

/** Insert a stream metadata row. `peertube_video_id` = the live video uuid. price 0 = free.
 *  `scheduled_at` = planned start (ISO) or null. */
export async function createStream(supabase, { author, title, description = '', price = 0, peertube_video_id = null, access_months = null, backing_course_id = null, scheduled_at = null, mode = 'solo', chat_enabled = false, recording_course_enabled = false, cover_url = null, visibility = 'public', video_quality = 'hd' }) {
    videoProfile(video_quality);
    validateVisibility({ visibility, price, backing_course_id, chat_enabled, recording_course_enabled });
    await requireUnlistedSupport(supabase, visibility);
    // chat_enabled=true → the BEFORE INSERT trigger tg_stream_create_chat auto-creates a group chat
    // (shared `chats` table, same as events) and fills streams.chat. Buyers are then added by
    // tg_stream_bought_add_to_chat when their user_course on the backing course appears.
    // recording_course_enabled=true → tg_stream_create_recording_course auto-creates a catalog-ready
    // DRAFT course (Buy=true, price=stream price) in streams.recording_course; buyers get a free 2nd
    // user_course on it via tg_stream_bought_grant_recording. When the stream ENDS,
    // tg_stream_ended_publish_recording attaches the replay video as a lesson and publishes it →
    // it appears in /all_course as «Запись семинара» and in «Мои курсы» of everyone who bought.
    const { data, error } = await supabase
        .from('streams')
        .insert({ author, title, description, price, peertube_video_id, access_months, backing_course_id, scheduled_at, mode, chat_enabled, recording_course_enabled, cover_url, visibility, video_quality })
        .select(STREAM_VIEW_FIELDS)
        .limit(1);
    if (error) throw new Error(`Не удалось сохранить эфир: ${error.message}`);
    return data?.[0];
}

/** Update editable stream metadata (author only; enforced by RLS after the visibility migration). Whitelisted fields — never touches
 *  price/backing_course/mode/peertube. `cover_url`/`scheduled_at`/`title`/`description` only. */
export async function updateStream(supabase, streamId, fields) {
    const patch = {};
    if ('video_quality' in fields) videoProfile(fields.video_quality);
    for (const k of ['title', 'description', 'cover_url', 'scheduled_at', 'video_quality']) {
        if (k in fields) patch[k] = fields[k];
    }
    const { error } = await supabase.from('streams').update(patch).eq('id', streamId);
    if (error) throw new Error(`Не удалось сохранить эфир: ${error.message}`);
}

// ============================ PAID STREAMS (Phase 3) ============================
// Variant 1 — a paid stream is backed by a hidden `course` row; the UNTOUCHED BuyCourse
// pipeline grants access via user_course on it. The functions below that create the backing
// course and initiate the purchase are the ONLY money-adjacent code — reviewed before deploy.

/**
 * MONEY-ADJACENT: create the hidden backing `course` for a paid stream. Kept out of the catalog
 * (ModStatus != 'Опубликовано', slug stays null). `owner` credits sales/balance to the author;
 * `Price` drives the charge and the seller-revenue calc; `DurationLong` = months (informational
 * here — our gate computes expiry from the air date, see accessExpiry()).
 */
export async function createBackingCourse(supabase, { owner, title, price, months }) {
    const { data, error } = await supabase
        .from('course')
        .insert({
            owner,
            Title: title,
            Price: price,
            Free: false,
            DurationLong: months,
            Category: 'Трансляции',
            ModStatus: 'Черновик', // NOT 'Опубликовано' → excluded from the catalog
        })
        .select('id')
        .limit(1);
    if (error) throw new Error(`Не удалось создать курс-подложку: ${error.message}`);
    return data?.[0]?.id;
}

// Paid checkout is owned by the shared cart; there is no stream-specific payment path.

// ---------- access gate (NOT money) ----------

/** Air date a paid stream's access window is measured from. */
export function streamAirDate(stream) {
    return new Date(stream.scheduled_at || stream.created_at);
}

/** When paid access ends: air date + access_months. null for free / no duration. */
export function accessExpiry(stream) {
    if (!stream.access_months) return null;
    const e = streamAirDate(stream);
    e.setMonth(e.getMonth() + Number(stream.access_months));
    return e;
}

/** Whether the user has purchased this stream (a user_course row on the backing course exists). */
export async function hasBoughtStream(supabase, stream, userId) {
    if (!stream.backing_course_id || !userId) return false;
    const { data } = await supabase
        .from('user_course')
        .select('id')
        .eq('course', stream.backing_course_id)
        .eq('user', userId)
        .or('buy.eq.true,Free.eq.true')
        .limit(1);
    return !!data?.length;
}

/** Buyers of a paid stream (author view): user_course rows on the backing course + user Name/email,
 *  oldest purchase first. Streams have no "pending registration" like events — a row here = paid. */
export async function listStreamBuyers(supabase, stream) {
    if (!stream.backing_course_id) return [];
    const { data: ucs } = await supabase
        .from('user_course')
        .select('id, "user", created_at')
        .eq('course', stream.backing_course_id)
        .order('created_at', { ascending: true });
    const rows = ucs || [];
    const ids = [...new Set(rows.map((r) => r.user).filter(Boolean))];
    let byId = {};
    if (ids.length) {
        const { data: us } = await supabase.from('users').select('id, "Name", email').in('id', ids);
        byId = Object.fromEntries((us || []).map((u) => [u.id, u]));
    }
    return rows.map((r) => ({ id: r.id, created_at: r.created_at, user: byId[r.user] || null }));
}

/** All streams by a given author, newest first (for the author's own list). */
export async function listMyStreams(supabase, authorId) {
    const { data, error } = await supabase
        .from('streams')
        .select(STREAM_VIEW_FIELDS)
        .eq('author', authorId)
        .order('created_at', { ascending: false });
    if (error) throw new Error(`Не удалось загрузить эфиры: ${error.message}`);
    return data ?? [];
}

/** Flip a stream's cached status (used by the author's "я в эфире" / "завершить" actions). */
export async function setStreamStatus(supabase, streamId, status) {
    const { error } = await supabase.from('streams').update({ status }).eq('id', streamId);
    if (error) throw new Error(`Не удалось обновить статус: ${error.message}`);
}

import { deleteLive } from '@/_front/streams/peertubeLive.js';

/**
 * Delete a stream (author-only). Delegates to the `delete_stream` RPC, which enforces the guard
 * server-side (caller must be the author via auth.uid()):
 *   - no purchases  → full hard delete (chat, dangling carts, draft backing course, streams row)
 *   - has purchases → soft-delete (hidden=true); buyers keep access, money/replay untouched.
 * On a hard delete we also remove the PeerTube video (best-effort — that needs the API, not the DB).
 * Returns the action taken: 'deleted' | 'hidden'.
 */
export async function deleteStream(supabase, stream) {
    const { data, error } = await supabase.rpc('delete_stream', { p_stream_id: stream.id });
    if (error) throw new Error(`Не удалось удалить эфир: ${error.message}`);
    const action = data?.action;
    if (action === 'deleted' && data?.peertube_video_id) {
        try {
            await deleteLive(supabase, data.peertube_video_id);
        } catch (e) {
            console.warn('[streams] PeerTube video delete failed:', e.message);
        }
    }
    return action; // 'deleted' | 'hidden'
}

// Public list ordering: live first, then scheduled, then ended; newest first within a group.
const STATUS_ORDER = { live: 0, scheduled: 1, ended: 2 };

/** Attach each stream's author user row (Name/Photo/role) via one batched lookup. */
async function attachAuthors(supabase, rows) {
    const ids = [...new Set(rows.map(r => r.author).filter(Boolean))];
    let byId = {};
    if (ids.length) {
        const { data: users } = await supabase.from('users').select('id,Name,Photo,role').in('id', ids);
        byId = Object.fromEntries((users || []).map(u => [u.id, u]));
    }
    return rows.map(r => ({ ...r, authorUser: byId[r.author] || null }));
}

/** All streams for the public list, with authors, ordered live → scheduled → ended.
 *  Soft-deleted (hidden) streams are excluded from the public browse list. */
export async function listAllStreams(supabase) {
    const { data, error } = await supabase.from('streams').select(STREAM_VIEW_FIELDS).eq('hidden', false).eq('visibility', 'public');
    if (error) throw new Error(`Не удалось загрузить эфиры: ${error.message}`);
    const rows = await attachAuthors(supabase, data || []);
    return rows.sort(
        (a, b) =>
            (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
            new Date(b.created_at) - new Date(a.created_at)
    );
}

/** A single stream (with author) for the detail view. */
export async function getStreamById(supabase, id, linkKey = null) {
    const { data, error } = await supabase.from('streams').select(STREAM_VIEW_FIELDS).eq('id', id).limit(1);
    if (error) throw new Error(`Не удалось загрузить эфир: ${error.message}`);
    if (!data?.length) {
        if (!/^[a-f0-9]{64}$/.test(linkKey || '')) return null;
        const result = await supabase.rpc('get_stream_by_link', { p_stream_id: id, p_key: linkKey });
        if (result.error) throw new Error('Не удалось открыть эфир по ссылке.');
        return result.data?.[0] || null;
    }
    const [row] = await attachAuthors(supabase, data);
    return row;
}


/** Capability returned only to the authenticated owner; never included in list/detail rows. */
export async function getStreamLinkKey(supabase, id) {
    const { data, error } = await supabase.rpc('get_my_stream_link', { p_stream_id: id });
    if (error || !/^[a-f0-9]{64}$/.test(data || '')) throw new Error('Не удалось получить ссылку скрытого эфира.');
    return data;
}

// ============================ VIEWER CHAT (stream_chat) ============================
// Public/paid UI access rules are unchanged. RLS prevents unlisted enumeration;
// link viewers prove their capability on each bounded read/write RPC. No persistent grants.

/** Attach each message's author (Name/Photo) via one batched users lookup. */
async function attachMessageAuthors(supabase, rows) {
    const ids = [...new Set(rows.map(r => r.owner).filter(Boolean))];
    let byId = {};
    if (ids.length) {
        const { data: users } = await supabase.from('users').select('id,Name,Photo').in('id', ids);
        byId = Object.fromEntries((users || []).map(u => [u.id, u]));
    }
    return rows.map(r => ({ ...r, authorUser: byId[r.owner] || null }));
}

/** Messages of a stream's chat (oldest first), with authors attached. */
export async function listStreamMessages(supabase, streamId, { limit = 200, linkKey = null } = {}) {
    if (linkKey) {
        const { data, error } = await supabase.rpc('get_stream_link_messages', { p_stream_id: streamId, p_key: linkKey, p_limit: limit });
        if (error) throw new Error('Не удалось загрузить чат по ссылке.');
        // Link RPC deliberately has no participant UUID/profile. Preserve own-message
        // and moderation actions through server-derived booleans, not client claims.
        return (data || []).map(m => ({ ...m, authorUser: { Name: m.is_mine ? 'Вы' : 'Участник' } }));
    }
    const { data, error } = await supabase
        .from('stream_chat')
        .select('*')
        .eq('stream', streamId)
        .neq('deleted', true)
        .order('created_at', { ascending: true })
        .limit(limit);
    if (error) throw new Error(`Не удалось загрузить чат: ${error.message}`);
    return attachMessageAuthors(supabase, data || []);
}

/** Post a message to a stream's chat. `img` is an optional array of image URLs (UI: phase 2). */
export async function sendStreamMessage(supabase, { stream, owner, text, img = [], linkKey = null }) {
    const clean = (text || '').trim();
    if (!clean && !(img && img.length)) throw new Error('Пустое сообщение.');
    if (linkKey) {
        const { data, error } = await supabase.rpc('send_stream_link_message', { p_stream_id: stream, p_key: linkKey, p_text: clean, p_img: img });
        if (error) throw new Error('Не удалось отправить сообщение. Проверьте доступ к эфиру.');
        return { id: data };
    }
    const { data, error } = await supabase
        .from('stream_chat')
        .insert({ stream, owner, text: clean, img })
        .select('*')
        .limit(1);
    if (error) throw new Error(`Не удалось отправить сообщение: ${error.message}`);
    return data?.[0];
}

/** Soft-delete: own message or stream owner. Enforced by RLS / capability RPC. */
export async function deleteStreamMessage(supabase, id, { streamId = null, linkKey = null } = {}) {
    if (linkKey) {
        const { error } = await supabase.rpc('delete_stream_link_message', { p_stream_id: streamId, p_key: linkKey, p_message_id: id });
        if (error) throw new Error('Не удалось удалить сообщение.');
        return;
    }
    const { error } = await supabase.from('stream_chat').update({ deleted: true }).eq('id', id);
    if (error) throw new Error(`Не удалось удалить сообщение: ${error.message}`);
}
