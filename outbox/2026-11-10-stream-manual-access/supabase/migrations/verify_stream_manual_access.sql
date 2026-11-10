-- READ ONLY, no user records returned.
select p.oid::regprocedure as rpc,p.prosecdef as security_definer,
 p.proconfig as settings,pg_get_userbyid(p.proowner) as owner,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_can_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') as guest_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='grant_stream_access_by_email';
