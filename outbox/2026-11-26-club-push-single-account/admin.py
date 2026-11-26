import os,sys,json,stat,hashlib,subprocess,urllib.request,urllib.error,time,datetime,base64
from pathlib import Path
BASE=Path('/var/lib/mg-deploy/club-push-pilot-20261126-r2')
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


def sql(query):
 c=container('supabase-db');e=env(c)
 return cmd(['/usr/bin/docker','exec','-i',c['Id'],'psql','-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-U',e.get('POSTGRES_USER','postgres'),'-d',e.get('POSTGRES_DB','postgres')],query.encode()).decode().strip()

def dbstate():
 q="""BEGIN READ ONLY; SET LOCAL search_path TO public; SELECT json_build_object('function_md5',md5(pg_get_functiondef('public.trg_push_web_club()'::regprocedure)),'triggers',(SELECT json_agg(json_build_object('name',tgname,'state',tgenabled,'definition',pg_get_triggerdef(oid,true)) ORDER BY tgname) FROM pg_trigger WHERE tgname IN ('trg_push_web_club_message','trg_push_web_club_post'))); COMMIT;"""
 return json.loads(sql(q))

def inspect():
 c,root=discover();f=root/'web-push-send';e=env(c);d=dbstate()
 need(d['function_md5']==FUNCTION_MD5,'trigger_function_drift')
 need(len(d['triggers'])==2,'trigger_count_mismatch')
 return c,f,e,d

def env_path_evidence(c,root):
 # Read-only metadata. Never print environment values, source fragments or command stderr.
 main=read(root/'main/index.ts').decode()
 helper=root/'main/club-key-env.mjs'
 labels=c['Config'].get('Labels',{})
 result={'main_sha256':sha(main.encode()),'main_reads_environment': 'Deno.env.toObject()' in main,
         'main_create_references':main.count('EdgeRuntime.userWorkers.create'),
         'main_envvars_reference':'envVars' in main,'custom_club_flag_reference':'PUSH_CLUB_ENABLED' in main,
         'compose_mapping_confirmed':False}
 if helper.exists():
  h=read(helper).decode()
  result['key_helper_sha256']=sha(h.encode())
  result['key_helper_returns_other_env_unchanged']="return envVars" in h and "checkout-pay-link" in h
 files=labels.get('com.docker.compose.project.config_files','').split(',')
 service=labels.get('com.docker.compose.service')
 if service and files and all(Path(x).is_absolute() for x in files):
  try:
   args=['compose']
   for file in files:args.extend(['-f',file])
   conf=json.loads(docker(*args,'config','--format','json'))
   entry=conf['services'][service].get('environment',{})
   if isinstance(entry,dict):
    result['compose_mapping_confirmed']=True
    result['compose_club_flag_present']='PUSH_CLUB_ENABLED' in entry
    result['compose_club_flag_enabled']=str(entry.get('PUSH_CLUB_ENABLED','')).lower()=='true'
    result['compose_matches_running_club_flag']=str(entry.get('PUSH_CLUB_ENABLED',''))==env(c).get('PUSH_CLUB_ENABLED','')
  except Exception:result['compose_mapping_error']='read_or_resolution_unavailable'
 return result

def status():
 c,f,e,d=inspect()
 print(json.dumps({'index_sha256':sha(read(f/'index.ts')),'helper_sha256':sha(read(f/'club.mjs')),'club_env_enabled':e.get('PUSH_CLUB_ENABLED')=='true','triggers':[{'name':t['name'],'state':t['state']} for t in d['triggers']],'approved_recipient_count':len(RECIPIENTS),'compose_service':c['Config'].get('Labels',{}).get('com.docker.compose.service'),'compose_workdir':c['Config'].get('Labels',{}).get('com.docker.compose.project.working_dir'),'compose_files':c['Config'].get('Labels',{}).get('com.docker.compose.project.config_files'),'club_env_present':'PUSH_CLUB_ENABLED' in e,'writes':False,'notifications':False,'env_path_evidence':env_path_evidence(c,f.parent)}))

