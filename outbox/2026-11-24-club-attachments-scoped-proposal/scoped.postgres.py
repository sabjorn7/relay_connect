"""Isolated local PostgreSQL only; no production connection or network requests."""
import pathlib,tempfile,subprocess,os
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
 A='11111111-1111-4111-8111-111111111111';B='22222222-2222-4222-8222-222222222222';C='33333333-3333-4333-8333-333333333333';D='44444444-4444-4444-8444-444444444444';X='77777777-7777-4777-8777-777777777777'
 sql(f"INSERT INTO clubs VALUES('{C}','{A}'),('{D}','{A}');INSERT INTO club_subs(club,suber,active,end_date) VALUES('{C}','{B}',true,current_date+30),('{D}','{B}',true,current_date+30);")
 def asuser(u,q):return sql(f"SET ROLE authenticated;SET request.jwt.claim.sub='{u}';"+q)
 def denied(u,q):
  try:asuser(u,q)
  except subprocess.CalledProcessError:return
  raise AssertionError('Expected denial: '+q)
 sql('BEGIN;'+(root/'01-functions-disabled.sql').read_text()+(root/'02-storage-policy.REQUIRES-APPROVAL.sql').read_text()+'COMMIT;')
 assert asuser(B,f"SELECT club_chat_capabilities('{C}')->>'attachments';").endswith('false')
 run([bin/'psql','-X','-v','ON_ERROR_STOP=1','-v','pilot_club='+C,'-h',work,'-p','54337','-d','postgres','-f',root/'enable-one-club.sql'])
 assert asuser(B,f"SELECT club_chat_capabilities('{C}')->>'attachments';").endswith('true')
 for u,c in [(B,D),(X,C)]:assert asuser(u,f"SELECT club_chat_capabilities('{c}')->>'attachments';").endswith('false')
 assert asuser(B,"SELECT club_chat_capabilities()->>'attachments';").endswith('false')
 assert sql(f"SET ROLE anon; SELECT club_chat_capabilities('{C}')->>'attachments';").endswith('false')
 for i,(ext,kind) in enumerate([('png','image'),('pdf','file'),('mp3','audio')]):
  r=f'55555555-5555-4555-8555-{i:012d}';path=f'{C}/{B}/{r}.{ext}'
  upload=f"INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('club-chat-private','{path}','{{\"size\":100}}');"
  call=f"SELECT club_chat_send_attachment('{C}','{r}','{path}','{kind}','test.{ext}',100);"
  denied(B,upload.replace(C,D));denied(X,upload.replace(B,X));denied(B,call.replace(C,D))
  asuser(B,upload);first=asuser(B,call).splitlines()[-1];assert first==asuser(B,call).splitlines()[-1]
  denied(X,call)
 assert sql('SELECT count(*) FROM club_chat;')=='3'
 sql((root/'disable.sql').read_text());denied(B,call)
 denied(B,upload.replace(r,'66666666-6666-4666-8666-666666666666'))
 sql((root/'rollback.sql').read_text())
 assert sql("SELECT count(*) FROM pg_proc WHERE proname='club_chat_capabilities';")=='1'
 assert asuser(B,"SELECT club_chat_capabilities()->>'attachments';").endswith('false')
 assert sql('SELECT count(*) FROM club_chat;')=='3'
 assert sql('SELECT count(*) FROM club_subs;')=='2'
 assert sql("SELECT bool_or(relrowsecurity) FROM pg_class WHERE oid IN ('club_chat'::regclass,'club_subs'::regclass);")=='f'
 print('PASS: scoped capability, member/outsider/anon, legacy disabled, direct upload denied outside pilot despite broad legacy policy, image/file/audio send, duplicate request, disable and rollback preserve data. LOCAL POSTGRES ONLY; proposed Storage policy changes included for this test.')
finally:
 if started:run([bin/'pg_ctl','-D',work/'data','stop','-m','fast'])
