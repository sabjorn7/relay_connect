-- sha256(payload below): 55e0519a28a3b725e991874c67a8dbfc77437529ecfbb4eb9e1d6fe486d7be39
-- verify_order_payment v2:
--   (1) null-guard p_paid_amount;
--   (2) renewal — по ИСТОРИИ user_course (доступ, созданный ДО этого заказа), не по клиентскому shop.is_renewal;
--   (3) мероприятия — ожидаемая сумма из public.events (price, deposit_percent); полная vs депозит различается
--       по public.event_registrations.payment_type (признака НЕТ на order — см. комментарий ниже), не безусловный ok.
-- CREATE OR REPLACE (v1 уже применён). Инертно, пока n8n не вызывает. Запуск — по ОК (после проверки колонок).
--
-- ПРИМЕЧАНИЕ по (3): в таблице "order" нет поля типа оплаты (колонки: course_positions, created_at, event_id,
-- id, logs, num, owner, pageUrl, paid, payment_id, promo_code_id, promo_discount, subscription, summ).
-- Признак «полная/депозит» лежит в public.event_registrations: колонка "order" (FK -> order.id),
-- payment_type ('full'/'deposit'/...), amount_paid, amount_total. Берём payment_type оттуда.
-- (amount_paid в event_registrations — тоже клиентское значение при RLS-off, поэтому ожидаемую сумму
--  считаем из events.price + deposit_percent, а НЕ из amount_paid/order.summ.)
create or replace function public.verify_order_payment(p_order_id uuid, p_paid_amount numeric)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_order   record;
  v_c       record;
  v_promo   record;
  v_ev      record;
  v_reg     record;
  r         record;
  v_price   numeric;
  v_expected numeric := 0;
  v_eligible numeric := 0;
  v_disc    numeric := 0;
  v_renew   boolean;
  v_min     numeric;
  v_kind    text;
  v_ok      boolean;
begin
  -- (1) защита от null
  if p_paid_amount is null then
    return jsonb_build_object('ok', false, 'reason', 'no_paid_amount', 'paid', null);
  end if;

  select * into v_order from public."order" where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- (3) мероприятие: цена из events; полная vs депозит — по event_registrations.payment_type
  if v_order.event_id is not null then
    select price, deposit_percent into v_ev from public.events where id = v_order.event_id;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'event_not_found', 'is_event', true, 'paid', p_paid_amount);
    end if;
    select payment_type into v_reg
    from public.event_registrations
    where "order" = p_order_id
    order by created_at desc
    limit 1;
    v_kind := coalesce(v_reg.payment_type, 'full');

    if v_kind = 'deposit' and coalesce(v_ev.deposit_percent, 0) > 0 then
      -- депозит: минимум = процент от полной цены (промо на депозит не применяется)
      v_min := round(coalesce(v_ev.price, 0) * v_ev.deposit_percent / 100, 2);
    else
      -- полная оплата: полная цена минус промо
      v_kind := 'full';
      v_disc := 0;
      if v_order.promo_code_id is not null then
        select * into v_promo from public.promo_codes where id = v_order.promo_code_id;
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

    v_ok := p_paid_amount >= v_min - 1;  -- допуск 1 ₽; при полной оплате депозитная сумма НЕ пройдёт
    return jsonb_build_object('ok', v_ok, 'expected_min', v_min, 'paid', p_paid_amount,
                              'is_event', true, 'pay_kind', v_kind,
                              'reason', case when v_ok then 'ok' else 'underpaid_event' end);
  end if;

  -- курсы/эфиры: серверная цена по каждой позиции; (2) renewal — по истории user_course покупателя
  for r in
    select s.id as shop_id, s.course_id
    from public.shop s where s.id = any (v_order.course_positions)
  loop
    select "Price","DurationPrice","Free" into v_c from public.course where id = r.course_id;
    if not found then continue; end if;
    select exists(
      select 1 from public.user_course uc
      where uc."user" = v_order.owner
        and uc.course = r.course_id
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
    select * into v_promo from public.promo_codes where id = v_order.promo_code_id;
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

  return jsonb_build_object('ok', v_ok, 'expected', v_expected, 'paid', p_paid_amount,
                            'is_event', false, 'reason', case when v_ok then 'ok' else 'underpaid' end);
end $$;
revoke all on function public.verify_order_payment(uuid, numeric) from public, anon, authenticated;
grant execute on function public.verify_order_payment(uuid, numeric) to service_role;
