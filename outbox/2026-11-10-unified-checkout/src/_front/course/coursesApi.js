import { addProduct, checkoutRpc } from '@/_front/checkout/cartApi.js';
// Course purchase / enrollment for the hand-written /course/:slug page (CoursePage.vue).
//
// Course actions share the server-owned cart. Free enrollment is a separate atomic
// server operation and never creates a payment order. BuyCourse settles paid orders.

// The logged-in buyer's `users` row: id + the two arrays the free grant appends to. Reads the stored
// session id (no getSession() — that acquires the Web Locks auth lock and can hang), then fetches the row.
export async function getBuyerRow(sb, uid) {
    if (!sb || !uid) return null;
    const { data } = await sb.from('users')
        .select('id, buied_courses, buied_course_orig')
        .eq('id', uid).limit(1);
    return data?.[0] || null;
}

// Whether the user already owns this course (a user_course row exists) — drives the "Уже в библиотеке" state.
export async function ownsCourse(sb, courseId, uid) {
    if (!sb || !courseId || !uid) return false;
    const { data } = await sb.from('user_course')
        .select('id').eq('course', courseId).eq('user', uid).or('buy.eq.true,Free.eq.true').limit(1);
    return !!data?.length;
}

// Server validates the free course and updates both enrollment and library arrays.
export async function enrollFree(sb, { course }) {
    if (window.__mgGuestAuth) throw new Error('Нет связи с аккаунтом. Обновите страницу.'); // (a') guard
    return checkoutRpc(sb, 'checkout_enroll_free_course', { p_course_id: course.id });
}

// Whether this course is already sitting in the user's cart (a `shop` row with status='cart') —
// drives the "В корзине" state and guards addToCart against stacking duplicate rows.
export async function courseInCart(sb, courseId, uid) {
    if (!sb || !courseId || !uid) return false;
    const { data } = await sb.from('shop')
        .select('id').eq('owner', uid).eq('status', 'cart').eq('course_id', courseId).limit(1);
    return !!data?.length;
}

// Server resolves canonical Price/DurationPrice and prevents duplicate cart rows.
export async function addToCart(sb, { buyer, course, renewal = false }) {
    if (window.__mgGuestAuth || !buyer?.id) throw new Error('Нет связи с аккаунтом. Обновите страницу.');
    const result = await addProduct(sb, { type: 'course', id: course.id, renewal });
    return result.reused !== true;
}
