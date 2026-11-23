import importlib.util,unittest,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('reader',Path(__file__).with_name('read-main.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
fixture='''const servicePath = `/home/deno/functions/${functionName}`;
const envVars = Object.entries(Deno.env.toObject());
const worker = await EdgeRuntime.userWorkers.create({servicePath,memoryLimitMb,workerTimeoutMs,noModuleCache,importMapPath,envVars,});'''
class Tests(unittest.TestCase):
 def test_known_fragments(self):self.assertTrue(m.inspect_source(fixture.encode())['restricted_fragments_complete'])
 def test_literals_comments_never_exported(self):
  v=m.inspect_source(("// synthetic-private-secret\nconst token='synthetic-private-secret';\n"+fixture).encode());self.assertNotIn('synthetic-private-secret',json.dumps(v))
 def test_inline_secret_in_call_not_exported(self):
  v=m.inspect_source(fixture.replace('envVars,','envVars: [["key","synthetic-private-secret"]],').encode());self.assertFalse(v['restricted_fragments_complete']);self.assertNotIn('synthetic-private-secret',json.dumps(v))
 def test_unknown_service_path_not_exported(self):
  v=m.inspect_source(fixture.replace('/home/deno/functions/','/secret-value/').encode());self.assertFalse(v['restricted_fragments_complete']);self.assertNotIn('/secret-value/',json.dumps(v))
 def test_multiple_calls_flagged(self):self.assertFalse(m.inspect_source((fixture+fixture).encode())['restricted_fragments_complete'])
 def test_dynamic_environment_flagged(self):
  self.assertFalse(m.inspect_source(fixture.replace('Deno.env.toObject()','getUnknownEnvironment()').encode())['restricted_fragments_complete'])
unittest.main()
