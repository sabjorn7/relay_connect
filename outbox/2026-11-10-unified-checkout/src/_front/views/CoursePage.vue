<!--
  CoursePage.vue — the course landing at /course/:slug in the MeetGuru promo (pd-*) brand language.
  Overrides the WeWeb `course_info` page. Content-only — the shared AppHeader/AppFooter come from
  App.vue. Course + author + lessons are fetched from Supabase.

  The "Купить" CTA is REAL (see @/_front/course/coursesApi.js, money-adjacent): guests go to /login,
  owners see "Уже в библиотеке" → /my_courses, free courses grant access directly, paid courses go
  through the cart → Prodamus. Buyers watch their lessons on /my_courses (this page never plays them).
-->
<template>
    <main class="pd" :class="{ 'is-ready': ready }" ref="rootEl">
        <template v-if="course">
            <!-- ── HERO ─────────────────────────────────────────────── -->
            <header class="pd-hero">
                <div class="pd-blob" aria-hidden="true"></div>
                <div class="pd-wrap pd-chero">
                    <div class="pd-chero__main">
                        <span class="pd-badge" data-reveal>
                            <span class="pd-badge__dot" aria-hidden="true"></span>{{ course.Category || 'Курс' }}
                        </span>
                        <h1 class="pd-hero__title--course" data-reveal>{{ course.Title }}</h1>
                        <p v-if="hook" class="pd-hero__hook" data-reveal>{{ hook }}</p>

                        <a v-if="author" class="pd-author-mini" :href="authorHref" data-reveal>
                            <img v-if="author.Photo" :src="author.Photo" :alt="author.Name" />
                            <span v-else class="pd-author-mini__ava">{{ authorInitials }}</span>
                            <span class="pd-author-mini__text"><span class="muted">Курс от</span><b>{{ author.Name }}</b></span>
                        </a>

                        <!-- teaser: cover as the poster (click to play); a video-less course shows the cover alone -->
                        <div v-if="course.video_id" class="pd-video" data-reveal>
                            <iframe v-if="teaserStarted" :src="teaserEmbed" title="Видео о курсе" frameborder="0"
                                allow="autoplay; fullscreen" allowfullscreen></iframe>
                            <button v-else type="button" class="pd-video__poster" aria-label="Смотреть видео о курсе" @click="teaserStarted = true">
                                <img v-if="course.cover" :src="course.cover" alt="" />
                                <span class="pd-video__play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
                            </button>
                        </div>
                        <div v-else-if="course.cover" class="pd-video pd-video--static" data-reveal>
                            <img :src="course.cover" :alt="course.Title" />
                        </div>
                    </div>

                    <aside class="pd-chero__side">
                        <div class="pd-buycard" data-reveal>
                            <div class="pd-buycard__price">
                                <span class="pd-buycard__now">{{ priceText }}</span>
                                <span v-if="discount" class="pd-buycard__old">{{ money(discount.oldPrice) }} ₽</span>
                            </div>
                            <template v-if="owns">
                                <button v-if="canRenew" class="pd-btn pd-btn--lg pd-btn--block" type="button" :disabled="buying" @click="onRenew">{{ renewLabel }}</button>
                                <a v-else class="pd-btn pd-btn--lg pd-btn--block" :href="myCoursesHref">Уже в библиотеке</a>
                                <a v-if="canRenew" class="pd-owned-link" :href="myCoursesHref">Уже куплено — открыть в «Мои курсы»</a>
                            </template>
                            <button v-else class="pd-btn pd-btn--lg pd-btn--block" type="button" :disabled="buying" @click="onBuy">{{ ctaLabel }}</button>
                            <p v-if="buyError" class="pd-buyerr">{{ buyError }}</p>
                            <ul class="pd-statlist">
                                <li v-for="(s, i) in statItems" :key="i">
                                    <svg viewBox="0 0 24 24" class="pd-ic" aria-hidden="true" v-html="STAT_ICONS[s.icon]"></svg>
                                    <span>{{ s.text }}</span>
                                </li>
                            </ul>
                        </div>
                    </aside>
                </div>
            </header>

            <!-- ── WHAT YOU'LL LEARN ────────────────────────────────── -->
            <section v-if="learnItems.length" class="pd-section pd-section--tint">
                <div class="pd-wrap">
                    <h2 class="pd-h2" data-reveal>Чему вы научитесь</h2>
                    <div class="pd-learn-text" data-reveal>
                        <p v-for="(t, i) in learnItems" :key="i">{{ t }}</p>
                    </div>
                </div>
            </section>

            <!-- ── PROGRAM (lessons) ────────────────────────────────── -->
            <section v-if="lessons.length" class="pd-section">
                <div class="pd-wrap">
                    <div class="pd-head">
                        <h2 class="pd-h2" data-reveal>Программа курса</h2>
                        <p class="pd-head__note" data-reveal>{{ lessons.length }} {{ lessonWord(lessons.length) }}.</p>
                    </div>
                    <ol class="pd-lessons">
                        <li v-for="(l, i) in lessons" :key="l.id" class="pd-lesson" data-reveal :style="{ '--i': Math.min(i, 6) }">
                            <span class="pd-lesson__num">{{ String(i + 1).padStart(2, '0') }}</span>
                            <span class="pd-lesson__title">{{ cleanLesson(l.Title) }}</span>
                        </li>
                    </ol>
                </div>
            </section>

            <!-- ── ABOUT ────────────────────────────────────────────── -->
            <section v-if="descrParagraphs.length" class="pd-section pd-section--tint">
                <div class="pd-wrap pd-about">
                    <h2 class="pd-h2" data-reveal>О курсе</h2>
                    <div class="pd-about__body" data-reveal>
                        <p v-for="(p, i) in descrParagraphs" :key="i">{{ p }}</p>
                    </div>
                </div>
            </section>

            <!-- ── FOR WHOM ─────────────────────────────────────────── -->
            <section v-if="forItems.length" class="pd-section">
                <div class="pd-wrap">
                    <h2 class="pd-h2" data-reveal>Кому подойдёт</h2>
                    <div class="pd-cards pd-cards--for">
                        <article v-for="(t, i) in forItems" :key="i" class="pd-forcard" data-reveal :style="{ '--i': Math.min(i, 6) }">
                            <span class="pd-forcard__dot" aria-hidden="true"></span>
                            <p>{{ t }}</p>
                        </article>
                    </div>
                </div>
            </section>

            <!-- ── REVIEWS ──────────────────────────────────────────── -->
            <section v-if="reviews.length" class="pd-section pd-section--tint">
                <div class="pd-wrap">
                    <div class="pd-head">
                        <h2 class="pd-h2" data-reveal>Отзывы</h2>
                        <p v-if="nRatings" class="pd-head__note" data-reveal>{{ nRatings }} {{ plural(nRatings, ['оценка', 'оценки', 'оценок']) }} · средняя {{ avgText }}</p>
                    </div>
                    <div class="pd-cards pd-cards--rev">
                        <article v-for="(r, i) in reviews" :key="i" class="pd-rev" data-reveal :style="{ '--i': Math.min(i, 5) }">
                            <div v-if="ratingByUser[r.user_id]" class="pd-rev__stars" :aria-label="`Оценка ${ratingByUser[r.user_id]} из 5`">
                                <svg v-for="n in 5" :key="n" viewBox="0 0 24 24" class="pd-star" :class="{ on: n <= ratingByUser[r.user_id] }" aria-hidden="true"><path d="M12 4l2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-4 5.6-.8z"/></svg>
                            </div>
                            <p class="pd-rev__text">{{ r.comment }}</p>
                            <div class="pd-rev__by">
                                <img v-if="r.photo" :src="r.photo" :alt="r.name" />
                                <span v-else class="pd-rev__ava">{{ reviewInitials(r.name) }}</span>
                                <div class="pd-rev__meta"><b>{{ r.name || 'Ученик' }}</b><span v-if="fmtDate(r.date)">{{ fmtDate(r.date) }}</span></div>
                            </div>
                        </article>
                    </div>
                </div>
            </section>

            <!-- ── PRICE ────────────────────────────────────────────── -->
            <section class="pd-price-wrap">
                <div class="pd-wrap">
                    <div class="pd-price" data-reveal>
                        <div class="pd-price__l">
                            <h2 class="pd-price__h">{{ course.Free ? 'Бесплатный курс' : 'Доступ к курсу' }}</h2>
                            <p class="pd-price__sub">{{ course.Title }}</p>
                            <ul class="pd-price__incl">
                                <li><svg viewBox="0 0 24 24" class="pd-ic" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>{{ lessons.length || course.Less_Id?.length || 0 }} {{ lessonWord(lessons.length || course.Less_Id?.length || 0) }} в записи</li>
                                <li v-if="course.DurationLong"><svg viewBox="0 0 24 24" class="pd-ic" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>Доступ на {{ course.DurationLong }} мес.<template v-if="course.DurationPrice">, продление {{ money(course.DurationPrice) }} ₽</template></li>
                                <li><svg viewBox="0 0 24 24" class="pd-ic" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>Смотрите на сайте и в приложении</li>
                            </ul>
                        </div>
                        <div class="pd-price__card">
                            <span class="pd-price__label">Стоимость</span>
                            <div class="pd-price__amount">
                                {{ course.Free ? 'Бесплатно' : money(course.Price) }}<span v-if="!course.Free" class="cur"> ₽</span>
                            </div>
                            <p v-if="discount" class="pd-price__old">{{ money(discount.oldPrice) }} ₽</p>
                            <template v-if="owns">
                                <button v-if="canRenew" class="pd-btn pd-btn--lg pd-btn--block" type="button" :disabled="buying" @click="onRenew">{{ renewLabel }}</button>
                                <a v-else class="pd-btn pd-btn--lg pd-btn--block" :href="myCoursesHref">Уже в библиотеке</a>
                            </template>
                            <button v-else class="pd-btn pd-btn--lg pd-btn--block" type="button" :disabled="buying" @click="onBuy">{{ ctaLabel }}</button>
                            <p v-if="buyError" class="pd-buyerr">{{ buyError }}</p>
                            <p v-else-if="canRenew && inCart" class="pd-price__demo">Продление в корзине — оформите заказ (значок в шапке).</p>
                            <p v-else-if="canRenew" class="pd-price__demo">Курс уже у вас — можно продлить доступ или открыть в «Мои курсы».</p>
                            <p v-else-if="owns" class="pd-price__demo">Курс уже у вас — смотрите в разделе «Мои курсы».</p>
                            <p v-else-if="inCart" class="pd-price__demo">Курс в корзине — оформите заказ в корзине (значок в шапке).</p>
                        </div>
                    </div>
                </div>
            </section>
        </template>

        <div v-else-if="loading" class="pd-state">Загрузка курса…</div>
        <div v-else class="pd-state pd-nf">
            <h2 class="pd-nf__t">Курс не найден</h2>
            <p class="pd-nf__p">Возможно, курс снят с публикации или ссылка устарела.</p>
            <a href="/all_course" class="pd-btn pd-btn--primary pd-nf__btn">Каталог курсов</a>
        </div>

        <!-- Guest auth prompt (same offer as /all_course: войти / зарегистрироваться, without leaving) -->
        <transition name="pd-modal">
            <div v-if="showAuthModal" class="pd-modal" role="dialog" aria-modal="true" aria-labelledby="pd-auth-title" @click.self="showAuthModal = false">
                <div class="pd-modal__card">
                    <button class="pd-modal__x" type="button" aria-label="Закрыть" @click="showAuthModal = false">×</button>
                    <img class="pd-modal__mascot" src="/images/minime-06.png" alt="" aria-hidden="true" width="626" height="626" />
                    <h2 id="pd-auth-title" class="pd-modal__title">Войдите, чтобы продолжить</h2>
                    <p class="pd-modal__text">Чтобы купить курс, войдите в аккаунт или зарегистрируйтесь — это займёт минуту.</p>
                    <div class="pd-modal__actions">
                        <a class="pd-btn pd-btn--lg pd-btn--block" href="/login">Войти</a>
                        <a class="pd-btn pd-btn--lg pd-btn--block pd-btn--ghost" href="/registration">Зарегистрироваться</a>
                    </div>
                </div>
            </div>
        </transition>
    </main>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { getCourseDiscount } from '@/_front/course/discount.js';
