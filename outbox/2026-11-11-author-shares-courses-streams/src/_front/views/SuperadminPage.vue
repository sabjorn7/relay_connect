<!--
  SuperadminPage.vue — hand-written rebuild of the WeWeb /superadmin admin back-office.
  Owns /superadmin (PAGE_OVERRIDES); the old WeWeb page is kept at /superadmin-legacy for the 3
  rare infra actions not rebuilt (PeerTube token refresh, clear-video, lesson field edit). Shares
  the visual language + isAdmin gate with DashboardPage (analytics). This is a WRITE surface (real
  money + publishing); every mutation goes through an admin-gated SECURITY DEFINER RPC + audit log.

    Tabs: Курсы · Статьи (moderation, +articles_logs) · Жалобы (UGC stream_reports) · Комиссия
    (+admin_money_log ledger) · Выплаты (approve/reject+refund) · Видео (storage-by-author).

  ACCESS (admin-only): guest → /login; logged in but not admin (role!=='admin' && !superadmin) → /.
-->
<template>
    <main class="sa">
        <div v-if="loading" class="sa-boot">Загрузка…</div>

        <template v-else>
            <header class="sa-top">
                <div class="sa-top__l">
                    <h1 class="sa-title">Модерация</h1>
                    <p class="sa-sub">Панель администратора · действия с реальными последствиями</p>
                </div>
                <a class="sa-analytics" href="/dashboard">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>
                    Аналитика
                </a>
            </header>

            <nav class="sa-tabs" role="tablist">
                <button v-for="t in TABS" :key="t.key" type="button" role="tab"
                        class="sa-tab" :class="{ 'is-on': active === t.key }" :aria-selected="active === t.key"
                        @click="active = t.key">
                    {{ t.label }}
                    <span v-if="counts[t.key]" class="sa-badge">{{ counts[t.key] }}</span>
                </button>
            </nav>

            <!-- LIVE: Курсы -->
            <section v-if="active === 'courses'" class="sa-panel sa-pad">
                <div class="sa-panelhead">
                    <h2>Очередь на модерацию</h2>
                    <span class="sa-note">Статус «Отправлено на модерацию»</span>
                </div>
                <div v-if="queue.loading" class="sa-empty">Загрузка…</div>
                <div v-else-if="!queue.rows.length" class="sa-empty">Очередь пуста</div>
                <div v-else class="sa-tablewrap">
                    <table class="sa-table">
                        <thead><tr><th>Название</th><th>Автор</th><th>Создан</th><th class="ta-r">Действия</th></tr></thead>
                        <tbody>
                            <tr v-for="c in queue.rows" :key="c.id">
                                <td class="ttl">{{ c.Title || 'Без названия' }}</td>
                                <td>{{ c.ownerName }}<span v-if="c.ownerRole" class="role-chip">{{ c.ownerRole }}</span></td>
                                <td class="muted">{{ fmtDate(c.created_at) }}</td>
                                <td class="ta-r acts">
                                    <button type="button" class="btn btn-ok" @click="askApprove('course', c)">Одобрить</button>
                                    <button type="button" class="btn btn-ghost" @click="askReturn('course', c)">Вернуть</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <!-- LIVE: Статьи -->
            <section v-else-if="active === 'articles'" class="sa-panel sa-pad">
                <div class="sa-panelhead">
                    <h2>Очередь на модерацию</h2>
                    <span class="sa-note">Статьи · статус «Отправлено на модерацию»</span>
                </div>
                <div v-if="aqueue.loading" class="sa-empty">Загрузка…</div>
                <div v-else-if="!aqueue.rows.length" class="sa-empty">Очередь пуста</div>
                <div v-else class="sa-tablewrap">
                    <table class="sa-table">
                        <thead><tr><th>Название</th><th>Автор</th><th>Создан</th><th class="ta-r">Действия</th></tr></thead>
                        <tbody>
                            <tr v-for="a in aqueue.rows" :key="a.id">
                                <td class="ttl">{{ a.Title || 'Без названия' }}</td>
                                <td>{{ a.ownerName }}<span v-if="a.ownerRole" class="role-chip">{{ a.ownerRole }}</span></td>
                                <td class="muted">{{ fmtDate(a.created_at) }}</td>
                                <td class="ta-r acts">
                                    <button type="button" class="btn btn-ok" @click="askApprove('article', a)">Одобрить</button>
                                    <button type="button" class="btn btn-ghost" @click="askReturn('article', a)">Вернуть</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <!-- LIVE: Жалобы (UGC) -->
            <section v-else-if="active === 'reports'" class="sa-panel sa-pad">
                <div class="sa-panelhead">
                    <h2>Очередь жалоб</h2>
                    <span class="sa-note">UGC · открытые (new / notified)</span>
                </div>
                <div v-if="rqueue.loading" class="sa-empty">Загрузка…</div>
                <div v-else-if="!rqueue.rows.length" class="sa-empty">Жалоб нет</div>
                <div v-else class="sa-cards">
                    <div v-for="r in rqueue.rows" :key="r.id" class="rcard">
                        <div class="rcard__head">
                            <span><b>{{ r.reporterName }}</b> → <b>{{ r.targetUserName }}</b></span>
                            <span class="rcard__meta">{{ r.surface || '—' }} · {{ fmtDate(r.created_at) }}</span>
                        </div>
                        <div class="rcard__block">
                            <div class="rcard__label">Снимок жалобы</div>
                            <div class="rcard__text">{{ r.text_snapshot || '—' }}</div>
                        </div>
                        <div class="rcard__block">
                            <div class="rcard__label">Сообщение сейчас</div>
                            <div v-if="r.msgExists" class="rcard__text">{{ r.msgText || (r.msgAttachment ? '[вложение: ' + r.msgAttachment + ']' : '—') }}</div>
                            <div v-else class="rcard__text rcard__text--gone">Сообщение больше не существует</div>
                        </div>
                        <div class="rcard__acts">
                            <button type="button" class="btn btn-ghost" @click="askReport('dismiss', r)">Отклонить</button>
                            <button type="button" class="btn btn-danger" :disabled="!r.msgExists" @click="askReport('delete', r)">Удалить сообщение</button>
                        </div>
                    </div>
                </div>
            </section>

            <!-- LIVE: Комиссия -->
            <section v-else-if="active === 'commission'" class="sa-panel sa-pad">
                <div class="sa-panelhead">
                    <h2>Комиссия авторов</h2>
                    <span class="sa-note">Доля автора, % · оставшаяся часть принадлежит платформе · только будущие платежи</span>
                </div>
                <div class="sa-search"><input v-model="authors.search" type="search" placeholder="Поиск по имени" /></div>
                <div v-if="authors.loading" class="sa-empty">Загрузка…</div>
                <div v-else-if="authors.error" class="sa-empty" role="alert">{{ authors.error }}</div>
                <div v-else-if="!authorsFiltered.length" class="sa-empty">Ничего не найдено</div>
                <div v-else class="sa-tablewrap">
                    <table class="sa-table">
                        <thead><tr><th>Автор</th><th>Роль</th><th v-for="category in shareCategories" :key="category.id" class="ta-r">{{ category.label }}</th><th class="ta-r">Баланс</th><th class="ta-r">Действия</th></tr></thead>
                        <tbody>
                            <tr v-for="a in authorsFiltered" :key="a.id">
                                <td class="ttl">{{ a.Name || '—' }}</td>
                                <td><span class="role-chip">{{ a.role }}</span></td>
                                <td v-for="category in shareCategories" :key="category.id" class="ta-r strong"><button type="button" class="btn btn-ghost" :aria-label="'Изменить долю автора: ' + category.label" @click="askCommission(a, category.id)">{{ a[category.field] }}%</button></td>
                                <td class="ta-r muted">{{ fmtRub(a.Ammount) }}</td>
                                <td class="ta-r acts">
                                    <button type="button" class="btn btn-ghost" @click="askBalance(a)">Баланс</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <!-- LIVE: Выплаты -->
            <section v-else-if="active === 'payouts'" class="sa-panel sa-pad">
                <div class="sa-panelhead">
                    <h2>Заявки на вывод</h2>
                    <span class="sa-note">status='Запрошено' · перевод делается вручную через банк</span>
                </div>
                <div v-if="pqueue.loading" class="sa-empty">Загрузка…</div>
                <div v-else-if="!pqueue.rows.length" class="sa-empty">Заявок нет</div>
                <div v-else class="sa-cards">
                    <div v-for="r in pqueue.rows" :key="r.id" class="pcard">
                        <div class="pcard__head">
                            <span><b>{{ r.authorName }}</b> · <b>{{ fmtRub(r.amount) }}</b></span>
                            <span class="rcard__meta">{{ fmtDate(r.created_at) }}</span>
                        </div>
                        <div class="pcard__contract">Договор № {{ r.author_num_dog || '—' }}<template v-if="r.author_registered_at"> · с {{ fmtDate(r.author_registered_at) }}</template></div>
                        <div v-if="r.req_changed_recently" class="pcard__warn">⚠️ Реквизиты недавно изменены ({{ fmtDate(r.req_updated_at) }}) — проверьте внимательнее</div>
                        <div class="pcard__bank">
                            <span class="pcard__label">Банк: {{ reqf(r, 'bank_name') }}<template v-if="rtypeLabel(r)"> · {{ rtypeLabel(r) }}</template></span>
                            <button v-if="!r.revealed" type="button" class="pcard__reveal" @click="r.revealed = true">Показать реквизиты</button>
                            <div v-else class="pcard__reqs">
                                <div v-if="reqf(r, 'name') !== '—'">ФИО/наим.: {{ reqf(r, 'name') }}</div>
                                <div>ИНН: {{ reqf(r, 'inn') }}</div>
                                <div v-if="reqf(r, 'kpp') !== '—'">КПП: {{ reqf(r, 'kpp') }}</div>
                                <div v-if="reqf(r, 'ogrn') !== '—'">ОГРН(ИП): {{ reqf(r, 'ogrn') }}</div>
                                <div>БИК: {{ reqf(r, 'bik') }}</div>
                                <div>Р/С: {{ reqf(r, 'account') }}</div>
                                <div>К/С: {{ reqf(r, 'corr_account') }}</div>
                                <button type="button" class="pcard__reveal" @click="r.revealed = false">Скрыть</button>
                            </div>
                        </div>
                        <div class="rcard__acts">
                            <button type="button" class="btn btn-ok" @click="askPayout('approve', r)">Одобрить</button>
                            <button type="button" class="btn btn-danger" @click="askPayout('reject', r)">Отклонить</button>
                        </div>
                    </div>
                </div>
            </section>

            <!-- LIVE: Видео — storage by author (read-only) -->
            <section v-else-if="active === 'video'" class="sa-panel sa-pad">
                <div class="sa-panelhead">
                    <h2>Видеохранилище по авторам</h2>
                    <span class="sa-note">курсы: тизер + видео уроков · из полей video_size</span>
                </div>
                <div v-if="storage.loading" class="sa-empty">Загрузка…</div>
                <template v-else>
                    <div class="stotal">Видео: <b>{{ storage.totalVids }}</b> · записанный размер <b>{{ fmtSize(storage.total) }}</b> · {{ storage.owners.length }} владельцев ({{ storage.withVideo }} с видео)</div>
                    <p class="vstat__note" style="margin: 0 0 14px;">Размер берётся из поля video_size, а оно записано не у всех загрузок — там, где видео есть, но размер не сохранён, показано «размер не записан». Полный сигнал — число видео.</p>
                    <div class="sa-tablewrap">
                        <table class="sa-table">
                            <thead><tr><th>Автор</th><th class="ta-r">Видео</th><th class="ta-r">Записанный размер</th></tr></thead>
                            <tbody>
                                <template v-for="o in storage.owners" :key="o.owner_id || 'none'">
                                    <tr class="srow" @click="o.expanded = !o.expanded">
                                        <td><span class="scaret">{{ o.expanded ? '▾' : '▸' }}</span> {{ o.owner_name }}</td>
                                        <td class="ta-r strong">{{ o.vids }}</td>
                                        <td class="ta-r muted">{{ o.bytes > 0 ? fmtSize(o.bytes) : (o.vids > 0 ? 'не записан' : '—') }}</td>
                                    </tr>
                                    <template v-if="o.expanded">
                                        <tr v-for="c in o.courses" :key="c.id" class="ssub">
                                            <td class="ssub__title">{{ c.title }}</td>
                                            <td class="ta-r muted">{{ c.vids }}</td>
                                            <td class="ta-r muted">{{ c.bytes > 0 ? fmtSize(c.bytes) : (c.vids > 0 ? 'не записан' : '—') }}</td>
                                        </tr>
                                    </template>
                                </template>
                            </tbody>
                        </table>
                    </div>

                    <div v-if="video.status" class="vstat" style="margin-top: 26px;">
                        <div class="vstat__row">
                            <span class="vstat__label">Токен загрузки видео (PeerTube)</span>
                            <span class="vstat__badge" :class="video.status.expired ? 'is-bad' : 'is-ok'">{{ video.status.expired ? 'Истёк' : 'Активен' }}</span>
                        </div>
                        <p class="vstat__note">Значения токенов не показываются. Обновление токена, сброс видео уроков и правка уроков — на <a href="/superadmin-legacy" class="vstat__link">устаревшей панели</a>.</p>
                    </div>
                </template>
            </section>

            <!-- LIVE: Промокоды -->
            <section v-else-if="active === 'promo'" class="sa-panel sa-pad">
                <div class="sa-panelhead">
                    <h2>Промокоды</h2>
                    <span class="sa-note">Скидка применяется в корзине при оформлении заказа</span>
                </div>

                <form class="promo-form" @submit.prevent="createPromo">
                    <div class="promo-grid">
                        <label class="pf">Код
                            <input v-model="promoForm.code" type="text" placeholder="SALE20" autocapitalize="characters" />
                        </label>
                        <label class="pf">Тип скидки
                            <select v-model="promoForm.type">
                                <option value="percent">Процент, %</option>
                                <option value="fixed">Фиксированная, ₽</option>
                            </select>
                        </label>
                        <label class="pf">{{ promoForm.type === 'percent' ? 'Процент (1–100)' : 'Сумма, ₽' }}
                            <input v-model.number="promoForm.value" type="number" min="1" :max="promoForm.type === 'percent' ? 100 : null" step="1" />
                        </label>
                        <label class="pf">Область действия
                            <select v-model="promoForm.scope">
                                <option value="all">Любой товар</option>
                                <option value="course">Конкретный курс</option>
                            </select>
                        </label>
                        <label class="pf">Лимит активаций
                            <input v-model.number="promoForm.limit" type="number" min="1" step="1" placeholder="без лимита" />
                        </label>
                        <label class="pf">Действует до
                            <input v-model="promoForm.expires" type="date" />
                        </label>
                    </div>
                    <div v-if="promoForm.scope === 'course'" class="promo-course">
                        <div v-if="promoCourse.picked" class="promo-picked">
                            Курс: <b>{{ promoCourse.picked.Title }}</b>
                            <button type="button" @click="clearPromoCourse">×</button>
                        </div>
                        <template v-else>
                            <input v-model="promoCourse.q" type="search" placeholder="Поиск курса по названию…" @input="searchPromoCourse" />
                            <ul v-if="promoCourse.results.length" class="promo-results">
                                <li v-for="c in promoCourse.results" :key="c.id" @click="pickPromoCourse(c)">{{ c.Title || 'Без названия' }}</li>
                            </ul>
                        </template>
                    </div>
                    <p v-if="promoForm.error" class="sa-modal__err">{{ promoForm.error }}</p>
                    <div class="promo-formacts">
                        <button type="submit" class="btn btn-ok" :disabled="promoForm.busy">{{ promoForm.busy ? 'Создание…' : 'Создать промокод' }}</button>
                    </div>
                </form>

                <div v-if="promos.loading" class="sa-empty">Загрузка…</div>
                <div v-else-if="!promos.rows.length" class="sa-empty">Промокодов пока нет</div>
                <div v-else class="sa-tablewrap">
                    <table class="sa-table">
                        <thead><tr><th>Код</th><th>Скидка</th><th>Область</th><th class="ta-r">Лимит / исп.</th><th>Действует до</th><th class="ta-r">Действия</th></tr></thead>
                        <tbody>
                            <tr v-for="p in promos.rows" :key="p.id">
                                <td class="ttl strong">{{ p.code }}</td>
                                <td>{{ p.discount_type === 'percent' ? p.discount_value + '%' : fmtRub(p.discount_value) }}</td>
                                <td>{{ p.scope_type === 'course' ? (p.scopeCourseTitle || 'курс') : 'любой товар' }}</td>
                                <td class="ta-r muted">{{ p.used_count }} / {{ p.usage_limit == null ? '∞' : p.usage_limit }}</td>
                                <td class="muted">{{ p.expires_at ? fmtDate(p.expires_at) : '—' }}</td>
                                <td class="ta-r acts"><button type="button" class="btn btn-danger" @click="askDeletePromo(p)">Удалить</button></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <!-- Placeholders for the other phases -->
            <section v-else class="sa-panel sa-soon">
                <div class="soon">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
                    <h2>{{ activeTab.label }}</h2>
                    <p>{{ activeTab.descr }}</p>
                    <span v-if="counts[active]" class="soon__queue">В очереди: {{ counts[active] }}</span>
                    <span class="soon__tag">Фаза {{ activeTab.phase }}</span>
                </div>
            </section>

            <!-- Confirmation modal (mandatory before any mutation) -->
            <div v-if="modal.open" class="sa-modal" @click.self="closeModal">
                <div class="sa-modal__box" role="dialog" aria-modal="true">
                    <h3>{{ modalCfg.title }}</h3>
                    <p v-if="modalItemLabel" class="sa-modal__course">«{{ modalItemLabel }}»</p>
                    <p v-if="modalCfg.warn" class="sa-modal__warn">{{ modalCfg.warn }}</p>
                    <template v-if="modalCfg.needsValue">
                        <label class="sa-modal__field">{{ modalCfg.valueLabel || 'Новая комиссия, %' }}
                            <input type="number" v-model.number="modal.value" :min="modalCfg.numMin" :max="modalCfg.numMax" :step="modalCfg.numStep ?? 1" class="sa-modal__num" />
                        </label>
                    </template>
                    <template v-if="modalCfg.needsComment || modalCfg.optionalComment">
                        <p class="sa-modal__hint">{{ modalCfg.commentHint }}</p>
                        <textarea v-model="modal.comment" class="sa-modal__ta" rows="3" :placeholder="modalCfg.commentPlaceholder"></textarea>
                    </template>
                    <p v-if="modal.error" class="sa-modal__err">{{ modal.error }}</p>
                    <div class="sa-modal__acts">
                        <button type="button" class="btn btn-ghost" :disabled="modal.busy" @click="closeModal">Отмена</button>
                        <button type="button" class="btn" :class="modalCfg.btn"
                                :disabled="modal.busy || (modalCfg.needsComment && !modal.comment.trim()) || (modalCfg.needsValue && !isValidValue)" @click="confirmAction">
                            {{ modal.busy ? 'Сохранение…' : modalCfg.confirm }}
                        </button>
                    </div>
                </div>
            </div>

            <div v-if="toastMsg" class="sa-toast">{{ toastMsg }}</div>
        </template>
    </main>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { getSupabase, loadUser, isLikelyLoggedIn } from '@/_front/chrome/headerAccount.js';

