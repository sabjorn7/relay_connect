-- OWNER MANUAL ONLY. Apply with the coordinated API/frontend cutover, never via deploy/MCP.
-- Existing shop/order are the only cart/payment order. New tables are immutable order ledger only; no seat-capacity or booking system.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin
 if md5(pg_get_functiondef('public.fulfill_paid_course_order(uuid,text,uuid,jsonb)'::regprocedure))<> '92ce4015709920ea22fa7fcff27aba80' then raise exception 'fulfillment_baseline_changed_review_required';end if;
end$$;
create schema checkout_private;
revoke all on schema checkout_private from public,anon,authenticated,service_role;
alter table public.shop add column product_type text check(product_type in ('course','event','stream'));
alter table public.shop add column product_id uuid;
alter table public.shop add column payment_type text check(payment_type in ('full','deposit'));
alter table public.shop add column terms_accepted boolean not null default false;
alter table public."order" add column checkout_version integer;
alter table public.order_access_fulfillments alter column proof_id drop not null;
create table checkout_private.orders (
 order_id uuid primary key references public."order"(id), owner_id uuid not null references public.users(id),
 request_id uuid not null, created_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','cancelled','fulfilled')),
 promo_id uuid, promo_code text, discount numeric not null, total numeric not null check(total>=0),
 lease_id uuid, lease_until timestamptz, pay_link text,
 unique(owner_id,request_id)
);
create table checkout_private.items (
 order_id uuid not null references checkout_private.orders(order_id), shop_id uuid not null references public.shop(id),
 product_type text not null check(product_type in ('course','event','stream')),product_id uuid not null,
 course_id uuid not null references public.course(id),name text not null,payment_type text not null,
 base_price numeric not null,price numeric not null check(price>=0),amount_total numeric not null,
 is_renewal boolean not null,primary key(order_id,shop_id),unique(shop_id)
);
alter table checkout_private.orders enable row level security;
alter table checkout_private.items enable row level security;
revoke all on all tables in schema checkout_private from public,anon,authenticated,service_role;

create function checkout_private.lock_all() returns void language sql volatile as $$
 select pg_advisory_xact_lock(hashtextextended('meetguru-unified-checkout-v1',0))
$$;
create function checkout_private.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.users where id=auth.uid() and (role='admin' or superadmin is true))
$$;
create function checkout_private.product(p_type text,p_id uuid,p_payment text,p_renewal boolean,p_uid uuid,p_check_owned boolean default true)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare c public.course%rowtype;e public.events%rowtype;s public.streams%rowtype;v_course uuid;
 v_name text;v_price numeric;v_total numeric;v_at timestamp;v_end timestamptz;
begin
 if p_uid is null then raise exception 'auth_required' using errcode='42501';end if;
 if p_type not in ('course','event','stream') or p_type is null or p_payment not in ('full','deposit') or p_payment is null then raise exception 'bad_product';end if;
 if p_type<>'event' and p_payment<>'full' then raise exception 'bad_payment_type';end if;
 if p_type<>'course' and p_renewal then raise exception 'bad_renewal';end if;
 if p_type='course' then
  select * into c from public.course where id=p_id for share;
  if not found or c."ModStatus" is distinct from 'Опубликовано' or c."Free" is true or c."Buy" is not true
     or exists(select 1 from public.events where backing_course_id=p_id)
     or exists(select 1 from public.streams where backing_course_id=p_id) then raise exception 'product_not_available';end if;
  if p_renewal then
   if not exists(select 1 from public.user_course where "user"=p_uid and course=p_id and (buy is true or "Free" is true)) then raise exception 'not_owned';end if;
   v_price:=c."DurationPrice";
  else
   if p_check_owned and exists(select 1 from public.user_course where "user"=p_uid and course=p_id and (buy is true or "Free" is true)) then raise exception 'already_owned';end if;
   v_price:=c."Price";
  end if;
  v_course:=c.id;v_name:=c."Title";v_total:=v_price;
 elsif p_type='event' then
  select * into e from public.events where id=p_id for share;
  if not found or e.status<>'published' or e.backing_course_id is null then raise exception 'product_not_available';end if;
  if p_check_owned and exists(select 1 from public.event_registrations where event=p_id and "user"=p_uid and status='paid') then raise exception 'already_registered';end if;
  v_price:=e.price;v_total:=e.price;v_course:=e.backing_course_id;v_name:=e.title;
  if p_payment='deposit' then
   if e.deposit_percent is null or e.deposit_percent<=0 or e.deposit_percent>100 then raise exception 'deposit_unavailable';end if;
   v_price:=round(e.price*e.deposit_percent/100);
  end if;
 else
  select * into s from public.streams where id=p_id for share;
  if not found or s.hidden is true or s.visibility<>'public' or s.backing_course_id is null then raise exception 'product_not_available';end if;
  if s.access_months is not null and s.access_months>0 then
   v_at:=coalesce(s.scheduled_at,s.created_at) at time zone 'UTC';
   v_end:=(date_trunc('month',v_at)+make_interval(months=>s.access_months)+(extract(day from v_at)::integer-1)*interval '1 day'+(v_at-date_trunc('day',v_at))) at time zone 'UTC';
   if v_end<=clock_timestamp() then raise exception 'stream_access_ended';end if;
  end if;
  if p_check_owned and exists(select 1 from public.user_course where "user"=p_uid and course=s.backing_course_id and (buy is true or "Free" is true)) then raise exception 'already_owned';end if;
  v_price:=s.price;v_total:=s.price;v_course:=s.backing_course_id;v_name:=s.title;
 end if;
 if v_price is null or v_price<=0 or v_price<>round(v_price,2) then raise exception 'not_a_paid_product';end if;
 if not exists(select 1 from public.course where id=v_course and owner is not null) then raise exception 'no_backing_author';end if;
 return jsonb_build_object('product_type',p_type,'product_id',p_id,'course_id',v_course,'course_name',v_name,
  'payment_type',p_payment,'base_price',v_price,'price',v_price,'amount_total',v_total,'is_renewal',p_renewal,'quantity',1);
