"""Exact, reversible four-value WeWeb presentation patch; no workflow changes."""
import sys,json,hashlib
from pathlib import Path
package=Path(__file__).resolve().parent
root=Path(sys.argv[1]).resolve()
reverse='--reverse' in sys.argv[2:]
change=json.loads((package/'page-changes.json').read_text())
m=json.loads((package/'manifest.json').read_text())['files'][change['file']]
p=root/change['file'];raw=p.read_bytes();before,after=('after','before') if reverse else ('before','after')
assert hashlib.sha256(raw).hexdigest()==m[before],'Unexpected page SHA; stop, do not overwrite'
s=raw.decode();d=json.loads(s)
for uid in sorted({x['path'][1] for x in change['changes']}):
 node=d['wwObjects'][uid];original=json.dumps(node,ensure_ascii=False,separators=(',',':'));assert s.count(original)==1
 for c in change['changes']:
  if c['path'][1]!=uid:continue
  at=d
  for key in c['path'][:-1]:at=at[key]
  key=c['path'][-1];assert at[key]==c[before];at[key]=c[after]
 s=s.replace(original,json.dumps(node,ensure_ascii=False,separators=(',',':')))
updated=s.encode();assert hashlib.sha256(updated).hexdigest()==m[after]
p.write_bytes(updated);print('Page presentation patch: PASS')
