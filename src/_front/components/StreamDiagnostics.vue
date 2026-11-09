<template>
    <div class="sq-diag">
        <p v-if="room">Камера: {{ cameraLabel || 'Недоступно' }} · Захват: {{ size(capture.width, capture.height) }} · {{ capture.frameRate == null ? 'FPS недоступен' : `${Math.round(capture.frameRate)} FPS` }}</p>
        <p v-if="warning" role="status">{{ warning }}</p>
        <details @toggle="toggle">
            <summary>Диагностика качества трансляции</summary>
            <p v-if="room">Запрошено: {{ requested.label }} / {{ requested.fps }} FPS. Соединение: {{ connection || 'Недоступно' }}.</p>
            <p v-if="room">RTT: {{ format(rtt, 'мс') }}. Статистика отправки по слоям:</p>
            <ul v-if="layers.length"><li v-for="(layer, i) in layers" :key="i">{{ layer.source }}: {{ size(layer.width, layer.height) }} · {{ format(layer.fps, 'FPS') }} · {{ format(layer.bitrate == null ? null : layer.bitrate / 1000000, 'Мбит/с', 2) }} · потери {{ format(layer.lossPercent, '%', 1) }} · jitter {{ format(layer.jitterMs, 'мс') }} · ограничение {{ layer.limitation || 'Недоступно' }}</li></ul>
            <p v-else-if="room">Параметры отправки: недоступно.</p>
            <p>Активный профиль Egress: {{ egress?.profile?.label || 'Недоступно' }}. Состояние: {{ egress?.state || 'Недоступно' }}.</p>
            <p>Заданный выход: {{ egress?.profile ? `${egress.profile.width}×${egress.profile.height} / ${egress.profile.fps} FPS` : 'Недоступно' }}; целевой битрейт {{ format(egress?.profile ? egress.profile.egressBitrate / 1000000 : null, 'Мбит/с', 1) }}.</p>
            <p>Измеренный битрейт Egress: недоступно. CPU/RAM Egress: недоступно.</p>
            <p v-if="egress?.error">Ошибка Egress: {{ egress.error }}</p>
            <p v-if="egressError" role="status">Диагностика сервера недоступна.</p>
            <p>Настроенный профиль не является измерением фактического разрешения.</p>
        </details>
    </div>
</template>
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { Track } from 'livekit-client';
import { videoProfile, captureWarning } from '../streams/videoQuality.js';
import { summarizeVideoStats } from '../streams/videoStats.js';
import { getLiveQuality } from '../streams/liveApi.js';
const props = defineProps({ room: Object, profile: { type: String, default: 'hd' }, streamId: String });
const capture = ref({}), cameraLabel = ref(''), connection = ref(null), layers = ref([]), rtt = ref(null), egress = ref(null), egressError = ref(false);
const requested = computed(() => videoProfile(props.profile));
const warning = computed(() => props.room?.localParticipant.isCameraEnabled ? captureWarning(capture.value, props.profile) : '');
let timer, opened = false, busy = false, disposed = false, previous = new Map(), lastTrack = null;
const format = (v, unit, digits = 0) => typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)} ${unit}` : 'Недоступно';
const size = (w, h) => Number.isFinite(w) && Number.isFinite(h) ? `${w}×${h}` : 'Недоступно';
async function sample() {
    if (busy || disposed) return; busy = true;
    try {
        const track = props.room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
        connection.value = props.room?.state || null;
        if (track !== lastTrack) { previous = new Map(); layers.value = []; rtt.value = null; lastTrack = track; }
        capture.value = track?.mediaStreamTrack?.getSettings?.() || {};
        cameraLabel.value = track?.mediaStreamTrack?.label || '';
        if (opened && props.room) {
            const sources = [['Камера', track], ['Экран/PDF', props.room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track]].filter(([, value]) => value);
            const alive = new Set(sources.map(([, value]) => value));
            for (const key of previous.keys()) if (!alive.has(key)) previous.delete(key);
            const collected = []; let roundTrip = null;
            for (const [source, value] of sources) {
                if (!value.getRTCStatsReport) continue;
                const stats = summarizeVideoStats(await value.getRTCStatsReport(), previous.get(value));
                if (disposed) return;
                previous.set(value, stats.previous); collected.push(...stats.layers.map(layer => ({ ...layer, source })));
                if (stats.rttMs !== null) roundTrip = stats.rttMs;
            }
            layers.value = collected; rtt.value = roundTrip;
        }
        if (opened && props.streamId) {
            try {
                const result = await getLiveQuality(window.wwLib?.wwPlugins?.supabase?.instance, props.streamId);
                if (!disposed) { egress.value = result; egressError.value = false; }
            } catch { if (!disposed) egressError.value = true; }
        }
    } catch { if (!disposed) { layers.value = []; rtt.value = null; } }
    finally { busy = false; }
}
function toggle(event) { opened = event.target.open; previous = new Map(); if (opened) sample(); }
onMounted(() => { sample(); timer = setInterval(sample, 3000); });
onBeforeUnmount(() => { disposed = true; clearInterval(timer); });
</script>
<style scoped>
.sq-diag { padding: 8px 16px; font-size: 14px; line-height: 1.5; background: #fff; color: #17233e; }
.sq-diag p { margin: 4px 0; }
.sq-diag details { max-height: 240px; overflow: auto; }
.sq-diag summary { cursor: pointer; }
.sq-diag ul { padding-left: 20px; }
</style>
