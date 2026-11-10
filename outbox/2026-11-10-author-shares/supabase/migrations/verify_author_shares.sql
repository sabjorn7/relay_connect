-- READ ONLY. No customer identifiers or financial amounts returned.
select count(*) as users_total,count(*) filter(where "authorCommissionCourses" is null or "authorCommissionClub" is null or "authorCommissionStreams" is null) as missing_rates,
 count(*) filter(where "authorCommissionCourses"<0 or "authorCommissionCourses">100 or "authorCommissionClub"<0 or "authorCommissionClub">100 or "authorCommissionStreams"<0 or "authorCommissionStreams">100) as invalid_rates from public.users;
select p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') as guest_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,has_function_privilege('service_role',p.oid,'EXECUTE') as server_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admin_set_author_share','get_order_author_shares','settle_club_author_share','fulfill_paid_course_order');
select t.tgname,t.tgenabled from pg_trigger t where t.tgrelid='public.users'::regclass and t.tgname='init_author_shares';
