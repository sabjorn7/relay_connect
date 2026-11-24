// Chat message attachments (v1: one file per message — photo or document).
//
// The allowlist lives HERE and is mirrored by the `chat` storage bucket's
// allowed_mime_types (the authoritative server-side backstop). We map the file
// EXTENSION → mime and upload with an explicit contentType, because browsers
// frequently report .docx/.xlsx as application/octet-stream — which the bucket
// allowlist would (correctly) reject. Mapping by extension keeps client + bucket
// in agreement and never sends octet-stream.
//
// svg / html are deliberately NOT allowed: they render inline from the storage
// origin and would be a stored-XSS vector.

const BUCKET = 'chat';
// Mirror the profile/club convention (public bucket, flat UUID key). The double
// slash after the bucket is intentional and matches the working cover/photo URLs.
const STORAGE_URL = 'https://sb.meetgu.ru/storage/v1/object/public/chat//';

const MB = 1024 * 1024;
export const MAX_IMAGE = 10 * MB;
export const MAX_FILE = 25 * MB;

// extension → mime, split by kind (kind drives the bubble render + size cap)
const IMAGE_EXT = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};
const FILE_EXT = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    zip: 'application/zip',
};
// Voice messages (MediaRecorder output). All map to bucket-allowed mimes. NOT in
// ACCEPT_ATTR — the 📎 picker stays image+doc; audio only arrives via recording.
const AUDIO_EXT = {
    webm: 'audio/webm', ogg: 'audio/ogg', mp4: 'audio/mp4', m4a: 'audio/mp4', mp3: 'audio/mpeg',
};

// The <input type="file"> accept attribute (explicit extensions — NOT image/*,
// which would let heic/svg through).
export const ACCEPT_ATTR = '.' + [...Object.keys(IMAGE_EXT), ...Object.keys(FILE_EXT)].join(',.');

function extOf(name) { return (name.split('.').pop() || '').toLowerCase(); }

/** Validate against the allowlist + size caps. Returns { ok, kind, mime, ext } or { ok:false, error }. */
export function validateFile(file) {
    const ext = extOf(file.name);
    let kind = null; let mime = null; let max = 0;
    if (IMAGE_EXT[ext]) { kind = 'image'; mime = IMAGE_EXT[ext]; max = MAX_IMAGE; }
    else if (FILE_EXT[ext]) { kind = 'file'; mime = FILE_EXT[ext]; max = MAX_FILE; }
    else if (AUDIO_EXT[ext]) { kind = 'audio'; mime = AUDIO_EXT[ext]; max = MAX_FILE; }
    else return { ok: false, error: 'Недопустимый тип файла. Разрешены изображения и документы.' };

    if (file.size > max) {
        return { ok: false, error: `Файл слишком большой — максимум ${Math.round(max / MB)} МБ.` };
    }
    return { ok: true, kind, mime, ext };
}

// ── Voice recording (MediaRecorder) ─────────────────────────────────────────
// Preference order: webm/opus (Chrome/Firefox/Edge) → mp4/aac (Safari) → ogg.
const AUDIO_FORMATS = [
    { mimeType: 'audio/webm', ext: 'webm' },
    { mimeType: 'audio/mp4', ext: 'mp4' },
    { mimeType: 'audio/ogg', ext: 'ogg' },
];

/** First MediaRecorder format this browser supports, or null. */
export function pickAudioFormat() {
    if (typeof MediaRecorder === 'undefined') return null;
    for (const f of AUDIO_FORMATS) {
        try { if (MediaRecorder.isTypeSupported(f.mimeType)) return f; } catch (e) { /* noop */ }
    }
    return null;
}

/** True only if the browser can capture + record + encode audio (else hide the mic button). */
export function audioRecordingSupported() {
    return typeof navigator !== 'undefined'
        && !!navigator.mediaDevices?.getUserMedia
        && typeof MediaRecorder !== 'undefined'
        && !!pickAudioFormat();
}

/**
 * Validate + upload to the `chat` bucket with an explicit contentType (ext→mime).
 * Returns the message columns to store: { attachment_url, attachment_type, attachment_name, attachment_size }.
 * Throws a user-facing Error on validation or upload failure.
 */
export async function uploadChatFile(sb, file) {
    const v = validateFile(file);
    if (!v.ok) throw new Error(v.error);
    const key = `${crypto.randomUUID()}.${v.ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(key, file, { upsert: false, contentType: v.mime });
    if (error) throw new Error('Не удалось загрузить файл. Попробуйте ещё раз.');
    return {
        attachment_url: STORAGE_URL + key,
        attachment_type: v.kind,
        attachment_name: file.name,
        attachment_size: file.size,
    };
}

/** Human-readable size for the bubble/preview labels. */
export function formatBytes(n) {
    const b = Number(n);
    if (!b || b < 0) return '';
    if (b < 1024) return `${b} Б`;
    if (b < MB) return `${Math.round(b / 1024)} КБ`;
    return `${(b / MB).toFixed(1)} МБ`;
}
