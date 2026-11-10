<template>
    <div class="ed">
        <div v-if="loading" class="ed-center">Загрузка…</div>
        <div v-else-if="notFound" class="ed-center ed-nf">
            <h2 class="ed-nf__t">Мероприятие не найдено</h2>
            <p>Возможно, оно завершилось или ссылка устарела.</p>
            <a href="/events" class="pd-btn ed-nf__btn">Все мероприятия</a>
        </div>

        <template v-else>
            <!-- Two-column hero like CoursePage (pd-chero): main + sticky pd-buycard sidebar -->
            <header class="pd-hero">
                <div class="pd-wrap pd-chero">
                    <div class="pd-chero__main">
                        <span class="pd-badge"><span class="pd-badge__dot" aria-hidden="true"></span>Мероприятие</span>
                        <span v-if="event.status !== 'published'" class="ed-draft">Черновик (виден только вам)</span>
                        <h1 class="pd-hero__title--course">{{ event.title }}</h1>
                        <p v-if="event.description" class="pd-hero__hook">{{ event.description }}</p>

                        <a v-if="speaker" class="pd-author-mini" :href="`/profile_page/?user=${speaker.id}`">
                            <img v-if="speaker.Photo" :src="speaker.Photo" :alt="speaker.Name" />
                            <span v-else class="pd-author-mini__ava">{{ (speaker.Name || '?').slice(0, 1) }}</span>
                            <span class="pd-author-mini__text"><span class="muted">Спикер</span><b>{{ speaker.Name || 'Спикер' }}</b></span>
                        </a>

                        <div v-if="event.video_id" class="pd-video">
                            <iframe v-if="teaserStarted" :src="teaserEmbed" title="Видео о мероприятии" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>
                            <button v-else type="button" class="pd-video__poster" aria-label="Смотреть видео о мероприятии" @click="teaserStarted = true">
                                <img v-if="event.cover_url" :src="event.cover_url" alt="" />
                                <span class="pd-video__play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>
                            </button>
                        </div>
                        <div v-else-if="event.cover_url" class="pd-video pd-video--static">
                            <img :src="event.cover_url" :alt="event.title" />
                        </div>
                    </div>

                    <aside class="pd-chero__side">
                        <div class="pd-buycard">
                            <!-- guest -->
                            <template v-if="!me">
                                <div class="pd-buycard__price"><span class="pd-buycard__now">{{ money(event.price) }} ₽</span></div>
                                <a class="pd-btn pd-btn--lg pd-btn--block" href="/login">Войти, чтобы записаться</a>
                                <button type="button" class="pd-btn pd-btn--lg pd-btn--block pd-btn--ghost ed-btn-or" @click="goToContact">Записаться без входа</button>
                            </template>
                            <!-- registered (paid) -->
                            <template v-else-if="reg && reg.status === 'paid'">
                                <div class="pd-buycard__ok">✓ Вы записаны</div>
                                <p v-if="reg.payment_type === 'deposit'" class="pd-buycard__note">
                                    Оплачено {{ money(reg.amount_paid) }} из {{ money(reg.amount_total) }} ₽. Остаток {{ money(reg.amount_total - reg.amount_paid) }} ₽ — на месте.
                                </p>
                                <a v-if="event.chat" class="pd-btn pd-btn--lg pd-btn--block" :href="`/chats?chat=${event.chat}`">Чат мероприятия</a>
                            </template>
                            <!-- pending -->
                            <template v-else-if="reg && reg.status === 'pending'">
                                <p class="pd-buycard__note">Оплата обрабатывается. Если только что оплатили — обновите страницу через минуту.</p>
                                <button class="pd-btn pd-btn--lg pd-btn--block" :disabled="busy" @click="openSharedCart">Открыть корзину и заказы</button>
                            </template>
                            <!-- new registration -->
                            <template v-else>
                                <div class="pd-buycard__price"><span class="pd-buycard__now">{{ money(event.price) }} ₽</span></div>
                                <div v-if="hasDeposit" class="ed-choices">
                                    <label class="ed-choice" :class="{ on: choice === 'full' }">
                                        <input type="radio" value="full" v-model="choice" /> Полная — {{ money(event.price) }} ₽
                                    </label>
                                    <label class="ed-choice" :class="{ on: choice === 'deposit' }">
                                        <input type="radio" value="deposit" v-model="choice" /> Предоплата — {{ money(depositAmount) }} ₽
                                        <span class="ed-choice__sub">остаток {{ money(event.price - depositAmount) }} ₽ на месте</span>
                                    </label>
                                </div>
                                <p class="ed-promo-note">Промокод применяется в общей корзине. Для предоплаты скидка не действует.</p>
                                <label class="ed-agree">
                                    <input type="checkbox" v-model="agreed" />
                                    <span>Я ознакомился(ась) и принимаю
                                        <a href="/oferta?tab=meropriyatiya" target="_blank" rel="noopener">Публичную оферту на участие в очных мероприятиях Meetguru</a>,
                                        включая <a href="/vozvrat" target="_blank" rel="noopener">Правила отмены участия и возврата денежных средств</a>.
                                    </span>
                                </label>
                                <button class="pd-btn pd-btn--lg pd-btn--block" :disabled="busy || (!eventInCart && !agreed)" @click="pay(choice)">
                                    {{ busy ? 'Сохраняем…' : Number(event.price) === 0 ? 'Записаться бесплатно' : eventInCart ? 'В корзине' : 'Добавить в корзину' }}
                                </button>
                            </template>
                            <p v-if="payError" class="pd-buyerr">{{ payError }}</p>

                            <ul class="pd-statlist">
                                <li v-if="whenText"><svg viewBox="0 0 24 24" class="pd-ic" aria-hidden="true"><path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg><span>{{ whenText }}</span></li>
                                <li v-if="event.location"><svg viewBox="0 0 24 24" class="pd-ic" aria-hidden="true"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg><span>{{ event.location }}</span></li>
                                <li><svg viewBox="0 0 24 24" class="pd-ic" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Чат участников после оплаты</span></li>
                            </ul>
                        </div>
                    </aside>
                </div>
            </header>

            <!-- Marketing blocks — CoursePage structure/classes (full 1200px width) -->
            <section v-if="aboutParagraphs.length" class="pd-section">
                <div class="pd-wrap pd-about">
                    <h2 class="pd-h2">О мероприятии</h2>
                    <div class="pd-about__body">
                        <p v-for="(p, i) in aboutParagraphs" :key="i" v-html="linkifyText(p)"></p>
                    </div>
                </div>
            </section>

            <section v-if="learnParagraphs.length" class="pd-section pd-section--tint">
                <div class="pd-wrap pd-about">
                    <h2 class="pd-h2">Чему научитесь</h2>
                    <div class="pd-about__body">
                        <p v-for="(p, i) in learnParagraphs" :key="i" v-html="linkifyText(p)"></p>
                    </div>
                </div>
            </section>

            <section v-if="forItems.length" class="pd-section pd-section--tint">
                <div class="pd-wrap">
                    <h2 class="pd-h2">Для кого</h2>
                    <div class="pd-cards pd-cards--for">
                        <article v-for="(t, i) in forItems" :key="i" class="pd-forcard">
                            <span class="pd-forcard__dot" aria-hidden="true"></span>
                            <p>{{ t }}</p>
                        </article>
                    </div>
                </div>
            </section>

            <!-- О спикере — auto-pulled from the speaker's profile -->
            <section v-if="speaker && (speakerBio.length || speakerLinks.length)" class="pd-section">
                <div class="pd-wrap">
                    <h2 class="pd-h2">О спикере</h2>
                    <div class="ed-speaker">
                        <img v-if="speaker.Photo" class="ed-speaker__ava" :src="speaker.Photo" :alt="speaker.Name || 'Спикер'" />
                        <span v-else class="ed-speaker__ava ed-speaker__ava--i">{{ (speaker.Name || '?').slice(0, 1) }}</span>
                        <div class="ed-speaker__body">
                            <div class="ed-speaker__name">{{ speaker.Name || 'Спикер' }}</div>
                            <div v-if="speaker.city" class="ed-speaker__city">📍 {{ speaker.city }}</div>
                            <div v-if="speakerBio.length" class="ed-speaker__bio">
                                <p v-for="(p, i) in speakerBio" :key="i" v-html="linkifyText(p)"></p>
                            </div>
                            <div v-if="speakerLinks.length" class="ed-speaker__socials">
                                <a v-for="l in speakerLinks" :key="l.type" class="ed-speaker__social" :href="l.url" target="_blank" rel="noopener noreferrer" :aria-label="l.label" v-html="l.icon"></a>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <!-- Venue map: Google embed by the free-text address — instant marker, no click, no key. -->
            <section v-if="event.location" class="pd-section">
                <div class="pd-wrap">
                    <h2 class="pd-h2">Как добраться</h2>
                    <div class="ed-map__addr">📍 {{ event.location }}</div>
                    <iframe
                        class="ed-map__frame"
                        :src="`https://www.google.com/maps?q=${encodeURIComponent(event.location)}&output=embed`"
                        loading="lazy"
                        allowfullscreen
                    ></iframe>
                </div>
            </section>

            <!-- Отзывы — single stitched review clip -->
            <section v-if="event.review_video_id" class="pd-section pd-section--tint">
                <div class="pd-wrap">
                    <h2 class="pd-h2">Отзывы</h2>
                    <div class="ed-review"><iframe :src="reviewEmbed" title="Видео-отзывы" frameborder="0" allowfullscreen allow="fullscreen; picture-in-picture"></iframe></div>
                </div>
            </section>

            <!-- Contact form (call-back lead; works without login) -->
            <section ref="contactSectionEl" class="pd-section pd-section--tint">
                <div class="pd-wrap ed-contact">
                    <h2 class="pd-h2">{{ me ? 'Остались вопросы?' : 'Записаться без входа' }}</h2>
                    <p class="ed-contact__sub">
                        {{ me ? 'Оставьте телефон — перезвоним и всё расскажем.' : 'Оставьте имя и телефон — мы свяжемся и всё расскажем.' }}
                    </p>
                    <template v-if="contactSent">
                        <div class="ed-contact__ok">✓ Спасибо! Мы свяжемся с вами.</div>
                    </template>
                    <form v-else class="ed-contact__form" @submit.prevent="sendContact" novalidate>
                        <input v-model="contactName" ref="nameInputEl" type="text" maxlength="80" class="ed-contact__input" placeholder="Ваше имя" autocomplete="name" />
                        <input v-model="contactPhone" type="tel" class="ed-contact__input" placeholder="+7 900 000-00-00" autocomplete="tel" />
                        <!-- honeypot: off-screen, not for humans -->
                        <input v-model="contactHp" name="hp_ref" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" class="ed-hp" />
                        <label class="ed-contact__consent">
                            <input type="checkbox" v-model="contactConsent" />
                            <span>Я подтверждаю, что персональные данные обрабатываются в соответствии с
                                <a href="/politica" target="_blank" rel="noopener">Политикой обработки персональных данных</a>.</span>
                        </label>
                        <button type="submit" class="pd-btn pd-btn--lg" :disabled="contactSending || !contactConsent">
                            {{ contactSending ? 'Отправка…' : 'Оставить заявку' }}
                        </button>
                    </form>
                    <p v-if="contactError" class="pd-buyerr">{{ contactError }}</p>
                </div>
            </section>

        </template>
    </div>
