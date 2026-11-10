-- READ ONLY: owner can run after manual migration/schema reload.
select 'private_ledger' as check_name, case when to_regclass('checkout_private.orders') is not null and to_regclass('checkout_private.items') is not null then 'PASS' else 'FAIL' end as result
union all select 'no_seat_reservation',case when not exists(select 1 from pg_tables where schemaname='checkout_private' and tablename not in ('orders','items')) then 'PASS' else 'FAIL' end
union all select 'cart_rpc',case when to_regprocedure('public.cart_add_product(text,uuid,text,boolean,boolean)') is not null and to_regprocedure('public.checkout_prepare(uuid,uuid[],text)') is not null then 'PASS' else 'FAIL' end
union all select 'service_only_zero',case when has_function_privilege('service_role','public.checkout_complete_zero(uuid,uuid)','EXECUTE') and not has_function_privilege('authenticated','public.checkout_complete_zero(uuid,uuid)','EXECUTE') and not has_function_privilege('anon','public.checkout_complete_zero(uuid,uuid)','EXECUTE') then 'PASS' else 'FAIL' end
union all select 'client_writes_closed',case when not has_table_privilege('authenticated','public.shop','INSERT') and not has_table_privilege('authenticated','public.order','UPDATE') and not has_table_privilege('anon','public.event_registrations','INSERT') then 'PASS' else 'FAIL' end
union all select 'rls',case when (select count(*) from pg_class where oid in ('public.shop'::regclass,'public.order'::regclass,'public.event_registrations'::regclass) and relrowsecurity)=3 then 'PASS' else 'FAIL' end
union all select 'historical_receipt_contract',case when to_regprocedure('public.fulfill_paid_course_order(uuid,text,uuid,jsonb)') is not null then 'PASS' else 'FAIL' end;
-- Metadata only, no customer rows or credentials.
select schemaname,tablename,policyname,roles,cmd from pg_policies where tablename in ('shop','order','event_registrations') order by tablename,policyname;
select p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'checkout_%' or p.proname like 'cart_%') order by p.proname;
