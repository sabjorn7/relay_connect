// web-push-send (v3) — фан-аут веб-пушей. Вызов ТОЛЬКО по секрету x-push-key (constant-time vs env
// PUSH_SEND_KEY; verify_jwt=false). Пишет/читает БД service-role'ом.
//
// Вход (POST JSON):
//   { event: 'stream_start' | 'chat_message', stream_id: uuid, message_id?: uuid }  — события ЭФИРА;
//   { event: 'direct_message', message_id: uuid }                                    — чат /chats.
//   event/uuid валидируются; отправитель/текст читаются ИЗ БД (телу не доверяем).
// Получатели (сервер-сайд):
//   stream_start → платный: покупатели backing-курса (без истёкшего доступа, если курс срочный)+автор;
//                 бесплатный: opt-in «Напомнить»+автор.
//   chat_message → сообщение зрителя: автору+со-ведущим; автора/ведущего: зрителям с доступом.
//   direct_message → участники чата (chats.users[]) МИНУС отправитель, с учётом users.send_notif.
//   Автор сообщения исключается. Для эфира — rate-limit 5 мин на (эфир, человек).
// ALLOWLIST (fail-closed): PUSH_ALLOWLIST пусто/не задано → никому (allowlist_empty); '*' → всем;
//   иначе только перечисленным user_id. PUSH_ENABLED!='true' → не шлём (disabled).
// Логи/ответ: только счётчики recipients/subs/sent/failed/pruned/skippedRate + codes{statusCode:n}
//   (без endpoint/текста/id чатов). Любой REST с !res.ok (чтения) → 502 {db_error, where}.
// Деплой — вручную (копия папки в volumes/functions/ + пересоздание), как cheatsheet-import.

import webpush from 'npm:web-push@3.6.7';
import { SUPABASE_URL as SB_URL_CONST } from '../_shared/og.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? SB_URL_CONST;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PUSH_SEND_KEY = Deno.env.get('PUSH_SEND_KEY') ?? '';
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:info@meetgu.ru';
const PUSH_ENABLED = (Deno.env.get('PUSH_ENABLED') ?? 'false').toLowerCase() === 'true';
const ALLOW_RAW = (Deno.env.get('PUSH_ALLOWLIST') ?? '').trim();
const ALLOW_ALL = ALLOW_RAW === '*';
const ALLOWLIST = new Set(ALLOW_RAW.split(',').map((s) => s.trim()).filter((x) => x && x !== '*'));

const RATE_MIN = 5;
const CONCURRENCY = 20;
const TIME_BUDGET_MS = 25000;
const TTL = 3600;
const CHUNK = 100;

try { if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE); } catch (_) { /* проверится как server_misconfigured */ }

class DbError extends Error { where: string; constructor(where: string) { super('db_error'); this.where = where; } }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

