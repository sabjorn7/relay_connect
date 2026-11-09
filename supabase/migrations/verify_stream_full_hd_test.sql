-- READ ONLY. Run after the migration commits and PostgREST schema cache is reloaded.
begin read only;
select 'global flag remains false; max concurrency one' as check_name,
 case when count(*)=1 and bool_and(not full_hd_enabled and max_full_hd_live=1) then 'PASS' else 'FAIL' end as result from public.stream_video_quality_settings where singleton;
select 'private grant table RLS/ACL' as check_name,
 case when c.relrowsecurity and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE') and has_table_privilege('service_role',c.oid,'SELECT') then 'PASS' else 'FAIL' end as result
 from pg_class c where c.oid=to_regclass('public.stream_full_hd_test_grants');
with expected(signature,client) as (values
 ('public.stream_full_hd_test_allowed(uuid,uuid)',false),
 ('public.reserve_stream_video_start_scoped(uuid,uuid,text,text)',false),
 ('public.mark_stream_video_started_scoped(uuid,uuid,text,text,text,uuid,uuid)',false),
 ('public.stream_video_quality_for_stream(uuid)',true))
select e.signature as check_name,case when p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and not has_function_privilege('anon',p.oid,'EXECUTE') and has_function_privilege('authenticated',p.oid,'EXECUTE')=e.client and has_function_privilege('service_role',p.oid,'EXECUTE') then 'PASS' else 'FAIL' end as result
from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature);
select 'one enabled grant maximum' as check_name,case when count(*) filter(where enabled)<=1 then 'PASS' else 'FAIL' end as result from public.stream_full_hd_test_grants;
select 'enabled-grant uniqueness' as check_name,case when exists(select 1 from pg_index where indexrelid=to_regclass('public.stream_full_hd_one_enabled') and indisunique and indpred is not null) then 'PASS' else 'FAIL' end as result;
select 'all three quality/owner triggers enabled' as check_name,case when count(*)=3 and bool_and(tgenabled in ('O','A')) then 'PASS' else 'FAIL' end as result from pg_trigger where tgrelid='public.streams'::regclass and tgname in ('guard_stream_video_quality','guard_stream_video_run','invalidate_stream_full_hd_owner');
select indexdef from pg_indexes where schemaname='public' and indexname='stream_full_hd_one_enabled';
select tgname,tgenabled,pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid='public.streams'::regclass and tgname in ('guard_stream_video_quality','guard_stream_video_run','invalidate_stream_full_hd_owner');
select column_name,data_type from information_schema.columns where table_schema='public' and table_name='stream_video_start_reservations' and column_name='owner_id';
-- Owner-facing operational review, not a public endpoint. No secret keys/tokens.
select g.stream_id,g.owner_id,g.enabled,g.expires_at,
 public.stream_full_hd_test_allowed(g.stream_id,g.owner_id) as currently_valid
from public.stream_full_hd_test_grants g;
select r.stream_id,r.profile,r.owner_id,r.expires_at,
 case when r.expires_at='infinity'::timestamptz then 'EXTERNAL START MAY HAVE OCCURRED: reconcile before release' else 'PRE-START: expires automatically' end as reservation_state
from public.stream_video_start_reservations r;
rollback;
