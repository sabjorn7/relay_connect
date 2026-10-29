-- sha256(payload below, вставлять БЕЗ этой строки): 7636a74b417819f49f45f9ba946439eaf9f9dd29877c219f89c11aad23eb9a58

create or replace function public.verify_order_payment(p_order_id uuid, p_paid_amount numeric)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_order    record;
  v_c        record;
  v_promo    record;
  v_ev        record;
  v_reg       record;
  r          record;
  v_price    numeric;
  v_expected numeric := 0;
  v_eligible numeric := 0;
  v_disc     numeric := 0;
  v_renew    boolean;
  v_min      numeric;
  v_kind     text;
  v_found    boolean := false;
  v_subprice numeric;
  v_ok       boolean;
begin
  if p_paid_amount is null then
    return jsonb_build_object('ok', false, 'reason', 'no_paid_amount', 'paid', null);
  end if;

  select * into v_order from public."order" where id::text = p_order_id::text;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  if coalesce(v_order.subscription, false) is true then
    for r in
      select c.price as price
      from public.clubs c
      where exists (
        select 1 from unnest(coalesce(v_order.course_positions, array[]::text[])) pos
        where pos like '%' || c.title
      )
    loop
      v_expected := v_expected + coalesce(r.price, 0);
      v_found := true;
    end loop;
    if not v_found then
      select c.price into v_subprice
      from public.club_subs cs
      join public.clubs c on c.id::text = cs.club::text
      where cs.suber::text = v_order.owner::text
      order by cs.active desc, cs.end_date desc nulls last
      limit 1;
      if v_subprice is not null then
        v_expected := v_subprice;
        v_found := true;
      end if;
    end if;
    if not v_found then
      return jsonb_build_object('ok', false, 'reason', 'subscription_unresolved', 'is_subscription', true, 'paid', p_paid_amount);
    end if;
    v_ok := p_paid_amount >= v_expected - 1;
    return jsonb_build_object('ok', v_ok, 'expected', v_expected, 'paid', p_paid_amount, 'is_subscription', true, 'reason', case when v_ok then 'ok' else 'underpaid_subscription' end);
  end if;

  if v_order.event_id is not null then
    select price, deposit_percent into v_ev from public.events where id::text = v_order.event_id::text;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'event_not_found', 'is_event', true, 'paid', p_paid_amount);
    end if;
    select payment_type into v_reg
    from public.event_registrations
    where "order"::text = p_order_id::text
    order by created_at desc
    limit 1;
    v_kind := coalesce(v_reg.payment_type, 'full');
    if v_kind = 'deposit' and coalesce(v_ev.deposit_percent, 0) > 0 then
      v_min := round(coalesce(v_ev.price, 0) * v_ev.deposit_percent / 100, 2);
    else
      v_kind := 'full';
      v_disc := 0;
      if v_order.promo_code_id is not null then
        select * into v_promo from public.promo_codes where id::text = v_order.promo_code_id::text;
        if found then
          if v_promo.discount_type = 'percent' then
            v_disc := round(coalesce(v_ev.price, 0) * v_promo.discount_value / 100, 2);
          else
            v_disc := least(v_promo.discount_value, coalesce(v_ev.price, 0));
          end if;
        end if;
      end if;
      v_min := greatest(0, coalesce(v_ev.price, 0) - v_disc);
    end if;
    v_ok := p_paid_amount >= v_min - 1;
    return jsonb_build_object('ok', v_ok, 'expected_min', v_min, 'paid', p_paid_amount, 'is_event', true, 'pay_kind', v_kind, 'reason', case when v_ok then 'ok' else 'underpaid_event' end);
  end if;

  for r in
    select s.id as shop_id, s.course_id
    from public.shop s where s.id::text = any (v_order.course_positions)
  loop
    select "Price","DurationPrice","Free" into v_c from public.course where id::text = r.course_id::text;
    if not found then continue; end if;
    select exists(
      select 1 from public.user_course uc
      where uc."user"::text = v_order.owner::text
        and uc.course::text = r.course_id::text
        and uc.created_at < v_order.created_at
    ) into v_renew;
    if v_c."Free" is true then
      v_price := 0;
    elsif v_renew and coalesce(v_c."DurationPrice", 0) > 0 then
      v_price := v_c."DurationPrice";
    else
      v_price := coalesce(v_c."Price", 0);
    end if;
    v_expected := v_expected + v_price;
    v_eligible := v_eligible + v_price;
  end loop;

  if v_order.promo_code_id is not null then
    select * into v_promo from public.promo_codes where id::text = v_order.promo_code_id::text;
    if found then
      if v_promo.discount_type = 'percent' then
        v_disc := round(v_eligible * v_promo.discount_value / 100, 2);
      else
        v_disc := least(v_promo.discount_value, v_eligible);
      end if;
    end if;
  end if;
  v_expected := greatest(0, v_expected - v_disc);
  v_ok := p_paid_amount >= v_expected - 1;

  return jsonb_build_object('ok', v_ok, 'expected', v_expected, 'paid', p_paid_amount, 'is_event', false, 'reason', case when v_ok then 'ok' else 'underpaid' end);
end $$;
revoke all on function public.verify_order_payment(uuid, numeric) from public, anon, authenticated;
grant execute on function public.verify_order_payment(uuid, numeric) to service_role;