const router = useRouter();
const loading = ref(true);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TABS = [
    { key: 'courses', label: 'Курсы', phase: 'S1', descr: 'Очередь на модерацию курсов: публикация и возврат на доработку с замечаниями.' },
    { key: 'articles', label: 'Статьи', phase: 'S2', descr: 'Модерация статей со статусами, замечаниями и логом изменений.' },
    { key: 'reports', label: 'Жалобы', phase: 'S3', descr: 'Жалобы на сообщения и пользователей (stream_reports) и блокировки — интерфейса пока нет, строим с нуля.' },
    { key: 'commission', label: 'Комиссия', phase: 'S4', descr: 'Комиссия авторов и корректировка баланса пользователей.' },
    { key: 'payouts', label: 'Выплаты', phase: 'S5', descr: 'Одобрение и отклонение заявок на вывод средств. Самое ответственное — реальные деньги.' },
    { key: 'video', label: 'Видео', phase: 'S6', descr: 'Инфраструктура видео (PeerTube): токены, обработка загрузок.' },
    { key: 'promo', label: 'Промокоды', phase: 'S7', descr: 'Промокоды на скидку: процент или фиксированная сумма, общий или на конкретный курс.' },
];
const active = ref('courses');
const activeTab = computed(() => TABS.find((t) => t.key === active.value) || TABS[0]);

