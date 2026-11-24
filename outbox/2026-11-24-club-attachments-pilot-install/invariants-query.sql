SELECT jsonb_build_object(
 'policies',(SELECT jsonb_agg(to_jsonb(x) ORDER BY schemaname,tablename,policyname) FROM pg_policies x WHERE (schemaname='storage' OR (schemaname='public' AND tablename IN ('club_chat','club_posts','club_subs','clubs'))) AND NOT(schemaname='storage' AND tablename='objects' AND policyname IN ('club_private_upload','club_private_upload_guard'))),
 'bucket',(SELECT to_jsonb(b) FROM storage.buckets b WHERE id='club-chat-private'),
 'access',(SELECT jsonb_object_agg(p.proname,pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('club_chat_has_access','club_chat_path_club')),
 'push',(SELECT jsonb_object_agg(tgname,tgenabled) FROM pg_trigger WHERE tgname IN ('trg_push_web_club_message','trg_push_web_club_post')),
 'rls',(SELECT jsonb_object_agg(oid::regclass::text,jsonb_build_array(relrowsecurity,relforcerowsecurity)) FROM pg_class WHERE oid IN ('public.club_chat'::regclass,'public.club_posts'::regclass,'public.club_subs'::regclass,'storage.objects'::regclass)),
 'acl',(SELECT jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object('owner',p.proowner,'acl',p.proacl)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('club_chat_send_attachment','club_chat_has_access','club_chat_path_club'))
)