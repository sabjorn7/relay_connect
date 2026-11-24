-- REVIEW ONLY. Reuse pg_net/push_send_key/web-push-send. No new table/service.
BEGIN;
ALTER TABLE public.club_chat ADD COLUMN web_push_queued_at timestamptz;
ALTER TABLE public.club_posts ADD COLUMN web_push_queued_at timestamptz;
CREATE FUNCTION public.trg_push_web_club() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE secret text; payload jsonb;
BEGIN
 -- Client-provided/reset markers never bypass or repeat enqueue.
 IF TG_OP='UPDATE' THEN NEW.web_push_queued_at:=OLD.web_push_queued_at; ELSE NEW.web_push_queued_at:=NULL; END IF;
 IF NEW.web_push_queued_at IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='club_chat' THEN
  IF TG_OP<>'INSERT' OR NEW.deleted IS TRUE THEN RETURN NEW; END IF;
  payload:=jsonb_build_object('event','club_message','message_id',NEW.id);
 ELSE
  IF NEW.date_send IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN IF OLD.date_send IS NULL THEN RETURN NEW; END IF; END IF;
  payload:=jsonb_build_object('event','club_post','post_id',NEW.id);
 END IF;
 secret:=public.push_send_key();IF secret IS NULL OR secret='' THEN RETURN NEW; END IF;
 PERFORM net.http_post(url:='https://app.meetgu.ru/sb/functions/v1/web-push-send',headers:=jsonb_build_object('content-type','application/json','x-push-key',secret),body:=payload,timeout_milliseconds:=30000);
 NEW.web_push_queued_at:=clock_timestamp();RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 IF TG_OP='UPDATE' THEN NEW.web_push_queued_at:=OLD.web_push_queued_at; ELSE NEW.web_push_queued_at:=NULL; END IF;
 RAISE LOG 'club_push_enqueue_failed';RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.trg_push_web_club() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_push_web_club_message BEFORE INSERT OR UPDATE ON public.club_chat FOR EACH ROW EXECUTE FUNCTION public.trg_push_web_club();
CREATE TRIGGER trg_push_web_club_post BEFORE INSERT OR UPDATE ON public.club_posts FOR EACH ROW EXECUTE FUNCTION public.trg_push_web_club();
ALTER TABLE public.club_chat DISABLE TRIGGER trg_push_web_club_message;
ALTER TABLE public.club_posts DISABLE TRIGGER trg_push_web_club_post;
COMMIT;
