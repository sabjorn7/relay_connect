import unittest,importlib.util,json,tempfile,os,stat
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('admin',Path(__file__).with_name('admin.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def report(self):return {'event':'club_key_load_v1','source':'none',**{k:False for k in m.BOOL_FIELDS},**{k:None for k in m.ERROR_FIELDS}}
 def test_valid_record(self):
  v=self.report();self.assertEqual(m.diagnostic_records(('timestamp '+json.dumps(v)+'\n').encode()),[v])
 def test_raw_secrets_not_emitted(self):
  self.assertEqual(m.diagnostic_records(b'private-key=synthetic-secret\nTraceback arbitrary'),[])
 def test_extra_field_rejected(self):
  v={**self.report(),'secret':'synthetic-secret'};self.assertEqual(m.diagnostic_records(json.dumps(v).encode()),[])
 def test_arbitrary_error_rejected(self):
  v={**self.report(),'file_error':'synthetic-secret'};self.assertEqual(m.diagnostic_records(json.dumps(v).encode()),[])
 def test_non_boolean_rejected(self):
  v={**self.report(),'env_nonempty':'synthetic-secret'};self.assertEqual(m.diagnostic_records(json.dumps(v).encode()),[])
 def test_unknown_source_rejected(self):
  v={**self.report(),'source':'synthetic-secret'};self.assertEqual(m.diagnostic_records(json.dumps(v).encode()),[])
 def test_malformed_json_rejected(self):self.assertEqual(m.diagnostic_records(b'{"event":"club_key_load_v1",bad'),[])
 def test_non_root_refusal(self):
  with patch.object(m.os,'geteuid',return_value=1002),patch.object(m,'discover') as discover:
   with self.assertRaises(m.Stop):m.run()
   discover.assert_not_called()
 def test_unexpected_baseline_no_write(self):
  with patch.object(m.os,'geteuid',return_value=0),patch.object(m,'discover',return_value=('fixture',Path('/fixture'))),patch.object(m,'read',return_value=b'other'),patch.object(m,'replace') as replace,patch.object(m,'docker') as docker,patch.object(m,'MODE','install',create=True),patch.object(m,'BASELINE',m.sha(b'before'),create=True),patch.object(m,'DIAGNOSTIC_SHA',m.sha(b'after'),create=True):
   with self.assertRaises(m.Stop):m.run()
   replace.assert_not_called();docker.assert_not_called()
 def test_rollback_unknown_source_no_write(self):
  before=b'before';meta={'target':'/fixture'}
  def read(p):return before if p.name=='index.before.ts' else b'unknown'
  with patch.object(m,'read',side_effect=read),patch.object(m,'replace') as replace,patch.object(m,'docker') as docker,patch.object(m,'BASELINE',m.sha(before),create=True),patch.object(m,'DIAGNOSTIC_SHA',m.sha(b'after'),create=True):
   with self.assertRaises(m.Stop):m.restore('fixture',Path('/fixture'),meta)
   replace.assert_not_called();docker.assert_not_called()
 def test_symlink_refused(self):
  with tempfile.TemporaryDirectory() as d,patch.object(m,'secure_dir'):
   p=Path(d);(p/'target').write_text('synthetic');(p/'link').symlink_to(p/'target')
   with self.assertRaises(OSError):m.read(p/'link')
 def test_atomic_replace_local(self):
  with tempfile.TemporaryDirectory() as d,patch.object(m,'secure_dir'):
   p=Path(d)/'index.ts';p.write_bytes(b'before');m.replace(p,b'after',{'uid':os.getuid(),'gid':os.getgid(),'mode':0o600})
   self.assertEqual(p.read_bytes(),b'after');self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o600);self.assertEqual(len(list(p.parent.iterdir())),1)
unittest.main()
