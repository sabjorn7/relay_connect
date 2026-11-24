SELECT jsonb_build_object(
 'functions',(SELECT jsonb_object_agg(p.oid::regprocedure::text,pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('club_chat_capabilities','club_chat_send_attachment')),
 'policies',(SELECT jsonb_agg(to_jsonb(x) ORDER BY policyname) FROM (SELECT policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname IN ('club_private_upload','club_private_upload_guard')) x)
)