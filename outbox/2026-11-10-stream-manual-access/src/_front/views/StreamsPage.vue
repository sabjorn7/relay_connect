<template>
    <div class="streams-page">
        <div class="sp-inner">
        <label v-if="activeStreamId && linkFallback" class="sp-field"><span>Ссылка на эфир — скопируйте вручную</span><input :value="linkFallback" readonly @focus="$event.target.select()" /></label>
        <p v-if="activeStreamId && notice" class="sp-notice" role="status">{{ notice }}</p>
        <h1 v-if="activeStreamId" class="sp-title">Трансляции</h1>

        <!-- ============================ DETAIL VIEW ============================ -->
        <template v-if="activeStreamId">
            <a class="sp-back sp-back-block" href="/streams" @click.prevent="backToList">← К списку эфиров</a>

            <div v-if="detailLoading" class="sp-muted">Загрузка эфира…</div>
            <div v-else-if="!detail" class="sp-card sp-muted">Эфир не найден.</div>

            <template v-else>
                <div class="sp-detail-head">
                    <span class="sp-badge" :class="'sp-badge-' + displayState">{{ displayLabel }}</span>
                    <span v-if="displayState === 'live' && viewers != null" class="sp-badge sp-badge-viewers">👁 {{ viewers }} {{ viewerWord(viewers) }}</span>
                    <span class="sp-price">{{ priceLabel(detail) }}</span>
                </div>
                <h2 class="sp-detail-title">{{ detail.title }}</h2>
                <div class="sp-detail-author">{{ authorName(detail) }}</div>
                <div class="sp-detail-sub">
                    <span v-if="displayState === 'scheduled' && detail.scheduled_at" class="sp-detail-when">🕐 Начало: {{ formatDateTime(detail.scheduled_at) }}</span>
                    <button v-if="detail.visibility === 'unlisted'" type="button" class="sp-btn sp-btn-secondary" @click="copyStreamLink(detail)">Скопировать ссылку</button>
                    <button v-else class="sp-btn sp-btn-secondary sp-share-btn" @click="shareStream">🔗 {{ shareMsg || 'Поделиться' }}</button>
                </div>

                <!-- Push-подписка — всем залогиненным; iPhone вне standalone получает подсказку «на Домой». -->
                <div class="sp-detail-sub"><PushToggle /></div>

                <!-- Player / gate -->
                <div class="sp-player-wrap">
                    <!-- Access still resolving (session restoring): neutral placeholder, no "buy" flash -->
                    <div v-if="!hasAccess && !accessResolved" class="sp-player sp-player-msg">
                        <div><div class="sp-muted">Загрузка…</div></div>
                    </div>
                    <!-- Paid & no access: buy, or access-period-ended -->
                    <div v-else-if="!hasAccess" class="sp-player sp-player-msg">
                        <div v-if="canBuy">
                            <div class="sp-msg-title">Платный эфир — {{ priceLabel(detail) }}</div>
                            <div class="sp-muted">Доступ к эфиру и записи на {{ detail.access_months }} мес. с даты эфира.</div>
                            <input v-model="streamPromo" type="text" class="sp-promo-input" placeholder="Промокод (необязательно)" />
                            <button class="sp-btn sp-btn-primary sp-buy-btn" :disabled="buying" @click="buyStream">
                                {{ buying ? 'Переход к оплате…' : 'Купить за ' + priceLabel(detail) }}
                            </button>
                            <p v-if="error" class="sp-error sp-buy-error">{{ error }}</p>
                            <button v-if="error && !buying" class="sp-btn sp-btn-secondary sp-retry-btn" @click="buyStream">↻ Повторить</button>
                        </div>
                        <div v-else>
                            <div class="sp-msg-title">Доступ к записи завершён</div>
                            <div class="sp-muted">Период доступа к этому эфиру закончился.</div>
                        </div>
                    </div>
                    <!-- Waiting: own placeholder + light poll -->
                    <div v-else-if="displayState === 'scheduled'" class="sp-player sp-player-msg">
                        <div>
                            <div class="sp-msg-title">Эфир ещё не начался</div>
                            <div v-if="detail.scheduled_at" class="sp-msg-when">Начало: {{ formatDateTime(detail.scheduled_at) }}</div>
                            <div class="sp-muted">Страница обновится автоматически, когда трансляция начнётся.</div>
                        </div>
                    </div>
                    <!-- Ended, replay still transcoding: processing placeholder + light poll -->
                    <div v-else-if="replayProcessing" class="sp-player sp-player-msg">
                        <div>
                            <div class="sp-msg-title">Запись обрабатывается</div>
                            <div class="sp-muted">Эфир завершён. Запись появится здесь автоматически через несколько минут.</div>
                        </div>
                    </div>
                    <!-- Live / ended (replay ready): PeerTube iframe -->
                    <StreamViewer v-else :src="playerSrc" />
                    <StreamDiagnostics v-if="detail.mode === 'multi' && (isAuthor || me?.role === 'admin')" :key="detail.id" :stream-id="detail.id" />
                </div>

                <!-- Multi-host (co-host) controls — ONLY mode='multi'; the solo path is untouched. -->
                <div v-if="detail.mode === 'multi'" class="sp-cohost">
                    <!-- Owner -->
                    <template v-if="isAuthor">
                        <div class="sp-cohost-actions">
                            <template v-if="detail.status === 'live'">
                                <button class="sp-btn sp-btn-primary" @click="enterCall">Войти в эфир</button>
                                <button class="sp-btn sp-btn-secondary" :disabled="liveBusy" @click="endMulti">Завершить эфир</button>
                            </template>
                            <button v-else class="sp-btn sp-btn-primary" :disabled="liveBusy" @click="startMulti">Начать эфир</button>
                        </div>
                        <div class="sp-cohost-invite">
                            <input v-model="inviteEmail" type="email" placeholder="e-mail со-ведущего" autocomplete="off" @keyup.enter="inviteCohostWeb" />
                            <button class="sp-btn sp-btn-secondary" :disabled="inviting" @click="inviteCohostWeb">{{ inviting ? '…' : 'Пригласить' }}</button>
                        </div>
                        <ul v-if="cohosts.length" class="sp-cohost-list">
                            <li v-for="c in cohosts" :key="c.id">
                                <span class="sp-cohost-name">{{ cohostName(c) }}</span>
                                <span class="sp-cohost-status">{{ cohostStatusLabel(c) }}</span>
                                <span v-if="c.role === 'cohost'" class="sp-cohost-remove">
                                    <template v-if="confirmRemoveId === c.id">
                                        <button class="sp-link-danger" :disabled="removingId === c.id" @click="removeCohostWeb(c)">{{ removingId === c.id ? '…' : 'Точно?' }}</button>
                                        <button class="sp-link-muted" @click="confirmRemoveId = null">Отмена</button>
                                    </template>
                                    <button v-else class="sp-link-danger" @click="confirmRemoveId = c.id">Удалить</button>
                                </span>
                            </li>
                        </ul>
                    </template>
                    <!-- Invited co-host -->
                    <button v-else-if="myCohostRole" class="sp-btn sp-btn-primary" @click="enterCall">Войти как со-ведущий</button>
                </div>

                <p v-if="error" class="sp-error">{{ error }}</p>
                <p v-if="detail.description" class="sp-detail-desc">{{ detail.description }}</p>

                <!-- Viewer chat — same access gate as the stream itself -->
                <section v-if="hasAccess" class="sp-chat">
                    <h3 class="sp-chat-title">Чат эфира</h3>
                    <div ref="feedEl" class="sp-chat-feed">
                        <div v-if="chatLoading" class="sp-muted">Загрузка чата…</div>
                        <div v-else-if="!messages.length" class="sp-muted">Сообщений пока нет. Будьте первым!</div>
                        <div
                            v-for="m in messages"
                            :key="m.id"
                            class="sp-chat-row"
                            :class="{ 'sp-chat-mine': m.is_mine || (me && m.owner === me.id) }"
                        >
                            <img v-if="m.authorUser?.Photo" :src="m.authorUser.Photo" class="sp-chat-ava" />
                            <div v-else class="sp-chat-ava sp-chat-ava-empty">{{ (m.authorUser?.Name || '?').slice(0, 1) }}</div>
                            <div class="sp-chat-bubble">
                                <div class="sp-chat-meta">
                                    <span class="sp-chat-name">{{ m.authorUser?.Name || 'Пользователь' }}</span>
                                    <span class="sp-chat-time">{{ msgTime(m.created_at) }}</span>
                                    <button v-if="canDeleteMsg(m)" class="sp-chat-del" @click="removeMessage(m)">удалить</button>
                                </div>
                                <div class="sp-chat-text">{{ m.text }}</div>
                            </div>
                        </div>
                    </div>
                    <div v-if="me" class="sp-chat-composer">
                        <textarea
                            v-model="chatText"
                            class="sp-chat-input"
                            rows="1"
                            placeholder="Написать в чат…"
                            @keydown.enter.exact.prevent="sendChat"
                        ></textarea>
                        <button class="sp-btn sp-btn-primary" :disabled="!chatText.trim() || sending" @click="sendChat">
                            {{ sending ? '…' : 'Отправить' }}
                        </button>
                    </div>
                    <div v-else class="sp-muted sp-chat-login">Войдите, чтобы писать в чат.</div>
                </section>
                <!-- Access still resolving: neutral chat skeleton (don't flash "no access") -->
                <section v-else-if="!accessResolved" class="sp-chat" aria-busy="true">
                    <h3 class="sp-chat-title">Чат эфира</h3>
                    <div class="sp-chat-feed"><div class="sp-muted">Загрузка чата…</div></div>
                </section>
            </template>
        </template>

        <!-- ============================= LIST VIEW ============================= -->
        <template v-else>
            <header class="pd-hero">
                <span class="pd-blob" aria-hidden="true"></span>
                <div class="pd-hero__text">
                    <span class="pd-badge"><span class="pd-badge__dot" aria-hidden="true"></span>Прямой эфир</span>
                    <h1 class="pd-hero__title">Трансляции</h1>
                    <p class="pd-hero__sub">Живые эфиры и семинары от практикующих экспертов — смотрите онлайн, покупайте и пересматривайте в записи.</p>
                </div>
            </header>

            <div v-if="loading" class="sp-muted">Загрузка…</div>

            <template v-else>
                <!-- Create (speakers / institutions) -->
                <section v-if="isStreamer" class="sp-card">
                    <div class="sp-card-head">
                        <div>
                            <h2>Запланировать трансляцию</h2>
                            <a href="/faq/guides#stream" class="sp-howto">Как это сделать?</a>
                        </div>
                        <button v-if="!showForm" class="sp-btn sp-btn-primary" @click="showForm = true">Запланировать трансляцию</button>
                    </div>
                    <form v-if="showForm" class="sp-form" @submit.prevent="createBroadcast">
                        <label class="sp-field">
                            <span>Название</span>
                            <input v-model.trim="form.title" type="text" minlength="3" maxlength="120" placeholder="Например: Разбор кейсов по кинезиологии" required />
                            <span v-if="form.title && form.title.trim().length < 3" class="sp-note">Название — минимум 3 символа.</span>
                        </label>
                        <label class="sp-field">
                            <span>Описание</span>
                            <textarea v-model.trim="form.description" rows="3" maxlength="2000" placeholder="Коротко о чём эфир"></textarea>
                        </label>
                        <div class="sp-field">
                            <span>Обложка <span class="sp-optional">(необязательно)</span></span>
                            <div v-if="form.cover_url" class="sp-cover">
                                <img :src="form.cover_url" alt="Обложка эфира" class="sp-cover-img" />
                                <div class="sp-cover-ctl">
                                    <label class="sp-btn sp-btn-mini" :class="{ 'is-disabled': coverBusy }">
                                        {{ coverBusy ? 'Загрузка…' : 'Заменить' }}
                                        <input type="file" accept="image/*" class="sp-hidden-file" :disabled="coverBusy" @change="onCoverUpload" />
                                    </label>
                                    <button type="button" class="sp-btn sp-btn-mini sp-btn-ghost" :disabled="coverBusy" @click="removeCover">Удалить</button>
                                </div>
                            </div>
                            <label v-else class="sp-upload" :class="{ 'is-disabled': coverBusy }">
                                {{ coverBusy ? 'Загрузка…' : '＋ Загрузить обложку' }}
                                <input type="file" accept="image/*" class="sp-hidden-file" :disabled="coverBusy" @change="onCoverUpload" />
                            </label>
                            <p v-if="coverError" class="sp-note sp-note-err">{{ coverError }}</p>
                        </div>
                        <label class="sp-field">
                            <span>Дата и время эфира <span class="sp-optional">(необязательно)</span></span>
                            <input v-model="form.scheduledAt" type="datetime-local" />
                        </label>
                        <div class="sp-field">
                            <span>Формат эфира</span>
                            <div class="sp-radio-row">
                                <label class="sp-radio"><input type="radio" value="solo" v-model="form.format" /> Один ведущий</label>
                                <label class="sp-radio"><input type="radio" value="multi" v-model="form.format" /> Со-ведущие</label>
                            </div>
                            <p class="sp-note">
                                {{ form.format === 'multi'
                                    ? 'Несколько ведущих в одном кадре. Приглашение и запуск — на странице эфира.'
                                    : 'Классический эфир: камера телефона или OBS, один ведущий.' }}
                            </p>
                        </div>
                        <StreamQualityField :full-hd-enabled="fullHdEnabled" id="stream-create-quality" v-model="form.video_quality" :solo="form.format === 'solo'" />
                        <div class="sp-field">
                            <span>Доступ</span>
                            <div class="sp-radio-row">
                                <label class="sp-radio"><input type="radio" value="free" v-model="form.kind" /> Бесплатно</label>
                                <label class="sp-radio"><input type="radio" value="paid" v-model="form.kind" /> Платно</label>
                            </div>
                        </div>
                        <fieldset class="sp-field sp-visibility">
                            <legend>Доступность эфира</legend>
                            <div class="sp-radio-row">
                                <label class="sp-radio"><input v-model="form.visibility" type="checkbox" name="stream-visibility" true-value="unlisted" false-value="public" :disabled="form.kind === 'paid' || !unlistedEnabled" /> Скрыть эфир</label>
                            </div>
                            <p class="sp-note">Эфир не будет отображаться в общем списке. Смотреть его смогут пользователи, получившие ссылку</p>
                            <p v-if="!unlistedEnabled" class="sp-note">Скрытые эфиры пока недоступны: серверная защита ещё не включена.</p>
                            <p v-if="form.kind === 'paid' && form.visibility === 'unlisted'" class="sp-note sp-note-err" role="alert">Для платного эфира выберите «Доступен всем» или верните бесплатный режим.</p>
                        </fieldset>
                        <div v-if="form.kind === 'paid'" class="sp-paid-fields">
                            <label class="sp-field">
                                <span>Цена, ₽</span>
                                <input v-model.number="form.price" type="number" min="1" step="1" placeholder="Например: 990" />
                            </label>
                            <label class="sp-field">
                                <span>Доступ к записи</span>
                                <select v-model.number="form.months">
                                    <option :value="1">1 месяц</option>
                                    <option :value="3">3 месяца</option>
                                    <option :value="6">6 месяцев</option>
                                    <option :value="12">12 месяцев</option>
                                </select>
                            </label>
                            <p class="sp-note">Доступ отсчитывается от даты эфира.</p>
                            <label class="sp-check">
                                <input type="checkbox" v-model="form.chat" />
                                <span>Общий чат трансляции — покупатели автоматически попадают в общий групповой чат (как у мероприятий)</span>
                            </label>
                            <label class="sp-check">
                                <input type="checkbox" v-model="form.recording" />
                                <span>Запись как отдельный курс — после завершения эфира запись автоматически публикуется курсом в каталоге и появляется в «Мои курсы» у всех, кто купил эфир</span>
                            </label>
                        </div>
                        <div class="sp-form-actions">
                            <button type="submit" class="sp-btn sp-btn-primary" :disabled="creating || !canSubmit">
                                {{ creating ? 'Создаём эфир…' : 'Создать эфир' }}
                            </button>
                            <button type="button" class="sp-btn sp-btn-secondary" :disabled="creating" @click="cancelForm">Отменить</button>
                        </div>
                    </form>
                    <p v-if="error" class="sp-error">{{ error }}</p>
                    <p v-if="createdStream && createdStream.author === me?.id" class="sp-notice sp-created" role="status">Трансляция создана. <button type="button" class="sp-btn sp-btn-mini" @click="openStream(createdStream.id)">Открыть эфир</button></p>
                </section>

                <!-- Author's own streams -->
                <section v-if="me && (isStreamer || myStreams.length)" class="sp-card sp-mine" aria-labelledby="my-streams-title">
                    <h2 id="my-streams-title">Мои трансляции</h2>
                    <div class="sp-mine-filters" role="group" aria-label="Доступность моих трансляций">
                        <button v-for="filter in myVisibilityFilters" :key="filter.value" type="button" class="sp-btn sp-btn-mini" :class="{ 'sp-btn-primary': myVisibility === filter.value }" :aria-pressed="myVisibility === filter.value" @click="myVisibility = filter.value">{{ filter.label }}</button>
                    </div>
                    <p v-if="myStreamsError" class="sp-error" role="alert">{{ myStreamsError }} <button type="button" class="sp-btn sp-btn-mini" @click="load">Повторить загрузку</button></p>
                    <p v-if="notice" class="sp-notice" role="status">{{ notice }}</p>
                    <label v-if="linkFallback" class="sp-field"><span>Ссылка на эфир — скопируйте вручную</span><input :value="linkFallback" readonly @focus="$event.target.select()" /></label>
                    <div v-if="!myStreamsError && !visibleMyStreams.length" class="sp-muted">{{ myVisibility === 'all' ? 'Пока нет созданных трансляций.' : 'Нет трансляций с выбранной доступностью.' }}</div>
                    <ul v-if="visibleMyStreams.length" class="sp-list">
                        <li v-for="s in visibleMyStreams" :key="s.id" class="sp-item">
                            <div class="sp-item-main">
                                <div class="sp-item-title">{{ s.title }}</div>
                                <div class="sp-item-meta">
                                    <span class="sp-badge" :class="'sp-badge-' + s.status">{{ statusLabel(s.status) }}</span>
                                    <span v-if="s.visibility === 'unlisted'" class="sp-badge">Скрытый эфир</span>
                                    <span v-if="s.hidden" class="sp-badge sp-badge-hidden">Скрыт</span>
                                    <span>{{ priceLabel(s) }}</span>
                                    <button v-if="Number(s.price) > 0 && s.backing_course_id" type="button" class="sp-buyers-toggle" @click="toggleBuyers(s)">
                                        👥 Купившие {{ expandedBuyers[s.id] ? '▲' : '▼' }}
                                    </button>
                                </div>
                            </div>
                            <div class="sp-item-actions">
                                <template v-if="confirmDeleteId === s.id">
                                    <span class="sp-confirm-text">Удалить эфир? Если есть купившие — он будет скрыт (они сохранят доступ), иначе удалён полностью.</span>
                                    <button class="sp-btn sp-btn-mini sp-btn-danger" :disabled="busyId === s.id" @click="removeStream(s)">
                                        {{ busyId === s.id ? 'Удаляем…' : 'Да, удалить' }}
                                    </button>
                                    <button class="sp-btn sp-btn-mini" :disabled="busyId === s.id" @click="confirmDeleteId = null">Отмена</button>
                                </template>
                                <template v-else>
                                    <button type="button" class="sp-btn sp-btn-mini" @click="openStream(s.id)">Открыть эфир</button>
                                    <button type="button" class="sp-btn sp-btn-mini" @click="copyStreamLink(s)">Копировать ссылку</button>
                                    <!-- завершён: запись + редактирование + удаление (без «Я в эфире»/«Данные OBS»/«Завершить») -->
                                    <template v-if="s.status === 'ended'">
                                        <button class="sp-btn sp-btn-mini" @click="openManage(s)">✏️ Редактировать</button>
                                        <button v-if="!s.hidden" class="sp-btn sp-btn-mini sp-btn-danger" :disabled="busyId === s.id" @click="confirmDeleteId = s.id">Удалить</button>
                                    </template>
                                    <!-- live / запланирован: как было; «Данные OBS» только при наличии peertube_video_id (не мультихост) -->
                                    <template v-else>
                                        <button v-if="s.status !== 'live'" class="sp-btn sp-btn-mini" :disabled="busyId === s.id" @click="goLive(s)">Я в эфире</button>
                                        <button v-else class="sp-btn sp-btn-mini" :disabled="busyId === s.id" @click="endLive(s)">Завершить</button>
                                        <button class="sp-btn sp-btn-mini" @click="openManage(s)">✏️ Редактировать</button>
                                        <button v-if="s.peertube_video_id" class="sp-btn sp-btn-mini" :disabled="busyId === s.id" @click="showCreds(s)">Данные OBS</button>
                                        <button v-if="!s.hidden" class="sp-btn sp-btn-mini sp-btn-danger" :disabled="busyId === s.id" @click="confirmDeleteId = s.id">Удалить</button>
                                    </template>
                                </template>
                            </div>
                            <!-- Данные OBS — раскрывается внутри карточки этого эфира, под рядом кнопок -->
                            <div v-if="creds && creds.id === s.id" class="sp-card sp-creds sp-item-creds">
                                <div class="sp-card-head">
                                    <h2>Данные для OBS</h2>
                                    <button class="sp-close" @click="creds = null" aria-label="Закрыть">✕</button>
                                </div>
                                <p class="sp-muted">«{{ creds.title }}». Вставьте в OBS → Настройки → Трансляция → «Особый…»:</p>
                                <div class="sp-cred-row">
                                    <span class="sp-cred-label">Сервер (URL)</span>
                                    <code class="sp-cred-val">{{ creds.rtmpUrl }}</code>
                                    <button class="sp-btn sp-btn-mini" @click="copy(creds.rtmpUrl)">Копировать</button>
                                </div>
                                <div class="sp-cred-row">
                                    <span class="sp-cred-label">Ключ потока</span>
                                    <code class="sp-cred-val">{{ maskKey ? '••••••••••••' : creds.streamKey }}</code>
                                    <button class="sp-btn sp-btn-mini" @click="maskKey = !maskKey">{{ maskKey ? 'Показать' : 'Скрыть' }}</button>
                                    <button class="sp-btn sp-btn-mini" @click="copy(creds.streamKey)">Копировать</button>
                                </div>
                                <p class="sp-note">Никому не передавайте ключ потока — по нему можно вести эфир от вашего имени.</p>
                            </div>
                            <div v-if="expandedBuyers[s.id]" class="sp-buyers">
                                <form class="sp-buyer-grant" @submit.prevent="grantBuyer(s)">
                                    <label :for="'stream-grant-' + s.id">Предоставить доступ по email</label>
                                    <div class="sp-buyer-grant-row">
                                        <input :id="'stream-grant-' + s.id" v-model="grantEmail[s.id]" type="email" required maxlength="320" autocomplete="email" placeholder="Email зарегистрированного пользователя" :disabled="grantBusy[s.id]" />
                                        <button class="sp-btn sp-btn-mini" type="submit" :disabled="grantBusy[s.id]">{{ grantBusy[s.id] ? 'Добавление…' : 'Добавить без оплаты' }}</button>
                                    </div>
                                    <p v-if="grantError[s.id]" class="sp-note-err" role="alert">{{ grantError[s.id] }}</p>
                                    <p v-if="grantSuccess[s.id]" class="sp-muted" role="status">{{ grantSuccess[s.id] }}</p>
                                </form>
                                <div v-if="buyersLoading[s.id]" class="sp-muted">Загрузка…</div>
                                <div v-else-if="buyersError[s.id]" class="sp-note-err">{{ buyersError[s.id] }}</div>
                                <div v-else-if="!(buyers[s.id] || []).length" class="sp-muted">Пока никто не купил этот эфир.</div>
                                <ul v-else class="sp-buyers-list">
                                    <li v-for="b in buyers[s.id]" :key="b.id" class="sp-buyers-item">
                                        <span class="sp-buyers-name">{{ b.user?.Name || 'Без имени' }}<span v-if="b.addedWithoutPayment" class="sp-buyer-manual">Добавлен без оплаты</span></span>
                                        <span class="sp-buyers-email">{{ b.user?.email || '—' }}</span>
                                    </li>
                                </ul>
                                <div v-if="(buyers[s.id] || []).length" class="sp-buyers-total">Всего купивших: {{ buyers[s.id].length }}</div>
                            </div>
                        </li>
                    </ul>
                </section>

                <!-- All streams (catalog style, like /all_course) -->
                <section class="sp-catalog">
                    <h2 class="pd-h2">Все эфиры</h2>
                    <div v-if="!listItems.length" class="pd-state">Пока нет эфиров.</div>
                    <div v-else class="pd-cards pd-cards--courses">
                        <button v-for="s in listItems" :key="s.id" class="pd-course" type="button" @click="openStream(s.id)">
                            <span class="pd-course__cover">
                                <img v-if="s.cover_url || s.thumb" :src="s.cover_url || s.thumb" :alt="s.title" loading="lazy" />
                                <span v-else class="pd-course__cover--ph" aria-hidden="true">📡</span>
                                <span class="pd-course__badge" :class="'sp-badge-' + s.status">{{ statusLabel(s.status) }}</span>
                            </span>
                            <h3 class="pd-course__t">{{ s.title }}</h3>
                            <div v-if="s.status === 'scheduled' && s.scheduled_at" class="pd-course__when">🕐 {{ formatDateTime(s.scheduled_at) }}</div>
                            <div class="pd-course__foot">
                                <span v-if="s.authorUser" class="pd-course__auth">
                                    <img v-if="s.authorUser.Photo" class="pd-course__ava" :src="s.authorUser.Photo" :alt="s.authorUser.Name" />
                                    <span v-else class="pd-course__ava pd-course__ava--i">{{ (s.authorUser.Name || '?').slice(0, 1) }}</span>
                                    <span class="pd-course__author">{{ s.authorUser.Name }}</span>
                                </span>
                                <span v-else></span>
                                <span class="pd-course__price" :class="{ 'is-free': !(Number(s.price) > 0) }">{{ priceLabel(s) }}</span>
                            </div>
                        </button>
                    </div>
                </section>

            </template>
        </template>
        <!-- Guest clicked "Купить" → login prompt popup -->
        <div v-if="showAuthModal" class="sp-authmodal" @click.self="showAuthModal = false">
            <div class="sp-authmodal-card" role="dialog" aria-modal="true">
                <button class="sp-authmodal-x" type="button" aria-label="Закрыть" @click="showAuthModal = false">✕</button>
                <div class="sp-authmodal-title">Войдите, чтобы получить доступ к эфиру</div>
                <p class="sp-authmodal-text">Чтобы купить эфир и смотреть трансляцию, войдите в аккаунт или зарегистрируйтесь.</p>
                <a class="sp-btn sp-btn-primary sp-authmodal-btn" href="/login">Войти</a>
                <a class="sp-authmodal-reg" href="/registration">Ещё нет аккаунта? Зарегистрируйтесь</a>
            </div>
        </div>

        <!-- Manage / edit stream popup (course-editor style) -->
        <div v-if="manageStream" class="pd-modal" @click.self="closeManage">
            <div class="pd-dialog" role="dialog" aria-modal="true">
                <div class="pd-dialog__head">
                    <h2 class="pd-dialog__title">Редактирование эфира</h2>
                    <button type="button" class="pd-x" aria-label="Закрыть" @click="closeManage">✕</button>
                </div>
                <div class="pd-dialog__body">
                    <label class="pd-field">
                        <span class="pd-field__lb">Название</span>
                        <input v-model.trim="editForm.title" class="pd-input" type="text" minlength="3" maxlength="120" />
                    </label>
                    <label class="pd-field">
                        <span class="pd-field__lb">Описание</span>
                        <textarea v-model.trim="editForm.description" class="pd-input" rows="3" maxlength="2000"></textarea>
                    </label>
                    <div class="pd-field">
                        <span class="pd-field__lb">Обложка</span>
                        <div v-if="editForm.cover_url" class="sp-cover">
                            <img :src="editForm.cover_url" alt="Обложка эфира" class="sp-cover-img" />
                            <div class="sp-cover-ctl">
                                <label class="sp-btn sp-btn-mini" :class="{ 'is-disabled': editCoverBusy }">
                                    {{ editCoverBusy ? 'Загрузка…' : 'Заменить' }}
                                    <input type="file" accept="image/*" class="sp-hidden-file" :disabled="editCoverBusy" @change="onEditCover" />
                                </label>
                                <button type="button" class="sp-btn sp-btn-mini sp-btn-ghost" :disabled="editCoverBusy" @click="removeEditCover">Удалить</button>
                            </div>
                        </div>
                        <label v-else class="sp-upload" :class="{ 'is-disabled': editCoverBusy }">
                            {{ editCoverBusy ? 'Загрузка…' : '＋ Загрузить обложку' }}
                            <input type="file" accept="image/*" class="sp-hidden-file" :disabled="editCoverBusy" @change="onEditCover" />
                        </label>
                        <p v-if="editCoverError" class="sp-note sp-note-err">{{ editCoverError }}</p>
                    </div>
                    <label class="pd-field">
                        <span class="pd-field__lb">Дата и время эфира <span class="sp-optional">(необязательно)</span></span>
                        <input v-model="editForm.scheduledAt" class="pd-input" type="datetime-local" />
                    </label>
                    <StreamQualityField :full-hd-enabled="editFullHdAllowed" :checking="editQualityChecking" id="stream-edit-quality" v-model="editForm.video_quality" :live="manageStream.status === 'live'" :solo="manageStream.mode !== 'multi'" />
                    <p v-if="editError" class="sp-note sp-note-err">{{ editError }}</p>
                </div>
                <div class="pd-dialog__foot">
                    <button class="pd-btn pd-btn--ghost" type="button" @click="closeManage">Закрыть</button>
                    <span class="pd-foot-spacer"></span>
                    <button class="pd-btn" type="button" :disabled="editBusy || editQualityChecking" @click="saveEdit">{{ editBusy ? 'Сохранение…' : 'Сохранить' }}</button>
                </div>
            </div>
        </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { validateVisibility, isPublicStream, streamLinkKey, streamShareUrl, visibilityCapabilities, requireUnlistedSupport } from '@/_front/streams/visibility.js';
import { createLive, getLiveCredentials, getVideoInfo, embedUrl, assetUrl, VIDEO_STATE } from '@/_front/streams/peertubeLive.js';
import {
    canStream,
    createStream,
    getStreamLinkKey,
    createBackingCourse,
    purchaseStream,
    hasBoughtStream,
    accessExpiry,
    listMyStreams,
    listStreamBuyers,
    grantStreamAccessByEmail,
    updateStream,
    listAllStreams,
    getStreamById,
    setStreamStatus,
    deleteStream,
    listStreamMessages,
    sendStreamMessage,
    deleteStreamMessage,
} from '@/_front/streams/streamsApi.js';
// Multi-host (co-host) live: orchestrator client + roster reads. Solo path is untouched.
import { startLive, stopLive, inviteCohost, removeCohost, LiveApiError } from '@/_front/streams/liveApi.js';
import { listCohosts, getMyCohostRole } from '@/_front/streams/cohosts.js';
// Fast auth: resolve the uid from the stored session/cookie synchronously (no stall-prone
// auth.getSession()), and wait out the session-restore race without flashing "no access".
import { readStoredSession, authCookieUser, waitForUid } from '@/_front/chrome/headerAccount.js';
import StreamQualityField from '@/_front/components/StreamQualityField.vue';
import StreamViewer from '@/_front/components/StreamViewer.vue';
import StreamDiagnostics from '@/_front/components/StreamDiagnostics.vue';
import { videoProfile } from '@/_front/streams/videoQuality.js';
import { fullHdAvailable } from '@/_front/streams/streamQualityAccess.js';
import PushToggle from '@/_front/components/PushToggle.vue';
import { logClientEvent } from '@/_front/chrome/errorLogger.js';

const route = useRoute();
const router = useRouter();

const loading = ref(true);
const me = ref(null);
const listItems = ref([]);
const myStreams = ref([]);
const myStreamsError = ref('');
const myVisibility = ref('all');
const createdStream = ref(null);
const myVisibilityFilters = [{ value: 'all', label: 'Все' }, { value: 'public', label: 'Публичные' }, { value: 'unlisted', label: 'Скрытые' }];
// The server already scopes this query to the owner. Keep the UI scoped as well.
const visibleMyStreams = computed(() => myStreams.value.filter(s => s.author === me.value?.id && (myVisibility.value === 'all' || (s.visibility || 'public') === myVisibility.value)));

// create-form state
const showForm = ref(false);
const creating = ref(false);
const busyId = ref(null);
const confirmDeleteId = ref(null);
const showAuthModal = ref(false);   // guest clicked "Купить" → login prompt popup
// buyers roster (author view, per stream, lazy)
const expandedBuyers = ref({});
const buyers = ref({});
const buyersLoading = ref({});
const buyersError = ref({});
const grantEmail = ref({});
const grantBusy = ref({});
const grantError = ref({});
const grantSuccess = ref({});
// manage/edit modal (per stream)
const manageStream = ref(null);
const editForm = ref({ title: '', description: '', cover_url: '', scheduledAt: '', video_quality: 'hd' });
const editBusy = ref(false);
const editError = ref('');
const editCoverBusy = ref(false);
const editCoverError = ref('');
const notice = ref('');
const error = ref('');
const creds = ref(null);
const maskKey = ref(false);
const form = ref({ title: '', description: '', scheduledAt: '', kind: 'free', visibility: 'public', video_quality: 'hd', price: null, months: 3, format: 'solo', chat: false, recording: false, cover_url: '' });
const shareMsg = ref('');
const linkFallback = ref('');
const unlistedEnabled = ref(false);
const fullHdEnabled = ref(false);
const editFullHdAllowed = ref(false);
const editQualityChecking = ref(false);
let editQualityGeneration = 0;
// cover upload (same bucket/pattern as course/profile covers)
const COVER_BUCKET = 'profile';
const COVER_STORAGE_URL = 'https://sb.meetgu.ru/storage/v1/object/public/profile//';
const coverBusy = ref(false);
const coverError = ref('');

const canSubmit = computed(() => {
    // PeerTube requires a 3–120 char video title; the live is created from this name.
    const len = (form.value.title || '').trim().length;
    if (len < 3 || len > 120) return false;
    if (!['public', 'unlisted'].includes(form.value.visibility)) return false;
    if (form.value.visibility === 'unlisted' && (!unlistedEnabled.value || form.value.kind === 'paid')) return false;
    if (form.value.kind === 'paid') return Number(form.value.price) > 0;
    return true;
});

// detail state
const detail = ref(null);
const detailInfo = ref(null);
const detailLoading = ref(false);
const bought = ref(false);
const boughtResolved = ref(false); // true once the paid-access (hasBoughtStream) check has completed
const myId = ref(null);            // fast uid from the stored session/cookie (no getSession stall)
const meResolved = ref(false);     // true once auth is determined (session restored or confirmed guest)
const buying = ref(false);
const streamPromo = ref('');
let pollTimer = null;

// multi-host (co-host) detail state — only used when detail.mode === 'multi'
const myCohostRole = ref(null); // current non-author user's membership, or null
const liveBusy = ref(false);
const cohosts = ref([]);
const inviteEmail = ref('');
const inviting = ref(false);
const confirmRemoveId = ref(null); // inline "точно?" confirm per cohost row
const removingId = ref(null);

// viewer-chat state
const messages = ref([]);
const chatText = ref('');
const chatLoading = ref(false);
const sending = ref(false);
const feedEl = ref(null);
let chatTimer = null;

const isStreamer = computed(() => canStream(me.value));
const activeStreamId = computed(() => route.query.stream || null);

function supa() {
    const inst = window.wwLib?.wwPlugins?.supabase?.instance;
    if (!inst) throw new Error('Supabase недоступен на этой странице.');
    return inst;
}

// Resolve the logged-in user WITHOUT the stall-prone auth.getSession(): read the uid from the stored
// session / cookie synchronously, and poll briefly while the auth plugin restores it (guest → null).
// Then fetch the user row for name/photo. Memoized so the list + detail share one resolution and the
// chat feed never waits on it. Sets meResolved when done so the UI can skip "no access" flashes.
let mePromise = null;
function ensureMe() {
    if (mePromise) return mePromise;
    mePromise = (async () => {
        let uid = null;
        try {
            uid = readStoredSession()?.user?.id || authCookieUser()?.id || null;
            if (!uid) uid = await waitForUid(2500, 150); // wait out the session-restore race
        } catch (_) { uid = null; }
        // Resolve access as soon as we know the uid — the users row (name/photo) is NOT required for
        // it, so don't make the gate wait on an extra request. meResolved is set here unconditionally
        // (even if the uid lookup threw) so a paid stream can never get stuck on «Загрузка…».
        myId.value = uid || null;
        meResolved.value = true;
        if (uid) {
            try {
                const { data } = await supa().from('users').select('*').eq('id', uid).limit(1);
                me.value = data?.[0] || null;
            } catch (_) { me.value = null; /* access still works via myId */ }
        } else {
            me.value = null;
        }
        return me.value;
    })();
    return mePromise;
}

// ---------- labels ----------
function statusLabel(s) {
    return s === 'live' ? 'В эфире' : s === 'ended' ? 'Завершён' : 'Запланирован';
}
function priceLabel(s) {
    return Number(s.price) > 0 ? `${Number(s.price).toLocaleString('ru-RU')} ₽` : 'бесплатно';
}
function authorName(s) {
    return s.authorUser?.Name || 'Автор';
}
function formatDateTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}
async function shareStream() {
    if (!detail.value) return;
    let url;
    try { url = await shareUrl(detail.value); } catch (e) { error.value = e.message; return; }
    if (navigator.share) {
        try {
            await navigator.share({ title: detail.value.title, url });
            return;
        } catch (_) {
            return; // user cancelled the native share sheet
        }
    }
    try {
        await navigator.clipboard.writeText(url);
        shareMsg.value = 'Ссылка скопирована';
    } catch (_) {
        linkFallback.value = url;
        shareMsg.value = 'Скопируйте ссылку ниже';
    }
    setTimeout(() => (shareMsg.value = ''), 2500);
}

