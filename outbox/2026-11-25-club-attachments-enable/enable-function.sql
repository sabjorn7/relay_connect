CREATE OR REPLACE FUNCTION public.club_chat_capabilities(p_club uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('attachments',COALESCE(
 p_club='737b8824-88b8-4cee-b50b-3f4ed3b59683'::uuid AND public.club_chat_has_access(p_club,auth.uid()),false))
$function$;
