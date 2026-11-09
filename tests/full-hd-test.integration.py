#!/usr/bin/env python3
"""Disposable PG15/PostgREST pilot-grant tests. No production/env/network clients."""
import pathlib,importlib.util,json,concurrent.futures,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('stand',ROOT/'tests/stream-visibility.integration.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
s=m.Stand();A=m.OWNER;B=m.OTHER;V=m.VIEWER
X='20000000-0000-4000-8000-000000000011';Y='20000000-0000-4000-8000-000000000012';VIDEO='30000000-0000-4000-8000-000000000001'
def sql(q):return s.sql(q)
def denied(q):
 try:sql(q)
 except RuntimeError:return
 raise AssertionError('expected denial')
def actor(uid,q):return "set role authenticated;set request.jwt.claim.sub='%s';"%uid+q
def grant(stream=X,owner=A):sql("update public.stream_full_hd_test_grants set enabled=false;insert into public.stream_full_hd_test_grants(stream_id,owner_id,enabled,expires_at) values('%s','%s',true,now()+interval '1 hour') on conflict(stream_id) do update set owner_id=excluded.owner_id,enabled=true,expires_at=excluded.expires_at"%(stream,owner))
def full(stream=X):sql("update public.streams set video_quality='full_hd' where id='%s'"%stream)
def reserve(stream=X,owner=A,profile='full_hd'):
 return sql("set role service_role;select public.reserve_stream_video_start_scoped('%s','%s','%s',null)"%(stream,owner,profile)).splitlines()[-1]
def mark(token,stream=X,owner=A,profile='full_hd',egress='synthetic-egress'):
 sql("set role service_role;select public.mark_stream_video_started_scoped('%s','%s','%s',null,'%s','%s','%s')"%(stream,owner,profile,egress,VIDEO,token))
def hold(token):sql("set role service_role;select public.hold_stream_video_start('%s')"%token)
def reset():
 sql("delete from public.stream_video_start_reservations;update public.streams set video_quality='hd',status='ended',livekit_egress_id=null;delete from public.stream_video_runs;update public.stream_full_hd_test_grants set enabled=false")
try:
 s.start();s.cmd([m.PG/'psql','-X','--no-password','-v','ON_ERROR_STOP=1','-f',ROOT/'tests/stream-visibility.access.sql'])
 sql("update public.streams set status='ended',livekit_egress_id=null")
 before=sql("select string_agg(policyname||coalesce(qual,'')||coalesce(with_check,''),'|' order by policyname) from pg_policies where schemaname='public' and tablename='streams'")
 for name in ['pending_stream_video_quality.sql','pending_stream_full_hd_test.sql']:s.cmd([m.PG/'psql','-X','--no-password','-v','ON_ERROR_STOP=1','-f',ROOT/'supabase/migrations'/name])
 sql("insert into public.streams(id,author,title,mode) values('%s','%s','Synthetic pilot','multi'),('%s','%s','Other synthetic','multi')"%(X,A,Y,B))
 s.setup_api()
 def forbidden_management():
  for role in ['anon','authenticated','service_role']:
   denied("set role %s;insert into public.stream_full_hd_test_grants(stream_id,owner_id,expires_at) values('%s','%s',now()+interval '1 hour')"%(role,X,A))
  for role in ['anon','authenticated']:
   denied('set role '+role+';select * from public.stream_full_hd_test_grants')
   denied("set role %s;select public.stream_full_hd_test_allowed('%s','%s')"%(role,X,A))
 s.check('grant table cannot be enumerated or managed by clients; server key cannot self-grant',forbidden_management)
 s.check('unapproved owner cannot save Full HD',lambda:denied(actor(A,"update public.streams set video_quality='full_hd' where id='%s'"%X)))
 def rpc_permission():
  grant();s.expect(s.rpc('stream_video_quality_for_stream',{'p_stream_id':X}),denied=True)
  assert s.expect(s.rpc('stream_video_quality_for_stream',{'p_stream_id':X},A),200)['full_hd_allowed'] is True
  assert s.expect(s.rpc('stream_video_quality_for_stream',{'p_stream_id':X},B),200)['full_hd_allowed'] is False
  assert s.expect(s.rpc('stream_video_quality_for_stream',{'p_stream_id':Y},A),200)['full_hd_allowed'] is False
  s.expect(s.rpc('stream_video_quality_for_stream',{'p_stream_id':X,'owner_id':A},B),denied=True)
 s.check('PostgREST exposes scoped boolean only to matching authenticated owner; extra owner cannot spoof',rpc_permission)
 def allowed_save():
  sql(actor(A,"update public.streams set video_quality='full_hd' where id='%s'"%X));assert sql("select video_quality from public.streams where id='%s'"%X)=='full_hd'
 s.check('approved owner saves Full HD with global flag false',allowed_save)
 s.check('other stream/owner has no matching grant',lambda:denied(actor(B,"update public.streams set video_quality='full_hd' where id='%s'"%Y)))
 def no_rpc_bypass():
  args={'p_stream_id':X,'p_actor_id':A,'p_expected_quality':'full_hd','p_expected_egress_id':None}
  s.expect(s.rpc('reserve_stream_video_start_scoped',args,A),denied=True)
  denied("set role service_role;select public.reserve_stream_video_start('%s','full_hd',null)"%X)
  denied("set role service_role;select public.mark_stream_video_started('%s','full_hd',null,'x','%s',gen_random_uuid())"%(X,VIDEO))
  denied("set role service_role;select public.reserve_stream_video_start_scoped('%s','%s','full_hd',null)"%(X,B))
 s.check('browser cannot invoke start RPC; legacy Full HD and actor mismatch fail closed',no_rpc_bypass)
 def parallel_start():
  def attempt(_):
   try:return reserve()
   except RuntimeError:return None
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:result=list(pool.map(attempt,[1,2]))
  assert sum(x is not None for x in result)==1
  sql('delete from public.stream_video_start_reservations')
 s.check('two parallel starts reserve exactly one slot',parallel_start)
 def revoke_race():
  def revoke():sql("begin;update public.stream_full_hd_test_grants set enabled=false where stream_id='%s';select pg_sleep(0.2);commit"%X)
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   f=pool.submit(revoke);time.sleep(0.05)
   try:reserve()
   except RuntimeError:pass
   else:raise AssertionError('start raced through committed revoke')
   f.result()
  assert sql('select count(*) from public.stream_video_start_reservations')=='0';grant()
 s.check('grant row lock serializes concurrent revoke and admission',revoke_race)
 def revoke_before_hold():
  token=reserve();sql('update public.stream_full_hd_test_grants set enabled=false');denied("set role service_role;select public.hold_stream_video_start('%s')"%token);sql('delete from public.stream_video_start_reservations');grant()
 s.check('revocation between reserve and external create is rejected by hold',revoke_before_hold)
 def revoke_before_mark():
  token=reserve();hold(token);sql('update public.stream_full_hd_test_grants set enabled=false');
  try:mark(token)
  except RuntimeError:pass
  else:raise AssertionError('mark after revoke succeeded')
  assert sql('select count(*) from public.stream_video_runs')=='0';assert sql("select status from public.streams where id='%s'"%X)!='live'
  assert sql("select count(*) from public.stream_video_start_reservations where expires_at='infinity'")=='1'
  sql('delete from public.stream_video_start_reservations');grant()
 s.check('revocation after hold rolls back mark; unknown external state remains bounded and fail-closed',revoke_before_mark)
 def lifecycle():
  token=reserve();hold(token);mark(token);sql('update public.stream_full_hd_test_grants set enabled=false')
  assert sql("select livekit_egress_id from public.streams where id='%s'"%X)=='synthetic-egress'
  assert sql("select profile from public.stream_video_runs where stream_id='%s'"%X)=='full_hd'
  sql("update public.streams set status='ended',livekit_egress_id=null where id='%s'"%X)
  try:reserve()
  except RuntimeError:pass
  else:raise AssertionError('revoked restart succeeded')
  grant();token=reserve();hold(token);mark(token,egress='synthetic-second');assert sql('select count(*) from public.stream_video_runs')=='2'
 s.check('revoke preserves active Egress snapshot; restart requires renewed grant',lifecycle)
 def capacity():
  grant(Y,B);full(Y)
  try:reserve(Y,B)
  except RuntimeError:pass
  else:raise AssertionError('second Full HD accepted while previous run active')
 s.check('max_full_hd_live=1 survives reassignment of the pilot grant',capacity)
 def one_grant():
  denied("update public.stream_full_hd_test_grants set enabled=true where stream_id='%s'"%X)
 s.check('unique index prevents two enabled pilot grants',one_grant)
 def expiration():
  reset();grant();full();sql("update public.stream_full_hd_test_grants set expires_at=now()-interval '1 second'")
  assert not s.expect(s.rpc('stream_video_quality_for_stream',{'p_stream_id':X},A),200)['full_hd_allowed']
  try:reserve()
  except RuntimeError:pass
  else:raise AssertionError('expired grant accepted')
 s.check('expired grant hides choice and blocks new start',expiration)
 def expires_after_hold():
  grant();token=reserve();hold(token);sql("update public.stream_full_hd_test_grants set expires_at=now()-interval '1 second'")
  try:mark(token)
  except RuntimeError:pass
  else:raise AssertionError('expired grant committed')
  assert sql('select count(*) from public.stream_video_runs')=='0';sql('delete from public.stream_video_start_reservations')
 s.check('expiration after external-start hold rejects atomic mark',expires_after_hold)
 def owner_change():
  reset();grant();sql("update public.streams set author='%s' where id='%s';update public.streams set author='%s' where id='%s'"%(B,X,A,X))
  assert sql("select enabled from public.stream_full_hd_test_grants where stream_id='%s'"%X)=='f'
  denied(actor(A,"update public.streams set video_quality='full_hd' where id='%s'"%X))
 s.check('owner transfer invalidates grant permanently even when ownership returns',owner_change)
 def owner_race():
  grant();full();token=reserve();hold(token);sql("update public.streams set video_quality='hd',author='%s' where id='%s'"%(B,X))
  try:mark(token)
  except RuntimeError:pass
  else:raise AssertionError('old actor committed after transfer')
  sql("delete from public.stream_video_start_reservations;update public.streams set author='%s' where id='%s'"%(A,X))
 s.check('actor/reservation binding prevents commit after owner change',owner_race)
 def hd_legacy():
  reset();token=sql("set role service_role;select public.reserve_stream_video_start('%s','hd',null)"%X).splitlines()[-1];hold(token)
  sql("set role service_role;select public.mark_stream_video_started('%s','hd',null,'legacy-hd','%s','%s')"%(X,VIDEO,token));assert sql("select video_quality from public.streams where id='%s'"%X)=='hd'
 s.check('legacy HD start/hold/mark remains compatible without pilot grant',hd_legacy)
 def rls_paid():
  after=sql("select string_agg(policyname||coalesce(qual,'')||coalesce(with_check,''),'|' order by policyname) from pg_policies where schemaname='public' and tablename='streams'");assert after==before
  s.expect(s.request('/streams?visibility=eq.unlisted'),200)
  assert s.expect(s.request('/streams?visibility=eq.unlisted'),200)==[]
  paid=s.expect(s.request('/streams?id=eq.'+m.PAID,A),200)[0]
  args={'base':'http://127.0.0.1:'+str(s.apiport),'paid':paid,'buyer':V,'other':B,'buyerToken':s.jwt(sub=V),'otherToken':s.jwt(sub=B)}
  result=json.loads(s.cmd(['node',ROOT/'tests/stream-visibility.paid-access.mjs'],json.dumps(args)));assert result['status']=='PASS' and result['cases']==8
 s.check('existing RLS, hidden enumeration protection and eight actual paid-access assertions preserved',rls_paid)
 def rollback():
  reset();grant();full();token=reserve();hold(token);mark(token)
  s.cmd([m.PG/'psql','-X','--no-password','-v','ON_ERROR_STOP=1','-f',ROOT/'supabase/migrations/pending_stream_full_hd_test_rollback.sql'])
  assert sql("select livekit_egress_id from public.streams where id='%s'"%X)=='synthetic-egress'
  assert sql('select full_hd_enabled from public.stream_video_quality_settings')=='f'
  assert sql('select max_full_hd_live from public.stream_video_quality_settings')=='1'
  sql("update public.streams set status='ended',livekit_egress_id=null where id='%s'"%X)
  try:reserve()
  except RuntimeError:pass
  else:raise AssertionError('rollback did not block start')
 s.check('operational rollback disables new Full HD without deleting history/stopping active snapshot',rollback)
 def manual_scripts():
  w='20000000-0000-4000-8000-000000000013'
  sql("insert into public.streams(id,author,title,mode,visibility) values('%s','%s','Manual synthetic pilot','multi','unlisted')"%(w,A))
  for name in ['assign-grant.sql','revoke-grant.sql']:
   text=(ROOT/'reviews/2026-11-09-full-hd-test'/name).read_text().replace('REPLACE_STREAM_UUID',w).replace('REPLACE_OWNER_UUID',A);sql(text)
   assert sql("select enabled from public.stream_full_hd_test_grants where stream_id='%s'"%w)==('t' if name=='assign-grant.sql' else 'f')
 s.check('exact manual assignment/revocation scripts work with synthetic IDs and keep global flag false',manual_scripts)
 def verification():
  out=s.cmd([m.PG/'psql','-X','--no-password','-v','ON_ERROR_STOP=1','-f',ROOT/'supabase/migrations/verify_stream_full_hd_test.sql']);assert 'FAIL' not in out
 s.check('manual verification SQL is read-only and all checks pass',verification)
finally:
 s.check('temporary PostgreSQL/PostgREST stopped; ports closed',s.stop)
 out=s.tmp/'full-hd-test-results.json';out.write_text(json.dumps(s.results,indent=2)+'\n');print(json.dumps({'pass':sum(r['status']=='PASS' for r in s.results),'fail':sum(r['status']=='FAIL' for r in s.results),'results':str(out)}))
if any(r['status']=='FAIL' for r in s.results):raise SystemExit(1)