async function keyOk(provided: string | null): Promise<boolean> {
  if (!PUSH_SEND_KEY || !provided) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
    crypto.subtle.digest('SHA-256', enc.encode(PUSH_SEND_KEY)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let d = 0; for (let i = 0; i < 32; i++) d |= x[i] ^ y[i];
  return d === 0;
}

function rest(method: string, path: string, body?: unknown, extra?: Record<string, string>) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(extra || {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
// Чтение с проверкой res.ok — при ошибке бросаем DbError(where) → 502 (без текста ответа БД).
async function dbGet(path: string, where: string): Promise<any[]> {
  const r = await rest('GET', path);
  if (!r.ok) throw new DbError(where);
  const j = await r.json().catch(() => null);
  return Array.isArray(j) ? j : [];
}
function chunk<T>(arr: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; }

// === PURE LOGIC (без Deno/webpush; тестируется локально в Node) ===============
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validatePayload(p) {
  const event = p && p.event;
  if (event === 'direct_message') {
    const messageId = String((p && p.message_id) || '');
    if (!UUID_RE.test(messageId)) return { error: 'bad_message_id' };
    return { event, messageId };              // direct_message: без stream_id
  }
  if (event !== 'stream_start' && event !== 'chat_message') return { error: 'bad_event' };
  const streamId = String((p && p.stream_id) || '');
  if (!UUID_RE.test(streamId)) return { error: 'bad_stream_id' };
  let messageId = null;
  if (event === 'chat_message') {
    messageId = String((p && p.message_id) || '');
    if (!UUID_RE.test(messageId)) return { error: 'bad_message_id' };
  }
  return { event, streamId, messageId };
}

// Эфир: кому слать — чистая функция над множествами (Set<user_id>).
export function pickRecipients(a) {
  const viewers = a.isPaid ? a.buyers : a.reminders;
  let rec = new Set();
  if (a.event === 'stream_start') {
    for (const u of viewers) rec.add(u);
    rec.add(a.authorId);
  } else {
    const senderIsHost = !!a.senderId && (a.senderId === a.authorId || a.cohosts.has(a.senderId));
    if (senderIsHost) {
      for (const u of viewers) rec.add(u);
    } else {
      rec.add(a.authorId);
      for (const u of a.cohosts) rec.add(u);
    }
    if (a.senderId) rec.delete(a.senderId);
  }
  rec.delete(''); rec.delete(null); rec.delete(undefined);
  if (!a.allowAll) rec = new Set([...rec].filter((u) => a.allowlist && a.allowlist.has(u)));
  return rec;
}

// /chats: получатели = участники чата минус отправитель, с учётом opt-out (send_notif===false).
export function pickDmRecipients(a) {
  let rec = new Set();
  for (const u of (a.users || [])) {
    if (!u || u === a.senderId) continue;
    if (a.optedOut && a.optedOut.has(u)) continue;
    rec.add(u);
  }
  if (!a.allowAll) rec = new Set([...rec].filter((u) => a.allowlist && a.allowlist.has(u)));
  return rec;
}

function truncate(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// /chats: заголовок/тело. 1-на-1: title=имя отправителя, body=текст; группа: title=название чата,
// body="Имя: текст". Вложение → «[фото]/[голосовое]/[файл]». Текст обрезается ~100.
export function dmNotifText(a) {
  const senderName = a.senderName || 'Пользователь';
  let content;
  if (a.hasAttachment) {
    content = a.attachmentType === 'image' ? '[фото]' : a.attachmentType === 'audio' ? '[голосовое]' : '[файл]';
  } else {
    content = truncate(a.text, 100);
  }
  if (!content) content = 'Новое сообщение';
  const title = a.isGroup ? (a.chatTitle || 'Групповой чат') : senderName;
  const body = a.isGroup ? `${senderName}: ${content}` : content;
  return { title: truncate(title, 100), body: truncate(body, 150) };
}
// === /PURE LOGIC =============================================================

// Общая рассылка: параллелизм + бюджет времени; прунит мёртвые подписки (404/410). Возвращает счётчики.
async function deliver(subs: any[], notif: string, urgency: 'high' | 'normal') {
  const deadline = Date.now() + TIME_BUDGET_MS;
  let sent = 0, failed = 0, pruned = 0;
  const codes: Record<string, number> = {};
  const toDisable: string[] = [];
  const pushedUsers = new Set<string>();
  let idx = 0;
  const worker = async () => {
    while (idx < subs.length && Date.now() < deadline) {
      const s = subs[idx++];
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, notif, { TTL, urgency });
        sent++; pushedUsers.add(s.user_id);
      } catch (err: any) {
        failed++;
        const code = err?.statusCode;
        const ck = code != null ? String(code) : 'net'; codes[ck] = (codes[ck] || 0) + 1;
        if (code === 404 || code === 410) { toDisable.push(s.id); pruned++; }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, subs.length) }, () => worker()));
  for (const c of chunk(toDisable, CHUNK)) {
    try { const r = await rest('PATCH', `push_subscriptions?id=in.(${c.join(',')})`, { disabled_at: new Date().toISOString() }); if (!r.ok) console.error('[web-push-send] prune-not-ok'); } catch (_) { /* best-effort */ }
  }
  return { sent, failed, pruned, codes, pushedUsers };
}

// Активные подписки получателей — чанками по 100.
async function fetchSubs(ids: string[]): Promise<any[]> {
  const subs: any[] = [];
  for (const c of chunk(ids, CHUNK)) {
    const rows = await dbGet(`push_subscriptions?user_id=in.(${c.join(',')})&disabled_at=is.null&select=id,user_id,endpoint,p256dh,auth`, 'push_subscriptions');
    subs.push(...rows);
  }
  return subs;
}

// --- Ветка /chats (direct_message) ---
async function handleDirectMessage(messageId: string, zero: any): Promise<Response> {
  const mRows = await dbGet(`messages?id=eq.${messageId}&select=id,chat,creator,text,attachment_type,attachment_url`, 'messages');
  const msg = mRows[0];
  if (!msg || !msg.chat) return json({ ok: true, event: 'direct_message', skipped: 'message_not_applicable', counts: zero });

  const cRows = await dbGet(`chats?id=eq.${msg.chat}&select=id,users,is_group,title`, 'chats');
  const chat = cRows[0];
  if (!chat) return json({ ok: true, event: 'direct_message', skipped: 'chat_not_found', counts: zero });

  const users: string[] = Array.isArray(chat.users) ? chat.users.filter(Boolean) : [];
  const others = users.filter((u) => u && u !== msg.creator);

  const optedOut = new Set<string>();
  let senderName = 'Пользователь';
  const lookupIds = Array.from(new Set([...others, msg.creator].filter(Boolean)));
  // чанки по 100 — большие группы иначе раздувают URL in.(...) и дают 502
  for (const c of chunk(lookupIds, CHUNK)) {
    const uRows = await dbGet(`users?id=in.(${c.join(',')})&select=id,Name,send_notif`, 'users');
    for (const u of uRows) {
      if (u.id === msg.creator && u.Name) senderName = u.Name;
      if (u.send_notif === false) optedOut.add(u.id);
    }
  }

  const recipients = pickDmRecipients({ users, senderId: msg.creator, optedOut, allowAll: ALLOW_ALL, allowlist: ALLOWLIST });
  if (!recipients.size) return json({ ok: true, event: 'direct_message', counts: { ...zero } });

  const ids = [...recipients];
  const subs = await fetchSubs(ids);
  if (!subs.length) return json({ ok: true, event: 'direct_message', counts: { ...zero, recipients: ids.length } });

  const { title, body } = dmNotifText({
    isGroup: !!chat.is_group, chatTitle: chat.title, senderName,
    text: msg.text, attachmentType: msg.attachment_type, hasAttachment: !!msg.attachment_url,
  });
  // data.url ведёт на конкретный чат (роутер /chats читает ?chat=). chatId — для tag в SW.
  const notif = JSON.stringify({ title, body, event: 'direct_message', data: { url: `/chats?chat=${chat.id}`, chatId: chat.id } });

  const { sent, failed, pruned, codes } = await deliver(subs, notif, 'normal');
  const counts = { recipients: ids.length, subs: subs.length, sent, failed, pruned, skippedRate: 0, codes };
  // Лог — только счётчики (без текста и без id чатов).
  console.log('[web-push-send]', JSON.stringify({ event: 'direct_message', ...counts }));
  return json({ ok: true, event: 'direct_message', counts });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!(await keyOk(req.headers.get('x-push-key')))) return json({ error: 'unauthorized' }, 401);
  if (!SUPABASE_URL || !SERVICE_KEY || !VAPID_PRIVATE || !VAPID_PUBLIC) return json({ error: 'server_misconfigured' }, 500);

  const zero = { recipients: 0, subs: 0, sent: 0, failed: 0, pruned: 0, skippedRate: 0, codes: {} };
  if (!PUSH_ENABLED) return json({ ok: true, disabled: true, counts: zero });
  if (!ALLOW_ALL && ALLOWLIST.size === 0) return json({ ok: true, reason: 'allowlist_empty', counts: zero });

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const v = validatePayload(payload);
  if ((v as any).error) return json({ error: (v as any).error }, 400);
  const { event, streamId, messageId } = v as any;

  try {
    if (event === 'direct_message') return await handleDirectMessage(messageId, zero);

    // --- Ветка эфира (stream_start / chat_message) ---
    const sRows = await dbGet(`streams?id=eq.${streamId}&select=id,title,author,price,backing_course_id`, 'streams');
    const stream = sRows[0];
    if (!stream) return json({ error: 'stream_not_found' }, 404);
    const isPaid = Number(stream.price) > 0 && !!stream.backing_course_id;
    const authorId = stream.author;

    const cohostRows = await dbGet(`stream_cohosts?stream=eq.${streamId}&role=eq.cohost&status=in.(invited,joined)&select=user`, 'stream_cohosts');
    const cohosts = new Set<string>(cohostRows.map((r: any) => r.user).filter(Boolean));

    let senderId: string | null = null;
    if (event === 'chat_message') {
      const mRows = await dbGet(`stream_chat?id=eq.${messageId}&select=id,stream,owner,deleted`, 'stream_chat');
      const msg = mRows[0];
      if (!msg || msg.deleted === true || msg.stream !== streamId) {
        return json({ ok: true, event, skipped: 'message_not_applicable', counts: zero });
      }
      senderId = msg.owner;
    }

    let buyers = new Set<string>();
    let reminders = new Set<string>();
    if (isPaid) {
      const cRows = await dbGet(`course?id=eq.${stream.backing_course_id}&select=DurationLong`, 'course');
      const dl = cRows[0] ? Number(cRows[0].DurationLong) : 0;
      const timeLimited = Number.isFinite(dl) && dl !== 0;
      let path = `user_course?course=eq.${stream.backing_course_id}&select=user`;
      if (timeLimited) path += `&or=(end_period.gte.${encodeURIComponent(new Date().toISOString())},end_period.is.null)`;
      const bRows = await dbGet(path, 'user_course');
      buyers = new Set(bRows.map((r: any) => r.user).filter(Boolean));
    } else {
      const rRows = await dbGet(`stream_reminders?stream_id=eq.${streamId}&select=user_id`, 'stream_reminders');
      reminders = new Set(rRows.map((r: any) => r.user_id).filter(Boolean));
    }

    let recipients = pickRecipients({ event, authorId, isPaid, cohosts, buyers, reminders, senderId, allowAll: ALLOW_ALL, allowlist: ALLOWLIST });
    if (!recipients.size) return json({ ok: true, event, counts: { ...zero } });

    let skippedRate = 0;
    if (event === 'chat_message') {
      const since = new Date(Date.now() - RATE_MIN * 60000).toISOString();
      const rrows = await dbGet(`push_rate?stream_id=eq.${streamId}&last_push_at=gte.${encodeURIComponent(since)}&select=user_id`, 'push_rate');
      const recent = new Set(rrows.map((r: any) => r.user_id));
      const before = recipients.size;
      recipients = new Set([...recipients].filter((u) => !recent.has(u)));
      skippedRate = before - recipients.size;
      if (!recipients.size) return json({ ok: true, event, counts: { ...zero, skippedRate } });
    }

    const ids = [...recipients];
    const subs = await fetchSubs(ids);
    if (!subs.length) return json({ ok: true, event, counts: { ...zero, recipients: ids.length } });

    const title = event === 'stream_start' ? 'Эфир начинается' : 'Новое сообщение в чате эфира';
    const notif = JSON.stringify({ title, body: stream.title || 'Трансляция', event, data: { url: `/streams?stream=${streamId}` } });

    const { sent, failed, pruned, codes, pushedUsers } = await deliver(subs, notif, event === 'stream_start' ? 'high' : 'normal');

    if (event === 'chat_message' && pushedUsers.size) {
      const now = new Date().toISOString();
      const rows = [...pushedUsers].map((u) => ({ stream_id: streamId, user_id: u, last_push_at: now }));
      for (const c of chunk(rows, CHUNK)) {
        try { const r = await rest('POST', 'push_rate', c, { Prefer: 'resolution=merge-duplicates' }); if (!r.ok) console.error('[web-push-send] rate-not-ok'); } catch (_) { /* best-effort */ }
      }
    }

    const counts = { recipients: ids.length, subs: subs.length, sent, failed, pruned, skippedRate, codes };
    console.log('[web-push-send]', JSON.stringify({ event, stream: streamId, ...counts }));
    return json({ ok: true, event, counts });
  } catch (e: any) {
    if (e instanceof DbError) { console.error('[web-push-send] db_error', e.where); return json({ error: 'db_error', where: e.where }, 502); }
    console.error('[web-push-send] error', e?.message ?? e);
    return json({ error: 'internal' }, 500);
  }
}

Deno.serve(handler);
