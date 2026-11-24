# Embedded by build.py. No production calls at build time.
import base64,hashlib,json,os,subprocess,datetime,pathlib,sys
if os.geteuid()!=0:raise SystemExit('STOP: approved mg-deploy/root required')
files={n:base64.b64decode(v) for n,v in PAYLOAD.items()}
assert all(hashlib.sha256(v).hexdigest()==SHA[n] for n,v in files.items()),'Payload checksum mismatch'
def run(args,data=None):
 p=subprocess.run(args,input=data,capture_output=True,timeout=90)
 if p.returncode:raise RuntimeError('Command failed; no secrets printed; transaction, if open, rolled back')
 return p.stdout
ids=run(['/usr/bin/docker','ps','-q']).decode().split();assert ids,'No running containers'
items=json.loads(run(['/usr/bin/docker','inspect',*ids]))
dbs=[c for c in items if (c['Config'].get('Labels') or {}).get('com.docker.compose.service')=='db' and 'postgres' in c['Config']['Image']]
assert len(dbs)==1,'Unexpected database container count'
c=dbs[0];env=dict(x.split('=',1) for x in c['Config'].get('Env',[]) if '=' in x)
def sql(s):
 return run(['/usr/bin/docker','exec','-i',c['Id'],'psql','-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-U',env.get('POSTGRES_USER','postgres'),'-d',env.get('POSTGRES_DB','postgres')],s.encode()).decode().strip()
def state():return json.loads(sql(files['state-query.sql'].decode()))
def invariants():return json.loads(sql(files['invariants-query.sql'].decode()))
def verify_guard(v):
 assert v['bucket']['public'] is False,'Bucket not private'
 assert v['push']=={'trg_push_web_club_message':'D','trg_push_web_club_post':'D'},'Unexpected push state; nothing changed'
def save(path,data):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as f:f.write(data)
expected=json.loads(files['expected-before.json']);disabled=json.loads(files['expected-disabled.json'])
current=state();unchanged=invariants();verify_guard(unchanged)
base=pathlib.Path('/var/lib/mg-deploy/club-attachment-scope')
if MODE=='status':
 print(json.dumps({'baseline_matches':current==expected,'scoped_disabled_matches':current==disabled,'bucket_private':True,'push_triggers':'disabled'}));sys.exit(0)
if MODE=='install':
 assert current==expected,'Baseline mismatch or already installed: stop without changes'
 for p in [base,*base.parents]:assert not p.is_symlink(),'Unsafe backup path'
 base.mkdir(mode=0o700,exist_ok=True)
 backup=base/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+str(os.getpid()));backup.mkdir(mode=0o700)
 save(backup/'before.json',json.dumps(current,sort_keys=True,indent=2).encode())
 save(backup/'invariants.json',json.dumps(unchanged,sort_keys=True,indent=2).encode())
 for n in ['install.sql','rollback-checked.sql','disable.sql']:save(backup/n,files[n])
 manifest={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in backup.iterdir()}
 save(backup/'SHA256.json',json.dumps(manifest,sort_keys=True).encode())
 pointer=base/'active-backup.txt';assert not pointer.is_symlink(),'Unsafe backup pointer'
 temporary=backup/'pointer.tmp';save(temporary,(str(backup)+'\n').encode());os.replace(temporary,pointer)
 print('BACKUP='+str(backup),flush=True)
 sql(files['install.sql'].decode())
 assert state()==disabled and invariants()==unchanged,'Post-check mismatch; stop and inspect saved backup'
 print('INSTALLED_DISABLED; attachments=false; push unchanged; no frontend deployment')
elif MODE=='rollback':
 assert len(sys.argv)<=2,'At most one explicit backup directory'
 pointer=base/'active-backup.txt';assert not pointer.is_symlink(),'Unsafe backup pointer'
 backup=pathlib.Path(sys.argv[1] if len(sys.argv)==2 else pointer.read_text().strip());assert backup.parent==base and backup.is_dir() and not backup.is_symlink(),'Invalid backup'
 manifest=json.loads((backup/'SHA256.json').read_text())
 for name,h in manifest.items():
  assert pathlib.Path(name).name==name and not (backup/name).is_symlink(),'Invalid backup entry'
  assert hashlib.sha256((backup/name).read_bytes()).hexdigest()==h,'Backup checksum mismatch'
 assert json.loads((backup/'before.json').read_text())==expected,'Wrong baseline backup'
 assert (backup/'rollback-checked.sql').read_bytes()==files['rollback-checked.sql'],'Rollback package mismatch'
 assert current==disabled,'Disable first; or state drift: stop'
 sql(files['rollback-checked.sql'].decode())
 assert state()==expected and invariants()==unchanged,'Rollback post-check mismatch'
 print('ROLLED_BACK_DISABLED; data preserved; push unchanged')
elif MODE=='disable':
 # Only replace our own scoped capability; preserve all other definitions.
 key='club_chat_capabilities(uuid)'
 assert key in current['functions'],'Scoped capability absent'
 normalized=json.loads(json.dumps(current));normalized['functions'][key]=disabled['functions'][key]
 assert normalized==disabled,'Unexpected schema drift; stop'
 sql(files['disable.sql'].decode())
 assert state()==disabled and invariants()==unchanged,'Disable verification failed'
 print('DISABLED; existing objects/messages preserved; push unchanged')
else:raise SystemExit('Unknown mode')