import { getSupabase, readStoredSession, authCookieUser } from '@/_front/chrome/headerAccount.js';
import { embedUrl } from '@/_front/streams/peertubeLive.js';
import { getBuyerRow, ownsCourse, enrollFree, addToCart, courseInCart } from '@/_front/course/coursesApi.js';

const route = useRoute();
const rootEl = ref(null);
const course = ref(null);
const author = ref(null);
const lessons = ref([]);
const students = ref(0);
const loading = ref(true);
const ready = ref(false);

// purchase state
const buyerId = ref(null);   // logged-in user's id (null = guest)
const buyer = ref(null);     // full users row (id + arrays) once resolved
const owns = ref(false);     // already has a user_course row for this course
const inCart = ref(false);   // this course is already in the header cart (status='cart')
const buying = ref(false);   // in-flight add/enroll (disables the CTA)
const buyError = ref('');
const showAuthModal = ref(false); // guest clicked Купить/Продлить → login/register prompt

function plural(n, forms) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
}
const asArray = (v) => (Array.isArray(v) ? v : []);
const nLessons = computed(() => lessons.value.length || course.value?.Less_Id?.length || 0);
const nMaterials = computed(() => lessons.value.filter((l) => (l.File || '').trim()).length);
const nStudents = computed(() => students.value);
// Отзывы — только отображение: сортируем по date, сначала новые; записи без даты (→ epoch) уходят в конец.
// Данные в БД не меняем; звёзды (по user_id), средняя и количество оценок не затрагиваются.
const reviews = computed(() => asArray(course.value?.comment)
    .filter((c) => (c?.comment || '').trim())
    .slice()
    .sort((a, b) => new Date(b?.date || 0) - new Date(a?.date || 0)));