// Read-only queue counts (SELECT only — safe). Keyed by tab; only the ones we can define now.
const counts = reactive({ courses: 0, articles: 0, reports: 0, payouts: 0 });

let sb = null;
async function countEq(table, col, val) {
    let q = sb.from(table).select('id', { count: 'exact', head: true });
    if (col) q = q.eq(col, val);
    const { count } = await q;
    return count || 0;
}
async function countIn(table, col, vals) {
    const { count } = await sb.from(table).select('id', { count: 'exact', head: true }).in(col, vals);
    return count || 0;
}
async function loadCounts() {
    const [courses, articles, reports, payouts] = await Promise.all([
        countIn('course', 'ModStatus', ['Отправлено на модерацию', 'На модерации']),
        countIn('articles', 'Status', ['Отправлено на модерацию', 'На модерации']),
        countIn('stream_reports', 'status', ['new', 'notified']),
        countEq('sales', 'status', 'Запрошено'),
    ]);
    counts.courses = courses; counts.articles = articles; counts.reports = reports; counts.payouts = payouts;
}

/* ── S1: Курсы — moderation queue + actions ─────────────────────────────────── */
const queue = reactive({ loading: false, rows: [] });
const aqueue = reactive({ loading: false, rows: [] });
const rqueue = reactive({ loading: false, rows: [] });
const shareCategories = [{ id: 'courses', label: 'Курсы', field: 'authorCommissionCourses' }, { id: 'streams', label: 'Трансляции', field: 'authorCommissionStreams' }];
const authors = reactive({ loading: false, rows: [], search: '', error: '' });
const pqueue = reactive({ loading: false, rows: [] });
const video = reactive({ loading: false, status: null });
const storage = reactive({ loading: false, owners: [], total: 0, totalVids: 0, withVideo: 0 });
const modal = reactive({ open: false, entity: null, mode: null, item: null, value: null, category: null, comment: '', busy: false, error: '' });
const modalCfg = computed(() => {
    const e = modal.entity, m = modal.mode;
    if (e === 'promo' && m === 'delete') return { title: 'Удалить промокод?', warn: '⚠️ Промокод перестанет действовать. История активаций сохранится.', confirm: 'Удалить', btn: 'btn-danger', needsComment: false, needsValue: false };
    if (e === 'payout' && m === 'approve') return { title: 'Подтвердить выплату?', warn: '⚠️ Это НЕ автоматический перевод. Отмечайте «Подтверждено» только ПОСЛЕ того, как сделали перевод вручную через банк.', confirm: 'Подтвердить выплату', btn: 'btn-ok', needsComment: false, needsValue: false, optionalComment: true, commentHint: 'Комментарий (необязательно) — сохранится в аудит-лог.', commentPlaceholder: 'Например: перевод сделан 12.09' };
    if (e === 'payout' && m === 'reject') return { title: 'Отклонить заявку на вывод?', warn: `Сумма ${fmtRub(modal.item?.amount)} вернётся на баланс автора.`, confirm: 'Отклонить и вернуть', btn: 'btn-danger', needsComment: false, needsValue: false, optionalComment: true, commentHint: 'Комментарий (необязательно) — сохранится в аудит-лог.', commentPlaceholder: 'Причина отклонения' };
    if (e === 'report' && m === 'delete') return { title: 'Удалить сообщение?', warn: '⚠️ Сообщение будет удалено безвозвратно для всех участников чата.', confirm: 'Удалить', btn: 'btn-danger', needsComment: false, needsValue: false };
    if (e === 'report' && m === 'dismiss') return { title: 'Отклонить жалобу?', warn: '', confirm: 'Отклонить', btn: 'btn-primary', needsComment: false, needsValue: false };
    if (e === 'balance') return { title: 'Коррекция баланса', warn: '⚠️ Ручная правка баланса. Плюс — начислить, минус — списать. Операция попадёт в аудит-лог.', confirm: 'Применить', btn: 'btn-ok', needsComment: true, needsValue: true, numMin: undefined, numMax: undefined, numStep: 1, valueLabel: 'Сумма (+ начислить / − списать), ₽', commentHint: 'Причина — сохранится в аудит-логе.', commentPlaceholder: 'Например: ручная корректировка / возврат' };
    if (e === 'commission') return { title: 'Изменить долю автора: ' + (shareCategories.find(c => c.id === modal.category)?.label || '') + '?', warn: 'Влияет только на будущие продажи — прошлые начисления не меняются.', confirm: 'Сохранить', btn: 'btn-ok', needsComment: true, needsValue: true, numMin: 0, numMax: 100, numStep: 1, valueLabel: 'Доля автора, %', commentHint: 'Причина изменения — сохранится в аудит-логе.', commentPlaceholder: 'Например: договорённость о новой ставке' };
    if (m === 'approve') return { title: `Опубликовать ${e === 'article' ? 'статью' : 'курс'}?`, warn: e === 'article' ? '⚠️ Статья станет видна всем пользователям платформы.' : '⚠️ Курс станет виден всем пользователям платформы.', confirm: 'Опубликовать', btn: 'btn-ok', needsComment: false, needsValue: false };
    return { title: 'Вернуть на доработку?', warn: '', confirm: 'Вернуть', btn: 'btn-warn', needsComment: true, needsValue: false, commentHint: 'Автор увидит этот комментарий в своём кабинете.', commentPlaceholder: 'Что нужно исправить' };
});
const modalItemLabel = computed(() => {
    if (!modal.item) return '';
    if (modal.entity === 'report') return modal.item.targetUserName ? `сообщение пользователя ${modal.item.targetUserName}` : 'сообщение';
    if (modal.entity === 'payout') return `${modal.item.authorName || '—'} · ${fmtRub(modal.item.amount)}`;
    if (modal.entity === 'commission' || modal.entity === 'balance') return modal.item.Name || '—';
    if (modal.entity === 'promo') return modal.item.code || '';
    return modal.item.Title || '';
});
const isValidValue = computed(() => {
    const v = modal.value;
    if (typeof v !== 'number' || Number.isNaN(v)) return false;
    if (modal.entity === 'balance') return v !== 0;      // дельта баланса: любое ненулевое число (±)
    return v >= 0 && v <= 100;                            // комиссия: 0..100
});
const toastMsg = ref('');
let toastTimer = null;
function toast(m) { toastMsg.value = m; if (toastTimer) clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastMsg.value = ''; }, 3000); }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`; }
const fmtRub = (n) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} ₽`;
// Реквизиты из снимка заявки (admin_list_withdrawals.requisites jsonb).
function reqf(r, k) { const v = r && r.requisites ? r.requisites[k] : null; return (v === null || v === undefined || v === '') ? '—' : v; }
function rtypeLabel(r) { const t = r && (r.recipient_type || (r.requisites && r.requisites.recipient_type)); return t === 'self_employed' ? 'Самозанятый' : t === 'ip' ? 'ИП' : t === 'ooo' ? 'ООО' : ''; }

