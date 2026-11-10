#!/usr/bin/env python3
"""Synthetic loopback PostgreSQL/PostgREST only; never loads application env."""
import importlib.util,pathlib,json,uuid,subprocess,concurrent.futures,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
sp=importlib.util.spec_from_file_location('stand',ROOT/'tests/helpers/checkout_stand.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);s=m.Stand()
def uid():return str(uuid.uuid4())
def lit(x):return "'"+str(x).replace("'","''")+"'"
def sql(q):return s.sql(q)
def user(email=None):
 u=uid();sql("insert into users(id,email,role) values(%s,%s,'Спикер')"%(lit(u),lit(email or u+'@example.invalid')));return u
def product(chat=True,recording=True):
 a=user();t,c,r,h=[uid() for _ in range(4)]
 sql("insert into course(id,owner,\"Title\",\"DurationLong\") values(%s,%s,'Synthetic stream backing',3),(%s,%s,'Synthetic recording',0)"%(lit(c),lit(a),lit(r),lit(a)))
 if chat:sql("insert into chats(id,creator,forced_group,users,read) values(%s,%s,true,array[%s]::uuid[],array[%s]::uuid[])"%(lit(h),lit(a),lit(a),lit(a)))
 sql("insert into streams(id,author,title,price,backing_course_id,chat_enabled,chat,recording_course_enabled,recording_course) values(%s,%s,'Synthetic',1000,%s,%s,%s,%s,%s)"%(lit(t),lit(a),lit(c),str(chat).lower(),lit(h) if chat else 'null',str(recording).lower(),lit(r) if recording else 'null'))
 return dict(a=a,t=t,c=c,r=r,h=h)
def grant(p,u,email=None):
 return json.loads(sql("set role authenticated;set request.jwt.claim.sub=%s;select grant_stream_access_by_email(%s,%s)"%(lit(u),lit(p['t']),lit(email))).splitlines()[-1])
def denied(fn):
 try:fn()
 except RuntimeError:return
 raise AssertionError('expected rejection')
def snapshot():return sql("select json_build_object('orders',(select count(*) from public.\"order\"),'shops',(select count(*) from shop),'sales',(select count(*) from sales),'proofs',(select count(*) from payment_audit),'receipts',(select count(*) from order_access_fulfillments),'balances',(select sum(\"Ammount\") from users),'notices',(select count(*) from test_notices))")
try:
 s.start()
 for f in ['tests/fixtures/unified-checkout.sql','supabase/migrations/pending_unified_checkout.sql','tests/fixtures/stream-manual-access.sql','supabase/migrations/pending_stream_manual_access.sql']:s.cmd([m.PG/'psql','-X','-v','ON_ERROR_STOP=1','-f',ROOT/f])
 s.check('migration compiles with current access guard and production-shaped triggers',lambda:None)
 def complete():
  p=product();u=user('buyer@example.invalid');before=snapshot();r=grant(p,p['a'],' BUYER@EXAMPLE.INVALID ');assert r['status']=='granted'
  assert sql("select \"Free\" and not buy from user_course where \"user\"=%s and course=%s"%(lit(u),lit(p['c'])))=='t'
  assert sql("select %s=any(users) and %s=any(read) from chats where id=%s"%(lit(u),lit(u),lit(p['h'])))=='t'
  assert sql("select count(*) from user_course where \"user\"=%s and course=%s"%(lit(u),lit(p['r'])))=='1';assert snapshot()==before
 s.check('registered email grants backing, chat and recording atomically without payment/sale/credit/push',complete)
 def repeat():
  p=product();u=user();email=sql('select email from users where id='+lit(u));r=grant(p,p['a'],email);old=sql('select row_to_json(x) from user_course x where id='+lit(r['access_id']));assert grant(p,p['a'],email)['status']=='already_has_access';assert sql('select row_to_json(x) from user_course x where id='+lit(r['access_id']))==old
  assert sql('select count(*) from user_course where \"user\"='+lit(u))=='2'
 s.check('repeat is idempotent and does not extend or rewrite access',repeat)
 def paid():
  p=product();u=user();sql("insert into user_course(\"user\",course,buy,end_period) values(%s,%s,true,now()+interval '10 days')"%(lit(u),lit(p['c'])));old=sql("select json_agg(x) from user_course x where \"user\"="+lit(u));before=snapshot();assert grant(p,p['a'],sql('select email from users where id='+lit(u)))['status']=='already_has_access';assert sql("select json_agg(x) from user_course x where \"user\"="+lit(u))==old;assert snapshot()==before
 s.check('existing buyer stays paid with identical end date and no manual marker',paid)
 def unauthorized():
  p=product();u=user();email=sql('select email from users where id='+lit(u));denied(lambda:grant(p,u,email));denied(lambda:sql('set role anon;select grant_stream_access_by_email('+lit(p['t'])+','+lit(email)+')'));assert sql('select count(*) from user_course where \"user\"='+lit(u))=='0'
 s.check('guest and another organizer cannot grant access or enumerate registration by email',unauthorized)
 def missing():
  p=product();before=sql('select count(*) from user_course');denied(lambda:grant(p,p['a'],'missing@example.invalid'));assert sql('select count(*) from user_course')==before
 s.check('unknown registered email changes nothing',missing)
 def duplicate_email():
  p=product();user('duplicate@example.invalid');user('DUPLICATE@example.invalid');denied(lambda:grant(p,p['a'],'duplicate@example.invalid'))
 s.check('ambiguous registered emails fail closed',duplicate_email)
 def placeholder():
  p=product();u=user();access=uid();sql("alter table user_course disable trigger trg_stream_bought_add_to_chat;alter table user_course disable trigger trg_stream_bought_grant_recording;insert into user_course(id,\"user\",course,buy,\"Free\") values(%s,%s,%s,false,false);alter table user_course enable trigger trg_stream_bought_add_to_chat;alter table user_course enable trigger trg_stream_bought_grant_recording"%(lit(access),lit(u),lit(p['c'])))
  r=grant(p,p['a'],sql('select email from users where id='+lit(u)));assert r['access_id']==access;assert sql('select count(*) from user_course where \"user\"='+lit(u))=='2';assert sql('select '+lit(u)+'=any(users) from chats where id='+lit(p['h']))=='t'
 s.check('old non-paid placeholder gets the same chat/recording rights without duplicate primary row',placeholder)
 def optout():
  p=product(False,False);u=user();grant(p,p['a'],sql('select email from users where id='+lit(u)));assert sql('select count(*) from user_course where \"user\"='+lit(u))=='1'
 s.check('disabled chat/recording do not receive additional entitlements',optout)
 def malformed():
  p=product();other=product();sql('update streams set recording_course='+lit(other['r'])+' where id='+lit(p['t']));before=sql('select count(*) from user_course');denied(lambda:grant(p,p['a'],'buyer@example.invalid'));assert sql('select count(*) from user_course')==before
 s.check('cannot gift another author recording through a forged stream link',malformed)
 def parallel():
  p=product();u=user();email=sql('select email from users where id='+lit(u))
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rs=list(pool.map(lambda _:grant(p,p['a'],email),range(2)))
  assert sorted(r['status'] for r in rs)==['already_has_access','granted'];assert sql('select count(*) from user_course where \"user\"='+lit(u))=='2'
 s.check('parallel manual requests grant exactly one backing and one recording access',parallel)
 def payment_race():
  p=product();u=user();email=sql('select email from users where id='+lit(u));sh,o,proof=[uid() for _ in range(3)]
  sql("insert into shop(id,owner,course_id,price,quantity) values(%s,%s,%s,1000,1);insert into public.\"order\"(id,owner,summ,course_positions) values(%s,%s,1000,array[%s]);insert into payment_audit(id,order_id,event,detail) values(%s,%s,'ok','{\"sig_valid\":true,\"payment_status\":\"success\",\"verify\":{\"ok\":true}}')"%(lit(sh),lit(u),lit(p['c']),lit(o),lit(u),lit(sh),lit(proof),lit(o)))
  plan=[dict(shop_id=sh,course_id=p['c'],author_id=p['a'],price=1000,author_commission=82,author_amount='820.00')]
  def paid_callback():return json.loads(sql("set role service_role;select fulfill_paid_course_order(%s,'synthetic-payment',%s,%s::jsonb)"%(lit(o),lit(proof),lit(json.dumps(plan)))).splitlines()[-1])
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   manual=pool.submit(grant,p,p['a'],email);paid=pool.submit(paid_callback);assert manual.result()['status'] in ['granted','already_has_access'];assert paid.result()['status']=='fulfilled'
  assert sql('select count(*) from user_course where \"user\"='+lit(u))=='2'
  assert sql('select buy from user_course where \"user\"='+lit(u)+' and course='+lit(p['c']))=='t'
  assert sql('select count(*) from sales where position='+lit(sh))=='1';assert sql('select count(*) from order_access_fulfillments where order_id='+lit(o))=='1';assert sql('select \"Ammount\" from users where id='+lit(p['a']))=='820.00'
 s.check('manual grant racing a verified payment preserves single entitlement, single sale and one author credit',payment_race)
 def failure():
  p=product();u=user();sql("create function test_manual_failure() returns trigger language plpgsql as $$begin if NEW.course=%s::uuid then raise exception 'synthetic_recording_failure';end if;return NEW;end$$;create trigger test_manual_failure before insert on user_course for each row execute function test_manual_failure()"%lit(p['r']))
  denied(lambda:grant(p,p['a'],sql('select email from users where id='+lit(u))));assert sql('select count(*) from user_course where \"user\"='+lit(u))=='0';assert sql('select '+lit(u)+'=any(users) from chats where id='+lit(p['h']))=='f';sql('drop trigger test_manual_failure on user_course;drop function test_manual_failure()')
 s.check('recording failure rolls back backing and chat membership',failure)
 def invalid_stream():
  p=product();sql('update streams set price=0 where id='+lit(p['t']));denied(lambda:grant(p,p['a'],'buyer@example.invalid'))
 s.check('free stream cannot use paid manual-grant RPC',invalid_stream)
 def rest():
  sql('create role mg_pgrst_authenticator login noinherit;grant anon,authenticated,service_role to mg_pgrst_authenticator;grant usage on schema public to anon,authenticated,service_role')
  config=s.tmp/'postgrest.conf';config.write_text('\n'.join([f'db-uri="postgres://mg_pgrst_authenticator@127.0.0.1:{s.pgport}/{m.DB}"','db-schemas="public"','db-anon-role="anon"','server-host="127.0.0.1"',f'server-port={s.apiport}',f'jwt-secret="{s.secret}"','jwt-aud="mg-fixture"','log-level="crit"']));config.chmod(0o600)
  s.restlog=(s.tmp/'postgrest.log').open('w');s.rest=subprocess.Popen([str(m.REST),str(config)],stdout=s.restlog,stderr=s.restlog,env=s.env)
  for _ in range(50):
   try:s.request('/');break
   except OSError:time.sleep(.1)
  p=product();u=user();args={'p_stream_id':p['t'],'p_email':sql('select email from users where id='+lit(u))};s.expect(s.rpc('grant_stream_access_by_email',args),denied=True);assert s.expect(s.rpc('grant_stream_access_by_email',args,p['a']),status=200)['status']=='granted';s.expect(s.rpc('grant_stream_access_by_email',args,u),denied=True)
 s.check('real PostgREST owner JWT works; guest and other viewer JWT are rejected',rest)
 def rollback():
  before=sql('select count(*) from user_course');s.cmd([m.PG/'psql','-X','-v','ON_ERROR_STOP=1','-f',ROOT/'supabase/migrations/rollback_stream_manual_access.sql']);assert sql('select count(*) from user_course')==before;assert sql("select to_regprocedure('public.grant_stream_access_by_email(uuid,text)') is null")=='t'
 s.check('rollback removes only RPC and preserves all granted access',rollback)
 print(json.dumps({'pass':sum(r['status']=='PASS' for r in s.results),'fail':sum(r['status']=='FAIL' for r in s.results),'results':s.results}));assert all(r['status']=='PASS' for r in s.results)
finally:s.stop();print('Temporary PostgreSQL/PostgREST stopped')