async function shareUrl(stream) {
    const key = stream.visibility === 'unlisted'
        ? (stream.id === activeStreamId.value && streamLinkKey(route.hash)) || await getStreamLinkKey(supa(), stream.id)
        : null;
    return streamShareUrl(window.location.origin, stream, key);
}
async function copyStreamLink(stream) {
    linkFallback.value = '';
    notice.value = '';
    try {
        const url = await shareUrl(stream);
        try { await navigator.clipboard.writeText(url); notice.value = 'Ссылка скопирована'; }
        catch (_) { linkFallback.value = url; notice.value = 'Скопируйте ссылку вручную'; }
    } catch (e) { error.value = e.message; }
}

// ---------- navigation ----------
function goHome() {
    window.location.href = '/';
}
function openStream(id) {
    router.push({ path: '/streams', query: { stream: id } });
}
function backToList() {
    router.push({ path: '/streams' });
}
async function copy(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (_) {
        /* clipboard may be blocked */
    }
}

// ---------- list ----------
async function load() {
    loading.value = true;
    error.value = '';
    myStreamsError.value = '';
    myStreams.value = [];
    try {
        await ensureMe();
        // A catalog failure must not hide the organizer's own streams (and vice versa).
        const [catalog, own] = await Promise.allSettled([
            listAllStreams(supa()),
            me.value ? listMyStreams(supa(), me.value.id) : Promise.resolve([]),
        ]);
        listItems.value = catalog.status === 'fulfilled' ? catalog.value : [];
        if (catalog.status === 'rejected') error.value = catalog.reason?.message || 'Не удалось загрузить общий список.';
        loadThumbs();
        if (own.status === 'fulfilled') myStreams.value = own.value;
        else myStreamsError.value = own.reason?.message || 'Не удалось загрузить ваши трансляции.';
    } catch (e) {
        error.value = e.message || String(e);
    } finally {
        loading.value = false;
    }
}

