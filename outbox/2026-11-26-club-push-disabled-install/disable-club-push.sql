-- Only after a separately approved pilot; never changes ordinary chat triggers.
BEGIN;
SET LOCAL lock_timeout='3s';
ALTER TABLE public.club_chat DISABLE TRIGGER trg_push_web_club_message;
ALTER TABLE public.club_posts DISABLE TRIGGER trg_push_web_club_post;
COMMIT;
