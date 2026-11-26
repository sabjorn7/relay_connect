from pathlib import Path
import tempfile,subprocess,json
root=Path(__file__).resolve().parents[1];bin=Path(subprocess.check_output(['pg_config','--bindir'],text=True).strip());work=Path(tempfile.mkdtemp(prefix='mg-push-pilot-pg-',dir='/private/tmp'));started=False
def run(args,**kw):return subprocess.run([str(x) for x in args],check=True,capture_output=True,text=True,**kw)
run([bin/'initdb','-D',work/'data','-A','trust','--no-locale'])
try:
 run([bin/'pg_ctl','-D',work/'data','-l',work/'log','-o',f"-k {work} -p 54339 -c listen_addresses=''",'start']);started=True
 def sql(s):return run([bin/'psql','-X','-v','ON_ERROR_STOP=1','-h',work,'-p','54339','-d','postgres','-Atq'],input=s).stdout.strip()
 sql("""CREATE ROLE anon;CREATE ROLE authenticated;CREATE TABLE club_chat(id uuid primary key,club uuid,owner uuid,text text,deleted boolean default false);CREATE TABLE club_posts(id uuid primary key,club uuid,text text,date_send timestamptz);CREATE SCHEMA net;CREATE TABLE test_push_requests(id bigserial,body jsonb);CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$DECLARE i bigint;BEGIN INSERT INTO public.test_push_requests(body) VALUES(body) RETURNING id INTO i;RETURN i;END$$;CREATE FUNCTION public.push_send_key() RETURNS text LANGUAGE sql AS $$SELECT 'synthetic-only'$$;""")
 sql((root/'tests/push-fixture.sql').read_text());club='737b8824-88b8-4cee-b50b-3f4ed3b59683';other='33333333-3333-4333-8333-333333333333';ids=[f'11111111-1111-4111-8111-{i:012d}' for i in range(7)]
 sql(f"INSERT INTO club_chat(id,club,text) VALUES('{ids[0]}','{club}','before');");assert sql('SELECT count(*) FROM test_push_requests')=='0'
 localmd5=sql("SELECT md5(pg_get_functiondef('public.trg_push_web_club()'::regprocedure))")
 # PostgreSQL versions can normalize pg_get_functiondef differently; production hash remains pinned in real wrapper.
 enable=(root/'enable.proposed.sql').read_text().replace('ec8ba5df4b6f60ebe49751ec56e987a9',localmd5);sql(enable)
 sql(f"INSERT INTO club_chat(id,club,text) VALUES('{ids[1]}','{other}','other club'),('{ids[2]}','{club}','pilot');")
 assert sql('SELECT count(*) FROM test_push_requests')=='1'
 sql(f"UPDATE club_chat SET text='edit',web_push_queued_at=NULL WHERE id='{ids[2]}'; UPDATE club_chat SET text='old row' WHERE id='{ids[0]}';")
 assert sql('SELECT count(*) FROM test_push_requests')=='1'
 sql(f"INSERT INTO club_posts(id,club,text,date_send) VALUES('{ids[3]}','{club}','scheduled',now()+interval '1 day'),('{ids[4]}','{club}','published',NULL),('{ids[5]}','{other}','other',NULL);")
 assert sql('SELECT count(*) FROM test_push_requests')=='2'
 sql(f"UPDATE club_posts SET date_send=NULL WHERE id='{ids[3]}'; UPDATE club_posts SET text='edited',web_push_queued_at=NULL WHERE id='{ids[4]}';")
 assert sql('SELECT count(*) FROM test_push_requests')=='3'
 sql(f"UPDATE club_posts SET date_send=now() WHERE id='{ids[3]}';UPDATE club_posts SET date_send=NULL WHERE id='{ids[3]}';")
 assert sql('SELECT count(*) FROM test_push_requests')=='3'
 sql((root/'disable.sql').read_text());sql(f"INSERT INTO club_chat(id,club,text) VALUES('{ids[6]}','{club}','after disable');");assert sql('SELECT count(*) FROM test_push_requests')=='3'
 bodies=json.loads(sql('SELECT json_agg(body) FROM test_push_requests'));assert all(set(b) in [{'event','message_id'},{'event','post_id'}] for b in bodies)
 print('PASS local PostgreSQL: disabled baseline, exact club WHEN, message INSERT only, first publish, edits/reset/republish no repeat, no historical backfill, disable, minimal queue payload. No network/provider requests.')
finally:
 if started:run([bin/'pg_ctl','-D',work/'data','-m','fast','stop'])