// Lazily attach PeerTube thumbnails to list tiles (best-effort, non-blocking).
function loadThumbs() {
    for (const s of listItems.value) {
        if (!s.peertube_video_id) continue;
        getVideoInfo(s.peertube_video_id).then(info => {
            if (info?.previewPath || info?.thumbnailPath) {
                s.thumb = assetUrl(info.previewPath || info.thumbnailPath);
            }
        });
    }
}

// ---------- detail ----------
const isAuthor = computed(() => {
    const uid = me.value?.id || myId.value;
    return !!detail.value && (detail.value.is_author === true || (!!uid && uid === detail.value.author));
});
const isPaid = computed(() => !!detail.value && Number(detail.value.price) > 0 && !!detail.value.backing_course_id);
// Access window measured from the air date (accessExpiry); open if no expiry or not yet passed.
const accessWindowOpen = computed(() => {
    const exp = detail.value ? accessExpiry(detail.value) : null;
    return !exp || Date.now() <= exp.getTime();
});
const hasAccess = computed(() => !!detail.value && (!isPaid.value || isAuthor.value || (bought.value && accessWindowOpen.value)));
const canBuy = computed(() => isPaid.value && !isAuthor.value && !bought.value && accessWindowOpen.value);
// Have we finished determining access for this stream? Until then the player/chat show a neutral
// placeholder instead of flashing "buy"/"no access" while the session is still being restored.
const accessResolved = computed(() => {
    if (!detail.value || !meResolved.value) return false;
    if (!isPaid.value || isAuthor.value) return true;
    return boughtResolved.value; // a buyer's access depends on the async purchase check
});