async function loadAuthors() {
    authors.loading = true;
    try {
        const { data, error } = await sb.from('users').select('id,"Name",role,"authorCommissionCourses","authorCommissionStreams","Ammount"')
            .in('role', ['Спикер', 'Учебное заведение']).order('Name', { ascending: true });
        if (error) throw error;
        authors.rows = data || []; authors.error = '';
    } catch (e) { authors.rows = []; authors.error = 'Не удалось загрузить ставки авторов. Повторите открытие раздела.'; }
    authors.loading = false;
}
const authorsFiltered = computed(() => {
    const q = authors.search.trim().toLowerCase();
    return q ? authors.rows.filter((a) => (a.Name || '').toLowerCase().includes(q)) : authors.rows;
});
function askCommission(a, category) { const field = shareCategories.find(c => c.id === category)?.field; if (!field) return; modal.open = true; modal.entity = 'commission'; modal.category = category; modal.mode = 'set'; modal.item = a; modal.value = a[field]; modal.comment = ''; modal.error = ''; }
function askBalance(a) { modal.open = true; modal.entity = 'balance'; modal.mode = 'adjust'; modal.item = a; modal.value = null; modal.comment = ''; modal.error = ''; }

async function loadPayoutQueue() {
    pqueue.loading = true;
    try {
        // Реквизиты/заявки — только через admin-gated RPC (таблица withdrawal_requests закрыта RLS).
        const { data, error } = await sb.rpc('admin_list_withdrawals', { p_status: 'Запрошено' });
        if (error) throw error;
        pqueue.rows = (data || []).map((r) => ({
            ...r,
            authorName: r.author_name || (r.user_id ? 'Автор' : '— (нет user)'),
            revealed: false,
        }));
        counts.payouts = pqueue.rows.length;
    } catch (e) { console.warn('loadPayoutQueue failed', e); }
    pqueue.loading = false;
}
function askPayout(mode, item) { modal.open = true; modal.entity = 'payout'; modal.mode = mode; modal.item = item; modal.comment = ''; modal.error = ''; }

