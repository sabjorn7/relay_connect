// Shared, dependency-free Prodamus signing/verification. Never log bodies or signatures.
// https://help.prodamus.ru/payform/integracii/rest-api/instrukcii-dlya-samostoyatelnaya-integracii-servisov
export function canonical(value, depth = 0) {
    if (depth > 16) throw new Error('invalid_payload');
    if (value !== null && typeof value === 'object') {
        if (Array.isArray(value)) return '[' + value.map(v => canonical(v, depth + 1)).join(',') + ']';
        return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k], depth + 1)).join(',') + '}';
    }
    if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('invalid_payload');
    return JSON.stringify(String(value));
}
// n8n exposes urlencoded bracket keys flat; Prodamus signs the PHP-style nested tree.
// Verified against a retained signed notification, without printing its data/key.
export function expandFields(body) {
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('invalid_payload');
    const result = Object.create(null);
    for (const [key, value] of Object.entries(body)) {
        const parts = key.match(/^[^\[\]]+|\[([^\[\]]+)\]/g)?.map(x => x.startsWith('[') ? x.slice(1,-1) : x);
        if (!parts || parts.length > 16 || parts.some(k => ['__proto__','prototype','constructor'].includes(k))) throw new Error('invalid_payload');
        if (key !== parts[0] + parts.slice(1).map(k=>'['+k+']').join('')) throw new Error('invalid_payload');
        let target = result;
        for (let i=0;i<parts.length-1;i++) {
            const part=parts[i];
            if (Object.hasOwn(target,part) && (!target[part] || typeof target[part]!=='object' || Object.isFrozen(target[part]))) throw new Error('ambiguous_subscription');
            if (!Object.hasOwn(target,part)) target[part] = /^\d+$/.test(parts[i+1]) ? [] : Object.create(null);
            target=target[part];
        }
        const last=parts.at(-1);
        if (Object.hasOwn(target,last)) throw new Error('ambiguous_subscription');
        // Freeze supplied nested values so a later flat key cannot modify them.
        target[last] = value && typeof value==='object' ? Object.freeze(structuredClone(value)) : value;
    }
    return result;
}
export async function signature(body, secret) {
    if (!secret) throw new Error('signing_not_configured');
    const bytes = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', bytes.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key, bytes.encode(canonical(expandFields(body)).replace(/\//g, '\\/')));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export async function verifySignature(body, sign, secret) {
    if (typeof sign !== 'string' || !/^[a-f0-9]{64}$/i.test(sign) || !secret) return false;
    const expected = await signature(body, secret);
    let diff = 0; for (let i = 0; i < 64; i++) diff |= expected.charCodeAt(i) ^ sign.toLowerCase().charCodeAt(i);
    return diff === 0;
}
export function callbackFields(body) {
    const read = key => {
        const flat = body[`subscription[${key}]`], nested = body.subscription?.[key];
        if (flat !== undefined && nested !== undefined && String(flat) !== String(nested)) throw new Error('ambiguous_subscription');
        return String(flat ?? nested ?? '');
    };
    if (body.domain !== 'meetguru.payform.ru') throw new Error('merchant_mismatch');
    if (!['success','failed'].includes(body.payment_status)) throw new Error('unknown_payment_status');
    if (body.demo_mode !== undefined && String(body.demo_mode) !== '0') throw new Error('demo_payment');
    const amount = String(body.sum ?? '');
    if (!/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) throw new Error('invalid_amount');
    // Never guess the currency if the signed notification omits it.
    if (String(body.currency).toLowerCase() !== 'rub') throw new Error('currency_mismatch');
    if (!/^\d+$/.test(String(body.order_id)) || !/^\d+$/.test(read('id')) || !/^\d+$/.test(read('profile_id'))) throw new Error('invalid_reference');
    const renewal = read('autopayment');
    if (!['0','1'].includes(renewal)) throw new Error('unknown_payment_kind');
    return { p_order_id: body.order_num || null, p_subscription: read('id'), p_payment_id: String(body.order_id),
        p_profile_id: read('profile_id'), p_amount: amount, p_currency: 'rub', p_renewal: renewal === '1', p_paid: body.payment_status === 'success' };
}
export async function clubPaymentLink({ payload, actor, userRpc, serviceRpc, request, env, uuid }) {
    if (!env.PRODAMUS_SECRET_KEY) throw new Error('club_signing_not_configured');
    // Only club_id is accepted from the browser. Other fields cannot influence the order/link.
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(payload.club_id || '')) throw new Error('invalid_club');
    const order = await userRpc('club_prepare_subscription_order', { p_club_id: payload.club_id });
    const lease = uuid();
    const claim = await serviceRpc('club_acquire_payment_link', { p_order_id: order.id, p_actor_id: actor, p_lease: lease });
    if (claim.completed) return { completed: true, order_id: order.id };
    if (claim.payLink) return { order_id: order.id, payLink: claim.payLink };
    const fields = { do: 'link', sys: 'meetguru', subscription: claim.subscription_id, order_id: order.id,
        currency: claim.currency, urlSuccess: (env.SITE_ORIGIN || 'https://app.meetgu.ru') + '/club?club=' + claim.club_id };
    fields.signature = await signature(fields, env.PRODAMUS_SECRET_KEY);
    const response = await request('https://meetguru.payform.ru/', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields), redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error('club_provider_unavailable');
    const link = (await response.text()).trim();
    const parsed = new URL(link);
    if (parsed.protocol !== 'https:' || !['meetguru.payform.ru', 'payform.ru'].includes(parsed.hostname) || parsed.port || parsed.username || parsed.password) throw new Error('invalid_payment_link');
    await serviceRpc('club_store_payment_link', { p_order_id: order.id, p_actor_id: actor, p_lease: lease, p_link: parsed.href });
    return { order_id: order.id, payLink: parsed.href };
}
