from pathlib import Path
import hashlib,base64,json
p=Path(__file__).resolve().parent
old=(p/'baseline-index.ts').read_bytes();new=(p/'supabase/functions/web-push-send/index.ts').read_bytes();helper=(p/'supabase/functions/web-push-send/club.mjs').read_bytes()
vals={'OLD_SHA':hashlib.sha256(old).hexdigest(),'NEW_SHA':hashlib.sha256(new).hexdigest(),'HELPER_SHA':hashlib.sha256(helper).hexdigest(),'NEW_B64':base64.b64encode(new).decode(),'HELPER_B64':base64.b64encode(helper).decode()}
lines=[]
for mode in ['status','install','rollback']:
 src='MODE='+repr(mode)+'\n'+''.join(k+'='+repr(v)+'\n' for k,v in vals.items())+(p/'admin.py').read_text()
 file=p/f'meetguru-club-push-{mode}-20261126.sh'
 file.write_text("#!/bin/bash\nset -euo pipefail\numask 077\n/usr/bin/python3 - <<'MG_CLUB_PUSH_PY'\n"+src+"\nMG_CLUB_PUSH_PY\n")
 lines.append(hashlib.sha256(file.read_bytes()).hexdigest()+'  '+file.name)
(p/'WRAPPER-SHA256.txt').write_text('\n'.join(lines)+'\n')
(p/'source-manifest.json').write_text(json.dumps({k:v for k,v in vals.items() if k.endswith('SHA')},indent=2)+'\n')
