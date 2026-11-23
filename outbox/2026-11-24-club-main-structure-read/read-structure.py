import os,sys,stat,json,re,hashlib,subprocess,base64
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
 require(hashlib.sha256(data).hexdigest()==EXPECTED_MAIN,'main_baseline_changed')
 parser=base64.b64decode(PARSER_B64,validate=True).decode()
 inspector=base64.b64decode(INSPECTOR_B64,validate=True).decode()
 require(hashlib.sha256(parser.encode()).hexdigest()==PARSER_SHA,'parser_checksum_mismatch')
 require(hashlib.sha256(inspector.encode()).hexdigest()==INSPECTOR_SHA,'inspector_checksum_mismatch')
 payload=json.dumps({'parser':parser,'inspector':inspector,'source':data.decode('utf-8')}).encode()
 bootstrap=BOOTSTRAP.replace('__PARSER_SHA__',PARSER_SHA).replace('__INSPECTOR_SHA__',INSPECTOR_SHA)
 args=['/usr/bin/docker','--host','unix:///var/run/docker.sock','exec','-i','--user','node','-e','NODE_OPTIONS=','-e','NODE_PATH=','supabase-n8n-1','node','--max-old-space-size=96','-e',bootstrap]
 result=subprocess.run(args,input=payload,capture_output=True,cwd='/',env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'},timeout=30)
 require(result.returncode==0,'isolated_parser_failed_or_node_unavailable')
 require(len(result.stdout)<262144,'parser_output_too_large')
 report=json.loads(result.stdout)
 require(isinstance(report,dict) and report.get('schema')=='main_structure_v2','parser_failed_source_not_exported')
 report['main_sha256']=hashlib.sha256(data).hexdigest()
 report['parser']='@babel/parser 7.29.7 (bundled, no installation)'
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
