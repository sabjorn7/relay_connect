-- OWNER MANUAL ONLY. Stop NEW cart additions/orders; preserve all purchases and callbacks.
-- Not a destructive schema downgrade. Never reopen legacy client money writes.
begin;
set local lock_timeout='3s';
revoke execute on function public.cart_add_product(text,uuid,text,boolean,boolean),public.checkout_prepare(uuid,uuid[],text) from authenticated;
notify pgrst,'reload schema';
commit;
-- Existing owner order resume, verified payment fulfillment, receipts and all data remain.
