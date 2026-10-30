-- PENDING REVIEW — NOT APPLIED. Do not run until confirmed.
--
-- New table public.faq — backs the planned FAQ CMS (see faq-02-edit-and-structure.md /
-- faq-04-cms-plan.md in expert-guides/faq). Pure ADDITION: no existing table/column/policy
-- touched. Safe to apply in isolation — nothing reads from this table yet (FaqPage.vue still
-- serves its hardcoded CONTENT until the frontend change ships separately), so applying this
-- alone has ZERO visible effect on the live site.
--
-- Columns beyond what was asked for `audience/category/lang/question/answer/sort/published/
-- updated_at`: `id` (pk) and `created_at` — every table in this schema has both, added here for
-- consistency, not a scope change.
--
-- RLS posture (this project is normally RLS-off + SECURITY DEFINER admin RPCs — see
-- admin_approve_course / admin_create_promo for the house style — but FAQ needs a genuinely
-- PUBLIC, unauthenticated read, which plain RLS policies model directly). Pattern below mirrors
-- pending_users_rls.sql / pending_chats_messages_rls.sql: enable RLS, reset to a known-empty
-- grant baseline, then grant back exactly what's needed:
--   - SELECT: anon + authenticated, but only rows with published = true (RLS policy).
--   - INSERT/UPDATE/DELETE: authenticated only at the table-grant level, further restricted by
--     an RLS policy to rows where the caller is admin (public.users.role='admin' OR
--     superadmin=true) — same admin check used by every admin_* RPC in this codebase.
--   - service_role is intentionally NOT granted anything here: Supabase's service_role carries
--     BYPASSRLS, so it can already read/write every row regardless of the policies below. No
--     separate grant needed or added.
--
-- Open question for review: `answer` is expected to hold the same inline HTML the current
-- hardcoded CONTENT uses (`<a href="/oferta">…</a>`, `<strong>…</strong>`) — FaqPage.vue's
-- planned read path should sanitize this with DOMPurify before v-html (same defensive posture
-- as the cheatsheet feature), even though the writer is always an admin. Not enforced at the DB
-- layer here; flagging so it isn't missed in the frontend plan.

begin;

create table if not exists public.faq (
  id          uuid primary key default gen_random_uuid(),
  audience    text not null check (audience in ('students','experts')),
  category    text not null,
  lang        text not null default 'ru' check (lang in ('ru','en')),
  question    text not null,
  answer      text not null,
  sort        integer not null default 0,
  published   boolean not null default false,  -- draft by default; admin flips on to go live
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Typical page query: one audience + one lang + published only, ordered by sort.
create index if not exists faq_audience_lang_published_idx
  on public.faq (audience, lang, published, sort);

-- Keep updated_at honest even for direct edits via Supabase Studio (faq-02-edit-and-structure.md
-- option B) where nothing else would touch it.
create or replace function public.faq_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists faq_set_updated_at on public.faq;
create trigger faq_set_updated_at
  before update on public.faq
  for each row execute function public.faq_set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.faq enable row level security;

revoke all on public.faq from anon, authenticated;

grant select on public.faq to anon, authenticated;

create policy "faq_select_published"
  on public.faq
  for select
  to anon, authenticated
  using (published = true);

-- Table-level grant is a prerequisite for the policy below to even be reachable by
-- authenticated — anon gets no insert/update/delete grant at all, so it can never write
-- regardless of policy.
grant insert, update, delete on public.faq to authenticated;

create policy "faq_write_admin"
  on public.faq
  for all
  to authenticated
  using (
    exists (select 1 from public.users where id = auth.uid() and (role = 'admin' or superadmin is true))
  )
  with check (
    exists (select 1 from public.users where id = auth.uid() and (role = 'admin' or superadmin is true))
  );

commit;
