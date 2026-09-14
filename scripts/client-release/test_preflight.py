import json
import tempfile
import unittest
from pathlib import Path

from preflight import compare_contract
from remote_apply import EXPECTED_NGINX_TEMPLATES, _snapshot_records, sha256_file


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        client = self.root / 'packages/client'
        records = []
        for name in EXPECTED_NGINX_TEMPLATES:
            file = client / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b'contract\r\n')
            records.append(dict(path=name, bytes=file.stat().st_size, sha256=sha256_file(file)))
        self.pack = client / 'public/assets/runtime-image-packs/default'
        self.pack.mkdir(parents=True)
        (self.pack / 'manifest.json').write_text(json.dumps({'version': 12}))
        (self.pack / 'art.webp').write_bytes(b'art')
        self.live = dict(receipt={'commit': 'a' * 40, 'nginx': {'files': records}},
                         currentArtifact='client-current', runtimeVersion='12', snapshot=None)

    def test_unused_version_is_ready(self):
        self.assertTrue(compare_contract(self.root, self.live)['ready'])

    def test_identical_snapshot_is_ready(self):
        self.live['snapshot'] = _snapshot_records(self.pack, ('',))
        self.assertEqual(compare_contract(self.root, self.live)['runtimeSnapshot'], 'identical')

    def test_line_endings_block_before_build(self):
        file = self.root / 'packages/client/nginx/default.conf.template'
        file.write_bytes(b'contract\n')
        self.assertIn('nginx-byte-mismatch:nginx/default.conf.template', compare_contract(self.root, self.live)['failures'])

    def test_same_version_changed_art_is_blocked(self):
        self.live['snapshot'] = _snapshot_records(self.pack, ('',))
        (self.pack / 'art.webp').write_bytes(b'new art')
        self.assertFalse(compare_contract(self.root, self.live)['ready'])

    def test_removed_snapshot_file_is_blocked(self):
        self.live['snapshot'] = _snapshot_records(self.pack, ('',))
        (self.pack / 'art.webp').unlink()
        self.assertFalse(compare_contract(self.root, self.live)['ready'])

    def test_version_drift_is_rejected(self):
        self.live['runtimeVersion'] = '11'
        with self.assertRaisesRegex(RuntimeError, 'version changed'):
            compare_contract(self.root, self.live)


if __name__ == '__main__':
    unittest.main()
