import os,sys,stat,json,base64,hashlib,subprocess,datetime,time,urllib.request,urllib.error
from pathlib import Path
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'}
BACKUP=Path('/var/lib/mg-deploy/club-key-diagnostic/20261123-v1')
RELEASE_STATE=Path('/var/lib/mg-deploy/club-release/install-20261123T195707Z-161238/state.json')
class Stop(Exception):pass
def need(ok,code):
 if not ok:raise Stop(code)
def secure_dir(p,create=False):
 cur=Path('/')
 for part in Path(p).parts[1:]:
  cur/=part
  if create and not os.path.lexists(cur):cur.mkdir(mode=0o700)
  s=cur.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'unsafe_directory')
def read(p):
 p=Path(p);secure_dir(p.parent)
 with os.fdopen(os.open(p,os.O_RDONLY|os.O_NOFOLLOW),'rb') as f:
  s=os.fstat(f.fileno());need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022 and s.st_size<1048576,'unsafe_file')
  data=f.read(1048576);need(len(data)<1048576,'file_too_large');return data

def sha(b):return hashlib.sha256(b).hexdigest()
def save(p,b):
 secure_dir(p.parent)
 with os.fdopen(os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
def replace(p,b,meta):
 secure_dir(p.parent);tmp=p.parent/('.mg-key-diag-'+os.urandom(12).hex())
 try:
  save(tmp,b);os.chown(tmp,meta['uid'],meta['gid']);os.chmod(tmp,meta['mode']);os.replace(tmp,p)
  fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(fd)
  finally:os.close(fd)
 finally:
  if tmp.exists():tmp.unlink()
def docker(*args,timeout=30):
 p=subprocess.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock',*args],capture_output=True,env=ENV,cwd='/',timeout=timeout)
 need(p.returncode==0,'docker_operation_failed');return p.stdout+p.stderr if args and args[0]=='logs' else p.stdout

def discover():
 # The container ID/mount is read afresh, then matched against the successful installer.
 state=json.loads(read(RELEASE_STATE));need(state.get('complete') is True and not state.get('rolled_back'),'release_not_complete')
 c=json.loads(docker('inspect','supabase-edge-functions'))[0]
 need(c['State']['Running'] and 'edge-runtime' in c['Config']['Image'],'edge_not_running')
 mounts=[m for m in c['Mounts'] if m['Destination'].rstrip('/')=='/home/deno/functions']
 need(len(mounts)==1,'unexpected_mount')
 target=Path(mounts[0]['Source'])/'checkout-pay-link';secure_dir(target)
 need(str(target)==state['target'],'changed_edge_path')
 return c['Id'],target

def smoke():
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args):raise Stop('unexpected_redirect')
 op=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 for _ in range(10):
  try:
   req=urllib.request.Request('https://app.meetgu.ru/sb/functions/v1/checkout-pay-link',data=b'{}',method='POST',headers={'Content-Type':'application/json'})
   try:r=op.open(req,timeout=4)
   except urllib.error.HTTPError as e:r=e
   with r:
    if r.status==401 and r.headers.get('x-meetguru-club-version')=='club-rpc-1' and json.loads(r.read(1024))=={'error':'unauthorized'}:return
  except Exception:pass
  time.sleep(1)
 raise Stop('anonymous_smoke_failed')

BOOL_FIELDS={'env_present','env_nonempty','file_read','json_valid','json_object','key_present','key_nonempty'}
ERROR_FIELDS={'env_error','file_error','json_error'}
ERROR_TYPES={'Error','TypeError','SyntaxError','NotFound','PermissionDenied','NotSupported','NotCapable','InvalidData','UnexpectedEof','Other'}
def diagnostic_records(raw):
 records=[]
 for line in raw.decode('utf-8',errors='replace').splitlines():
  at=line.find('{')
  if at<0:continue
  try:value=json.JSONDecoder().raw_decode(line[at:])[0]
  except Exception:continue
  if not isinstance(value,dict) or value.get('event')!='club_key_load_v1':continue
  if set(value)!=BOOL_FIELDS|ERROR_FIELDS|{'event','source'}:continue
  if not all(type(value[k]) is bool for k in BOOL_FIELDS):continue
  if not all(value[k] is None or (type(value[k]) is str and value[k] in ERROR_TYPES) for k in ERROR_FIELDS):continue
  if value['source'] not in ('env','file','none'):continue
  records.append(value)
 return records

