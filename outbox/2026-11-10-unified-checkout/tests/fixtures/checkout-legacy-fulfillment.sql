-- Read-only production function definition, captured 2026-11-10. No data or credentials.
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
    select * into v_order from public."order" where id=p_order_id for update;
    if not found then raise exception 'order_not_found' using errcode='22023'; end if;
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
    perform 1 from public.payment_audit a
      where a.id=p_proof_id and a.order_id=p_order_id and a.event='ok'
        and a.detail->>'sig_valid'='true'
        and a.detail->>'payment_status'='success'
        and a.detail->'verify'->>'ok'='true'
      for share;
    if not found then raise exception 'verified_success_required' using errcode='42501'; end if;
    if jsonb_typeof(p_access_plan) is distinct from 'array'
       or coalesce(cardinality(v_order.course_positions),0)=0
       or jsonb_array_length(p_access_plan)<>cardinality(v_order.course_positions) then
        raise exception 'incomplete_access_plan' using errcode='22023';
    end if;
    if (select count(distinct x.shop_id) from jsonb_to_recordset(p_access_plan) x(shop_id uuid))
       <>cardinality(v_order.course_positions) then
        raise exception 'duplicate_or_missing_position' using errcode='22023';
    end if;

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
    update public."order" set paid=true,payment_id=p_payment_id where id=p_order_id;
    insert into public.order_access_fulfillments(order_id,payment_id,proof_id,result)
      values(p_order_id,p_payment_id,p_proof_id,jsonb_build_object('positions',v_result,'credits',v_credits));
    return jsonb_build_object('status','fulfilled','order_id',p_order_id,'created',v_created,
      'updated',v_updated,'positions',jsonb_array_length(v_result),'authors',jsonb_array_length(v_credits));
end;
$function$
;
