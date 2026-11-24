export const CLUB_MESSAGE_UIDS = new Set(['05f4fc6d-d561-4c9f-9f57-4af63724f675', '2a3ed957-42b8-46a1-8551-58018509e747']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function clubMediaUrl(value) {
    if (typeof value !== 'string') return null;
    try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function clubMessageView(row, userId) {
    const owner = row?.owner && typeof row.owner === 'object' ? row.owner : {};
    const id = typeof row?.owner === 'string' ? row.owner : owner.id;
    const name = typeof owner.Name === 'string' && owner.Name.trim() ? owner.Name : 'Участник';
    const d = new Date(row?.created_at), pad = n => String(n).padStart(2, '0');
    return {
        name, initials: owner.Name ? owner.Name.trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase() || '·' : '·',
        mine: !!userId && userId === id,
        profileHref: UUID.test(id || '') ? `/profile_page?user=${id}` : undefined,
        photo: clubMediaUrl(owner.Photo),
        images: row?.deleted ? [] : [...new Set((Array.isArray(row?.img) ? row.img : []).map(clubMediaUrl).filter(Boolean))],
        time: row?.created_at && !isNaN(d) ? `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}` : '',
    };
}
