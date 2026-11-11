-- OWNER MANUAL ONLY. Two author shares: courses and streams; events keep users.authorCommission.
-- No historical balances/sales/receipts/accesses are recalculated.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin
 if md5(pg_get_functiondef('public.fulfill_paid_course_order(uuid,text,uuid,jsonb)'::regprocedure))<>'2afe7c07555d1ad45791b92b7f24ab45' then raise exception 'fulfillment_baseline_changed';end if;
 if md5(pg_get_functiondef('public.checkout_complete_zero(uuid,uuid)'::regprocedure))<>'bab9b74cbb544321cb5b00c19dbe3c67' then raise exception 'zero_checkout_baseline_changed';end if;
 if exists(select 1 from public.users where "authorCommission" is null or "authorCommission"<0 or "authorCommission">100) then raise exception 'invalid_legacy_commission';end if;
 if has_table_privilege('authenticated','public.users','UPDATE') or has_table_privilege('anon','public.users','UPDATE') then raise exception 'broad_users_update_must_be_reviewed';end if;
 if has_table_privilege('authenticated','public.users','INSERT') or has_table_privilege('anon','public.users','INSERT') then raise exception 'broad_users_insert_must_be_reviewed';end if;
end$$;
create schema author_share_private;
revoke all on schema author_share_private from public,anon,authenticated,service_role;
alter table public.users add column "authorCommissionCourses" numeric,add column "authorCommissionStreams" numeric;
update public.users set "authorCommissionCourses"="authorCommission","authorCommissionStreams"="authorCommission";
alter table public.users alter column "authorCommissionCourses" set not null,alter column "authorCommissionStreams" set not null,
 add constraint author_shares_range check("authorCommissionCourses" between 0 and 100 and "authorCommissionStreams" between 0 and 100);
revoke insert("authorCommissionCourses","authorCommissionStreams"),update("authorCommissionCourses","authorCommissionStreams") on public.users from public,anon,authenticated;
create function author_share_private.init_user() returns trigger language plpgsql set search_path=pg_catalog as $$begin
 NEW."authorCommissionCourses":=coalesce(NEW."authorCommissionCourses",NEW."authorCommission");
 NEW."authorCommissionStreams":=coalesce(NEW."authorCommissionStreams",NEW."authorCommission");return NEW;end$$;
create trigger init_author_shares before insert on public.users for each row execute function author_share_private.init_user();