end$$;
create function public.checkout_prepare(p_request_id uuid,p_shop_ids uuid[],p_code text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare u uuid:=auth.uid();o checkout_private.orders%rowtype;q jsonb;j jsonb;ts timestamptz;oid uuid;s public.shop%rowtype;
begin
 if u is null then raise exception 'auth_required' using errcode='42501';end if;
 if p_request_id is null then raise exception 'request_id_required';end if;
 perform checkout_private.lock_all();
 select * into o from checkout_private.orders where owner_id=u and request_id=p_request_id for update;
 if found then
  if (select array_agg(i.shop_id order by i.shop_id) from checkout_private.items i where i.order_id=o.order_id) is distinct from (select array_agg(v order by v) from unnest(p_shop_ids) v)
    or coalesce(o.promo_code,'')<>upper(btrim(coalesce(p_code,''))) then raise exception 'request_payload_changed';end if;
  return jsonb_build_object('order_id',o.order_id,'total',o.total,'status',o.status,'reused',true);
 end if;
 -- Also deduplicate a lost browser intent: the same exact positions cannot acquire a second order.
 select x.* into o from checkout_private.orders x where x.owner_id=u and
  (select array_agg(i.shop_id order by i.shop_id) from checkout_private.items i where i.order_id=x.order_id)=(select array_agg(v order by v) from unnest(p_shop_ids) v)
  and coalesce(x.promo_code,'')=upper(btrim(coalesce(p_code,''))) order by x.created_at desc limit 1;
 if found then return jsonb_build_object('order_id',o.order_id,'total',o.total,'status',o.status,'reused',true);end if;
 perform 1 from public.shop where owner=u and id=any(p_shop_ids) order by id for update;
 q:=public.cart_quote(p_shop_ids,p_code);
 if q->>'valid'<>'true' then raise exception 'promo_%',q->>'reason';end if;
 if (q->>'promo_id') is not null then perform 1 from public.promo_codes where id=(q->>'promo_id')::uuid for update;end if;
 for j in select value from jsonb_array_elements(q->'lines') order by value->>'product_id' loop
  if j->>'product_type'='event' then
   select * into s from public.shop where id=(j->>'id')::uuid;
   if not s.terms_accepted then raise exception 'terms_required';end if;
  end if;
 end loop;
 ts:=clock_timestamp();oid:=gen_random_uuid();
 -- order.course_positions is text[] in production. Backing courses keep BuyCourse compatible.
 insert into public."order"(id,created_at,owner,summ,course_positions,num,checkout_version,promo_code_id,promo_discount)
 values(oid,ts,u,(q->>'new_total')::numeric,p_shop_ids::text[],oid::text,1,(q->>'promo_id')::uuid,(q->>'discount')::numeric);
 insert into checkout_private.orders(order_id,owner_id,request_id,created_at,total,discount,promo_id,promo_code)
 values(oid,u,p_request_id,ts,(q->>'new_total')::numeric,(q->>'discount')::numeric,(q->>'promo_id')::uuid,q->>'code');
 for j in select value from jsonb_array_elements(q->'lines') loop
  insert into checkout_private.items(order_id,shop_id,product_type,product_id,course_id,name,payment_type,base_price,price,amount_total,is_renewal)
  values(oid,(j->>'id')::uuid,j->>'product_type',(j->>'product_id')::uuid,(j->>'course_id')::uuid,j->>'course_name',j->>'payment_type',(j->>'base_price')::numeric,(j->>'price')::numeric,(j->>'amount_total')::numeric,(j->>'is_renewal')::boolean);
  update public.shop set price=(j->>'price')::numeric,course_id=(j->>'course_id')::uuid,course_name=j->>'course_name',
   product_type=j->>'product_type',product_id=(j->>'product_id')::uuid,payment_type=j->>'payment_type',"order"=oid,status='order',quantity=1 where id=(j->>'id')::uuid;
 end loop;
 return jsonb_build_object('order_id',oid,'total',(q->>'new_total')::numeric,'status','pending','reused',false);
end$$;
create function public.checkout_cancel(p_order_id uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform checkout_private.lock_all();
 if auth.uid() is null or not exists(select 1 from checkout_private.orders where order_id=p_order_id and owner_id=auth.uid()) then raise exception 'not_owner' using errcode='42501';end if;
 update checkout_private.orders set status='cancelled' where order_id=p_order_id and status='pending';
 -- Does not reverse a provider payment. A later verified success still settles the entire order.
end$$;
create function public.checkout_my_orders() returns jsonb language sql security definer set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from
 (select o.order_id,o.created_at,o.total,o.status,
  (select jsonb_agg(jsonb_build_object('name',i.name,'product_type',i.product_type,'price',i.price)) from checkout_private.items i where i.order_id=o.order_id) items
  from checkout_private.orders o where o.owner_id=auth.uid()
  union all
  select old.id,old.created_at,old.summ,'legacy_pending',
   (select jsonb_agg(jsonb_build_object('name',sh.course_name,'product_type','legacy','price',sh.price)) from public.shop sh where sh.id::text=any(old.course_positions))
   from public."order" old where old.owner=auth.uid() and old.paid is not true and old."pageUrl" is not null
    and not exists(select 1 from checkout_private.orders x where x.order_id=old.id)
  order by created_at desc limit 20) x
$$;
-- Service-only bridge for the ONE existing provider. No lease/order/price token goes to a browser.
create function public.checkout_acquire_link(p_order_id uuid,p_actor_id uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare o checkout_private.orders%rowtype;legacy public."order"%rowtype;
begin
 select * into o from checkout_private.orders where order_id=p_order_id for update;
 if not found then
  select * into legacy from public."order" where id=p_order_id;
  if not found or legacy.owner is distinct from p_actor_id then raise exception 'not_owner' using errcode='42501';end if;
  if legacy.paid is true then return jsonb_build_object('completed',true,'order_id',p_order_id);end if;
  if legacy."pageUrl" ~ '^https://meetguru[.]payform[.]ru([/?#]|$)' then return jsonb_build_object('payLink',legacy."pageUrl",'order_id',p_order_id);end if;
  raise exception 'legacy_link_unavailable';
 end if;
 if o.owner_id is distinct from p_actor_id then raise exception 'not_owner' using errcode='42501';end if;
 if o.status='fulfilled' then return jsonb_build_object('completed',true,'order_id',o.order_id);end if;
 if o.status<>'pending' then raise exception 'checkout_%',o.status;end if;
 if o.total=0 then return jsonb_build_object('zero',true,'order_id',o.order_id);end if;
 if o.pay_link is not null then return jsonb_build_object('payLink',o.pay_link,'order_id',o.order_id);end if;
 if o.lease_until>clock_timestamp() then raise exception 'payment_link_in_progress';end if;
 update checkout_private.orders set lease_id=p_lease,lease_until=clock_timestamp()+interval '30 seconds' where order_id=p_order_id;
 return jsonb_build_object('order_id',o.order_id,'total',o.total,'lines',(select jsonb_agg(jsonb_build_object('name',name,'price',price,'quantity',1) order by shop_id) from checkout_private.items where order_id=p_order_id));
end$$;
create function public.checkout_store_link(p_order_id uuid,p_actor_id uuid,p_lease uuid,p_link text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_link !~ '^https://meetguru[.]payform[.]ru([/?#]|$)' then raise exception 'invalid_payment_link';end if;
 update checkout_private.orders set pay_link=p_link,lease_until=null where order_id=p_order_id and owner_id=p_actor_id and lease_id=p_lease and status='pending';
 if not found then raise exception 'payment_link_lease_lost';end if;
 update public."order" set "pageUrl"=p_link where id=p_order_id;
end$$;
create function checkout_private.finish_products(p_order uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare i record;u uuid;chat_id uuid;recording uuid;
begin
 select owner_id into u from checkout_private.orders where order_id=p_order;
 if not found then return;end if;
 for i in select * from checkout_private.items where order_id=p_order order by product_id loop
  if i.product_type='event' then
   insert into public.event_registrations(event,"user",payment_type,amount_paid,amount_total,"order",status)
    values(i.product_id,u,i.payment_type,i.price,i.amount_total,p_order,'paid')
    on conflict(event,"user") do update set payment_type=excluded.payment_type,amount_paid=excluded.amount_paid,
     amount_total=excluded.amount_total,"order"=excluded."order",status='paid';
   select chat into chat_id from public.events where id=i.product_id;
  elsif i.product_type='stream' then
   select case when chat_enabled then chat end,case when recording_course_enabled then recording_course end into chat_id,recording from public.streams where id=i.product_id;
   -- Reconcile optional artifacts for an UPDATE of an old buy=false row as well as INSERT.
   if recording is not null and not exists(select 1 from public.user_course where "user"=u and course=recording) then
    insert into public.user_course("user",course,"Free",buy) values(u,recording,true,true);
   end if;
  else chat_id:=null;
  end if;
  if chat_id is not null then
   update public.chats set users=array_append(coalesce(users,'{}'::uuid[]),u),read=array_append(coalesce(read,'{}'::uuid[]),u)
    where id=chat_id and not(u=any(coalesce(users,'{}'::uuid[])));
  end if;
 end loop;
 update checkout_private.orders set status='fulfilled',lease_id=null,lease_until=null where order_id=p_order;
end$$;
create function public.checkout_register_free_event(p_event_id uuid,p_agreed boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.events%rowtype;u uuid:=auth.uid();
begin
 if u is null or not p_agreed then raise exception 'auth_and_terms_required';end if;
 perform checkout_private.lock_all();select * into e from public.events where id=p_event_id and status='published' and price=0 for update;
 if not found then raise exception 'not_a_free_event';end if;
 if exists(select 1 from public.event_registrations where event=e.id and "user"=u and status='paid') then return;end if;
 insert into public.event_registrations(event,"user",payment_type,amount_paid,amount_total,status) values(e.id,u,'full',0,0,'paid')
 on conflict(event,"user") do update set status='paid',payment_type='full',amount_paid=0,amount_total=0;
 if e.chat is not null then update public.chats set users=array_append(coalesce(users,'{}'::uuid[]),u),read=array_append(coalesce(read,'{}'::uuid[]),u)
  where id=e.chat and not(u=any(coalesce(users,'{}'::uuid[])));end if;
end$$;
create function public.checkout_enroll_free_course(p_course_id uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare u uuid:=auth.uid();access_id uuid;
begin
 if u is null then raise exception 'auth_required' using errcode='42501';end if;
 perform checkout_private.lock_all();
 if not exists(select 1 from public.course where id=p_course_id and "Free" is true and "ModStatus"='Опубликовано') then raise exception 'not_a_free_course';end if;
 select id into access_id from public.user_course where "user"=u and course=p_course_id order by created_at limit 1 for update;
 if not found then insert into public.user_course("user",course,"Free") values(u,p_course_id,true) returning id into access_id;
 else update public.user_course set "Free"=true where id=access_id;end if;
 update public.users set buied_courses=case when access_id=any(coalesce(buied_courses,'{}'::uuid[])) then buied_courses else array_append(coalesce(buied_courses,'{}'::uuid[]),access_id) end,
  buied_course_orig=case when p_course_id=any(coalesce(buied_course_orig,'{}'::uuid[])) then buied_course_orig else array_append(coalesce(buied_course_orig,'{}'::uuid[]),p_course_id) end where id=u;
 return access_id;
end$$;
create function checkout_private.resolve_row(p_shop public.shop,p_uid uuid) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_type text:=p_shop.product_type;v_id uuid:=p_shop.product_id;v_count integer;v_matches jsonb;
begin
 if p_shop.owner is distinct from p_uid then raise exception 'not_owner' using errcode='42501';end if;
 if coalesce(p_shop.quantity,1)<>1 then raise exception 'unsupported_quantity';end if;
 if v_type is null then
  select count(*),jsonb_agg(to_jsonb(x)) into v_count,v_matches from
   (select 'event' kind,id from public.events where backing_course_id=p_shop.course_id union all
    select 'stream',id from public.streams where backing_course_id=p_shop.course_id) x;
  if v_count>1 then raise exception 'ambiguous_product';end if;
  if v_count=1 then v_type:=v_matches->0->>'kind';v_id:=(v_matches->0->>'id')::uuid;
  else v_type:='course';v_id:=p_shop.course_id;end if;
 end if;
 return checkout_private.product(v_type,v_id,coalesce(p_shop.payment_type,'full'),coalesce(p_shop.is_renewal,false),p_uid)||jsonb_build_object('id',p_shop.id);
end$$;
create function public.cart_add_product(p_type text,p_product_id uuid,p_payment_type text default 'full',p_renewal boolean default false,p_agreed boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare u uuid:=auth.uid();v jsonb;r public.shop%rowtype;n uuid;
begin
 perform checkout_private.lock_all();
 v:=checkout_private.product(p_type,p_product_id,p_payment_type,p_renewal,u);
 if p_type='event' and p_agreed is not true then raise exception 'terms_required';end if;
 for r in select * from public.shop where owner=u and status='cart' order by id for update loop
  if (r.product_type=p_type and r.product_id=p_product_id) or (r.product_type is null and r.course_id=(v->>'course_id')::uuid) then
   update public.shop set product_type=p_type,product_id=p_product_id,payment_type=p_payment_type,is_renewal=p_renewal,
    price=(v->>'price')::numeric,course_name=v->>'course_name',terms_accepted=p_agreed where id=r.id;
   return v||jsonb_build_object('id',r.id,'reused',true);
  end if;
 end loop;
 if exists(select 1 from checkout_private.items i join checkout_private.orders o on o.order_id=i.order_id
   where o.owner_id=u and o.status='pending' and i.product_type=p_type and i.product_id=p_product_id) then raise exception 'product_already_in_pending_order';end if;
 insert into public.shop(owner,course_id,course_name,price,quantity,status,position,prolong,is_renewal,product_type,product_id,payment_type,terms_accepted)
 values(u,(v->>'course_id')::uuid,v->>'course_name',(v->>'price')::numeric,1,'cart',
  (select count(*)+1 from public.shop where owner=u and status='cart'),12,p_renewal,p_type,p_product_id,p_payment_type,p_agreed) returning id into n;
 return v||jsonb_build_object('id',n,'reused',false);
end$$;
create function public.cart_get() returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.shop%rowtype;v jsonb;out jsonb:='[]';u uuid:=auth.uid();
begin
 if u is null then raise exception 'auth_required' using errcode='42501';end if;
 for r in select * from public.shop where owner=u and status='cart' order by created_at,id loop
  begin v:=checkout_private.resolve_row(r,u)||jsonb_build_object('available',true);
  exception when others then v:=jsonb_build_object('id',r.id,'course_name',r.course_name,'product_type',coalesce(r.product_type,'course'),'price',r.price,'available',false,'reason',sqlerrm);end;
  out:=out||jsonb_build_array(v);
 end loop;
 return out;
end$$;
create function public.cart_remove(p_shop_id uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.uid() is null then raise exception 'auth_required' using errcode='42501';end if;
 perform checkout_private.lock_all();
 delete from public.shop where id=p_shop_id and owner=auth.uid() and status='cart';
end$$;
create function public.cart_quote(p_shop_ids uuid[],p_code text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare u uuid:=auth.uid();r public.shop%rowtype;v jsonb;ls jsonb:='[]';p public.promo_codes%rowtype;
 total numeric:=0;eligible numeric:=0;disc numeric:=0;v_code text:=upper(btrim(coalesce(p_code,'')));
begin
 if u is null then raise exception 'auth_required' using errcode='42501';end if;
 if coalesce(cardinality(p_shop_ids),0)=0 or cardinality(p_shop_ids)>100 or cardinality(p_shop_ids)<>(select count(distinct x) from unnest(p_shop_ids) x) then raise exception 'bad_cart';end if;
 for r in select * from public.shop where id=any(p_shop_ids) and owner=u and status='cart' order by id loop
  v:=checkout_private.resolve_row(r,u);ls:=ls||jsonb_build_array(v);total:=total+(v->>'price')::numeric;
 end loop;
 if jsonb_array_length(ls)<>cardinality(p_shop_ids) then raise exception 'cart_changed_or_not_owner';end if;
 if v_code<>'' then
  select * into p from public.promo_codes where upper(promo_codes.code)=v_code;
  if not found then return jsonb_build_object('valid',false,'reason','not_found');end if;
  if p.expires_at is not null and p.expires_at<clock_timestamp() then return jsonb_build_object('valid',false,'reason','expired');end if;
  if p.usage_limit is not null and p.used_count>=p.usage_limit then return jsonb_build_object('valid',false,'reason','limit_reached');end if;
  select coalesce(sum((j->>'price')::numeric),0) into eligible from jsonb_array_elements(ls) j
   where j->>'payment_type'<>'deposit' and (p.scope_type='all' or (j->>'course_id')::uuid=p.scope_course_id);
  if eligible<=0 then return jsonb_build_object('valid',false,'reason','not_applicable');end if;
  disc:=case when p.discount_type='percent' then round(eligible*p.discount_value/100,2) else least(eligible,p.discount_value) end;
  disc:=round(disc,2);
  if disc<0 or disc>eligible then raise exception 'invalid_promo_configuration';end if;
  -- Largest-remainder allocation, in kopecks: exact sum, no repeated discount, no negative line.
  with a as (select j,case when j->>'payment_type'<>'deposit' and (p.scope_type='all' or (j->>'course_id')::uuid=p.scope_course_id) then (j->>'price')::numeric else 0 end weight from jsonb_array_elements(ls) j),
  b as (select *,floor(disc*100*weight/eligible) cut,disc*100*weight/eligible-floor(disc*100*weight/eligible) rem from a),
  c as (select *,row_number() over(order by rem desc,j->>'id') rn,sum(cut) over() all_cut from b)
  select jsonb_agg(j||jsonb_build_object('price',(j->>'price')::numeric-(cut+case when rn<=disc*100-all_cut then 1 else 0 end)/100) order by j->>'id') into ls from c;
 end if;
 return jsonb_build_object('valid',true,'code',nullif(v_code,''),'promo_id',p.id,'discount',disc,'cart_total',total,'new_total',total-disc,'lines',ls);
end$$;

create function checkout_private.validate_snapshot(p_order uuid,p_plan jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare o checkout_private.orders%rowtype;r public."order"%rowtype;i record;
begin
 select * into r from public."order" where id=p_order for update;
 select * into o from checkout_private.orders where order_id=p_order for update;
 if not found then return;end if;
 if o.total is distinct from r.summ or jsonb_array_length(p_plan)<>(select count(*) from checkout_private.items where order_id=p_order)
  or exists(select 1 from checkout_private.items x left join public.shop sh on sh.id=x.shop_id
    where x.order_id=p_order and (sh.owner is distinct from o.owner_id or sh.course_id is distinct from x.course_id or sh.price is distinct from x.price or sh.quantity is distinct from 1 or sh."order" is distinct from p_order))
  or exists(select 1 from checkout_private.items x where x.order_id=p_order and x.shop_id::text<>all(r.course_positions)) then raise exception 'immutable_order_mismatch';end if;
 -- Registration uniqueness is existing business logic, not a capacity/reservation rule.
 for i in select * from checkout_private.items where order_id=p_order loop
  if i.product_type='event' and exists(select 1 from public.event_registrations where event=i.product_id and "user"=o.owner_id and status='paid') then raise exception 'already_registered_at_payment';end if;
  if i.product_type<>'event' and not i.is_renewal and exists(select 1 from public.user_course where "user"=o.owner_id and course=i.course_id and (buy is true or "Free" is true)) then raise exception 'duplicate_purchase_requires_review';end if;
 end loop;
end$$;

-- GENERATED FULFILLMENT: scripts/generate-unified-fulfillment.mjs
CREATE OR REPLACE FUNCTION public.fulfill_paid_course_order(p_order_id uuid, p_payment_id text, p_proof_id uuid, p_access_plan jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
    v_order public."order"%rowtype;
    v_receipt public.order_access_fulfillments%rowtype;
    v_shop public.shop%rowtype;
    v_course public.course%rowtype;
    v_author public.users%rowtype;
    v_access public.user_course%rowtype;
    v_item record;
    v_credit record;
    v_access_count integer;
    v_created integer := 0;
    v_updated integer := 0;
    v_result jsonb := '[]'::jsonb;
    v_zero boolean := false;
    v_credits jsonb := '[]'::jsonb;
    v_sale_id uuid;
    v_now timestamptz := transaction_timestamp();
    v_base timestamptz;
    v_local timestamp;
    v_end timestamptz;
    v_months integer;
    v_amount numeric;
begin
    if nullif(btrim(p_payment_id),'') is null then
        raise exception 'payment_id_required' using errcode='22023';
    end if;
    perform checkout_private.lock_all();
    select * into v_order from public."order" where id=p_order_id for update;
    if not found then raise exception 'order_not_found' using errcode='22023'; end if;
    v_zero := p_proof_id is null and p_payment_id='zero:'||p_order_id::text and exists(
      select 1 from checkout_private.orders where order_id=p_order_id and total=0);
    if v_order.checkout_version=1 and not v_zero then
      perform 1 from public.payment_audit a where a.id=p_proof_id and a.order_id=p_order_id and a.event='ok'
       and a.detail->>'sig_valid'='true' and a.detail->>'payment_status'='success' and a.detail->'verify'->>'ok'='true' for share;
      if not found then raise exception 'verified_success_required' using errcode='42501';end if;
    end if;
    select * into v_receipt from public.order_access_fulfillments where order_id=p_order_id;
    if found then
        if v_receipt.payment_id is distinct from p_payment_id
           or v_order.payment_id is distinct from p_payment_id or v_order.paid is not true then
            raise exception 'completed_order_state_changed' using errcode='22023';
        end if;
        return jsonb_build_object('status','already_completed','order_id',p_order_id);
    end if;
    -- Never auto-reprocess historical paid orders, including manual repairs.
    if v_order.paid is true then
        return jsonb_build_object('status','legacy_paid_skipped','order_id',p_order_id);
    end if;
    if v_order.owner is null or v_order.subscription is true then
        raise exception 'not_a_course_order' using errcode='22023';
    end if;
    if not v_zero then
    perform 1 from public.payment_audit a
      where a.id=p_proof_id and a.order_id=p_order_id and a.event='ok'
        and a.detail->>'sig_valid'='true'
        and a.detail->>'payment_status'='success'
        and a.detail->'verify'->>'ok'='true'
      for share;
    if not found then raise exception 'verified_success_required' using errcode='42501'; end if;
    end if;
    if jsonb_typeof(p_access_plan) is distinct from 'array'
       or coalesce(cardinality(v_order.course_positions),0)=0
       or jsonb_array_length(p_access_plan)<>cardinality(v_order.course_positions) then
        raise exception 'incomplete_access_plan' using errcode='22023';
    end if;
    if (select count(distinct x.shop_id) from jsonb_to_recordset(p_access_plan) x(shop_id uuid))
       <>cardinality(v_order.course_positions) then
        raise exception 'duplicate_or_missing_position' using errcode='22023';
    end if;

    perform checkout_private.validate_snapshot(p_order_id,p_access_plan);
    -- Lock all credited authors in a stable order. Different orders cannot overwrite
    -- each other's balances. No balance value supplied by the workflow is trusted.
    perform u.id from public.users u
      where u.id in (select x.author_id from jsonb_to_recordset(p_access_plan) x(author_id uuid))
      order by u.id for update;

    for v_item in
      select * from jsonb_to_recordset(p_access_plan)
        x(shop_id uuid,course_id uuid,author_id uuid,price numeric,author_commission numeric,author_amount text)
      order by course_id,shop_id
    loop
        select * into v_shop from public.shop where id=v_item.shop_id for share;
        if not found or v_shop.id::text<>all(v_order.course_positions::text[])
           or v_shop.owner is distinct from v_order.owner
           or v_shop.course_id is distinct from v_item.course_id
           or v_shop.price is distinct from v_item.price then
            raise exception 'position_buyer_course_or_price_mismatch' using errcode='22023';
        end if;
        select * into v_course from public.course where id=v_shop.course_id for share;
        if not found or v_course.owner is distinct from v_item.author_id then
            raise exception 'course_author_mismatch' using errcode='22023';
        end if;
        select * into v_author from public.users where id=v_course.owner;
        if not found or v_author."authorCommission" is distinct from v_item.author_commission then
            raise exception 'author_commission_changed' using errcode='22023';
        end if;
        if v_item.author_amount is null or v_item.author_amount !~ '^-?[0-9]+[.][0-9]{2}$' then
            raise exception 'invalid_author_amount' using errcode='22023';
        end if;
        -- The trusted n8n Code preserves EXACT production JS (price*rate/100).toFixed(2).
        -- Numeric round() is deliberately NOT substituted: ties such as 1.005 differ.
        -- Check the locked price/rate and rounding envelope; never accept a browser plan.
        v_amount := v_item.author_amount::numeric;
        if abs(v_amount-coalesce(v_shop.price,0)*coalesce(v_author."authorCommission",0)/100)>0.00500001 then
            raise exception 'author_amount_outside_rounding_envelope' using errcode='22023';
        end if;
        -- Do not silently duplicate a sale left by a legacy/in-flight handler.
        -- Older sales for a legitimately reused shop position belong to older orders.
        if exists(select 1 from public.sales s where s.position=v_shop.id and s.created_at>=v_order.created_at) then
            raise exception 'unreceipted_sale_requires_review' using errcode='22023';
        end if;
        if coalesce(v_course."DurationLong",0)<0
           or coalesce(v_course."DurationLong",0)<>trunc(coalesce(v_course."DurationLong",0)) then
            raise exception 'unsupported_duration' using errcode='22023';
        end if;
        v_months := coalesce(v_course."DurationLong",0)::integer;

        -- One entitlement per distinct course, even if two paid shop positions
        -- refer to the same course. Each position still receives its own sale.
        if not exists(select 1 from jsonb_array_elements(v_result) j where j->>'course_id'=v_course.id::text) then
            perform pg_advisory_xact_lock(hashtextextended(
                'order-access:'||v_order.owner::text||':'||v_course.id::text,0));
            select count(*) into v_access_count from public.user_course
              where "user"=v_order.owner and course=v_course.id;
            if v_access_count>1 then
                raise exception 'ambiguous_existing_access' using errcode='22023';
            end if;
            v_access := null;
            if v_access_count=1 then
                select * into v_access from public.user_course
                  where "user"=v_order.owner and course=v_course.id for update;
            end if;
            if v_months=0 or (v_access_count=1 and (
                v_access.end_period is null or v_access.end_period='infinity'::timestamptz
                -- Preserve the legacy same-day sentinel in both the server's UTC
                -- and the platform's Moscow calendar; never shorten such access.
                or (v_access.end_period at time zone 'UTC')::date=(v_access.created_at at time zone 'UTC')::date
                or (v_access.end_period at time zone 'Europe/Moscow')::date=(v_access.created_at at time zone 'Europe/Moscow')::date
            )) then
                v_end := null; -- Explicit lifetime, never turn it into a finite period.
            else
                v_base := greatest(v_now,coalesce(v_access.end_period,v_now));
                v_local := v_base at time zone 'UTC';
                -- Preserve JS setMonth rollover, rather than PostgreSQL end-of-month clamping.
                v_end := (date_trunc('month',v_local)+make_interval(months=>v_months)
                  +(extract(day from v_local)::integer-1)*interval '1 day'
                  +(v_local-date_trunc('day',v_local))) at time zone 'UTC';
                if v_access_count=0 then
                    -- New access keeps the old UTC date-only grant convention.
                    v_end := date_trunc('day',v_end at time zone 'UTC') at time zone 'UTC';
                else
                    -- Renewal preserves the full remaining timestamp; never shortens it.
                    v_end := greatest(v_access.end_period,v_end);
                end if;
            end if;
            if v_access_count=0 then
                insert into public.user_course("user",course,"Free",buy,end_period)
                  values(v_order.owner,v_course.id,v_course."Free",true,v_end)
                  returning * into v_access;
                v_created := v_created+1;
            else
                update public.user_course set end_period=v_end,buy=true where id=v_access.id;
                v_updated := v_updated+1;
            end if;
        else
            select * into v_access from public.user_course
              where "user"=v_order.owner and course=v_course.id;
        end if;
        insert into public.sales("user",amount,price,position,position_name,position_category)
          values(v_author.id,v_amount,v_shop.price,v_shop.id,v_course."Title",v_course."Category")
          returning id into v_sale_id;
        v_result := v_result||jsonb_build_array(jsonb_build_object(
          'shop_id',v_shop.id,'course_id',v_course.id,'access_id',v_access.id,
          'sale_id',v_sale_id,'author_id',v_author.id,'author_amount',v_amount));
    end loop;

    -- Financial failure here rolls back accesses, sales and queued notifications as well.
    for v_credit in
      select x.author_id,sum(x.author_amount) as amount
      from jsonb_to_recordset(v_result) x(author_id uuid,author_amount numeric)
      group by x.author_id order by x.author_id
    loop
        update public.users set "Ammount"=coalesce("Ammount",0)+v_credit.amount where id=v_credit.author_id;
        if not found then raise exception 'author_missing_during_credit'; end if;
        v_credits := v_credits||jsonb_build_array(jsonb_build_object('author_id',v_credit.author_id,'amount',v_credit.amount));
    end loop;
    perform checkout_private.finish_products(p_order_id);
    update public."order" set paid=true,payment_id=p_payment_id where id=p_order_id;
    insert into public.order_access_fulfillments(order_id,payment_id,proof_id,result)
      values(p_order_id,p_payment_id,p_proof_id,jsonb_build_object('positions',v_result,'credits',v_credits));
    update public.order_access_fulfillments set result=result||jsonb_build_object('checkout_kind',case when v_zero then 'zero' else 'paid' end) where order_id=p_order_id;
    return jsonb_build_object('status','fulfilled','order_id',p_order_id,'created',v_created,
      'updated',v_updated,'positions',jsonb_array_length(v_result),'authors',jsonb_array_length(v_credits));
end;
$function$
;
create function public.checkout_complete_zero(p_order_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p jsonb;
begin
 perform checkout_private.lock_all();
 if not exists(select 1 from checkout_private.orders where order_id=p_order_id and owner_id=p_actor_id and total=0) then raise exception 'not_a_zero_order' using errcode='42501';end if;
 select jsonb_agg(jsonb_build_object('shop_id',i.shop_id,'course_id',i.course_id,'author_id',c.owner,
  'price',0,'author_commission',u."authorCommission",'author_amount','0.00') order by i.shop_id) into p
  from checkout_private.items i join public.course c on c.id=i.course_id join public.users u on u.id=c.owner where i.order_id=p_order_id;
 return public.fulfill_paid_course_order(p_order_id,'zero:'||p_order_id::text,null,p);
end$$;
create or replace function public.update_shop_status_on_order() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 update public.shop set status='order' where id::text=any(new.course_positions);
 return new;
end$$;
-- Direct client money writes must not bypass the server-owned cart, proof or receipt.
revoke insert,update,delete on public.shop,public."order",public.event_registrations,public.payment_audit from public,anon,authenticated;
alter table public.shop enable row level security;
alter table public."order" enable row level security;
alter table public.event_registrations enable row level security;
create policy checkout_shop_read on public.shop for select to authenticated using(owner=auth.uid() or checkout_private.is_admin());
create policy checkout_order_read on public."order" for select to authenticated using(owner=auth.uid() or checkout_private.is_admin());
create policy checkout_registration_read on public.event_registrations for select to authenticated using("user"=auth.uid() or exists(select 1 from public.events e where e.id=event and e.owner=auth.uid()) or checkout_private.is_admin());

create function public.checkout_guard_product_write() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare obj_owner uuid;
begin
 if current_setting('role',true) in ('anon','authenticated') then
  if auth.uid() is null then raise exception 'auth_required' using errcode='42501';end if;
  if TG_OP='INSERT' then obj_owner:=NEW.owner;else obj_owner:=OLD.owner;end if;
  if not checkout_private.is_admin() and obj_owner is distinct from auth.uid() then raise exception 'not_owner' using errcode='42501';end if;
  if TG_OP='UPDATE' and NEW.owner is distinct from OLD.owner and not checkout_private.is_admin() then raise exception 'owner_transfer_forbidden' using errcode='42501';end if;
 end if;
 if TG_OP='DELETE' then return OLD;else return NEW;end if;
end$$;
create trigger checkout_course_owner before insert or update or delete on public.course for each row execute function public.checkout_guard_product_write();
create trigger checkout_event_owner before insert or update or delete on public.events for each row execute function public.checkout_guard_product_write();

-- Existing free enrollment and author gifts continue. A buyer cannot forge a paid entitlement.
create function public.checkout_guard_access_write() returns trigger language plpgsql set search_path=pg_catalog as $$
declare cid uuid;
begin
 if current_user not in ('anon','authenticated') then if TG_OP='DELETE' then return OLD;else return NEW;end if;end if;
 if TG_OP='DELETE' then cid:=OLD.course;else cid:=NEW.course;end if;
 if checkout_private.is_admin() or exists(select 1 from public.course where id=cid and owner=auth.uid()) then
  if TG_OP='DELETE' then return OLD;else return NEW;end if;
 end if;
 if TG_OP='INSERT' and NEW."user"=auth.uid() and NEW."Free" is true and coalesce(NEW.buy,false)=false and exists(select 1 from public.course where id=cid and "Free" is true and "ModStatus"='Опубликовано') then return NEW;end if;
 raise exception 'server_entitlement_required' using errcode='42501';
end$$;
create trigger checkout_access_write before insert or update or delete on public.user_course for each row execute function public.checkout_guard_access_write();

create function public.checkout_delete_event(p_event_id uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare e public.events%rowtype;
begin
 perform checkout_private.lock_all();select * into e from public.events where id=p_event_id for update;
 if not found then return;end if;
 if auth.uid() is null or (e.owner is distinct from auth.uid() and not checkout_private.is_admin()) then raise exception 'not_owner' using errcode='42501';end if;
 if exists(select 1 from public.event_registrations where event=e.id and status='paid') or exists(select 1 from public."order" where event_id=e.id and paid is true) then raise exception 'event_has_paid_participants';end if;
 delete from public.event_registrations where event=e.id and status<>'paid';
 update public."order" set event_id=null where event_id=e.id and paid is not true;
 update public.event_contact_requests set event=null where event=e.id;
 delete from public.events where id=e.id;
end$$;

-- Public RPC ACLs: only these names, never broad grants on existing financial functions.
revoke all on function public.cart_add_product(text,uuid,text,boolean,boolean),public.cart_get(),public.cart_remove(uuid),public.cart_quote(uuid[],text),
 public.checkout_prepare(uuid,uuid[],text),public.checkout_cancel(uuid),public.checkout_my_orders(),public.checkout_register_free_event(uuid,boolean),public.checkout_enroll_free_course(uuid),
 public.checkout_delete_event(uuid) from public,anon;
grant execute on function public.cart_add_product(text,uuid,text,boolean,boolean),public.cart_get(),public.cart_remove(uuid),public.cart_quote(uuid[],text),
 public.checkout_prepare(uuid,uuid[],text),public.checkout_cancel(uuid),public.checkout_my_orders(),public.checkout_register_free_event(uuid,boolean),public.checkout_enroll_free_course(uuid),
 public.checkout_delete_event(uuid) to authenticated;
revoke all on function public.checkout_acquire_link(uuid,uuid,uuid),public.checkout_store_link(uuid,uuid,uuid,text),public.checkout_complete_zero(uuid,uuid) from public,anon,authenticated;
grant execute on function public.checkout_acquire_link(uuid,uuid,uuid),public.checkout_store_link(uuid,uuid,uuid,text),public.checkout_complete_zero(uuid,uuid) to service_role;
revoke all on all functions in schema checkout_private from public,anon,authenticated,service_role;
-- Policy/trigger helpers can be invoked, but never mutate or reveal other people's data.
grant usage on schema checkout_private to authenticated;
grant execute on function checkout_private.is_admin() to authenticated;
-- The legacy RPC retains its original definer owner. Grant only that trusted role internal access.
do $$declare v_owner name;begin
 select pg_get_userbyid(proowner) into v_owner from pg_proc where oid='public.fulfill_paid_course_order(uuid,text,uuid,jsonb)'::regprocedure;
 if v_owner in ('anon','authenticated','service_role') then raise exception 'untrusted_fulfillment_owner';end if;
 execute format('grant usage on schema checkout_private to %I',v_owner);
 execute format('grant select,insert,update,delete on all tables in schema checkout_private to %I',v_owner);
 execute format('grant execute on all functions in schema checkout_private to %I',v_owner);
end$$;
notify pgrst,'reload schema';
commit;

