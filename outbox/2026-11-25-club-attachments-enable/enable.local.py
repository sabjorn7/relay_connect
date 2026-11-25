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


 sql((root/'01-functions-disabled.sql').read_text()+(root/'02-storage-policy.REQUIRES-APPROVAL.sql').read_text())
 sql("CREATE FUNCTION public.test_push_noop() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$; CREATE TRIGGER trg_push_web_club_message AFTER INSERT ON public.club_chat FOR EACH ROW EXECUTE FUNCTION public.test_push_noop(); CREATE TRIGGER trg_push_web_club_post AFTER INSERT ON public.club_posts FOR EACH ROW EXECUTE FUNCTION public.test_push_noop(); ALTER TABLE public.club_chat DISABLE TRIGGER trg_push_web_club_message; ALTER TABLE public.club_posts DISABLE TRIGGER trg_push_web_club_post;")
 import unittest.mock,base64,hashlib,sys
 names=['state-query.sql','invariants-query.sql','expected-disabled.json','expected-enabled.json','enable-function.sql','disable-function.sql']
 payload={n:base64.b64encode((root/n).read_bytes()).decode() for n in names};hashes={n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in names}
 realrun=subprocess.run
 def fake(args,**kw):
  assert args[0]=='/usr/bin/docker',args
  if args[1:]==['ps','-q']:return subprocess.CompletedProcess(args,0,b'isolated-db\n',b'')
  if args[1]=='inspect':return subprocess.CompletedProcess(args,0,json.dumps([{'Id':'isolated-db','Config':{'Labels':{'com.docker.compose.service':'db'},'Image':'postgres:15','Env':[]}}]).encode(),b'')
  assert args[1:4]==['exec','-i','isolated-db'],args
  return realrun([str(bin/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h',str(work),'-p','54337','-d','postgres'],**kw)
 source=(root/'admin.py').read_text().replace('/var/lib/mg-deploy/club-attachment-enable',str(work/'backups'))
 def admin(mode,bad=False):
  h=dict(hashes)
  if bad:h['enable-function.sql']='0'*64
  with unittest.mock.patch.object(os,'geteuid',return_value=0),unittest.mock.patch.object(subprocess,'run',side_effect=fake):
   try:exec(compile(source,'admin.py','exec'),{'PAYLOAD':payload,'SHA':h,'MODE':mode})
   except SystemExit as e:assert e.code==0
 C='737b8824-88b8-4cee-b50b-3f4ed3b59683';D='44444444-4444-4444-8444-444444444444';A='11111111-1111-4111-8111-111111111111';B='22222222-2222-4222-8222-222222222222';X='77777777-7777-4777-8777-777777777777'
 def denied_admin():
  try:admin('enable')
  except AssertionError:return
  raise AssertionError('Expected enable denied')
 denied_admin() # no clubs
 sql(f"INSERT INTO clubs VALUES('{C}','{A}'),('{D}','{A}');")
 denied_admin() # two clubs
 sql(f"DELETE FROM clubs WHERE id='{D}'; INSERT INTO club_subs(club,suber,end_date) VALUES('{C}','{B}',current_date+30);")
 try:admin('enable',bad=True);raise RuntimeError('corrupt payload accepted')
 except AssertionError:pass
 admin('enable');admin('enable') # idempotent
 def asuser(u,q):return sql(f"SET ROLE authenticated;SET request.jwt.claim.sub='{u}';"+q)
 def denied(u,q):
  try:asuser(u,q)
  except subprocess.CalledProcessError:return
  raise AssertionError('expected denial')
 assert asuser(B,f"SELECT club_chat_capabilities('{C}')->>'attachments';").endswith('true')
 assert asuser(A,f"SELECT club_chat_capabilities('{C}')->>'attachments';").endswith('true')
 assert asuser(X,f"SELECT club_chat_capabilities('{C}')->>'attachments';").endswith('false')
 assert asuser(B,f"SELECT club_chat_capabilities('{D}')->>'attachments';").endswith('false')
 assert sql(f"SET ROLE anon; SELECT club_chat_capabilities('{C}')->>'attachments';").endswith('false')
 for i,(ext,kind) in enumerate([('png','image'),('pdf','file'),('mp3','audio')]):
  req=f'55555555-5555-4555-8555-{i:012d}';path=f'{C}/{B}/{req}.{ext}'
  upload=f"INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('club-chat-private','{path}','{{\"size\":100}}');"
  call=f"SELECT club_chat_send_attachment('{C}','{req}','{path}','{kind}','test.{ext}',100);"
  denied(B,upload.replace(C,D));denied(X,upload.replace(B,X));asuser(B,upload)
  first=asuser(B,call).splitlines()[-1];assert asuser(B,call).splitlines()[-1]==first
 admin('disable');admin('disable');denied(B,call)
 denied(B,upload.replace(req,'66666666-6666-4666-8666-666666666666'))
 assert sql('SELECT count(*) FROM club_chat;')=='3';assert sql('SELECT count(*) FROM storage.objects;')=='3'
 assert sql('SELECT count(*) FROM club_subs;')=='1'
 assert json.loads(sql((root/'state-query.sql').read_text()))==json.loads((root/'expected-disabled.json').read_text())
 print('PASS: actual enable/disable admin; zero/multiple-club rejection; checksum rejection; idempotency; exact club owner/member allow; outsider/anon/other club deny; direct storage deny outside club; image/document/audio send; disable preserves messages/objects/membership and original policies. Local synthetic DB only.')
finally:
 if started:run([bin/'pg_ctl','-D',work/'data','stop','-m','fast'])
