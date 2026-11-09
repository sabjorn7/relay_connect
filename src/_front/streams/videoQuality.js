// Shared, dependency-free profile contract. Capture is a request, never a measured result.
export const VIDEO_QUALITY_PROFILES = Object.freeze({
    hd: Object.freeze({ id: 'hd', label: 'HD (720p)', width: 1280, height: 720, fps: 30, cameraBitrate: 1_700_000, egressBitrate: 3_000_000, egressPreset: 'H264_720P_30' }),
    full_hd: Object.freeze({ id: 'full_hd', label: 'Full HD (1080p)', width: 1920, height: 1080, fps: 30, cameraBitrate: 4_500_000, egressBitrate: 4_500_000, egressPreset: 'H264_1080P_30' }),
});
export function videoProfile(value) {
    if (value == null) return VIDEO_QUALITY_PROFILES.hd;
    if (!Object.hasOwn(VIDEO_QUALITY_PROFILES, value)) throw new Error('Неизвестный профиль качества эфира.');
    return VIDEO_QUALITY_PROFILES[value];
}
export function roomVideoOptions(value) {
    const p = videoProfile(value);
    return {
        adaptiveStream: true, dynacast: true,
        videoCaptureDefaults: { resolution: { width: p.width, height: p.height, frameRate: p.fps } },
        publishDefaults: {
            videoCodec: 'vp8', simulcast: true,
            videoEncoding: { maxBitrate: p.cameraBitrate, maxFramerate: p.fps },
            videoSimulcastLayers: [
                { width: 320, height: 180, encoding: { maxBitrate: 160_000, maxFramerate: 20 } },
                { width: p.width / 2, height: p.height / 2, encoding: { maxBitrate: p.id === 'hd' ? 450_000 : 800_000, maxFramerate: p.id === 'hd' ? 20 : 25 } },
            ],
            screenShareEncoding: { maxBitrate: p.egressBitrate, maxFramerate: 30 },
        },
    };
}
export async function enableProfileCamera(participant, value) {
    const p = videoProfile(value);
    try {
        return await participant.setCameraEnabled(true, { resolution: { width: p.width, height: p.height, frameRate: p.fps } });
    } catch (error) {
        // Do not retry permission/device-in-use errors, only unsupported constraints.
        if (!['OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(error?.name)) throw error;
        return participant.setCameraEnabled(true, { resolution: { width: 640, height: 360, frameRate: 30 } });
    }
}
export function captureWarning(settings, value) {
    const p = videoProfile(value);
    if (!Number.isFinite(settings?.width) || !Number.isFinite(settings?.height)) return 'Фактическое разрешение камеры недоступно.';
    return settings.width < p.width || settings.height < p.height
        ? `Камера передаёт ${settings.width}×${settings.height}, ниже выбранного ${p.label}. Эфир продолжает работать.` : '';
}
export function availableResolutions(rows) {
    if (!Array.isArray(rows)) return [];
    const seen = new Set();
    return rows.filter(r => Number.isInteger(r.id) && (r.id === -1 || [480, 720, 1080].includes(Number(r.height))) && !seen.has(r.id) && seen.add(r.id))
        .map(r => ({ id: r.id, label: r.id === -1 ? 'Авто' : `${Number(r.height)}p`, active: r.active === true }));
}
