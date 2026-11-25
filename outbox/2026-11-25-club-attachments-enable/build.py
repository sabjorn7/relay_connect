from pathlib import Path
import base64,hashlib
p=Path(__file__).parent
names=['state-query.sql','invariants-query.sql','expected-disabled.json','expected-enabled.json','enable-function.sql','disable-function.sql']
payload={n:base64.b64encode((p/n).read_bytes()).decode() for n in names};sha={n:hashlib.sha256((p/n).read_bytes()).hexdigest() for n in names}
for mode in ['enable','disable']:
 code='PAYLOAD='+repr(payload)+'\nSHA='+repr(sha)+'\nMODE='+repr(mode)+'\n'+(p/'admin.py').read_text();compile(code,mode,'exec')
 f=p/('meetguru-club-attachments-'+mode+'-20261125.sh');f.write_text("#!/usr/bin/env bash\nset -euo pipefail\numask 077\npython3 - <<'MG_PY'\n"+code+'\nMG_PY\n');print(f.name,hashlib.sha256(f.read_bytes()).hexdigest())
