import importlib.util,unittest,tempfile,os,stat,json
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('admin',Path(__file__).with_name('admin.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.MAIN_SHA=m.sha(b'before');m.HELPER_SHA=m.sha(b'helper')
class Tests(unittest.TestCase):
 def context(self,main=b'after',backup=b'before',helper=b'helper'):
  def read(p):return backup if p.name=='main.before.ts' else helper if p.name=='club-key-env.mjs' else main
  return read
 def meta(self):return {'root':'/fixture','after_sha':m.sha(b'after'),'main_meta':{'mode':0o644,'uid':0,'gid':0}}
 def test_non_root_refused(self):
  with patch.object(m.os,'geteuid',return_value=1002),patch.object(m,'discover') as discover:
   with self.assertRaises(m.Stop):m.run()
   discover.assert_not_called()
 def test_baseline_drift_prevents_parser(self):
  with patch.object(m.subprocess,'run') as run:
   with self.assertRaises(m.Stop):m.patch_main(b'different')
   run.assert_not_called()
 def test_corrupt_backup_prevents_writes(self):
  with patch.object(m,'read',side_effect=self.context(backup=b'corrupt')),patch.object(m,'replace') as write:
   with self.assertRaises(m.Stop):m.rollback('container',Path('/fixture'),self.meta())
   write.assert_not_called()
 def test_unknown_main_prevents_writes(self):
  with patch.object(m,'read',side_effect=self.context(main=b'other')),patch.object(m,'replace') as write:
   with self.assertRaises(m.Stop):m.rollback('container',Path('/fixture'),self.meta())
   write.assert_not_called()
 def test_unknown_helper_prevents_writes(self):
  with patch.object(m,'read',side_effect=self.context(helper=b'other')),patch.object(m.os.path,'lexists',return_value=True),patch.object(m,'replace') as write:
   with self.assertRaises(m.Stop):m.rollback('container',Path('/fixture'),self.meta())
   write.assert_not_called()
 def test_restore_then_restart_then_smoke_then_remove_helper(self):
  order=[]
  with patch.object(m,'read',side_effect=self.context()),patch.object(m.os.path,'lexists',return_value=True),patch.object(m,'unchanged'),patch.object(m,'replace',side_effect=lambda *a:order.append('restore')),patch.object(m,'docker',side_effect=lambda *a,**k:order.append('restart')),patch.object(m,'smoke',side_effect=lambda:order.append('smoke')),patch.object(Path,'unlink',side_effect=lambda:order.append('remove')),patch('builtins.print'):
   m.rollback('container',Path('/fixture'),self.meta())
   self.assertEqual(order,['restore','restart','smoke','remove'])
 def test_smoke_failure_keeps_helper_for_manual_recovery(self):
  with patch.object(m,'read',side_effect=self.context()),patch.object(m.os.path,'lexists',return_value=True),patch.object(m,'unchanged'),patch.object(m,'replace'),patch.object(m,'docker'),patch.object(m,'smoke',side_effect=m.Stop('failed')),patch.object(Path,'unlink') as remove:
   with self.assertRaises(m.Stop):m.rollback('container',Path('/fixture'),self.meta())
   remove.assert_not_called()
 def test_symlink_refused(self):
  with tempfile.TemporaryDirectory() as d,patch.object(m,'secure_dir'):
   p=Path(d);(p/'target').write_text('synthetic');(p/'link').symlink_to(p/'target')
   with self.assertRaises(OSError):m.read(p/'link')
 def test_atomic_replace_preserves_mode(self):
  with tempfile.TemporaryDirectory() as d,patch.object(m,'secure_dir'):
   p=Path(d)/'main.ts';p.write_bytes(b'before');m.replace(p,b'after',{'uid':os.getuid(),'gid':os.getgid(),'mode':0o600})
   self.assertEqual(p.read_bytes(),b'after');self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o600)
 def test_log_filter_rejects_secret_fields(self):
  v={'event':'club_key_load_v1','source':'env',**{k:True for k in m.BOOL_FIELDS},**{k:None for k in m.ERROR_FIELDS}}
  self.assertEqual(m.diagnostic_records(json.dumps(v).encode()),[v]);v['key']='synthetic-secret';self.assertEqual(m.diagnostic_records(json.dumps(v).encode()),[])
 def test_log_filter_rejects_unknown_error(self):
  v={'event':'club_key_load_v1','source':'env',**{k:True for k in m.BOOL_FIELDS},**{k:'synthetic-secret' for k in m.ERROR_FIELDS}}
  self.assertEqual(m.diagnostic_records(json.dumps(v).encode()),[])
unittest.main()
