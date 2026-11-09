<template>
    <div>
        <div class="sp-player"><iframe ref="iframe" :src="apiSrc" allowfullscreen sandbox="allow-same-origin allow-scripts allow-popups allow-forms" allow="autoplay; fullscreen" title="Видеотрансляция" @load="attach"></iframe></div>
        <div class="sq-viewer">
            <label v-if="options.length" :for="id">Качество
                <select :id="id" :value="selected" :disabled="changing" @change="select($event.target.value)">
                    <option v-for="q in options" :key="q.id" :value="q.id">{{ q.label }}</option>
                </select>
            </label>
            <p role="status">{{ apiError || (current ? `Текущее качество: ${current}` : 'Текущее качество: недоступно') }}</p>
            <details><summary>Диагностика воспроизведения</summary><p>Состояние: {{ playback || 'Недоступно' }}. Буферизация: недоступно. Пропущенные кадры: недоступно.</p><p>Профиль из списка плеера; размеры декодированного кадра Embed API не предоставляет.</p></details>
        </div>
    </div>
</template>
<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { connectPeerTubeQuality } from '../streams/peerTubeQuality.js';
import { availableResolutions } from '../streams/videoQuality.js';
const props = defineProps({ src: { type: String, required: true }, id: { type: String, default: 'stream-viewer-quality' } });
const iframe = ref(null), options = ref([]), selected = ref(null), current = ref(null), apiError = ref(''), playback = ref(null), changing = ref(false);
let client = null, generation = 0, poll = null;
const apiSrc = computed(() => { if (!props.src) return ''; const u = new URL(props.src, location.origin); u.searchParams.set('api', '1'); return u.href; });
function cleanup() { generation++; clearInterval(poll); poll = null; client?.dispose(); client = null; options.value = []; selected.value = null; current.value = null; playback.value = null; changing.value = false; }
async function refresh(local, version) {
    const rows = await local.getResolutions(); if (version !== generation) return;
    options.value = availableResolutions(rows);
    const active = Array.isArray(rows) ? rows.find(r => r.active && r.id !== -1) : null;
    current.value = active && Number.isFinite(Number(active.height)) ? `${Number(active.height)}p` : null;
    const selectedRow = Array.isArray(rows) ? rows.find(r => r.active) : null;
    if (selectedRow && options.value.some(q => q.id === selectedRow.id)) selected.value = selectedRow.id;
}
async function attach() {
    cleanup(); apiError.value = ''; if (!iframe.value || !props.src) return;
    const version = generation;
    const local = connectPeerTubeQuality(iframe.value, { onResolutions: () => refresh(local, version).catch(() => {}), onPlayback: state => { if (version === generation) playback.value = state; } });
    client = local;
    try {
        await local.ready; await refresh(local, version); if (version !== generation) return;
        if (options.value.some(q => q.id === -1)) { await local.setResolution(-1); selected.value = -1; }
        if (version !== generation) return;
        poll = setInterval(() => refresh(local, version).catch(() => {}), 5000);
    } catch { if (version === generation) { apiError.value = 'Управление качеством недоступно. Используйте настройки самого плеера.'; options.value = []; local.dispose(); } }
}
async function select(value) {
    const n = Number(value), local = client, version = generation;
    if (!local || !options.value.some(q => q.id === n)) return;
    changing.value = true;
    try { await local.setResolution(n); if (version === generation) { selected.value = n; apiError.value = ''; await refresh(local, version); } }
    catch { if (version === generation) apiError.value = 'Не удалось переключить качество. Используйте настройки плеера.'; }
    finally { if (version === generation) changing.value = false; }
}
watch(() => props.src, cleanup, { flush: 'sync' });
onBeforeUnmount(cleanup);
</script>
<style scoped>
.sq-viewer { padding: 10px 0; font-size: 14px; }
.sq-viewer select { margin-left: 8px; padding: 6px; }
.sq-viewer p { margin: 6px 0; }
.sp-player { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #0d0f12; border-radius: 12px; overflow: hidden; }
.sp-player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
</style>
