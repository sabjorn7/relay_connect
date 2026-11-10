// One server-owned cart, backed by the existing shop table. Never fall back to client pricing.
export const PRODUCT_LABELS = Object.freeze({ course: 'Курс', event: 'Мероприятие', stream: 'Трансляция' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERRORS = {
    already_owned: 'Этот продукт уже приобретён.', already_registered: 'Вы уже записаны на мероприятие.',
    product_not_available: 'Продукт сейчас недоступен для покупки.', terms_required: 'Подтвердите согласие с условиями участия.',
    product_already_in_pending_order: 'Этот продукт уже есть в ожидающем оплаты заказе. Откройте заказы в корзине.',
    stream_access_ended: 'Срок доступа к этому эфиру завершён.', checkout_disabled: 'Оформление временно недоступно.',
};
export async function checkoutRpc(sb, name, args = {}) {
    if (!sb) throw new Error('Нет связи с аккаунтом. Обновите страницу.');
    const { data, error } = await sb.rpc(name, args);
    if (error) throw new Error(ERRORS[error.message] || 'Не удалось обновить корзину. Повторите попытку.');
    return data;
}
export async function addProduct(sb, { type, id, paymentType = 'full', renewal = false, agreed = false }) {
    if (!Object.hasOwn(PRODUCT_LABELS, type) || !UUID.test(id || '')) throw new Error('Некорректный товар.');
    if (!['full', 'deposit'].includes(paymentType) || (paymentType === 'deposit' && type !== 'event')) throw new Error('Некорректный вариант оплаты.');
    return checkoutRpc(sb, 'cart_add_product', {
        p_type: type, p_product_id: id, p_payment_type: paymentType,
        p_renewal: renewal === true, p_agreed: agreed === true,
    });
}
export const getCart = sb => checkoutRpc(sb, 'cart_get');
export const removeProduct = (sb, id) => checkoutRpc(sb, 'cart_remove', { p_shop_id: id });
export const quoteCart = (sb, ids, code = null) => checkoutRpc(sb, 'cart_quote', { p_shop_ids: ids, p_code: code });
export const cancelCheckout = (sb, id) => checkoutRpc(sb, 'checkout_cancel', { p_order_id: id });
export function openSharedCart() {
    setTimeout(() => window.dispatchEvent(new CustomEvent('mg-open-cart')), 0);
}
export function checkoutIntent(storage, userId, ids, code, randomUUID = () => crypto.randomUUID()) {
    const key = 'mg.checkout.intent:' + userId + ':' + JSON.stringify([...ids].sort()) + ':' + (code || '').trim().toUpperCase();
    try {
        const old = storage?.getItem(key);
        if (UUID.test(old || '')) return old;
        const id = randomUUID(); storage?.setItem(key, id); return id;
    } catch { return randomUUID(); }
}
export async function payCart(sb, { userId, ids, code = null, orderId = null, storage = globalThis.sessionStorage }) {
    if (!UUID.test(userId || '') || (!orderId && !ids?.length)) throw new Error('Войдите в аккаунт и добавьте товары.');
    const body = orderId ? { order_id: orderId } : {
        request_id: checkoutIntent(storage, userId, ids, code), shop_ids: ids, promo_code: code,
    };
    const { data, error } = await sb.functions.invoke('checkout-pay-link', { body });
    let problem = data;
    if (error?.context?.json) { try { problem = await error.context.json(); } catch { /* no raw response logging */ } }
    if (error || problem?.error) throw new Error(ERRORS[problem?.error] || problem?.message || 'Не удалось открыть оплату. Повторите попытку — заказ будет использован повторно.');
    if (data?.completed === true) return { completed: true, orderId: data.order_id };
    let url; try { url = new URL(data?.payLink); } catch { throw new Error('Сервис оплаты не вернул ссылку.'); }
    if (url.protocol !== 'https:' || url.username || url.password || !['meetguru.payform.ru'].includes(url.hostname)) throw new Error('Сервис оплаты вернул неподтверждённую ссылку.');
    return { payLink: url.href, orderId: data.order_id };
}
