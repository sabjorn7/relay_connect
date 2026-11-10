<!--
  AllCoursesPage.vue — the course catalog (/all_course) in the MeetGuru promo (pd-*) brand language.
  Content-only — the shared AppHeader/AppFooter come from App.vue. Published courses are fetched from
  Supabase and filtered client-side (category / search / free). Cards link to /course/<slug||id> (the
  site slug convention; the course page resolves either form). Currently wired as a DEMO at
  /all-course-demo; a physical dist entry is produced via vite.config.js.
-->
<template>
    <main class="pd" :class="{ 'is-ready': ready }">
        <!-- ── HERO ─────────────────────────────────────────────── -->
        <header class="pd-hero">
            <div class="pd-blob" aria-hidden="true"></div>
            <div class="pd-wrap pd-hero__grid">
                <div class="pd-hero__text">
                    <span class="pd-badge" data-reveal><span class="pd-badge__dot" aria-hidden="true"></span>Каталог</span>
                    <h1 class="pd-hero__title" data-reveal>Все курсы</h1>
                    <p class="pd-hero__sub" data-reveal>Программы и семинары от практикующих экспертов — выбирайте направление и учитесь в удобном темпе.</p>
                </div>
                <img class="pd-hero__art" src="/images/881bb218-6026-4212-8809-c79020cf4a58.png" alt="" aria-hidden="true" data-reveal />
            </div>
        </header>

        <!-- ── CATALOG ──────────────────────────────────────────── -->
        <section class="pd-section pd-section--tint pd-catalog">
            <div class="pd-wrap">
                <!-- filters -->
                <div class="pd-filters" data-reveal>
                    <div class="pd-cats" role="tablist" aria-label="Категории">
                        <button
                            v-for="cat in categories"
                            :key="cat.key"
                            class="pd-cat"
                            :class="{ 'is-on': selectedCat === cat.key }"
                            type="button"
                            role="tab"
                            :aria-selected="selectedCat === cat.key"
                            @click="selectedCat = cat.key"
                        >{{ cat.label }} <span class="pd-cat__n">{{ cat.count }}</span></button>
                    </div>
                    <div class="pd-filters__row">
                        <label class="pd-search">
                            <svg viewBox="0 0 24 24" class="pd-ic" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
                            <input v-model="query" type="search" placeholder="Поиск по названию" aria-label="Поиск по названию" />
                        </label>
                        <button class="pd-toggle" :class="{ 'is-on': freeOnly }" type="button" :aria-pressed="freeOnly" @click="freeOnly = !freeOnly">
                            <span class="pd-toggle__box" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg></span>
                            Только бесплатные
                        </button>
                    </div>
                </div>

                <!-- results -->
                <p class="pd-count" aria-live="polite">{{ visibleCourses.length }} {{ courseWord(visibleCourses.length) }}</p>

                <div v-if="visibleCourses.length" class="pd-cards pd-cards--courses">
                    <button
                        v-for="(c, i) in visibleCourses"
                        :key="c.id"
                        class="pd-course"
                        type="button"
                        data-reveal
                        :style="{ '--i': Math.min(i, 7) }"
                        @click="openQuickView(c)"
                    >
                        <span v-if="c.cover" class="pd-course__cover"><img :src="c.cover" :alt="c.Title" loading="lazy" /></span>
                        <span class="pd-course__cat">{{ c.Category || 'Курс' }}</span>
                        <h3 class="pd-course__t">{{ c.Title }}</h3>
                        <div class="pd-course__foot">
                            <span v-if="author(c)" class="pd-course__auth">
                                <img v-if="author(c).Photo" class="pd-course__ava" :src="author(c).Photo" :alt="author(c).Name" />
                                <span v-else class="pd-course__ava pd-course__ava--i">{{ initialsOf(author(c).Name) }}</span>
                                <span class="pd-course__author">{{ author(c).Name }}</span>
                            </span>
                            <span v-else></span>
                            <CoursePrice class="pd-course__price" :course="c" />
                        </div>
                    </button>
                </div>

                <div v-else-if="!loading" class="pd-empty">
                    <img class="pd-empty__mascot" src="/images/minime-06.png" alt="" aria-hidden="true" width="626" height="626" />
                    <p>По вашему запросу курсов не нашлось.</p>
                    <button v-if="isFiltered" class="pd-ghostbtn" type="button" @click="resetFilters">Сбросить фильтры</button>
                </div>

                <p v-if="loading" class="pd-state">Загрузка курсов…</p>
            </div>
        </section>

        <!-- ── SINGLE OVERLAY: quick-view (teaser + author + buy) OR the guest auth prompt ──
             One backdrop, swapping content, so a guest clicking Купить in the quick-view doesn't
             cross-fade two stacked overlays. -->
        <transition name="pd-modal">
            <div v-if="qv || showAuthModal" class="pd-modal" role="dialog" aria-modal="true" @click.self="closeOverlay">
                <!-- guest auth prompt takes priority (shown when a guest triggers a buy) -->
                <div v-if="showAuthModal" class="pd-modal__card">
                    <button class="pd-modal__x" type="button" aria-label="Закрыть" @click="closeOverlay">×</button>
                    <img class="pd-modal__mascot" src="/images/minime-06.png" alt="" aria-hidden="true" width="626" height="626" />
                    <h2 id="pd-auth-title" class="pd-modal__title">Войдите, чтобы продолжить</h2>
                    <p class="pd-modal__text">Чтобы купить курс, войдите в аккаунт или зарегистрируйтесь — это займёт минуту.</p>
                    <div class="pd-modal__actions">
                        <a class="pd-btn pd-btn--lg pd-btn--block" href="/login">Войти</a>
                        <a class="pd-btn pd-btn--lg pd-btn--block pd-btn--ghost" href="/registration">Зарегистрироваться</a>
                    </div>
                </div>
                <!-- quick-view -->
                <div v-else-if="qv" class="pd-qv">
                    <button class="pd-modal__x" type="button" aria-label="Закрыть" @click="closeQuickView">×</button>
                    <div class="pd-qv__media" :class="{ 'is-empty': !qvEmbed }">
                        <iframe v-if="qvEmbed" :src="qvEmbed" title="Видео о курсе" frameborder="0" allow="fullscreen" allowfullscreen loading="lazy"></iframe>
                        <div v-else class="pd-qv__novideo">
                            <img class="pd-qv__mascot" src="/images/minime-17.png" alt="" aria-hidden="true" />
                            <span class="pd-qv__novideo-t">Нет видеотизера</span>
                        </div>
                    </div>
                    <div class="pd-qv__body">
                        <div class="pd-qv__top">
                            <a v-if="author(qv)" class="pd-qv__author" :href="authorHref(qv)">
                                <img v-if="author(qv).Photo" :src="author(qv).Photo" :alt="author(qv).Name" />
                                <span v-else class="pd-qv__ava">{{ initialsOf(author(qv).Name) }}</span>
                                <span class="pd-qv__by"><span class="muted">Курс от</span><b>{{ author(qv).Name }}</b></span>
                            </a>
                            <span class="pd-qv__cat">{{ qv.Category || 'Курс' }}</span>
                        </div>
                        <h3 class="pd-qv__title">{{ qv.Title }}</h3>
                        <ul v-if="qvStatItems.length" class="pd-qv__stats">
                            <li v-for="(s, i) in qvStatItems" :key="i">
                                <svg class="pd-qv__sic" viewBox="0 0 24 24" aria-hidden="true" v-html="QV_STAT_ICONS[s.icon]"></svg>
                                <span>{{ s.text }}</span>
                            </li>
                        </ul>
                        <div class="pd-qv__actions">
                            <a v-if="qvOwns" class="pd-btn" :href="`/my_courses?course=${qv.id}`">Уже в библиотеке</a>
                            <button v-else class="pd-btn" type="button" :disabled="buying" @click="buyFromQuickView">{{ qvBuyLabel }}</button>
                            <a class="pd-btn pd-btn--ghost" :href="courseHref(qv)">Подробнее о курсе</a>
                            <CoursePrice class="pd-qv__price" :course="qv" />
                        </div>
                        <p v-if="buyError" class="pd-buyerr">{{ buyError }}</p>
                    </div>
                </div>
            </div>
        </transition>
    </main>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import CoursePrice from '@/_front/components/CoursePrice.vue';
