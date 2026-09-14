#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import stat
from types import SimpleNamespace
import tempfile
import unittest
from pathlib import Path

from remote_apply import (
    ReleaseError,
    RemoteReleaseManager,
    build_adopted_receipt,
    sha256_file,
    transform_nginx_templates,
    validate_client_container_contract,
    validate_coordinated_server_image,
    validate_bootstrap_identity,
    run_checked,
    validate_receipt,
)
from remote_publish import Remote, diff_receipts, parse_args, validate_bundle


HERE = Path(__file__).resolve().parent
CLIENT_ROOT = HERE.parents[1] / "packages" / "client"
COMMIT_A = "a" * 40
COMMIT_B = "b" * 40
COMMIT_C = "c" * 40


def record(path: Path, archive_path: str) -> dict:
    return {"path": archive_path, "bytes": path.stat().st_size, "sha256": sha256_file(path)}


def write_site(root: Path, build_id: str, runtime_version: str, *, label: str, old_chunk: bool = False) -> None:
    (root / "assets/runtime-image-packs/default/tiles").mkdir(parents=True, exist_ok=True)
    (root / "assets/item-icons/v1").mkdir(parents=True, exist_ok=True)
    (root / "assets").mkdir(exist_ok=True)
    (root / "index.html").write_text(f"<main>{label}</main>", encoding="utf-8")
    (root / "robots.txt").write_text("User-agent: *\nDisallow:\n", encoding="utf-8")
    (root / "version.json").write_text(json.dumps({"buildId": build_id, "builtAt": "2026-09-12T00:00:00Z"}), encoding="utf-8")
    (root / "assets/runtime-image-packs/default/manifest.json").write_text(
        json.dumps({"version": runtime_version, "tiles": {"grass": {"src": "tiles/grass.webp"}}}), encoding="utf-8")
    (root / "assets/runtime-image-packs/default/tiles/grass.webp").write_bytes(f"grass-{label}".encode())
    (root / "assets/item-icons/v1/item-96.webp").write_bytes(f"item-{label}".encode())
    (root / f"assets/main-{build_id}.js").write_text(f"export default {label!r}", encoding="utf-8")
    if old_chunk:
        (root / "assets/lazy-OLDHASH99.js").write_text("old lazy chunk", encoding="utf-8")


def nginx_records() -> list[dict]:
    return sorted([
        record(CLIENT_ROOT / "nginx/nginx.conf.template", "nginx/nginx.conf.template"),
        record(CLIENT_ROOT / "nginx/default.conf.template", "nginx/default.conf.template"),
    ], key=lambda item: item["path"])


def make_receipt(site: Path, commit: str, base: str, artifact: str) -> dict:
    dist = []
    for path in sorted((item for item in site.rglob("*") if item.is_file()), key=lambda item: item.relative_to(site).as_posix()):
        dist.append(record(path, f"dist/{path.relative_to(site).as_posix()}"))
    nginx = nginx_records()
    version_source = (site / "version.json").read_bytes()
    version = json.loads(version_source)
    payload = {
        "schemaVersion": 1, "kind": "daojie-client-release", "commit": commit, "baseCommit": base,
        "artifactVersion": artifact, "classification": "client",
        "verification": {"command": "pnpm verify:client", "exitCode": 0, "completedAt": "now"},
        "verificationPassed": True, "verificationSkipped": False, "buildId": version["buildId"],
        "version": {**version, "manifestPath": "dist/version.json", "sha256": hashlib.sha256(version_source).hexdigest()},
        "dist": {"files": dist}, "nginx": {"files": nginx}, "nginxTemplates": nginx,
        "files": sorted(dist + nginx, key=lambda item: item["path"]),
        "delta": {"mode": "full", "changed": [item["path"] for item in dist], "removed": []},
    }
    return validate_receipt(payload)


