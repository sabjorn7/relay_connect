#!/usr/bin/env python3
"""Disposable loopback PostgreSQL/PostgREST tests. No app/env/prod services are loaded."""
import base64, hashlib, hmac, json, os, pathlib, secrets, signal, socket, subprocess, tempfile, time, urllib.request, urllib.error
ROOT = pathlib.Path(__file__).resolve().parents[1]
PG = pathlib.Path('/opt/homebrew/opt/postgresql@15/bin')
REST = pathlib.Path('/opt/homebrew/bin/postgrest')
DB = 'mg_stream_visibility_test'
OWNER='10000000-0000-4000-8000-000000000001'
OTHER='10000000-0000-4000-8000-000000000002'
VIEWER='10000000-0000-4000-8000-000000000003'
PUBLIC='20000000-0000-4000-8000-000000000001'
HIDDEN='20000000-0000-4000-8000-000000000002'
PAID='20000000-0000-4000-8000-000000000003'

def port():
    with socket.socket() as s: s.bind(('127.0.0.1',0)); return s.getsockname()[1]

def safe_error(text):
    import re
    text=re.sub(r'eyJ[\w-]+\.[\w-]+\.[\w-]+','[fixture JWT]',str(text))
    return re.sub(r'\b[a-f0-9]{64}\b','[fixture key]',text)[:1800]

