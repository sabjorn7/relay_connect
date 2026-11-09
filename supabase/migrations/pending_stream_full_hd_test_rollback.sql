-- Operational rollback only: no media stop, deletion or global flag change.
begin;
update public.stream_full_hd_test_grants set enabled=false where enabled;
commit;
