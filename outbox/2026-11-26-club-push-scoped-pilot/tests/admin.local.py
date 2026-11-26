from pathlib import Path
import tempfile,base64,contextlib,io
root=Path(__file__).resolve().parents[1]
code='\n'.join((root/'meetguru-club-push-pilot-install-20261126.sh').read_text().splitlines()[4:-1])
g={'__name__':'test'};exec(compile(code,'embedded-admin','exec'),g)
d=Path(tempfile.mkdtemp(prefix='mg-push-pilot-installer-'));f=d/'functions/web-push-send';f.mkdir(parents=True)
old=(root/'baseline-index.ts').read_bytes();oldhelper=(root/'baseline-club.mjs').read_bytes();(f/'index.ts').write_bytes(old);(f/'club.mjs').write_bytes(oldhelper)
e={'PUSH_SEND_KEY':'synthetic-only','PUSH_ALLOWLIST':'*','PUSH_CLUB_ENABLED':'false'};c={'Id':'fixture','Config':{'Env':[k+'='+v for k,v in e.items()]},'State':{'Running':True}};db={'function_md5':g['FUNCTION_MD5'],'triggers':[{'name':n,'state':'D','definition':v} for n,v in g['BASE_TRIGGERS'].items()]};calls=[]
g.update(BASE=d/'backup',secure=lambda p:None,read=lambda p:p.read_bytes(),inspect=lambda:(c,f,e,db),discover=lambda:(c,f.parent),container=lambda n:c,smoke=lambda *a:None,verify=lambda *a:None,triggers=lambda:db['triggers'],restart=lambda cid:calls.append('restart'),sql=lambda s:calls.append(s) or '')
buf=io.StringIO()
with contextlib.redirect_stdout(buf):
 try:g['enable']();raise AssertionError('unapproved enable accepted')
 except g['Stop'] as ex:assert str(ex)=='recipient_approval_required'
 assert not calls
 g['install']();assert (f/'index.ts').read_bytes()==old;assert (f/'club.mjs').read_bytes()==base64.b64decode(g['HELPER_B64']);assert (g['BASE']/'club.mjs').read_bytes()==oldhelper
 assert len(calls)==1 and calls[0]=='restart';assert e['PUSH_ALLOWLIST']=='*'
 g['disable']();assert (f/'index.ts').read_bytes()==base64.b64decode(g['KILL_B64']);assert g['DISABLE_SQL'] in calls;assert 'DROP ' not in g['DISABLE_SQL'];assert e['PUSH_ALLOWLIST']=='*'
 count=calls.count('restart');g['disable']();assert calls.count('restart')==count
 (f/'index.ts').write_bytes(b'foreign')
 try:g['disable']();raise AssertionError('foreign index overwritten')
 except g['Stop']:pass
 assert (f/'index.ts').read_bytes()==b'foreign'
assert 'synthetic-only' not in buf.getvalue()
print('PASS local admin orchestration: unapproved enable refuses before side effects; helper-only disabled install; backup; club-only disable independent of env; idempotent disable; foreign source not overwritten; global allowlist unchanged. Privileged filesystem/Docker/SQL/HTTP mocked.')
