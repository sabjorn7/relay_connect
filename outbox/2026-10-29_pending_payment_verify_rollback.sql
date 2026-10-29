-- sha256(payload below): 08edeac5ba709a60ee37061bc00571bfce916960f94cecb217b386ef21afdcdb
-- Откат серверной части усиления оплаты.
begin;
drop function if exists public.verify_order_payment(uuid, numeric);
drop table if exists public.payment_audit;
commit;
