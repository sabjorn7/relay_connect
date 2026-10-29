-- sha256(payload below): 1cbb493bab36bf3987008bbb931a442c9f03e7a9d78a2931565a2f422ff42cee
-- Откат v2 → восстановить verify_order_payment v1 (renewal по shop.is_renewal, мероприятие = безусловный ok).
create or replace function public.verify_order_payment(p_order_id uuid, p_paid_amount numeric)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_order record; v_c record; v_promo record; r record;
  v_price numeric; v_expected numeric := 0; v_eligible numeric := 0; v_disc numeric := 0; v_ok boolean;
begin
  select * into v_order from public."order" where id = p_order_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'order_not_found'); end if;
  for r in
    select s.id as shop_id, s.course_id, coalesce(s.is_renewal, false) as renew
    from public.shop s where s.id = any (v_order.course_positions)
  loop
    select "Price","DurationPrice","Free" into v_c from public.course where id = r.course_id;
    if not found then continue; end if;
    if v_c."Free" is true then v_price := 0;
    elsif r.renew and coalesce(v_c."DurationPrice",0) > 0 then v_price := v_c."DurationPrice";
    else v_price := coalesce(v_c."Price",0); end if;
    v_expected := v_expected + v_price; v_eligible := v_eligible + v_price;
  end loop;
  if v_order.promo_code_id is not null then
    select * into v_promo from public.promo_codes where id = v_order.promo_code_id;
    if found then
      if v_promo.discount_type='percent' then v_disc := round(v_eligible*v_promo.discount_value/100,2);
      else v_disc := least(v_promo.discount_value, v_eligible); end if;
    end if;
  end if;
  v_expected := greatest(0, v_expected - v_disc);
  v_ok := (v_order.event_id is not null) or (p_paid_amount >= v_expected - 1);
  return jsonb_build_object('ok', v_ok, 'expected', v_expected, 'paid', p_paid_amount,
                            'is_event', v_order.event_id is not null,
                            'reason', case when v_ok then 'ok' else 'underpaid' end);
end $$;
revoke all on function public.verify_order_payment(uuid, numeric) from public, anon, authenticated;
grant execute on function public.verify_order_payment(uuid, numeric) to service_role;