const nReviews = computed(() => reviews.value.length);
const ratings = computed(() => asArray(course.value?.rating));
const nRatings = computed(() => ratings.value.length);
const avgRating = computed(() => {
    const r = ratings.value;
    if (!r.length) return 0;
    return r.reduce((s, it) => s + Number(it?.rating ?? it?.value ?? it ?? 0), 0) / r.length;
});
const avgText = computed(() => (nRatings.value ? avgRating.value.toFixed(1).replace('.0', '') : '0'));
// star rating per review (matched by user_id) so a comment card can show its author's grade.
const ratingByUser = computed(() => {
    const m = {};
    for (const r of ratings.value) if (r?.user_id != null) m[r.user_id] = Number(r.rating ?? 0);
    return m;
});
const statItems = computed(() => {
    const c = course.value || {};
    const items = [
        { icon: 'play', text: `${nLessons.value} ${plural(nLessons.value, ['урок', 'урока', 'уроков'])}` },
        { icon: 'doc', text: `${nMaterials.value} ${plural(nMaterials.value, ['материал', 'материала', 'материалов'])}` },
        { icon: 'users', text: `${nStudents.value} ${plural(nStudents.value, ['ученик', 'ученика', 'учеников'])}` },
        { icon: 'chat', text: `${nReviews.value} ${plural(nReviews.value, ['отзыв', 'отзыва', 'отзывов'])}` },
        { icon: 'star', text: `${nRatings.value} ${plural(nRatings.value, ['оценка', 'оценки', 'оценок'])} · ср. ${avgText.value}` },
    ];
    if (c.DurationLong) items.push({ icon: 'cal', text: `Доступ на ${c.DurationLong} ${plural(c.DurationLong, ['месяц', 'месяца', 'месяцев'])}` });
    if (Number(c.DurationLong) > 0 && Number(c.DurationPrice) > 0) items.push({ icon: 'renew', text: `Продление за ${money(c.DurationPrice)} ₽` });
    return items;
});
const STAT_ICONS = {
    play: '<path d="M9 5H4v14h5M9 5l11 7-11 7z" fill="none"/>',
    doc: '<path d="M6 3h9l4 4v14H6z" fill="none"/><path d="M14 3v5h5" fill="none"/>',
    users: '<circle cx="9" cy="8" r="3" fill="none"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0" fill="none"/><path d="M16 5.5a3 3 0 0 1 0 5.5" fill="none"/>',
    chat: '<path d="M4 5h16v11H9l-4 3v-3H4z" fill="none"/>',
    star: '<path d="M12 4l2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-4 5.6-.8z" fill="none"/>',
    cal: '<rect x="4" y="5" width="16" height="16" rx="2" fill="none"/><path d="M4 9h16M9 3v4M15 3v4" fill="none"/>',
    renew: '<path d="M4 12a8 8 0 0 1 13.6-5.7L20 8" fill="none"/><path d="M20 4v4h-4" fill="none"/><path d="M20 12a8 8 0 0 1-13.6 5.7L4 16" fill="none"/><path d="M4 20v-4h4" fill="none"/>',
};

