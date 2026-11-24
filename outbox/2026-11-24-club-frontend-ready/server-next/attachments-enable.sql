-- PREPARATION ONLY. Requires separate approval after frontend deployment.
BEGIN;
CREATE OR REPLACE FUNCTION public.club_chat_capabilities() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT jsonb_build_object('attachments',auth.uid() IS NOT NULL) $$;
COMMIT;
SELECT public.club_chat_capabilities();