create function public.admin_set_author_share(p_user uuid,p_category text,p_value numeric,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare old_value numeric;field_name text;
begin
 if not exists(select 1 from public.users where id=auth.uid() and (role='admin' or superadmin is true)) then raise exception 'forbidden' using errcode='42501';end if;
 if p_category not in ('courses','streams') or p_category is null then raise exception 'unsupported_commission_category';end if;
 if p_value is null or p_value<0 or p_value>100 then raise exception 'commission_out_of_range';end if;
 if nullif(btrim(p_reason),'') is null then raise exception 'reason_required';end if;
 perform 1 from public.users where id=p_user for update;if not found then raise exception 'user_not_found';end if;
 if p_category='courses' then field_name:='authorCommissionCourses';select "authorCommissionCourses" into old_value from public.users where id=p_user;update public.users set "authorCommissionCourses"=p_value where id=p_user;
 else field_name:='authorCommissionStreams';select "authorCommissionStreams" into old_value from public.users where id=p_user;update public.users set "authorCommissionStreams"=p_value where id=p_user;end if;
 if old_value is not distinct from p_value then raise exception 'commission_unchanged';end if;
 insert into public.admin_money_log(actor,action,target_user,field,old_value,new_value,reason) values(auth.uid(),'commission_change',p_user,field_name,old_value::text,p_value::text,btrim(p_reason));
 return jsonb_build_object('user',p_user,'category',p_category,'old',old_value,'new',p_value);
end$$;
revoke all on function public.admin_set_author_share(uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.admin_set_author_share(uuid,text,numeric,text) to authenticated;

create function author_share_private.course_share(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare c public.course%rowtype;u public.users%rowtype;kind text;rate numeric;
begin
 select * into c from public.course where id=p_course;if not found then raise exception 'course_not_found';end if;
 select * into u from public.users where id=c.owner;if not found then raise exception 'author_not_found';end if;
 -- Legacy event-labelled courses are deliberately excluded as well as linked events.
 if c."Category"='Мероприятия' or exists(select 1 from public.events where backing_course_id=c.id) then kind:='events';rate:=u."authorCommission";
 elsif exists(select 1 from public.streams where backing_course_id=c.id) then kind:='streams';rate:=u."authorCommissionStreams";
 else kind:='courses';rate:=u."authorCommissionCourses";end if;
 return jsonb_build_object('course_id',c.id,'author_id',u.id,'category',kind,'percent',rate);
end$$;
create function public.get_order_author_shares(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare o public."order"%rowtype;r jsonb;
begin
 select * into o from public."order" where id=p_order_id;if not found or o.subscription is true then raise exception 'not_a_course_order';end if;
 select jsonb_agg(author_share_private.course_share(x.course_id) order by x.course_id) into r
 from (select distinct sh.course_id from public.shop sh where sh.id::text=any(o.course_positions)) x;
 return jsonb_build_object('rates',coalesce(r,'[]'::jsonb));
end$$;
revoke all on function public.get_order_author_shares(uuid) from public,anon,authenticated;
grant execute on function public.get_order_author_shares(uuid) to service_role;

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
    v_share jsonb;
    v_share_rate numeric;
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
        if not found then raise exception 'author_not_found';end if;
        v_share := author_share_private.course_share(v_course.id);
        v_share_rate := (v_share->>'percent')::numeric;
        if v_share_rate is distinct from v_item.author_commission then
            raise exception 'author_commission_changed' using errcode='22023';
        end if;
        if v_item.author_amount is null or v_item.author_amount !~ '^-?[0-9]+[.][0-9]{2}$' then
            raise exception 'invalid_author_amount' using errcode='22023';
        end if;
        -- The trusted n8n Code preserves EXACT production JS (price*rate/100).toFixed(2).
        -- Numeric round() is deliberately NOT substituted: ties such as 1.005 differ.
        -- Check the locked price/rate and rounding envelope; never accept a browser plan.
        v_amount := v_item.author_amount::numeric;
        if abs(v_amount-coalesce(v_shop.price,0)*coalesce(v_share_rate,0)/100)>0.00500001 then
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
          'sale_id',v_sale_id,'author_id',v_author.id,'author_amount',v_amount,
          'commission_category',v_share->>'category','author_commission',v_share_rate));
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
CREATE OR REPLACE FUNCTION public.checkout_complete_zero(p_order_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare p jsonb;
begin
 perform checkout_private.lock_all();
 if not exists(select 1 from checkout_private.orders where order_id=p_order_id and owner_id=p_actor_id and total=0) then raise exception 'not_a_zero_order' using errcode='42501';end if;
 select jsonb_agg(jsonb_build_object('shop_id',i.shop_id,'course_id',i.course_id,'author_id',c.owner,
  'price',0,'author_commission',(author_share_private.course_share(i.course_id)->>'percent')::numeric,'author_amount','0.00') order by i.shop_id) into p
  from checkout_private.items i join public.course c on c.id=i.course_id join public.users u on u.id=c.owner where i.order_id=p_order_id;
 return public.fulfill_paid_course_order(p_order_id,'zero:'||p_order_id::text,null,p);
end$function$

;
revoke all on all functions in schema author_share_private from public,anon,authenticated,service_role;
-- CREATE OR REPLACE preserves the existing fulfillment owner, which may differ from SQL Editor's role.
do $$declare owner_name text;begin
 select pg_get_userbyid(proowner) into owner_name from pg_proc where oid='public.fulfill_paid_course_order(uuid,text,uuid,jsonb)'::regprocedure;
 execute format('grant usage on schema author_share_private to %I',owner_name);
 execute format('grant execute on all functions in schema author_share_private to %I',owner_name);
end$$;
notify pgrst,'reload schema';
commit;