async function loadVideoStatus() {
    video.loading = true;
    try {
        const { data, error } = await sb.rpc('admin_peertube_status');
        if (error) throw error;
        video.status = (data && !data.empty) ? data : null;
    } catch (e) { console.warn('loadVideoStatus failed', e); video.status = null; }
    video.loading = false;
}
function fmtSize(bytes) {
    const b = Number(bytes) || 0;
    if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' ГБ';
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' МБ';
    if (b >= 1024) return (b / 1024).toFixed(0) + ' КБ';
    return b + ' Б';
}
async function loadStorage() {
    storage.loading = true;
    try {
        const [{ data: courses }, { data: lessons }] = await Promise.all([
            sb.from('course').select('id,"Title",owner,video_size,video_id'),
            sb.from('lessons').select('"Course",video_size,video_id').limit(100000),
        ]);
        const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
        const hasVid = (v) => v != null && v !== '';
        // video_size is recorded for only some uploads → we also count videos (video_id) which is
        // complete data. lessonAgg: courseId -> { bytes: Σvideo_size, vids: #lessons-with-video }.
        const lessonAgg = {};
        for (const l of (lessons || [])) {
            if (!l.Course) continue;
            const a = lessonAgg[l.Course] || (lessonAgg[l.Course] = { bytes: 0, vids: 0 });
            a.bytes += num(l.video_size);
            if (hasVid(l.video_id)) a.vids += 1;
        }
        const owners = {};
        for (const c of (courses || [])) {
            const la = lessonAgg[c.id] || { bytes: 0, vids: 0 };
            const bytes = num(c.video_size) + la.bytes;
            const vids = (hasVid(c.video_id) ? 1 : 0) + la.vids;
            const oid = c.owner || 'none';
            if (!owners[oid]) owners[oid] = { owner_id: c.owner, owner_name: '—', bytes: 0, vids: 0, courses: [], expanded: false };
            owners[oid].bytes += bytes; owners[oid].vids += vids;
            owners[oid].courses.push({ id: c.id, title: c.Title || 'Без названия', bytes, vids });
        }
        const ids = Object.values(owners).map((o) => o.owner_id).filter(Boolean);
        if (ids.length) {
            const { data: us } = await sb.from('users').select('id,"Name"').in('id', ids);
            const nm = {}; for (const u of (us || [])) nm[u.id] = u.Name;
            for (const o of Object.values(owners)) o.owner_name = nm[o.owner_id] || (o.owner_id ? 'Автор' : '— (без владельца)');
        }
        // sort by video COUNT (complete data) first, then recorded size.
        const list = Object.values(owners).sort((a, b) => b.vids - a.vids || b.bytes - a.bytes);
        for (const o of list) o.courses.sort((a, b) => b.vids - a.vids || b.bytes - a.bytes);
        storage.owners = list;
        storage.total = list.reduce((s, o) => s + o.bytes, 0);
        storage.totalVids = list.reduce((s, o) => s + o.vids, 0);
        storage.withVideo = list.filter((o) => o.vids > 0).length;
    } catch (e) { console.warn('loadStorage failed', e); }
    storage.loading = false;
}

/* ── S7: Промокоды — create / list / delete (admin RPCs) ────────────────────── */
const promos = reactive({ loading: false, rows: [] });
const promoForm = reactive({ code: '', type: 'percent', value: null, scope: 'all', limit: null, expires: '', busy: false, error: '' });
const promoCourse = reactive({ q: '', results: [], picked: null, timer: null });

async function loadPromos() {
    promos.loading = true;
    try {
        const { data, error } = await sb.rpc('admin_list_promos');
        if (error) throw error;
        const rows = data || [];
        const cids = [...new Set(rows.filter((r) => r.scope_type === 'course' && r.scope_course_id).map((r) => r.scope_course_id))];
        const titles = {};
        if (cids.length) { const { data: cs } = await sb.from('course').select('id,"Title"').in('id', cids); for (const c of (cs || [])) titles[c.id] = c.Title; }
        promos.rows = rows.map((r) => ({ ...r, scopeCourseTitle: titles[r.scope_course_id] }));
    } catch (e) { console.warn('loadPromos failed', e); }
    promos.loading = false;
}

function searchPromoCourse() {
    if (promoCourse.timer) clearTimeout(promoCourse.timer);
    const q = promoCourse.q.trim();
    if (q.length < 2) { promoCourse.results = []; return; }
    promoCourse.timer = setTimeout(async () => {
        try {
            const { data } = await sb.from('course').select('id,"Title"').ilike('Title', `%${q}%`).limit(10);
            promoCourse.results = data || [];
        } catch (e) { promoCourse.results = []; }
    }, 250);
}
function pickPromoCourse(c) { promoCourse.picked = c; promoCourse.results = []; promoCourse.q = c.Title || ''; }
function clearPromoCourse() { promoCourse.picked = null; promoCourse.q = ''; promoCourse.results = []; }

