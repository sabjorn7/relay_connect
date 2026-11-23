import os,sys,stat,json,base64,hashlib,subprocess,datetime,time,urllib.request,urllib.error
from pathlib import Path
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'}
BACKUP=Path('/var/lib/mg-deploy/club-key-forwarding/20261124-v1')
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
 secure_dir(p.parent);tmp=p.parent/('.mg-key-forward-'+os.urandom(12).hex())
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


def discover(require_running=True):
 release=json.loads(read(RELEASE_STATE));need(release.get('complete') and not release.get('rolled_back'),'release_not_complete')
 c=json.loads(docker('inspect','supabase-edge-functions'))[0]
 need('edge-runtime' in c['Config']['Image'],'unexpected_runtime')
 if require_running:need(c['State']['Running'],'edge_not_running')
 mounts=[m for m in c['Mounts'] if m['Destination'].rstrip('/')=='/home/deno/functions'];need(len(mounts)==1,'unexpected_mount')
 root=Path(mounts[0]['Source']);need(str(root/'checkout-pay-link')==release['target'],'mount_changed')
 secure_dir(root/'main');secure_dir(root/'checkout-pay-link')
 return c['Id'],root

def patch_main(source):
 need(sha(source)==MAIN_SHA,'main_baseline_mismatch')
 parser=base64.b64decode(PARSER_B64,validate=True).decode();patcher=base64.b64decode(PATCHER_B64,validate=True).decode()
 need(sha(parser.encode())==PARSER_SHA and sha(patcher.encode())==PATCHER_SHA,'bundled_code_checksum_mismatch')
 bootstrap=BOOTSTRAP.replace('__PARSER_SHA__',PARSER_SHA).replace('__PATCHER_SHA__',PATCHER_SHA)
 args=['/usr/bin/docker','--host','unix:///var/run/docker.sock','exec','-i','--user','node','-e','NODE_OPTIONS=','-e','NODE_PATH=','supabase-n8n-1','node','--max-old-space-size=96','-e',bootstrap]
 p=subprocess.run(args,input=json.dumps({'parser':parser,'patcher':patcher,'source':source.decode('utf-8')}).encode(),capture_output=True,cwd='/',env=ENV,timeout=30)
 need(p.returncode==0 and len(p.stdout)<4096,'source_structure_or_parser_failed')
 result=json.loads(p.stdout);a=result.get('start_byte');b=result.get('end_byte')
 need(type(a) is int and type(b) is int and 0<=a<b<=len(source) and source[a:b]==b'envVars','invalid_patch_range')
 replacement=b'envVars: await (await import("./club-key-env.mjs")).clubWorkerEnv(servicePath, envVars)'
 need(result.get('syntax_valid') is True and result.get('replacement')==replacement.decode(),'unexpected_patch')
 updated=source[:a]+replacement+source[b:]
 need(updated[:a]==source[:a] and updated[a+len(replacement):]==source[b:],'outside_patch_change')
 return updated

def unchanged(root,meta):
 for name,digest in meta['protected_sources'].items():need(sha(read(root/name))==digest,'unrelated_source_changed')
 # Metadata only: never open, hash or chmod the secret file.
 k=(root/'checkout-pay-link/.prodamus-key.json').lstat()
 actual=[k.st_dev,k.st_ino,k.st_uid,k.st_gid,stat.S_IMODE(k.st_mode),k.st_size,k.st_mtime_ns]
 need(actual==meta['key_metadata'],'key_file_changed')

def rollback(cid,root,meta):
 need(str(root)==meta['root'],'rollback_mount_changed')
 main=root/'main/index.ts';helper=root/'main/club-key-env.mjs'
 before=read(BACKUP/'main.before.ts');need(sha(before)==MAIN_SHA,'backup_mismatch')
 current=sha(read(main));need(current in (MAIN_SHA,meta['after_sha']),'unknown_main_changes')
 if os.path.lexists(helper):need(sha(read(helper))==HELPER_SHA,'unknown_helper_changes')
 # Validate all before the first write. Do not overwrite someone else's changes.
 unchanged(root,meta)
 if current!=MAIN_SHA:
  replace(main,before,meta['main_meta']);docker('restart',cid,timeout=60)
 smoke()
 if os.path.lexists(helper):helper.unlink()
 print('ROLLBACK_COMPLETE=True; ORIGINAL_MAIN_RESTORED=True; KEY_UNCHANGED=True')
 print('BACKUP='+str(BACKUP))