import { getSupabase, readStoredSession, authCookieUser } from '@/_front/chrome/headerAccount.js';
import { loadTimeout } from '@/_front/chrome/errorLogger.js';
import { sbWithRetry } from '@/_front/chrome/sbFetch.js';
import { embedUrl } from '@/_front/streams/peertubeLive.js';
import { getBuyerRow, ownsCourse, enrollFree, addToCart, courseInCart } from '@/_front/course/coursesApi.js';

const courses = ref([]);
const authorsById = ref({});
const loading = ref(true);
const ready = ref(false);

const selectedCat = ref('all');
const query = ref('');
const freeOnly = ref(false);

// quick-view popup + purchase state
const qv = ref(null);            // the course shown in the quick-view popup (null = closed)
const buyerId = ref(null);       // logged-in user's id (null = guest)
const buyer = ref(null);         // full users row (resolved lazily on first buy)
const buying = ref(false);
const buyError = ref('');
const qvInCart = ref(false);     // the quick-view course is already in the cart
const qvOwns = ref(false);       // the quick-view course is already owned (a user_course row exists)
const qvStats = ref(null);       // {lessons, materials, students, reviews, ratings, avg} for the popup
const showAuthModal = ref(false); // guest tried to buy → login/register prompt

// category tabs derived from the data (label + live count), "Все" first.
const categories = computed(() => {
    const counts = {};
    for (const c of courses.value) {
        const k = c.Category || 'Другое';
        counts[k] = (counts[k] || 0) + 1;
    }
    const cats = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
        .map((k) => ({ key: k, label: k, count: counts[k] }));
    return [{ key: 'all', label: 'Все', count: courses.value.length }, ...cats];
});

