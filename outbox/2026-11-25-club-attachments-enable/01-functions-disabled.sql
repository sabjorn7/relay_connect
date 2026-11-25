-- PREPARATION ONLY. Install in one transaction with approved Storage changes.
CREATE OR REPLACE FUNCTION public.club_chat_capabilities(p_club uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('attachments',COALESCE(
 p_club=NULL::uuid AND public.club_chat_has_access(p_club,auth.uid()),false))
$$;
REVOKE ALL ON FUNCTION public.club_chat_capabilities(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_chat_capabilities(uuid) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.club_chat_send_attachment(p_club uuid,p_request_id uuid,p_path text,p_kind text,p_name text,p_size bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); result uuid; obj jsonb; ext text; expected text;
BEGIN
 IF uid IS NULL OR NOT COALESCE((public.club_chat_capabilities(p_club)->>'attachments')::boolean,false) OR NOT public.club_chat_has_access(p_club,uid) THEN RAISE EXCEPTION 'club_access_denied' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_path IS NULL OR p_kind IS NULL OR p_size IS NULL OR p_name IS NULL THEN RAISE EXCEPTION 'invalid_attachment'; END IF;
 -- Serialize retries of this user's single request; parallel tabs with different requests remain independent.
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,0));
 SELECT id INTO result FROM public.club_chat WHERE owner=uid AND attachment_request_id=p_request_id AND club=p_club AND attachment_path=p_path;
 IF result IS NOT NULL THEN RETURN result; END IF;
 ext:=lower(substring(p_path from '\.([a-z0-9]+)$'));
 expected:=CASE WHEN ext=ANY(ARRAY['jpg','jpeg','png','webp','gif']) THEN 'image' WHEN ext=ANY(ARRAY['mp3','webm','ogg','mp4','m4a']) THEN 'audio' WHEN ext=ANY(ARRAY['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','zip']) THEN 'file' END;
 IF expected IS NULL OR p_kind<>expected OR p_path<>p_club::text||'/'||uid::text||'/'||p_request_id::text||'.'||ext OR length(p_name)>240 OR p_size<1 OR p_size>(CASE WHEN expected='image' THEN 10485760 ELSE 26214400 END) THEN RAISE EXCEPTION 'invalid_attachment'; END IF;
 SELECT metadata INTO obj FROM storage.objects WHERE bucket_id='club-chat-private' AND name=p_path;
 IF obj IS NULL OR (obj->>'size') IS NULL OR (obj->>'size')::bigint<>p_size THEN RAISE EXCEPTION 'attachment_not_uploaded'; END IF;
 INSERT INTO public.club_chat(club,owner,text,img,attachment_path,attachment_type,attachment_name,attachment_size,attachment_request_id)
 VALUES(p_club,uid,NULL,ARRAY[]::text[],p_path,p_kind,p_name,p_size,p_request_id) RETURNING id INTO result;
 RETURN result;
END;$$;
