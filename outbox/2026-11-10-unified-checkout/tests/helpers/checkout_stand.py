# Existing disposable launcher, restricted to loopback; no app env loaded.
import base64,hashlib,hmac,json,os,pathlib,secrets,socket,subprocess,tempfile,time,urllib.request,urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[2]
PG=pathlib.Path('/opt/homebrew/opt/postgresql@15/bin')
REST=pathlib.Path('/opt/homebrew/bin/postgrest')
DB='mg_stream_visibility_test'
def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def safe_error(value):
 import re
 return re.sub(r'eyJ[\w-]+\.[\w-]+\.[\w-]+','[fixture JWT]',str(value))[:1500]
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