const isFiltered = computed(() => selectedCat.value !== 'all' || !!query.value.trim() || freeOnly.value);

const visibleCourses = computed(() => {
    const q = query.value.trim().toLowerCase();
    return courses.value.filter((c) => {
        if (selectedCat.value !== 'all' && (c.Category || 'Другое') !== selectedCat.value) return false;
        if (freeOnly.value && !c.Free) return false;
        if (q && !(c.Title || '').toLowerCase().includes(q)) return false;
        return true;
    });
});

function resetFilters() { selectedCat.value = 'all'; query.value = ''; freeOnly.value = false; }
function courseHref(c) { return `/course/${c.slug || c.id}`; }
function author(c) { return authorsById.value[c?.owner] || null; }
function authorName(c) { return author(c)?.Name || ''; }
function authorHref(c) { return c?.owner ? `/profile_page?user=${c.owner}` : '#'; }
function initialsOf(name) {
    const p = (name || '').split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '·';
}

// ── Quick-view popup (teaser + author + buy), matching the old catalog's on-click popup ──
const qvEmbed = computed(() => (qv.value?.video_id ? embedUrl(qv.value.video_id) : ''));
const qvBuyLabel = computed(() => {
    if (buying.value) return 'Секунду…';
    if (qv.value?.Free) return 'Получить бесплатно';
    return qvInCart.value ? 'В корзине' : 'Добавить в корзину';
});

// Russian plural helper (one / few / many).
function pl(n, f) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return f[2];
    if (b > 1 && b < 5) return f[1];
    if (b === 1) return f[0];
    return f[2];
}

// stat rows shown in the popup (parity with the course page: lessons/materials/students/reviews/ratings).
const qvStatItems = computed(() => {
    const s = qvStats.value;
    if (!s) return [];
    return [
        { icon: 'play', text: `${s.lessons} ${pl(s.lessons, ['урок', 'урока', 'уроков'])}` },
        { icon: 'doc', text: `${s.materials} ${pl(s.materials, ['материал', 'материала', 'материалов'])}` },
        { icon: 'users', text: `${s.students} ${pl(s.students, ['ученик', 'ученика', 'учеников'])}` },
        { icon: 'chat', text: `${s.reviews} ${pl(s.reviews, ['отзыв', 'отзыва', 'отзывов'])}` },
        { icon: 'star', text: `${s.ratings} ${pl(s.ratings, ['оценка', 'оценки', 'оценок'])} · ср. ${s.avg}` },
    ];
});
const QV_STAT_ICONS = {
    play: '<path d="M9 5H4v14h5M9 5l11 7-11 7z"/>',
    doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5.5"/>',
    chat: '<path d="M4 5h16v11H9l-4 3v-3H4z"/>',
    star: '<path d="M12 4l2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-4 5.6-.8z"/>',
};

