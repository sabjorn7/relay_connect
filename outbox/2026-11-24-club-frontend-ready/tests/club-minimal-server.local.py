"""Isolated local PostgreSQL only; no production connection or network requests."""
import pathlib,tempfile,subprocess,os
root=pathlib.Path(__file__).resolve().parents[1]
bin=pathlib.Path(subprocess.check_output(['pg_config','--bindir'],text=True).strip())
work=pathlib.Path(tempfile.mkdtemp(prefix='mg-club-pg-',dir='/private/tmp'))
def run(args,**kw):
 r=subprocess.run([str(x) for x in args],capture_output=True,text=True,**kw)
 if r.returncode:raise subprocess.CalledProcessError(r.returncode,args,output=r.stdout,stderr=r.stderr)
 return r
run([bin/'initdb','-D',work/'data','-A','trust','--no-locale'])
started=False
try:
 run([bin/'pg_ctl','-D',work/'data','-l',work/'log','-o',"-k "+str(work)+" -p 54329 -c listen_addresses=''",'start']);started=True
 def sql(s):return run([bin/'psql','-X','-v','ON_ERROR_STOP=1','-h',work,'-p','54329','-d','postgres','-At'],input=s).stdout.strip()
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
 for part in ['attachments.proposed.sql','push.proposed.sql']:sql((root/'reviews/2026-11-24-club-finish/server'/part).read_text())
 A='11111111-1111-4111-8111-111111111111';B='22222222-2222-4222-8222-222222222222';C='33333333-3333-4333-8333-333333333333';D='44444444-4444-4444-8444-444444444444';R='55555555-5555-4555-8555-555555555555'
 sql(f"INSERT INTO clubs VALUES('{C}','{A}');INSERT INTO club_subs(club,suber,active,end_date) VALUES('{C}','{B}',true,current_date+30);")
 def asuser(u,q):return sql(f"SET ROLE authenticated;SET request.jwt.claim.sub='{u}';"+q)
 def denied(u,q):
  try:asuser(u,q)
  except subprocess.CalledProcessError:return
  raise AssertionError('Expected denial')
 assert asuser(B,"SELECT club_chat_capabilities()->>'attachments';").endswith('false')
 sql("CREATE OR REPLACE FUNCTION club_chat_capabilities() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT jsonb_build_object('attachments',auth.uid() IS NOT NULL) $$;")
 assert asuser(B,"SELECT club_chat_capabilities()->>'attachments';").endswith('true')
 p=f'{C}/{B}/{R}.pdf'
 asuser(B,f"INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('club-chat-private','{p}','{{\"size\":100,\"mimetype\":\"application/pdf\"}}');")
 call=f"SELECT club_chat_send_attachment('{C}','{R}','{p}','file','test.pdf',100);"
 first=asuser(B,call).splitlines()[-1];second=asuser(B,call).splitlines()[-1];assert first==second
 assert sql('SELECT count(*) FROM club_chat;')=='1'
 denied(D,call);denied(B,call.replace(',100)',',101)').replace(R,'66666666-6666-4666-8666-666666666666'))
 assert asuser(D,"SELECT count(*) FROM storage.objects WHERE bucket_id='club-chat-private';").endswith('0')
 assert asuser(B,f"UPDATE storage.objects SET metadata='{{}}' WHERE name='{p}' RETURNING name;").endswith('UPDATE 0')
 sql('ALTER TABLE club_chat ENABLE TRIGGER trg_push_web_club_message;ALTER TABLE club_posts ENABLE TRIGGER trg_push_web_club_post;')
 asuser(B,f"INSERT INTO club_chat(club,owner,text) VALUES('{C}','{B}','valid');")
 assert sql('SELECT count(*) FROM test_push_requests;')=='1'
 sql(f"INSERT INTO club_posts(id,club,text,date_send) VALUES('{R}','{C}','scheduled',now()+interval '1 hour');")
 assert sql('SELECT count(*) FROM test_push_requests;')=='1'
 sql(f"UPDATE club_posts SET date_send=NULL WHERE id='{R}';UPDATE club_posts SET date_send=NULL WHERE id='{R}';UPDATE club_posts SET text='edited' WHERE id='{R}';")
 assert sql('SELECT count(*) FROM test_push_requests;')=='2'
 sql(f"UPDATE club_chat SET text='edited',web_push_queued_at=NULL;UPDATE club_posts SET web_push_queued_at=NULL,date_send=now() WHERE id='{R}';UPDATE club_posts SET date_send=NULL WHERE id='{R}';")
 assert sql('SELECT count(*) FROM test_push_requests;')=='2'
 assert sql("SELECT count(*) FROM club_posts WHERE web_push_queued_at IS NOT NULL;")=='1'
 sql((root/'reviews/2026-11-24-club-finish/server/disable.sql').read_text())
 denied(B,call)
 assert sql('SELECT count(*) FROM club_subs;')=='1'
 assert sql("SELECT bool_or(relrowsecurity) FROM pg_class WHERE oid IN ('club_chat'::regclass,'club_posts'::regclass,'club_subs'::regclass);")=='f'
 print('PASS: SQL compilation; existing RLS unchanged; disabled gates; upload+send; idempotency; outsider attachment denial; restrictive Storage vs broad legacy policy; publication triggers; dedup; disable; subscription rows unchanged. Synthetic PostgreSQL only.')
 print('LOCAL_ARTIFACTS='+str(work))
finally:
 if started:run([bin/'pg_ctl','-D',work/'data','stop','-m','fast'])
