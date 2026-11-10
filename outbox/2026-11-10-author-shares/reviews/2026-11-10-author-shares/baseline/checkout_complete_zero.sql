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
  'price',0,'author_commission',u."authorCommission",'author_amount','0.00') order by i.shop_id) into p
  from checkout_private.items i join public.course c on c.id=i.course_id join public.users u on u.id=c.owner where i.order_id=p_order_id;
 return public.fulfill_paid_course_order(p_order_id,'zero:'||p_order_id::text,null,p);
end$function$
