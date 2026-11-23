"""Disposable loopback PostgreSQL only. Never reads app credentials."""
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from helpers.checkout_stand import Stand
s=Stand()
uid='11111111-1111-4111-8111-111111111111'
club='22222222-2222-4222-8222-222222222222'
def call(user=uid):
 out=s.sql(f"BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','{user}',true); SELECT public.club_prepare_subscription_order('{club}'); COMMIT;")
 return json.loads(next(line for line in out.splitlines() if line.startswith('{')))
def denied(sql):
 try:s.sql(sql)
 except RuntimeError:return
 raise AssertionError('operation unexpectedly permitted')
def check(ok):assert ok
try:
 s.start()
 s.sql("""
 CREATE ROLE anon; CREATE ROLE authenticated;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated;
 CREATE TABLE public.clubs(id uuid PRIMARY KEY, active boolean, price numeric, sub_id text);
 CREATE TABLE public."order"(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(), owner uuid, summ numeric, subscription boolean DEFAULT false, paid boolean DEFAULT false, course_positions text[] DEFAULT '{}', logs text);
 ALTER TABLE public."order" ENABLE ROW LEVEL SECURITY;
 CREATE TABLE public.club_subs(id uuid, active boolean);
 CREATE TABLE public.shop(id uuid, status text);
 CREATE FUNCTION public.update_shop_status_on_order() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $$ begin update public.shop set status='order' where id::text=any(new.course_positions); return new; end $$;
 CREATE TRIGGER trg_update_shop_status AFTER INSERT ON public.\"order\" FOR EACH ROW EXECUTE FUNCTION public.update_shop_status_on_order();
 """)
 s.sql(Path('supabase/migrations/pending_club_subscription_order.sql').read_text())
 s.sql(f"INSERT INTO clubs VALUES('{club}',true,3500,'12345');")
 s.check('anon cannot execute',lambda:denied(f"SET ROLE anon; SELECT club_prepare_subscription_order('{club}');"))
 s.check('missing session rejected',lambda:denied(f"SET ROLE authenticated; SELECT club_prepare_subscription_order('{club}');"))
 first=call()
 s.check('authenticated order uses server fields',lambda:check(first['price']==3500 and first['subscription_id']=='12345'))
 s.check('repeat reuses unpaid order',lambda:check(call()['id']==first['id']))
 with ThreadPoolExecutor(max_workers=6) as pool: results=list(pool.map(lambda _:call(),range(12)))
 s.check('12 concurrent calls create one order',lambda:check(len({r['id'] for r in results})==1 and s.sql('SELECT count(*) FROM public."order"')=='1'))
 s.check('no early activation',lambda:check(s.sql('SELECT count(*) FROM club_subs')=='0' and s.sql('SELECT paid FROM public."order"')=='f'))
 s.check('direct insert denied',lambda:denied('SET ROLE authenticated; INSERT INTO public."order" DEFAULT VALUES;'))
 s.check('direct update denied',lambda:denied('SET ROLE authenticated; UPDATE public."order" SET summ=1;'))
 s.check('price/owner/subscription overrides rejected',lambda:denied(f"SET ROLE authenticated; SELECT club_prepare_subscription_order('{club}',1,'{uid}','999');"))
 s.sql('UPDATE clubs SET active=false;')
 s.check('inactive club rejected',lambda:denied(f"BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','{uid}',true); SELECT club_prepare_subscription_order('{club}');"))
 s.sql('UPDATE clubs SET active=true;')
 for price in ['NULL','0','-1',"'NaN'","'Infinity'"]:
  s.sql('UPDATE clubs SET price='+price)
  s.check('invalid price '+price,lambda:denied(f"BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','{uid}',true); SELECT club_prepare_subscription_order('{club}');"))
 s.sql("UPDATE clubs SET price=3500,sub_id='';")
 s.check('missing subscription rejected',lambda:denied(f"BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','{uid}',true); SELECT club_prepare_subscription_order('{club}');"))
 s.sql(Path('supabase/migrations/rollback_club_subscription_order.sql').read_text())
 s.check('rollback retains unpaid order',lambda:check(s.sql('SELECT count(*) FROM public."order"')=='1'))
 assert all(r['status']=='PASS' for r in s.results)
 print(str(len(s.results))+' tests PASS')
finally:s.stop()
