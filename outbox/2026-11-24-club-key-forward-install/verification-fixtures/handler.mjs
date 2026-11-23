import { clubPaymentLink } from './clubPayment.mjs';
// Testable server bridge to the EXISTING Prodamus merchant and BuyCourse callback.
export function createCheckoutHandler({ fetch: request, env, uuid = () => crypto.randomUUID() }) {
    const origin = env.SITE_ORIGIN || 'https://app.meetgu.ru';
    const supabase = (env.SUPABASE_URL || '').replace(/\/$/, '');
    const merchant = 'https://meetguru.payform.ru/';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info', 'access-control-allow-methods': 'POST,OPTIONS', vary: 'Origin' };
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store', 'x-meetguru-checkout-version': 'payform-host-1', 'x-meetguru-club-version': 'club-rpc-1' } });
    const rpc = async (name, args, authorization, key) => {
        const r = await request(`${supabase}/rest/v1/rpc/${name}`, {
            method: 'POST', headers: { apikey: key, Authorization: authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify(args), signal: AbortSignal.timeout(12000),
        });
        if (!r.ok) {
            const body = await r.json().catch(() => null);
            const known = ['already_owned','already_registered','product_not_available','checkout_disabled','payment_link_in_progress','checkout_cancelled'];
            const e = new Error('checkout_rpc_failed');
            e.upstreamStatus = r.status;
            if (/^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(body?.code || '')) e.upstreamCode = body.code;
            if (known.includes(body?.message)) e.safeCode = body.message;
            throw e;
        }
        return r.status === 204 ? null : r.json();
    };
    return async req => {
        if (req.headers.get('Origin') && req.headers.get('Origin') !== origin) return json({ error: 'origin_not_allowed' }, 403);
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        if (!supabase || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'checkout_not_configured' }, 503);
        const auth = req.headers.get('Authorization') || '';
        if (!/^Bearer\s+\S+$/.test(auth)) return json({ error: 'unauthorized' }, 401);
        let payload;
        try { payload = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
        let order, stage = 'auth';
        try {
            const who = await request(`${supabase}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth }, signal: AbortSignal.timeout(12000) });
            if (!who.ok) return json({ error: 'unauthorized' }, 401);
            const actor = (await who.json())?.id;
            if (!actor) return json({ error: 'unauthorized' }, 401);
            const userRpc = (name, body) => rpc(name, body, auth, env.SUPABASE_ANON_KEY);
            const serviceRpc = (name, body) => rpc(name, body, 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SERVICE_ROLE_KEY);
            if (payload.kind === 'club') {
                stage = 'club_link';
                return json(await clubPaymentLink({ payload, actor, userRpc, serviceRpc, request, env, uuid }));
            }
            order = payload.order_id;
            if (!order) {
                stage = 'prepare';
                const prepared = await userRpc('checkout_prepare', { p_request_id: payload.request_id, p_shop_ids: payload.shop_ids, p_code: payload.promo_code || null });
                order = prepared.order_id;
            }
            const lease = uuid();
            stage = 'claim';
            const claim = await serviceRpc('checkout_acquire_link', { p_order_id: order, p_actor_id: actor, p_lease: lease });
            if (claim.completed) return json({ completed: true, order_id: order });
            if (claim.zero) {
                stage = 'zero_complete';
                const r = await serviceRpc('checkout_complete_zero', { p_order_id: order, p_actor_id: actor });
                if (!['fulfilled', 'already_completed'].includes(r.status)) return json({ error: r.status, order_id: order }, 409);
                return json({ completed: true, order_id: order });
            }
            let link = claim.payLink;
            if (!link) {
                const url = new URL(merchant);
                url.searchParams.set('do', 'link'); url.searchParams.set('sys', 'meetguru');
                url.searchParams.set('order_id', order); url.searchParams.set('urlSuccess', origin + '/');
                for (const [i, line] of claim.lines.entries()) {
                    url.searchParams.set(`products[${i}][name]`, line.name);
                    url.searchParams.set(`products[${i}][price]`, String(line.price));
                    url.searchParams.set(`products[${i}][quantity]`, '1');
                }
                // No browser amount/products, no client success URL, no provider call on a replay.
                stage = 'provider_fetch';
                const response = await request(url.href, { signal: AbortSignal.timeout(12000), redirect: 'error' });
                if (!response.ok) { const error = new Error('provider_unavailable'); error.upstreamStatus = response.status; throw error; }
                stage = 'provider_response';
                link = (await response.text()).trim();
                let parsed; try { parsed = new URL(link); } catch { throw new Error('invalid_payment_link'); }
                if (parsed.protocol !== 'https:' || !['meetguru.payform.ru', 'payform.ru'].includes(parsed.hostname) || parsed.port || parsed.username || parsed.password) throw new Error('invalid_payment_link');
                link = parsed.href;
                stage = 'store';
                await serviceRpc('checkout_store_link', { p_order_id: order, p_actor_id: actor, p_lease: lease, p_link: link });
            }
            return json({ order_id: order, payLink: link });
        } catch (e) {
            // Do not log headers, raw DB errors, customer payloads or provider URLs.
            // Keep the immutable order; retry uses the same intent/order. Never replay a payment.
            return json({ error: e.safeCode || 'checkout_unavailable', stage, ...(e.upstreamStatus ? { upstream_status: e.upstreamStatus } : {}), ...(e.upstreamCode ? { upstream_code: e.upstreamCode } : {}), message: order ? 'Не удалось открыть оплату. Повторите попытку: заказ сохранён.' : 'Не удалось оформить заказ. Проверьте товары и повторите попытку.' }, e.safeCode ? 409 : 503);
        }
    };
}