</template>

<script setup>
import { addProduct, openSharedCart, checkoutRpc } from '@/_front/checkout/cartApi.js';
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { getCurrentUser } from '@/_front/streams/streamsApi.js';
import { embedUrl } from '@/_front/streams/peertubeLive.js';
import { linkifyText } from '@/_front/helpers/linkify.js';
import {
    getEventById,
    getEventBySlug,
    getSpeakerProfile,
    getMyEventRegistration,
    eventAmount,
    submitContactRequest,
} from '@/_front/streams/eventsApi.js';

const sb = () => window.wwLib?.wwPlugins?.supabase?.instance;
const route = useRoute();
const eventId = String(route.query.event || '');
const eventSlug = String(route.params.slug || '');

const loading = ref(true);
const notFound = ref(false);
const event = ref(null);
const speaker = ref(null);
const teaserStarted = ref(false);
const teaserEmbed = computed(() => (event.value?.video_id ? embedUrl(event.value.video_id, { autoplay: true }) : ''));
const reviewEmbed = computed(() => (event.value?.review_video_id ? embedUrl(event.value.review_video_id, { autoplay: false }) : ''));
const me = ref(null);
const reg = ref(null);
const choice = ref('full');
const agreed = ref(false); // обязательное согласие с офертой + правилами отмены перед оплатой
const eventInCart = ref(false);
const busy = ref(false);
const payError = ref('');
const contactName = ref('');
const contactPhone = ref('');
const contactHp = ref('');
const contactConsent = ref(false);
const contactSending = ref(false);
const contactSent = ref(false);
const contactError = ref('');
const contactSectionEl = ref(null);
const nameInputEl = ref(null);

