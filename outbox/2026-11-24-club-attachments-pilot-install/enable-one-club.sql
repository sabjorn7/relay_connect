-- PREPARATION ONLY. psql -X -v ON_ERROR_STOP=1 -v pilot_club=APPROVED_UUID -f enable-one-club.sql
-- No default test club; invalid or missing UUID fails. Requires separate approval.
BEGIN;
SELECT set_config('mg.club_pilot_target', :'pilot_club'::uuid::text, true);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.clubs WHERE id=current_setting('mg.club_pilot_target')::uuid)
 THEN RAISE EXCEPTION 'pilot_club_not_found'; END IF;
END $$;
SELECT format($ddl$
CREATE OR REPLACE FUNCTION public.club_chat_capabilities(p_club uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $body$
 SELECT jsonb_build_object('attachments',COALESCE(p_club=%L::uuid
 AND public.club_chat_has_access(p_club,auth.uid()),false))
$body$;
$ddl$,current_setting('mg.club_pilot_target')) \gexec
COMMIT;
