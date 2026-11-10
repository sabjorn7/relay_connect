<template>
    <section v-if="orders.length || error" class="checkout-orders" aria-label="Незавершённые заказы">
        <h3>Заказы</h3>
        <article v-for="order in orders" :key="order.order_id">
            <p>{{ (order.items || []).map(i => i.name).join(', ') }}</p>
            <p>{{ money(order.total) }} ₽ · {{ labels[order.status] || order.status }}</p>
            <div v-if="['pending','legacy_pending'].includes(order.status)">
                <button type="button" :disabled="busy" @click="resume(order)">Продолжить оплату</button>
                <button v-if="order.status !== 'legacy_pending'" type="button" :disabled="busy" @click="cancel(order)">Отменить заказ</button>
            </div>
        </article>
        <p v-if="error" role="alert">{{ error }}</p>
    </section>
</template>
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { checkoutRpc, cancelCheckout, payCart } from './cartApi.js';
const props = defineProps({ supabase: Object, userId: String });
const emit = defineEmits(['changed']);
const orders = ref([]), busy = ref(false), error = ref('');
const labels = { pending: 'Ожидает оплаты', cancelled: 'Отменён', fulfilled: 'Выполнен', legacy_pending: 'Ранее созданный заказ' };
const money = v => Number(v).toLocaleString('ru-RU');
let timer, stopped = false;
async function load() {
    try { const rows = await checkoutRpc(props.supabase, 'checkout_my_orders'); if (!stopped) orders.value = rows; }
    catch { if (!stopped) error.value = 'Не удалось проверить состояние заказов.'; }
}
async function resume(order) {
    busy.value = true; error.value = '';
    try {
        const result = await payCart(props.supabase, { userId: props.userId, orderId: order.order_id });
        if (result.completed) { await load(); emit('changed'); }
        else window.location.assign(result.payLink);
    } catch (e) { error.value = e.message; }
    finally { busy.value = false; }
}
async function cancel(order) {
    busy.value = true; error.value = '';
    try { await cancelCheckout(props.supabase, order.order_id); await load(); emit('changed'); }
    catch { error.value = 'Не удалось отменить заказ. Проверьте состояние перед повтором.'; }
    finally { busy.value = false; }
}
onMounted(() => { load(); timer = setInterval(() => { if (!document.hidden) load(); }, 15000); });
onBeforeUnmount(() => { stopped = true; clearInterval(timer); });
</script>
<style scoped>
.checkout-orders { border-top: 1px solid #dfe5ed; margin-top: 16px; padding-top: 12px; font-size: 14px; }
h3 { margin: 0 0 8px; } article { border-bottom: 1px solid #dfe5ed; padding: 8px 0; overflow-wrap: anywhere; }
p { margin: 6px 0; } article div { display: flex; flex-wrap: wrap; gap: 8px; }
button { padding: 8px; border: 1px solid #c4d2e6; border-radius: 8px; background: white; color: #173b70; cursor: pointer; font: inherit; }
button:disabled { opacity: .6; cursor: wait; }
</style>
