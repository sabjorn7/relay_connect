from pathlib import Path
import base64,hashlib,json
out=Path(__file__).parent
src=Path('/private/tmp/mg-club-relay-20261123/outbox/2026-11-24-club-chat-final/server')
payload={n:base64.b64encode((src/n).read_bytes()).decode() for n in ['attachments.proposed.sql','push.proposed.sql','disable.sql']}
sha={n:hashlib.sha256((src/n).read_bytes()).hexdigest() for n in payload}
code='''import base64,hashlib,json,os,subprocess,datetime,pathlib,sys
PAYLOAD=__PAYLOAD__
SHA=__SHA__
MODE=__MODE__
if os.geteuid()!=0:raise SystemExit('STOP: approved mg-deploy/root required')
def run(args,data=None):
 p=subprocess.run(args,input=data,capture_output=True,timeout=90)
 if p.returncode:raise RuntimeError('Command failed: '+args[0]+'; details saved only in root backup if available')
 return p.stdout
ids=run(['/usr/bin/docker','ps','-q']).decode().split()
containers=json.loads(run(['/usr/bin/docker','inspect',*ids]))
found=[c for c in containers if (c['Config'].get('Labels') or {}).get('com.docker.compose.service')=='db' and 'postgres' in c['Config']['Image']]
assert len(found)==1,'Unexpected database container count'
c=found[0];env=dict(x.split('=',1) for x in c['Config'].get('Env',[]) if '=' in x)
user=env.get('POSTGRES_USER','postgres');db=env.get('POSTGRES_DB','postgres')
def sql(s):return run(['/usr/bin/docker','exec','-i',c['Id'],'psql','-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-U',user,'-d',db],s.encode()).decode().strip()
def save(path,data):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as f:f.write(data)
for n,v in PAYLOAD.items():assert hashlib.sha256(base64.b64decode(v)).hexdigest()==SHA[n]
if MODE=='disable':
 # Non-destructive operational rollback; never drop rows/columns/bucket or alter old RLS.
 sql(base64.b64decode(PAYLOAD['disable.sql']).decode())
 print('DISABLED: attachments=false; both club web push triggers disabled; no data deleted');sys.exit(0)
base=pathlib.Path('/var/lib/mg-deploy/club-chat-prepare')
for p in [base,*base.parents]:assert not p.is_symlink(),'Unsafe backup path'
base.mkdir(mode=0o700,exist_ok=True)
backup=base/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+str(os.getpid()));backup.mkdir(mode=0o700)
checks="""SELECT jsonb_build_object(
 'new_functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND p.proname IN ('club_chat_has_access','club_chat_capabilities','club_chat_path_club','club_chat_send_attachment','trg_push_web_club')),
 'new_columns',(SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('club_chat','club_posts') AND column_name IN ('attachment_path','attachment_type','attachment_name','attachment_size','attachment_request_id','web_push_queued_at')),
 'new_policies',(SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND policyname LIKE 'club_private_%'),
 'bucket',(SELECT count(*) FROM storage.buckets WHERE id='club-chat-private'),
 'columns',(SELECT jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',udt_name) ORDER BY table_name,column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('club_chat','club_posts','clubs','club_subs')),
 'dependencies',to_regprocedure('public.push_send_key()') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net'))"""
before=json.loads(sql(checks));save(backup/'preflight.json',json.dumps(before,indent=2).encode())
assert before['new_functions']==before['new_columns']==before['new_policies']==before['bucket']==0,'Already installed or conflicting objects: stop'
assert before['dependencies'],'Missing push dependency'
actual={(x['table'],x['column']):x['type'] for x in before['columns']}
required={('club_chat','id'):'uuid',('club_chat','club'):'uuid',('club_chat','owner'):'uuid',('club_chat','img'):'_text',('club_chat','deleted'):'bool',('club_posts','id'):'uuid',('club_posts','date_send'):'timestamptz',('club_posts','club'):'uuid',('club_subs','end_date'):'date',('club_subs','created_at'):'timestamptz',('clubs','owner'):'uuid'}
assert all(actual.get(k)==v for k,v in required.items()),'Column baseline mismatch'
dump=run(['/usr/bin/docker','exec',c['Id'],'pg_dump','--schema-only','--no-password','-U',user,'-d',db,'-t','public.club_chat','-t','public.club_posts','-t','storage.objects','-t','storage.buckets'])
save(backup/'schema-before.sql',dump)
for n,v in PAYLOAD.items():save(backup/n,base64.b64decode(v))
save(backup/'SHA256.json',json.dumps({**SHA,'schema-before.sql':hashlib.sha256(dump).hexdigest()},indent=2).encode())
# Transport wrapper combines both agreed files into one all-or-nothing transaction.
def body(n):return '\\n'.join(l for l in base64.b64decode(PAYLOAD[n]).decode().splitlines() if l.strip() not in ('BEGIN;','COMMIT;'))
script="BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s';\\n"+body('attachments.proposed.sql')+'\\n'+body('push.proposed.sql')+"""
DO $verify$ BEGIN
 IF public.club_chat_capabilities()->>'attachments'<>'false' THEN RAISE EXCEPTION 'Attachments unexpectedly enabled'; END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_push_web_club_message','trg_push_web_club_post') AND tgenabled='D')<>2 THEN RAISE EXCEPTION 'Push triggers not disabled'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='club-chat-private' AND public=false AND file_size_limit=26214400) THEN RAISE EXCEPTION 'Private bucket mismatch'; END IF;
END $verify$;
COMMIT;
"""
save(backup/'transaction.sql',script.encode())
try:result=sql(script)
except Exception:
 print('STOP: transaction failed; PostgreSQL rolls back both files; BACKUP='+str(backup));raise
verify=sql("SELECT jsonb_build_object('capabilities',public.club_chat_capabilities(),'triggers',(SELECT jsonb_object_agg(tgname,tgenabled) FROM pg_trigger WHERE tgname IN ('trg_push_web_club_message','trg_push_web_club_post')),'objects',(SELECT count(*) FROM storage.objects WHERE bucket_id='club-chat-private'),'bucket_private',(SELECT NOT public FROM storage.buckets WHERE id='club-chat-private'))")
save(backup/'after.json',verify.encode());print(verify);print('INSTALLED_DISABLED; BACKUP='+str(backup))
'''
for mode,name in [('install','install'),('disable','rollback')]:
 result=code.replace('__PAYLOAD__',repr(payload)).replace('__SHA__',repr(sha)).replace('__MODE__',repr(mode))
 compile(result,name,'exec')
 file=out/f'meetguru-club-chat-{name}-20261124.sh';assert not file.exists();file.write_text("#!/usr/bin/env bash\nset -euo pipefail\numask 077\npython3 - <<'MG_PY'\n"+result+"\nMG_PY\n")
 print(file.name,hashlib.sha256(file.read_bytes()).hexdigest())
