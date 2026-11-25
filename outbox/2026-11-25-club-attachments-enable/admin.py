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
 return run(['/usr/bin/docker','exec','-i',c['Id'],'psql','-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-U',env.get('POSTGRES_USER','postgres'),'-d',env.get('POSTGRES_DB','postgres')],('SET search_path TO public;\n'+s).encode()).decode().strip()
def state():return json.loads(sql(files['state-query.sql'].decode()))
def invariants():return json.loads(sql(files['invariants-query.sql'].decode()))
def verify_guard(v):
 assert v['bucket']['public'] is False,'Bucket not private'
 assert v['push']=={'trg_push_web_club_message':'D','trg_push_web_club_post':'D'},'Unexpected push state; nothing changed'
def save(path,data):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as f:f.write(data)
CLUB='737b8824-88b8-4cee-b50b-3f4ed3b59683'
disabled=json.loads(files['expected-disabled.json']);enabled=json.loads(files['expected-enabled.json'])
current=state();unchanged=invariants();verify_guard(unchanged)
assert MODE in ('enable','disable')
assert current in (disabled,enabled),'Unexpected schema drift; stop without writes'
if MODE=='enable':
 assert sql("SELECT count(*)=1 AND bool_and(id='"+CLUB+"'::uuid) FROM public.clubs")=='t','Club set changed; stop'
target=enabled if MODE=='enable' else disabled
if current==target:
 print('ALREADY_'+MODE.upper()+'D; no changes');sys.exit(0)
base=pathlib.Path('/var/lib/mg-deploy/club-attachment-enable')
for path in [base,*base.parents]:assert not path.is_symlink(),'Unsafe backup path'
base.mkdir(mode=0o700,exist_ok=True)
backup=base/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+str(os.getpid()));backup.mkdir(mode=0o700)
save(backup/'before.json',json.dumps(current,sort_keys=True,indent=2).encode())
save(backup/'invariants.json',json.dumps(unchanged,sort_keys=True,indent=2).encode())
save(backup/'disable-function.sql',files['disable-function.sql'])
def literal(value):return "'"+json.dumps(value).replace("'","''")+"'::jsonb"
q=files['state-query.sql'].decode();iq=files['invariants-query.sql'].decode()
script="BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s';\n"
script+="DO $check$ BEGIN IF ("+q+") IS DISTINCT FROM "+literal(current)+" THEN RAISE EXCEPTION 'state_changed'; END IF; END $check$;\n"
if MODE=='enable':
 script+="DO $check$ BEGIN IF NOT (SELECT count(*)=1 AND COALESCE(bool_and(id='"+CLUB+"'::uuid),false) FROM public.clubs) THEN RAISE EXCEPTION 'club_set_changed'; END IF; END $check$;\n"
script+="CREATE TEMP TABLE mg_club_scope_before ON COMMIT DROP AS "+iq+" AS state;\n"
script+=files[MODE+'-function.sql'].decode()+"\n"
script+="DO $check$ BEGIN IF ("+q+") IS DISTINCT FROM "+literal(target)+" THEN RAISE EXCEPTION 'result_mismatch'; END IF; IF ("+iq+") IS DISTINCT FROM (SELECT state FROM mg_club_scope_before) THEN RAISE EXCEPTION 'unrelated_change'; END IF; END $check$; COMMIT;"
save(backup/'transaction.sql',script.encode())
save(backup/'SHA256.json',json.dumps({f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in backup.iterdir()},sort_keys=True).encode())
print('BACKUP='+str(backup),flush=True)
sql(script)
assert state()==target and invariants()==unchanged,'Postcheck mismatch; inspect backup'
print(('ENABLED_ONE_CLUB='+CLUB if MODE=='enable' else 'DISABLED_ALL_CLUBS')+'; PUSH_UNCHANGED=True; DATA_PRESERVED=True')
