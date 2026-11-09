-- Operational rollback: leaves data/history intact and never touches live egress.
-- Deploy previous frontend/orchestrator in a separately approved idle window if needed.
begin;
update public.stream_video_quality_settings set full_hd_enabled=false where singleton;
-- Existing active runs retain their recorded profiles; no reset, deletion or media restart.
commit;
