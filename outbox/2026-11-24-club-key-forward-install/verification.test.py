import unittest,importlib.util,json,base64,stat,io,subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from contextlib import ExitStack,redirect_stdout
spec=importlib.util.spec_from_file_location('admin',Path(__file__).with_name('admin.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def record(ok=True):return {'event':'club_key_load_v1','source':'env' if ok else 'none',**{k:(ok if k in ['env_present','env_nonempty'] else False) for k in m.BOOL_FIELDS},**{k:None for k in m.ERROR_FIELDS}}
class Tests(unittest.TestCase):
 def test_valid_record_passes(self):
  with patch.object(m,'docker',return_value=json.dumps(record()).encode()):self.assertEqual(m.verify_key_records('fixture','boundary'),[record()])
 def test_delayed_log_passes_without_restart(self):
  with patch.object(m,'docker',side_effect=[b'']*5+[json.dumps(record()).encode()]) as docker,patch.object(m.time,'sleep'):
   self.assertEqual(m.verify_key_records('fixture','boundary'),[record()]);self.assertEqual(docker.call_count,6)
 def test_missing_log_is_inconclusive_not_negative(self):
  with patch.object(m,'docker',return_value=b'') as docker,patch.object(m.time,'sleep') as sleep:
   with self.assertRaises(m.VerificationPending):m.verify_key_records('fixture','boundary')
   self.assertEqual(docker.call_count,10);self.assertEqual(sleep.call_count,9)
 def test_log_read_error_is_inconclusive(self):
  for error in [m.Stop('docker_failure'),subprocess.TimeoutExpired('synthetic',30)]:
   with patch.object(m,'docker',side_effect=error),patch.object(m.time,'sleep'):
    with self.assertRaises(m.VerificationPending):m.verify_key_records('fixture','boundary')
 def test_explicit_negative_retains_failure(self):
  with patch.object(m,'docker',return_value=json.dumps(record(False)).encode()):
   try:m.verify_key_records('fixture','boundary');self.fail('must fail')
   except m.VerificationPending:self.fail('explicit failure must not be inconclusive')
   except m.Stop as e:self.assertEqual(str(e),'key_forwarding_not_confirmed')
 def test_mixed_records_rejected(self):
  with patch.object(m,'docker',return_value=(json.dumps(record())+'\n'+json.dumps(record(False))).encode()):
   with self.assertRaises(m.Stop):m.verify_key_records('fixture','boundary')
 def test_unknown_schema_never_becomes_success(self):
  with patch.object(m,'docker',return_value=b'{"event":"club_key_load_v1","key":"synthetic-private"}'),patch.object(m.time,'sleep'):
   with self.assertRaises(m.VerificationPending):m.verify_key_records('fixture','boundary')
 def test_inspect_failure_after_good_401_is_inconclusive(self):
  with patch.object(m,'smoke') as smoke,patch.object(m,'docker',side_effect=m.Stop('inspect_failed')):
   with self.assertRaises(m.VerificationPending):m.confirm_key_forwarding('fixture')
   smoke.assert_called_once()
 def test_bad_401_probe_remains_failure(self):
  with patch.object(m,'smoke',side_effect=m.Stop('anonymous_smoke_failed')),patch.object(m,'docker') as docker:
   with self.assertRaises(m.Stop):m.confirm_key_forwarding('fixture')
   docker.assert_not_called()
 def install_flow(self,outcome):
  source=b'before';after=b'after';helper=b'helper';checkout=b'checkout';current=[source]
  def read(p):
   if p.name=='main.before.ts':return source
   if str(p).endswith('/main/index.ts'):return current[0]
   if p.name=='club-key-env.mjs':return helper
   return checkout
  info=SimpleNamespace(st_uid=0,st_gid=0,st_mode=stat.S_IFREG|0o400,st_dev=1,st_ino=1,st_size=20,st_mtime_ns=1)
  with ExitStack() as stack:
   stack.enter_context(patch.multiple(m,MODE='install',MAIN_SHA=m.sha(source),CHECKOUT_SHA=m.sha(checkout),HELPER_SHA=m.sha(helper),HELPER_B64=base64.b64encode(helper).decode(),create=True))
   for target,name,value in [(m.os,'geteuid',lambda:0),(m.os,'umask',lambda _:None),(m.os.path,'lexists',lambda _:False),(m,'discover',lambda **kw:('container',Path('/fixture'))),(m,'read',read),(m,'patch_main',lambda _:after),(m,'secure_dir',lambda *a:None),(m,'save',lambda *a:None),(m,'unchanged',lambda *a:None),(m.os,'chmod',lambda *a:None),(m,'replace',lambda *a:current.__setitem__(0,after)),(m,'docker',lambda *a,**kw:b'')]:stack.enter_context(patch.object(target,name,value))
   stack.enter_context(patch.object(Path,'stat',return_value=info));stack.enter_context(patch.object(Path,'lstat',return_value=info))
   verification=stack.enter_context(patch.object(m,'confirm_key_forwarding'))
   if isinstance(outcome,Exception):verification.side_effect=outcome
   else:verification.return_value=outcome
   rollback=stack.enter_context(patch.object(m,'rollback'));stream=io.StringIO()
   with redirect_stdout(stream):
    if isinstance(outcome,Exception):
     with self.assertRaises(type(outcome)):m.run()
    else:m.run()
   return stream.getvalue(),rollback.call_count
 def test_missing_log_does_not_trigger_actual_install_rollback(self):
  output,rollbacks=self.install_flow(m.VerificationPending('missing'))
  self.assertEqual(rollbacks,0);self.assertIn('VERIFICATION_INCONCLUSIVE=True',output);self.assertNotIn('KEY_FORWARDING_INSTALLED=True',output)
 def test_explicit_negative_triggers_existing_rollback(self):
  output,rollbacks=self.install_flow(m.Stop('key_forwarding_not_confirmed'));self.assertEqual(rollbacks,1);self.assertNotIn('KEY_FORWARDING_INSTALLED=True',output)
 def test_success_report_requires_positive_record(self):
  output,rollbacks=self.install_flow([record()]);self.assertEqual(rollbacks,0);self.assertIn('KEY_FORWARDING_INSTALLED=True',output)
unittest.main()
