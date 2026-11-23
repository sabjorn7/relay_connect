import os,sys,stat,json,re,hashlib,subprocess
from pathlib import Path
class Stop(Exception):pass
def require(ok,code):
 if not ok:raise Stop(code)
def read(path):
 path=Path(path);cur=Path('/')
 for part in path.parts:
  if part=='/':continue
  cur/=part;s=cur.lstat()
  require(not stat.S_ISLNK(s.st_mode),'symlink_refused')
  require(s.st_uid==0 and not s.st_mode&0o022,'unsafe_owner_or_permissions')
 with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as f:
  s=os.fstat(f.fileno());require(stat.S_ISREG(s.st_mode) and s.st_size<262144,'unsafe_source')
  data=f.read(262144);require(len(data)<262144,'source_too_large');return data

def inspect_source(data):
 text=data.decode('utf-8');report={'main_sha256':hashlib.sha256(data).hexdigest()}
 # Export ONLY syntactically constrained, secret-free fragments. Unknown source
 # remains private. No general file contents, string literals, env or tokens.
 patterns={
 'service_path':r'\bconst\s+servicePath\s*=\s*`/home/deno/functions/\$\{functionName\}`\s*;',
 'env_vars':r'\bconst\s+envVars\s*=\s*Object\.entries\(\s*Deno\.env\.toObject\(\s*\)\s*\)\s*;',
 'create_call':r'\b(?:const|let)\s+worker\s*=\s*await\s+EdgeRuntime\.userWorkers\.create\(\s*\{\s*(?:(?:servicePath|memoryLimitMb|workerTimeoutMs|noModuleCache|importMapPath|envVars)\s*,?\s*)+\}\s*\)\s*;'
 }
 for name,pattern in patterns.items():
  found=list(re.finditer(pattern,text));report[name+'_match_count']=len(found)
  if len(found)==1:
   m=found[0];report[name]={'line':text.count('\n',0,m.start())+1,'source':m.group(0)}
 report['create_reference_count']=len(re.findall(r'EdgeRuntime\s*\.\s*userWorkers\s*\.\s*create\s*\(',text))
 report['restricted_fragments_complete']=all(report[n+'_match_count']==1 for n in patterns) and report['create_reference_count']==1
 report['scope']='restricted_actual_source_fragments_not_full_source'
 return report

def run():
 require(os.geteuid()==0,'approved_root_execution_required')
 env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'}
 p=subprocess.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','inspect','--format','{{json .Mounts}}','supabase-edge-functions'],capture_output=True,env=env,cwd='/',timeout=20)
 require(p.returncode==0,'docker_inspect_failed')
 mounts=[x for x in json.loads(p.stdout) if x['Destination'].rstrip('/')=='/home/deno/functions'];require(len(mounts)==1,'unexpected_mount')
 base=Path(mounts[0]['Source']);state=json.loads(read('/var/lib/mg-deploy/club-release/install-20261123T195707Z-161238/state.json'))
 require(str(base/'checkout-pay-link')==state['target'],'changed_mount')
 result=inspect_source(read(base/'main/index.ts'))
 # Code hashes only: the secret file is never opened or hashed.
 result['checkout_index_sha256']=hashlib.sha256(read(base/'checkout-pay-link/index.ts')).hexdigest()
 result['writes']=False;result['restarts']=False;result['payment_calls']=False
 print(json.dumps(result,ensure_ascii=True,indent=2))
if __name__=='__main__':
 try:run()
 except Stop as e:print('STOP='+str(e));sys.exit(1)
 except BaseException:print('STOP=read_only_inspection_failed; raw_details_suppressed');sys.exit(1)
