// Тесты чистой логики web-push-send (Node, без Deno/webpush). Извлекают РЕАЛЬНЫЙ блок
// между маркерами «=== PURE LOGIC ===» … «=== /PURE LOGIC ===» из index.ts и прогоняют на нём
// проверки — чтобы тест ловил расхождение с задеплоенным кодом.
// Запуск: node supabase/functions/web-push-send/logic.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(DIR, 'index.ts'), 'utf8');
const m = src.match(/=== PURE LOGIC[\s\S]*?\n([\s\S]*?)\/\/ === \/PURE LOGIC/);
if (!m) { console.error('PURE LOGIC блок не найден'); process.exit(1); }
const body = m[1].replace(/export function/g, 'function');
// eval блока в изолированной области, возвращаем нужные функции
const factory = new Function(`${body}\n;return { validatePayload, pickRecipients, pickDmRecipients, dmNotifText };`);
const { validatePayload, pickRecipients, pickDmRecipients, dmNotifText } = factory();

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }
function eq(name, a, b) { ok(name + ` (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b)); }

const U = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const BAD = 'not-a-uuid';

// --- validatePayload ---
eq('vp direct_message ok', validatePayload({ event: 'direct_message', message_id: U }), { event: 'direct_message', messageId: U });
eq('vp direct_message bad id', validatePayload({ event: 'direct_message', message_id: BAD }), { error: 'bad_message_id' });
eq('vp direct_message no id', validatePayload({ event: 'direct_message' }), { error: 'bad_message_id' });
eq('vp direct_message не требует stream_id', validatePayload({ event: 'direct_message', message_id: U }).error, undefined);
eq('vp stream_start ok', validatePayload({ event: 'stream_start', stream_id: U }), { event: 'stream_start', streamId: U, messageId: null });
eq('vp stream_start bad stream', validatePayload({ event: 'stream_start', stream_id: BAD }), { error: 'bad_stream_id' });
eq('vp chat_message ok', validatePayload({ event: 'chat_message', stream_id: U, message_id: U2 }), { event: 'chat_message', streamId: U, messageId: U2 });
eq('vp chat_message no msg', validatePayload({ event: 'chat_message', stream_id: U }), { error: 'bad_message_id' });
eq('vp bad event', validatePayload({ event: 'nope', stream_id: U }), { error: 'bad_event' });

// --- pickDmRecipients ---
const AL = new Set([U, U2, 'c']);
eq('dm: все участники кроме отправителя',
  [...pickDmRecipients({ users: ['a', 'b', 'c'], senderId: 'a', optedOut: new Set(), allowAll: true })].sort(), ['b', 'c']);
eq('dm: отсекаем send_notif=false',
  [...pickDmRecipients({ users: ['a', 'b', 'c'], senderId: 'a', optedOut: new Set(['b']), allowAll: true })].sort(), ['c']);
eq('dm: allowlist фильтрует (allowAll=false)',
  [...pickDmRecipients({ users: ['a', 'b', U], senderId: 'a', optedOut: new Set(), allowAll: false, allowlist: AL })], [U]);
eq('dm: пустой allowlist при allowAll=false → никого',
  [...pickDmRecipients({ users: ['a', 'b'], senderId: 'a', optedOut: new Set(), allowAll: false, allowlist: new Set() })], []);
eq('dm: отправитель не дублируется если дважды в users',
  [...pickDmRecipients({ users: ['a', 'a', 'b'], senderId: 'a', optedOut: new Set(), allowAll: true })], ['b']);

// --- dmNotifText ---
eq('dm text: 1-на-1 = имя/текст',
  dmNotifText({ isGroup: false, senderName: 'Аня', text: 'привет', hasAttachment: false }), { title: 'Аня', body: 'привет' });
eq('dm text: группа = title + «Имя: текст»',
  dmNotifText({ isGroup: true, chatTitle: 'Клуб', senderName: 'Аня', text: 'всем привет', hasAttachment: false }),
  { title: 'Клуб', body: 'Аня: всем привет' });
eq('dm text: вложение фото',
  dmNotifText({ isGroup: false, senderName: 'Аня', hasAttachment: true, attachmentType: 'image' }), { title: 'Аня', body: '[фото]' });
eq('dm text: вложение голосовое',
  dmNotifText({ isGroup: false, senderName: 'Аня', hasAttachment: true, attachmentType: 'audio' }), { title: 'Аня', body: '[голосовое]' });
eq('dm text: вложение файл',
  dmNotifText({ isGroup: false, senderName: 'Аня', hasAttachment: true, attachmentType: 'pdf' }), { title: 'Аня', body: '[файл]' });
const long = 'я'.repeat(200);
ok('dm text: обрезка ~100', dmNotifText({ isGroup: false, senderName: 'Аня', text: long, hasAttachment: false }).body.length <= 100);
eq('dm text: пустой текст → «Новое сообщение»',
  dmNotifText({ isGroup: false, senderName: 'Аня', text: '', hasAttachment: false }), { title: 'Аня', body: 'Новое сообщение' });
eq('dm text: нет имени → «Пользователь»',
  dmNotifText({ isGroup: false, text: 'hi', hasAttachment: false }).title, 'Пользователь');

// --- pickRecipients (эфир) — регресс, не сломали ---
eq('эфир: stream_start = зрители+автор',
  [...pickRecipients({ event: 'stream_start', authorId: 'auth', isPaid: false, buyers: new Set(), reminders: new Set(['v1']), cohosts: new Set(), allowAll: true })].sort(),
  ['auth', 'v1']);
eq('эфир: chat от зрителя → автор+ведущие, без отправителя',
  [...pickRecipients({ event: 'chat_message', authorId: 'auth', isPaid: false, buyers: new Set(), reminders: new Set(['v1']), cohosts: new Set(['co']), senderId: 'v1', allowAll: true })].sort(),
  ['auth', 'co']);

console.log(`\nweb-push-send logic: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