// bullet lists are stored as "- item\n- item"; split, strip the marker, drop blanks.
function bullets(text) {
    return (text || '').split(/\n+/).map((l) => l.replace(/^[\s•\-–—*]+/, '').trim()).filter(Boolean);
}
const hook = computed(() => {
    const d = (course.value?.Decription || '').trim().split(/\n{2,}/)[0].trim();
    return d.length > 220 ? d.slice(0, 217).trimEnd() + '…' : d;
});
const descrParagraphs = computed(() => (course.value?.Decription || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean));
const learnItems = computed(() => bullets(course.value?.WhatTeach));
const forItems = computed(() => bullets(course.value?.For));
const priceText = computed(() => (course.value?.Free ? 'Бесплатно' : `${money(course.value?.Price)} ₽`));
const discount = computed(() => getCourseDiscount(course.value));
const teaserStarted = ref(false);
const teaserEmbed = computed(() => (course.value?.video_id ? embedUrl(course.value.video_id, { autoplay: true }) : ''));
// CTA label for the NON-owner button: free enroll, in-cart, or buy.
const ctaLabel = computed(() => {
    if (buying.value) return 'Секунду…';
    if (course.value?.Free) return 'Получить бесплатно';
    return inCart.value ? 'В корзине' : 'Добавить в корзину';
});
// Renewal is offered to owners only when the author set a positive DurationPrice (parity with the
// WeWeb course_info owner branch; DurationPrice<=0 → no self-serve renewal, just the library link).
const canRenew = computed(() => owns.value && Number(course.value?.DurationPrice) > 0);
// owned course → deep-link into its player (MyCoursePage reads ?course=<id>; bare /my_courses shows "Курс не найден")
const myCoursesHref = computed(() => `/my_courses?course=${course.value?.id}`);
const renewLabel = computed(() => {
    if (buying.value) return 'Секунду…';
    return inCart.value ? 'Продление в корзине — оформить' : `Продлить за ${money(course.value?.DurationPrice)} ₽`;
});

// Ask the shared AppHeader to open its cart dropdown (and reload it), so the user sees the item and
// can review/add more/checkout — matching the old "Купить → корзина" flow. Deferred a tick so the
// triggering click finishes bubbling first — otherwise the header's outside-click handler (the click
// lands outside .mgh__pop) would immediately close the cart we just opened.
function openHeaderCart() {
    setTimeout(() => window.dispatchEvent(new CustomEvent('mg-open-cart')), 0);
}

// Add this course to the cart. `renewal` = an owner extending access (charges DurationPrice); false =
// a fresh purchase (charges Price). Guests → /login; free courses are granted directly (not renewable).
async function addCourse(renewal) {
    if (buying.value) return;
    buyError.value = '';
    // Guest → offer login/register in a popup (stay on the page), matching the /all_course flow.
    if (!buyerId.value) { showAuthModal.value = true; return; }
    // Already in the cart → just open the header cart to finish there (no DB write).
    if (inCart.value) { openHeaderCart(); return; }
    buying.value = true;
    try {
        const sb = getSupabase();
        if (!buyer.value) buyer.value = await getBuyerRow(sb, buyerId.value);
        if (!buyer.value) throw new Error('Не удалось определить пользователя.');
        if (!renewal && course.value.Free) {
            await enrollFree(sb, { buyer: buyer.value, course: course.value });
            window.location.assign(myCoursesHref.value); // free access granted → open THAT course's player
        } else {
            // ADD to cart only — no order, no redirect. Checkout is done from the header cart.
            await addToCart(sb, { buyer: buyer.value, course: course.value, renewal });
            inCart.value = true;
        }
    } catch (e) {
        buyError.value = e?.message || 'Не удалось добавить в корзину. Попробуйте ещё раз.';
    } finally {
        buying.value = false;
    }
}
function onBuy() { if (!owns.value) addCourse(false); }   // fresh purchase (non-owner CTA)
function onRenew() { addCourse(true); }                    // owner extends access
const authorHref = computed(() => (author.value ? `/profile_page?user=${author.value.id}` : '#'));
const authorInitials = computed(() => {
    const parts = (author.value?.Name || '').split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '·';
});

