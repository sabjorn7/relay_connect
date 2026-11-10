#!/usr/bin/env python3
"""Synthetic PostgreSQL 15/PostgREST on loopback, no production env or callbacks."""
import pathlib,importlib.util,uuid,json,subprocess,concurrent.futures,time
ROOT=pathlib.Path(__file__).resolve().parents[1];sp=importlib.util.spec_from_file_location('stand',ROOT/'tests/helpers/checkout_stand.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);s=m.Stand()
A='10000000-0000-4000-8000-000000000001';ADMIN='10000000-0000-4000-8000-000000000002';BUYER='10000000-0000-4000-8000-000000000003'
def uid():return str(uuid.uuid4())
def q(x):return "'"+str(x).replace("'","''")+"'"
def sql(x):return s.sql(x)
def jsval(x):return json.loads(sql(x))
def asrole(role,x,u=None):return sql('set role '+role+';'+('set request.jwt.claim.sub='+q(u)+';' if u else '')+x).splitlines()[-1]
def denied(fn):
 try:fn()
 except RuntimeError:return
 raise AssertionError('expected denial')
def setrate(author,category,value):return json.loads(asrole('authenticated','select admin_set_author_share(%s,%s,%s,\'Synthetic test\')'%(q(author),q(category),value),ADMIN))
def snapshot():return jsval("select json_build_object('balances',(select json_agg(json_build_array(id,\"Ammount\") order by id) from users),'sales',(select count(*) from sales),'access',(select count(*) from user_course),'receipts',(select count(*) from order_access_fulfillments),'paid_orders',(select count(*) from public.\"order\" where paid is true))")
def course(owner=A,kind='courses',price=1000):
 c=uid();cat={'courses':'Онлайн-курс','streams':'Трансляции','events':'Мероприятия','recording':'Запись семинара'}[kind]
 sql('insert into course(id,owner,"Title","Category","Price","DurationLong") values(%s,%s,\'Synthetic\',%s,%s,0)'%(q(c),q(owner),q(cat),price))
 if kind=='streams':sql('insert into streams(id,author,backing_course_id,price) values(%s,%s,%s,%s)'%(q(uid()),q(owner),q(c),price))
 if kind=='events':sql('insert into events(id,owner,backing_course_id,price) values(%s,%s,%s,%s)'%(q(uid()),q(owner),q(c),price))
 return c

def order(courses):
 o=uid();ids=[];total=0
 for c,price in courses:
  sh=uid();ids.append(sh);total+=price;sql('insert into shop(id,owner,course_id,price,quantity) values(%s,%s,%s,%s,1)'%(q(sh),q(BUYER),q(c),price))
 sql('insert into public."order"(id,owner,summ,course_positions) values(%s,%s,%s,array[%s])'%(q(o),q(BUYER),total,','.join(q(x) for x in ids)));return o,ids

def plan(o):
 rates=json.loads(asrole('service_role','select get_order_author_shares('+q(o)+')'))['rates']
 data=jsval('select json_build_object(\'order\',row_to_json(o),\'positions\',(select json_agg(sh) from shop sh where sh.id::text=any(o.course_positions)),\'courses\',(select json_agg(c) from course c where c.id in(select course_id from shop where id::text=any(o.course_positions))),\'authors\',(select json_agg(u) from users u where u.id in(select owner from course where id in(select course_id from shop where id::text=any(o.course_positions))))) from public."order" o where id='+q(o))
 data['rates']=rates
 code="import {buildAuthorSharePlan} from './scripts/lib/author-share-plan.mjs';let s='';for await(const c of process.stdin)s+=c;const d=JSON.parse(s);console.log(JSON.stringify(buildAuthorSharePlan(d.order,d.positions,d.courses,d.authors,d.rates)))"
 return json.loads(subprocess.run(['node','--input-type=module','-e',code],input=json.dumps(data),text=True,capture_output=True,cwd=ROOT,check=True).stdout)

def fulfill(o,p=None,payment=None):
 payment=payment or 'synthetic-'+o;proof=uid();sql('insert into payment_audit(id,order_id,event,detail) values(%s,%s,\'ok\',\'{"sig_valid":true,"payment_status":"success","verify":{"ok":true}}\')'%(q(proof),q(o)))
 return json.loads(asrole('service_role','select fulfill_paid_course_order(%s,%s,%s,%s::jsonb)'%(q(o),q(payment),q(proof),q(json.dumps(p if p is not None else plan(o))))))

def club(author=A,amount=1000,payment=None):
 c,sub,o=uid(),uid(),uid();payment=payment or 'club-'+o
 sql('insert into clubs(id,owner,title,price) values(%s,%s,\'Synthetic club\',%s);insert into club_subs(id,club,suber) values(%s,%s,%s);insert into public."order"(id,owner,subscription,paid,payment_id,summ) values(%s,%s,true,true,%s,%s)'%(q(c),q(author),amount,q(sub),q(c),q(BUYER),q(o),q(BUYER),q(payment),amount))
 return dict(c=c,sub=sub,o=o,payment=payment,amount=amount)
def settle(x):return json.loads(asrole('service_role','select settle_club_author_share(%s,%s,%s,%s,%s,%s,\'Synthetic subscription\')'%(q(x['o']),q(x['payment']),q(x['c']),q(x['sub']),x['amount'],q(x['sub']))))
try:
 s.start()
 for file in ['tests/fixtures/unified-checkout.sql','supabase/migrations/pending_unified_checkout.sql','reviews/2026-11-10-author-shares/baseline/fulfill_paid_course_order.sql','reviews/2026-11-10-author-shares/baseline/checkout_complete_zero.sql','tests/author-shares.fixture.sql']:
  s.cmd([m.PG/'psql','-X','-v','ON_ERROR_STOP=1','-f',ROOT/file])
 old=snapshot();s.cmd([m.PG/'psql','-X','-v','ON_ERROR_STOP=1','-f',ROOT/'supabase/migrations/pending_author_shares.sql'])
 s.check('migration preserves old balances, sales, paid orders, accesses and receipts',lambda: (_ for _ in ()).throw(AssertionError()) if snapshot()!=old else None)
 def backfill():assert sql('select "authorCommissionCourses"=82 and "authorCommissionClub"=82 and "authorCommissionStreams"=82 and "authorCommission"=82 from users where id='+q(A))=='t'
 s.check('all three initial shares exactly copy the legacy author percentage',backfill)
 def rollback_before_use():
  text=(ROOT/'supabase/migrations/rollback_author_shares_before_use.sql').read_text();body=text.split('begin;\n',1)[1].rsplit('commit;',1)[0];assert '2afe7c07555d1ad45791b92b7f24ab45' in sql('begin;'+body+"select md5(pg_get_functiondef('public.fulfill_paid_course_order(uuid,text,uuid,jsonb)'::regprocedure));rollback;").splitlines()
 s.check('before-use rollback restores exact original financial RPC inside a rolled-back test transaction',rollback_before_use)
 def register():
  u=uid();asrole('authenticated','insert into users(id,"Name") values('+q(u)+",'Synthetic new user')",BUYER);assert sql('select "authorCommissionCourses"=100 and "authorCommissionClub"=100 and "authorCommissionStreams"=100 from users where id='+q(u))=='t'
 s.check('existing user INSERT initializes all three fields without client changes',register)
 def admin():
  setrate(A,'courses',65);setrate(A,'club',70);setrate(A,'streams',55);assert sql('select "authorCommission"=82 and "authorCommissionCourses"=65 and "authorCommissionClub"=70 and "authorCommissionStreams"=55 from users where id='+q(A))=='t';assert sql('select count(*) from admin_money_log')=='3'
 s.check('admin edits only selected share with atomic audit; event percentage unchanged',admin)
 def access():
  denied(lambda:asrole('authenticated','select admin_set_author_share(%s,\'courses\',99,\'x\')'%q(A),BUYER));denied(lambda:asrole('anon','select admin_set_author_share(%s,\'courses\',99,\'x\')'%q(A)));denied(lambda:asrole('authenticated','update users set "authorCommissionCourses"=99 where id='+q(A),BUYER));denied(lambda:asrole('authenticated','insert into users(id,"authorCommissionClub") values('+q(uid())+',99)',BUYER))
 s.check('guest/viewer cannot edit or insert financial rates directly or through admin RPC',access)
 def invalid():
  for category,value in [('events',50),('unknown',50),('courses',-1),('club',101)]:denied(lambda:setrate(A,category,value))
  denied(lambda:asrole('authenticated','select admin_set_author_share(%s,\'courses\',50,\' \')'%q(A),ADMIN))
 s.check('events are excluded; bad category/range/missing reason rejected',invalid)
 def kinds():
  for kind,expected in [('courses',65),('streams',55),('events',82),('recording',65)]:
   c=course(kind=kind);
   if kind=='recording':
    backing=course(kind='streams');sql('update streams set recording_course='+q(c)+',recording_course_enabled=true where backing_course_id='+q(backing))
   o,ids=order([(c,1000)]);p=plan(o);assert p[0]['author_commission']==expected;(r:=fulfill(o,p));assert r['status']=='fulfilled';assert sql('select amount from sales where position='+q(ids[0]))==str(expected*10)+'.00'
 s.check('course, live backing, standalone recording and event select the correct distinct rates',kinds)
 def orphan_event():
  c=course(kind='courses');sql('update course set "Category"=\'Мероприятия\' where id='+q(c));o,_=order([(c,1000)]);assert plan(o)[0]['author_commission']==82;assert fulfill(o)['status']=='fulfilled'
 s.check('legacy event-labelled courses without events linkage retain legacy rate',orphan_event)
 def mixed():
  other=uid();sql('insert into users(id,"authorCommission") values('+q(other)+',90)');c=course();t=course(kind='streams');e=course(kind='events');d=course(other);o,ids=order([(c,1000),(t,3000),(e,2000),(d,500)]);before=sql('select "Ammount" from users where id='+q(A));r=fulfill(o);assert r['positions']==4 and r['authors']==2;assert sql('select count(*) from sales where position in('+','.join(q(i) for i in ids)+')')=='4';assert sql('select "Ammount"-('+before+') from users where id='+q(A))=='3940.00';assert sql('select "Ammount" from users where id='+q(other))=='450.00'
 s.check('four mixed positions and multiple authors receive exactly their own shares',mixed)
 def replay():
  o,_=order([(course(),1000)]);assert fulfill(o)['status']=='fulfilled';before=snapshot();assert fulfill(o)['status']=='already_completed';assert snapshot()==before
 s.check('BuyCourse duplicate callback never repeats money or access',replay)
 def parallel():
  o,_=order([(course(),1000)])
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rs=list(pool.map(lambda _:fulfill(o),range(2)))
  assert sorted(r['status'] for r in rs)==['already_completed','fulfilled']
 s.check('parallel BuyCourse callback remains idempotent',parallel)
 def changed_share():
  o,_=order([(course(),1000)]);p=plan(o);setrate(A,'courses',66);before=snapshot();denied(lambda:fulfill(o,p));assert snapshot()==before;setrate(A,'courses',65)
 s.check('stale n8n share plan fails atomically without mismatched credits or access',changed_share)
 def failure():
  o,_=order([(course(),1000)]);sql('insert into test_fail_credit values('+q(A)+')');before=snapshot();denied(lambda:fulfill(o));assert snapshot()==before;sql('delete from test_fail_credit')
 s.check('financial error still rolls back all BuyCourse sales, credits and access',failure)
 def hist():
  before=snapshot();r=fulfill('20000000-0000-4000-8000-000000000001',p=[],payment='historical-fixture');assert r['status']=='legacy_paid_skipped';assert snapshot()==before
 s.check('historical paid order is not replayed or recalculated',hist)
 def clubs():
  x=club();before=sql('select "Ammount" from users where id='+q(A));r=settle(x);assert r['author_amount']==700;assert sql('select "Ammount"-('+before+') from users where id='+q(A))=='700.00';before=snapshot();assert settle(x)['status']=='already_completed';assert snapshot()==before
 s.check('club current rate applies once with receipt and atomic balance update',clubs)
 def club_repeat():
  x=club();
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rs=list(pool.map(lambda _:settle(x),range(2)))
  assert sorted(r['status'] for r in rs)==['already_completed','fulfilled']
 s.check('parallel club callback does not create duplicate sale or credit',club_repeat)
 def renewal():
  x=club();assert settle(x)['author_amount']==700;setrate(A,'club',60);x['o']=uid();x['payment']='renewal-'+x['o'];sql('insert into public."order"(id,owner,subscription,paid,payment_id,summ) values(%s,%s,true,true,%s,1000)'%(q(x['o']),q(BUYER),q(x['payment'])));assert settle(x)['author_amount']==600;setrate(A,'club',70)
 s.check('existing club next renewal uses current club rate, not original subscription rate',renewal)
 def old_club():
  x=club();x['payment']='historical-fixture';assert settle(x)['status']=='historical_skipped';x['o']='20000000-0000-4000-8000-000000000002';x['payment']='new-callback-for-null-legacy';assert settle(x)['status']=='historical_skipped'
 s.check('historical club payments including null-payment-id paid orders never receive another credit',old_club)
 def club_failure():
  x=club();sql('insert into test_fail_credit values('+q(A)+')');before=snapshot();denied(lambda:settle(x));assert snapshot()==before;assert sql('select count(*) from author_share_private.club_receipts where payment_id='+q(x['payment']))=='0';sql('delete from test_fail_credit');assert settle(x)['status']=='fulfilled'
 s.check('club credit failure rolls back sale and receipt; safe retry completes once',club_failure)
 def rounding():
  vals=[1.005,2.675,-1.005,0,0.0049,0.005,0.015,100.105,999999.995,1e-10,1e18]
  expected=json.loads(subprocess.run(['node','-e','console.log(JSON.stringify('+json.dumps(vals)+'.map(x=>Number(x.toFixed(2)))))'],capture_output=True,text=True,check=True).stdout)
  actual=jsval('select json_agg(author_share_private.js_fixed2(v::float8)) from unnest(array['+','.join(str(v) for v in vals)+']::numeric[]) v');assert actual==expected,(actual,expected)
 s.check('SQL club fixed2 matches actual JS on half-cent, sign, tiny and large golden values',rounding)
 def club_rounding():
  for amount,rate,balance in [(1.005,100,0),(1.015,82,1.005),(2.675,33.33,123.456),(1000,0,1.005),(9999.99,100,0)]:
   setrate(A,'club',rate) if sql('select "authorCommissionClub" from users where id='+q(A))!=str(rate) else None;sql('update users set "Ammount"='+str(balance)+' where id='+q(A));x=club(amount=amount);r=settle(x);expected=json.loads(subprocess.run(['node','-e',f'const raw={amount}*({rate}/100);console.log(JSON.stringify([Number(raw.toFixed(2)),Number((raw+{balance}).toFixed(2))]))'],capture_output=True,text=True,check=True).stdout);assert float(r['author_amount'])==expected[0];assert float(sql('select "Ammount" from users where id='+q(A)))==expected[1]
 s.check('club preserves both original sale rounding and original final-balance rounding',club_rounding)
 def zero_and_boundaries():
  setrate(A,'courses',0);o,_=order([(course(),1000)]);r=fulfill(o);assert r['status']=='fulfilled';assert plan(o)[0]['author_amount']=='0.00';setrate(A,'courses',100);o,_=order([(course(),1000)]);assert plan(o)[0]['author_amount']=='1000.00';fulfill(o);setrate(A,'courses',65)
 s.check('zero and full author percentages have no truthy-default fallback',zero_and_boundaries)
 def discount():
  o,ids=order([(course(price=1000),725.50)]);assert plan(o)[0]['author_amount']=='471.57';assert fulfill(o)['status']=='fulfilled';assert float(sql('select price from sales where position='+q(ids[0])))==725.50
 s.check('discounted shop price is used without recomputing catalog price or promotion',discount)
 def zero_complete():
  c=course(price=1000);sql("insert into promo_codes(id,code,discount_type,discount_value,scope_type) values("+q(uid())+",'SYNTHETICZERO','percent',100,'all')");row=json.loads(asrole('authenticated','select cart_add_product(\'course\',%s,\'full\',false,true)'%q(c),BUYER));o=json.loads(asrole('authenticated',"select checkout_prepare(%s,array[%s]::uuid[],'SYNTHETICZERO')"%(q(uid()),q(row['id'])),BUYER));r=json.loads(asrole('service_role','select checkout_complete_zero(%s,%s)'%(q(o['order_id']),q(BUYER))));assert r['status']=='fulfilled'
 s.check('existing zero checkout remains compatible with selected category rates',zero_complete)
 def parallel_club_orders():
  sql('update users set \"Ammount\"=0,\"authorCommissionClub\"=70 where id='+q(A));x,y=club(),club()
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rs=list(pool.map(settle,[x,y]))
  assert all(r['status']=='fulfilled' for r in rs);assert float(sql('select \"Ammount\" from users where id='+q(A)))==1400
 s.check('different simultaneous club payments do not overwrite the same author balance',parallel_club_orders)
 def more_rounding():
  code="let n=7;const a=[];for(let i=0;i<300;i++){n=(Math.imul(n,1664525)+1013904223)>>>0;const x=(n%100000000)/1000-50000;a.push([x,Number(x.toFixed(2))]);}console.log(JSON.stringify(a))";pairs=json.loads(subprocess.run(['node','-e',code],capture_output=True,text=True,check=True).stdout)
  actual=jsval('select json_agg(author_share_private.js_fixed2(v::float8)) from unnest(array['+','.join(str(x[0]) for x in pairs)+']::numeric[]) v');assert actual==[p[1] for p in pairs]
 s.check('300 additional deterministic JS half-cent and ordinary rounding comparisons match',more_rounding)
 def rest():
  sql('create role mg_pgrst_authenticator login noinherit;grant anon,authenticated,service_role to mg_pgrst_authenticator;grant usage on schema public to anon,authenticated,service_role')
  config=s.tmp/'postgrest.conf';config.write_text('\n'.join([f'db-uri="postgres://mg_pgrst_authenticator@127.0.0.1:{s.pgport}/{m.DB}"','db-schemas="public"','db-anon-role="anon"','server-host="127.0.0.1"',f'server-port={s.apiport}',f'jwt-secret="{s.secret}"','jwt-aud="mg-fixture"','log-level="crit"']));config.chmod(0o600);s.restlog=(s.tmp/'postgrest.log').open('w');s.rest=subprocess.Popen([str(m.REST),str(config)],stdout=s.restlog,stderr=s.restlog,env=s.env)
  for _ in range(50):
   try:s.request('/');break
   except OSError:time.sleep(.1)
  o,_=order([(course(),1000)]);args={'p_order_id':o};s.expect(s.rpc('get_order_author_shares',args),denied=True);s.expect(s.rpc('get_order_author_shares',args,BUYER),denied=True);assert s.expect(s.rpc('get_order_author_shares',args,'service'),status=200)['rates'][0]['category']=='courses';s.expect(s.rpc('admin_set_author_share',{'p_user':A,'p_category':'streams','p_value':54,'p_reason':'Synthetic'},BUYER),denied=True);assert s.expect(s.rpc('admin_set_author_share',{'p_user':A,'p_category':'streams','p_value':54,'p_reason':'Synthetic'},ADMIN),status=200)['new']==54;x=club();body={'p_order_id':x['o'],'p_payment_id':x['payment'],'p_club_id':x['c'],'p_subscription_id':x['sub'],'p_amount':x['amount'],'p_position_id':x['sub'],'p_position_name':'Synthetic'};s.expect(s.rpc('settle_club_author_share',body,BUYER),denied=True);assert s.expect(s.rpc('settle_club_author_share',body,'service'),status=200)['status']=='fulfilled'
 s.check('real PostgREST exposes owner-admin editing and service-only financial rates',rest)
 def rollback_after_use():
  before=snapshot();denied(lambda:s.cmd([m.PG/'psql','-X','-v','ON_ERROR_STOP=1','-f',ROOT/'supabase/migrations/rollback_author_shares_before_use.sql']));assert snapshot()==before
 s.check('rollback refuses after new rates/credits were used and never undoes financial records',rollback_after_use)
 print(json.dumps({'pass':sum(r['status']=='PASS' for r in s.results),'fail':sum(r['status']=='FAIL' for r in s.results),'results':s.results}));assert all(r['status']=='PASS' for r in s.results)
finally:s.stop();print('Temporary PostgreSQL/PostgREST stopped')
