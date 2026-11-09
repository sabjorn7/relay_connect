-- OWNER MANUAL ONLY. Idempotent, precise revoke. Does NOT stop an active Egress.
begin;
select pg_advisory_xact_lock(78403191);
update public.stream_full_hd_test_grants set enabled=false
where stream_id='REPLACE_STREAM_UUID'::uuid and owner_id='REPLACE_OWNER_UUID'::uuid;
commit;
