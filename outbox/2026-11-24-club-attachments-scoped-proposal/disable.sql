BEGIN;
CREATE OR REPLACE FUNCTION public.club_chat_capabilities(p_club uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('attachments',COALESCE(
 p_club=NULL::uuid AND public.club_chat_has_access(p_club,auth.uid()),false))
$$;
COMMIT;
