-- REVIEW ONLY; not applied. No existing table RLS, membership or grants changed.
BEGIN;
-- Proposed reproduction of the latest user_sub displayed by get_club_bundle:
-- owner OR latest subscription with no end_date / a future date; active is not rewritten.
-- Confirm null and last-day semantics before approving this file.
CREATE FUNCTION public.club_chat_has_access(p_club uuid,p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p_user IS NOT NULL AND p_user=auth.uid() AND (
 EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=p_club AND c.owner=p_user)
 OR COALESCE((SELECT s.end_date IS NULL OR s.end_date>current_date FROM public.club_subs s
 WHERE s.club=p_club AND s.suber=p_user ORDER BY s.created_at DESC,s.id DESC LIMIT 1),false));
$$;
REVOKE ALL ON FUNCTION public.club_chat_has_access(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.club_chat_has_access(uuid,uuid) TO anon,authenticated;

CREATE FUNCTION public.club_chat_capabilities() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT jsonb_build_object('attachments',false) $$;
REVOKE ALL ON FUNCTION public.club_chat_capabilities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_chat_capabilities() TO anon,authenticated;
ALTER TABLE public.club_chat ADD COLUMN attachment_path text, ADD COLUMN attachment_type text,
 ADD COLUMN attachment_name text, ADD COLUMN attachment_size bigint, ADD COLUMN attachment_request_id uuid;
CREATE UNIQUE INDEX club_chat_attachment_request ON public.club_chat(owner,attachment_request_id) WHERE attachment_request_id IS NOT NULL;
ALTER TABLE public.club_chat ADD CONSTRAINT club_chat_attachment_shape CHECK (
 (attachment_path IS NULL AND attachment_type IS NULL AND attachment_name IS NULL AND attachment_size IS NULL AND attachment_request_id IS NULL)
 OR (attachment_path IS NOT NULL AND attachment_type IN ('image','file','audio') AND attachment_name IS NOT NULL
 AND length(attachment_name)<=240 AND attachment_size BETWEEN 1 AND 26214400 AND attachment_request_id IS NOT NULL));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES
 ('club-chat-private','club-chat-private',false,26214400,ARRAY['image/jpeg','image/png','image/webp','image/gif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/plain','application/zip','audio/webm','audio/ogg','audio/mp4','audio/mpeg']);
CREATE FUNCTION public.club_chat_path_club(p_path text) RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF p_path !~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{2,5}$' THEN RETURN NULL; END IF;
 RETURN split_part(p_path,'/',1)::uuid;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END;$$;
CREATE POLICY club_private_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(
 bucket_id='club-chat-private' AND (public.club_chat_capabilities()->>'attachments')::boolean
 AND split_part(name,'/',2)=auth.uid()::text AND public.club_chat_has_access(public.club_chat_path_club(name),auth.uid()));
CREATE POLICY club_private_read ON storage.objects FOR SELECT TO authenticated USING(
 bucket_id='club-chat-private' AND public.club_chat_has_access(public.club_chat_path_club(name),auth.uid())
 AND (split_part(name,'/',2)=auth.uid()::text OR EXISTS(SELECT 1 FROM public.club_chat m WHERE m.attachment_path=name AND m.deleted IS NOT TRUE)));
-- Restrictive guards prevent any older broad Storage policy from bypassing this bucket.
CREATE POLICY club_private_upload_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(
 bucket_id<>'club-chat-private' OR ((public.club_chat_capabilities()->>'attachments')::boolean AND split_part(name,'/',2)=auth.uid()::text AND public.club_chat_has_access(public.club_chat_path_club(name),auth.uid())));
CREATE POLICY club_private_read_guard ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(
 bucket_id<>'club-chat-private' OR (auth.uid() IS NOT NULL AND public.club_chat_has_access(public.club_chat_path_club(name),auth.uid()) AND (split_part(name,'/',2)=auth.uid()::text OR EXISTS(SELECT 1 FROM public.club_chat m WHERE m.attachment_path=name AND m.deleted IS NOT TRUE))));
CREATE POLICY club_private_no_overwrite ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING(bucket_id<>'club-chat-private');
CREATE POLICY club_private_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO anon,authenticated USING(bucket_id<>'club-chat-private');
-- No UPDATE/upsert policy; no bucket public URLs. Orphan cleanup is an admin task, never deletes history.

CREATE FUNCTION public.club_chat_send_attachment(p_club uuid,p_request_id uuid,p_path text,p_kind text,p_name text,p_size bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); result uuid; obj jsonb; ext text; expected text;
BEGIN
 IF uid IS NULL OR NOT COALESCE((public.club_chat_capabilities()->>'attachments')::boolean,false) OR NOT public.club_chat_has_access(p_club,uid) THEN RAISE EXCEPTION 'club_access_denied' USING ERRCODE='42501'; END IF;
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
REVOKE ALL ON FUNCTION public.club_chat_send_attachment(uuid,uuid,text,text,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.club_chat_send_attachment(uuid,uuid,text,text,text,bigint) TO authenticated;

COMMIT;
