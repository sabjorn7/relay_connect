-- Rollback for 2026-10-30_pending_faq_table.sql.
--
-- ⚠️ Destructive: drops public.faq and everything in it. If an admin has already published real
-- FAQ rows via Supabase Studio or a future admin UI by the time this runs, take a snapshot first
-- (`select * from public.faq`) — this is NOT recoverable afterward.
--
-- Safe to run independently of the frontend rollback/rollforward state: FaqPage.vue's planned
-- read path falls back to its hardcoded CONTENT on ANY fetch error, including "relation
-- public.faq does not exist" — so rolling this back first, before redeploying the frontend,
-- does not break the live page.

begin;

drop trigger if exists faq_set_updated_at on public.faq;
drop function if exists public.faq_set_updated_at();
drop table if exists public.faq cascade;  -- cascade drops the two policies + the index with it

commit;
