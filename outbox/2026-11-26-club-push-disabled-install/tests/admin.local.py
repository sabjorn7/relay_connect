from pathlib import Path
import tempfile,hashlib,base64,contextlib,io
ROOT=Path(__file__).resolve().parents[1]
old=(ROOT/'baseline-index.ts').read_bytes();new=(ROOT/'supabase/functions/web-push-send/index.ts').read_bytes();helper=(ROOT/'supabase/functions/web-push-send/club.mjs').read_bytes()
def fixture(bad=False,fail=False):
 d=Path(tempfile.mkdtemp(prefix='mg-push-installer-test-'));root=d/'functions';f=root/'web-push-send';f.mkdir(parents=True);(f/'index.ts').write_bytes(b'changed' if bad else old)
 e={'PUSH_SEND_KEY':'synthetic-only'};c={'Id':'synthetic-container','Config':{'Env':['PUSH_SEND_KEY=synthetic-only']},'State':{'Running':True}}
 g={'__name__':'test','MODE':'install','OLD_SHA':hashlib.sha256(old).hexdigest(),'NEW_SHA':hashlib.sha256(new).hexdigest(),'HELPER_SHA':hashlib.sha256(helper).hexdigest(),'NEW_B64':base64.b64encode(new).decode(),'HELPER_B64':base64.b64encode(helper).decode()};exec(compile((ROOT/'admin.py').read_text(),'admin.py','exec'),g)
 g['BASE']=d/'backup';g['secure']=lambda p:None;g['read']=lambda p:p.read_bytes();g['discover']=lambda:(c,root);g['container']=lambda n:c;g['triggers']=lambda:[{'state':'D'},{'state':'D'}];g['restart']=lambda cid:None;g['smoke']=lambda *a,**kw:{'mock':True}
 g['info']=lambda:(c,root,e,(f/'index.ts').read_bytes(),{'candidate_matches':False,'baseline_matches':not bad,'helper_exists':False,'global_push_enabled':True,'allowlist_mode':'all','secrets_present':{'x':True}})
 def verify(e,clubs):
  if fail and clubs:raise g['Stop']('synthetic_smoke_failure')
  return {'synthetic':True}
 g['verify']=verify;return g,f
buf=io.StringIO()
with contextlib.redirect_stdout(buf):
 g,f=fixture();g['install']();assert (f/'index.ts').read_bytes()==new and (f/'club.mjs').read_bytes()==helper;assert (g['BASE']/'index.ts').read_bytes()==old
 g['rollback']();assert (f/'index.ts').read_bytes()==old and not (f/'club.mjs').exists()
 g,f=fixture(bad=True)
 try:g['install']();raise AssertionError('mismatch accepted')
 except g['Stop']:pass
 assert not g['BASE'].exists() and (f/'index.ts').read_bytes()==b'changed'
 g,f=fixture(fail=True)
 try:g['install']();raise AssertionError('failed smoke accepted')
 except g['Stop']:pass
 assert (f/'index.ts').read_bytes()==old and not (f/'club.mjs').exists()
 g,f=fixture();g['install']();(f/'index.ts').write_bytes(b'unrelated')
 try:g['rollback']();raise AssertionError('drift overwritten')
 except g['Stop']:pass
 assert (f/'index.ts').read_bytes()==b'unrelated'
assert 'synthetic-only' not in buf.getvalue()
print('PASS local installer orchestration: backup, exact install, exact rollback, baseline mismatch no-write, smoke failure auto-rollback, foreign drift refusal, no secret in output. Docker/HTTP/privileged filesystem mocked; production NOT TESTED.')