async function createPromo() {
    if (promoForm.busy) return;
    promoForm.error = '';
    const code = (promoForm.code || '').trim();
    if (!code) { promoForm.error = 'Укажите код.'; return; }
    if (!(Number(promoForm.value) > 0)) { promoForm.error = 'Значение скидки должно быть больше 0.'; return; }
    if (promoForm.type === 'percent' && Number(promoForm.value) > 100) { promoForm.error = 'Процент не больше 100.'; return; }
    if (promoForm.scope === 'course' && !promoCourse.picked) { promoForm.error = 'Выберите курс для привязки.'; return; }
    promoForm.busy = true;
    try {
        const res = await sb.rpc('admin_create_promo', {
            p_code: code,
            p_type: promoForm.type,
            p_value: Number(promoForm.value),
            p_scope: promoForm.scope,
            p_course_id: promoForm.scope === 'course' ? promoCourse.picked.id : null,
            p_limit: promoForm.limit ? Number(promoForm.limit) : null,
            p_expires: promoForm.expires ? new Date(promoForm.expires + 'T23:59:59').toISOString() : null,
        });
        if (res.error) throw res.error;
        promoForm.code = ''; promoForm.value = null; promoForm.scope = 'all'; promoForm.limit = null; promoForm.expires = '';
        clearPromoCourse();
        toast('Промокод создан');
        await loadPromos();
    } catch (e) { promoForm.error = friendlyError(e); }
    promoForm.busy = false;
}

function askDeletePromo(p) { modal.open = true; modal.entity = 'promo'; modal.mode = 'delete'; modal.item = p; modal.comment = ''; modal.error = ''; }

async function loadQueue() {
    queue.loading = true;
    try {
        const { data } = await sb.from('course').select('id,"Title",created_at,owner')
            .in('ModStatus', ['Отправлено на модерацию', 'На модерации'])
            .order('created_at', { ascending: true });
        const rows = data || [];
        const ids = [...new Set(rows.map((r) => r.owner).filter(Boolean))];
        const owners = {};
        if (ids.length) {
            const { data: us } = await sb.from('users').select('id,"Name",role').in('id', ids);
            for (const u of (us || [])) owners[u.id] = u;
        }
        queue.rows = rows.map((r) => ({ ...r, ownerName: owners[r.owner]?.Name || '—', ownerRole: owners[r.owner]?.role || '' }));
        counts.courses = queue.rows.length;
    } catch (e) { console.warn('loadQueue failed', e); }
    queue.loading = false;
}

async function loadArticleQueue() {
    aqueue.loading = true;
    try {
        const { data } = await sb.from('articles').select('id,"Title","Creator",created_at')
            .in('Status', ['Отправлено на модерацию', 'На модерации'])
            .order('created_at', { ascending: true });
        const rows = data || [];
        const ids = [...new Set(rows.map((r) => r.Creator).filter(Boolean))];
        const owners = {};
        if (ids.length) {
            const { data: us } = await sb.from('users').select('id,"Name",role').in('id', ids);
            for (const u of (us || [])) owners[u.id] = u;
        }
        aqueue.rows = rows.map((r) => ({ ...r, ownerName: owners[r.Creator]?.Name || '—', ownerRole: owners[r.Creator]?.role || '' }));
        counts.articles = aqueue.rows.length;
    } catch (e) { console.warn('loadArticleQueue failed', e); }
    aqueue.loading = false;
}

async function loadReportQueue() {
    rqueue.loading = true;
    try {
        const { data } = await sb.from('stream_reports')
            .select('id,reporter,target_type,target_id,target_user,surface,reason,status,text_snapshot,created_at')
            .in('status', ['new', 'notified']).order('created_at', { ascending: false });
        const rows = data || [];
        const uids = [...new Set(rows.flatMap((r) => [r.reporter, r.target_user]).filter(Boolean))];
        const users = {};
        if (uids.length) { const { data: us } = await sb.from('users').select('id,"Name"').in('id', uids); for (const u of (us || [])) users[u.id] = u.Name; }
        const msgIds = [...new Set(rows.filter((r) => r.target_type === 'message').map((r) => r.target_id).filter(Boolean))];
        const msgs = {};
        if (msgIds.length) { const { data: ms } = await sb.from('messages').select('id,text,creator,attachment_name,attachment_type').in('id', msgIds); for (const m of (ms || [])) msgs[m.id] = m; }
        rqueue.rows = rows.map((r) => {
            const m = msgs[r.target_id];
            return { ...r, reporterName: users[r.reporter] || 'Аноним', targetUserName: users[r.target_user] || '—',
                msgExists: r.target_type === 'message' ? !!m : false,
                msgText: m?.text || '', msgAttachment: m?.attachment_name || (m?.attachment_type ? 'файл' : '') };
        });
        counts.reports = rqueue.rows.length;
    } catch (e) { console.warn('loadReportQueue failed', e); }
    rqueue.loading = false;
}

function askApprove(entity, item) { modal.open = true; modal.entity = entity; modal.mode = 'approve'; modal.item = item; modal.comment = ''; modal.error = ''; }
function askReturn(entity, item) { modal.open = true; modal.entity = entity; modal.mode = 'return'; modal.item = item; modal.comment = ''; modal.error = ''; }
function askReport(mode, item) { modal.open = true; modal.entity = 'report'; modal.mode = mode; modal.item = item; modal.comment = ''; modal.error = ''; }
function closeModal() { if (modal.busy) return; modal.open = false; modal.item = null; modal.comment = ''; modal.value = null; modal.error = ''; }

function friendlyError(e) {
    const m = e?.message || '';
    if (/forbidden/i.test(m)) return 'Нет прав администратора.';
    if (/already exists/i.test(m)) return 'Такой код уже существует.';
    if (/not in moderation queue/i.test(m)) return 'Курс уже не в очереди — обновите список.';
    if (/not found/i.test(m)) return 'Курс не найден.';
    if (/comment required/i.test(m)) return 'Укажите комментарий для автора.';
    return `Не удалось выполнить: ${m || 'ошибка'}`;
}

