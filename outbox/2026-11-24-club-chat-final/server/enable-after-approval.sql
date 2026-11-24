-- REVIEW ONLY. Requires separate approval; never run as part of preparation.
-- Install the Edge handler first with the approved existing allowlist/settings.
BEGIN;
CREATE OR REPLACE FUNCTION public.club_chat_capabilities() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT jsonb_build_object('attachments',auth.uid() IS NOT NULL) $$;
ALTER TABLE public.club_chat ENABLE TRIGGER trg_push_web_club_message;
ALTER TABLE public.club_posts ENABLE TRIGGER trg_push_web_club_post;
COMMIT;
-- Club push additionally requires PUSH_CLUB_ENABLED=true in the existing Edge configuration.
