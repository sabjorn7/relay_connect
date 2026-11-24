<template>
    <article class="mg-club-msg" :class="{ 'is-mine': mine }">
        <component :is="profileHref ? 'a' : 'span'" :href="profileHref" class="mg-club-msg__avatar" :aria-label="`Профиль: ${name}`">
            <img v-if="photo" :src="photo" :alt="name" @error="photoFailed = true" />
            <span v-else>{{ initials }}</span>
        </component>
        <div class="mg-club-msg__col">
            <component :is="profileHref ? 'a' : 'span'" :href="profileHref" class="mg-club-msg__sender">{{ name }}</component>
            <div class="mg-club-msg__bubble">
                <span v-if="message.deleted" class="mg-club-msg__deleted">Сообщение удалено</span>
                <template v-else>
                    <div v-if="images.length" class="mg-club-msg__images">
                        <button v-for="(image, index) in images" :key="image" type="button" :aria-label="`Открыть фото ${index + 1}`" @click="openImages">
                            <img :src="image" alt="Фото в сообщении" loading="lazy" />
                        </button>
                    </div>
                    <span v-if="message.text" class="mg-club-msg__text"><ChatMessageText :text="message.text" /></span>
                    <ChatLinkPreview v-if="message.text" :text="message.text" :mine="mine" />
                </template>
                <time class="mg-club-msg__time" :datetime="message.created_at">{{ time }}</time>
            </div>
        </div>
        <button v-if="mine && !message.deleted" class="mg-club-msg__delete" type="button" aria-label="Удалить своё сообщение" @click="openDelete">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7M14 10v7" /></svg>
        </button>
    </article>
</template>
<script setup>
// Presentation adapter for the existing two WeWeb club-chat message templates.
// No queries, membership rules, new messages or upload paths are introduced here.
import { computed, inject, ref, watch } from 'vue';
import ChatMessageText from './ChatMessageText.vue';
import ChatLinkPreview from './ChatLinkPreview.vue';
import { readStoredSession } from '../chrome/headerAccount.js';
import { usePopupStore } from '@/pinia/popup';
import { clubMessageView } from '../helpers/clubMessageView.js';
const binding = inject('bindingContext', null);
const popups = usePopupStore();
const message = computed(() => binding?.data || {});
const view = computed(() => clubMessageView(message.value, readStoredSession()?.user?.id));
const name = computed(() => view.value.name), initials = computed(() => view.value.initials);
const mine = computed(() => view.value.mine), time = computed(() => view.value.time);
const profileHref = computed(() => view.value.profileHref), images = computed(() => view.value.images);
const photoFailed = ref(false);
const photo = computed(() => photoFailed.value ? null : view.value.photo);
watch(() => view.value.photo, () => { photoFailed.value = false; });
function openImages() {
    if (message.value.deleted || !images.value.length) return;
    popups.open('bdbce13b-c53c-49c0-90cb-d54f062291c6', { default: { 'dec067db-951e-4696-b622-4a9abfdc6f31': images.value } });
}
function openDelete() {
    if (!mine.value || message.value.deleted) return;
    // Same confirmation popup and workflow as the existing club message's trash icon.
    popups.open('44b526d0-6761-4039-896b-7358ae1504c0', { default: { '53525e42-bc4d-43d4-a441-187613868fe2': message.value.id, '6fb2e2db-5a10-4577-bfe3-532ec9d4ccbd': '' } });
}
</script>
<style scoped>
.mg-club-msg { --blue: #2e70dd; --blue-ink: #1f5fc9; --line: #e4e9f1; --bg-tint: #f1f6fd; --ink: #091747; display: flex; align-items: flex-end; gap: 8px; width: 100%; box-sizing: border-box; padding: 8px; font-family: 'Onest', system-ui, sans-serif; color: var(--ink); }
.mg-club-msg.is-mine { justify-content: flex-end; }
.mg-club-msg__avatar { display: block; width: 30px; height: 30px; border-radius: 50%; flex: none; text-decoration: none; }
.mg-club-msg__avatar img, .mg-club-msg__avatar span { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; }
.mg-club-msg__avatar span { display: grid; place-items: center; background: #eaf1fe; color: var(--blue-ink); font-size: 11px; font-weight: 700; }
.is-mine .mg-club-msg__avatar { order: 2; }
.mg-club-msg__col { display: flex; flex-direction: column; max-width: 74%; min-width: 0; }
.mg-club-msg__sender { font-size: 12px; font-weight: 600; color: var(--blue-ink); margin: 0 0 3px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: none; }
.is-mine .mg-club-msg__sender { align-self: flex-end; }
a.mg-club-msg__sender:hover { text-decoration: underline; }
.mg-club-msg__bubble { background: #fff; border: 1px solid var(--line); border-radius: 16px 16px 16px 5px; padding: 10px 14px 7px; }
.is-mine .mg-club-msg__bubble { background: var(--blue); border-color: var(--blue); color: #fff; border-radius: 16px 16px 5px 16px; }
.mg-club-msg__text { display: block; font-size: 16px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
.mg-club-msg__text :deep(.pd-msg__link) { color: var(--blue-ink); }
.is-mine .mg-club-msg__text :deep(.pd-msg__link) { color: #fff; }
.mg-club-msg__time { display: block; margin-top: 3px; text-align: right; font-size: 12px; color: #5b6472; }
.is-mine .mg-club-msg__time { color: #fff; }
.mg-club-msg__images { display: flex; flex-wrap: wrap; gap: 6px; }
.mg-club-msg__images button { border: 0; background: none; padding: 0; cursor: pointer; max-width: 100%; min-width: 44px; min-height: 44px; display: grid; place-items: center; }
.mg-club-msg__images img { display: block; max-width: min(240px, 100%); max-height: 280px; border-radius: 10px; }
.mg-club-msg__delete { border: 0; background: transparent; color: #a82b38; padding: 8px; cursor: pointer; flex: none; }
.mg-club-msg__delete svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; }
.mg-club-msg a:focus-visible, .mg-club-msg button:focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; }
@media (max-width: 600px) { .mg-club-msg__col { max-width: calc(100% - 80px); } }
</style>
