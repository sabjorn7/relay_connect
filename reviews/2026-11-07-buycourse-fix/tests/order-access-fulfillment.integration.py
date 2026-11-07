#!/usr/bin/env python3
"""Real PostgreSQL atomic-settlement tests. Fresh loopback cluster, synthetic data only.
Reuses the existing approved launcher; no production API, callback or notification traffic.
"""
import concurrent.futures
import datetime
import importlib.util
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('existing_local_launcher', ROOT/'tests/stream-visibility.integration.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

def uid(n): return '00000000-0000-4000-8000-'+str(n).zfill(12)
stand = launcher.Stand()

def fixture(n,count=1,months=0,paid=False,author_count=1,shared_author=None):
    order,buyer,proof=uid(n),uid(n+10000),uid(n+20000)
    shops=[uid(n*10+i+100000) for i in range(count)]
    courses=[uid(n*10+i+200000) for i in range(count)]
    authors=[shared_author] if shared_author else [uid(n*10+i+300000) for i in range(author_count)]
    payment='synthetic-payment-'+str(n)
    sql="insert into public.\"order\"(id,owner,paid,payment_id,course_positions) values('%s','%s',%s,%s,array[%s]);"%(
        order,buyer,'true' if paid else 'false',"'%s'"%payment if paid else 'null',','.join("'%s'"%s for s in shops))
    for i,a in enumerate(authors):
        sql+="insert into public.users(id,\"Ammount\",\"authorCommission\") values('%s',100,%s) on conflict do nothing;"%(a,70 if i%2==0 else 50)
    plan=[]
    for i,(s,c) in enumerate(zip(shops,courses)):
        author=authors[i%len(authors)];rate=70 if (i%len(authors))%2==0 else 50;price=100+i
        sql+="insert into public.course values('%s','%s','Synthetic course','Course',false,%s);insert into public.shop values('%s','%s','%s',%s);"%(c,author,months,s,buyer,c,price)
        plan.append(dict(shop_id=s,course_id=c,author_id=author,price=price,author_commission=rate,author_amount=format(price*rate/100,'.2f')))
    sql+="insert into public.payment_audit values('%s','%s','ok','%s'::jsonb);"%(
        proof,order,json.dumps({'sig_valid':True,'payment_status':'success','verify':{'ok':True}}))
    stand.sql(sql)
    return dict(order=order,buyer=buyer,proof=proof,courses=courses,shops=shops,authors=authors,payment=payment,plan=plan)

def call(f,plan=None,role='service_role'):
    payload=json.dumps(f['plan'] if plan is None else plan)
    q="set role %s;select public.fulfill_paid_course_order('%s','%s','%s','%s'::jsonb);"%(role,f['order'],f['payment'],f['proof'],payload)
    return json.loads(stand.sql(q).splitlines()[-1])

def state(f):
    return json.loads(stand.sql("select jsonb_build_object('paid',o.paid,'accesses',(select count(*) from public.user_course where \"user\"=o.owner),'sales',(select count(*) from public.sales where position::text=any(o.course_positions)),'receipts',(select count(*) from public.order_access_fulfillments where order_id=o.id)) from public.\"order\" o where o.id='%s';"%f['order']))

def balance(a): return float(stand.sql("select coalesce(\"Ammount\",0) from public.users where id='%s';"%a))
def notices(): return int(stand.sql('select count(*) from public.test_purchase_notices;'))
def snapshot(f):
    return stand.sql("select jsonb_build_object('accesses',(select jsonb_agg(to_jsonb(uc) order by id) from public.user_course uc where \"user\"='%s'),'sales',(select jsonb_agg(to_jsonb(s) order by id) from public.sales s where position in (%s)),'authors',(select jsonb_agg(to_jsonb(u) order by id) from public.users u where id in (%s)));"%(f['buyer'],','.join("'%s'"%x for x in f['shops']),','.join("'%s'"%x for x in f['authors'])))
def expect_error(fn):
    try: fn()
    except RuntimeError: return
    raise AssertionError('expected transaction failure')
def expected_state(count,paid=True): return dict(paid=paid,accesses=count,sales=count,receipts=1 if paid else 0)

try:
    stand.start()
    stand.cmd([launcher.PG/'psql','-X','--no-password','-v','ON_ERROR_STOP=1','-f',ROOT/'tests/order-access-fulfillment.fixture.sql'])

    def single():
        f=fixture(1);before=notices();r=call(f)
        assert r['created']==1 and state(f)==expected_state(1)
        assert balance(f['authors'][0])==170 and notices()==before+1
    stand.check('one course: access + sale + author balance + paid + receipt atomically',single)

    def multiple():
        f=fixture(2,4);before=notices();r=call(f)
        assert r['positions']==4 and state(f)==expected_state(4)
        assert balance(f['authors'][0])==384.2 and notices()==before+4
    stand.check('four courses: four accesses/sales and exact sum of commissions',multiple)

    def authors():
        f=fixture(3,4,author_count=2);r=call(f)
        assert r['authors']==2 and state(f)==expected_state(4)
        assert balance(f['authors'][0])==241.4 and balance(f['authors'][1])==202.0
        assert stand.sql("select count(*) from public.sales s join public.shop sh on sh.id=s.position join public.course c on c.id=sh.course_id where s.position in (%s) and s.\"user\"<>c.owner;"%','.join("'%s'"%x for x in f['shops']))=='0'
    stand.check('mixed authors: each sale and commission credited to its own author',authors)

    def repeated():
        f=fixture(4,4,6);call(f);before=snapshot(f);n=notices()
        assert call(f,[])['status']=='already_completed'
        assert snapshot(f)==before and notices()==n and state(f)==expected_state(4)
    stand.check('repeat/lost RPC response: no duplicate sales, credit, expiry or notification',repeated)

    def parallel():
        f=fixture(5,4);before=notices()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:call(f),range(2)))
        assert sorted(r['status'] for r in results)==['already_completed','fulfilled']
        assert state(f)==expected_state(4) and balance(f['authors'][0])==384.2 and notices()==before+4
    stand.check('parallel callbacks: exactly one full settlement',parallel)

    def shared_balance():
        a=uid(999000);f=fixture(6,shared_author=a);g=fixture(7,shared_author=a)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(call,[f,g]))
        assert all(r['status']=='fulfilled' for r in results) and balance(a)==240
    stand.check('parallel different orders: atomic balance increments cannot overwrite each other',shared_balance)

    def financial_failure():
        f=fixture(8,4,author_count=2);stand.sql("insert into public.test_fail_author values('%s');"%f['authors'][1])
        before=snapshot(f);n=notices();expect_error(lambda:call(f))
        assert snapshot(f)==before and state(f)==expected_state(0,False) and notices()==n
        stand.sql("delete from public.test_fail_author where author_id='%s';"%f['authors'][1])
        assert call(f)['positions']==4 and state(f)==expected_state(4)
        assert balance(f['authors'][0])==241.4 and balance(f['authors'][1])==202
    stand.check('failure after accesses/sales and first author credit: EVERYTHING rolls back; retry settles once',financial_failure)

    def course_failure():
        f=fixture(9,4);stand.sql("insert into public.test_fail_course values('%s');"%f['courses'][2]);before=snapshot(f);n=notices()
        expect_error(lambda:call(f))
        assert snapshot(f)==before and state(f)==expected_state(0,False) and notices()==n
    stand.check('third-course failure leaves no accesses, sales, credits, paid flag or receipt',course_failure)

    def renewal():
        f=fixture(10,1,6)
        stand.sql("insert into public.user_course(\"user\",course,buy,end_period,created_at) values('%s','%s',true,'2031-08-31T12:34:56Z','2026-01-01T00:00:00Z');"%(f['buyer'],f['courses'][0]))
        old_id=stand.sql("select id from public.user_course where \"user\"='%s';"%f['buyer']);n=notices();r=call(f)
        assert r['updated']==1 and r['created']==0
        assert stand.sql("select id='%s'::uuid and end_period='2032-03-02T12:34:56Z'::timestamptz and created_at='2026-01-01T00:00:00Z'::timestamptz from public.user_course where \"user\"='%s';"%(old_id,f['buyer']))=='t'
        before=snapshot(f);assert call(f)['status']=='already_completed' and snapshot(f)==before and notices()==n
    stand.check('early renewal keeps remaining time, full timestamp and JS month rollover; repeat cannot extend twice',renewal)

    def expired():
        f=fixture(11,1,6)
        stand.sql("insert into public.user_course(\"user\",course,buy,end_period,created_at) values('%s','%s',true,'2025-02-01T00:00:00Z','2025-01-01T00:00:00Z');"%(f['buyer'],f['courses'][0]))
        call(f)
        assert stand.sql("select end_period>now()+interval '170 days' and end_period<now()+interval '190 days' from public.user_course where \"user\"='%s';"%f['buyer'])=='t'
    stand.check('expired finite access renews from NOW, not its old expired date',expired)

    def new_finite():
        f=fixture(20,1,6);call(f)
        row=json.loads(stand.sql("select jsonb_build_object('created',created_at,'end',end_period) from public.user_course where \"user\"='%s';"%f['buyer']))
        expected=stand.cmd(['node','-e',"const d=new Date(process.argv[1]);d.setUTCMonth(d.getUTCMonth()+6);console.log(d.toISOString().split('T')[0]);",row['created']]).strip()
        end_utc=datetime.datetime.fromisoformat(row['end']).astimezone(datetime.timezone.utc)
        assert end_utc.isoformat().startswith(expected+'T00:00:00'), 'new grant must end at the original UTC midnight'
    stand.check('new finite purchase keeps the original UTC date-only month convention',new_finite)

    def lifetime():
        for n,months,end in [(12,0,None),(13,6,None),(14,6,'infinity')]:
            f=fixture(n,1,months)
            if n!=12:
                stand.sql("insert into public.user_course(\"user\",course,buy,end_period,created_at) values('%s','%s',true,%s,'2025-01-01T00:00:00Z');"%(f['buyer'],f['courses'][0],"'%s'"%end if end else 'null'))
            call(f)
            assert stand.sql("select end_period is null and buy from public.user_course where \"user\"='%s';"%f['buyer'])=='t'
    stand.check('lifetime course and existing NULL/infinity access stay lifetime',lifetime)

    def legacy_sentinel():
        for n,end,created in [(15,'2026-01-01T00:00:00Z','2026-01-01T14:00:00Z'),
                              (23,'2026-01-02T00:00:00Z','2026-01-01T23:30:00Z')]:
            f=fixture(n,1,6)
            stand.sql("insert into public.user_course(\"user\",course,buy,end_period,created_at) values('%s','%s',true,'%s','%s');"%(f['buyer'],f['courses'][0],end,created))
            call(f)
            assert stand.sql("select end_period is null from public.user_course where \"user\"='%s';"%f['buyer'])=='t'
    stand.check('legacy UTC/Moscow same-day no-expiry sentinels are not converted to finite terms',legacy_sentinel)

    def legacy():
        f=fixture(16,4,paid=True)
        stand.sql("insert into public.user_course(\"user\",course,buy) select '%s'::uuid,id,true from public.course where id in (%s);"%(f['buyer'],','.join("'%s'"%c for c in f['courses'])))
        stand.sql("update public.user_course set buy=false where \"user\"='%s' and course='%s';"%(f['buyer'],f['courses'][0]))
        before=snapshot(f);n=notices()
        assert call(f,[])['status']=='legacy_paid_skipped' and snapshot(f)==before and notices()==n and state(f)['receipts']==0
    stand.check('historical paid order/manual repair: no access, sales, balance or notification changes',legacy)

    def rounding():
        f=fixture(17);a=f['authors'][0];s=f['shops'][0]
        stand.sql("update public.shop set price=1.005 where id='%s';update public.users set \"authorCommission\"=100,\"Ammount\"=null where id='%s';"%(s,a))
        f['plan'][0].update(price=1.005,author_commission=100,author_amount='1.00')
        call(f)
        assert balance(a)==1.0 and stand.sql("select amount=1.00 from public.sales where position='%s';"%s)=='t'
    stand.check('JS half-cent rounding preserved (1.005 -> 1.00), NULL starting balance handled',rounding)

    def security():
        f=fixture(18);expect_error(lambda:call(f,role='anon'));expect_error(lambda:call(f,role='authenticated'))
        for detail in [{}, {'sig_valid':False,'payment_status':'success','verify':{'ok':True}},
                       {'sig_valid':True,'payment_status':'failed','verify':{'ok':True}},
                       {'sig_valid':True,'payment_status':'success','verify':{'ok':False}}]:
            stand.sql("update public.payment_audit set detail='%s' where id='%s';"%(json.dumps(detail),f['proof']))
            expect_error(lambda:call(f));assert state(f)==expected_state(0,False)
    stand.check('untrusted roles/missing verified proof cannot settle an order',security)

    def snapshots():
        f=fixture(19,4);expect_error(lambda:call(f,f['plan'][:1]))
        bad=[dict(x) for x in f['plan']];bad[2]['author_id']=uid(888888)
        expect_error(lambda:call(f,bad))
        bad=[dict(x) for x in f['plan']];bad[2]['author_amount']='999999.00'
        expect_error(lambda:call(f,bad));assert state(f)==expected_state(0,False)
    stand.check('missing positions, substituted author or invented amount roll back',snapshots)

    def repeated_course():
        f=fixture(21,2,6)
        stand.sql("update public.shop set course_id='%s' where id='%s';"%(f['courses'][0],f['shops'][1]))
        f['plan'][1]['course_id']=f['courses'][0];before=notices();r=call(f)
        assert r['positions']==2 and r['created']==1 and r['updated']==0
        assert state(f)==dict(paid=True,accesses=1,sales=2,receipts=1) and notices()==before+1
        assert balance(f['authors'][0])==240.7
    stand.check('two paid positions for one course: two sales, one entitlement and one extension',repeated_course)

    def receipt_failure():
        f=fixture(22,4);f['payment']='synthetic-payment-1'
        before=snapshot(f);n=notices();expect_error(lambda:call(f))
        assert snapshot(f)==before and state(f)==expected_state(0,False) and notices()==n
    stand.check('payment-ID collision at final receipt insert rolls back even paid and author credits',receipt_failure)
except Exception as e:
    stand.results.append({'name':'isolated setup/execution','status':'FAIL','reason':launcher.safe_error(e)})
    print('FAIL isolated setup/execution: '+launcher.safe_error(e),flush=True)
finally:
    stand.stop()
    stand.results.append({'name':'temporary PostgreSQL stopped; loopback port closed','status':'PASS'})
    (stand.tmp/'order-access-results.json').write_text(json.dumps(stand.results,indent=2))
    print(json.dumps({'pass':sum(x['status']=='PASS' for x in stand.results),'fail':sum(x['status']=='FAIL' for x in stand.results),'results':str(stand.tmp/'order-access-results.json')}))
raise SystemExit(1 if any(x['status']=='FAIL' for x in stand.results) else 0)
