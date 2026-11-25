from pathlib import Path
import json,hashlib,base64
P=Path(__file__).parent
before=json.loads((P/'expected-before.json').read_text());after=json.loads((P/'expected-disabled.json').read_text())
def literal(v):return "'"+json.dumps(v,separators=(',',':')).replace("'","''")+"'::jsonb"
state=(P/'state-query.sql').read_text().strip();inv=(P/'invariants-query.sql').read_text().strip()
def tx(old,new,body):
 return "BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s';\n"+f"DO $check$ BEGIN IF ({state}) IS DISTINCT FROM {literal(old)} THEN RAISE EXCEPTION 'baseline_mismatch'; END IF; END $check$;\n"+f"CREATE TEMP TABLE mg_club_scope_before ON COMMIT DROP AS {inv} AS state;\n"+body+'\n'+f"DO $check$ BEGIN IF ({state}) IS DISTINCT FROM {literal(new)} THEN RAISE EXCEPTION 'result_mismatch'; END IF; IF ({inv}) IS DISTINCT FROM (SELECT state FROM mg_club_scope_before) THEN RAISE EXCEPTION 'unrelated_objects_changed'; END IF; END $check$;\nCOMMIT;\n"
# SELECT expression alias needs to follow expression, not entire query ambiguity: generated query ends ')'.
install=tx(before,after,(P/'01-functions-disabled.sql').read_text()+(P/'02-storage-policy.REQUIRES-APPROVAL.sql').read_text())
rollbackbody='\n'.join(l for l in (P/'rollback.sql').read_text().splitlines() if l.strip() not in ('BEGIN;','COMMIT;'))
rollback=tx(after,before,rollbackbody)
(P/'install.sql').write_text(install);(P/'rollback-checked.sql').write_text(rollback)
files=['install.sql','rollback-checked.sql','disable.sql','state-query.sql','invariants-query.sql','expected-before.json','expected-disabled.json']
payload={n:base64.b64encode((P/n).read_bytes()).decode() for n in files}
sha={n:hashlib.sha256((P/n).read_bytes()).hexdigest() for n in files}
source=(P/'admin.py').read_text()
for mode in ['install','rollback','status','disable']:
 code='PAYLOAD='+repr(payload)+'\nSHA='+repr(sha)+'\nMODE='+repr(mode)+'\n'+source
 compile(code,'admin-'+mode,'exec')
 (P/f'meetguru-club-scope-{mode}-20261124.sh').write_text("#!/usr/bin/env bash\nset -euo pipefail\numask 077\npython3 - \"$@\" <<'MG_PY'\n"+code+'\nMG_PY\n')
print('Generated checksummed wrappers and atomic SQL')