class Stand:
    def __init__(self):
        self.tmp=pathlib.Path(tempfile.mkdtemp(prefix='mg-stream-pg-',dir='/private/tmp')); self.tmp.chmod(0o700)
        self.pgport=port(); self.apiport=port(); self.rest=None; self.started=False; self.results=[]
        self.env={k:v for k,v in os.environ.items() if k in ['PATH','LANG','LC_ALL','TMPDIR','SYSTEMROOT']}
        self.env.update(PGHOST='127.0.0.1',PGPORT=str(self.pgport),PGUSER='mg_fixture_admin',PGDATABASE=DB,PGPASSFILE=str(self.tmp/'no-passfile'),PGSERVICEFILE=str(self.tmp/'no-servicefile'),PSQLRC=str(self.tmp/'no-psqlrc'))
        self.secret=secrets.token_hex(32)
    def cmd(self,args,sql=None):
        p=subprocess.run([str(x) for x in args],input=sql,text=True,capture_output=True,env=self.env,cwd=ROOT)
        if p.returncode: raise RuntimeError(safe_error(p.stderr))
        return p.stdout
    def sql(self,q): return self.cmd([PG/'psql','-X','--no-password','-v','ON_ERROR_STOP=1','-At'],q).strip()
    def check(self,name,fn):
        try: fn(); self.results.append({'name':name,'status':'PASS'}); print('PASS '+name,flush=True)
        except Exception as e: self.results.append({'name':name,'status':'FAIL','reason':safe_error(e)}); print('FAIL '+name+': '+safe_error(e),flush=True)
    def jwt(self,role='authenticated',sub=None):
        enc=lambda v:base64.urlsafe_b64encode(json.dumps(v,separators=(',',':')).encode()).decode().rstrip('=')
        value=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'role':role,'aud':'mg-fixture','exp':int(time.time())+3600,**({'sub':sub} if sub else {})})
        return value+'.'+base64.urlsafe_b64encode(hmac.new(self.secret.encode(),value.encode(),hashlib.sha256).digest()).decode().rstrip('=')
    def request(self,path,actor=None,method='GET',data=None,headers=None):
        assert path.startswith('/') and not path.startswith('//')
        url='http://127.0.0.1:'+str(self.apiport)+path
        h={'Content-Type':'application/json',**(headers or {})}
        if actor: h['Authorization']='Bearer '+self.jwt('service_role' if actor=='service' else 'authenticated',None if actor=='service' else actor)
        req=urllib.request.Request(url,headers=h,method=method,data=None if data is None else json.dumps(data).encode())
        # Ignore inherited HTTP(S) proxy configuration; never leave loopback or follow redirects.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args): raise AssertionError('unexpected redirect')
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
        try:
            with opener.open(req,timeout=5) as r: status=r.status; body=r.read(); response_headers=r.headers
        except urllib.error.HTTPError as r: status=r.code; body=r.read(); response_headers=r.headers
        try: decoded=json.loads(body) if body else None
        except ValueError: decoded=None
        return status,decoded,response_headers
    def rpc(self,name,args,actor=None): return self.request('/rpc/'+name,actor,'POST',args)
    def expect(self,response,status=None,denied=False):
        code,body,_=response
        if denied: assert code in (400,401,403,404,406), 'expected denial, got HTTP '+str(code)
        elif status is not None: assert code==status, 'expected HTTP '+str(status)+', got '+str(code)+' code='+str(body.get('code') if isinstance(body,dict) else '')
        return body
    def start(self):
        assert PG.joinpath('postgres').exists() and REST.exists(),'approved packages missing'
        self.cmd([PG/'initdb','-D',self.tmp/'cluster','-U','mg_fixture_admin','--auth=trust','--encoding=UTF8','--no-locale'])
        self.cmd([PG/'pg_ctl','-D',self.tmp/'cluster','-l',self.tmp/'postgres.log','-o',f"-h 127.0.0.1 -p {self.pgport} -k {self.tmp} -c log_statement=none -c log_min_error_statement=panic",'-w','start']); self.started=True
        self.cmd([PG/'createdb','--no-password',DB])
        assert self.sql('show listen_addresses;')=='127.0.0.1'
    def setup_api(self):
        self.sql("update public.stream_visibility_settings set unlisted_enabled=true; create role mg_pgrst_authenticator login noinherit; grant anon,authenticated,service_role to mg_pgrst_authenticator;")
        self.key=self.sql("select access_key from public.stream_access_keys where stream_id='"+HIDDEN+"';")
        config=self.tmp/'postgrest.conf'
        config.write_text('\n'.join([f'db-uri = "postgres://mg_pgrst_authenticator@127.0.0.1:{self.pgport}/{DB}"','db-schemas = "public"','db-anon-role = "anon"','server-host = "127.0.0.1"',f'server-port = {self.apiport}',f'jwt-secret = "{self.secret}"','jwt-aud = "mg-fixture"','log-level = "crit"']))
        config.chmod(0o600)
        self.restlog=open(self.tmp/'postgrest.log','w')
        self.rest=subprocess.Popen([str(REST),str(config)],stdout=self.restlog,stderr=self.restlog,env=self.env)
        for _ in range(80):
            if self.rest.poll() is not None: raise RuntimeError('PostgREST exited; inspect protected temp log')
            try:
                if self.request('/streams?select=id')[0]==200: return
            except (OSError,urllib.error.URLError): pass
            time.sleep(.1)
        raise RuntimeError('PostgREST readiness timeout')
    def stop(self):
        if self.rest:
            if self.rest.poll() is None:
                self.rest.terminate()
                try:self.rest.wait(timeout=10)
                except subprocess.TimeoutExpired:self.rest.kill();self.rest.wait(timeout=5)
            self.restlog.close()
        if self.started:self.cmd([PG/'pg_ctl','-D',self.tmp/'cluster','-m','fast','-w','stop']);self.started=False
        for p in [self.pgport,self.apiport]:
            with socket.socket() as sock: assert sock.connect_ex(('127.0.0.1',p))!=0,'test listener still running'
    def tests(self):
        self.check('SQL migration + access assertions + operational rollback',lambda:self.cmd([PG/'psql','-X','--no-password','-v','ON_ERROR_STOP=1','-f',ROOT/'tests/stream-visibility.access.sql']))
        if self.results[-1]['status']=='FAIL':return
        self.setup_api()
        def listeners():
            pid=int((self.tmp/'cluster'/'postmaster.pid').read_text().splitlines()[0])
            for process,p in [(pid,self.pgport),(self.rest.pid,self.apiport)]:
                listing=self.cmd(['/usr/sbin/lsof','-nP','-a','-p',str(process),'-iTCP','-sTCP:LISTEN'])
                assert '127.0.0.1:'+str(p) in listing and '*:' not in listing and '0.0.0.0:' not in listing,'non-loopback listener'
            assert self.sql('select count(*) from pg_foreign_server;')=='0'
            assert self.sql("select string_agg(extname,',') from pg_extension;")=='plpgsql'
        self.check('only 127.0.0.1 listeners; no foreign/network DB extensions',listeners)
        def case(name,fn):self.check(name,fn)
        def no_hidden(actor):
            rows=self.expect(self.request('/streams?select=id',actor),200)
            assert HIDDEN not in [r['id'] for r in rows]
            assert {PUBLIC,PAID}.issubset({r['id'] for r in rows})
        case('REST anonymous public + legacy paid rows, no unlisted',lambda:no_hidden(None))
        case('REST authenticated viewer cannot enumerate unlisted',lambda:no_hidden(VIEWER))
        def hidden_filter():
            r=self.request('/streams?visibility=eq.unlisted&select=id',VIEWER,headers={'Prefer':'count=exact'})
            assert self.expect(r,200)==[]; assert r[2].get('Content-Range','').endswith('/0')
        case('REST unlisted filter and exact count do not bypass RLS',hidden_filter)
        case('REST known hidden UUID without key returns no row',lambda:assert_equal(self.expect(self.request('/streams?id=eq.'+HIDDEN),200),[]))
        case('REST creator sees own hidden row',lambda:assert_equal(self.expect(self.request('/streams?id=eq.'+HIDDEN,OWNER),200)[0]['id'],HIDDEN))
        case('REST invited cohost retains assigned hidden access',lambda:assert_equal(self.expect(self.request('/streams?id=eq.'+HIDDEN,OTHER),200)[0]['id'],HIDDEN))
        def link(actor):
            rows=self.expect(self.rpc('get_stream_by_link',{'p_stream_id':HIDDEN,'p_key':self.key},actor),200);assert len(rows)==1
            assert not {'author','authorUser','access_key','livekit_room','livekit_egress_id','chat'}.intersection(rows[0])
        case('RPC guest capability view has no private DTO fields',lambda:link(None))
        case('RPC authenticated viewer capability view',lambda:link(VIEWER))
        case('RPC wrong capability returns no row',lambda:assert_equal(self.expect(self.rpc('get_stream_by_link',{'p_stream_id':HIDDEN,'p_key':'0'*64}),200),[]))
        case('RPC key lookup denied to guest',lambda:self.expect(self.rpc('get_my_stream_link',{'p_stream_id':HIDDEN}),denied=True))
        case('RPC other viewer cannot retrieve key',lambda:assert_equal(self.expect(self.rpc('get_my_stream_link',{'p_stream_id':HIDDEN},VIEWER),200),None))
        case('RPC creator key lookup succeeds',lambda:assert_equal(self.expect(self.rpc('get_my_stream_link',{'p_stream_id':HIDDEN},OWNER),200),self.key))
        for name in ['stream_access_keys','stream_visibility_settings']:
            case('REST private '+name+' denied',lambda name=name:self.expect(self.request('/'+name),denied=True))
        case('REST private schema cannot be selected',lambda:self.expect(self.request('/streams',headers={'Accept-Profile':'stream_visibility_private'}),denied=True))
        for fn in ['push_targets_live_started','push_targets_stream_scheduled','push_targets_stream_chat','push_targets_stream_invite']:
            case('RPC anon worker filters hidden '+fn,lambda fn=fn:assert_equal(self.expect(self.rpc(fn,{'p_id':HIDDEN}),200),{'items':[]}))
            case('RPC authenticated original ACL '+fn,lambda fn=fn:self.expect(self.rpc(fn,{'p_id':HIDDEN},VIEWER),denied=True) if fn=='push_targets_stream_scheduled' else assert_equal(self.expect(self.rpc(fn,{'p_id':HIDDEN},VIEWER),200),{'items':[]}))
        case('RPC trusted native resolver suppresses hidden',lambda:assert_equal(self.expect(self.rpc('push_targets_live_started',{'p_id':HIDDEN},'service'),200),{'items':[]}))
        case('RPC anon native resolver preserves public',lambda:assert_equal(len(self.expect(self.rpc('push_targets_live_started',{'p_id':PUBLIC}),200)['items']),1))
        case('RPC anon scheduled resolver preserves public',lambda:assert_equal(len(self.expect(self.rpc('push_targets_stream_scheduled',{'p_id':PUBLIC}),200)['items']),1))
        case('RPC trusted native resolver preserves public',lambda:assert_equal(len(self.expect(self.rpc('push_targets_live_started',{'p_id':PUBLIC},'service'),200)['items']),1))
        def chat_read(actor):
            rows=self.expect(self.rpc('get_stream_link_messages',{'p_stream_id':HIDDEN,'p_key':self.key},actor),200);assert rows
            assert not {'owner','author','authorUser','access_key'}.intersection(rows[0])
        case('REST guest cannot enumerate hidden chat',lambda:assert_equal(self.expect(self.request('/stream_chat?stream=eq.'+HIDDEN),200),[]))
        case('REST link viewer has no permanent chat table grant',lambda:assert_equal(self.expect(self.request('/stream_chat?stream=eq.'+HIDDEN,VIEWER),200),[]))
        case('RPC guest can read linked chat without identity leakage',lambda:chat_read(None))
        case('RPC viewer can read linked chat',lambda:chat_read(VIEWER))
        case('RPC wrong-key chat read empty',lambda:assert_equal(self.expect(self.rpc('get_stream_link_messages',{'p_stream_id':HIDDEN,'p_key':'0'*64}),200),[]))
        case('RPC guest cannot post even with key',lambda:self.expect(self.rpc('send_stream_link_message',{'p_stream_id':HIDDEN,'p_key':self.key,'p_text':'Guest denied'}),denied=True))
        case('RPC viewer wrong-key post denied',lambda:self.expect(self.rpc('send_stream_link_message',{'p_stream_id':HIDDEN,'p_key':'0'*64,'p_text':'Denied'},VIEWER),denied=True))
        def viewer_post():
            self.message=self.expect(self.rpc('send_stream_link_message',{'p_stream_id':HIDDEN,'p_key':self.key,'p_text':'HTTP synthetic message'},VIEWER),200);assert self.message
            rows=self.expect(self.rpc('get_stream_link_messages',{'p_stream_id':HIDDEN,'p_key':self.key},VIEWER),200)
            assert any(r['id']==self.message and r['is_mine'] and r['can_delete'] for r in rows)
        case('RPC viewer posts as JWT identity with own moderation',viewer_post)
        case('REST viewer cannot post directly to hidden chat',lambda:self.expect(self.request('/stream_chat',VIEWER,'POST',{'stream':HIDDEN,'owner':VIEWER,'text':'Denied'}),denied=True))
        case('RPC viewer cannot delete creator message',lambda:self.expect(self.rpc('delete_stream_link_message',{'p_stream_id':HIDDEN,'p_key':self.key,'p_message_id':'30000000-0000-4000-8000-000000000001'},VIEWER),denied=True))
        case('RPC viewer deletes own linked message',lambda:self.expect(self.rpc('delete_stream_link_message',{'p_stream_id':HIDDEN,'p_key':self.key,'p_message_id':self.message},VIEWER),204))
        case('REST metadata author spoof rejected',lambda:self.expect(self.request('/streams',VIEWER,'POST',{'author':OWNER,'title':'Spoof'}),denied=True))
        case('REST invalid creator role rejected',lambda:self.expect(self.request('/streams',VIEWER,'POST',{'author':VIEWER,'title':'Not a creator'}),denied=True))
        def create(vis,price=0,actor=OWNER):
            return self.request('/streams',actor,'POST',{'author':actor,'title':'HTTP synthetic '+vis,'visibility':vis,'price':price},headers={'Prefer':'return=representation'})
        case('REST paid unlisted rejected by CHECK',lambda:self.expect(create('unlisted',100),denied=True))
        def create_hidden():
            rows=self.expect(create('unlisted'),201);self.created_hidden=rows[0]['id'];assert rows[0]['visibility']=='unlisted'
        case('REST creator INSERT RETURNING unlisted succeeds',create_hidden)
        def create_public():
            rows=self.expect(create('public'),201);self.created_public=rows[0]['id'];assert rows[0]['visibility']=='public'
        case('REST creator public creation succeeds',create_public)
        def default_public():
            rows=self.expect(self.request('/streams',OWNER,'POST',{'author':OWNER,'title':'Legacy default'},headers={'Prefer':'return=representation'}),201);assert rows[0]['visibility']=='public'
        case('REST legacy insert defaults public',default_public)
        case('REST hidden cannot be changed to paid',lambda:self.expect(self.request('/streams?id=eq.'+HIDDEN,OWNER,'PATCH',{'price':100}),denied=True))
        case('REST visibility cannot be switched to public',lambda:self.expect(self.request('/streams?id=eq.'+HIDDEN,OWNER,'PATCH',{'visibility':'public'}),denied=True))
        def lifecycle():
            for status in ['live','ended']:
                rows=self.expect(self.request('/streams?id=eq.'+self.created_hidden,OWNER,'PATCH',{'status':status},headers={'Prefer':'return=representation'}),200);assert rows[0]['status']==status
            rows=self.expect(self.request('/streams?id=eq.'+self.created_hidden,VIEWER,'PATCH',{'title':'Denied'},headers={'Prefer':'return=representation'}),200);assert rows==[]
        case('REST owner lifecycle scheduled/live/ended; other viewer cannot edit',lifecycle)
        def service_lifecycle():
            rows=self.expect(self.request('/streams?id=eq.'+self.created_hidden,'service','PATCH',{'status':'live','livekit_room':'synthetic-room','livekit_egress_id':'synthetic-egress'},headers={'Prefer':'return=representation'}),200);assert rows[0]['visibility']=='unlisted'
            self.expect(self.request('/streams?id=eq.'+self.created_hidden,'service','PATCH',{'status':'ended','livekit_egress_id':None}),204)
        case('REST service-role lifecycle retains visibility under new RLS',service_lifecycle)
        def embedding():
            rows=self.expect(self.request('/streams?select=id,stream_chat(id)&id=eq.'+HIDDEN),200);assert rows==[]
        case('REST embedded relation cannot reveal hidden stream/chat',embedding)
        def shadow():
            self.sql("begin; set local role authenticated; set local \"request.jwt.claim.sub\"='"+VIEWER+"'; create temp table streams(id uuid,author uuid); insert into streams values('"+HIDDEN+"','"+VIEWER+"'); set local search_path=pg_temp,public; do $$ begin if public.get_my_stream_link('"+HIDDEN+"') is not null then raise exception 'SECURITY DEFINER shadow bypass'; end if; end $$; rollback;")
        case('SQL SECURITY DEFINER fixed search_path resists temp shadowing',shadow)
        def paid_access():
            paid=self.expect(self.request('/streams?id=eq.'+PAID,OWNER),200)[0]
            args={'base':'http://127.0.0.1:'+str(self.apiport),'paid':paid,'buyer':VIEWER,'other':OTHER,'buyerToken':self.jwt(sub=VIEWER),'otherToken':self.jwt(sub=OTHER)}
            output=json.loads(self.cmd(['node',ROOT/'tests/stream-visibility.paid-access.mjs'],json.dumps(args)))
            assert output['status']=='PASS' and output['cases']==8
        case('actual paid-access code: buyer/nonbuyer/guest/owner/expiry/spoofing (8 assertions)',paid_access)
        def role_escalation():
            self.expect(self.request('/streams',headers={'Authorization':'Bearer '+self.jwt(role='mg_fixture_admin')}),denied=True)
        case('REST authenticator cannot SET ROLE to database owner',role_escalation)
        def bad_signature():
            token=self.jwt(sub=OWNER);head,payload,signature=token.split('.')
            signature=('A' if signature[0]!='A' else 'B')+signature[1:]
            self.expect(self.request('/streams',headers={'Authorization':'Bearer '+'.'.join([head,payload,signature])}),401)
        case('REST invalid JWT signature cannot gain authenticated access',bad_signature)
        def rollback():
            tables=['streams','stream_access_keys','stream_chat','stream_cohosts','users','user_course']
            fingerprint=lambda:{t:self.sql("select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb)::text) from public."+t+" r;") for t in tables}
            before=fingerprint()
            self.cmd([PG/'psql','-X','--no-password','-v','ON_ERROR_STOP=1','-f',ROOT/'supabase/migrations/pending_stream_visibility_rollback.sql'])
            assert fingerprint()==before,'rollback modified application rows or keys'
            assert self.expect(self.rpc('stream_visibility_capabilities',{}),200)['unlisted_enabled'] is False
            self.expect(create('unlisted'),denied=True);link(None);chat_read(None)
            assert HIDDEN not in [r['id'] for r in self.expect(self.request('/streams?select=id'),200)]
            assert self.expect(self.request('/stream_chat?stream=eq.'+HIDDEN),200)==[]
            assert self.expect(self.rpc('push_targets_live_started',{'p_id':HIDDEN}),200)=={'items':[]}
            self.expect(create('public'),201)
        case('HTTP rollback blocks new hidden, preserves links/chat/public and RPC protection',rollback)

def assert_equal(a,b):assert a==b,'response value mismatch'

if __name__=='__main__':
    stand=Stand(); fatal=None
    try:stand.start();stand.tests()
    except Exception as e:fatal=safe_error(e);stand.results.append({'name':'stand setup/execution','status':'FAIL','reason':fatal});print('FAIL '+fatal,flush=True)
    finally:
        try:stand.stop();stand.results.append({'name':'temporary processes stopped; ports closed','status':'PASS'})
        except Exception as e:stand.results.append({'name':'cleanup','status':'FAIL','reason':safe_error(e)});print('FAIL cleanup: '+safe_error(e),flush=True)
        result={'versions':{'postgres':stand.cmd([PG/'postgres','--version']).strip(),'postgrest':stand.cmd([REST,'--version']).strip()},'temporaryDirectory':str(stand.tmp),'results':stand.results}
        (stand.tmp/'results.json').write_text(json.dumps(result,indent=2))
        print(json.dumps({'pass':sum(r['status']=='PASS' for r in stand.results),'fail':sum(r['status']=='FAIL' for r in stand.results),'results':str(stand.tmp/'results.json')}),flush=True)
    raise SystemExit(1 if any(r['status']=='FAIL' for r in stand.results) else 0)
