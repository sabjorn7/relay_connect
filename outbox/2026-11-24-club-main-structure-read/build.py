from pathlib import Path
import ast,base64,hashlib,subprocess,os,json
r=Path(__file__).resolve().parent
parser=(r/'vendor/babel-parser.cjs').read_bytes();inspector=(r/'inspect-body.js').read_bytes();bootstrap=(r/'bootstrap.cjs').read_text()
constants={'EXPECTED_MAIN':'c0ea2ba6c68ae162f27516b384eaa722665e8b64df839f5a3e4901df55e47d1a','PARSER_B64':base64.b64encode(parser).decode(),'INSPECTOR_B64':base64.b64encode(inspector).decode(),'PARSER_SHA':hashlib.sha256(parser).hexdigest(),'INSPECTOR_SHA':hashlib.sha256(inspector).hexdigest(),'BOOTSTRAP':bootstrap}
code='\n'.join(k+'='+repr(v) for k,v in constants.items())+'\n'+(r/'read-structure.py').read_text();ast.parse(code)
p=r/'meetguru-club-main-structure-read-20261124.sh';assert not p.exists()
p.write_text("#!/bin/bash\nset -euo pipefail\n[ \"${MG_CONFIRM:-}\" = yes ] || { echo 'STOP: use approved mg-deploy'; exit 1; }\ncd /\nexec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 /usr/bin/python3 -I -S - <<'MG_STRUCTURAL_READ'\n"+code+'\nMG_STRUCTURAL_READ\n');p.chmod(0o700)
subprocess.run(['bash','-n',str(p)],check=True)
x=subprocess.run(['bash',str(p)],env={**os.environ,'MG_CONFIRM':'yes'},capture_output=True,text=True);assert x.returncode==1 and 'approved_root_execution_required' in x.stdout
# Exercise exactly the approved bootstrap with local Node and synthetic source.
b=bootstrap.replace('__PARSER_SHA__',constants['PARSER_SHA']).replace('__INSPECTOR_SHA__',constants['INSPECTOR_SHA'])
fixture='const servicePath=`/home/deno/functions/${functionName}`;const envVars=Object.entries(Deno.env.toObject());await EdgeRuntime.userWorkers.create({servicePath,envVars});'
x=subprocess.run(['node','--max-old-space-size=96','-e',b],input=json.dumps({'parser':parser.decode(),'inspector':inspector.decode(),'source':fixture}).encode(),capture_output=True,timeout=15)
assert x.returncode==0;assert json.loads(x.stdout)['create_call_count']==1
h=hashlib.sha256(p.read_bytes()).hexdigest();(r/'SHA256SUMS').write_text(h+'  '+p.name+'\n');print(h);print('bash -n, embedded Python, non-root refusal, bundled parser bootstrap PASS')
