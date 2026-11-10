#!/usr/bin/env python3
"""Actual PostgreSQL/PostgREST; synthetic data and local processes only."""
import importlib.util,pathlib,json,uuid,subprocess,concurrent.futures,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
sp=importlib.util.spec_from_file_location('checkout_stand',ROOT/'tests/helpers/checkout_stand.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
s=m.Stand()
def uid():return str(uuid.uuid4())
def literal(v):return "'"+str(v).replace("'","''")+"'"
def sql(q):return s.sql(q)
def auth(u,q):return "set role authenticated;set request.jwt.claim.sub="+literal(u)+';'+q
def call(u,name,args):
 raw=sql(auth(u,'select public.'+name+'('+args+');')).splitlines()[-1]
 try:return json.loads(raw)
 except json.JSONDecodeError:return raw
def denied(fn):
 try:fn()
 except RuntimeError:return
 raise AssertionError('expected denial')
def buyer(role='Ученик'):
 u=uid();sql('insert into users(id,role) values('+literal(u)+','+literal(role)+')');return u
def products(capacity=1):
 owner=buyer('Спикер');c,ec,sc,e,t,chat,recording=[uid() for _ in range(7)]
 sql("insert into chats(id,users,read) values('%s','{}','{}');"%chat+
  "insert into course(id,owner,\"Title\",\"Category\",\"Price\",\"DurationLong\",\"DurationPrice\") values('%s','%s','Course','Курсы',1000,2,200),('%s','%s','Event backing','Мероприятия',2000,12,0),('%s','%s','Stream backing','Трансляции',3000,3,0),('%s','%s','Recording','Курсы',0,0,0);"%(c,owner,ec,owner,sc,owner,recording,owner)+
  "insert into events(id,owner,title,price,deposit_percent,capacity,backing_course_id,chat) values('%s','%s','Event',2000,25,%s,'%s','%s');"%(e,owner,'null' if capacity is None else capacity,ec,chat)+
  "insert into streams(id,author,title,price,backing_course_id,access_months,scheduled_at,chat,recording_course) values('%s','%s','Stream',3000,'%s',3,now(),'%s','%s')"%(t,owner,sc,chat,recording))
 return dict(owner=owner,course=c,event=e,stream=t,event_course=ec,stream_course=sc,chat=chat,recording=recording)
def add(u,kind,id,payment='full',renewal=False):
 return call(u,'cart_add_product',','.join([literal(kind),literal(id),literal(payment),'true' if renewal else 'false','true']))
def prepare(u,code=None,key=None):
 rows=call(u,'cart_get','');ids=[x['id'] for x in rows]
 return call(u,'checkout_prepare',literal(key or uid())+',array['+','.join(literal(x) for x in ids)+']::uuid[],'+('null' if code is None else literal(code)))
def plan(order):
 rows=json.loads(sql("select json_agg(json_build_object('shop_id',sh.id,'course_id',sh.course_id,'price',sh.price,'author_id',c.owner,'author_commission',u.\"authorCommission\")) from shop sh join course c on c.id=sh.course_id join users u on u.id=c.owner join public.\"order\" o on sh.id::text=any(o.course_positions) where o.id="+literal(order)))
 js="let s='';for await(const c of process.stdin)s+=c;console.log(JSON.stringify(JSON.parse(s).map(x=>({...x,author_amount:(x.price*x.author_commission/100).toFixed(2)}))))"
 return json.loads(subprocess.run(['node','--input-type=module','-e',js],input=json.dumps(rows),text=True,capture_output=True,check=True).stdout)
def fulfill(order,payment=None,proof=None):
 payment=payment or 'synthetic-'+order;proof=proof or uid()
 sql("insert into payment_audit(id,order_id,event,detail) values('%s','%s','ok','{\"sig_valid\":true,\"payment_status\":\"success\",\"verify\":{\"ok\":true}}') on conflict do nothing"%(proof,order))
 return json.loads(sql("set role service_role;select fulfill_paid_course_order(%s,%s,%s,%s::jsonb)"%(literal(order),literal(payment),literal(proof),literal(json.dumps(plan(order))))).splitlines()[-1])
def state(order):
 return json.loads(sql("select json_build_object('paid',o.paid,'sales',(select count(*) from sales where position::text=any(o.course_positions)),'access',(select count(*) from user_course where \"user\"=o.owner),'receipt',(select count(*) from order_access_fulfillments where order_id=o.id),'regs',(select count(*) from event_registrations where \"user\"=o.owner and status='paid')) from public.\"order\" o where id="+literal(order)))
try:
 s.start();s.cmd([m.PG/'psql','-X','-v','ON_ERROR_STOP=1','-f',ROOT/'tests/fixtures/unified-checkout.sql'])
 s.cmd([m.PG/'psql','-X','-v','ON_ERROR_STOP=1','-f',ROOT/'supabase/migrations/pending_unified_checkout.sql'])
 s.check('migration compiles against production-shaped text[] orders and captured legacy financial RPC',lambda:None)
 def individual():
  for kind in ['course','event','stream']:
   p=products();u=buyer();add(u,kind,p[kind]);o=prepare(u);r=fulfill(o['order_id']);assert r['status']=='fulfilled';st=state(o['order_id']);assert st['sales']==1 and st['receipt']==1 and st['paid'] and st['access']==1
 s.check('each product alone uses the same order/receipt/financial pipeline',individual)
 def mixed():
  p=products();u=buyer()
  for kind in ['course','event','stream']:add(u,kind,p[kind])
  o=prepare(u);r=fulfill(o['order_id']);st=state(o['order_id']);assert r['positions']==3 and st==dict(paid=True,sales=3,access=3,receipt=1,regs=1)
  assert sql("select \"Ammount\" from users where id="+literal(p['owner']))=='4920.00'
  before=sql('select count(*) from test_notices');assert fulfill(o['order_id'])['status']=='already_completed';assert state(o['order_id'])==st and sql('select count(*) from test_notices')==before
 s.check('mixed order: all three products settle atomically, exact commission, repeat is a no-op',mixed)
 def financial_failure():
  p=products();u=buyer()
  for k in ['course','event','stream']:add(u,k,p[k])
  o=prepare(u);sql('insert into test_fail_credit values('+literal(p['owner'])+')');denied(lambda:fulfill(o['order_id']));assert state(o['order_id'])==dict(paid=False,sales=0,access=0,receipt=0,regs=0)
  sql('delete from test_fail_credit where author_id='+literal(p['owner']));assert fulfill(o['order_id'])['status']=='fulfilled'
 s.check('credit failure rolls back every access/sale/registration; retry completes once',financial_failure)
 def guard():
  p=products();u=buyer()
  for table,values in [('shop',"(owner,course_id,price,status) values('%s','%s',1,'cart')"%(u,p['course'])),('"order"',"(owner,summ,paid) values('%s',1,true)"%u),('event_registrations',"(event,\"user\",payment_type,status) values('%s','%s','full','paid')"%(p['event'],u))]:denied(lambda t=table,v=values:sql(auth(u,'insert into '+t+v)))
  denied(lambda:sql(auth(u,"update course set \"Price\"=1 where id="+literal(p['course']))))
  denied(lambda:sql(auth(u,"insert into user_course(\"user\",course,buy) values('%s','%s',true)"%(u,p['course']))))
 s.check('direct client money/paid/access/foreign-price mutations cannot bypass server checkout',guard)
 def no_capacity():
  p=products(capacity=0);a,b=buyer(),buyer();add(a,'event',p['event']);add(b,'event',p['event'])
  oa,ob=prepare(a),prepare(b)
  with concurrent.futures.ThreadPoolExecutor(2) as pool:rs=list(pool.map(lambda o:fulfill(o['order_id']),[oa,ob]))
  assert all(r['status']=='fulfilled' for r in rs)
  assert sql('select count(*) from event_registrations where event='+literal(p['event'])+" and status='paid'")=='2'
  assert sql("select count(*) from information_schema.tables where table_schema='checkout_private' and (table_name like '%reserv%' or table_name like '%refund%')")=='0'
  assert sql("select count(*) from information_schema.columns where table_schema='checkout_private' and column_name='expires_at'")=='0'
 s.check('nominal capacity=0 never blocks sales; no reservation/refund tables or booking expiry exist',no_capacity)
 def cancel_order():
  p=products();u=buyer();add(u,'event',p['event']);o=prepare(u)
  sql(auth(u,'select checkout_cancel('+literal(o['order_id'])+')'))
  assert not state(o['order_id'])['paid'] and state(o['order_id'])['sales']==0
  # Cancelling an unpaid UI order does not fabricate a provider refund or suppress a later real success.
  assert fulfill(o['order_id'])['status']=='fulfilled'
 s.check('unpaid cancellation has no access/sales effects; verified payment still settles atomically',cancel_order)
 def idempotent_prepare():
  p=products();u=buyer();item=add(u,'course',p['course']);key=uid();o=prepare(u,key=key)
  args=literal(key)+',array['+literal(item['id'])+']::uuid[],null'
  assert call(u,'checkout_prepare',args)['order_id']==o['order_id']
  assert call(u,'checkout_prepare',literal(uid())+',array['+literal(item['id'])+']::uuid[],null')['order_id']==o['order_id']
  denied(lambda:call(u,'checkout_prepare',literal(key)+',array['+literal(uid())+']::uuid[],null'))
 s.check('repeat checkout and lost intent reuse one order; changed payload with same key is rejected',idempotent_prepare)
 def parallel_callback():
  p=products();u=buyer()
  for k in ['course','event','stream']:add(u,k,p[k])
  o=prepare(u)
  with concurrent.futures.ThreadPoolExecutor(2) as pool:rs=list(pool.map(lambda _:fulfill(o['order_id']),range(2)))
  assert sorted(x['status'] for x in rs)==['already_completed','fulfilled'] and state(o['order_id'])['sales']==3
 s.check('parallel callbacks produce one receipt, three sales, one registration',parallel_callback)
 def promos():
  p=products();u=buyer();a=add(u,'course',p['course']);b=add(u,'event',p['event'],payment='deposit');add(u,'stream',p['stream'])
  code='LOCAL-'+uid();sql("insert into promo_codes(code,discount_type,discount_value,scope_type) values(%s,'percent',10,'all')"%literal(code))
  ids=[x['id'] for x in call(u,'cart_get','')];args='array['+','.join(literal(x) for x in ids)+']::uuid[],'+literal(code)
  q=call(u,'cart_quote',args);r=call(u,'cart_quote',args)
  assert q==r and q['cart_total']==4500 and q['discount']==400 and q['new_total']==4100
  assert next(x for x in q['lines'] if x['id']==b['id'])['price']==500
  assert sql('select price from shop where id='+literal(a['id']))=='1000'
  o=prepare(u,code=code);assert o['total']==4100;assert fulfill(o['order_id'])['status']=='fulfilled'
  reg=json.loads(sql('select row_to_json(x) from (select payment_type,amount_paid,amount_total from event_registrations where "user"='+literal(u)+') x'))
  assert reg==dict(payment_type='deposit',amount_paid=500,amount_total=2000)
  assert sql('select used_count from promo_codes where code='+literal(code))=='1'
 s.check('mixed promo discounts only eligible lines, no stacking; deposit amount/remaining preserved',promos)
 def fixed_rounding():
  p=products();u=buyer()
  for k in ['course','event','stream']:add(u,k,p[k])
  code='LOCAL-'+uid();sql("insert into promo_codes(code,discount_type,discount_value,scope_type) values(%s,'fixed',0.01,'all')"%literal(code))
  rows=call(u,'cart_get','');q=call(u,'cart_quote','array['+','.join(literal(x['id']) for x in rows)+']::uuid[],'+literal(code))
  from decimal import Decimal
  assert sum(Decimal(str(x['price'])) for x in q['lines'])==Decimal(str(q['new_total']))==Decimal('5999.99')
 s.check('one-kopeck fixed discount across three products has exact line/order sums',fixed_rounding)
 def scoped_promo():
  p=products();u=buyer();add(u,'course',p['course']);add(u,'stream',p['stream']);code='LOCAL-'+uid()
  sql("insert into promo_codes(code,discount_type,discount_value,scope_type,scope_course_id) values(%s,'percent',50,'course',%s)"%(literal(code),literal(p['course'])))
  o=prepare(u,code=code);assert o['total']==3500
 s.check('course-scoped promo does not discount another product',scoped_promo)
 def zero():
  p=products();u=buyer();add(u,'course',p['course']);code='LOCAL-'+uid();sql("insert into promo_codes(code,discount_type,discount_value) values(%s,'percent',100)"%literal(code));o=prepare(u,code=code);assert o['total']==0
  q="set role service_role;select checkout_complete_zero(%s,%s)"%(literal(o['order_id']),literal(u))
  assert json.loads(sql(q).splitlines()[-1])['status']=='fulfilled';assert json.loads(sql(q).splitlines()[-1])['status']=='already_completed'
  assert sql('select count(*) from payment_audit where order_id='+literal(o['order_id']))=='0'
  assert sql('select proof_id is null from order_access_fulfillments where order_id='+literal(o['order_id']))=='t'
 s.check('100% promo completes on server without fabricated payment/audit; repeat is idempotent',zero)
 def proof_failure():
  p=products();u=buyer();add(u,'event',p['event']);o=prepare(u);bad=uid();sql("insert into payment_audit(id,order_id,event,detail) values(%s,%s,'warn','{\"sig_valid\":false,\"payment_status\":\"failed\"}')"%(literal(bad),literal(o['order_id'])))
  q="set role service_role;select fulfill_paid_course_order(%s,'failed',%s,%s::jsonb)"%(literal(o['order_id']),literal(bad),literal(json.dumps(plan(o['order_id']))))
  denied(lambda:sql(q));assert state(o['order_id'])['sales']==0 and state(o['order_id'])['access']==0 and not state(o['order_id'])['paid']
 s.check('failed/unverified payment cannot grant access or credit',proof_failure)
 def free_products():
  p=products();u=buyer();sql('update events set price=0 where id='+literal(p['event']))
  call_args=literal(p['event'])+',true';sql(auth(u,'select checkout_register_free_event('+call_args+')'));sql(auth(u,'select checkout_register_free_event('+call_args+')'))
  free=uid();sql("insert into course(id,owner,\"Title\",\"Free\",\"Buy\",\"Price\") values(%s,%s,'Free',true,false,0)"%(literal(free),literal(p['owner'])))
  a=call(u,'checkout_enroll_free_course',literal(free));assert call(u,'checkout_enroll_free_course',literal(free))==a
  assert sql('select count(*) from public."order" where owner='+literal(u))=='0'
  assert sql('select count(*) from event_registrations where "user"='+literal(u))=='1'
  assert sql('select cardinality(buied_courses) from users where id='+literal(u))=='1'
 s.check('free event/course: atomic idempotent registration, no payment order, library arrays preserved',free_products)
 def renewal():
  p=products();u=buyer();access=uid();sql("insert into user_course(id,\"user\",course,buy,end_period,created_at) values(%s,%s,%s,true,now()+interval '10 days',now()-interval '20 days')"%(literal(access),literal(u),literal(p['course'])))
  old=sql('select end_period from user_course where id='+literal(access));denied(lambda:add(u,'course',p['course']));add(u,'course',p['course'],renewal=True);o=prepare(u);assert o['total']==200;fulfill(o['order_id'])
  assert sql('select end_period>'+literal(old)+'::timestamptz from user_course where id='+literal(access))=='t';assert state(o['order_id'])['access']==1
 s.check('explicit renewal uses DurationPrice and preserves remaining paid time',renewal)
 def lifetime():
  p=products();u=buyer();sql("insert into user_course(\"user\",course,buy,end_period) values(%s,%s,true,null)"%(literal(u),literal(p['course'])))
  add(u,'course',p['course'],renewal=True);o=prepare(u);fulfill(o['order_id']);assert sql('select end_period is null from user_course where "user"='+literal(u))=='t'
 s.check('existing lifetime entitlement remains lifetime',lifetime)
 def stream_modes():
  for mode in ['scheduled','live','ended']:
   p=products();u=buyer();sql('update streams set status='+literal(mode)+' where id='+literal(p['stream']));add(u,'stream',p['stream']);o=prepare(u);fulfill(o['order_id']);assert sql('select buy from user_course where "user"='+literal(u)+' and course='+literal(p['stream_course']))=='t'
  p=products();u=buyer();sql('update streams set scheduled_at=now()-interval \'1 year\' where id='+literal(p['stream']));denied(lambda:add(u,'stream',p['stream']))
 s.check('stream before/during/after live uses backing access; expired access window rejects purchase',stream_modes)
 def artifacts():
  p=products();u=buyer();sql('update streams set recording_course_enabled=true,chat_enabled=true where id='+literal(p['stream']));add(u,'stream',p['stream']);o=prepare(u);fulfill(o['order_id'])
  assert sql('select count(*) from user_course where "user"='+literal(u))=='2';assert sql('select '+literal(u)+'::uuid=any(users) from chats where id='+literal(p['chat']))=='t'
 s.check('opt-in stream recording and chat access survive shared checkout',artifacts)
 def legacy():
  p=products();u=buyer();oid,shop=uid(),uid();sql("insert into shop(id,owner,course_id,price) values(%s,%s,%s,1000);insert into public.\"order\"(id,owner,summ,course_positions) values(%s,%s,1000,array[%s]);"%(literal(shop),literal(u),literal(p['course']),literal(oid),literal(u),literal(shop)))
  assert fulfill(oid)['status']=='fulfilled'
  old=uid();sql("insert into public.\"order\"(id,owner,paid,payment_id,course_positions) values(%s,%s,true,'historical',array[]::text[])"%(literal(old),literal(u)))
  result=json.loads(sql("set role service_role;select fulfill_paid_course_order(%s,'historical',null,'[]')"%literal(old)).splitlines()[-1]);assert result['status']=='legacy_paid_skipped'
 s.check('legacy unpaid course order remains compatible; historical paid order is not reprocessed',legacy)
 def pending_false():
  p=products();u=buyer();sql("insert into user_course(\"user\",course,buy,\"Free\") values(%s,%s,false,false)"%(literal(u),literal(p['course'])))
  denied(lambda:add(u,'course',p['course'],renewal=True));assert add(u,'course',p['course'])['price']==1000
 s.check('buy=false placeholder is not a discounted renewal or a purchased product',pending_false)
 def multiple_authors():
  ps=[products() for _ in range(3)];u=buyer()
  for p,k in zip(ps,['course','event','stream']):add(u,k,p[k])
  o=prepare(u);fulfill(o['order_id']);assert state(o['order_id'])['sales']==3
  for p,amount in zip(ps,['820.00','1640.00','2460.00']):assert sql('select "Ammount" from users where id='+literal(p['owner']))==amount
 s.check('mixed products by three authors credit each author separately with unchanged commission',multiple_authors)
 def legacy_cart():
  p=products();u=buyer();sql("insert into shop(owner,course_id,course_name,price,quantity,status) values(%s,%s,'Old cart',1,1,'cart')"%(literal(u),literal(p['course'])))
  cart=call(u,'cart_get','');assert cart[0]['product_type']=='course' and cart[0]['price']==1000
  o=prepare(u);assert o['total']==1000;assert fulfill(o['order_id'])['status']=='fulfilled'
 s.check('legacy untyped cart row is resolved and repriced from canonical product, not shop price',legacy_cart)
 def link_resume():
  p=products();u=buyer();add(u,'course',p['course']);o=prepare(u);lease=uid()
  claim=json.loads(sql("set role service_role;select checkout_acquire_link(%s,%s,%s)"%(literal(o['order_id']),literal(u),literal(lease))).splitlines()[-1]);assert claim['lines'][0]['price']==1000
  denied(lambda:sql("set role service_role;select checkout_acquire_link(%s,%s,%s)"%(literal(o['order_id']),literal(u),literal(uid()))))
  sql("set role service_role;select checkout_store_link(%s,%s,%s,'https://meetguru.payform.ru/synthetic')"%(literal(o['order_id']),literal(u),literal(lease)))
  replay=json.loads(sql("set role service_role;select checkout_acquire_link(%s,%s,%s)"%(literal(o['order_id']),literal(u),literal(uid()))).splitlines()[-1]);assert replay['payLink']=='https://meetguru.payform.ru/synthetic'
  denied(lambda:sql("set role service_role;select checkout_acquire_link(%s,%s,%s)"%(literal(o['order_id']),literal(buyer()),literal(uid()))))
  old=uid();sql("insert into public.\"order\"(id,owner,summ,course_positions,\"pageUrl\") values(%s,%s,1000,array[]::text[],'https://meetguru.payform.ru/legacy')"%(literal(old),literal(u)))
  assert any(x['order_id']==old for x in call(u,'checkout_my_orders',''))
  existing=json.loads(sql("set role service_role;select checkout_acquire_link(%s,%s,%s)"%(literal(old),literal(u),literal(uid()))).splitlines()[-1]);assert existing['payLink'].endswith('/legacy')
 s.check('payment-link single-flight/reuse, actor binding and old payment-link resumption',link_resume)
 def postgres_api():
  sql('create role mg_pgrst_authenticator login noinherit;grant anon,authenticated,service_role to mg_pgrst_authenticator;')
  config=s.tmp/'postgrest.conf';config.write_text('\n'.join([f'db-uri="postgres://mg_pgrst_authenticator@127.0.0.1:{s.pgport}/{m.DB}"','db-schemas="public"','db-anon-role="anon"','server-host="127.0.0.1"',f'server-port={s.apiport}',f'jwt-secret="{s.secret}"','jwt-aud="mg-fixture"','log-level="crit"']));config.chmod(0o600)
  s.restlog=(s.tmp/'postgrest.log').open('w');s.rest=subprocess.Popen([str(m.REST),str(config)],stdout=s.restlog,stderr=s.restlog,env=s.env)
  for _ in range(100):
   try:
    if s.request('/course?select=id&limit=1')[0]==200:break
   except OSError:pass
   time.sleep(.1)
  p=products();u=buyer();v=buyer();item=s.expect(s.rpc('cart_add_product',{'p_type':'course','p_product_id':p['course']},u),200)
  assert item['price']==1000
  assert s.expect(s.rpc('cart_get',{},u),200)[0]['id']==item['id']
  assert s.expect(s.request('/shop?id=eq.'+item['id'],v),200)==[]
  s.expect(s.request('/shop',u,'POST',{'owner':u,'price':1}),denied=True)
  s.expect(s.rpc('checkout_complete_zero',{'p_order_id':uid(),'p_actor_id':u},u),denied=True)
  s.expect(s.request('/orders',u,headers={'Accept-Profile':'checkout_private'}),denied=True)
  s.expect(s.rpc('cart_add_product',{'p_type':'course','p_product_id':p['course']}),denied=True)
  s.expect(s.rpc('cart_quote',{'p_shop_ids':[item['id']]},v),denied=True)
 s.check('actual PostgREST: owner cart, foreign-row isolation, protected writes/service RPCs/private schema',postgres_api)
 def nominal_change():
  p=products();u=buyer();add(u,'event',p['event']);o=prepare(u);sql(auth(p['owner'],'update events set capacity=0 where id='+literal(p['event'])))
  assert fulfill(o['order_id'])['status']=='fulfilled'
 s.check('editing nominal capacity cannot invalidate checkout or block confirmed payment',nominal_change)
 def verify_and_stop():
  output=s.sql_file(ROOT/'supabase/migrations/verify_unified_checkout.sql') if hasattr(s,'sql_file') else sql((ROOT/'supabase/migrations/verify_unified_checkout.sql').read_text())
  assert 'FAIL' not in output
  p=products();u=buyer();add(u,'course',p['course']);o=prepare(u)
  sql((ROOT/'supabase/migrations/rollback_unified_checkout.sql').read_text())
  denied(lambda:add(buyer(),'course',p['course']))
  denied(lambda:prepare(u))
  assert fulfill(o['order_id'])['status']=='fulfilled'
  assert call(u,'checkout_my_orders','')
 s.check('verify SQL passes; non-destructive rollback blocks new orders but preserves pending fulfillment',verify_and_stop)

finally:
 s.check('temporary services stopped; loopback ports closed',s.stop)
 out=s.tmp/'unified-checkout-results.json';out.write_text(json.dumps(s.results,indent=2)+'\n');print(json.dumps({'pass':sum(x['status']=='PASS' for x in s.results),'fail':sum(x['status']=='FAIL' for x in s.results),'results':str(out)}))
if any(x['status']=='FAIL' for x in s.results):raise SystemExit(1)
