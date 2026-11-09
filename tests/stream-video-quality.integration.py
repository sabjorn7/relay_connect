#!/usr/bin/env python3
"""Disposable local PG15 checks. Existing launcher, loopback only; no production clients."""
import pathlib,importlib.util,json,concurrent.futures
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('stand',ROOT/'tests/stream-visibility.integration.py')
launcher=importlib.util.module_from_spec(spec);spec.loader.exec_module(launcher)
stand=launcher.Stand()
A='10000000-0000-4000-8000-000000000001'
B='10000000-0000-4000-8000-000000000002'
def sid(i):return '20000000-0000-4000-8000-'+str(i).zfill(12)
def expect_error(sql):
    try:stand.sql(sql)
    except RuntimeError:return
    raise AssertionError('expected denial')
def add(i,quality='hd'):
    stand.sql("insert into public.streams(id,author,video_quality) values('%s','%s','%s')"%(sid(i),A,quality))
def reserve(i,q='hd',previous='null'):
    return stand.sql("set role service_role;select public.reserve_stream_video_start('%s','%s',%s);"%(sid(i),q,previous)).splitlines()[-1]
def mark(i,token,q='hd',egress=None,previous='null'):
    egress=egress or 'synthetic-egress-'+str(i)
    stand.sql("set role service_role;select public.mark_stream_video_started('%s','%s',%s,'%s','%s','%s');"%(sid(i),q,previous,egress,sid(999),token))
