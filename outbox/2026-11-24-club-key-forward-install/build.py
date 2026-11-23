from pathlib import Path
import ast,base64,hashlib,subprocess,os,json
r=Path(__file__).resolve().parent
parser=(r/'vendor/babel-parser.cjs').read_bytes();patcher=(r/'patcher.cjs').read_bytes();helper=(r/'club-key-env.mjs').read_bytes();bootstrap=(r/'bootstrap.cjs').read_text();admin=(r/'admin.py').read_text();ast.parse(admin)
const={'MAIN_SHA':'c0ea2ba6c68ae162f27516b384eaa722665e8b64df839f5a3e4901df55e47d1a','CHECKOUT_SHA':'a1aa4e054a18418568959113d83edd6395a8e3c2480b73222056a93779c2dac5','PARSER_B64':base64.b64encode(parser).decode(),'PATCHER_B64':base64.b64encode(patcher).decode(),'HELPER_B64':base64.b64encode(helper).decode(),'PARSER_SHA':hashlib.sha256(parser).hexdigest(),'PATCHER_SHA':hashlib.sha256(patcher).hexdigest(),'HELPER_SHA':hashlib.sha256(helper).hexdigest(),'BOOTSTRAP':bootstrap}
rows=[]
for mode in ['install','rollback']:
 p=r/f'meetguru-club-key-forward-{mode}-20261124.sh';assert not p.exists()
 code='\n'.join(k+'='+repr(v) for k,v in {**const,'MODE':mode}.items())+'\n'+admin;ast.parse(code)
 p.write_text("#!/bin/bash\nset -euo pipefail\numask 077\n[ \"${MG_CONFIRM:-}\" = yes ] || { echo 'STOP: use approved mg-deploy'; exit 1; }\ncd /\nexec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 /usr/bin/python3 -I -S - <<'MG_CLUB_KEY_FORWARD'\n"+code+'\nMG_CLUB_KEY_FORWARD\n');p.chmod(0o700)
 subprocess.run(['bash','-n',str(p)],check=True)
 x=subprocess.run(['bash',str(p)],env={**os.environ,'MG_CONFIRM':'yes'},capture_output=True,text=True);assert x.returncode==1 and 'approved_root_execution_required' in x.stdout
 rows.append(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name)
# Verify exact bundled bootstrap without Docker or production.
b=bootstrap.replace('__PARSER_SHA__',const['PARSER_SHA']).replace('__PATCHER_SHA__',const['PATCHER_SHA'])
fixture='await EdgeRuntime.userWorkers.create({ servicePath, memoryLimitMb, workerTimeoutMs, noModuleCache, importMapPath, envVars });'
x=subprocess.run(['node','--max-old-space-size=96','-e',b],input=json.dumps({'parser':parser.decode(),'patcher':patcher.decode(),'source':fixture}).encode(),capture_output=True,timeout=15)
assert x.returncode==0 and json.loads(x.stdout)['syntax_valid'] is True
(r/'SHA256SUMS').write_text('\n'.join(rows)+'\n');print('\n'.join(rows));print('bash/Python syntax, non-root refusal, bundled bootstrap PASS')
