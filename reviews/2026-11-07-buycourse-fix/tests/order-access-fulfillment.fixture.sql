-- SYNTHETIC ONLY: run with the isolated launcher, never against production.
do $$ begin
 if current_database()<>'mg_stream_visibility_test' or current_user<>'mg_fixture_admin'
 then raise exception 'isolated fixture database required'; end if;
end $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create table public."order" (
 id uuid primary key, created_at timestamptz default now(), owner uuid, paid boolean default false, payment_id text,
 course_positions text[], subscription boolean default false
);
create table public.users (id uuid primary key,"Ammount" numeric default 0,"authorCommission" numeric default 100);
create table public.course (id uuid primary key,owner uuid,"Title" text,"Category" text,"Free" boolean,"DurationLong" numeric);
create table public.shop (id uuid primary key,owner uuid,course_id uuid,price numeric);
create table public.sales (
 id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),
 "user" uuid,amount numeric,price numeric,position uuid,position_name text,position_category text
);
create table public.user_course (
 id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),
 "user" uuid,course uuid,"Free" boolean default false,buy boolean default false,
 end_period timestamptz,updated_at timestamptz default now()
);
create table public.payment_audit (id uuid primary key,order_id uuid,event text,detail jsonb);
create table public.test_purchase_notices(access_id uuid);
create table public.test_fail_course(course_id uuid primary key);
create function public.test_access_hooks() returns trigger language plpgsql as $$
begin
 if exists(select 1 from public.test_fail_course where course_id=NEW.course) then
  raise exception 'synthetic_access_failure';
 end if;
 if TG_OP='INSERT' and NEW.buy is true then
  insert into public.test_purchase_notices values(NEW.id);
 end if;
 return NEW;
end $$;
create trigger test_access_hooks after insert or update on public.user_course
for each row execute function public.test_access_hooks();
create table public.test_fail_author(author_id uuid primary key);
create function public.test_credit_failure() returns trigger language plpgsql as $$
begin
 if exists(select 1 from public.test_fail_author where author_id=NEW.id) then
  raise exception 'synthetic_credit_failure';
 end if;
 return NEW;
end $$;
create trigger test_credit_failure before update of "Ammount" on public.users
for each row execute function public.test_credit_failure();
\ir ../supabase/migrations/pending_order_access_fulfillment.sql