// map RPC error codes -> friendly messages (phone is never logged)
const CONTACT_ERR = {
    consent_required: 'Поставьте галочку согласия.',
    bad_name: 'Введите имя (2–80 символов).',
    bad_phone: 'Введите корректный номер телефона.',
    event_required: 'Мероприятие недоступно.',
    event_not_found: 'Мероприятие недоступно.',
    too_many: 'Слишком много заявок, попробуйте позже.',
};

function goToContact() {
    contactSectionEl.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => nameInputEl.value?.focus(), 350);
}

async function sendContact() {
    if (contactSending.value) return;
    contactSending.value = true; contactError.value = '';
    try {
        await submitContactRequest(sb(), {
            event: event.value?.id, name: contactName.value,
            phone: contactPhone.value, consent: contactConsent.value, hp: contactHp.value,
        });
        contactSent.value = true;
        contactName.value = ''; contactPhone.value = '';
    } catch (e) {
        contactError.value = CONTACT_ERR[e.message] || 'Не удалось отправить заявку. Попробуйте позже.';
    } finally {
        contactSending.value = false;
    }
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const whenText = computed(() => {
    const s0 = event.value?.starts_at;
    if (!s0) return '';
    const s = new Date(s0);
    if (Number.isNaN(s.getTime())) return '';
    const sTxt = dateFmt.format(s);
    const e0 = event.value?.ends_at;
    if (!e0) return sTxt;
    const e = new Date(e0);
    if (Number.isNaN(e.getTime())) return sTxt;
    // same calendar day → append end time; multi-day → append full end date
    return s.toDateString() === e.toDateString() ? `${sTxt} – ${timeFmt.format(e)}` : `${sTxt} – ${dateFmt.format(e)}`;
});
const hasDeposit = computed(() => event.value?.deposit_percent != null && Number(event.value.deposit_percent) > 0);
const depositAmount = computed(() => (hasDeposit.value ? eventAmount(event.value, 'deposit') : 0));

function money(v) { return (Number(v) || 0).toLocaleString('ru-RU'); }

// Marketing blocks — same storage/parsing as CoursePage: about = paragraphs split on blank lines;
// what_you_learn / for_whom = one bullet per line ("- item" markers stripped).
function bullets(text) {
    return (text || '').split(/\n+/).map((l) => l.replace(/^[\s•\-–—*]+/, '').trim()).filter(Boolean);
}
const aboutParagraphs = computed(() => (event.value?.about || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean));
const learnParagraphs = computed(() => (event.value?.what_you_learn || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean));
const forItems = computed(() => bullets(event.value?.for_whom));

// Speaker "О спикере" — pulled from the profile (bio + social links, only what exists).
const speakerBio = computed(() => (speaker.value?.Description || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean));
// social icons — verbatim from ProfilePage.vue SOCIAL_ICONS (booking_url intentionally excluded)
const SPEAKER_SOCIAL_ICONS = {
    vk: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.8 16.3c-5 0-8-3.5-8.1-9.3h2.5c.1 4.3 2 6.1 3.5 6.5V7h2.4v3.6c1.5-.2 3-1.8 3.6-3.6h2.4c-.5 2.2-2.1 3.8-3.2 4.5 1.1.6 2.9 2 3.6 4.8h-2.6c-.5-1.7-1.9-3-3.8-3.2v3.2h-.3z"/></svg>',
    telegram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 4.5 3.5 11.2c-.9.4-.9 1.6 0 1.9l4.2 1.4 1.6 4.9c.3.8 1.2 1 1.8.4l2.3-2.2 4.2 3.1c.7.5 1.7.1 1.9-.7L22.5 6c.2-1-.7-1.8-1.5-1.5zM9.6 14l7.7-4.8-6.3 5.9-.2 3.1-1.2-4.2z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.7 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1c.3-1.2.3-3.8.3-3.8s0-2.6-.3-3.8zM10 15V9l5.2 3-5.2 3z"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3zm5.2 12.7c-.2.6-1.2 1.1-1.7 1.2-.5.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.6-2.6-1.1-4.3-3.8-4.4-4-.1-.2-1-1.4-1-2.6 0-1.2.6-1.8.9-2 .2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.7 1.7c.1.2.1.4 0 .5l-.3.5-.3.3c-.1.1-.3.3-.1.6.1.3.7 1.1 1.5 1.8 1 .9 1.8 1.1 2 1.2.3.1.4.1.6-.1l.7-.8c.2-.2.3-.2.6-.1l1.6.8c.3.1.5.2.5.4 0 .1 0 .5-.2 1z"/></svg>',
    website: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3z" fill="none"/></svg>',
};
const speakerLinks = computed(() => {
    const s = speaker.value || {};
    return [
        { type: 'vk', url: s.vk_url, label: 'ВКонтакте' },
        { type: 'telegram', url: s.telegram_url, label: 'Telegram' },
        { type: 'youtube', url: s.youtube_url, label: 'YouTube' },
        { type: 'whatsapp', url: s.whatsapp_url, label: 'WhatsApp' },
        { type: 'website', url: s.website_url, label: 'Сайт' },
    ].filter((l) => (l.url || '').trim()).map((l) => ({ ...l, url: l.url.trim(), icon: SPEAKER_SOCIAL_ICONS[l.type] }));
});

async function loadReg() {
    if (!me.value || !event.value) { reg.value = null; return; }
    reg.value = await getMyEventRegistration(sb(), event.value.id, me.value.id).catch(() => null);
}

async function load() {
    loading.value = true; notFound.value = false;
    try {
        me.value = await getCurrentUser(sb()).catch(() => null);
        const ev = eventSlug ? await getEventBySlug(sb(), eventSlug) : (eventId ? await getEventById(sb(), eventId) : null);
        // draft is visible only to its owner
        if (!ev || (ev.status !== 'published' && (!me.value || me.value.id !== ev.owner))) {
            notFound.value = true;
            return;
        }
        event.value = ev;
        choice.value = 'full';
        if (ev.speaker_id) speaker.value = await getSpeakerProfile(sb(), ev.speaker_id).catch(() => null);
        await loadReg();
        if (me.value && Number(ev.price) > 0) {
            const cart = await checkoutRpc(sb(), 'cart_get').catch(() => []);
            eventInCart.value = cart.some(i => i.product_type === 'event' && i.product_id === ev.id);
        }
    } catch {
        notFound.value = true;
    } finally {
        loading.value = false;
    }
}

async function pay(paymentType) {
    if (busy.value || !event.value || !me.value) return;
    if (eventInCart.value) { openSharedCart(); return; }
    busy.value = true; payError.value = '';
    try {
        if (Number(event.value.price) === 0) {
            await checkoutRpc(sb(), 'checkout_register_free_event', { p_event_id: event.value.id, p_agreed: agreed.value });
            await loadReg();
        } else {
            await addProduct(sb(), { type: 'event', id: event.value.id, paymentType, agreed: agreed.value });
            eventInCart.value = true;
        }
        busy.value = false;
    } catch (e) {
        payError.value = e.message || 'Не удалось добавить товар в корзину.';
        busy.value = false;
    }
}

onMounted(async () => {
    await load();
    // Returned from Prodamus with a fresh 'pending'? The callback is async — re-check once after a beat.
    if (reg.value && reg.value.status === 'pending') {
        setTimeout(loadReg, 5000);
    }
});
</script>

<style scoped>
/* Full-width page (like course main.pd); EVERY block sits in a pd-wrap (1200/40) → same width. */
.ed { width: 100%; font-family: 'Raleway', sans-serif; color: #091747; }
.ed-center { text-align: center; color: #64748b; padding: 64px 0; }
.ed-nf { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.ed-nf__t { margin: 0; font-size: 1.5rem; font-weight: 700; color: #0f172a; }
.ed-nf__btn { margin-top: 14px; text-decoration: none; }
.ed-draft { display: inline-block; font-size: 12px; color: #b45309; background: #fef3c7; padding: 2px 8px; border-radius: 999px; margin: 10px 0; }
.ed-map__addr { color: #5b6472; margin-bottom: 14px; }
.ed-map__frame { width: 100%; height: 380px; border: 0; border-radius: 16px; box-shadow: 0 6px 20px rgba(15,23,42,.06); }
.ed-contact { max-width: 640px; }
.ed-contact__sub { margin: 0 0 20px; color: #5b6472; font-size: 1.05rem; }
.ed-contact__form { display: flex; gap: 12px; flex-wrap: wrap; }
.ed-contact__input { flex: 1; min-width: 220px; height: 54px; padding: 0 18px; border: 1px solid #d1d5db; border-radius: 999px; font: inherit; background: #fff; }
.ed-contact__ok { font-weight: 700; font-size: 1.2rem; color: #21a366; }
.ed-hp { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.ed-contact__consent { display: flex; align-items: flex-start; gap: 8px; width: 100%; font-size: 0.95rem; line-height: 1.4; color: #5b6472; }
.ed-contact__consent a { color: #2e70dd; }
.ed-choices { display: flex; flex-direction: column; gap: 8px; }
.ed-choice { border: 1px solid #d1d5db; border-radius: 12px; padding: 12px 14px; cursor: pointer; font-size: 15px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ed-choice.on { border-color: #2563eb; background: #eff6ff; }
.ed-choice__sub { flex-basis: 100%; color: #94a3b8; font-size: 13px; padding-left: 24px; }

/* ── Marketing blocks — pd-* structure copied verbatim from CoursePage (exact values) ── */
.pd-section { padding: 80px 0; }
.pd-section--tint { background: #f1f6fd; }
.pd-wrap { width: 100%; max-width: 1200px; margin-inline: auto; padding-inline: 40px; }
.pd-h2 { margin: 0 0 32px; font-weight: 700; font-size: clamp(1.9rem, 4vw, 3rem); line-height: 1.06; letter-spacing: -0.02em; color: #091747; }
.pd-learn { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px 32px; }
.pd-learn__item { display: flex; align-items: flex-start; gap: 12px; font-size: 1.06rem; color: #091747; }
.pd-learn__item .pd-ic { flex: none; width: 24px; height: 24px; stroke-width: 2.6; stroke: #21a366; fill: none; margin-top: 2px; }
.pd-about__body p { margin: 0 0 16px; font-size: 1.1rem; color: #5b6472; line-height: 1.6; white-space: pre-line; }
/* auto-linkified URLs (linkify.js) — brand blue + bolder. :deep() is required because the <a> are
   injected via v-html and therefore have no scoped data-v attribute for a plain scoped selector. */
.pd-about__body :deep(a), .ed-speaker__bio :deep(a) { color: #2e70dd; font-weight: 600; text-decoration: none; }
.pd-about__body :deep(a):hover, .ed-speaker__bio :deep(a):hover { text-decoration: underline; }
.pd-cards--for { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.pd-forcard { position: relative; background: #fff; border: 1px solid #e4e9f1; border-radius: 16px; padding: 24px 24px 24px 28px; }
.pd-forcard__dot { position: absolute; left: 24px; top: 30px; width: 10px; height: 10px; border-radius: 50%; background: #5495f3; }
.pd-forcard p { margin: 0 0 0 22px; color: #5b6472; font-size: 1rem; }
/* ── Hero (pd-chero) + sticky buycard — copied from CoursePage (values inlined) ── */
.pd-hero { padding: 24px 0 8px; }
.pd-chero { display: grid; grid-template-columns: minmax(0, 1fr) 358px; gap: 44px; align-items: start; }
.pd-chero__main { min-width: 0; }
.pd-badge { display: inline-flex; align-items: center; gap: 9px; padding: 8px 16px; border-radius: 999px; background: #eaf1fe; color: #1f5fc9; font-weight: 600; font-size: 14px; }
.pd-badge__dot { width: 8px; height: 8px; border-radius: 50%; background: #f09157; box-shadow: 0 0 0 4px rgba(240,145,87,0.22); }
.pd-hero__title--course { margin: 18px 0 0; font-weight: 700; font-size: clamp(1.9rem, 3.4vw, 2.9rem); line-height: 1.08; letter-spacing: -0.02em; }
.pd-hero__hook { margin: 20px 0 0; max-width: 60ch; font-size: 1.1rem; color: #5b6472; white-space: pre-line; }
.pd-author-mini { display: inline-flex; align-items: center; gap: 12px; margin-top: 24px; text-decoration: none; color: inherit; }
.pd-author-mini img, .pd-author-mini__ava { width: 46px; height: 46px; border-radius: 50%; object-fit: cover; flex: none; }
.pd-author-mini__ava { display: grid; place-items: center; background: #eaf1fe; color: #1f5fc9; font-weight: 700; }
.pd-author-mini__text { display: flex; flex-direction: column; line-height: 1.25; font-size: 0.98rem; }
.pd-author-mini__text .muted { color: #98a0ad; font-size: 0.85rem; }
.pd-video { position: relative; width: 100%; aspect-ratio: 16 / 9; margin-top: 30px; border-radius: 26px; overflow: hidden; background: #091747; box-shadow: 0 14px 40px -20px rgba(9,23,71,0.24); border: 1px solid #e4e9f1; }
.pd-video--static img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.pd-chero__side { min-width: 0; }
.pd-buycard { position: sticky; top: 82px; background: #fff; border: 1px solid #e4e9f1; border-radius: 26px; padding: 26px 26px 22px; box-shadow: 0 14px 40px -20px rgba(9,23,71,0.24); }
.pd-buycard__price { display: flex; align-items: baseline; gap: 12px; margin-bottom: 18px; }
.pd-buycard__now { font-weight: 700; font-size: 2.1rem; letter-spacing: -0.02em; color: #091747; }
.pd-buycard__ok { font-weight: 700; font-size: 1.4rem; color: #21a366; margin-bottom: 14px; }
.pd-buycard__note { margin: 0 0 14px; font-size: 0.9rem; color: #5b6472; }
.pd-buycard .ed-choices { margin-bottom: 16px; }
.ed-promo-input { display: block; width: 100%; height: 44px; margin-bottom: 14px; padding: 0 14px; border: 1px solid #d7dee8; border-radius: 12px; font: inherit; font-size: 15px; box-sizing: border-box; }
.ed-promo-input:focus { outline: none; border-color: #5495f3; }
.ed-promo-note { margin: 0 0 14px; font-size: 0.85rem; color: #98a0ad; }
.pd-statlist { list-style: none; margin: 22px 0 0; padding: 20px 0 0; border-top: 1px solid #e4e9f1; display: grid; gap: 14px; }
.pd-statlist li { display: flex; align-items: center; gap: 12px; color: #5b6472; font-size: 0.98rem; }
.pd-statlist .pd-ic { flex: none; width: 20px; height: 20px; stroke: #1f5fc9; fill: none; stroke-width: 2; }
.pd-buyerr { margin: 12px 0 0; text-align: center; font-size: 0.85rem; color: #dc2626; }
.pd-btn { display: inline-flex; align-items: center; justify-content: center; text-decoration: none; border: 0; cursor: pointer; font-family: inherit; font-weight: 700; background: #2e70dd; color: #fff; border-radius: 999px; transition: background 0.16s; }
.pd-btn:hover { background: #2360c6; }
.pd-btn--ghost { background: transparent; color: #2e70dd; border: 1.5px solid #2e70dd; }
.pd-btn--ghost:hover { background: rgba(46, 112, 221, 0.08); }
.ed-btn-or { margin-top: 10px; }
.pd-btn:disabled { opacity: 0.55; cursor: default; }
.pd-btn--lg { padding: 16px 28px; font-size: 1.05rem; }
.pd-btn--block { width: 100%; }

@media (max-width: 1000px) {
    .pd-chero { grid-template-columns: 1fr; gap: 26px; }
    .pd-buycard { position: static; }
    .pd-learn { grid-template-columns: 1fr; }
    .pd-cards--for { grid-template-columns: 1fr; }
}
@media (max-width: 900px) {
    .pd-wrap { padding-inline: 22px; }
    .pd-section { padding: 56px 0; }
}
.ed-agree { display: flex; gap: 9px; align-items: flex-start; margin: 6px 0 14px; font-size: 13px; line-height: 1.45; color: #5b6472; cursor: pointer; }
.ed-agree input { margin-top: 2px; flex: none; width: 16px; height: 16px; accent-color: #2563eb; }
.ed-agree a { color: #2563eb; text-decoration: underline; }
.ed-review { position: relative; aspect-ratio: 16 / 9; max-width: 860px; border-radius: 14px; overflow: hidden; background: #000; }
.ed-review iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.pd-video iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.pd-video__poster { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; padding: 0; cursor: pointer; background: #091747; display: grid; place-items: center; }
.pd-video__poster img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.pd-video__play { position: relative; width: 74px; height: 74px; border-radius: 50%; background: rgba(255,255,255,0.92); display: grid; place-items: center; box-shadow: 0 10px 30px -8px rgba(0,0,0,0.5); }
.pd-video__play svg { width: 32px; height: 32px; fill: #2563eb; margin-left: 3px; }
.ed-speaker { display: flex; gap: 18px; align-items: flex-start; }
.ed-speaker__ava { width: 96px; height: 96px; border-radius: 50%; object-fit: cover; flex: none; }
.ed-speaker__ava--i { display: grid; place-items: center; background: #eef2f7; color: #2563eb; font-weight: 700; font-size: 34px; }
.ed-speaker__name { font-weight: 800; font-size: 20px; }
.ed-speaker__city { color: #64748b; font-size: 14px; margin-top: 2px; }
.ed-speaker__bio { margin-top: 10px; line-height: 1.6; }
.ed-speaker__bio p { margin: 0 0 8px; white-space: pre-line; }
.ed-speaker__socials { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 14px; }
.ed-speaker__social { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: #eef2f7; color: #2563eb; transition: transform .16s, background .16s, color .16s; }
.ed-speaker__social :deep(svg) { width: 22px; height: 22px; fill: currentColor; }
.ed-speaker__social:hover { transform: translateY(-2px); background: #2563eb; color: #fff; }
@media (max-width: 560px) { .ed-speaker { flex-direction: column; } }
</style>
