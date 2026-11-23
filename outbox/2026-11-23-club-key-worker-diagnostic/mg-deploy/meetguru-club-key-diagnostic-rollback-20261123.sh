#!/bin/bash
set -euo pipefail
umask 077
[ "${MG_CONFIRM:-}" = yes ] || { echo 'STOP: use approved mg-deploy'; exit 1; }
cd /
exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 /usr/bin/python3 -I -S - <<'MG_CLUB_KEY_DIAG'
MODE='rollback'
BASELINE='857a675b962483005ff41cdc39eaa070410b0fcf27cbc2c9ee06734cd1982b41'
DIAGNOSTIC_SHA='a1aa4e054a18418568959113d83edd6395a8e3c2480b73222056a93779c2dac5'
PAYLOAD='aW1wb3J0IHsgY3JlYXRlQ2hlY2tvdXRIYW5kbGVyIH0gZnJvbSAnLi9oYW5kbGVyLm1qcyc7Ci8vIFRlbXBvcmFyeSB3b3JrZXItc3RhcnQgZGlhZ25vc3RpYy4gTmV2ZXIgbG9nIGVycm9yIG1lc3NhZ2VzLCBwYXRocyBvciBrZXkgbWF0ZXJpYWwuCmZ1bmN0aW9uIGtleUxvYWRFcnJvclR5cGUoZXJyb3IpIHsKICAgIGNvbnN0IGFsbG93ZWQgPSBbJ0Vycm9yJywgJ1R5cGVFcnJvcicsICdTeW50YXhFcnJvcicsICdOb3RGb3VuZCcsICdQZXJtaXNzaW9uRGVuaWVkJywgJ05vdFN1cHBvcnRlZCcsICdOb3RDYXBhYmxlJywgJ0ludmFsaWREYXRhJywgJ1VuZXhwZWN0ZWRFb2YnXTsKICAgIHRyeSB7IHJldHVybiBhbGxvd2VkLmluY2x1ZGVzKGVycm9yPy5uYW1lKSA/IGVycm9yLm5hbWUgOiAnT3RoZXInOyB9CiAgICBjYXRjaCB7IHJldHVybiAnT3RoZXInOyB9Cn0KY29uc3Qga2V5TG9hZFN0YXRlID0gewogICAgZXZlbnQ6ICdjbHViX2tleV9sb2FkX3YxJywKICAgIGVudl9wcmVzZW50OiBmYWxzZSwgZW52X25vbmVtcHR5OiBmYWxzZSwgZW52X2Vycm9yOiBudWxsLAogICAgZmlsZV9yZWFkOiBmYWxzZSwgZmlsZV9lcnJvcjogbnVsbCwKICAgIGpzb25fdmFsaWQ6IGZhbHNlLCBqc29uX2Vycm9yOiBudWxsLCBqc29uX29iamVjdDogZmFsc2UsIGtleV9wcmVzZW50OiBmYWxzZSwga2V5X25vbmVtcHR5OiBmYWxzZSwKICAgIHNvdXJjZTogJ25vbmUnLAp9OwpsZXQgZW52S2V5LCBmaWxlS2V5LCBlbnZGYWlsdXJlOwp0cnkgewogICAgZW52S2V5ID0gRGVuby5lbnYuZ2V0KCdQUk9EQU1VU19TRUNSRVRfS0VZJyk7CiAgICBrZXlMb2FkU3RhdGUuZW52X3ByZXNlbnQgPSBlbnZLZXkgIT09IHVuZGVmaW5lZDsKICAgIGtleUxvYWRTdGF0ZS5lbnZfbm9uZW1wdHkgPSB0eXBlb2YgZW52S2V5ID09PSAnc3RyaW5nJyAmJiBlbnZLZXkudHJpbSgpLmxlbmd0aCA+IDA7Cn0gY2F0Y2ggKGVycm9yKSB7CiAgICBlbnZGYWlsdXJlID0gZXJyb3I7CiAgICBrZXlMb2FkU3RhdGUuZW52X2Vycm9yID0ga2V5TG9hZEVycm9yVHlwZShlcnJvcik7Cn0KbGV0IGtleUZpbGVUZXh0Owp0cnkgewogICAga2V5RmlsZVRleHQgPSBEZW5vLnJlYWRUZXh0RmlsZVN5bmMobmV3IFVSTCgnLi8ucHJvZGFtdXMta2V5Lmpzb24nLCBpbXBvcnQubWV0YS51cmwpKTsKICAgIGtleUxvYWRTdGF0ZS5maWxlX3JlYWQgPSB0cnVlOwp9IGNhdGNoIChlcnJvcikgewogICAga2V5TG9hZFN0YXRlLmZpbGVfZXJyb3IgPSBrZXlMb2FkRXJyb3JUeXBlKGVycm9yKTsKfQppZiAoa2V5TG9hZFN0YXRlLmZpbGVfcmVhZCkgewogICAgdHJ5IHsKICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKGtleUZpbGVUZXh0KTsKICAgICAgICBrZXlMb2FkU3RhdGUuanNvbl92YWxpZCA9IHRydWU7CiAgICAgICAga2V5TG9hZFN0YXRlLmpzb25fb2JqZWN0ID0gcGFyc2VkICE9PSBudWxsICYmIHR5cGVvZiBwYXJzZWQgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHBhcnNlZCk7CiAgICAgICAga2V5TG9hZFN0YXRlLmtleV9wcmVzZW50ID0ga2V5TG9hZFN0YXRlLmpzb25fb2JqZWN0ICYmIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChwYXJzZWQsICdrZXknKTsKICAgICAgICBmaWxlS2V5ID0gcGFyc2VkPy5rZXk7CiAgICAgICAga2V5TG9hZFN0YXRlLmtleV9ub25lbXB0eSA9ICEhcGFyc2VkICYmICFBcnJheS5pc0FycmF5KHBhcnNlZCkKICAgICAgICAgICAgJiYgdHlwZW9mIGZpbGVLZXkgPT09ICdzdHJpbmcnICYmIGZpbGVLZXkudHJpbSgpLmxlbmd0aCA+IDA7CiAgICB9IGNhdGNoIChlcnJvcikgewogICAgICAgIGtleUxvYWRTdGF0ZS5qc29uX2Vycm9yID0ga2V5TG9hZEVycm9yVHlwZShlcnJvcik7CiAgICB9Cn0KLy8gUHJlc2VydmUgZXhpc3RpbmcgZW52aXJvbm1lbnQgcHJlY2VkZW5jZSBhbmQga2V5IHZhbHVlOyBkbyBub3Qgbm9ybWFsaXplIHNlY3JldHMuCmNvbnN0IGNsdWJTaWduaW5nS2V5ID0gZW52S2V5IHx8IGZpbGVLZXk7CmtleUxvYWRTdGF0ZS5zb3VyY2UgPSBlbnZLZXkgPyAnZW52JyA6IGZpbGVLZXkgPyAnZmlsZScgOiAnbm9uZSc7CmNvbnNvbGUuaW5mbyhKU09OLnN0cmluZ2lmeShrZXlMb2FkU3RhdGUpKTsKLy8gS2VlcCBlbnZpcm9ubWVudC1hY2Nlc3MgZmFpbHVyZXMgZmF0YWwsIGJ1dCBleHBvc2Ugbm8gb3JpZ2luYWwgZXhjZXB0aW9uIHRleHQuCmlmIChlbnZGYWlsdXJlKSB0aHJvdyBuZXcgRXJyb3IoJ2NsdWJfa2V5X2Vudmlyb25tZW50X3VuYXZhaWxhYmxlJyk7CkRlbm8uc2VydmUoY3JlYXRlQ2hlY2tvdXRIYW5kbGVyKHsgZmV0Y2gsIGVudjogewogICAgU1VQQUJBU0VfVVJMOiBEZW5vLmVudi5nZXQoJ1NVUEFCQVNFX1VSTCcpLAogICAgU1VQQUJBU0VfQU5PTl9LRVk6IERlbm8uZW52LmdldCgnU1VQQUJBU0VfQU5PTl9LRVknKSwKICAgIFNVUEFCQVNFX1NFUlZJQ0VfUk9MRV9LRVk6IERlbm8uZW52LmdldCgnU1VQQUJBU0VfU0VSVklDRV9ST0xFX0tFWScpLAogICAgUFJPREFNVVNfU0VDUkVUX0tFWTogY2x1YlNpZ25pbmdLZXksCiAgICBTSVRFX09SSUdJTjogRGVuby5lbnYuZ2V0KCdTSVRFX09SSUdJTicpLAp9IH0pKTsK'
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

MG_CLUB_KEY_DIAG
