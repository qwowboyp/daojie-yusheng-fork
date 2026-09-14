#!/usr/bin/env python3
"""Read-only checkout/live byte-contract check before expensive client prepare."""
from __future__ import annotations

import argparse
import json
import shlex
import subprocess
from pathlib import Path

from remote_apply import EXPECTED_NGINX_TEMPLATES, ReleaseError, _runtime_version, _snapshot_records, sha256_file
from remote_publish import Remote, SAFE_REMOTE_ROOT, load_env, redact


def compare_contract(checkout: Path, live: dict) -> dict:
    client = checkout / 'packages/client'
    records = {record['path']: record for record in live['receipt']['nginx']['files']}
    failures = []
    for name in sorted(EXPECTED_NGINX_TEMPLATES):
        file = client / name
        record = records.get(name)
        if not file.is_file() or file.is_symlink() or not record or (
            file.stat().st_size != record['bytes'] or sha256_file(file) != record['sha256']
        ):
            failures.append('nginx-byte-mismatch:' + name)
    version = _runtime_version(client / 'public')
    wanted = _snapshot_records(client / 'public/assets/runtime-image-packs/default', ('',))
    actual = live['snapshot']
    if live['runtimeVersion'] != version:
        raise ReleaseError('runtime version changed during preflight')
    collision = actual is not None and {key: tuple(value) for key, value in actual.items()} != wanted
    if collision:
        failures.append('immutable-runtime-pack-collision:' + version)
    return {
        'kind': 'daojie-client-preflight', 'mutated': False, 'ready': not failures,
        'currentArtifact': live['currentArtifact'], 'liveCommit': live['receipt']['commit'],
        'runtimeVersion': version, 'runtimeFilesChecked': len(wanted),
        'runtimeSnapshot': 'absent' if actual is None else ('collision' if collision else 'identical'),
        'failures': failures,
    }


def read_live(remote: Remote, site_root: str, version: str) -> dict:
    if not SAFE_REMOTE_ROOT.fullmatch(site_root) or '..' in Path(site_root).parts or site_root == '/':
        raise ReleaseError('unsafe site root')
    # One SSH read; no staging, uploads, container changes, or snapshot writes.
    script = '''import hashlib,json
from pathlib import Path
root=Path(SITE_ROOT)
site=(root/'current').resolve(strict=True)
stored=json.loads((site.parent/'receipt.json').read_text())
receipt=dict(commit=stored['commit'],nginx=stored['nginx'])
snapshot=root/'snapshots/runtime-pack'/VERSION/'default'
records=None
if snapshot.exists():
 records={}
 for file in sorted(snapshot.rglob('*')):
  if file.is_symlink(): raise RuntimeError('snapshot contains symlink')
  if file.is_file(): records[file.relative_to(snapshot).as_posix()]=[file.stat().st_size,hashlib.sha256(file.read_bytes()).hexdigest()]
print(json.dumps(dict(receipt=receipt,currentArtifact=site.parent.name,runtimeVersion=VERSION,snapshot=records)))
'''.replace('SITE_ROOT', repr(site_root)).replace('VERSION', repr(version))
    # Parse structured data before redaction: replacing a short numeric SSH secret
    # inside JSON numbers would corrupt otherwise valid byte counts.
    _, stdout, stderr = remote.client.exec_command('python3 -c ' + shlex.quote(script), timeout=90)
    output, error = stdout.read(), stderr.read()
    if stdout.channel.recv_exit_status() != 0:
        raise ReleaseError(redact(error.decode('utf-8', 'replace')[-2000:], remote.secrets))
    return json.loads(output)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', required=True, type=Path)
    parser.add_argument('--env-file', required=True, type=Path)
    parser.add_argument('--known-hosts', required=True, type=Path)
    parser.add_argument('--site-root', default='/opt/daojie/client-site')
    args = parser.parse_args()
    checkout = args.checkout.resolve(strict=True)
    status = subprocess.check_output(['git', '-C', str(checkout), 'status', '--porcelain'], text=True)
    if status.strip():
        raise ReleaseError('candidate checkout must be clean')
    commit = subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', 'HEAD'], text=True).strip()
    version = _runtime_version(checkout / 'packages/client/public')
    remote = Remote(load_env(args.env_file), args.known_hosts)
    try:
        result = compare_contract(checkout, read_live(remote, args.site_root, version))
    finally:
        remote.close()
    result['candidateCommit'] = commit
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['ready'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ReleaseError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(json.dumps({'ready': False, 'mutated': False, 'error': str(error)}))
        raise SystemExit(1)
