"""Fetch pinned public upstream source only. No n8n/Supabase credentials or production calls.
Run explicitly before check.mjs; never runs automatically during tests.
"""
import hashlib,json,pathlib,urllib.request,urllib.parse
root=pathlib.Path(__file__).resolve().parent
manifest=json.loads((root/'source-manifest.json').read_text())
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): raise RuntimeError('unexpected source redirect')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
for name,expected in manifest['files'].items():
    dest=root/'vendor'/name
    assert '..' not in pathlib.PurePosixPath(name).parts and not name.startswith('/')
    if dest.exists():
        assert hashlib.sha256(dest.read_bytes()).hexdigest()==expected['sha256'],'existing source mismatch'
        continue
    url='https://raw.githubusercontent.com/'+manifest['repository']+'/'+urllib.parse.quote(manifest['ref'],safe='')+'/'+name
    with opener.open(url,timeout=30) as response: content=response.read()
    assert hashlib.sha256(content).hexdigest()==expected['sha256'],'upstream content changed'
    assert hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()==expected['gitBlobSha']
    dest.parent.mkdir(parents=True,exist_ok=True)
    with dest.open('xb') as output: output.write(content)
print('PASS: pinned upstream sources verified; no application endpoints used')