async function confirmAction() {
    if (modal.busy || !modal.item) return;
    const cfg = modalCfg.value;
    if (cfg.needsComment && !modal.comment.trim()) { modal.error = 'Укажите ' + (modal.entity === 'commission' ? 'причину' : 'комментарий') + '.'; return; }
    if (cfg.needsValue && !isValidValue.value) { modal.error = modal.entity === 'balance' ? 'Укажите ненулевую сумму.' : 'Комиссия должна быть от 0 до 100.'; return; }
    modal.busy = true; modal.error = '';
    try {
        const id = modal.item.id; const comment = modal.comment.trim();
        let res, done;
        if (modal.entity === 'payout') {
            res = modal.mode === 'approve'
                ? await sb.rpc('admin_approve_withdrawal_v2', { p_id: id, p_comment: comment || null })
                : await sb.rpc('admin_reject_withdrawal_v2', { p_id: id, p_comment: comment || null });
        } else if (modal.entity === 'commission') {
            res = await sb.rpc('admin_set_author_share', { p_user: id, p_category: modal.category, p_value: modal.value, p_reason: comment });
        } else if (modal.entity === 'balance') {
            res = await sb.rpc('admin_adjust_balance', { p_user: id, p_delta: modal.value, p_reason: comment });
        } else if (modal.entity === 'report') {
            res = modal.mode === 'dismiss'
                ? await sb.rpc('admin_dismiss_report', { p_report: id })
                : await sb.rpc('admin_delete_reported_message', { p_report: id });
        } else if (modal.entity === 'promo') {
            res = await sb.rpc('admin_delete_promo', { p_id: id });
        } else if (modal.entity === 'course') {
            res = modal.mode === 'approve'
                ? await sb.rpc('admin_approve_course', { p_course: id })
                : await sb.rpc('admin_return_course', { p_course: id, p_comment: comment });
        } else {
            res = modal.mode === 'approve'
                ? await sb.rpc('admin_approve_article', { p_article: id })
                : await sb.rpc('admin_return_article', { p_article: id, p_comment: comment });
        }
        if (res.error) throw res.error;
        if (modal.entity === 'payout') {
            pqueue.rows = pqueue.rows.filter((r) => r.id !== id); counts.payouts = pqueue.rows.length;
            done = modal.mode === 'approve' ? 'Выплата подтверждена' : 'Заявка отклонена, средства возвращены';
        } else if (modal.entity === 'commission') {
            const row = authors.rows.find((r) => r.id === id); const field = shareCategories.find(c => c.id === modal.category)?.field; if (row && field) row[field] = modal.value;
            done = 'Комиссия обновлена';
        } else if (modal.entity === 'balance') {
            const row = authors.rows.find((r) => r.id === id); if (row && res.data != null) row.Ammount = res.data;
            done = 'Баланс скорректирован';
        } else if (modal.entity === 'report') {
            rqueue.rows = rqueue.rows.filter((r) => r.id !== id); counts.reports = rqueue.rows.length;
            done = modal.mode === 'dismiss' ? 'Жалоба отклонена' : 'Сообщение удалено, жалоба закрыта';
        } else if (modal.entity === 'promo') {
            promos.rows = promos.rows.filter((r) => r.id !== id);
            done = 'Промокод удалён';
        } else if (modal.entity === 'course') {
            queue.rows = queue.rows.filter((r) => r.id !== id); counts.courses = queue.rows.length;
            done = modal.mode === 'approve' ? 'Курс опубликован' : 'Курс возвращён на доработку';
        } else {
            aqueue.rows = aqueue.rows.filter((r) => r.id !== id); counts.articles = aqueue.rows.length;
            done = modal.mode === 'approve' ? 'Статья опубликована' : 'Статья возвращена на доработку';
        }
        modal.open = false; modal.item = null; modal.comment = ''; modal.value = null;
        toast(done);
    } catch (e) { modal.error = friendlyError(e); }
    modal.busy = false;
}

// load the relevant queue when its tab is (or becomes) active
watch(active, (t) => {
    if (t === 'courses') loadQueue();
    if (t === 'articles') loadArticleQueue();
    if (t === 'reports') loadReportQueue();
    if (t === 'commission') loadAuthors();
    if (t === 'payouts') loadPayoutQueue();
    if (t === 'video') { loadStorage(); loadVideoStatus(); }
    if (t === 'promo') loadPromos();
});

onMounted(async () => {
    if (!isLikelyLoggedIn()) { router.replace('/login'); return; }
    for (let i = 0; i < 40 && !getSupabase(); i++) await sleep(150);
    sb = getSupabase();
    if (!sb) { router.replace('/'); return; }

    const me = await loadUser(sb);
    const isAdmin = !!me && (me.role === 'admin' || me.superadmin === true);
    if (!isAdmin) { router.replace('/'); return; }

    try { await loadCounts(); } catch (e) { console.warn('loadCounts failed', e); }
    if (active.value === 'courses') await loadQueue();
    loading.value = false;
});
</script>