function money(n) { return Number(n || 0).toLocaleString('ru-RU'); }
function lessonWord(n) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return 'уроков';
    if (b > 1 && b < 5) return 'урока';
    if (b === 1) return 'урок';
    return 'уроков';
}
function cleanLesson(t) { return (t || '').replace(/^\s*\d+[.)]\s*/, ''); } // drop a leading "1. " (we render our own number)
function reviewInitials(name) {
    const p = (name || '').split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '·';
}
function fmtDate(iso) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load() {
    // The path/query identifier is a slug OR an id (site convention /course/<slug||id>: a course
    // without a slug is linked by its uuid). Resolve by shape so both forms load.
    const key = route.params.slug || route.query.slug || route.query.id;
    const sb = getSupabase();
    if (!sb || !key) { loading.value = false; return; }
    let q = sb.from('course')
        .select('id, "Title", "Decription", "WhatTeach", "For", "Price", "Free", old_price, "Category", video_id, cover, "Less_Id", "DurationLong", "DurationPrice", owner, slug, comment, rating, "ModStatus"');
    q = UUID_RE.test(key) ? q.eq('id', key) : q.eq('slug', key);
    const { data } = await q.limit(1);
    course.value = data?.[0] || null;
    // Unpublished courses (draft / on-moderation — e.g. a paid stream's HIDDEN backing course or its
    // bundle-only recording course) must NOT be publicly viewable or buyable. Only the course author
    // may preview (they manage it in /courses_manage). Everyone else → the "not found" state, so no
    // stray "Купить за 0 ₽" CTA on a direct uuid link.
    if (course.value && course.value.ModStatus !== 'Опубликовано') {
        const viewerId = readStoredSession()?.user?.id || authCookieUser()?.id || null;
        if (course.value.owner !== viewerId) course.value = null;
    }
    if (course.value) {
        document.title = `${course.value.Title} — МитГуру`;
        if (course.value.owner) {
            const { data: au } = await sb.from('users').select('id, "Name", "Photo", role').eq('id', course.value.owner).limit(1);
            author.value = au?.[0] || null;
        }
        const lids = course.value.Less_Id || [];
        if (lids.length) {
            const { data: ls } = await sb.from('lessons').select('id, "Title", "File"').in('id', lids);
            const byId = Object.fromEntries((ls || []).map((l) => [l.id, l]));
            lessons.value = lids.map((lid) => byId[lid]).filter(Boolean); // keep the course's lesson order
        }
        // students = how many people own this course (user_course rows).
        const { count } = await sb.from('user_course').select('id', { count: 'exact', head: true }).eq('course', course.value.id);
        students.value = count || 0;
        // purchase state: is the viewer logged in, and do they already own this course?
        buyerId.value = readStoredSession()?.user?.id || authCookieUser()?.id || null;
        if (buyerId.value) {
            owns.value = await ownsCourse(sb, course.value.id, buyerId.value);
            // for any paid course, note if it's already in the cart (a fresh buy OR an owner's renewal)
            if (!course.value.Free) inCart.value = await courseInCart(sb, course.value.id, buyerId.value);
        }
        // Record the last opened course for the homepage «Вы смотрели недавно» block. Logged-in only,
        // published only, once per page open (load runs on mount), fire-and-forget — never blocks the UI.
        // (The draft/hidden filter on the homepage read side stays the source of truth for display.)
        if (buyerId.value && course.value.ModStatus === 'Опубликовано') {
            Promise.resolve(sb.from('users').update({ last_open: course.value.id }).eq('id', buyerId.value))
                .then(null, (e) => { try { console.warn('[home] last_open update failed', e); } catch (_) { /* noop */ } });
        }
    }
    loading.value = false;
    await nextTick();
    ready.value = true; // reactive reveal gate (see ProfilePage.vue)
}

onMounted(() => { ensureFonts(); load(); });

// Auth modal: close on Escape, and lock body scroll while it's open.
function onModalKey(e) { if (e.key === 'Escape') showAuthModal.value = false; }
watch(showAuthModal, (open) => {
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) document.addEventListener('keydown', onModalKey);
    else document.removeEventListener('keydown', onModalKey);
});
onBeforeUnmount(() => {
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onModalKey);
});

function ensureFonts() {
    if (document.getElementById('pd-fonts')) return;
    const l = document.createElement('link');
    l.id = 'pd-fonts';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(l);
}
</script>

