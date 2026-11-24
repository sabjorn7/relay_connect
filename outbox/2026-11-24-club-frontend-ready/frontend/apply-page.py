# Run from isolated application checkout; no network or production writes.
import json,hashlib,pathlib
spec=json.loads((pathlib.Path(__file__).parent/'page-changes.json').read_text())
p=pathlib.Path(spec['file']);raw=p.read_bytes()
assert hashlib.sha256(raw).hexdigest()==spec['base_sha256'],'Page baseline mismatch: stop'
text=raw.decode();data=json.loads(text)
# Modify the exact existing action args substring; preserve all unrelated JSON bytes.
path=spec['changes'][0]['path'][:-1];obj=data
for key in path:obj=obj[key]
old=json.dumps(obj,ensure_ascii=False,separators=(',',':'))
assert text.count(old)==1,'Action serialization differs: stop'
for change in spec['changes']:
 assert change['path'][:-1]==path
 key=change['path'][-1];assert obj.get(key)==change['old'];obj[key]=change['new']
new=json.dumps(obj,ensure_ascii=False,separators=(',',':'))
p.write_text(text.replace(old,new,1))
print('Updated only club history projection/filter; no other page changes')
