-- PREPARATION ONLY. Do not run without separate approval of pilot_club and recipient bound.
-- psql -v pilot_club=<approved UUID> -v max_recipients=<approved small bound> -f this.sql
-- Existing Edge handler must be installed and PUSH_CLUB_ENABLED=true first.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='3s';
SELECT set_config('mg.club_pilot', :'pilot_club', true);
SELECT set_config('mg.club_pilot_max', :'max_recipients', true);
DO $check$ DECLARE cid uuid:=current_setting('mg.club_pilot')::uuid; bound integer:=current_setting('mg.club_pilot_max')::integer; n integer; BEGIN
 IF bound<1 OR bound>10 THEN RAISE EXCEPTION 'Pilot recipient bound must be 1..10'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs WHERE id=cid) THEN RAISE EXCEPTION 'Pilot club not found'; END IF;
 SELECT count(DISTINCT suber) INTO n FROM public.club_subs WHERE club=cid AND active=true AND (end_date IS NULL OR end_date>=current_date);
 IF n>bound THEN RAISE EXCEPTION 'Pilot recipient bound exceeded'; END IF;
END $check$;
CREATE OR REPLACE TRIGGER trg_push_web_club_message BEFORE INSERT OR UPDATE ON public.club_chat FOR EACH ROW WHEN (NEW.club=:'pilot_club'::uuid) EXECUTE FUNCTION public.trg_push_web_club();
CREATE OR REPLACE TRIGGER trg_push_web_club_post BEFORE INSERT OR UPDATE ON public.club_posts FOR EACH ROW WHEN (NEW.club=:'pilot_club'::uuid) EXECUTE FUNCTION public.trg_push_web_club();
COMMIT;
-- Gate applies only to selected club, not all clubs. Recipient growth after this check
-- is not capped dynamically; use a controlled test club and disable after the smoke.