// Hybrid state: PeerTube video.state is authoritative for "waiting"; the author's cached
// streams.status carries the live/ended intent.
const displayState = computed(() => {
    const row = detail.value;
    if (!row) return 'scheduled';
    const st = detailInfo.value?.stateId;
    if (st === VIDEO_STATE.WAITING_FOR_LIVE) return 'scheduled';
    if (row.status === 'live' || (st === VIDEO_STATE.PUBLISHED && detailInfo.value?.hasPlaylist && row.status !== 'ended')) return 'live';
    if (row.status === 'ended' || st === VIDEO_STATE.LIVE_ENDED) return 'ended';
    return 'scheduled';
});
const displayLabel = computed(() => statusLabel(displayState.value));
// A replay (or live) is actually watchable once PeerTube has a streaming playlist / PUBLISHED video.
const playable = computed(
    () => !!detailInfo.value && (detailInfo.value.hasPlaylist || detailInfo.value.stateId === VIDEO_STATE.PUBLISHED)
);
// Ended, but the replay is still transcoding (takes a few minutes after the live ends). We show a
// "processing" placeholder instead of PeerTube's "live ended" embed, and keep polling until ready.
const replayProcessing = computed(() => displayState.value === 'ended' && !playable.value);
const playerSrc = computed(() =>
    detail.value?.peertube_video_id
        ? embedUrl(detail.value.peertube_video_id, { autoplay: displayState.value === 'live' })
        : ''
);
// Current live viewers (from PeerTube's public `viewers`), refreshed by the poll while live.
const viewers = computed(() => detailInfo.value?.viewers ?? null);
// Russian verb agreement: "1 смотрит", "2 смотрят", "21 смотрит" …
function viewerWord(n) {
    return (n % 10 === 1 && n % 100 !== 11) ? 'смотрит' : 'смотрят';
}
// Poll PeerTube while the live is waiting, on air (to refresh viewers + catch the end), or its
// replay is still transcoding.
function shouldPoll() {
    return displayState.value === 'scheduled' || displayState.value === 'live' || replayProcessing.value;
}

