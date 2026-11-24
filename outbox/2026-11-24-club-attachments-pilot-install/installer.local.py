"""Isolated local PostgreSQL only; no production connection or network requests."""
import pathlib,tempfile,subprocess,os,json
root=pathlib.Path(__file__).resolve().parent
bin=pathlib.Path(subprocess.check_output(['pg_config','--bindir'],text=True).strip())
work=pathlib.Path(tempfile.mkdtemp(prefix='mg-club-pg-',dir='/private/tmp'))
def run(args,**kw):
 r=subprocess.run([str(x) for x in args],capture_output=True,text=True,**kw)
 if r.returncode:raise subprocess.CalledProcessError(r.returncode,args,output=r.stdout,stderr=r.stderr)
 return r
run([bin/'initdb','-D',work/'data','-A','trust','--no-locale'])
started=False
try:
 run([bin/'pg_ctl','-D',work/'data','-l',work/'log','-o',"-k "+str(work)+" -p 54337 -c listen_addresses=''",'start']);started=True
 def sql(s):return run([bin/'psql','-X','-v','ON_ERROR_STOP=1','-h',work,'-p','54337','-d','postgres','-At'],input=s).stdout.strip()
 sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO anon,authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
 CREATE TABLE public.clubs(id uuid PRIMARY KEY,owner uuid); CREATE TABLE public.club_subs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club uuid,suber uuid,active boolean,end_date date,created_at timestamptz DEFAULT now());
 CREATE TABLE public.club_chat(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club uuid,owner uuid,text text,img text[] DEFAULT '{}',created_at timestamptz DEFAULT now(),deleted boolean DEFAULT false);
 CREATE TABLE public.club_posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club uuid,text text,date_send timestamptz,likes jsonb);
 GRANT SELECT ON public.clubs TO anon,authenticated; GRANT ALL ON public.club_chat,public.club_posts TO anon,authenticated;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage TO anon,authenticated;GRANT ALL ON storage.objects TO anon,authenticated;
 CREATE POLICY legacy_broad_storage ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);
 CREATE SCHEMA net;CREATE TABLE public.test_push_requests(id bigserial,body jsonb);
 CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$DECLARE i bigint;BEGIN INSERT INTO public.test_push_requests(body) VALUES(body) RETURNING id INTO i;RETURN i;END;$$;
 CREATE FUNCTION public.push_send_key() RETURNS text LANGUAGE sql AS $$ SELECT 'synthetic-only'::text $$;''')
 sql((root/'baseline.sql').read_text())

 sql("CREATE FUNCTION public.test_push_noop() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$; CREATE TRIGGER trg_push_web_club_message AFTER INSERT ON public.club_chat FOR EACH ROW EXECUTE FUNCTION public.test_push_noop(); CREATE TRIGGER trg_push_web_club_post AFTER INSERT ON public.club_posts FOR EACH ROW EXECUTE FUNCTION public.test_push_noop(); ALTER TABLE public.club_chat DISABLE TRIGGER trg_push_web_club_message; ALTER TABLE public.club_posts DISABLE TRIGGER trg_push_web_club_post;")
 import unittest.mock,base64,hashlib,sys,contextlib,io
 names=['install.sql','rollback-checked.sql','disable.sql','state-query.sql','invariants-query.sql','expected-before.json','expected-disabled.json']
 payload={n:base64.b64encode((root/n).read_bytes()).decode() for n in names};hashes={n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in names}
 realrun=subprocess.run
 def fake(args,**kw):
  assert args[0]=='/usr/bin/docker',args
  if args[1:]==['ps','-q']:return subprocess.CompletedProcess(args,0,b'isolated-db\n',b'')
  if args[1]=='inspect':return subprocess.CompletedProcess(args,0,json.dumps([{'Id':'isolated-db','Config':{'Labels':{'com.docker.compose.service':'db'},'Image':'postgres:15','Env':['POSTGRES_USER='+os.environ.get('USER','postgres'),'POSTGRES_DB=postgres']}}]).encode(),b'')
  assert args[1:4]==['exec','-i','isolated-db'],args
  cmd=[str(bin/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h',str(work),'-p','54337','-d','postgres']
  return realrun(cmd,**kw)
 source=(root/'admin.py').read_text().replace('/var/lib/mg-deploy/club-attachment-scope',str(work/'backups'))
 def admin(mode,args=[],bad=False):
  h=dict(hashes)
  if bad:h['install.sql']='0'*64
  with unittest.mock.patch.object(os,'geteuid',return_value=0),unittest.mock.patch.object(subprocess,'run',side_effect=fake),unittest.mock.patch.object(sys,'argv',['admin',*args]):
   try:exec(compile(source,'admin.py','exec'),{'PAYLOAD':payload,'SHA':h,'MODE':mode})
   except SystemExit as e:
    assert e.code==0
 try:admin('install',bad=True);raise RuntimeError('corrupt accepted')
 except AssertionError:pass
 before=sql((root/'state-query.sql').read_text())
 # A failed post-check must roll back the entire installation transaction.
 broken=(root/'install.sql').read_text().replace('COMMIT;',"DO $$ BEGIN RAISE EXCEPTION 'synthetic_postcheck_failure'; END $$; COMMIT;")
 try:sql(broken);raise RuntimeError('expected failure')
 except subprocess.CalledProcessError:pass
 assert sql((root/'state-query.sql').read_text())==before
 admin('install');admin('status')
 try:admin('install');raise RuntimeError('reinstall accepted')
 except AssertionError:pass
 backup=next(x for x in (work/'backups').iterdir() if x.is_dir());assert (backup/'SHA256.json').exists()
 # Enable a synthetic club, then check full administrative disable and rollback.
 C='33333333-3333-4333-8333-333333333333'
 sql(f"INSERT INTO clubs(id,owner) VALUES('{C}','11111111-1111-4111-8111-111111111111');")
 run([bin/'psql','-X','-v','ON_ERROR_STOP=1','-v','pilot_club='+C,'-h',work,'-p','54337','-d','postgres','-f',root/'enable-one-club.sql'])
 try:admin('rollback',[str(backup)]);raise RuntimeError('enabled rollback accepted')
 except AssertionError:pass
 admin('disable');admin('rollback');admin('status')
 assert sql((root/'state-query.sql').read_text())==before
 assert sql('SELECT count(*) FROM clubs;')=='1'
 print('PASS: generated atomic install SQL; admin install/status/disable/rollback; corrupt payload denied; repeat install denied; enabled rollback denied; post-check failure rolls back; backups checksummed; data preserved. Docker transport mocked to local PostgreSQL; no production calls.')
finally:
 if started:run([bin/'pg_ctl','-D',work/'data','stop','-m','fast'])
