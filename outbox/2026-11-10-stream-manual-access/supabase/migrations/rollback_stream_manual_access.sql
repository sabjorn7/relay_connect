-- OWNER MANUAL ONLY. Stops new manual grants; keeps every granted entitlement.
begin;
drop function if exists public.grant_stream_access_by_email(uuid,text);
notify pgrst,'reload schema';
commit;