function openQuickView(c) {
    qv.value = c;
    buyError.value = '';
    qvInCart.value = false;
    qvOwns.value = false;
    // Stats are set SYNCHRONOUSLY from the already-loaded course row (Less_Id / comment / rating), so the
    // block is in the first render — no dependency on an async re-render. Materials (lessons File) and the
    // student count need extra queries, so they load best-effort below and patch in when they resolve.
    const lids = c.Less_Id || [];
    const comments = Array.isArray(c.comment) ? c.comment.filter((x) => (x?.comment || '').trim()) : [];
    const ratings = Array.isArray(c.rating) ? c.rating : [];
    const avg = ratings.length ? ratings.reduce((s, r) => s + Number(r?.rating ?? 0), 0) / ratings.length : 0;
    qvStats.value = {
        lessons: lids.length,
        materials: 0,
        students: 0,
        reviews: comments.length,
        ratings: ratings.length,
        avg: ratings.length ? avg.toFixed(1).replace('.0', '') : '0',
    };
    const sb = getSupabase();
    if (!sb) return;
    const patch = (extra) => { if (qv.value?.id === c.id && qvStats.value) qvStats.value = { ...qvStats.value, ...extra }; };
    // cart state (paid, logged-in) — drives the "В корзине" label
    if (buyerId.value && !c.Free) courseInCart(sb, c.id, buyerId.value).then((v) => { if (qv.value?.id === c.id) qvInCart.value = v; }).catch(() => {});
    // ownership → "Уже в библиотеке" (same source of truth as CoursePage: a user_course row)
    if (buyerId.value) ownsCourse(sb, c.id, buyerId.value).then((v) => { if (qv.value?.id === c.id) qvOwns.value = v; }).catch(() => {});
    // materials = lessons that carry a File
    if (lids.length) {
        sb.from('lessons').select('id, "File"').in('id', lids)
            .then(({ data }) => patch({ materials: (data || []).filter((l) => (l.File || '').trim()).length })).catch(() => {});
    }
    // student count — its HEAD count endpoint is flaky (intermittent 503); best-effort, leave 0 on failure
    sb.from('user_course').select('id', { count: 'exact', head: true }).eq('course', c.id)
        .then(({ count }) => patch({ students: count || 0 })).catch(() => {});
}
function closeQuickView() { qv.value = null; }
function closeOverlay() { showAuthModal.value = false; qv.value = null; }

// Ask the shared AppHeader to open its cart dropdown (deferred a tick past the click, so the header's
// outside-click handler doesn't immediately close it).
function openHeaderCart() { setTimeout(() => window.dispatchEvent(new CustomEvent('mg-open-cart')), 0); }

// Buy the quick-view course. Guest → auth modal; free → direct grant; paid → add to cart + open cart.
// Reuses the shared coursesApi (same money path as CoursePage); no order/redirect happens here.
async function buyFromQuickView() {
    if (buying.value || !qv.value) return;
    buyError.value = '';
    if (!buyerId.value) { qv.value = null; showAuthModal.value = true; return; } // guest → login prompt
    if (!qv.value.Free && qvInCart.value) { openHeaderCart(); return; }
    buying.value = true;
    try {
        const sb = getSupabase();
        if (!buyer.value) buyer.value = await getBuyerRow(sb, buyerId.value);
        if (!buyer.value) throw new Error('Не удалось определить пользователя.');
        if (qv.value.Free) {
            await enrollFree(sb, { buyer: buyer.value, course: qv.value });
            window.location.assign(`/my_courses?course=${qv.value.id}`); // open THAT course's player
        } else {
            await addToCart(sb, { buyer: buyer.value, course: qv.value });
            qvInCart.value = true;
        }
    } catch (e) {
        buyError.value = e?.message || 'Не удалось добавить в корзину. Попробуйте ещё раз.';
    } finally {
        buying.value = false;
    }
}
function courseWord(n) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return 'курсов';
    if (b > 1 && b < 5) return 'курса';
    if (b === 1) return 'курс';
    return 'курсов';
}

async function load() {
    const sb = getSupabase();
    if (!sb) { loading.value = false; return; }
    const cancelTimeout = loadTimeout('all_course_catalog'); // logs loading_timeout if the catalog query hangs >15s
    buyerId.value = readStoredSession()?.user?.id || authCookieUser()?.id || null; // guest = null (no supabase call)
    // timeout+retry: a stalled request (flaky/throttled mobile) auto-retries instead of hanging the spinner
    let data = null;
    try {
        ({ data } = await sbWithRetry('all_course_catalog', () => sb.from('course')
            .select('id, "Title", "Price", "Free", old_price, "Category", slug, owner, video_id, cover, "Less_Id", comment, rating, created_at')
            .eq('ModStatus', 'Опубликовано')
            .eq('Buy', true)   // «Доступен к покупке» — не показываем в каталоге снятые с продажи (но опубликованные) курсы
            .order('created_at', { ascending: false })));
    } catch (e) { /* retries exhausted — render empty state (already logged) instead of an endless spinner */ }
    cancelTimeout(); // key query returned (or gave up) → cancel the watchdog
    courses.value = data || [];
    // The catalog is ready — clear the spinner NOW, before the secondary authors query. That query
    // only fills in card footer names; if it stalls on flaky mobile the grid is already rendered, so
    // it can never leave the user stuck on «загрузка». (A raw await here used to hang the whole page.)
    loading.value = false;
    await nextTick();
    ready.value = true;
    // authors (school / teacher) — name for the card footer, name+photo for the quick-view popup.
    const ownerIds = [...new Set(courses.value.map((c) => c.owner).filter(Boolean))];
    if (ownerIds.length) {
        let us = null;
        try { ({ data: us } = await sbWithRetry('catalog_authors', () => sb.from('users').select('id, "Name", "Photo"').in('id', ownerIds))); } catch (e) { /* logged */ }
        authorsById.value = Object.fromEntries((us || []).map((u) => [u.id, u]));
    }
}