<style scoped>
.pd {
    --bg: #ffffff; --bg-tint: #f1f6fd; --surface: #ffffff;
    --ink: #091747; --ink-2: #5b6472; --ink-3: #98a0ad; --line: #e4e9f1;
    --blue: #2e70dd; --blue-soft: #5495f3; --blue-strong: #2360c6; --blue-ink: #1f5fc9; --blue-tint: #eaf1fe;
    --orange: #f09157; --orange-bright: #ff7a1a; --orange-ink: #c2410c;
    --btn-ink: #ffffff; --r-lg: 26px; --r-md: 16px; --r-pill: 999px;
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    --shadow: 0 14px 40px -20px rgba(9, 23, 71, 0.24); --shadow-sm: 0 4px 16px -8px rgba(9, 23, 71, 0.18);
    --wrap: 1200px;
    background: var(--bg); color: var(--ink);
    font-family: 'Onest', system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 17px; line-height: 1.55; -webkit-font-smoothing: antialiased; overflow-x: hidden;
}
.pd *, .pd *::before, .pd *::after { box-sizing: border-box; }
.pd-wrap { width: 100%; max-width: var(--wrap); margin-inline: auto; padding-inline: 40px; }
.pd-section { padding: 80px 0; }
.pd-section--tint { background: var(--bg-tint); }
.pd-ic { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; display: block; }
.pd-h2 { margin: 0 0 32px; font-weight: 700; font-size: clamp(1.9rem, 4vw, 3rem); line-height: 1.06; letter-spacing: -0.02em; }
.pd-state { max-width: var(--wrap); margin: 120px auto; padding: 0 40px; text-align: center; color: var(--ink-2); font-size: 1.1rem; }
.pd-nf { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.pd-nf__t { margin: 0; font-size: 1.5rem; font-weight: 700; color: var(--ink); }
.pd-nf__p { margin: 0; }
.pd-nf__btn { margin-top: 14px; text-decoration: none; }

[data-reveal] { opacity: 0; transform: translateY(20px); transition: opacity 0.6s var(--ease-out), transform 0.6s var(--ease-out); transition-delay: calc(var(--i, 0) * 55ms); }
.pd.is-ready [data-reveal] { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) { [data-reveal] { opacity: 1; transform: none; transition: none; } }

.pd-btn { display: inline-block; font-family: inherit; font-weight: 600; font-size: 16px; color: var(--btn-ink); background: var(--blue); border: none; border-radius: var(--r-pill); padding: 15px 28px; cursor: pointer; text-decoration: none; transition: transform 0.16s var(--ease-out), background 0.16s var(--ease-out), box-shadow 0.16s var(--ease-out); box-shadow: 0 10px 26px -12px rgba(46, 112, 221, 0.7); }
.pd-btn:active { transform: translateY(1px); }
@media (hover: hover) and (pointer: fine) { .pd-btn:hover { background: var(--blue-strong); transform: translateY(-2px); box-shadow: 0 16px 32px -14px rgba(46, 112, 221, 0.8); } }
.pd-btn--lg { padding: 16px 34px; font-size: 17px; }
.pd-btn--block { display: block; width: 100%; text-align: center; }
button.pd-btn { font-family: inherit; }
.pd-btn:disabled { opacity: 0.6; cursor: default; box-shadow: none; }
@media (hover: hover) and (pointer: fine) { .pd-btn:disabled:hover { background: var(--blue); transform: none; box-shadow: none; } }
.pd-btn--ghost { background: transparent; color: var(--blue-ink); border: 1.5px solid var(--line); box-shadow: none; }
@media (hover: hover) and (pointer: fine) { .pd-btn--ghost:hover { background: var(--blue-tint); border-color: var(--blue-soft); box-shadow: none; } }
.pd-buyerr { margin: 12px 0 0; text-align: center; font-size: 0.85rem; color: #c0392b; }
.pd-owned-link { display: block; margin: 12px 0 0; text-align: center; font-size: 0.9rem; color: var(--blue-ink); text-decoration: none; }
@media (hover: hover) and (pointer: fine) { .pd-owned-link:hover { text-decoration: underline; } }

/* ── Auth prompt modal ──────────────────────────────────────────────────── */
.pd-modal { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; padding: 22px; background: rgba(9, 23, 71, 0.44); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.pd-modal__card { position: relative; width: 100%; max-width: 420px; background: var(--surface); border-radius: var(--r-lg); padding: 40px 36px 34px; box-shadow: 0 34px 80px -34px rgba(9, 23, 71, 0.55); text-align: center; }
.pd-modal__x { position: absolute; top: 14px; right: 16px; width: 34px; height: 34px; border: none; border-radius: 50%; background: transparent; color: var(--ink-3); font-size: 26px; line-height: 1; cursor: pointer; transition: background 0.16s var(--ease-out), color 0.16s var(--ease-out); }
@media (hover: hover) and (pointer: fine) { .pd-modal__x:hover { background: var(--bg-tint); color: var(--ink); } }
.pd-modal__mascot { display: block; width: 132px; height: auto; margin: 0 auto 18px; }
.pd-modal__title { margin: 0 0 10px; font-weight: 700; font-size: 1.5rem; letter-spacing: -0.02em; line-height: 1.15; }
.pd-modal__text { margin: 0 auto 26px; max-width: 34ch; color: var(--ink-2); font-size: 1rem; }
.pd-modal__actions { display: grid; gap: 12px; }

.pd-modal-enter-active, .pd-modal-leave-active { transition: opacity 0.2s var(--ease-out); }
.pd-modal-enter-active .pd-modal__card, .pd-modal-leave-active .pd-modal__card { transition: transform 0.22s var(--ease-out), opacity 0.22s var(--ease-out); }
.pd-modal-enter-from, .pd-modal-leave-to { opacity: 0; }
.pd-modal-enter-from .pd-modal__card, .pd-modal-leave-to .pd-modal__card { opacity: 0; transform: translateY(10px) scale(0.96); }
@media (prefers-reduced-motion: reduce) {
    .pd-modal-enter-active, .pd-modal-leave-active, .pd-modal-enter-active .pd-modal__card, .pd-modal-leave-active .pd-modal__card { transition: opacity 0.15s ease; }
    .pd-modal-enter-from .pd-modal__card, .pd-modal-leave-to .pd-modal__card { transform: none; }
}

/* ── Hero (course) ──────────────────────────────────────────────────────── */
.pd-hero { position: relative; padding: 54px 0 74px; overflow: hidden; }
.pd-blob { position: absolute; top: -180px; right: -150px; width: 620px; height: 620px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, rgba(84, 149, 243, 0.22), rgba(84, 149, 243, 0.05) 60%, transparent 72%); pointer-events: none; z-index: 0; }
.pd-chero { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1fr) 358px; gap: 44px; align-items: start; }
.pd-chero__main { min-width: 0; }
.pd-badge { display: inline-flex; align-items: center; gap: 9px; padding: 8px 16px; border-radius: var(--r-pill); background: var(--blue-tint); color: var(--blue-ink); font-weight: 600; font-size: 14px; }
.pd-badge__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--orange); box-shadow: 0 0 0 4px rgba(240, 145, 87, 0.22); }
.pd-hero__title--course { margin: 22px 0 0; font-weight: 700; font-size: clamp(1.9rem, 3.4vw, 2.9rem); line-height: 1.08; letter-spacing: -0.02em; }
.pd-hero__hook { margin: 20px 0 0; max-width: 60ch; font-size: 1.1rem; color: var(--ink-2); }

