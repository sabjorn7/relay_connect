import os,sys,json,stat,hashlib,subprocess,urllib.request,urllib.error,time,datetime,base64
from pathlib import Path
BASE=Path('/var/lib/mg-deploy/club-push-20261126')
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'}
class Stop(Exception):pass
def need(ok,reason):
 if not ok:raise Stop(reason)
def sha(b):return hashlib.sha256(b).hexdigest()
def cmd(args,data=None):
 r=subprocess.run(args,input=data,capture_output=True,env=ENV,timeout=45)
 need(r.returncode==0,'command_failed');return r.stdout

def docker(*args):return cmd(['/usr/bin/docker',*args])
def container(name):
 c=json.loads(docker('inspect',name))[0];need(c['State']['Running'],'container_not_running');return c

def secure(p):
 p=Path(p)
 for q in [p,*p.parents]:
  s=q.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'unsafe_directory')

def read(p):
 secure(p.parent)
 with os.fdopen(os.open(p,os.O_RDONLY|os.O_NOFOLLOW),'rb') as f:
  s=os.fstat(f.fileno());need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022 and s.st_size<1048576,'unsafe_source')
  return f.read()
def create(p,b):
 secure(p.parent)
 with os.fdopen(os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
def replace(p,b,meta):
 t=p.with_name('.mg-push-'+os.urandom(12).hex())
 try:
  create(t,b);os.chown(t,meta['uid'],meta['gid']);os.chmod(t,meta['mode']);os.replace(t,p)
 finally:
  if t.exists():t.unlink()
def meta(p):
 s=p.stat();return {'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode)}
def env(c):return dict(v.split('=',1) for v in c['Config']['Env'] if '=' in v)
def discover():
 c=container('supabase-edge-functions');mounts=[m for m in c['Mounts'] if m['Destination'].rstrip('/')=='/home/deno/functions']
 need(len(mounts)==1,'unexpected_functions_mount');root=Path(mounts[0]['Source']);secure(root/'web-push-send')
 return c,root

def triggers():
 c=container('supabase-db');e=env(c)
 sql="BEGIN READ ONLY; SELECT json_agg(json_build_object('name',tgname,'state',tgenabled,'table',cl.relname) ORDER BY tgname) FROM pg_trigger t JOIN pg_class cl ON cl.oid=t.tgrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public' AND tgname IN ('trg_push_web_club_message','trg_push_web_club_post') AND NOT t.tgisinternal; COMMIT;"
 b=cmd(['/usr/bin/docker','exec','-i',c['Id'],'psql','-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-U',e.get('POSTGRES_USER','postgres'),'-d',e.get('POSTGRES_DB','postgres')],sql.encode())
 rows=json.loads(b);need(len(rows)==2 and all(x['state']=='D' for x in rows),'club_triggers_not_disabled');return rows

def info():
 c,root=discover();e=env(c);f=root/'web-push-send';index=read(f/'index.ts');helper=read(f/'club.mjs') if (f/'club.mjs').exists() else None
 # No main modifications or assumptions about a custom injected club gate.
 main=read(root/'main/index.ts');need(b'PUSH_CLUB_ENABLED' not in main,'custom_main_club_gate_requires_review')
 need(e.get('PUSH_CLUB_ENABLED')!='true','club_gate_already_enabled')
 result={'container_running':True,'target':str(f),'index_sha256':sha(index),'baseline_matches':sha(index)==OLD_SHA,'candidate_matches':sha(index)==NEW_SHA and helper is not None and sha(helper)==HELPER_SHA,'helper_exists':helper is not None,'club_env_enabled':False,'triggers':triggers(),'global_push_enabled':e.get('PUSH_ENABLED','false').lower()=='true','allowlist_mode':'all' if e.get('PUSH_ALLOWLIST','').strip()=='*' else 'restricted' if e.get('PUSH_ALLOWLIST','').strip() else 'empty','secrets_present':{k:bool(e.get(k)) for k in ['PUSH_SEND_KEY','SUPABASE_SERVICE_ROLE_KEY','VAPID_PUBLIC','VAPID_PRIVATE']}}
 return c,root,e,index,result

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args):raise Stop('redirect_refused')
def request(e,payload,key=True):
 headers={'Content-Type':'application/json'}
 if key:headers['x-push-key']=e['PUSH_SEND_KEY']
 req=urllib.request.Request('https://app.meetgu.ru/sb/functions/v1/web-push-send',data=json.dumps(payload).encode(),headers=headers,method='POST')
 op=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 try:r=op.open(req,timeout=8)
 except urllib.error.HTTPError as ex:r=ex
 with r:return r.status,json.loads(r.read(8192))
def smoke(e,clubs=False):
 # Invalid IDs never reach database recipients or delivery; club events are gated off.
 status,body=request(e,{},False);need(status==401,'anonymous_auth_regression')
 for event in ['direct_message','stream_start','chat_message']:
  status,body=request(e,{'event':event});need(status==400 and str(body.get('error','')).startswith('bad_'),'existing_validation_regression')
 if clubs:
  for event in ['club_message','club_post']:
   status,body=request(e,{'event':event,'message_id':'11111111-1111-4111-8111-111111111111','post_id':'11111111-1111-4111-8111-111111111111'})
   need(status==200 and body.get('event')==event and body.get('disabled') is True and body.get('counts',{}).get('sent')==0,'club_gate_smoke_failed')
 return {'anonymous':401,'existing_events_invalid_id':400,'club_events_disabled':clubs,'real_notifications':False}

def restart(cid):
 docker('restart',cid)
 for _ in range(10):
  if container('supabase-edge-functions')['Id']==cid:return
  time.sleep(1)
 raise Stop('restart_unverified')
def verify(e,clubs):
 for i in range(6):
  try:return smoke(e,clubs)
  except Exception:
   if i==5:raise
   time.sleep(2)

def rollback():
 state=json.loads(read(BASE/'state.json'));c,root=discover();f=root/'web-push-send'
 need(str(f)==state['target'],'target_drift');triggers()
 need(read(f/'index.ts') in [base64.b64decode(NEW_B64),read(BASE/'index.ts')],'index_drift')
 if (f/'club.mjs').exists():need(sha(read(f/'club.mjs'))==HELPER_SHA,'helper_drift')
 # Env was never modified; refuse to roll back over an unrelated config change.
 need(sha(json.dumps(env(c),sort_keys=True).encode())==state['env_fingerprint'],'environment_drift')
 old=read(BASE/'index.ts');need(sha(old)==OLD_SHA,'backup_checksum_mismatch')
 replace(f/'index.ts',old,state['meta'])
 if (f/'club.mjs').exists():(f/'club.mjs').unlink()
 restart(c['Id']);result=verify(env(c),False);print(json.dumps({'status':'ROLLED_BACK','checks':result,'backup':str(BASE)}))

def install():
 c,root,e,old,status=info();print(json.dumps(status))
 if status['candidate_matches']:print('ALREADY_INSTALLED_DISABLED');return
 need(status['baseline_matches'] and not status['helper_exists'],'baseline_mismatch_stop')
 need(status['global_push_enabled'] and status['allowlist_mode']!='empty' and all(status['secrets_present'].values()),'existing_push_not_ready')
 smoke(e);f=root/'web-push-send';secure(BASE.parent);BASE.mkdir(mode=0o700)
 create(BASE/'index.ts',old)
 # Store only a whole-config fingerprint to detect drift; no secret values in new backup state.
 state={'target':str(f),'meta':meta(f/'index.ts'),'env_fingerprint':sha(json.dumps(e,sort_keys=True).encode())}
 create(BASE/'state.json',(json.dumps(state)+'\n').encode())
 need(sha(read(BASE/'index.ts'))==OLD_SHA,'backup_failed');print('BACKUP='+str(BASE))
 try:
  create(f/'club.mjs',base64.b64decode(HELPER_B64));os.chown(f/'club.mjs',state['meta']['uid'],state['meta']['gid']);os.chmod(f/'club.mjs',state['meta']['mode'])
  replace(f/'index.ts',base64.b64decode(NEW_B64),state['meta'])
  need(sha(read(f/'index.ts'))==NEW_SHA and sha(read(f/'club.mjs'))==HELPER_SHA,'write_checksum_mismatch')
  restart(c['Id']);need(env(container('supabase-edge-functions'))==e,'environment_changed');triggers();result=verify(e,True)
  print(json.dumps({'status':'INSTALLED_DISABLED','checks':result,'backup':str(BASE),'environment_unchanged':True}))
 except Exception:
  print('INSTALL_CHECK_FAILED; restoring exact prior handler')
  rollback();raise Stop('install_failed_rolled_back') from None

def main():
 need(os.geteuid()==0,'root_required')
 if MODE=='status':print(json.dumps(info()[4]))
 elif MODE=='install':install()
 elif MODE=='rollback':rollback()
 else:raise Stop('unknown_mode')
if __name__=='__main__':
 try:main()
 except Exception as ex:
  # Never expose Docker output, request headers, env, endpoints, or raw exceptions.
  print('STOP='+str(ex) if isinstance(ex,Stop) else 'STOP=operation_failed_'+type(ex).__name__);sys.exit(1)
