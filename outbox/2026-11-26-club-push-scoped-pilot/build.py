from pathlib import Path
import json,hashlib,base64
p=Path(__file__).resolve().parent;r=json.loads((p/'recipients.json').read_text());ids=r['approved_user_ids'];club=r['club_id']
assert not ids,'Regenerate a reviewed recipient-specific revision after user approval; do not silently edit this package'
old=(p/'baseline-index.ts').read_bytes();helper=(p/'supabase/functions/web-push-send/club.mjs').read_bytes();base=(p/'baseline-club.mjs').read_bytes()
needle=b"const PUSH_CLUB_ENABLED = Deno.env.get('PUSH_CLUB_ENABLED') === 'true';";assert old.count(needle)==1
kill=old.replace(needle,b'const PUSH_CLUB_ENABLED = false; // Emergency stop for club events only.')
triggers={'trg_push_web_club_message':'CREATE TRIGGER trg_push_web_club_message BEFORE INSERT OR UPDATE ON club_chat FOR EACH ROW EXECUTE FUNCTION trg_push_web_club()','trg_push_web_club_post':'CREATE TRIGGER trg_push_web_club_post BEFORE INSERT OR UPDATE ON club_posts FOR EACH ROW EXECUTE FUNCTION trg_push_web_club()'}
disable="BEGIN; SET LOCAL lock_timeout='3s'; ALTER TABLE public.club_chat DISABLE TRIGGER trg_push_web_club_message; ALTER TABLE public.club_posts DISABLE TRIGGER trg_push_web_club_post; COMMIT;"
enable="BEGIN; SET LOCAL lock_timeout='3s'; LOCK TABLE public.club_chat,public.club_posts IN SHARE ROW EXCLUSIVE MODE; DO $$BEGIN IF md5(pg_get_functiondef('public.trg_push_web_club()'::regprocedure)) <> 'ec8ba5df4b6f60ebe49751ec56e987a9' THEN RAISE EXCEPTION 'function drift'; END IF; END$$; "
for table,event in [('club_chat','message'),('club_posts','post')]:enable+=f"CREATE OR REPLACE TRIGGER trg_push_web_club_{event} BEFORE INSERT OR UPDATE ON public.{table} FOR EACH ROW WHEN (NEW.club='{club}'::uuid) EXECUTE FUNCTION public.trg_push_web_club(); "
enable+='COMMIT;'
vals={'CLUB':club,'RECIPIENTS':ids,'BASE_TRIGGERS':triggers,'FUNCTION_MD5':'ec8ba5df4b6f60ebe49751ec56e987a9','INDEX_SHA':hashlib.sha256(old).hexdigest(),'BASE_HELPER_SHA':hashlib.sha256(base).hexdigest(),'HELPER_SHA':hashlib.sha256(helper).hexdigest(),'KILL_SHA':hashlib.sha256(kill).hexdigest(),'HELPER_B64':base64.b64encode(helper).decode(),'KILL_B64':base64.b64encode(kill).decode(),'ENABLE_SQL':enable,'DISABLE_SQL':disable}
lines=[]
for mode in ['status','install','enable','disable']:
 src='MODE='+repr(mode)+'\n'+''.join(k+'='+repr(v)+'\n' for k,v in vals.items())+(p/'admin.py').read_text();f=p/f'meetguru-club-push-pilot-{mode}-20261126.sh';f.write_text("#!/bin/bash\nset -euo pipefail\numask 077\n/usr/bin/python3 - <<'MG_PILOT'\n"+src+"\nMG_PILOT\n");lines.append(hashlib.sha256(f.read_bytes()).hexdigest()+'  '+f.name)
(p/'WRAPPER-SHA256.txt').write_text('\n'.join(lines)+'\n');(p/'enable.proposed.sql').write_text('-- DO NOT EXECUTE: recipients not yet approved; use guarded mg-deploy wrapper only.\n'+enable+'\n');(p/'disable.sql').write_text(disable+'\n')
(p/'source-manifest.json').write_text(json.dumps({k:v for k,v in vals.items() if k.endswith('SHA')},indent=2)+'\n')