.pd-author-mini { display: inline-flex; align-items: center; gap: 12px; margin-top: 24px; text-decoration: none; color: inherit; }
.pd-author-mini img, .pd-author-mini__ava { width: 46px; height: 46px; border-radius: 50%; object-fit: cover; flex: none; }
.pd-author-mini__ava { display: grid; place-items: center; background: var(--blue-tint); color: var(--blue-ink); font-weight: 700; }
.pd-author-mini__text { display: flex; flex-direction: column; line-height: 1.25; font-size: 0.98rem; }
.pd-author-mini__text .muted { color: var(--ink-3); font-size: 0.85rem; }
@media (hover: hover) and (pointer: fine) { .pd-author-mini:hover b { color: var(--blue-ink); } }

/* teaser video (in the main column, under the title; hidden entirely when there is none) */
.pd-video { position: relative; width: 100%; aspect-ratio: 16 / 9; margin-top: 30px; border-radius: var(--r-lg); overflow: hidden; background: var(--ink); box-shadow: var(--shadow); border: 1px solid var(--line); }
.pd-video iframe { position: absolute; inset: 0; width: 100%; height: 100%; }
.pd-video--static img, .pd-video__poster img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.pd-video__poster { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; padding: 0; cursor: pointer; background: var(--ink); display: grid; place-items: center; }
.pd-video__play { position: relative; width: 74px; height: 74px; border-radius: 50%; background: rgba(255, 255, 255, 0.92); display: grid; place-items: center; box-shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.5); transition: transform 0.16s var(--ease-out); }
.pd-video__play svg { width: 32px; height: 32px; fill: var(--blue); margin-left: 3px; }
@media (hover: hover) and (pointer: fine) { .pd-video__poster:hover .pd-video__play { transform: scale(1.08); } }

/* buy / info card (sticky sidebar) */
.pd-chero__side { min-width: 0; }
.pd-buycard { position: sticky; top: 82px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); padding: 26px 26px 22px; box-shadow: var(--shadow); }
.pd-buycard__price { display: flex; align-items: baseline; gap: 12px; margin-bottom: 18px; }
.pd-buycard__now { font-weight: 700; font-size: 2.1rem; letter-spacing: -0.02em; }
.pd-buycard__old { color: var(--ink-3); text-decoration: line-through; font-size: 1.1rem; }
.pd-statlist { list-style: none; margin: 22px 0 0; padding: 20px 0 0; border-top: 1px solid var(--line); display: grid; gap: 14px; }
.pd-statlist li { display: flex; align-items: center; gap: 12px; color: var(--ink-2); font-size: 0.98rem; }
.pd-statlist .pd-ic { flex: none; width: 20px; height: 20px; color: var(--blue-ink); }