async function loadDetail(id) {
    detailLoading.value = true;
    detail.value = null;
    detailInfo.value = null;
    bought.value = false;
    boughtResolved.value = false;
    myCohostRole.value = null;
    cohosts.value = [];
    error.value = '';
    stopPoll();
    stopChatPoll();
    try {
        detail.value = await getStreamById(supa(), id, streamLinkKey(route.hash));
        if (!detail.value) return; // "Эфир не найден" is rendered by the empty-detail branch

        // 1) Chat feed FIRST — independent of auth + video metadata, so messages arrive in ~40ms.
        //    Visibility is still gated by hasAccess in the template; here we only populate the data.
        chatLoading.value = true;
        loadChat(id, { scroll: true }).finally(() => { chatLoading.value = false; });
        startChatPoll(id);

        // 2) Auth (fast uid, no getSession stall) → access + the paid-purchase check, in the
        //    background. Resolving it off the critical path is what keeps the feed instant.
        ensureMe().then(async () => {
            try {
                if (detail.value && Number(detail.value.price) > 0 && detail.value.backing_course_id && myId.value) {
                    bought.value = await hasBoughtStream(supa(), detail.value, myId.value);
                }
            } catch (_) { /* access stays false */ }
            boughtResolved.value = true;
        }).catch(() => { boughtResolved.value = true; }); // never leave access stuck on «Загрузка…»

        // 3) PeerTube metadata — independent of auth; drives the player state + viewer polling.
        if (detail.value.peertube_video_id) {
            detailInfo.value = await getVideoInfo(detail.value.peertube_video_id);
        }

        // Multi-host: owner loads the roster; a non-author loads their own membership (join CTA).
        if (detail.value.mode === 'multi') {
            await ensureMe();
            if (isAuthor.value) {
                cohosts.value = await listCohosts(supa(), detail.value.id).catch(() => []);
            } else if (myId.value) {
                myCohostRole.value = await getMyCohostRole(supa(), detail.value.id, myId.value).catch(() => null);
            }
        }

        // Poll while waiting for the live to start (state 4 → 1) OR for a just-ended live's replay
        // to finish transcoding (ended but not yet playable).
        if (shouldPoll() && detail.value.peertube_video_id) startPoll();
    } catch (e) {
        error.value = e.message || String(e);
        boughtResolved.value = true;
    } finally {
        detailLoading.value = false;
    }
}

// ---------- multi-host (co-host) actions ----------
function enterCall() {
    if (detail.value) router.push(`/streams/call?stream=${detail.value.id}`);
}

async function startMulti() {
    if (liveBusy.value || !detail.value) return;
    liveBusy.value = true;
    try {
        await startLive(supa(), detail.value.id);
        await loadDetail(detail.value.id); // refresh status/ids
        enterCall();
    } catch (e) {
        if (e instanceof LiveApiError && e.code === 'already_live') enterCall();
        else error.value = e.message || 'Не удалось начать эфир.';
    } finally {
        liveBusy.value = false;
    }
}

async function endMulti() {
    if (liveBusy.value || !detail.value) return;
    liveBusy.value = true;
    try {
        await stopLive(supa(), detail.value.id);
        await loadDetail(detail.value.id);
    } catch (e) {
        error.value = e.message || 'Не удалось завершить эфир.';
    } finally {
        liveBusy.value = false;
    }
}

async function inviteCohostWeb() {
    const email = inviteEmail.value.trim();
    if (!email || !email.includes('@') || !detail.value) return;
    inviting.value = true;
    try {
        await inviteCohost(supa(), detail.value.id, email);
        inviteEmail.value = '';
        cohosts.value = await listCohosts(supa(), detail.value.id).catch(() => cohosts.value);
    } catch (e) {
        window.alert(
            e instanceof LiveApiError && e.code === 'user_not_found'
                ? 'Пользователь с таким e-mail не зарегистрирован.'
                : e.message || 'Не удалось пригласить.',
        );
    } finally {
        inviting.value = false;
    }
}

async function removeCohostWeb(c) {
    if (!detail.value) return;
    removingId.value = c.id;
    try {
        await removeCohost(supa(), detail.value.id, c.user);
        confirmRemoveId.value = null;
        cohosts.value = await listCohosts(supa(), detail.value.id).catch(() => cohosts.value);
    } catch (e) {
        window.alert(e.message || 'Не удалось удалить.');
    } finally {
        removingId.value = null;
    }
}

function cohostName(c) {
    return (c.userInfo && (c.userInfo.Name || c.userInfo.email)) || 'Участник';
}
function cohostStatusLabel(c) {
    if (c.role === 'owner') return 'Владелец';
    return c.status === 'joined' ? 'В эфире' : 'Приглашён';
}

async function buyStream() {
    if (buying.value || !detail.value) return;
    // Guest → login prompt popup (matches the /course buy flow) instead of a tiny inline error.
    if (!me.value) { showAuthModal.value = true; return; }
    buying.value = true;
    error.value = '';
    try {
        const payLink = await purchaseStream(supa(), { buyer: me.value.id, stream: detail.value, promoCode: streamPromo.value.trim() || null });
        window.location.href = payLink; // same-origin edge fn returned the link → go to Prodamus
    } catch (e) {
        error.value = e.message || 'Не удалось перейти к оплате. Попробуйте ещё раз.';
        // Record the failure (UA + user_id added by the logger) so "не открывается оплата" leaves data.
        try { logClientEvent('payment_link_error', `stream=${detail.value?.id} ${e.message || e}`); } catch (_) { /* logging must not break */ }
        buying.value = false;
    }
}

// buyers roster (author view) — who paid for this stream (user_course on the backing course)
async function toggleBuyers(s) {
    const open = !expandedBuyers.value[s.id];
    expandedBuyers.value = { ...expandedBuyers.value, [s.id]: open };
    if (open) await loadBuyers(s);
}
async function grantBuyer(s) {
    if (grantBusy.value[s.id]) return;
    grantBusy.value = { ...grantBusy.value, [s.id]: true };
    grantError.value = { ...grantError.value, [s.id]: '' };
    grantSuccess.value = { ...grantSuccess.value, [s.id]: '' };
    try {
        const result = await grantStreamAccessByEmail(supa(), s.id, grantEmail.value[s.id]);
        grantEmail.value = { ...grantEmail.value, [s.id]: '' };
        grantSuccess.value = { ...grantSuccess.value, [s.id]: result.status === 'already_has_access' ? 'У пользователя уже есть доступ к эфиру.' : 'Доступ предоставлен без оплаты.' };
        await loadBuyers(s);
    } catch (e) {
        grantError.value = { ...grantError.value, [s.id]: e.message || 'Не удалось предоставить доступ.' };
    } finally {
        grantBusy.value = { ...grantBusy.value, [s.id]: false };
    }
}

async function loadBuyers(s) {
    buyersLoading.value = { ...buyersLoading.value, [s.id]: true };
    buyersError.value = { ...buyersError.value, [s.id]: '' };
    try {
        buyers.value = { ...buyers.value, [s.id]: await listStreamBuyers(supa(), s) };
    } catch (e) {
        buyersError.value = { ...buyersError.value, [s.id]: 'Не удалось загрузить список.' };
    } finally {
        buyersLoading.value = { ...buyersLoading.value, [s.id]: false };
    }
}

function startPoll() {
    stopPoll();
    let attempts = 0;
    const maxAttempts = Math.ceil((6 * 3600000) / 20000); // ~6h backstop (covers a long live)
    pollTimer = setInterval(async () => {
        if (!detail.value?.peertube_video_id) return stopPoll();
        detailInfo.value = await getVideoInfo(detail.value.peertube_video_id);
        // re-fetch the author's cached status too (they may have pressed "я в эфире" / ended it)
        const fresh = await getStreamById(supa(), detail.value.id, streamLinkKey(route.hash));
        if (fresh) detail.value = fresh;
        attempts += 1;
        // Keep polling while waiting / live (viewer count) / replay transcoding; stop otherwise.
        if (!shouldPoll() || attempts >= maxAttempts) stopPoll();
    }, 20000);
}
function stopPoll() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

// ---------- viewer chat ----------
function msgTime(iso) {
    return iso ? new Date(iso).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
}
function canDeleteMsg(m) {
    return !!me.value && (m.can_delete === true || m.owner === me.value.id || isAuthor.value);
}
function scrollFeed() {
    nextTick(() => {
        const el = feedEl.value;
        if (el) el.scrollTop = el.scrollHeight;
    });
}
async function loadChat(id, { scroll = false } = {}) {
    try {
        const prevLen = messages.value.length;
        const rows = await listStreamMessages(supa(), id, { linkKey: detail.value?.visibility === 'unlisted' ? streamLinkKey(route.hash) : null });
        // Guard against in-flight races: while this request was out, access may have resolved to
        // "no access" (the privacy watch cleared the feed) or the viewer may have switched streams.
        // In either case don't write the (stale/denied) messages back into the UI.
        if (detail.value?.id !== id) return;
        if (accessResolved.value && !hasAccess.value) return;
        messages.value = rows;
        if (scroll || messages.value.length !== prevLen) scrollFeed();
    } catch (_) {
        // keep the current messages on a transient refresh failure
    }
}
async function sendChat() {
    const text = chatText.value.trim();
    if (!text || sending.value || !detail.value || !me.value) return;
    sending.value = true;
    try {
        await sendStreamMessage(supa(), { stream: detail.value.id, owner: me.value.id, text, linkKey: detail.value.visibility === 'unlisted' ? streamLinkKey(route.hash) : null });
        chatText.value = '';
        await loadChat(detail.value.id, { scroll: true });
    } catch (e) {
        error.value = e.message || String(e);
    } finally {
        sending.value = false;
    }
}
async function removeMessage(m) {
    try {
        await deleteStreamMessage(supa(), m.id, { streamId: detail.value?.id, linkKey: detail.value?.visibility === 'unlisted' ? streamLinkKey(route.hash) : null });
        messages.value = messages.value.filter(x => x.id !== m.id);
    } catch (e) {
        error.value = e.message || String(e);
    }
}
function startChatPoll(id) {
    stopChatPoll();
    chatTimer = setInterval(() => loadChat(id), 7000);
}
function stopChatPoll() {
    if (chatTimer) {
        clearInterval(chatTimer);
        chatTimer = null;
    }
    messages.value = [];
    chatText.value = '';
}