try:
    stand.start()
    stand.sql("""create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.streams(id uuid primary key,author uuid,title text,status text default 'scheduled',mode text default 'multi',livekit_room text,livekit_egress_id text,peertube_video_id uuid);
    alter table public.streams enable row level security;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant select,insert,update on public.streams to authenticated;
    grant all on public.streams to service_role;
    create policy owner_only on public.streams to authenticated using(author=auth.uid()) with check(author=auth.uid());
    insert into public.streams(id,author) values('%s','%s');"""%(sid(1),A))
    stand.cmd([launcher.PG/'psql','-X','--no-password','-v','ON_ERROR_STOP=1','-f',ROOT/'supabase/migrations/pending_stream_video_quality.sql'])
    def old_hd():assert stand.sql("select video_quality from public.streams where id='%s'"%sid(1))=='hd'
    stand.check('existing streams default to HD without affecting lifecycle',old_hd)
    def disabled():expect_error("insert into public.streams(id,author,video_quality) values('%s','%s','full_hd')"%(sid(2),A))
    stand.check('Full HD disabled until explicit server activation',disabled)
    def hd():
        token=reserve(1);mark(1,token)
        assert stand.sql("select profile from public.stream_video_runs where stream_id='%s'"%sid(1))=='hd'
        assert stand.sql("select status from public.streams where id='%s'"%sid(1))=='live'
    stand.check('HD reservation and atomic run snapshot + live state',hd)
    stand.sql('update public.stream_video_quality_settings set full_hd_enabled=true')
    def owner_edit():
        stand.sql("set role authenticated;set request.jwt.claim.sub='%s';update public.streams set video_quality='full_hd' where id='%s';"%(A,sid(1)))
        assert stand.sql("select profile from public.stream_video_runs where stream_id='%s'"%sid(1))=='hd'
        assert stand.sql("select video_quality from public.streams where id='%s'"%sid(1))=='full_hd'
    stand.check('editing preference does not change the active HD run',owner_edit)
    def forbidden():
        for role in ['anon','authenticated']:
            expect_error("set role %s;select public.reserve_stream_video_start('%s','hd',null)"%(role,sid(1)))
            expect_error("set role %s;select public.mark_stream_video_started('%s','hd',null,'x','%s','%s')"%(role,sid(1),sid(999),sid(999)))
            expect_error('set role '+role+';select * from public.stream_video_runs')
    stand.check('guests/viewers cannot reserve, commit runs or enumerate internal diagnostics',forbidden)
    def other_owner():
        stand.sql("set role authenticated;set request.jwt.claim.sub='%s';update public.streams set video_quality='hd' where id='%s';"%(B,sid(1)))
        assert stand.sql("select video_quality from public.streams where id='%s'"%sid(1))=='full_hd'
    stand.check('existing owner RLS preserved for settings',other_owner)
    add(2,'full_hd');add(3,'full_hd')
    stand.check('stale orchestrator cannot mark Full HD live without a matching run snapshot',lambda:expect_error("update public.streams set livekit_egress_id='old-hd-writer',status='live' where id='%s'"%sid(2)))
    def concurrent_capacity():
        def attempt(i):
            try:return reserve(i,'full_hd')
            except RuntimeError:return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(attempt,[2,3]))
        assert sum(r is not None for r in results)==1
        winner=2 if results[0] else 3;token=next(r for r in results if r)
        mark(winner,token,'full_hd')
        assert stand.sql("select count(*) from public.stream_video_runs where profile='full_hd'")=='1'
    stand.check('parallel Full HD starts: one slot reserved BEFORE external work',concurrent_capacity)
    def second_start():expect_error("select public.reserve_stream_video_start('%s','full_hd',null)"%sid(2))
    stand.check('no additional Full HD run above configured capacity',second_start)
    add(4)
    def drift():
        token=reserve(4);stand.sql("update public.streams set video_quality='full_hd' where id='%s'"%sid(4))
        expect_error("select public.mark_stream_video_started('%s','hd',null,'drift','%s','%s')"%(sid(4),sid(999),token))
        assert stand.sql("select count(*) from public.stream_video_runs where stream_id='%s'"%sid(4))=='0'
        assert stand.sql("select status from public.streams where id='%s'"%sid(4))=='scheduled'
    stand.check('settings changed mid-start: no mismatched profile persisted',drift)
    add(5)
    def expired():
        token=reserve(5);stand.sql("update public.stream_video_start_reservations set expires_at=now()-interval '1 second' where stream_id='%s'"%sid(5))
        expect_error("select public.mark_stream_video_started('%s','hd',null,'expired','%s','%s')"%(sid(5),sid(999),token))
    stand.check('expired start cannot commit an outdated profile',expired)
    add(6)
    def held():
        token=reserve(6)
        stand.sql("set role service_role;select public.hold_stream_video_start('%s');"%token)
        assert stand.sql("select expires_at='infinity'::timestamptz from public.stream_video_start_reservations where stream_id='%s'"%sid(6))=='t'
        expect_error("set role anon;select public.hold_stream_video_start('%s')"%token)
    stand.check('external-start capacity hold survives timeout and is service-only',held)
    def rollback():
        before=stand.sql('select count(*) from public.stream_video_runs')
        stand.cmd([launcher.PG/'psql','-X','--no-password','-v','ON_ERROR_STOP=1','-f',ROOT/'supabase/migrations/pending_stream_video_quality_rollback.sql'])
        assert stand.sql('select full_hd_enabled from public.stream_video_quality_settings')=='f'
        assert stand.sql('select count(*) from public.stream_video_runs')==before
        assert stand.sql("select count(*) from public.stream_video_runs where profile='full_hd'")=='1'
        expect_error("select public.reserve_stream_video_start('%s','full_hd',null)"%sid(4))
    stand.check('operational rollback preserves active runs/history and blocks new Full HD',rollback)
    def delete_ended():
        stand.sql("update public.streams set status='ended',livekit_egress_id=null where id='%s';delete from public.streams where id='%s'"%(sid(1),sid(1)))
        assert stand.sql("select count(*) from public.stream_video_runs where stream_id='%s'"%sid(1))=='0'
    stand.check('new foreign keys do not break existing explicit deletion of an ended stream',delete_ended)
finally:
    stand.check('temporary PostgreSQL stopped, ports closed',stand.stop)
    result=stand.tmp/'stream-video-quality-results.json';result.write_text(json.dumps(stand.results,indent=2)+'\n')
    print(json.dumps({'pass':sum(r['status']=='PASS' for r in stand.results),'fail':sum(r['status']=='FAIL' for r in stand.results),'results':str(result)}))
if any(r['status']=='FAIL' for r in stand.results):raise SystemExit(1)
