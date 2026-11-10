-- SYNTHETIC ONLY, guarded by the disposable test database name.
do $$begin if current_database()<>'mg_stream_visibility_test' then raise exception 'disposable_fixture_required';end if;end$$;
create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
grant usage on schema auth to anon,authenticated,service_role;
create table public.users(id uuid primary key,role text,buied_courses uuid[],buied_course_orig uuid[],superadmin boolean default false,"Ammount" numeric default 0,"authorCommission" numeric default 82);
create table public.course(id uuid primary key default gen_random_uuid(),created_at timestamptz default now(),owner uuid references users(id),"Title" text,"Category" text,"Free" boolean default false,"Buy" boolean default true,"Price" numeric,"DurationLong" numeric default 0,"DurationPrice" numeric,"ModStatus" text default 'Опубликовано',old_price numeric);
create table public.chats(id uuid primary key default gen_random_uuid(),users uuid[],read uuid[]);
create table public.events(id uuid primary key default gen_random_uuid(),title text,owner uuid references users(id),status text default 'published',price numeric default 0,deposit_percent numeric,capacity integer,backing_course_id uuid references course(id),chat uuid references chats(id));
create table public.streams(id uuid primary key default gen_random_uuid(),title text,author uuid references users(id),price numeric default 0,status text default 'scheduled',visibility text default 'public',hidden boolean default false,backing_course_id uuid references course(id),created_at timestamptz default now(),scheduled_at timestamptz,access_months integer,chat uuid,chat_enabled boolean default false,recording_course uuid,recording_course_enabled boolean default false);
create table public."order"(id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),owner uuid references users(id),paid boolean default false,payment_id text,course_positions text[],subscription boolean default false,summ numeric,num text,"pageUrl" text,event_id uuid references events(id),promo_code_id uuid,promo_discount numeric);
create table public.shop(id uuid primary key default gen_random_uuid(),created_at timestamptz default now(),owner uuid references users(id),course_id uuid references course(id),price numeric,course_name text,quantity numeric default 1,status text,"order" uuid references public."order"(id),position numeric,prolong numeric,is_renewal boolean default false);
create table public.user_course(id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),"user" uuid references users(id),course uuid references course(id),"Free" boolean default false,buy boolean default false,end_period timestamptz,updated_at timestamptz default now());
create table public.sales(id uuid primary key default gen_random_uuid(),created_at timestamptz default now(),"user" uuid,amount numeric,price numeric,position uuid,position_name text,position_category text);
create table public.payment_audit(id uuid primary key default gen_random_uuid(),order_id uuid,event text,detail jsonb);
create table public.order_access_fulfillments(order_id uuid primary key references public."order"(id),payment_id text not null unique,proof_id uuid not null,completed_at timestamptz default now(),result jsonb);
create table public.event_registrations(id uuid primary key default gen_random_uuid(),created_at timestamptz default now(),event uuid references events(id),"user" uuid references users(id),payment_type text not null,amount_paid numeric,amount_total numeric,"order" uuid references public."order"(id),status text default 'pending',unique(event,"user"));
create table public.event_contact_requests(id uuid primary key default gen_random_uuid(),event uuid references events(id));
create table public.promo_codes(id uuid primary key default gen_random_uuid(),code text unique,discount_type text,discount_value numeric,scope_type text default 'all',scope_course_id uuid,usage_limit integer,used_count integer default 0,expires_at timestamptz);
create table public.promo_redemptions(id uuid primary key default gen_random_uuid(),promo_id uuid,user_id uuid,order_id uuid,amount_discounted numeric);
create function public.tg_order_paid_promo() returns trigger language plpgsql set search_path=public as $$begin
 update promo_codes set used_count=used_count+1 where id=NEW.promo_code_id and (usage_limit is null or used_count<usage_limit);
 insert into promo_redemptions(promo_id,user_id,order_id,amount_discounted) values(NEW.promo_code_id,NEW.owner,NEW.id,NEW.promo_discount);return NEW;end$$;
create trigger trg_order_paid_promo after update on public."order" for each row when(NEW.paid is true and OLD.paid is distinct from true and NEW.promo_code_id is not null) execute function tg_order_paid_promo();
grant select,insert,update,delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant select on course,events,streams to anon;
\ir checkout-legacy-fulfillment.sql
revoke all on function public.fulfill_paid_course_order(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fulfill_paid_course_order(uuid,text,uuid,jsonb) to service_role;
-- Failure/notification fixtures perform no external operations.
create table public.test_fail_credit(author_id uuid primary key);
create table public.test_notices(access_id uuid);
create function public.test_credit() returns trigger language plpgsql as $$begin if exists(select 1 from public.test_fail_credit where author_id=NEW.id) then raise exception 'synthetic_credit_failure';end if;return NEW;end$$;
create trigger test_credit before update of "Ammount" on users for each row execute function test_credit();
create function public.test_notice() returns trigger language plpgsql as $$begin insert into public.test_notices values(NEW.id);return NEW;end$$;
create trigger test_notice after insert on user_course for each row execute function test_notice();