def run():
 need(os.geteuid()==0,'approved_root_execution_required');os.umask(0o077)
 cid,root=discover(require_running=MODE!='rollback')
 if MODE=='rollback':rollback(cid,root,json.loads(read(BACKUP/'metadata.json')));return
 need(MODE=='install','invalid_mode')
 main=root/'main/index.ts';helper=root/'main/club-key-env.mjs'
 if os.path.lexists(BACKUP):
  meta=json.loads(read(BACKUP/'metadata.json'))
  need(str(root)==meta['root'] and sha(read(BACKUP/'main.before.ts'))==MAIN_SHA,'backup_mismatch')
  need(sha(read(main))==meta['after_sha'] and sha(read(helper))==HELPER_SHA,'existing_backup_requires_review')
  unchanged(root,meta)
  print('ALREADY_INSTALLED=True; NO_RESTART=True');return
 source=read(main);need(sha(source)==MAIN_SHA,'main_baseline_mismatch')
 need(sha(read(root/'checkout-pay-link/index.ts'))==CHECKOUT_SHA,'checkout_baseline_mismatch')
 need(not os.path.lexists(helper),'helper_already_exists')
 helper_data=base64.b64decode(HELPER_B64,validate=True);need(sha(helper_data)==HELPER_SHA,'helper_payload_mismatch')
 new_main=patch_main(source)
 # All preparation/syntax checks complete before creating backups or changing code.
 st=main.stat();k=(root/'checkout-pay-link/.prodamus-key.json').lstat()
 need(stat.S_ISREG(k.st_mode) and k.st_uid==0 and k.st_gid==0 and stat.S_IMODE(k.st_mode)==0o400,'unexpected_key_metadata')
 protected={str(p.relative_to(root)):sha(read(p)) for p in [root/'checkout-pay-link/index.ts',root/'checkout-pay-link/handler.mjs',root/'checkout-pay-link/clubPayment.mjs']}
 meta={'root':str(root),'before_sha':MAIN_SHA,'after_sha':sha(new_main),'helper_sha':HELPER_SHA,'main_meta':{'uid':st.st_uid,'gid':st.st_gid,'mode':stat.S_IMODE(st.st_mode)},'protected_sources':protected,'key_metadata':[k.st_dev,k.st_ino,k.st_uid,k.st_gid,stat.S_IMODE(k.st_mode),k.st_size,k.st_mtime_ns]}
 secure_dir(BACKUP,True);save(BACKUP/'main.before.ts',source);save(BACKUP/'metadata.json',json.dumps(meta).encode())
 need(sha(read(BACKUP/'main.before.ts'))==MAIN_SHA,'backup_verification_failed')
 try:
  unchanged(root,meta);need(sha(read(main))==MAIN_SHA,'main_changed_before_install')
  save(helper,helper_data);os.chmod(helper,0o644)
  need(sha(read(helper))==HELPER_SHA,'helper_verification_failed')
  replace(main,new_main,meta['main_meta']);need(sha(read(main))==meta['after_sha'],'main_verification_failed')
  docker('restart',cid,timeout=60)
  since=docker('inspect','--format','{{.State.StartedAt}}',cid).decode().strip()
  smoke()
  records=[]
  for _ in range(4):
   records=diagnostic_records(docker('logs','--since',since,'--tail','200',cid))
   if records:break
   time.sleep(1)
  need(bool(records),'worker_diagnostic_missing')
  need(all(r['env_present'] and r['env_nonempty'] and r['env_error'] is None and r['source']=='env' for r in records),'key_forwarding_not_confirmed')
  unchanged(root,meta)
  for r in records[-3:]:print(json.dumps(r,sort_keys=True))
  print('KEY_FORWARDING_INSTALLED=True; AUTH_SMOKE=401; KEY_UNCHANGED=True; NO_ORDERS_OR_PAYMENTS=True')
  print('MAIN_SHA256='+meta['after_sha']);print('BACKUP='+str(BACKUP))
 except BaseException:
  try:rollback(cid,root,meta)
  except BaseException:print('AUTO_ROLLBACK_FAILED=True; MANUAL_REVIEW_REQUIRED=True')
  raise
if __name__=='__main__':
 try:run()
 except Stop as e:print('STOP='+str(e));sys.exit(1)
 except BaseException:print('STOP=administrative_operation_failed; raw_details_suppressed');sys.exit(1)