def install():
 c,f,e,d=inspect();need(e.get('PUSH_CLUB_ENABLED')!='true','club_env_must_stay_disabled')
 need(all(t['state']=='D' for t in d['triggers']),'triggers_must_be_disabled')
 need(sha(read(f/'index.ts'))==INDEX_SHA,'dispatcher_drift')
 old=read(f/'club.mjs')
 if sha(old)==HELPER_SHA:print('ALREADY_INSTALLED_DISABLED');return
 need(sha(old)==BASE_HELPER_SHA,'helper_baseline_mismatch')
 smoke(e);secure(BASE.parent);BASE.mkdir(mode=0o700)
 create(BASE/'index.ts',read(f/'index.ts'));create(BASE/'club.mjs',old)
 create(BASE/'state.json',json.dumps({'target':str(f),'helper_meta':meta(f/'club.mjs'),'index_meta':meta(f/'index.ts'),'db':d}).encode())
 need(sha(read(BASE/'club.mjs'))==BASE_HELPER_SHA and sha(read(BASE/'index.ts'))==INDEX_SHA,'backup_mismatch')
 print('BACKUP='+str(BASE));before=e.copy()
 try:
  replace(f/'club.mjs',base64.b64decode(HELPER_B64),meta(f/'club.mjs'))
  need(sha(read(f/'club.mjs'))==HELPER_SHA,'helper_write_mismatch')
  restart(c['Id']);need(env(container('supabase-edge-functions'))==before,'env_changed');verify(before,True);triggers()
 except Exception:
  need(sha(read(f/'club.mjs'))==HELPER_SHA,'restore_refused_source_drift')
  replace(f/'club.mjs',read(BASE/'club.mjs'),json.loads(read(BASE/'state.json'))['helper_meta']);restart(c['Id']);verify(before,True)
  raise Stop('install_failed_restored_previous_helper') from None
 print('INSTALLED_DISABLED; GLOBAL_ALLOWLIST_UNCHANGED; RECIPIENT_COUNT='+str(len(RECIPIENTS)))

def disable():
 # Stop new enqueues even if later source validation fails. Never touch ordinary push triggers.
 sql(DISABLE_SQL);print('CLUB_TRIGGERS_DISABLED')
 c,root=discover();f=root/'web-push-send';index=read(f/'index.ts')
 need(sha(index) in [INDEX_SHA,KILL_SHA],'index_drift_manual_gate_shutdown_required')
 if sha(index)!=KILL_SHA:
  secure(BASE.parent)
  if not BASE.exists():BASE.mkdir(mode=0o700)
  if not (BASE/'disable-index.ts').exists():create(BASE/'disable-index.ts',index)
  replace(f/'index.ts',base64.b64decode(KILL_B64),meta(f/'index.ts'));restart(c['Id'])
 need(sha(read(f/'index.ts'))==KILL_SHA,'kill_gate_not_verified');triggers();verify(env(c),True)
 print('DISABLED_CLUB_ONLY; EXISTING_DELIVERY_UNCHANGED; INFLIGHT_NOTIFICATIONS_CANNOT_BE_RECALLED')

def enable():
 # No empty/global wildcard recipients and no argument accepting arbitrary users.
 import re
 need(0<len(RECIPIENTS)<=10 and len(set(RECIPIENTS))==len(RECIPIENTS) and all(re.fullmatch('[0-9a-f-]{36}',u) for u in RECIPIENTS),'recipient_approval_required')
 c,f,e,d=inspect();need(e.get('PUSH_CLUB_ENABLED')=='true','club_env_still_disabled_use_confirmed_existing_config_first')
 need(sha(read(f/'index.ts'))==INDEX_SHA and sha(read(f/'club.mjs'))==HELPER_SHA,'scoped_handler_not_installed')
 need(all(t['state']=='D' for t in d['triggers']),'triggers_not_disabled')
 for t in d['triggers']:need(t['definition']==BASE_TRIGGERS[t['name']],'trigger_definition_drift')
 # Only counts returned. Never fetch endpoints, keys, or user names.
 ids=','.join("'"+u+"'::uuid" for u in RECIPIENTS)
 q="SELECT count(DISTINCT u.id) FROM public.users u WHERE u.id IN ("+ids+") AND u.send_notif IS DISTINCT FROM false AND EXISTS(SELECT 1 FROM public.club_subs s WHERE s.suber=u.id AND s.club='"+CLUB+"'::uuid AND s.active=true AND (s.end_date IS NULL OR s.end_date>=current_date)) AND EXISTS(SELECT 1 FROM public.push_subscriptions p WHERE p.user_id=u.id AND p.disabled_at IS NULL)"
 need(int(sql('BEGIN READ ONLY; '+q+'; COMMIT;'))==len(RECIPIENTS),'selected_recipient_not_eligible')
 secure(BASE);create(BASE/'pre-enable-db.json',json.dumps(d).encode())
 try:
  sql(ENABLE_SQL)
  after=dbstate();need(all(t['state']=='O' for t in after['triggers']),'enable_unconfirmed')
 except Exception:
  disable();raise Stop('enable_failed_club_disabled') from None
 print('PILOT_ENABLED_FOR_APPROVED_ACCOUNTS; NO_TEST_NOTIFICATION_SENT_BY_SCRIPT')

def main():
 need(os.geteuid()==0,'root_required')
 if MODE=='status':status()
 elif MODE=='install':install()
 elif MODE=='enable':enable()
 elif MODE=='disable':disable()
 else:raise Stop('bad_mode')
if __name__=='__main__':
 try:main()
 except Exception as ex:
  print('STOP='+str(ex) if isinstance(ex,Stop) else 'STOP=operation_failed_'+type(ex).__name__);sys.exit(1)
