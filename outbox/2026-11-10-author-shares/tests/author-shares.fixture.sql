-- Additional synthetic tables only. Loaded into existing loopback fixture.
alter table public.users add column "Name" text,add column email text;
alter table public.users alter column "authorCommission" set default 100;
revoke insert,update on public.users from authenticated,anon;
grant insert(id,role,"Name",email),update("Name") on public.users to authenticated;
create table public.admin_money_log(id uuid primary key default gen_random_uuid(),created_at timestamptz default now(),actor uuid,action text,target_user uuid,field text,old_value text,new_value text,amount numeric,ref_id uuid,reason text);
revoke all on public.admin_money_log from authenticated,anon;
create table public.clubs(id uuid primary key default gen_random_uuid(),owner uuid references public.users(id),title text,price numeric,active boolean default true,sub_id text);
create table public.club_subs(id uuid primary key default gen_random_uuid(),club uuid references public.clubs(id),suber uuid references public.users(id),active boolean default true,end_date date,customer_id text);
alter table public.sales add column sub boolean default false;
-- Synthetic seed rows prove backfill and financial history preservation.
insert into public.users(id,"Name",role,"authorCommission","Ammount") values
 ('10000000-0000-4000-8000-000000000001','Synthetic author','Спикер',82,123.45),
 ('10000000-0000-4000-8000-000000000002','Synthetic admin','admin',100,0),
 ('10000000-0000-4000-8000-000000000003','Synthetic buyer','Ученик',100,0);
insert into public."order"(id,owner,subscription,paid,payment_id,summ) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',true,true,'historical-fixture',1000),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',true,true,null,1000);