<style scoped>
.sa {
    min-height: calc(100vh - 62px);
    background: #f4f5f7;
    color: #1b1f27;
    font-family: 'Onest', system-ui, -apple-system, sans-serif;
    padding: 24px 20px 64px;
    max-width: 1200px; margin: 0 auto;
    box-sizing: border-box;
}
.sa * { box-sizing: border-box; }
.sa-boot { text-align: center; color: #8a94a6; padding: 80px 0; }

.sa-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.sa-title { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; margin: 0; }
.sa-sub { margin: 4px 0 0; color: #8a94a6; font-size: 14px; }
.sa-analytics { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 16px; border-radius: 10px;
    background: #fff; border: 1px solid #e1e5ea; color: #1b1f27; font-weight: 600; font-size: 14px; text-decoration: none; }
.sa-analytics:hover { border-color: #5495f3; color: #5495f3; }
.sa-analytics svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

.sa-tabs { display: flex; gap: 6px; flex-wrap: wrap; border-bottom: 1px solid #e3e7ee; margin: 22px 0 18px; }
.sa-tab { display: inline-flex; align-items: center; gap: 7px; appearance: none; border: none; background: transparent; padding: 10px 14px; font: inherit; font-weight: 600; font-size: 14px; color: #5b6472; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.sa-tab:hover { color: #5495f3; }
.sa-tab.is-on { color: #5495f3; border-bottom-color: #5495f3; }
.sa-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: #e2574c; color: #fff; font-size: 11px; font-weight: 700; }

.sa-panel { background: #fff; border: 1px solid #eceef2; border-radius: 16px; }
.sa-soon { padding: 0; }
.soon { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 56px 24px; }
.soon svg { width: 40px; height: 40px; fill: none; stroke: #c2ccda; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.soon h2 { margin: 4px 0 0; font-size: 18px; }
.soon p { margin: 0; max-width: 480px; color: #8a94a6; font-size: 14px; line-height: 1.5; }
.soon__queue { margin-top: 4px; padding: 4px 12px; border-radius: 999px; background: #fdeceb; color: #d1483d; font-weight: 700; font-size: 12px; }
.soon__tag { margin-top: 2px; padding: 4px 12px; border-radius: 999px; background: #eef4ff; color: #5495f3; font-weight: 700; font-size: 12px; }

/* S1 Курсы — queue table + actions */
.sa-pad { padding: 20px; }
.sa-panelhead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.sa-panelhead h2 { font-size: 17px; font-weight: 700; margin: 0; }
.sa-note { color: #8a94a6; font-size: 13px; }
.sa-empty { text-align: center; color: #8a94a6; padding: 40px 0; }
.sa-tablewrap { overflow-x: auto; }
.sa-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.sa-table th { text-align: left; font-weight: 600; color: #8a94a6; font-size: 12px; padding: 8px 10px; border-bottom: 1px solid #eceef2; }
.sa-table td { padding: 12px 10px; border-bottom: 1px solid #f2f4f7; vertical-align: middle; }
.sa-table .ttl { font-weight: 500; max-width: 340px; }
.sa-table .muted { color: #8a94a6; white-space: nowrap; }
.sa-table .ta-r { text-align: right; }
.role-chip { display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 999px; background: #eef1f5; color: #5b6472; font-size: 11px; font-weight: 600; }
.acts { white-space: nowrap; }
.btn { appearance: none; border: 1px solid transparent; border-radius: 9px; padding: 8px 14px; font: inherit; font-weight: 600; font-size: 13px; cursor: pointer; }
.btn:disabled { opacity: .55; cursor: default; }
.btn-ok { background: #3ba55d; color: #fff; }
.btn-warn { background: #e2854c; color: #fff; }
.btn-ghost { background: #fff; border-color: #e1e5ea; color: #5b6472; margin-left: 8px; }
.btn-ghost:hover:not(:disabled) { border-color: #5495f3; color: #5495f3; }
.btn-danger { background: #e2574c; color: #fff; }
.btn-primary { background: #5495f3; color: #fff; }

/* S3 Жалобы — report cards */
.sa-cards { display: flex; flex-direction: column; gap: 14px; }
.rcard { border: 1px solid #eceef2; border-radius: 14px; padding: 16px; }
.rcard__head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; font-size: 14px; }
.rcard__meta { color: #8a94a6; font-size: 13px; }
.rcard__block { margin-bottom: 10px; }
.rcard__label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #8a94a6; margin-bottom: 3px; }
.rcard__text { font-size: 14px; background: #f7f9fc; border: 1px solid #eef1f5; border-radius: 10px; padding: 10px 12px; overflow-wrap: anywhere; }
.rcard__text--gone { color: #8a94a6; font-style: italic; }
.rcard__acts { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }

/* S4 Комиссия — author list + edit modal field */
.sa-search { margin-bottom: 14px; }
.sa-search input { width: 100%; max-width: 320px; height: 38px; border: 1px solid #e1e5ea; border-radius: 10px; padding: 0 12px; font: inherit; font-size: 14px; }
.sa-table .strong { font-weight: 700; }
.sa-modal__field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #5b6472; margin-bottom: 10px; }
.sa-modal__num { width: 120px; height: 40px; border: 1px solid #e1e5ea; border-radius: 10px; padding: 0 12px; font: inherit; font-size: 16px; }

/* S5 Выплаты — payout cards */
.pcard { border: 1px solid #eceef2; border-radius: 14px; padding: 16px; }
.pcard__head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; font-size: 15px; }
.pcard__contract { font-size: 13px; color: #5b6472; margin: -4px 0 10px; }
.pcard__warn { background: #fef3c7; border: 1px solid #fcd34d; color: #92400e; border-radius: 10px; padding: 8px 12px; margin-bottom: 10px; font-size: 13px; font-weight: 600; }
.pcard__bank { background: #f7f9fc; border: 1px solid #eef1f5; border-radius: 10px; padding: 12px; margin-bottom: 12px; font-size: 14px; }
.pcard__label { color: #5b6472; }
.pcard__reveal { margin-left: 12px; appearance: none; border: none; background: none; color: #5495f3; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; padding: 0; }
.pcard__reqs { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; color: #1b1f27; }

/* S6 Видео — read-only PeerTube status */
.vstat { display: flex; flex-direction: column; gap: 2px; max-width: 560px; }
.vstat__row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 4px; border-bottom: 1px solid #f2f4f7; font-size: 14px; }
.vstat__label { color: #5b6472; }
.vstat__rel { color: #8a94a6; }
.vstat__badge { padding: 3px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.vstat__badge.is-ok { background: #e7f6ec; color: #2f9e57; }
.vstat__badge.is-bad { background: #fdeceb; color: #d1483d; }
.vstat__note { margin: 16px 0 0; color: #a4adba; font-size: 12px; line-height: 1.5; }
.vstat__link { color: #5495f3; text-decoration: underline; }

/* S6 — video storage by author */
.stotal { margin-bottom: 14px; font-size: 15px; color: #1b1f27; }
.srow { cursor: pointer; }
.srow:hover { background: #f7f9fc; }
.scaret { display: inline-block; width: 14px; color: #8a94a6; }
.ssub td { background: #fafbfc; font-size: 13px; }
.ssub__title { padding-left: 26px !important; color: #5b6472; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* S7 Промокоды — create form */
.promo-form { border: 1px solid #eceef2; border-radius: 14px; padding: 16px; margin-bottom: 18px; }
.promo-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.pf { display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: #5b6472; }
.pf input, .pf select { height: 38px; border: 1px solid #e1e5ea; border-radius: 10px; padding: 0 10px; font: inherit; font-size: 14px; background: #fff; }
.promo-course { position: relative; margin-top: 12px; }
.promo-course input { width: 100%; max-width: 420px; height: 38px; border: 1px solid #e1e5ea; border-radius: 10px; padding: 0 12px; font: inherit; font-size: 14px; }
.promo-results { list-style: none; margin: 4px 0 0; padding: 4px; max-width: 420px; border: 1px solid #e1e5ea; border-radius: 10px; background: #fff; max-height: 220px; overflow-y: auto; box-shadow: 0 10px 30px rgba(11,31,77,.12); }
.promo-results li { padding: 8px 10px; border-radius: 8px; font-size: 14px; cursor: pointer; }
.promo-results li:hover { background: #eef4ff; color: #5495f3; }
.promo-picked { font-size: 14px; color: #1b1f27; }
.promo-picked button { appearance: none; border: none; background: #fdeceb; color: #d1483d; border-radius: 6px; width: 22px; height: 22px; margin-left: 8px; cursor: pointer; font-size: 14px; line-height: 1; }
.promo-formacts { margin-top: 14px; }
@media (max-width: 680px) { .promo-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 460px) { .promo-grid { grid-template-columns: 1fr; } }

.sa-modal { position: fixed; inset: 0; z-index: 1000; background: rgba(11, 31, 77, .38); display: flex; align-items: center; justify-content: center; padding: 20px; }
.sa-modal__box { background: #fff; border-radius: 16px; padding: 24px; max-width: 440px; width: 100%; box-shadow: 0 20px 60px rgba(11, 31, 77, .25); }
.sa-modal__box h3 { margin: 0 0 8px; font-size: 18px; }
.sa-modal__course { margin: 0 0 10px; font-weight: 600; }
.sa-modal__warn { margin: 0 0 4px; color: #d1483d; font-size: 14px; font-weight: 600; }
.sa-modal__hint { margin: 0 0 10px; color: #8a94a6; font-size: 13px; }
.sa-modal__ta { width: 100%; border: 1px solid #e1e5ea; border-radius: 10px; padding: 10px; font: inherit; font-size: 14px; resize: vertical; box-sizing: border-box; }
.sa-modal__err { margin: 10px 0 0; color: #d1483d; font-size: 13px; }
.sa-modal__acts { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.sa-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 1001; background: #0b1f4d; color: #fff; padding: 12px 20px; border-radius: 10px; font-size: 14px; font-weight: 600; box-shadow: 0 10px 30px rgba(11, 31, 77, .3); }

@media (max-width: 560px) { .sa-title { font-size: 22px; } }
</style>
