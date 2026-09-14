"""服務端發布守門契約；所有測試都使用隔離資料或 mock，不操作 Docker/SSH。"""
import contextlib
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("server_release", ROOT / "scripts/coordinated-server-release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ServerReleaseContracts(unittest.TestCase):
    def setUp(self):
        parent = ROOT / ".runtime/reports/server-release-contracts"
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "source.tar"
        self.archive.write_bytes(b"fixture canonical source")
        self.report = self.root / "full-verification.json"
        self.commit = "a" * 40
        self.evidence = {
            "schemaVersion": 1, "kind": "daojie-full-release-verification",
            "commit": self.commit, "command": "pnpm verify:release:full", "exitCode": 0,
            "startedAt": "2026-09-14T00:00:00.000Z", "completedAt": "2026-09-14T01:00:00.000Z",
            "sourceArchive": {"path": "source.tar", "bytes": self.archive.stat().st_size,
                              "sha256": release.sha256_file(self.archive)},
            "gates": [{"label": label, "exitCode": 0} for label in release.FULL_GATES],
        }

    def validate(self):
        self.report.write_text(json.dumps(self.evidence), encoding="utf-8")
        return release.validate_full_evidence(self.report, self.archive, self.commit)

    def test_complete_evidence_and_matching_archive_pass(self):
        self.assertEqual(self.validate()["archiveSha256"], release.sha256_file(self.archive))

    def test_failed_or_missing_gate_cannot_publish(self):
        for gates in [self.evidence["gates"][:-1], [{"label": label, "exitCode": 1} for label in release.FULL_GATES]]:
            with self.subTest(gates=gates):
                self.evidence["gates"] = gates
                with self.assertRaises(release.ReleaseError):
                    self.validate()

    def test_mismatched_commit_and_command_rejected(self):
        for field, value in [("commit", "b" * 40), ("command", "pnpm verify:quick"), ("exitCode", 1)]:
            with self.subTest(field=field):
                original = self.evidence[field]
                self.evidence[field] = value
                with self.assertRaises(release.ReleaseError):
                    self.validate()
                self.evidence[field] = original

    def test_modified_archive_rejected(self):
        self.archive.write_bytes(b"changed source")
        with self.assertRaises(release.ReleaseError):
            self.validate()

    def test_reversed_times_rejected(self):
        self.evidence["completedAt"] = "2026-09-13T00:00:00.000Z"
        with self.assertRaises(release.ReleaseError):
            self.validate()

    def test_archive_traversal_and_links_rejected(self):
        for index, (name, kind) in enumerate([("../escape", tarfile.REGTYPE), ("/escape", tarfile.REGTYPE),
                                             ("link", tarfile.SYMTYPE), ("hard", tarfile.LNKTYPE)]):
            with self.subTest(name=name):
                with tarfile.open(self.archive, "w") as archive:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = "../escape" if kind != tarfile.REGTYPE else ""
                    archive.addfile(member)
                with self.assertRaises(release.ReleaseError):
                    release.safe_extract_tar(self.archive, self.root / f"extract-{index}")
        self.assertFalse((self.root.parent / "escape").exists())

    def test_server_cas_mismatch_stops_before_protected_lookup(self):
        with patch.object(release, "docker_inspect", return_value={"Id": "actual"}), patch.object(release, "container_ids") as ids:
            with self.assertRaisesRegex(release.ReleaseError, "CAS mismatch"):
                release.verify_expected_ids("other", {})
            ids.assert_not_called()

    def test_protected_container_drift_rejected(self):
        with patch.object(release, "docker_inspect", return_value={"Id": "actual"}), patch.object(release, "container_ids", return_value={"daojie-postgres": "changed"}):
            with self.assertRaisesRegex(release.ReleaseError, "identity mismatch"):
                release.verify_expected_ids("actual", {"daojie-postgres": "original"})

    def test_publish_without_execute_is_read_only_plan(self):
        args = release.parse_args(["--mode", "publish", "--env-file", str(self.root / "env"), "--known-hosts", str(self.root / "hosts")])
        with patch.object(release, "load_env", return_value={}), patch.object(release, "Remote") as remote, contextlib.redirect_stdout(io.StringIO()):
            remote.return_value.run.return_value = '{"contractReady":true,"mutated":false}'
            self.assertEqual(release.orchestrate(args), 0)
            remote.return_value.put.assert_not_called()
            self.assertIn("--mode plan", remote.return_value.run.call_args.args[0])

    def test_exact_protected_ids_required(self):
        args = release.parse_args([])
        with self.assertRaises(release.ReleaseError):
            release.expected_protected_from_args(args)


if __name__ == "__main__":
    unittest.main()
