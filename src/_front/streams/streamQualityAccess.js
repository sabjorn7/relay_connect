// Read-only, per-stream permission. No caller-supplied owner and no global fallback.
export async function streamFullHdAllowed(supabase, streamId) {
    try {
        const { data, error } = await supabase.rpc('stream_video_quality_for_stream', { p_stream_id: streamId });
        return !error && data?.version === 2 && data.full_hd_allowed === true;
    } catch { return false; }
}