onMounted(() => { ensureFonts(); load(); });

// Any open overlay (quick-view or auth modal) locks body scroll and closes on Escape.
const anyOverlay = computed(() => !!qv.value || showAuthModal.value);
function onOverlayKey(e) { if (e.key === 'Escape') { showAuthModal.value = false; qv.value = null; } }
watch(anyOverlay, (open) => {
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) document.addEventListener('keydown', onOverlayKey);
    else document.removeEventListener('keydown', onOverlayKey);
});
onBeforeUnmount(() => {
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onOverlayKey);
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
    --orange: #f09157; --orange-ink: #c2410c;
    --r-lg: 26px; --r-md: 16px; --r-pill: 999px;
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    --shadow: 0 14px 40px -20px rgba(9, 23, 71, 0.24); --shadow-sm: 0 4px 16px -8px rgba(9, 23, 71, 0.18);
    --wrap: 1200px;
    background: var(--bg); color: var(--ink);
    font-family: 'Onest', system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 17px; line-height: 1.55; -webkit-font-smoothing: antialiased; overflow-x: hidden;
}
.pd *, .pd *::before, .pd *::after { box-sizing: border-box; }
.pd-wrap { width: 100%; max-width: var(--wrap); margin-inline: auto; padding-inline: 40px; }
.pd-section { padding: 64px 0 88px; }
.pd-section--tint { background: var(--bg-tint); }
.pd-ic { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; display: block; }
.pd-state { text-align: center; color: var(--ink-2); font-size: 1.05rem; padding: 40px 0; }

[data-reveal] { opacity: 0; transform: translateY(20px); transition: opacity 0.6s var(--ease-out), transform 0.6s var(--ease-out); transition-delay: calc(var(--i, 0) * 45ms); }
.pd.is-ready [data-reveal] { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) { [data-reveal] { opacity: 1; transform: none; transition: none; } }

/* ── Hero ───────────────────────────────────────────────────────────────── */
.pd-hero { position: relative; padding: 56px 0 44px; overflow: hidden; }
.pd-blob { position: absolute; top: -200px; right: -160px; width: 620px; height: 620px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, rgba(84, 149, 243, 0.22), rgba(84, 149, 243, 0.05) 60%, transparent 72%); pointer-events: none; z-index: 0; }
.pd-hero > .pd-wrap { position: relative; z-index: 1; }
.pd-badge { display: inline-flex; align-items: center; gap: 9px; padding: 8px 16px; border-radius: var(--r-pill); background: var(--blue-tint); color: var(--blue-ink); font-weight: 600; font-size: 14px; }
.pd-badge__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--orange); box-shadow: 0 0 0 4px rgba(240, 145, 87, 0.22); }
.pd-hero__grid { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 48px; }
.pd-hero__text { min-width: 0; }
.pd-hero__art { height: 300px; width: auto; max-width: 100%; justify-self: end; display: block; filter: drop-shadow(0 20px 40px rgba(9, 23, 71, 0.14)); }
.pd-hero__title { margin: 22px 0 0; font-weight: 700; font-size: clamp(2rem, 4.4vw, 3.2rem); line-height: 1.05; letter-spacing: -0.02em; }
.pd-hero__sub { margin: 18px 0 0; max-width: 56ch; font-size: 1.12rem; color: var(--ink-2); }

