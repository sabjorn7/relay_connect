-- NOT AUTHORIZED: two existing INSERT policy expressions only. No read/update/delete or membership changes.
ALTER POLICY club_private_upload ON storage.objects WITH CHECK(
 bucket_id='club-chat-private' AND (public.club_chat_capabilities(public.club_chat_path_club(name))->>'attachments')::boolean
 AND split_part(name,'/',2)=auth.uid()::text AND public.club_chat_has_access(public.club_chat_path_club(name),auth.uid()));
ALTER POLICY club_private_upload_guard ON storage.objects WITH CHECK(
 bucket_id<>'club-chat-private' OR ((public.club_chat_capabilities(public.club_chat_path_club(name))->>'attachments')::boolean AND split_part(name,'/',2)=auth.uid()::text AND public.club_chat_has_access(public.club_chat_path_club(name),auth.uid())));