// React to ?stream= changes (list ↔ detail without a full reload).
watch(
    () => [activeStreamId.value, route.hash],
    ([id]) => {
        linkFallback.value = '';
        if (id) loadDetail(id);
        else {
            detail.value = null;
            stopPoll();
            stopChatPoll();
        }
    },
    { immediate: false }
);

// If a live ends while the viewer is watching, start polling so the replay appears automatically
// once it finishes transcoding (the load-time start only covers already-ended streams).
watch(replayProcessing, processing => {
    if (processing && !pollTimer && detail.value?.peertube_video_id) startPoll();
});

// Privacy guard: the feed is loaded optimistically (before access is known) so it appears instantly
// for entitled viewers. If access then resolves to "no access", drop the loaded messages from memory
// and stop polling — a no-access viewer must not retain paid-stream chat client-side (it's never
// rendered either way, but we don't keep or keep fetching it once we know they lack access).
watch([hasAccess, accessResolved], ([access, resolved]) => {
    if (resolved && !access) stopChatPoll();
});

// ---------- create / author actions ----------
function cancelForm() {
    showForm.value = false;
    form.value = { title: '', description: '', scheduledAt: '', kind: 'free', visibility: 'public', video_quality: 'hd', price: null, months: 3, format: 'solo', chat: false, recording: false, cover_url: '' };
    error.value = '';
    coverError.value = '';
}
// shared cover upload (create form + manage/edit modal)
async function uploadCoverFile(file, oldUrl) {
    if (oldUrl) { try { await supa().storage.from(COVER_BUCKET).remove([oldUrl.split('/').pop()]); } catch (_) { /* ignore */ } }
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const key = `${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supa().storage.from(COVER_BUCKET).upload(key, file, { upsert: false });
    if (upErr) throw upErr;
    return COVER_STORAGE_URL + key;
}
async function onCoverUpload(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || coverBusy.value) return;
    coverBusy.value = true; coverError.value = '';
    try { form.value.cover_url = await uploadCoverFile(file, form.value.cover_url); }
    catch (e2) { coverError.value = 'Не удалось загрузить обложку.'; }
    finally { coverBusy.value = false; }
}
function removeCover() {
    if (form.value.cover_url) { try { supa().storage.from(COVER_BUCKET).remove([form.value.cover_url.split('/').pop()]); } catch (_) { /* ignore */ } }
    form.value.cover_url = '';
}

// ---- manage/edit modal (per stream) ----
function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
async function openManage(s) {
    const version = ++editQualityGeneration;
    editFullHdAllowed.value = false; editQualityChecking.value = true;
    manageStream.value = s;
    editForm.value = { title: s.title || '', description: s.description || '', cover_url: s.cover_url || '', scheduledAt: toLocalInput(s.scheduled_at), video_quality: 'hd' };
    editError.value = ''; editCoverError.value = ''; confirmDeleteId.value = null;
    const allowed = s.author === me.value?.id && await fullHdAvailable(supa());
    if (version !== editQualityGeneration || manageStream.value?.id !== s.id) return;
    editFullHdAllowed.value = !!allowed;
    editForm.value.video_quality = allowed ? videoProfile(s.video_quality).id : 'hd';
    editQualityChecking.value = false;
}
function closeManage() { editQualityGeneration++; manageStream.value = null; editQualityChecking.value = false; editFullHdAllowed.value = false; }
async function onEditCover(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || editCoverBusy.value) return;
    editCoverBusy.value = true; editCoverError.value = '';
    try { editForm.value.cover_url = await uploadCoverFile(file, editForm.value.cover_url); }
    catch (e2) { editCoverError.value = 'Не удалось загрузить обложку.'; }
    finally { editCoverBusy.value = false; }
}
function removeEditCover() {
    if (editForm.value.cover_url) { try { supa().storage.from(COVER_BUCKET).remove([editForm.value.cover_url.split('/').pop()]); } catch (_) { /* ignore */ } }
    editForm.value.cover_url = '';
}
async function saveEdit() {
    const s = manageStream.value;
    if (!s || editBusy.value || editQualityChecking.value) return;
    const version = editQualityGeneration;
    const draft = { ...editForm.value };
    const title = (draft.title || '').trim();
    if (title.length < 3) { editError.value = 'Название — минимум 3 символа.'; return; }
    editBusy.value = true; editError.value = '';
    try {
        if (draft.video_quality === 'full_hd' && !(await fullHdAvailable(supa()))) throw new Error('Full HD сейчас отключён. Выберите HD.');
        if (version !== editQualityGeneration || manageStream.value?.id !== s.id) return;
        const patch = {
            title,
            video_quality: videoProfile(draft.video_quality).id,
            description: (draft.description || '').trim(),
            cover_url: draft.cover_url || null,
            scheduled_at: draft.scheduledAt ? new Date(draft.scheduledAt).toISOString() : null,
        };
        await updateStream(supa(), s.id, patch);
        const apply = (row) => { if (row && row.id === s.id) Object.assign(row, patch); };
        myStreams.value.forEach(apply);
        listItems.value.forEach(apply);
        apply(detail.value);
        Object.assign(manageStream.value, patch);
        notice.value = 'Изменения сохранены.';
    } catch (e) { if (version === editQualityGeneration && manageStream.value?.id === s.id) editError.value = e.message || String(e); }
    finally { editBusy.value = false; }
}
async function createBroadcast() {
    if (!canSubmit.value || creating.value) return;
    creating.value = true;
    error.value = '';
    try {
        if (form.value.video_quality === 'full_hd' && !(await fullHdAvailable(supa()))) throw new Error('Full HD сейчас отключён. Выберите HD.');
        const paid = form.value.kind === 'paid';
        validateVisibility({ visibility: form.value.visibility, price: paid ? form.value.price : 0 });
        await requireUnlistedSupport(supa(), form.value.visibility);
        const multi = form.value.format === 'multi';
        const price = paid ? Number(form.value.price) : 0;
        const months = paid ? Number(form.value.months) : null;
        const scheduled_at = form.value.scheduledAt ? new Date(form.value.scheduledAt).toISOString() : null;
        // Multi (co-host): NO PeerTube live / OBS creds here — the orchestrator's /live/start
        // creates the live + composite egress when the owner goes live from the stream page.
        const live = multi
            ? null
            : await createLive(supa(), { name: form.value.title, description: form.value.description, saveReplay: true });
        // Paid → create the hidden backing course first, then link it to the stream.
        const backingId = paid
            ? await createBackingCourse(supa(), { owner: me.value.id, title: form.value.title, price, months })
            : null;
        const row = await createStream(supa(), {
            author: me.value.id,
            visibility: form.value.visibility,
            video_quality: videoProfile(form.value.video_quality).id,
            title: form.value.title,
            description: form.value.description,
            price,
            peertube_video_id: multi ? null : live.video.uuid,
            access_months: months,
            backing_course_id: backingId,
            scheduled_at,
            mode: multi ? 'multi' : 'solo',
            chat_enabled: paid && form.value.chat,   // group chat is opt-in and paid-only (buyers are the members)
            recording_course_enabled: paid && form.value.recording,   // draft recording course, opt-in and paid-only
            cover_url: form.value.cover_url || null,
        });
        const withAuthor = { ...row, authorUser: me.value };
        myStreams.value.unshift(withAuthor);
        createdStream.value = withAuthor;
        myVisibility.value = 'all';
        if (isPublicStream(withAuthor)) listItems.value.unshift(withAuthor);
        if (multi) {
            // No OBS creds for a co-host stream — send the owner to the stream page,
            // where "Начать эфир" + the roster (invite) live.
            cancelForm();
            router.push(`/streams?stream=${row.id}`);
            return;
        }
        creds.value = { id: row.id, title: row.title, rtmpUrl: live.rtmpUrl, streamKey: live.streamKey };
        maskKey.value = false;
        cancelForm();
    } catch (e) {
        error.value = e.message || String(e);
    } finally {
        creating.value = false;
    }
}
async function showCreds(s) {
    if (creds.value && creds.value.id === s.id) { creds.value = null; return; }  // повторное нажатие — свернуть
    busyId.value = s.id;
    error.value = '';
    try {
        const c = await getLiveCredentials(supa(), s.peertube_video_id);
        creds.value = { id: s.id, title: s.title, rtmpUrl: c.rtmpUrl, streamKey: c.streamKey };
        maskKey.value = true;
    } catch (e) {
        error.value = e.message || String(e);
    } finally {
        busyId.value = null;
    }
}
async function goLive(s) {
    busyId.value = s.id;
    try {
        await setStreamStatus(supa(), s.id, 'live');
        s.status = 'live';
    } catch (e) {
        error.value = e.message || String(e);
    } finally {
        busyId.value = null;
    }
}
async function endLive(s) {
    busyId.value = s.id;
    try {
        await setStreamStatus(supa(), s.id, 'ended');
        s.status = 'ended';
    } catch (e) {
        error.value = e.message || String(e);
    } finally {
        busyId.value = null;
    }
}

// Delete is available for FREE streams only for now (paid ones may have buyers).
function isFreeStream(s) {
    return Number(s.price) === 0 && !s.backing_course_id;
}
async function removeStream(s) {
    busyId.value = s.id;
    error.value = '';
    notice.value = '';
    try {
        const action = await deleteStream(supa(), s);
        confirmDeleteId.value = null;
        // Gone from the public list either way.
        listItems.value = listItems.value.filter(x => x.id !== s.id);
        if (action === 'hidden') {
            // Kept (has buyers) — reflect the hidden state in the author's own list.
            const it = myStreams.value.find(x => x.id === s.id);
            if (it) it.hidden = true;
            notice.value = 'Эфир скрыт: у него есть купившие — они сохранят доступ к записи.';
        } else {
            myStreams.value = myStreams.value.filter(x => x.id !== s.id);
        }
    } catch (e) {
        error.value = e.message || String(e);
    } finally {
        busyId.value = null;
    }
}

onMounted(() => {
    fullHdAvailable(supa()).then(enabled => { fullHdEnabled.value = enabled; });
    visibilityCapabilities(supa()).then(c => { unlistedEnabled.value = c.unlisted_enabled === true; }).catch(() => {});
    // Open the detail + chat immediately; don't block them behind the stream-list load.
    if (activeStreamId.value) loadDetail(activeStreamId.value);
    load();
});
onBeforeUnmount(() => {
    stopPoll();
    stopChatPoll();
});
</script>

<style scoped>
.sp-mine-filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 16px; }
.sp-mine-filters button:focus-visible { outline: 2px solid #1f5fc9; outline-offset: 3px; }
.sp-created { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.sp-mine .sp-item-main { min-width: 0; }
.sp-mine .sp-item-title { overflow-wrap: anywhere; }

.sp-visibility { border: 0; padding: 0; margin: 0; min-width: 0; }
.sp-visibility legend { padding: 0; margin-bottom: 8px; }
.streams-page {
    /* #app already reserves 62px for the fixed AppHeader (rendered globally by App.vue). Fill the
       viewport below it so the global footer is pushed to the bottom on short content. */
    min-height: calc(100vh - 62px);
    font-family: inherit;
    color: #1b1f27;
}
.sp-inner {
    /* Match the header container width so content aligns with the logo (left) and the
       Регистрация button (right). Extra top padding nudges the whole block down. */
    max-width: 1200px;
    margin: 0 auto;
    padding: 44px 40px 64px;
}
@media (max-width: 900px) {
    .sp-inner { padding-inline: 22px; } /* align with the header's mobile padding */
}
.sp-back {
    color: #5b6472;
    text-decoration: none;
    font-size: 14px;
}
.sp-back:hover {
    color: #5495f3;
}
.sp-back-block {
    display: inline-block;
    margin-bottom: 16px;
}
.sp-title {
    font-size: 26px;
    font-weight: 600;
    margin: 0 0 20px; /* small gap after "Трансляции" before the content */
}
.sp-card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
}
.sp-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
}
.sp-howto {
    display: inline-block;
    margin-top: 4px;
    color: #5495f3;
    font-weight: 600;
    font-size: 0.85rem;
    text-decoration: none;
}
.sp-howto:hover { text-decoration: underline; }
.sp-card h2 {
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 4px;
}
.sp-muted {
    color: #6b7280;
    font-size: 14px;
}
.sp-note {
    color: #8a93a2;
    font-size: 13px;
    margin: 8px 0 0;
}
.sp-note-err { color: #dc2626; }

/* guest buy → login modal */
.sp-authmodal { position: fixed; inset: 0; z-index: 300; background: rgba(9, 23, 71, 0.45); display: grid; place-items: center; padding: 20px; }
.sp-authmodal-card { position: relative; width: 100%; max-width: 400px; background: #fff; border-radius: 18px; padding: 32px 28px 28px; text-align: center; box-shadow: 0 24px 70px -34px rgba(9, 23, 71, 0.5); }
.sp-authmodal-x { position: absolute; top: 12px; right: 12px; width: 34px; height: 34px; display: grid; place-items: center; border: none; background: none; color: #98a0ad; font-size: 18px; cursor: pointer; border-radius: 8px; }
.sp-authmodal-x:hover { background: #f1f6fd; color: #091747; }
.sp-authmodal-title { font-weight: 800; font-size: 1.2rem; color: #091747; letter-spacing: -0.02em; }
.sp-authmodal-text { margin: 10px 0 22px; color: #5b6472; font-size: 0.95rem; line-height: 1.5; }
.sp-authmodal-btn { display: block; width: 100%; text-align: center; text-decoration: none; }
.sp-authmodal-reg { display: inline-block; margin-top: 16px; color: #1f5fc9; font-size: 0.9rem; font-weight: 600; text-decoration: none; }
.sp-authmodal-reg:hover { text-decoration: underline; }
/* course-editor-style dialog (pd-*), values inlined from CoursesManagePage tokens */
.pd-modal { position: fixed; inset: 0; z-index: 1000; background: rgba(9, 23, 71, 0.42); display: grid; place-items: center; padding: 20px; overflow-y: auto; }
.pd-dialog { position: relative; width: 100%; max-width: 520px; background: #fff; border-radius: 20px; box-shadow: 0 30px 80px -30px rgba(9, 23, 71, 0.5); display: flex; flex-direction: column; max-height: calc(100vh - 40px); }
.pd-dialog__head { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 22px 14px; border-bottom: 1px solid #e4e9f1; }
.pd-dialog__title { margin: 0; font-weight: 800; font-size: 1.15rem; letter-spacing: -0.02em; color: #091747; }
.pd-x { border: 0; background: none; padding: 4px 8px; cursor: pointer; color: #98a0ad; border-radius: 8px; font-size: 16px; line-height: 1; }
.pd-x:hover { background: #f1f6fd; color: #091747; }
.pd-dialog__body { flex: 1 1 auto; min-height: 0; padding: 18px 22px; overflow-y: auto; display: flex; flex-direction: column; gap: 15px; }
.pd-dialog__foot { flex-shrink: 0; display: flex; align-items: center; gap: 10px; padding: 14px 22px 20px; border-top: 1px solid #e4e9f1; }
.pd-foot-spacer { flex: 1; }
.pd-field { display: flex; flex-direction: column; gap: 6px; }
.pd-field__lb { font-size: 0.86rem; font-weight: 600; color: #5b6472; }
.pd-input { width: 100%; border: 1px solid #e4e9f1; border-radius: 12px; background: #fff; padding: 10px 13px; font-family: inherit; font-size: 0.96rem; color: #091747; }
.pd-input:focus { outline: none; border-color: #5495f3; box-shadow: 0 0 0 3px #eaf1fe; }
.pd-input::placeholder { color: #98a0ad; }
textarea.pd-input { resize: vertical; }
.pd-btn { display: inline-flex; align-items: center; gap: 8px; border: none; border-radius: 999px; background: #2e70dd; color: #fff; font-family: inherit; font-weight: 700; font-size: 0.95rem; padding: 11px 22px; cursor: pointer; transition: background 0.15s, transform 0.15s; white-space: nowrap; }
.pd-btn:hover { background: #2360c6; }
.pd-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pd-btn--ghost { background: #fff; color: #5b6472; border: 1px solid #e4e9f1; }
.pd-btn--ghost:hover { background: #f1f6fd; color: #091747; }

/* catalog-style hero + cards (like /all_course), tokens inlined */
.pd-hero { position: relative; padding: 32px 0 24px; overflow: hidden; }
.pd-blob { position: absolute; top: -200px; right: -160px; width: 520px; height: 520px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, rgba(84, 149, 243, 0.2), rgba(84, 149, 243, 0.05) 60%, transparent 72%); pointer-events: none; z-index: 0; }
.pd-hero__text { position: relative; z-index: 1; }
.pd-badge { display: inline-flex; align-items: center; gap: 9px; padding: 7px 15px; border-radius: 999px; background: #eaf1fe; color: #1f5fc9; font-weight: 600; font-size: 14px; }
.pd-badge__dot { width: 8px; height: 8px; border-radius: 50%; background: #f09157; box-shadow: 0 0 0 4px rgba(240, 145, 87, 0.22); }
.pd-hero__title { margin: 18px 0 0; font-weight: 700; font-size: clamp(1.9rem, 4.4vw, 3rem); line-height: 1.05; letter-spacing: -0.02em; color: #091747; }
.pd-hero__sub { margin: 16px 0 0; max-width: 56ch; font-size: 1.08rem; color: #5b6472; }
.sp-catalog { margin-top: 20px; }
.pd-h2 { margin: 0 0 20px; font-weight: 700; font-size: clamp(1.4rem, 3vw, 1.9rem); letter-spacing: -0.02em; color: #091747; }
.pd-state { text-align: center; color: #5b6472; font-size: 1.05rem; padding: 40px 0; }
.pd-cards { display: grid; }
.pd-cards--courses { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.pd-course { display: flex; flex-direction: column; gap: 12px; background: #fff; border: 1px solid #e4e9f1; border-radius: 16px; padding: 20px 20px 18px; text-align: left; cursor: pointer; color: inherit; font: inherit; transition: transform 0.22s cubic-bezier(0.23, 1, 0.32, 1), box-shadow 0.22s, border-color 0.22s; }
.pd-course:hover { transform: translateY(-3px); box-shadow: 0 14px 40px -20px rgba(9, 23, 71, 0.24); border-color: #cdddf7; }
.pd-course__cover { position: relative; margin: -20px -20px 0; aspect-ratio: 16/9; overflow: hidden; border-radius: 16px 16px 0 0; background: #eaf1fe; display: grid; place-items: center; }
.pd-course__cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pd-course__cover--ph { font-size: 34px; opacity: 0.6; }
.pd-course__badge { position: absolute; top: 10px; left: 10px; padding: 4px 11px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.pd-course__t { margin: 4px 0 0; font-weight: 600; font-size: 1.05rem; line-height: 1.28; letter-spacing: -0.01em; flex: 1; color: #091747; }
.pd-course__when { font-size: 0.9rem; color: #5b6472; }
.pd-course__foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 4px; }
.pd-course__auth { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.pd-course__ava { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex: none; }
.pd-course__ava--i { display: grid; place-items: center; background: #eaf1fe; color: #1f5fc9; font-weight: 700; font-size: 11px; }
.pd-course__author { color: #98a0ad; font-size: 0.88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-course__price { font-weight: 700; font-size: 1.05rem; color: #091747; white-space: nowrap; flex: none; }
.pd-course__price.is-free { color: #c2410c; }
@media (max-width: 900px) { .pd-cards--courses { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .pd-cards--courses { grid-template-columns: 1fr; } }

/* cover upload */
.sp-hidden-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.sp-upload { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 12px 16px; border: 1px dashed #cbd5e1; border-radius: 12px; color: #5b6472; cursor: pointer; font-size: 14px; font-weight: 600; width: fit-content; }
.sp-upload:hover { border-color: #5495f3; color: #1f5fc9; }
.sp-upload.is-disabled { opacity: 0.6; pointer-events: none; }
.sp-cover { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
.sp-cover-img { width: 200px; aspect-ratio: 16/9; object-fit: cover; border-radius: 12px; border: 1px solid #e4e9f1; }
.sp-cover-ctl { display: flex; gap: 8px; flex-wrap: wrap; }
.sp-btn-ghost { background: none; border: 1px solid #e4e9f1; color: #dc2626; }
.sp-btn-mini.is-disabled { opacity: 0.6; pointer-events: none; }

/* form */
.sp-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.sp-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
}
.sp-field input,
.sp-field textarea {
    font: inherit;
    font-weight: 400;
    padding: 10px 12px;
    border: 1px solid #d7dee8;
    border-radius: 8px;
    color: #1b1f27;
    resize: vertical;
}
.sp-field input:focus,
.sp-field textarea:focus {
    outline: none;
    border-color: #5495f3;
}
.sp-form-actions {
    display: flex;
    gap: 10px;
}
.sp-radio-row {
    display: flex;
    gap: 18px;
    font-weight: 400;
}
.sp-radio {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 14px;
    color: #374151;
}
.sp-paid-fields {
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.sp-check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    cursor: pointer;
    font-size: 13px;
    line-height: 1.4;
    color: #374151;
}
.sp-check input {
    margin-top: 2px;
    flex: none;
}
.sp-field select {
    font: inherit;
    font-weight: 400;
    padding: 10px 12px;
    border: 1px solid #d7dee8;
    border-radius: 8px;
    color: #1b1f27;
    background: #fff;
}
.sp-buy-btn {
    margin-top: 14px;
}
.sp-promo-input {
    display: block;
    width: 100%;
    max-width: 280px;
    margin-top: 14px;
    height: 42px;
    padding: 0 14px;
    border: 1px solid #d7dee8;
    border-radius: 10px;
    font: inherit;
    font-size: 15px;
    box-sizing: border-box;
}
.sp-promo-input:focus { outline: none; border-color: #5495f3; }

/* buttons */
.sp-btn {
    font: inherit;
    font-weight: 600;
    font-size: 14px;
    border-radius: 8px;
    padding: 9px 18px;
    border: 1px solid transparent;
    cursor: pointer;
}
.sp-btn:disabled {
    opacity: 0.6;
    cursor: default;
}
.sp-btn-primary {
    background: #5495f3;
    color: #fff;
    border-color: #5495f3;
}
.sp-btn-secondary {
    background: #fff;
    color: #5b6472;
    border-color: #d7dee8;
}
.sp-btn-mini {
    padding: 5px 12px;
    font-size: 13px;
    background: #fff;
    color: #5b6472;
    border-color: #d7dee8;
}
.sp-btn-danger {
    color: #e5484d;
    border-color: #f3c4c6;
}
.sp-btn-danger:hover {
    background: #fdecec;
}
.sp-confirm-text {
    font-size: 13px;
    color: #5b6472;
    align-self: center;
}
.sp-close {
    background: none;
    border: none;
    color: #9ca3af;
    font-size: 16px;
    cursor: pointer;
}
.sp-error {
    color: #e5484d;
    font-size: 14px;
    margin: 12px 0 0;
}
.sp-buy-error { margin-top: 10px; }
.sp-retry-btn { margin-top: 10px; }

/* creds */
.sp-creds {
    border-color: #cfe0fb;
    background: #f5f9ff;
}
.sp-cred-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin: 10px 0;
}
.sp-cred-label {
    min-width: 110px;
    font-size: 13px;
    font-weight: 600;
    color: #374151;
}
.sp-cred-val {
    flex: 1;
    min-width: 200px;
    background: #fff;
    border: 1px solid #d7dee8;
    border-radius: 6px;
    padding: 7px 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    overflow-x: auto;
    white-space: nowrap;
}
/* OBS-блок внутри карточки эфира */
.sp-item-creds { margin-top: 10px; }
.sp-item-creds .sp-cred-val { min-width: 0; }   /* не распирать узкую карточку на 375px — длинное прокручивается внутри */

/* grid of stream tiles */
.sp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
    margin-top: 8px;
}
.sp-tile {
    text-align: left;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    padding: 0;
    font: inherit;
    color: inherit;
}
.sp-tile:hover {
    border-color: #cfe0fb;
    box-shadow: 0 2px 10px rgba(84, 149, 243, 0.12);
}
.sp-thumb {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #eef2f7;
}
.sp-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.sp-thumb-ph {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #b6c0cf;
    font-size: 30px;
}
.sp-tile-badge {
    position: absolute;
    top: 8px;
    left: 8px;
}
.sp-tile-body {
    padding: 10px 12px 12px;
}
.sp-tile-title {
    font-weight: 600;
    font-size: 15px;
    line-height: 1.3;
}
.sp-tile-meta {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 6px;
    font-size: 13px;
    color: #6b7280;
}

/* author list */
.sp-list {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
}
.sp-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 0;
    border-top: 1px solid #eef1f5;
}
.sp-buyers-toggle { border: none; background: #f1f6fd; color: #1f5fc9; font: inherit; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; cursor: pointer; }
.sp-buyers-toggle:hover { background: #e3edfd; }
.sp-buyers { flex-basis: 100%; width: 100%; margin-top: 4px; padding: 12px 14px; background: #f8fafc; border-radius: 12px; }
.sp-buyers-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.sp-buyers-item { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; padding: 6px 0; border-bottom: 1px solid #eef1f5; }
.sp-buyers-item:last-child { border-bottom: none; }
.sp-buyers-name { font-weight: 600; color: #091747; }
.sp-buyers-email { color: #5b6472; }
.sp-buyers-total { margin-top: 8px; font-size: 12px; color: #8a93a2; }
.sp-item:first-child {
    border-top: none;
}
.sp-item-title {
    font-weight: 600;
    font-size: 15px;
}
.sp-item-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
    font-size: 13px;
    color: #6b7280;
}
.sp-item-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}
@media (max-width: 600px) {
    .sp-item { flex-direction: column; align-items: stretch; }
    .sp-item-actions { width: 100%; }
    .sp-item-actions .sp-btn-mini { flex: 1 1 auto; text-align: center; }
}

/* badges */
.sp-badge {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
}
.sp-badge-scheduled {
    background: #eef2f7;
    color: #5b6472;
}
.sp-badge-live {
    background: #fdecec;
    color: #e5484d;
}
.sp-badge-ended {
    background: #eef2f7;
    color: #8a93a2;
}
.sp-badge-hidden {
    background: #fff4e5;
    color: #b06a00;
}
.sp-badge-viewers {
    background: #eaf1fe;
    color: #2360c6;
}
.sp-notice {
    background: #eef6ff;
    color: #235a97;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 14px;
    margin: 0 0 8px;
}

/* detail */
.sp-detail-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 6px;
}
.sp-price {
    font-size: 14px;
    color: #6b7280;
}
.sp-detail-title {
    font-size: 22px;
    font-weight: 600;
    margin: 0 0 4px;
}
.sp-detail-author {
    color: #6b7280;
    font-size: 14px;
    margin-bottom: 10px;
}
.sp-detail-sub {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 16px;
}
.sp-detail-when {
    font-size: 14px;
    color: #374151;
    font-weight: 600;
}
.sp-share-btn {
    padding: 7px 14px;
    font-size: 13px;
}
.sp-optional {
    font-weight: 400;
    color: #9ca3af;
}
.sp-tile-when {
    margin-top: 4px;
    font-size: 13px;
    color: #374151;
    font-weight: 600;
}
.sp-msg-when {
    font-size: 15px;
    font-weight: 600;
    color: #cfe0fb;
    margin-bottom: 6px;
}
.sp-detail-desc {
    margin-top: 16px;
    font-size: 15px;
    line-height: 1.5;
    color: #374151;
    white-space: pre-line;
}
/* Multi-host (co-host) controls on the stream detail */
.sp-cohost {
    margin-top: 16px;
    padding: 16px;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    background: #f9fafb;
}
.sp-cohost-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.sp-cohost-invite {
    display: flex;
    gap: 8px;
    margin-top: 12px;
}
.sp-cohost-invite input {
    flex: 1;
    height: 40px;
    padding: 0 12px;
    border: 1px solid #d1d5db;
    border-radius: 10px;
    font-size: 14px;
}
.sp-cohost-list {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
}
.sp-cohost-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
    border-top: 1px solid #eceef1;
    font-size: 14px;
}
.sp-cohost-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.sp-cohost-status {
    font-size: 12px;
    color: #2563eb;
    margin: 0 10px;
}
.sp-cohost-remove {
    display: inline-flex;
    gap: 8px;
    flex-shrink: 0;
}
.sp-link-danger,
.sp-link-muted {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: 13px;
}
.sp-link-danger {
    color: #dc2626;
}
.sp-link-muted {
    color: #64748b;
}
.sp-player-wrap {
    width: 100%;
}
.sp-player {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #0d0f12;
    border-radius: 12px;
    overflow: hidden;
}
.sp-player iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
}
.sp-player-msg {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: #e5e7eb;
    padding: 24px;
}
.sp-player-msg .sp-muted {
    color: #9ca3af;
}
.sp-msg-title {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 6px;
    color: #fff;
}

/* viewer chat */
.sp-chat {
    margin-top: 24px;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    background: #fff;
    padding: 16px;
}
.sp-chat-title {
    margin: 0 0 12px;
    font-size: 17px;
    font-weight: 700;
    color: #1b1f27;
}
.sp-chat-feed {
    max-height: 360px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-right: 4px;
}
.sp-chat-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
}
.sp-chat-ava {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    object-fit: cover;
    flex: 0 0 auto;
}
.sp-chat-ava-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #eef2f7;
    color: #5b6472;
    font-weight: 700;
    text-transform: uppercase;
}
.sp-chat-bubble {
    background: #f5f7fa;
    border-radius: 10px;
    padding: 8px 12px;
    max-width: 78%;
}
.sp-chat-mine {
    flex-direction: row-reverse;
}
.sp-chat-mine .sp-chat-bubble {
    background: #eaf2fe;
}
.sp-chat-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 2px;
}
.sp-chat-name {
    font-weight: 600;
    font-size: 13px;
    color: #374151;
}
.sp-chat-time {
    font-size: 11px;
    color: #9ca3af;
}
.sp-chat-del {
    font: inherit;
    font-size: 11px;
    color: #b6c0cf;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
}
.sp-chat-del:hover {
    color: #e5484d;
}
.sp-chat-text {
    font-size: 14px;
    color: #1b1f27;
    white-space: pre-wrap;
    word-break: break-word;
}
.sp-chat-composer {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    align-items: flex-end;
}
.sp-chat-input {
    flex: 1;
    font: inherit;
    font-size: 14px;
    resize: none;
    min-height: 40px;
    max-height: 120px;
    border: 1px solid #d7dee8;
    border-radius: 8px;
    padding: 9px 12px;
    color: #1b1f27;
}
.sp-chat-input:focus {
    outline: none;
    border-color: #5495f3;
}
.sp-chat-login {
    margin-top: 12px;
    text-align: center;
}
</style>

<style scoped>
.sp-buyer-grant { display: grid; gap: 8px; margin-bottom: 14px; }
.sp-buyer-grant label { font-size: 13px; font-weight: 600; color: #091747; }
.sp-buyer-grant-row { display: flex; flex-wrap: wrap; gap: 8px; }
.sp-buyer-grant-row input { flex: 1 1 230px; min-width: 0; padding: 9px 11px; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; font-size: 14px; }
.sp-buyer-grant-row input:focus-visible { outline: 2px solid #1f5fc9; outline-offset: 2px; }
.sp-buyer-grant-row input:disabled { opacity: .65; }
.sp-buyer-manual { display: block; margin-top: 3px; color: #5b6472; font-size: 12px; font-weight: 400; }
.sp-buyers-item > span { min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 480px) { .sp-buyer-grant-row > button { width: 100%; } .sp-buyers-item { flex-wrap: wrap; gap: 4px; } }
</style>