/* ── Filters ────────────────────────────────────────────────────────────── */
.pd-catalog { padding-top: 40px; }
.pd-filters { display: flex; flex-direction: column; gap: 18px; margin-bottom: 22px; }
.pd-cats { display: flex; flex-wrap: wrap; gap: 10px; }
.pd-cat { display: inline-flex; align-items: center; gap: 8px; font-family: inherit; font-weight: 600; font-size: 15px; color: var(--ink-2); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 10px 18px; cursor: pointer; transition: color 0.16s var(--ease-out), background 0.16s var(--ease-out), border-color 0.16s var(--ease-out); }
.pd-cat__n { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
@media (hover: hover) and (pointer: fine) { .pd-cat:hover { border-color: var(--blue-soft); color: var(--ink); } }
.pd-cat.is-on { background: var(--blue); border-color: var(--blue); color: #fff; }
.pd-cat.is-on .pd-cat__n { color: rgba(255, 255, 255, 0.75); }

.pd-filters__row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.pd-search { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 240px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 0 18px; height: 50px; transition: border-color 0.16s var(--ease-out), box-shadow 0.16s var(--ease-out); }
.pd-search:focus-within { border-color: var(--blue-soft); box-shadow: 0 0 0 4px rgba(84, 149, 243, 0.15); }
.pd-search .pd-ic { width: 20px; height: 20px; color: var(--ink-3); flex: none; }
.pd-search input { flex: 1; border: none; outline: none; background: transparent; font-family: inherit; font-size: 16px; color: var(--ink); min-width: 0; }
.pd-search input::placeholder { color: var(--ink-3); }

.pd-toggle { display: inline-flex; align-items: center; gap: 10px; font-family: inherit; font-weight: 600; font-size: 15px; color: var(--ink-2); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 0 20px; height: 50px; cursor: pointer; transition: color 0.16s var(--ease-out), border-color 0.16s var(--ease-out); }
.pd-toggle__box { width: 20px; height: 20px; border-radius: 6px; border: 1.5px solid var(--line); display: grid; place-items: center; transition: background 0.16s var(--ease-out), border-color 0.16s var(--ease-out); }
.pd-toggle__box svg { width: 14px; height: 14px; fill: none; stroke: #fff; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; opacity: 0; transition: opacity 0.16s var(--ease-out); }
.pd-toggle.is-on { color: var(--orange-ink); border-color: var(--orange); }
.pd-toggle.is-on .pd-toggle__box { background: var(--orange); border-color: var(--orange); }
.pd-toggle.is-on .pd-toggle__box svg { opacity: 1; }
@media (hover: hover) and (pointer: fine) { .pd-toggle:hover { border-color: var(--orange); } }

.pd-count { margin: 0 0 22px; color: var(--ink-2); font-size: 0.98rem; }

/* ── Cards (reused from ProfilePage for consistency) ────────────────────── */
/* minmax(0, …) caps each track to its fr share — without it the default minmax(auto, fr) lets a
   card's min-content push the track (and the whole grid) past the container. Three equal columns. */
.pd-cards--courses { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.pd-course { display: flex; flex-direction: column; gap: 14px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 24px 24px 22px; text-decoration: none; color: inherit; transition: transform 0.22s var(--ease-out), box-shadow 0.22s var(--ease-out), border-color 0.22s var(--ease-out); }
@media (hover: hover) and (pointer: fine) { .pd-course:hover { transform: translateY(-4px); box-shadow: var(--shadow); border-color: rgba(46, 112, 221, 0.4); } }
.pd-course__cover { margin: -24px -24px 0; aspect-ratio: 16 / 9; overflow: hidden; border-radius: var(--r-md) var(--r-md) 0 0; background: var(--blue-tint); }
.pd-course__cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pd-course__cat { align-self: flex-start; padding: 5px 12px; border-radius: var(--r-pill); background: var(--blue-tint); color: var(--blue-ink); font-weight: 600; font-size: 12px; }
.pd-course__t { margin: 0; font-weight: 600; font-size: 1.08rem; line-height: 1.28; letter-spacing: -0.01em; flex: 1; }
.pd-course__foot { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-top: 2px; }
.pd-course__auth { display: inline-flex; align-items: center; flex: 1 1 7rem; gap: 8px; min-width: 0; }
.pd-course__ava { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex: none; }
.pd-course__ava--i { display: grid; place-items: center; background: var(--blue-tint); color: var(--blue-ink); font-weight: 700; font-size: 10px; }
.pd-course__author { color: var(--ink-3); font-size: 0.88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-course__price { --course-price-align: flex-end; margin-left: auto; font-weight: 700; font-size: 1.05rem; color: var(--ink); }
.pd-course__price.is-free { color: var(--orange-ink); }

/* ── Empty state ────────────────────────────────────────────────────────── */
.pd-empty { text-align: center; padding: 30px 0 20px; color: var(--ink-2); }
.pd-empty__mascot { display: block; width: 120px; height: auto; margin: 0 auto 16px; opacity: 0.9; }
.pd-empty p { margin: 0 0 18px; font-size: 1.1rem; }
.pd-ghostbtn { font-family: inherit; font-weight: 600; font-size: 15px; color: var(--blue-ink); background: transparent; border: 1.5px solid var(--line); border-radius: var(--r-pill); padding: 12px 24px; cursor: pointer; transition: background 0.16s var(--ease-out), border-color 0.16s var(--ease-out); }
@media (hover: hover) and (pointer: fine) { .pd-ghostbtn:hover { background: var(--blue-tint); border-color: var(--blue-soft); } }

/* card is a <button> that opens the quick-view — reset native button chrome */
button.pd-course { font-family: inherit; text-align: left; width: 100%; cursor: pointer; }

/* ── Buttons (shared with the popups) ───────────────────────────────────── */
.pd-btn { display: inline-block; font-family: inherit; font-weight: 600; font-size: 16px; color: #fff; background: var(--blue); border: none; border-radius: var(--r-pill); padding: 14px 26px; cursor: pointer; text-decoration: none; text-align: center; transition: transform 0.16s var(--ease-out), background 0.16s var(--ease-out), box-shadow 0.16s var(--ease-out); box-shadow: 0 10px 26px -12px rgba(46, 112, 221, 0.7); }
.pd-btn:active { transform: translateY(1px); }
@media (hover: hover) and (pointer: fine) { .pd-btn:hover { background: var(--blue-strong); transform: translateY(-2px); box-shadow: 0 16px 32px -14px rgba(46, 112, 221, 0.8); } }
.pd-btn--lg { padding: 16px 34px; font-size: 17px; }
.pd-btn--block { display: block; width: 100%; }
.pd-btn:disabled { opacity: 0.6; cursor: default; box-shadow: none; }
@media (hover: hover) and (pointer: fine) { .pd-btn:disabled:hover { background: var(--blue); transform: none; box-shadow: none; } }
.pd-btn--ghost { background: transparent; color: var(--blue-ink); border: 1.5px solid var(--line); box-shadow: none; }
@media (hover: hover) and (pointer: fine) { .pd-btn--ghost:hover { background: var(--blue-tint); border-color: var(--blue-soft); box-shadow: none; } }
.pd-buyerr { margin: 12px 0 0; text-align: center; font-size: 0.85rem; color: #c0392b; }

/* ── Overlay + modal shell (shared) ─────────────────────────────────────── */
.pd-modal { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; padding: 22px; background: rgba(9, 23, 71, 0.44); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.pd-modal__x { position: absolute; top: 12px; right: 12px; z-index: 3; display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: none; border-radius: 50%; background: rgba(255, 255, 255, 0.92); color: var(--ink-2); font-size: 22px; line-height: 1; cursor: pointer; box-shadow: 0 2px 10px -2px rgba(9, 23, 71, 0.35); transition: background 0.16s var(--ease-out), color 0.16s var(--ease-out); }
@media (hover: hover) and (pointer: fine) { .pd-modal__x:hover { background: #fff; color: var(--ink); } }
.pd-modal__card { position: relative; width: 100%; max-width: 420px; background: var(--surface); border-radius: var(--r-lg); padding: 40px 36px 34px; box-shadow: 0 34px 80px -34px rgba(9, 23, 71, 0.55); text-align: center; }
.pd-modal__mascot { display: block; width: 132px; height: auto; margin: 0 auto 18px; }
.pd-modal__title { margin: 0 0 10px; font-weight: 700; font-size: 1.5rem; letter-spacing: -0.02em; line-height: 1.15; }
.pd-modal__text { margin: 0 auto 26px; max-width: 34ch; color: var(--ink-2); font-size: 1rem; }
.pd-modal__actions { display: grid; gap: 12px; }

/* ── Quick-view popup ───────────────────────────────────────────────────── */
.pd-qv { position: relative; width: 100%; max-width: 560px; background: var(--surface); border-radius: var(--r-lg); overflow: hidden; box-shadow: 0 34px 80px -34px rgba(9, 23, 71, 0.55); }
.pd-qv__media { position: relative; width: 100%; aspect-ratio: 16 / 9; background: var(--ink); }
.pd-qv__media iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.pd-qv__media.is-empty { background: var(--bg-tint); display: grid; place-items: center; }
.pd-qv__novideo { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.pd-qv__mascot { width: 120px; height: auto; }
.pd-qv__novideo-t { font-weight: 600; font-size: 0.95rem; color: var(--ink-3); }
.pd-qv__body { padding: 22px 26px 26px; }
.pd-qv__top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.pd-qv__author { display: inline-flex; align-items: center; gap: 11px; text-decoration: none; color: inherit; min-width: 0; }
.pd-qv__author img, .pd-qv__ava { width: 42px; height: 42px; border-radius: 50%; object-fit: cover; flex: none; }
.pd-qv__ava { display: grid; place-items: center; background: var(--blue-tint); color: var(--blue-ink); font-weight: 700; }
.pd-qv__by { display: flex; flex-direction: column; line-height: 1.25; font-size: 0.95rem; min-width: 0; }
.pd-qv__by b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-qv__by .muted { color: var(--ink-3); font-size: 0.8rem; }
@media (hover: hover) and (pointer: fine) { .pd-qv__author:hover b { color: var(--blue-ink); } }
.pd-qv__cat { flex: none; padding: 5px 12px; border-radius: var(--r-pill); background: var(--blue-tint); color: var(--blue-ink); font-weight: 600; font-size: 12px; }
.pd-qv__title { margin: 12px 0 16px; font-weight: 700; font-size: 1.4rem; line-height: 1.2; letter-spacing: -0.01em; }
.pd-qv__stats { list-style: none; margin: 0 0 20px; padding: 16px 0 0; border-top: 1px solid var(--line); display: grid; grid-template-columns: 1fr 1fr; gap: 11px 22px; }
.pd-qv__stats li { display: flex; align-items: center; gap: 9px; color: var(--ink-2); font-size: 0.92rem; }
.pd-qv__sic { width: 18px; height: 18px; flex: none; fill: none; stroke: var(--blue-ink); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.pd-qv__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.pd-qv__price { margin-left: auto; font-weight: 700; font-size: 1.3rem; color: var(--ink); }
.pd-qv__price.is-free { color: var(--orange-ink); }

/* ── Modal transitions (shared) ─────────────────────────────────────────── */
.pd-modal-enter-active, .pd-modal-leave-active { transition: opacity 0.2s var(--ease-out); }
.pd-modal-enter-active .pd-qv, .pd-modal-leave-active .pd-qv,
.pd-modal-enter-active .pd-modal__card, .pd-modal-leave-active .pd-modal__card { transition: transform 0.22s var(--ease-out), opacity 0.22s var(--ease-out); }
.pd-modal-enter-from, .pd-modal-leave-to { opacity: 0; }
.pd-modal-enter-from .pd-qv, .pd-modal-leave-to .pd-qv,
.pd-modal-enter-from .pd-modal__card, .pd-modal-leave-to .pd-modal__card { opacity: 0; transform: translateY(10px) scale(0.96); }
@media (prefers-reduced-motion: reduce) {
    .pd-modal-enter-active, .pd-modal-leave-active,
    .pd-modal-enter-active .pd-qv, .pd-modal-leave-active .pd-qv,
    .pd-modal-enter-active .pd-modal__card, .pd-modal-leave-active .pd-modal__card { transition: opacity 0.15s ease; }
    .pd-modal-enter-from .pd-qv, .pd-modal-leave-to .pd-qv,
    .pd-modal-enter-from .pd-modal__card, .pd-modal-leave-to .pd-modal__card { transform: none; }
}

/* ── Responsive ─────────────────────────────────────────────────────────── */
@media (max-width: 960px) { .pd-cards--courses { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 900px) {
    .pd-wrap { padding-inline: 22px; }
    .pd-section { padding: 48px 0 64px; }
    .pd-hero__grid { grid-template-columns: 1fr; }
    .pd-hero__art { display: none; }
}
@media (max-width: 560px) {
    .pd-cards--courses { grid-template-columns: minmax(0, 1fr); }
    .pd-filters__row { flex-direction: column; align-items: stretch; }
    .pd-toggle { justify-content: center; }
    .pd-qv__stats { grid-template-columns: 1fr; }
    .pd-qv__actions { flex-direction: column; align-items: stretch; }
    .pd-qv__actions .pd-btn { width: 100%; }
    .pd-qv__price { --course-price-align: center; margin: 4px 0 0; text-align: center; }
}
</style>
