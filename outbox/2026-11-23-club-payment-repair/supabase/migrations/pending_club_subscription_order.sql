-- Local preparation only. Review and apply manually before publishing the club page.
BEGIN;
CREATE FUNCTION public.club_prepare_subscription_order(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_club public.clubs%ROWTYPE;
  v_order_id uuid;
  v_marker text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_club FROM public.clubs
  WHERE id = p_club_id AND active IS TRUE FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Club unavailable' USING ERRCODE = '22023';
  END IF;
  IF v_club.price IS NULL OR v_club.price <= 0
     OR v_club.price::text IN ('NaN', 'Infinity', '-Infinity')
     OR nullif(btrim(v_club.sub_id), '') IS NULL THEN
    RAISE EXCEPTION 'Subscription unavailable' USING ERRCODE = '22023';
  END IF;
  -- Same owner and club serialize even across tabs. No client-supplied price or owner.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_club_id::text, 0));
  v_marker := jsonb_build_object('kind', 'club_subscription_v1',
    'club_id', p_club_id, 'subscription_id', v_club.sub_id, 'price', v_club.price)::text;
  SELECT id INTO v_order_id FROM public."order"
  WHERE owner = v_uid AND subscription IS TRUE AND paid IS NOT TRUE
    AND logs = v_marker AND summ = v_club.price
  ORDER BY created_at DESC, id LIMIT 1;
  IF v_order_id IS NULL THEN
    INSERT INTO public."order" (owner, summ, subscription, paid, course_positions, logs)
    VALUES (v_uid, v_club.price, true, false, ARRAY[]::text[], v_marker)
    RETURNING id INTO v_order_id;
  END IF;
  RETURN jsonb_build_object('id', v_order_id, 'club_id', p_club_id,
    'subscription_id', v_club.sub_id, 'price', v_club.price);
END;
$function$;
REVOKE ALL ON FUNCTION public.club_prepare_subscription_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_prepare_subscription_order(uuid) TO authenticated;
COMMIT;
