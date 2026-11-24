-- Only after approved installation. Preserve data, columns and private bucket.
BEGIN;
ALTER TABLE public.club_chat DISABLE TRIGGER trg_push_web_club_message;
ALTER TABLE public.club_posts DISABLE TRIGGER trg_push_web_club_post;
CREATE OR REPLACE FUNCTION public.club_chat_capabilities() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT jsonb_build_object('attachments',false) $$;
COMMIT;
-- Also set PUSH_CLUB_ENABLED=false via the approved existing Edge configuration.