def restore(cid,target,meta):
 need(str(target)==meta['target'],'rollback_target_changed')
 before=read(BACKUP/'index.before.ts');need(sha(before)==BASELINE,'backup_mismatch')
 current=sha(read(target/'index.ts'));need(current in (BASELINE,DIAGNOSTIC_SHA),'unexpected_index_changes')
 if current==BASELINE:print('ALREADY_ROLLED_BACK=True');return
 replace(target/'index.ts',before,meta);docker('restart',cid,timeout=60);smoke()
 print('ROLLED_BACK=True; AUTH_SMOKE=401')

def run():
 need(os.geteuid()==0,'approved_root_execution_required');os.umask(0o077)
 cid,target=discover()
 if MODE=='rollback':
  meta=json.loads(read(BACKUP/'metadata.json'));restore(cid,target,meta);return
 need(MODE=='install','invalid_mode')
 current=read(target/'index.ts')
 if sha(current)==DIAGNOSTIC_SHA:
  need(sha(read(BACKUP/'index.before.ts'))==BASELINE,'backup_mismatch')
  print('ALREADY_INSTALLED=True; NO_RESTART=True');return
 need(sha(current)==BASELINE,'baseline_mismatch')
 need(not os.path.lexists(BACKUP),'backup_directory_exists_review_required')
 diagnostic=base64.b64decode(PAYLOAD,validate=True);need(sha(diagnostic)==DIAGNOSTIC_SHA,'payload_mismatch')
 # Hash only non-secret source files. Never read/hash the key or environment values.
 siblings={n:sha(read(target/n)) for n in ['handler.mjs','clubPayment.mjs']}
 st=(target/'index.ts').stat();meta={'target':str(target),'uid':st.st_uid,'gid':st.st_gid,'mode':stat.S_IMODE(st.st_mode),'before_sha256':BASELINE,'diagnostic_sha256':DIAGNOSTIC_SHA}
 secure_dir(BACKUP,True);save(BACKUP/'index.before.ts',current);save(BACKUP/'metadata.json',json.dumps(meta).encode())
 need(sha(read(BACKUP/'index.before.ts'))==BASELINE,'backup_mismatch')
 since=datetime.datetime.now(datetime.timezone.utc).isoformat()
 try:
  need(sha(read(target/'index.ts'))==BASELINE,'index_changed_before_install')
  replace(target/'index.ts',diagnostic,meta);need(sha(read(target/'index.ts'))==DIAGNOSTIC_SHA,'installed_hash_mismatch')
  docker('restart',cid,timeout=60);smoke()
  reports=[]
  for _ in range(4):
   reports=diagnostic_records(docker('logs','--since',since,'--tail','200',cid))
   if reports:break
   time.sleep(1)
  need(bool(reports),'worker_diagnostic_missing')
  need(all(sha(read(target/n))==h for n,h in siblings.items()),'other_source_changed')
  for report in reports[-3:]:print(json.dumps(report,sort_keys=True))
  print('DIAGNOSTIC_INSTALLED=True; AUTH_SMOKE=401; NO_ORDERS_OR_PAYMENTS=True')
  print('BACKUP='+str(BACKUP))
 except Exception:
  try:restore(cid,target,meta)
  except Exception:print('AUTO_ROLLBACK_FAILED=True; MANUAL_REVIEW_REQUIRED=True')
  raise
if __name__=='__main__':
 try:run()
 except Stop as e:print('STOP='+str(e));sys.exit(1)
 except BaseException:print('STOP=administrative_operation_failed; raw_details_suppressed');sys.exit(1)
