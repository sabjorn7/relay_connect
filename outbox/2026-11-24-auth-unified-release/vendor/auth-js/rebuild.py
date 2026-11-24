#!/usr/bin/env python3
"""Rebuild the pinned SDK in fresh scratch space; never edits node_modules."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

BASE = Path(__file__).resolve().parent
manifest = json.loads((BASE / 'manifest.json').read_text())
if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 vendor/auth-js/rebuild.py NEW_OUTPUT_TGZ')
output = Path(sys.argv[1]).resolve()
if output.exists():
    raise SystemExit('Output already exists; refusing to replace it')
if subprocess.check_output(['node', '--version'], text=True).strip() != manifest['node']:
    raise SystemExit('Use the pinned Node version from manifest.json')

def verify(path, expected):
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise SystemExit('SHA-256 mismatch: ' + str(path))

archive = BASE / 'upstream/auth-js-2.119.2.tgz'
patch = BASE / 'meetguru.patch'
verify(archive, manifest['upstream_tar_sha256'])
verify(patch, manifest['patch_sha256'])
for relative, digest in manifest['build_inputs_sha256'].items():
    verify(BASE / relative, digest)

with tempfile.TemporaryDirectory(prefix='mg-auth-vendor-') as temp:
    scratch = Path(temp).resolve()
    sdk = scratch / 'sdk'
    sdk.mkdir()
    with tarfile.open(archive, 'r:gz') as tar:
        for member in tar.getmembers():
            parts = Path(member.name).parts
            if not parts or parts[0] != 'package' or '..' in parts or Path(member.name).is_absolute():
                raise SystemExit('Unsafe archive path')
            target = sdk.joinpath(*parts[1:])
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as dest:
                    dest.write(tar.extractfile(member).read())
            else:
                raise SystemExit('Links and special files are not allowed')
    source = sdk / 'src/GoTrueClient.ts'
    verify(source, manifest['source_before_sha256'])
    subprocess.run(['git', 'apply', '--check', str(patch)], cwd=sdk, check=True)
    subprocess.run(['git', 'apply', str(patch)], cwd=sdk, check=True)
    verify(source, manifest['source_after_sha256'])
    # The upstream dist is generated output in this new extraction only.
    shutil.rmtree(sdk / 'dist')
    shutil.copy2(BASE / 'config/tsconfig.base.json', scratch / 'tsconfig.base.json')
    for name in ['tsconfig.json', 'tsconfig.module.json']:
        shutil.copy2(BASE / 'config' / name, sdk / name)
    toolchain = scratch / 'toolchain'
    toolchain.mkdir()
    for name in ['package.json', 'package-lock.json']:
        shutil.copy2(BASE / 'toolchain' / name, toolchain / name)
    env = dict(os.environ, npm_config_cache=str(scratch / 'npm-cache'))
    subprocess.run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=toolchain, env=env, check=True)
    (sdk / 'node_modules').symlink_to(toolchain / 'node_modules', target_is_directory=True)
    package = json.loads((sdk / 'package.json').read_text())
    package['version'] = manifest['version']
    (sdk / 'package.json').write_text(json.dumps(package, indent=2) + '\n')
    subprocess.run(['npm', 'run', 'build'], cwd=sdk, env=env, check=True)
    packed = json.loads(subprocess.check_output(['npm', 'pack', '--ignore-scripts', '--json'], cwd=sdk, env=env, text=True))[0]
    data = (sdk / packed['filename']).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if manifest.get('tar_sha256') and digest != manifest['tar_sha256']:
        raise SystemExit('Rebuilt tarball does not match manifest')
    with output.open('xb') as dest:
        dest.write(data)
    print(json.dumps({'output': str(output), 'sha256': digest, 'integrity': packed['integrity']}))