/* ── Learn (checklist) ──────────────────────────────────────────────────── */
.pd-learn { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px 32px; }
.pd-learn__item { display: flex; align-items: flex-start; gap: 12px; font-size: 1.06rem; }
.pd-learn__item .pd-ic { flex: none; width: 24px; height: 24px; stroke-width: 2.6; color: #21a366; margin-top: 2px; }
/* «Чему вы научитесь» обычным текстом (без галочек) */
.pd-learn-text { display: flex; flex-direction: column; gap: 12px; max-width: 72ch; }
.pd-learn-text p { margin: 0; font-size: 1.06rem; line-height: 1.6; color: var(--ink-2); }

/* ── Lessons (program) ──────────────────────────────────────────────────── */
.pd-head { margin-bottom: 26px; }
.pd-head .pd-h2 { margin-bottom: 10px; }
.pd-head__note { margin: 0; color: var(--ink-2); }
.pd-lessons { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.pd-lesson { display: grid; grid-template-columns: 58px 1fr; align-items: center; gap: 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 20px 24px; transition: border-color 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out); }
@media (hover: hover) and (pointer: fine) { .pd-lesson:hover { border-color: rgba(46, 112, 221, 0.4); box-shadow: var(--shadow-sm); } }
.pd-lesson__num { font-weight: 700; font-size: 1.2rem; color: var(--orange-ink); font-variant-numeric: tabular-nums; }
.pd-lesson__title { font-weight: 600; font-size: 1.08rem; line-height: 1.3; letter-spacing: -0.01em; }

/* ── About ──────────────────────────────────────────────────────────────── */
.pd-about { max-width: 820px; }
.pd-about__body p { margin: 0 0 16px; font-size: 1.1rem; color: var(--ink-2); }

/* ── For whom ───────────────────────────────────────────────────────────── */
.pd-cards--for { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.pd-forcard { position: relative; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 24px 24px 24px 28px; }
.pd-forcard__dot { position: absolute; left: 24px; top: 30px; width: 10px; height: 10px; border-radius: 50%; background: var(--blue-soft); }
.pd-forcard p { margin: 0 0 0 22px; color: var(--ink-2); font-size: 1rem; }

/* ── Reviews ────────────────────────────────────────────────────────────── */
.pd-cards--rev { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
.pd-rev { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 26px; }
.pd-rev__stars { display: flex; gap: 3px; margin-bottom: 14px; }
.pd-star { width: 18px; height: 18px; fill: var(--line); stroke: none; }
.pd-star.on { fill: var(--orange); }
.pd-rev__text { margin: 0 0 20px; color: var(--ink); font-size: 1rem; line-height: 1.55; white-space: pre-line; flex: 1; }
.pd-rev__by { display: flex; align-items: center; gap: 12px; }
.pd-rev__by img, .pd-rev__ava { width: 42px; height: 42px; border-radius: 50%; object-fit: cover; flex: none; }
.pd-rev__ava { display: grid; place-items: center; background: var(--blue-tint); color: var(--blue-ink); font-weight: 700; font-size: 0.95rem; }
.pd-rev__meta { display: flex; flex-direction: column; line-height: 1.3; }
.pd-rev__meta b { font-weight: 600; }
.pd-rev__meta span { color: var(--ink-3); font-size: 0.85rem; }

/* ── Price ──────────────────────────────────────────────────────────────── */
.pd-price-wrap { padding: 20px 0 88px; }
.pd-price { display: grid; grid-template-columns: 1.25fr 0.85fr; border-radius: var(--r-lg); overflow: hidden; box-shadow: var(--shadow); }
.pd-price__l { background: var(--blue); color: #fff; padding: 46px 44px; }
.pd-price__h { margin: 0 0 8px; font-weight: 700; font-size: clamp(1.6rem, 3vw, 2.3rem); letter-spacing: -0.02em; line-height: 1.1; }
.pd-price__sub { margin: 0 0 24px; font-weight: 500; color: rgba(255, 255, 255, 0.85); }
.pd-price__incl { list-style: none; margin: 0; padding: 0; display: grid; gap: 13px; }
.pd-price__incl li { display: flex; align-items: flex-start; gap: 12px; font-weight: 500; }
.pd-price__incl .pd-ic { flex: none; width: 22px; height: 22px; stroke-width: 2.4; margin-top: 1px; }
.pd-price__card { background: var(--surface); padding: 42px 40px; display: flex; flex-direction: column; justify-content: center; }
.pd-price__label { font-weight: 500; font-size: 0.9rem; color: var(--ink-3); }
.pd-price__amount { margin: 8px 0 0; font-weight: 700; font-size: clamp(2.6rem, 5vw, 3.6rem); line-height: 0.95; letter-spacing: -0.03em; }
.pd-price__amount .cur { color: var(--orange-ink); }
.pd-price__old { margin: 6px 0 0; color: var(--ink-3); text-decoration: line-through; }
.pd-price__card .pd-btn { margin-top: 22px; }
.pd-price__demo { margin: 12px 0 0; text-align: center; font-size: 0.82rem; color: var(--ink-3); }

/* ── Responsive ─────────────────────────────────────────────────────────── */
@media (max-width: 1000px) {
    .pd-chero { grid-template-columns: 1fr; gap: 26px; }
    .pd-buycard { position: static; }
    .pd-cards--for { grid-template-columns: 1fr; }
    .pd-learn { grid-template-columns: 1fr; }
}
@media (max-width: 900px) {
    .pd-wrap { padding-inline: 22px; }
    .pd-section { padding: 56px 0; }
    .pd-price { grid-template-columns: 1fr; }
    .pd-price__l, .pd-price__card { padding: 32px 26px; }
}
@media (max-width: 560px) {
    .pd-lesson { grid-template-columns: 44px 1fr; gap: 12px; padding: 16px 18px; }
}
</style>