def make_coordinated_full_receipt(receipt: dict) -> dict:
    payload = json.loads(json.dumps(receipt))
    payload["classification"] = "full"
    payload["coordinatedFull"] = {
        "serverCommit": payload["commit"],
        "publicationOrder": "server-before-client",
        "fullVerification": {
            "schemaVersion": 1,
            "kind": "daojie-full-release-verification",
            "commit": payload["commit"],
            "command": "pnpm verify:release:full",
            "exitCode": 0,
            "startedAt": "2026-09-13T00:00:00.000Z",
            "completedAt": "2026-09-13T00:10:00.000Z",
            "gates": [
                {"label": "with-db", "exitCode": 0},
                {"label": "gm-database-backup-persistence", "exitCode": 0},
                {"label": "shadow", "exitCode": 0},
                {"label": "gm", "exitCode": 0},
            ],
            "sourceArchive": {"bytes": 100, "sha256": "1" * 64},
            "report": {"bytes": 100, "sha256": "2" * 64},
        },
    }
    return validate_receipt(payload)


def make_payload(parent: Path, site: Path, receipt: dict, changed: list[str], *, nginx: bool = False) -> Path:
    payload = parent / "payload"
    payload.mkdir(parents=True)
    for archive_path in changed:
        relative = archive_path.removeprefix("dist/")
        target = payload / archive_path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(site / relative, target)
    if nginx:
        for item in receipt["nginxTemplates"]:
            target = payload / item["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(CLIENT_ROOT / "nginx" / item["path"].removeprefix("nginx/"), target)
    (parent / "receipt.json").write_text(json.dumps(receipt), encoding="utf-8")
    return payload


class RemoteReleaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = Path(tempfile.mkdtemp(prefix="daojie-remote-release-test-"))
        self.site_root = self.temp / "client-site"
        self.seed = self.temp / "seed"
        self.next_site = self.temp / "next"
        self.seed.mkdir()
        self.next_site.mkdir()
        write_site(self.seed, "OLDBUILD99", "11", label="old", old_chunk=True)
        write_site(self.next_site, "NEWBUILD99", "12", label="new")
        self.next_receipt = make_receipt(self.next_site, COMMIT_B, COMMIT_A, "client-bbbbbbbbbbbb-NEWBUILD99")
        self.manager = RemoteReleaseManager(self.site_root)
        self.adopted = self.manager.adopt_live(
            self.next_receipt, self.seed, COMMIT_A, "sha256:" + "d" * 64,
            {"nginx.conf.template": "1" * 64, "default.conf.template": "2" * 64},
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.temp, ignore_errors=True)

    def publish(self, receipt: dict | None = None, site: Path | None = None, postcheck=None):
        receipt = receipt or self.next_receipt
        site = site or self.next_site
        changed = self.manager.plan(receipt)["changed"]
        staging = self.temp / f"stage-{len(list(self.temp.glob('stage-*')))}"
        payload = make_payload(staging, site, receipt, changed)
        return self.manager.publish(receipt, payload, self.adopted["artifactVersion"], postcheck)

    def test_private_upload_permissions_become_public_only_at_release(self) -> None:
        root = self.temp / "private-upload-root"
        root.mkdir(mode=0o700)
        manager = RemoteReleaseManager(root)
        adopted = manager.adopt_live(self.next_receipt, self.seed, COMMIT_A, "sha256:" + "d" * 64, {})
        self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o755)
        changed = manager.plan(self.next_receipt)["changed"]
        payload = make_payload(self.temp / "private-upload", self.next_site, self.next_receipt, changed)
        for name in changed:
            (payload / name).chmod(0o600)
        previous = root / "current/index.html"
        old_mode = previous.stat().st_mode
        manager.publish(self.next_receipt, payload, adopted["artifactVersion"])
        self.assertEqual(stat.S_IMODE((root / "current/index.html").stat().st_mode), 0o644)
        self.assertEqual(stat.S_IMODE((payload / "dist/index.html").stat().st_mode), 0o600)
        self.assertEqual((root / "releases" / adopted["artifactVersion"] / "site/index.html").stat().st_mode, old_mode)

    def test_external_command_timeout_is_bounded(self) -> None:
        with self.assertRaisesRegex(ReleaseError, "timed out"):
            run_checked([sys.executable, "-c", "import time; time.sleep(10)"], timeout=0.05)

    def test_path_traversal_and_bad_hash_are_rejected(self) -> None:
        bad = json.loads(json.dumps(self.next_receipt))
        bad["dist"]["files"][0]["path"] = "dist/../escape"
        bad["files"] = sorted(bad["dist"]["files"] + bad["nginx"]["files"], key=lambda item: item["path"])
        with self.assertRaises(ReleaseError):
            validate_receipt(bad)
        changed = self.manager.plan(self.next_receipt)["changed"]
        staging = self.temp / "bad-sha"
        payload = make_payload(staging, self.next_site, self.next_receipt, changed)
        first = payload / changed[0]
        first.write_bytes(first.read_bytes() + b"tamper")
        with self.assertRaisesRegex(ReleaseError, "hash mismatch"):
            self.manager.publish(self.next_receipt, payload, self.adopted["artifactVersion"])
        self.assertEqual(self.manager.current_artifact(), self.adopted["artifactVersion"])

    def test_coordinated_full_requires_matching_running_server_image_revision(self) -> None:
        receipt = make_coordinated_full_receipt(self.next_receipt)
        container = {"State": {"Running": True}, "Image": "sha256:" + "d" * 64}
        matching_image = {
            "Id": container["Image"],
            "Config": {"Labels": {"org.opencontainers.image.revision": receipt["commit"]}},
        }
        self.assertEqual(validate_coordinated_server_image(receipt, container, matching_image), receipt["commit"])
        mismatched_image = json.loads(json.dumps(matching_image))
        mismatched_image["Config"]["Labels"]["org.opencontainers.image.revision"] = COMMIT_C
        with self.assertRaisesRegex(ReleaseError, "OCI revision"):
            validate_coordinated_server_image(receipt, container, mismatched_image)
        self.assertIsNone(validate_coordinated_server_image(self.next_receipt, {}, {}))
        assets_receipt = json.loads(json.dumps(self.next_receipt))
        assets_receipt["classification"] = "assets"
        self.assertEqual(validate_receipt(assets_receipt)["classification"], "assets")

    def test_publish_does_not_mutate_hardlinked_current_and_retains_old_chunk(self) -> None:
        old_index = self.site_root / "releases" / self.adopted["artifactVersion"] / "site/index.html"
        old_bytes = old_index.read_bytes()
        result = self.publish()
        new_root = self.site_root / "releases" / self.next_receipt["artifactVersion"] / "site"
        self.assertEqual(old_index.read_bytes(), old_bytes)
        self.assertNotEqual((new_root / "index.html").read_bytes(), old_bytes)
        self.assertTrue((new_root / "assets/lazy-OLDHASH99.js").is_file())
        self.assertIn("assets/lazy-OLDHASH99.js", result["retainedHashedAssets"])

    def test_current_cas_and_failed_postcheck_restore_current(self) -> None:
        changed = self.manager.plan(self.next_receipt)["changed"]
        staging = self.temp / "cas"
        payload = make_payload(staging, self.next_site, self.next_receipt, changed)
        with self.assertRaisesRegex(ReleaseError, "CAS"):
            self.manager.publish(self.next_receipt, payload, "wrong-current")
        with self.assertRaisesRegex(RuntimeError, "probe failed"):
            self.manager.publish(self.next_receipt, payload, self.adopted["artifactVersion"],
                                 lambda: (_ for _ in ()).throw(RuntimeError("probe failed")))
        self.assertEqual(self.manager.current_artifact(), self.adopted["artifactVersion"])

    def test_rollback_is_cas_guarded(self) -> None:
        self.publish()
        with self.assertRaisesRegex(ReleaseError, "CAS"):
            self.manager.rollback("wrong", self.adopted["artifactVersion"])
        self.manager.rollback(self.next_receipt["artifactVersion"], self.adopted["artifactVersion"])
        self.assertEqual(self.manager.current_artifact(), self.adopted["artifactVersion"])

    def test_runtime_and_build_snapshots_are_immutable(self) -> None:
        collision_site = self.temp / "collision"
        shutil.copytree(self.seed, collision_site)
        (collision_site / "assets/runtime-image-packs/default/tiles/grass.webp").write_bytes(b"different")
        with self.assertRaisesRegex(ReleaseError, "snapshot collision"):
            self.manager._ensure_site_snapshots(collision_site)
        (collision_site / "assets/runtime-image-packs/default/tiles/grass.webp").write_bytes(b"grass-old")
        (collision_site / "assets/item-icons/v1/item-96.webp").write_bytes(b"different")
        with self.assertRaisesRegex(ReleaseError, "snapshot collision"):
            self.manager._ensure_site_snapshots(collision_site)

    def test_nginx_transform_is_anchored_and_config_drift_blocks_publish(self) -> None:
        nginx = (CLIENT_ROOT / "nginx/nginx.conf.template").read_text(encoding="utf-8")
        default = (CLIENT_ROOT / "nginx/default.conf.template").read_text(encoding="utf-8")
        transformed_nginx, transformed_default = transform_nginx_templates(nginx, default)
        self.assertIn("map $arg_v $client_runtime_pack_root", transformed_nginx)
        self.assertIn("root /srv/daojie-client/current", transformed_default)
        self.assertIn("snapshots/runtime-pack", transformed_nginx)
        with self.assertRaisesRegex(ReleaseError, "anchor drift"):
            transform_nginx_templates(nginx, default.replace("root /usr/share/nginx/html;", "root /elsewhere;"))
        drifted = json.loads(json.dumps(self.next_receipt))
        drifted["nginxTemplates"][0]["sha256"] = "f" * 64
        drifted["nginx"]["files"][0]["sha256"] = "f" * 64
        drifted["files"] = sorted(drifted["dist"]["files"] + drifted["nginx"]["files"], key=lambda item: item["path"])
        drifted = validate_receipt(drifted)
        staging = self.temp / "drift"
        make_payload(staging, self.next_site, drifted, self.manager.plan(drifted)["changed"])
        with self.assertRaisesRegex(ReleaseError, "bootstrap is required"):
            self.manager.publish(drifted, staging / "payload", self.adopted["artifactVersion"])

    def test_full_bundle_is_validated_before_remote_delta_selection(self) -> None:
        bundle = self.temp / "bundle"
        source = self.temp / "archive-source"
        bundle.mkdir()
        source.mkdir()
        for item in self.next_receipt["dist"]["files"]:
            target = source / item["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(self.next_site / item["path"].removeprefix("dist/"), target)
        for item in self.next_receipt["nginxTemplates"]:
            target = source / item["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(CLIENT_ROOT / "nginx" / item["path"].removeprefix("nginx/"), target)
        receipt_bytes = json.dumps(self.next_receipt, indent=2).encode() + b"\n"
        (source / "receipt.json").write_bytes(receipt_bytes)
        (bundle / "receipt.json").write_bytes(receipt_bytes)
        archive = bundle / f"{self.next_receipt['artifactVersion']}.tar"
        with tarfile.open(archive, "w") as output:
            for name in ("dist", "nginx", "receipt.json"):
                output.add(source / name, arcname=name)
        envelope = {
            "schemaVersion": 1, "kind": "daojie-client-release-envelope",
            "artifactVersion": self.next_receipt["artifactVersion"],
            "receipt": record(bundle / "receipt.json", "receipt.json"),
            "archive": record(archive, archive.name),
        }
        (bundle / "bundle-envelope.json").write_text(json.dumps(envelope), encoding="utf-8")
        validated, _ = validate_bundle(bundle, self.temp / "extracted")
        delta = diff_receipts(self.adopted, validated)
        self.assertLess(len(delta["changed"]), len(validated["dist"]["files"]))

    def test_client_container_contract_rejects_unknown_runtime_shape(self) -> None:
        info = {
            "Id": "c" * 64, "State": {"Running": True},
            "Image": "sha256:" + "d" * 64,
            "Config": {"Cmd": ["nginx", "-g", "daemon off;"], "Entrypoint": ["/docker-entrypoint.sh"],
                       "Env": ["NGINX_ENTRYPOINT_QUIET_LOGS=1"], "Labels": {}},
            "HostConfig": {"NetworkMode": "daojie_net", "PortBindings": {
                "80/tcp": [{"HostIp": "", "HostPort": "11921"}]},
                "RestartPolicy": {"Name": "unless-stopped"}, "Privileged": False},
            "NetworkSettings": {"Networks": {"daojie_net": {"Aliases": ["client"]}}},
            "Mounts": [],
        }
        self.assertEqual(validate_client_container_contract(info)["aliases"], ["client"])
        # A container ID and its immutable image digest are distinct Docker identities.
        self.assertEqual(validate_bootstrap_identity(info, "c" * 64, "sha256:" + "d" * 64)["image"], info["Image"])
        with self.assertRaisesRegex(ReleaseError, "container changed"):
            validate_bootstrap_identity(info, "e" * 64, info["Image"])
        with self.assertRaisesRegex(ReleaseError, "image digest"):
            validate_bootstrap_identity(info, info["Id"], "sha256:" + "e" * 64)

        for mutation in (
            lambda value: value["Mounts"].append({"Destination": "/unknown"}),
            lambda value: value["HostConfig"]["PortBindings"].update({"81/tcp": []}),
            lambda value: value["Config"].update({"Cmd": ["sh"]}),
            lambda value: value["HostConfig"].update({"IpcMode": "host"}),
        ):
            changed = json.loads(json.dumps(info))
            mutation(changed)
            with self.assertRaises(ReleaseError):
                validate_client_container_contract(changed)

    def test_remove_tree_unlinks_staging_symlink_without_following_it(self) -> None:
        root = "/opt/daojie/client-site/.uploads/sandbox"
        linked = f"{root}/current"

        class FakeSftp:
            def __init__(self) -> None:
                self.listed: list[str] = []
                self.removed: list[str] = []
                self.rmdirs: list[str] = []

            def listdir_attr(self, path: str):
                self.listed.append(path)
                if path != root:
                    raise AssertionError(f"unexpected traversal: {path}")
                return [
                    SimpleNamespace(filename="current", st_mode=stat.S_IFLNK),
                    SimpleNamespace(filename="receipt.json", st_mode=stat.S_IFREG),
                ]

            def remove(self, path: str) -> None:
                self.removed.append(path)

            def rmdir(self, path: str) -> None:
                self.rmdirs.append(path)

        remote = object.__new__(Remote)
        remote.sftp = FakeSftp()
        Remote.remove_tree(remote, root, "/opt/daojie/client-site/.uploads")
        self.assertEqual(remote.sftp.listed, [root])
        self.assertCountEqual(remote.sftp.removed, [linked, f"{root}/receipt.json"])
        self.assertEqual(remote.sftp.rmdirs, [root])

    def test_known_hosts_flag_is_explicit(self) -> None:
        parsed = parse_args(["--mode", "plan", "--bundle", "bundle", "--env-file", "deploy.env",
                             "--known-hosts", "known_hosts"])
        self.assertEqual(parsed.known_hosts, Path("known_hosts"))


if __name__ == "__main__":
    if os.name == "nt":
        windows_path = str(Path(__file__).resolve())
        linux_path = f"/mnt/{windows_path[0].lower()}{windows_path[2:].replace(chr(92), '/')}"
        raise SystemExit(subprocess.run(["wsl.exe", "python3", linux_path], check=False).returncode)
    unittest.main(verbosity=2)
