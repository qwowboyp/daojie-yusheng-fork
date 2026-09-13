#!/usr/bin/env python3
"""Remote half of the Daojie atomic static-client release protocol.

The module is deliberately usable as a library so the dangerous filesystem and
CAS behaviour can be exercised in a temporary directory without SSH or Docker.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Callable, Iterable


SCHEMA_VERSION = 1
TRANSFORM_VERSION = "hot-static-v1"
RELEASE_KIND = "daojie-client-release"
ADOPTED_RELEASE_KIND = "daojie-client-adopted-release"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEX40 = re.compile(r"^[0-9a-f]{40}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,160}$")
VITE_HASHED_ASSET = re.compile(r"^assets/[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$")
RUNTIME_MANIFEST = "assets/runtime-image-packs/default/manifest.json"
BUILD_ART_PREFIXES = (
    "assets/attr-icons/",
    "assets/building-art/",
    "assets/craft-icons/",
    "assets/item-icons/",
    "assets/vfx/",
)
EXPECTED_NGINX_TEMPLATES = {
    "nginx/nginx.conf.template",
    "nginx/default.conf.template",
}
FULL_VERIFICATION_KIND = "daojie-full-release-verification"
FULL_VERIFICATION_COMMAND = "pnpm verify:release:full"
FULL_VERIFICATION_GATES = (
    "with-db",
    "gm-database-backup-persistence",
    "shadow",
    "gm",
)


class ReleaseError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def normalize_relative(value: object, *, prefix: str | None = None) -> str:
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise ReleaseError(f"invalid relative path: {value!r}")
    pure = PurePosixPath(value)
    if pure.is_absolute() or any(part in ("", ".", "..") for part in pure.parts):
        raise ReleaseError(f"unsafe relative path: {value!r}")
    normalized = pure.as_posix()
    if prefix is not None and not normalized.startswith(prefix):
        raise ReleaseError(f"path outside {prefix}: {normalized}")
    return normalized


def safe_child(root: Path, relative: str) -> Path:
    normalized = normalize_relative(relative)
    candidate = root.joinpath(*PurePosixPath(normalized).parts)
    if os.path.commonpath((str(root.absolute()), str(candidate.absolute()))) != str(root.absolute()):
        raise ReleaseError(f"path escapes root: {relative}")
    return candidate


def _validate_file_records(value: object, *, prefix: str | None = None) -> list[dict]:
    if not isinstance(value, list):
        raise ReleaseError("receipt file list is missing")
    records: list[dict] = []
    for item in value:
        if not isinstance(item, dict):
            raise ReleaseError("receipt file record must be an object")
        path = normalize_relative(item.get("path"), prefix=prefix)
        sha = item.get("sha256")
        size = item.get("bytes")
        if not isinstance(sha, str) or not HEX64.fullmatch(sha):
            raise ReleaseError(f"invalid sha256 for {path}")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ReleaseError(f"invalid size for {path}")
        records.append({"path": path, "sha256": sha, "bytes": size})
    paths = [item["path"] for item in records]
    if paths != sorted(paths) or len(paths) != len(set(paths)):
        raise ReleaseError("receipt paths must be unique and sorted")
    return records


def _parse_utc_timestamp(value: object) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ReleaseError("full receipt verification timestamp is not UTC ISO")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as error:
        raise ReleaseError("full receipt verification timestamp is invalid") from error
    if parsed.tzinfo != timezone.utc:
        raise ReleaseError("full receipt verification timestamp is not UTC")
    return parsed


def _validate_coordinated_full(payload: dict) -> None:
    coordinated = payload.get("coordinatedFull")
    if (not isinstance(coordinated, dict) or coordinated.get("serverCommit") != payload["commit"]
            or coordinated.get("publicationOrder") != "server-before-client"):
        raise ReleaseError("full receipt is missing the coordinated server-first contract")
    proof = coordinated.get("fullVerification")
    if (not isinstance(proof, dict) or proof.get("schemaVersion") != 1
            or proof.get("kind") != FULL_VERIFICATION_KIND or proof.get("commit") != payload["commit"]
            or proof.get("command") != FULL_VERIFICATION_COMMAND or proof.get("exitCode") != 0):
        raise ReleaseError("full receipt verification identity is invalid")
    if _parse_utc_timestamp(proof.get("startedAt")) > _parse_utc_timestamp(proof.get("completedAt")):
        raise ReleaseError("full receipt verification timestamps are invalid")
    gates = proof.get("gates")
    if (not isinstance(gates, list) or len(gates) != len(FULL_VERIFICATION_GATES)
            or any(not isinstance(gate, dict) or gate.get("label") != FULL_VERIFICATION_GATES[index]
                   or gate.get("exitCode") != 0 for index, gate in enumerate(gates))):
        raise ReleaseError("full receipt verification gate list is incomplete")
    for name in ("sourceArchive", "report"):
        record = proof.get(name)
        if (not isinstance(record, dict) or not isinstance(record.get("bytes"), int)
                or isinstance(record.get("bytes"), bool) or record["bytes"] < 1
                or not isinstance(record.get("sha256"), str) or not HEX64.fullmatch(record["sha256"])):
            raise ReleaseError(f"full receipt {name} evidence is invalid")


def validate_receipt(payload: object) -> dict:
    if (not isinstance(payload, dict) or payload.get("schemaVersion") != SCHEMA_VERSION
            or payload.get("kind") not in (RELEASE_KIND, ADOPTED_RELEASE_KIND)):
        raise ReleaseError("unsupported release receipt")
    for field in ("commit", "baseCommit"):
        if not isinstance(payload.get(field), str) or not HEX40.fullmatch(payload[field]):
            raise ReleaseError(f"invalid receipt {field}")
    artifact = payload.get("artifactVersion")
    build_id = payload.get("buildId")
    if not isinstance(artifact, str) or not SAFE_ID.fullmatch(artifact):
        raise ReleaseError("invalid artifactVersion")
    if not isinstance(build_id, str) or not SAFE_ID.fullmatch(build_id):
        raise ReleaseError("invalid buildId")
    expected_artifact = (f"client-{payload['commit'][:12]}-{build_id}" if payload.get("kind") == RELEASE_KIND
                         else f"adopt-{payload['commit'][:12]}-{build_id}")
    if artifact != expected_artifact:
        raise ReleaseError("artifactVersion is not bound to commit and buildId")
    classification = payload.get("classification")
    expected_classifications = ("assets", "client", "full") if payload.get("kind") == RELEASE_KIND else ("adopted-live-client",)
    if classification not in expected_classifications:
        raise ReleaseError("invalid receipt classification")
    if classification == "full":
        _validate_coordinated_full(payload)
    elif payload.get("coordinatedFull") is not None:
        raise ReleaseError("client/assets receipt must not contain coordinatedFull")
    verification = payload.get("verification")
    expected_verification = "pnpm verify:client" if payload.get("kind") == RELEASE_KIND else "adopt-verified-production"
    if (payload.get("verificationPassed") is not True or payload.get("verificationSkipped") is not False
            or not isinstance(verification, dict) or verification.get("exitCode") != 0
            or verification.get("command") != expected_verification):
        raise ReleaseError("release did not pass the required client verification")
    version = payload.get("version")
    if (not isinstance(version, dict) or version.get("buildId") != build_id
            or version.get("manifestPath") != "dist/version.json"
            or not isinstance(version.get("sha256"), str) or not HEX64.fullmatch(version["sha256"])):
        raise ReleaseError("version receipt is inconsistent")
    files = _validate_file_records(payload.get("files"))
    dist_files = _validate_file_records((payload.get("dist") or {}).get("files"), prefix="dist/")
    nginx_files = _validate_file_records((payload.get("nginx") or {}).get("files"), prefix="nginx/")
    nginx_templates = _validate_file_records(payload.get("nginxTemplates"), prefix="nginx/")
    if {item["path"] for item in nginx_templates} != EXPECTED_NGINX_TEMPLATES:
        raise ReleaseError("nginx template set is not the expected two-file contract")
    if files != sorted(dist_files + nginx_files, key=lambda item: item["path"]):
        raise ReleaseError("receipt files do not equal dist plus nginx files")
    if nginx_files != nginx_templates:
        raise ReleaseError("nginxTemplates differ from nginx.files")
    version_record = next((item for item in dist_files if item["path"] == "dist/version.json"), None)
    if not version_record or version_record["sha256"] != version["sha256"]:
        raise ReleaseError("version.json hash is not bound to dist manifest")
    result = dict(payload)
    result["files"] = files
    result["dist"]["files"] = dist_files
    result["nginx"]["files"] = nginx_files
    result["nginxTemplates"] = nginx_templates
    return result


def load_receipt(path: Path) -> dict:
    try:
        return validate_receipt(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseError(f"cannot read receipt {path}: {error}") from error


def manifest_map(receipt: dict, *, strip_dist: bool = False) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for record in receipt["dist"]["files"]:
        path = record["path"][5:] if strip_dist else record["path"]
        result[path] = record
    return result


def verify_file(path: Path, record: dict) -> None:
    try:
        stat = path.lstat()
    except FileNotFoundError as error:
        raise ReleaseError(f"missing file: {record['path']}") from error
    if path.is_symlink() or not path.is_file() or stat.st_size != record["bytes"] or sha256_file(path) != record["sha256"]:
        raise ReleaseError(f"file hash mismatch: {record['path']}")


def verify_payload(payload_dir: Path, receipt: dict, changed: Iterable[str]) -> None:
    expected = set(changed)
    found: set[str] = set()
    if payload_dir.exists():
        for path in payload_dir.rglob("*"):
            if path.is_symlink():
                raise ReleaseError(f"payload contains symlink: {path}")
            if path.is_file():
                relative = path.relative_to(payload_dir).as_posix()
                normalize_relative(relative)
                if relative.startswith("nginx/"):
                    continue
                normalize_relative(relative, prefix="dist/")
                found.add(relative)
    if found != expected:
        raise ReleaseError(f"payload scope mismatch: missing={sorted(expected-found)} extra={sorted(found-expected)}")
    records = {item["path"]: item for item in receipt["dist"]["files"]}
    for relative in sorted(expected):
        if relative not in records:
            raise ReleaseError(f"payload path absent from receipt: {relative}")
        verify_file(safe_child(payload_dir, relative), records[relative])
    nginx_records = {item["path"]: item for item in receipt["nginxTemplates"]}
    for relative in sorted(path for path in _iter_files(payload_dir) if path.startswith("nginx/")):
        if relative not in nginx_records:
            raise ReleaseError(f"unknown nginx payload file: {relative}")
        verify_file(safe_child(payload_dir, relative), nginx_records[relative])


def _copy_tree_hardlinked(source: Path, destination: Path) -> None:
    if source.is_symlink() or not source.is_dir():
        raise ReleaseError(f"invalid seed directory: {source}")
    shutil.copytree(source, destination, copy_function=os.link, symlinks=False)


def _replace_from_payload(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.is_symlink():
        if destination.is_dir() and not destination.is_symlink():
            shutil.rmtree(destination)
        else:
            destination.unlink()
    temporary = destination.with_name(f".{destination.name}.{os.getpid()}.new")
    shutil.copy2(source, temporary)
    # Upload staging is private (0600); only the new public asset inode is readable by nginx.
    temporary.chmod(0o644)
    os.replace(temporary, destination)


def _iter_files(root: Path) -> set[str]:
    result: set[str] = set()
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ReleaseError(f"release tree contains symlink: {path}")
        if path.is_file():
            result.add(path.relative_to(root).as_posix())
    return result


def _directory_records(root: Path, archive_prefix: str) -> list[dict]:
    records: list[dict] = []
    for relative in sorted(_iter_files(root)):
        path = safe_child(root, relative)
        records.append({"path": f"{archive_prefix}/{relative}", "bytes": path.stat().st_size, "sha256": sha256_file(path)})
    return records


def build_adopted_receipt(seed_site: Path, template_receipt: dict, adopt_commit: str) -> dict:
    if not HEX40.fullmatch(adopt_commit):
        raise ReleaseError("adopt commit must be an exact 40-character commit")
    version_path = seed_site / "version.json"
    version_source = version_path.read_bytes()
    version = _read_version(seed_site)
    dist_files = _directory_records(seed_site, "dist")
    nginx_files = list(template_receipt["nginxTemplates"])
    artifact = f"adopt-{adopt_commit[:12]}-{version['buildId']}"
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": ADOPTED_RELEASE_KIND,
        "commit": adopt_commit,
        "baseCommit": adopt_commit,
        "artifactVersion": artifact,
        "classification": "adopted-live-client",
        "verification": {"command": "adopt-verified-production", "exitCode": 0, "completedAt": "adopted"},
        "verificationPassed": True,
        "verificationSkipped": False,
        "buildId": version["buildId"],
        "version": {"buildId": version["buildId"], "builtAt": str(version.get("builtAt", "adopted")),
                    "manifestPath": "dist/version.json", "sha256": hashlib.sha256(version_source).hexdigest()},
        "dist": {"files": dist_files},
        "nginx": {"files": nginx_files},
        "nginxTemplates": nginx_files,
        "files": sorted(dist_files + nginx_files, key=lambda item: item["path"]),
        "delta": {"mode": "adopt", "changed": [item["path"] for item in dist_files], "removed": []},
    }
    return validate_receipt(payload)


def _is_retained_asset(path: str) -> bool:
    return VITE_HASHED_ASSET.fullmatch(path) is not None


def _read_version(site: Path) -> dict:
    try:
        value = json.loads((site / "version.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseError(f"invalid site version.json: {error}") from error
    build_id = value.get("buildId") if isinstance(value, dict) else None
    if not isinstance(build_id, str) or not SAFE_ID.fullmatch(build_id):
        raise ReleaseError("site version.json has unsafe buildId")
    return value


def _runtime_version(site: Path) -> str:
    path = site / RUNTIME_MANIFEST
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseError(f"invalid runtime image manifest: {error}") from error
    version = value.get("version") if isinstance(value, dict) else None
    if isinstance(version, (int, float)) and not isinstance(version, bool):
        version = str(version)
    if not isinstance(version, str) or not SAFE_ID.fullmatch(version):
        raise ReleaseError("runtime image manifest requires a safe non-empty version")
    return version


def _snapshot_records(source: Path, prefixes: tuple[str, ...]) -> dict[str, tuple[int, str]]:
    records: dict[str, tuple[int, str]] = {}
    for relative in sorted(_iter_files(source)):
        if any(relative.startswith(prefix) for prefix in prefixes):
            path = safe_child(source, relative)
            records[relative] = (path.stat().st_size, sha256_file(path))
    return records


def ensure_snapshot(source: Path, destination: Path, prefixes: tuple[str, ...]) -> None:
    wanted = _snapshot_records(source, prefixes)
    if destination.exists():
        actual = _snapshot_records(destination, ("",))
        if actual != wanted:
            raise ReleaseError(f"immutable snapshot collision: {destination.name}")
        return
    temporary = destination.with_name(f".{destination.name}.{os.getpid()}.tmp")
    if temporary.exists():
        shutil.rmtree(temporary)
    temporary.mkdir(parents=True)
    for relative in sorted(wanted):
        target = safe_child(temporary, relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        os.link(safe_child(source, relative), target)
    destination.parent.mkdir(parents=True, exist_ok=True)
    os.replace(temporary, destination)


def transform_nginx_templates(nginx_source: str, default_source: str) -> tuple[str, str]:
    http_anchor = "http {\n"
    root_anchor = "    root /usr/share/nginx/html;"
    manifest_anchor = '''    location ~ ^/assets/runtime-image-packs/[^/]+/manifest\\.json$ {
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate" always;
        try_files $uri =404;
    }
'''
    if nginx_source.count(http_anchor) != 1 or default_source.count(root_anchor) != 1 or default_source.count(manifest_anchor) != 1:
        raise ReleaseError("nginx template anchor drift; bootstrap transform refused")
    maps = '''http {
    # Generated by remote_apply.py; version values are restricted before use in alias paths.
    map $arg_v $client_build_art_root {
        "" /srv/daojie-client/current;
        ~^[A-Za-z0-9._-]+$ /srv/daojie-client/snapshots/build/$arg_v;
        default /srv/daojie-client/invalid;
    }
    map $arg_v $client_build_art_cache {
        "" "no-cache, must-revalidate";
        ~^[A-Za-z0-9._-]+$ "public, max-age=31536000, immutable";
        default "no-store";
    }
    map $arg_v $client_runtime_pack_root {
        ~^[A-Za-z0-9._-]+$ /srv/daojie-client/snapshots/runtime-pack/$arg_v;
        default /srv/daojie-client/invalid;
    }
'''
    nginx_result = nginx_source.replace(http_anchor, maps, 1)
    default_result = default_source.replace(root_anchor, "    root /srv/daojie-client/current;", 1)
    locations = manifest_anchor + '''
    location ~ ^/assets/runtime-image-packs/(?<runtime_pack>[^/]+)/(?<runtime_asset>.+)$ {
        alias $client_runtime_pack_root/$runtime_pack/$runtime_asset;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location ~ ^/assets/(?<build_art_group>attr-icons|building-art|craft-icons|item-icons|vfx)/(?<build_art_asset>.+)$ {
        alias $client_build_art_root/assets/$build_art_group/$build_art_asset;
        add_header Cache-Control $client_build_art_cache always;
    }
'''
    default_result = default_result.replace(manifest_anchor, locations, 1)
    return nginx_result, default_result


class RemoteReleaseManager:
    def __init__(self, site_root: Path):
        if not site_root.is_absolute():
            raise ReleaseError("site root must be absolute")
        self.root = site_root
        self.releases = site_root / "releases"
        self.snapshots = site_root / "snapshots"
        self.current = site_root / "current"
        self.previous = site_root / "previous"
        self.state_path = site_root / ".release-state.json"

    def state(self) -> dict | None:
        if not self.state_path.exists():
            return None
        try:
            value = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ReleaseError(f"invalid release state: {error}") from error
        if not isinstance(value, dict) or value.get("transformVersion") != TRANSFORM_VERSION:
            raise ReleaseError("release state transform contract is unsupported")
        return value

    def current_artifact(self) -> str | None:
        if not self.current.is_symlink():
            if self.current.exists():
                raise ReleaseError("current exists but is not a symlink")
            return None
        raw = os.readlink(self.current)
        match = re.fullmatch(r"releases/([A-Za-z0-9._-]{1,160})/site", raw.replace("\\", "/"))
        if not match:
            raise ReleaseError(f"unsafe current symlink target: {raw}")
        return match.group(1)

    def receipt_for(self, artifact: str) -> dict:
        if not SAFE_ID.fullmatch(artifact):
            raise ReleaseError("unsafe artifact id")
        return load_receipt(self.releases / artifact / "receipt.json")

    def _assert_config_contract(self, receipt: dict) -> None:
        state = self.state()
        if not state:
            raise ReleaseError("hot static root is not bootstrapped")
        hashes = {item["path"]: item["sha256"] for item in receipt["nginxTemplates"]}
        if hashes != state.get("sourceNginxTemplateHashes") or state.get("transformVersion") != TRANSFORM_VERSION:
            raise ReleaseError("nginx template/config contract changed; bootstrap is required")

    def plan(self, receipt: dict) -> dict:
        current = self.current_artifact()
        old = self.receipt_for(current) if current else None
        current_files = manifest_map(old) if old else {}
        next_files = manifest_map(receipt)
        changed = sorted(path for path, item in next_files.items()
                         if path not in current_files or current_files[path]["sha256"] != item["sha256"] or current_files[path]["bytes"] != item["bytes"])
        removed = sorted(set(current_files) - set(next_files))
        retained = sorted(path for path in removed if _is_retained_asset(path[5:]))
        return {"current": current, "artifactVersion": receipt["artifactVersion"], "changed": changed,
                "removed": removed, "retainedHashedAssets": retained}

    def _build_candidate(self, receipt: dict, payload_dir: Path, *, seed_site: Path | None = None) -> tuple[Path, list[str]]:
        artifact = receipt["artifactVersion"]
        final = self.releases / artifact
        if final.exists():
            raise ReleaseError(f"release already exists: {artifact}")
        plan = self.plan(receipt)
        changed = plan["changed"] if seed_site is None else [item["path"] for item in receipt["dist"]["files"]]
        verify_payload(payload_dir, receipt, changed)
        self.root.mkdir(parents=True, exist_ok=True)
        self.root.chmod(0o755)
        self.releases.mkdir(parents=True, exist_ok=True)
        temporary = self.releases / f".{artifact}.{os.getpid()}.tmp"
        if temporary.exists():
            shutil.rmtree(temporary)
        temporary.mkdir()
        site = temporary / "site"
        source = seed_site
        if source is None:
            current = self.current_artifact()
            if not current:
                raise ReleaseError("publish requires current release")
            source = self.releases / current / "site"
        _copy_tree_hardlinked(source, site)
        wanted = manifest_map(receipt, strip_dist=True)
        existing = _iter_files(site)
        retained: list[str] = []
        for relative in sorted(existing - set(wanted)):
            if _is_retained_asset(relative):
                retained.append(relative)
                continue
            path = safe_child(site, relative)
            path.unlink()
        for archive_path in changed:
            relative = archive_path[5:]
            _replace_from_payload(safe_child(payload_dir, archive_path), safe_child(site, relative))
        for relative, record in wanted.items():
            verify_file(safe_child(site, relative), {**record, "path": relative})
        extras = _iter_files(site) - set(wanted)
        if extras != set(retained) or any(not _is_retained_asset(path) for path in extras):
            raise ReleaseError("candidate contains unexpected extra files")
        version = _read_version(site)
        if version["buildId"] != receipt["buildId"]:
            raise ReleaseError("candidate buildId does not match receipt")
        shutil.copy2(payload_dir.parent / "receipt.json", temporary / "receipt.json")
        atomic_json(temporary / "compatibility.json", {"retainedHashedAssets": retained})
        self._ensure_site_snapshots(site)
        os.replace(temporary, final)
        return final, retained

    def _ensure_site_snapshots(self, site: Path) -> None:
        build_id = _read_version(site)["buildId"]
        runtime_version = _runtime_version(site)
        ensure_snapshot(site, self.snapshots / "build" / build_id, BUILD_ART_PREFIXES)
        pack_root = site / "assets/runtime-image-packs/default"
        ensure_snapshot(pack_root, self.snapshots / "runtime-pack" / runtime_version / "default", ("",))

    def _atomic_link(self, link: Path, artifact: str) -> None:
        if not SAFE_ID.fullmatch(artifact):
            raise ReleaseError("unsafe artifact for symlink")
        temporary = link.with_name(f".{link.name}.{os.getpid()}.tmp")
        if temporary.exists() or temporary.is_symlink():
            temporary.unlink()
        os.symlink(f"releases/{artifact}/site", temporary)
        os.replace(temporary, link)

    def _switch(self, expected: str | None, target: str) -> None:
        actual = self.current_artifact()
        if actual != expected:
            raise ReleaseError(f"current CAS mismatch: expected={expected} actual={actual}")
        if not (self.releases / target / "site").is_dir():
            raise ReleaseError(f"rollback/switch target is missing: {target}")
        if actual:
            self._atomic_link(self.previous, actual)
        self._atomic_link(self.current, target)

    def adopt_live(self, template_receipt: dict, seed_site: Path, adopt_commit: str, image_digest: str,
                   transformed_hashes: dict[str, str]) -> dict:
        if self.state_path.exists() or self.current.exists() or self.current.is_symlink():
            raise ReleaseError("site root is already bootstrapped")
        adopted = build_adopted_receipt(seed_site, template_receipt, adopt_commit)
        artifact = adopted["artifactVersion"]
        final = self.releases / artifact
        self.root.mkdir(parents=True, exist_ok=True)
        self.root.chmod(0o755)
        self.releases.mkdir(parents=True, exist_ok=True)
        temporary = self.releases / f".{artifact}.{os.getpid()}.tmp"
        if temporary.exists():
            shutil.rmtree(temporary)
        temporary.mkdir()
        _copy_tree_hardlinked(seed_site, temporary / "site")
        atomic_json(temporary / "receipt.json", adopted)
        self._ensure_site_snapshots(temporary / "site")
        os.replace(temporary, final)
        self._atomic_link(self.current, artifact)
        state = {
            "schemaVersion": 1,
            "transformVersion": TRANSFORM_VERSION,
            "sourceNginxTemplateHashes": {item["path"]: item["sha256"] for item in template_receipt["nginxTemplates"]},
            "transformedNginxTemplateHashes": transformed_hashes,
            "bootstrapClientImageDigest": image_digest,
            "currentArtifactVersion": artifact,
            "adoptedCommit": adopt_commit,
            "adoptedBuildId": adopted["buildId"],
        }
        atomic_json(self.state_path, state)
        return adopted

    def bootstrap_filesystem(self, receipt: dict, payload_dir: Path, seed_site: Path, image_digest: str,
                             transformed_hashes: dict[str, str]) -> dict:
        if self.state_path.exists() or self.current.exists() or self.current.is_symlink():
            raise ReleaseError("site root is already bootstrapped")
        final, retained = self._build_candidate(receipt, payload_dir, seed_site=seed_site)
        self.root.mkdir(parents=True, exist_ok=True)
        self._atomic_link(self.current, receipt["artifactVersion"])
        state = {
            "schemaVersion": 1,
            "transformVersion": TRANSFORM_VERSION,
            "sourceNginxTemplateHashes": {item["path"]: item["sha256"] for item in receipt["nginxTemplates"]},
            "transformedNginxTemplateHashes": transformed_hashes,
            "bootstrapClientImageDigest": image_digest,
            "currentArtifactVersion": receipt["artifactVersion"],
        }
        atomic_json(self.state_path, state)
        return {"release": str(final), "retainedHashedAssets": retained, "state": state}

    def publish(self, receipt: dict, payload_dir: Path, expected_current: str,
                postcheck: Callable[[], None] | None = None) -> dict:
        self._assert_config_contract(receipt)
        if self.current_artifact() != expected_current:
            raise ReleaseError("publish current CAS mismatch")
        old_receipt = self.receipt_for(expected_current)
        if receipt["baseCommit"] != old_receipt["commit"]:
            raise ReleaseError("receipt baseCommit does not equal current deployed commit")
        final, retained = self._build_candidate(receipt, payload_dir)
        self._switch(expected_current, receipt["artifactVersion"])
        try:
            if postcheck:
                postcheck()
        except Exception:
            self._atomic_link(self.current, expected_current)
            raise
        state = self.state() or {}
        state["currentArtifactVersion"] = receipt["artifactVersion"]
        state["previousArtifactVersion"] = expected_current
        atomic_json(self.state_path, state)
        return {"release": str(final), "previous": expected_current, "retainedHashedAssets": retained}

    def rollback(self, expected_current: str, target: str, postcheck: Callable[[], None] | None = None) -> dict:
        if self.current_artifact() != expected_current:
            raise ReleaseError("rollback current CAS mismatch")
        self._assert_config_contract(self.receipt_for(target))
        self.receipt_for(expected_current)
        self._switch(expected_current, target)
        try:
            if postcheck:
                postcheck()
        except Exception:
            self._atomic_link(self.current, expected_current)
            raise
        state = self.state() or {}
        state["currentArtifactVersion"] = target
        state["previousArtifactVersion"] = expected_current
        atomic_json(self.state_path, state)
        return {"current": target, "previous": expected_current}


def run_checked(command: list[str], *, capture: bool = True, timeout: float = 120) -> str:
    try:
        result = subprocess.run(command, text=True, capture_output=capture, check=False, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        raise ReleaseError(f"command timed out after {timeout}s ({command[0]})") from error
    if result.returncode != 0:
        message = result.stderr.strip() if capture else ""
        raise ReleaseError(f"command failed ({command[0]}): {message}")
    return result.stdout.strip() if capture else ""


def docker_inspect(name: str) -> dict:
    raw = run_checked(["docker", "inspect", name])
    value = json.loads(raw)
    if not isinstance(value, list) or len(value) != 1:
        raise ReleaseError(f"unexpected docker inspect result for {name}")
    return value[0]


def validate_coordinated_server_image(receipt: dict, container_info: dict, image_info: dict) -> str | None:
    if receipt.get("classification") != "full":
        return None
    if not (container_info.get("State") or {}).get("Running"):
        raise ReleaseError("coordinated full publish requires a running server container")
    image_id = container_info.get("Image")
    if not isinstance(image_id, str) or not image_id or image_info.get("Id") != image_id:
        raise ReleaseError("cannot bind the running server container to its immutable image")
    revision = ((image_info.get("Config") or {}).get("Labels") or {}).get("org.opencontainers.image.revision")
    if revision != receipt["commit"]:
        raise ReleaseError("server image OCI revision does not match coordinated full receipt commit")
    return revision


def verify_coordinated_server_ready(receipt: dict, timeout: int) -> dict | None:
    if receipt.get("classification") != "full":
        return None
    container_info = docker_inspect("daojie-server")
    image_id = container_info.get("Image")
    image_info = docker_inspect(str(image_id))
    revision = validate_coordinated_server_image(receipt, container_info, image_info)
    wait_urls(list(SERVER_READINESS_URLS), timeout)
    return {"containerId": container_info.get("Id"), "imageId": image_id, "revision": revision}


def validate_client_container_contract(info: dict) -> dict:
    host = info.get("HostConfig") or {}
    config = info.get("Config") or {}
    networks = (info.get("NetworkSettings") or {}).get("Networks") or {}
    mounts = info.get("Mounts") or []
    port_bindings = host.get("PortBindings") or {}
    allowed_cmd = ["nginx", "-g", "daemon off;"]
    if host.get("NetworkMode") != "daojie_net" or set(networks) != {"daojie_net"}:
        raise ReleaseError("client has an unknown Docker network contract")
    binding = port_bindings.get("80/tcp") if isinstance(port_bindings, dict) else None
    if (set(port_bindings) != {"80/tcp"} or not isinstance(binding, list) or len(binding) != 1
            or binding[0].get("HostIp") not in ("", "0.0.0.0") or binding[0].get("HostPort") != "11921"):
        raise ReleaseError("client has an unknown Docker port contract")
    if (host.get("RestartPolicy") or {}).get("Name") != "unless-stopped":
        raise ReleaseError("client has an unknown restart policy")
    if config.get("Cmd") != allowed_cmd or config.get("Entrypoint") not in (["/docker-entrypoint.sh"], None):
        raise ReleaseError("client has a nonstandard command/entrypoint")
    forbidden = {
        "Privileged": host.get("Privileged"), "CapAdd": host.get("CapAdd"), "CapDrop": host.get("CapDrop"),
        "Devices": host.get("Devices"), "SecurityOpt": host.get("SecurityOpt"), "PidMode": host.get("PidMode"),
        "IpcMode": host.get("IpcMode") not in (None, "", "private"),
    }
    if any(value not in (None, False, "", [], {}) for value in forbidden.values()):
        raise ReleaseError(f"client has unsupported Docker privileges/options: {[key for key, value in forbidden.items() if value not in (None, False, '', [], {})]}")
    if mounts:
        raise ReleaseError("bootstrap requires the current client to have no existing mounts")
    aliases = list((networks["daojie_net"] or {}).get("Aliases") or [])
    return {"image": info.get("Image"), "env": list(config.get("Env") or []), "aliases": aliases,
            "labels": dict(config.get("Labels") or {})}


def container_ids(names: Iterable[str]) -> dict[str, str]:
    return {name: str(docker_inspect(name).get("Id")) for name in names}


def wait_urls(urls: list[str], timeout: int) -> None:
    deadline = time.monotonic() + timeout
    last = ""
    while time.monotonic() < deadline:
        try:
            for url in urls:
                with urllib.request.urlopen(url, timeout=3) as response:
                    if response.status != 200:
                        raise ReleaseError(f"HTTP {response.status}: {url}")
            return
        except Exception as error:  # readiness is intentionally bounded
            last = str(error)
            time.sleep(1)
    raise ReleaseError(f"readiness timed out: {last}")


def create_runtime_child_context(receipt: dict, payload_dir: Path, output: Path, base_digest: str) -> tuple[str, dict[str, str]]:
    if not isinstance(base_digest, str) or not base_digest.startswith("sha256:") or not HEX64.fullmatch(base_digest[7:]):
        raise ReleaseError("current client image is not pinned by digest")
    nginx_source = (payload_dir / "nginx/nginx.conf.template").read_text(encoding="utf-8")
    default_source = (payload_dir / "nginx/default.conf.template").read_text(encoding="utf-8")
    nginx_result, default_result = transform_nginx_templates(nginx_source, default_source)
    output.mkdir(parents=True, exist_ok=False)
    (output / "nginx.conf.template").write_text(nginx_result, encoding="utf-8", newline="\n")
    (output / "default.conf.template").write_text(default_result, encoding="utf-8", newline="\n")
    # Keep the generated Dockerfile simple: the current immutable image supplies
    # nginx and its entrypoint; this child only replaces the two templates.
    dockerfile = (
        f"FROM {base_digest}\n"
        f"LABEL io.daojie.client-hot-static.transform-version=\"{TRANSFORM_VERSION}\" "
        f"io.daojie.client-hot-static.source-revision=\"{receipt['commit']}\"\n"
        "COPY nginx.conf.template /etc/nginx/templates/nginx.conf.template\n"
        "COPY default.conf.template /etc/nginx/templates/conf.d/default.conf.template\n"
    )
    (output / "Dockerfile").write_text(dockerfile, encoding="utf-8", newline="\n")
    hashes = {name: sha256_file(output / name) for name in ("nginx.conf.template", "default.conf.template")}
    return dockerfile, hashes


PROTECTED_CONTAINERS = ("daojie-server", "daojie-postgres", "daojie-redis")
SERVER_READINESS_URLS = (
    "http://127.0.0.1:13001/health",
    "http://127.0.0.1:13001/live",
)
READINESS_URLS = (
    "http://127.0.0.1:11921/",
    "http://127.0.0.1:11921/version.json",
    "http://127.0.0.1:11921/socket.io/?EIO=4&transport=polling",
    "http://127.0.0.1:13001/health",
    "http://127.0.0.1:13001/live",
)


def _docker_mount(site_root: Path) -> str:
    return f"type=bind,src={site_root},dst=/srv/daojie-client,readonly"


def _docker_env_args(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if not isinstance(value, str) or "=" not in value or "\x00" in value or "\n" in value:
            raise ReleaseError("client environment from inspect is invalid")
        result.extend(("--env", value))
    return result


def _docker_alias_args(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value or any(char.isspace() for char in value):
            raise ReleaseError("client network alias from inspect is invalid")
        if re.fullmatch(r"[0-9a-f]{12,64}", value):
            continue
        result.extend(("--network-alias", value))
    return result


def _probe_expected_build(build_id: str) -> None:
    with urllib.request.urlopen("http://127.0.0.1:11921/version.json", timeout=5) as response:
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, dict) or value.get("buildId") != build_id:
        raise ReleaseError("live version.json buildId mismatch")
    with urllib.request.urlopen("http://127.0.0.1:11921/socket.io/?EIO=4&transport=polling", timeout=5) as response:
        body = response.read(128).decode("utf-8", "replace")
    if not body.startswith("0{"):
        raise ReleaseError("Socket.IO polling handshake is invalid")


def _verify_protected(expected: dict[str, str]) -> None:
    if container_ids(expected) != expected:
        raise ReleaseError("server/Postgres/Redis container identity changed")


def validate_bootstrap_identity(info: dict, expected_container: str, expected_image: str) -> dict:
    if not (info.get("State") or {}).get("Running"):
        raise ReleaseError("current client container is not running")
    if info.get("Id") != expected_container:
        raise ReleaseError("client container changed during bootstrap inspection")
    contract = validate_client_container_contract(info)
    if contract["image"] != expected_image:
        raise ReleaseError("client image digest does not match --expected-image")
    return contract


def bootstrap_docker(manager: RemoteReleaseManager, receipt: dict, payload_dir: Path, check_timeout: int,
                     expected_image: str, adopt_commit: str, expected_server_id: str | None = None) -> dict:
    if receipt["baseCommit"] != adopt_commit:
        raise ReleaseError("bundle baseCommit must equal the explicit adopt commit")
    if not expected_image.startswith("sha256:") or not HEX64.fullmatch(expected_image[7:]):
        raise ReleaseError("bootstrap expected image must be an exact sha256 digest")
    before = container_ids(("daojie-client",) + PROTECTED_CONTAINERS)
    if expected_server_id is not None and before["daojie-server"] != expected_server_id:
        raise ReleaseError("server container changed after coordinated full readiness verification")
    info = docker_inspect("daojie-client")
    contract = validate_bootstrap_identity(info, before["daojie-client"], expected_image)

    manager.root.parent.mkdir(parents=True, exist_ok=True)
    seed_parent = Path(tempfile.mkdtemp(prefix=".daojie-client-live-", dir=manager.root.parent))
    seed_site = seed_parent / "site"
    context = manager.root.parent / f".daojie-client-runtime-{receipt['artifactVersion']}-{os.getpid()}"
    preflight = f"daojie-client-hot-preflight-{os.getpid()}"
    backup = f"daojie-client-pre-hot-{int(time.time())}"
    rollback_tag = f"daojie-client:rollback-pre-hot-{receipt['commit'][:12]}"
    child_tag = f"daojie-client:hot-static-{receipt['commit'][:12]}"
    old_stopped = False
    switched = False
    try:
        seed_site.mkdir()
        run_checked(["docker", "cp", "daojie-client:/usr/share/nginx/html/.", str(seed_site)])
        _iter_files(seed_site)
        _, transformed_hashes = create_runtime_child_context(receipt, payload_dir, context, contract["image"])
        adopted = manager.adopt_live(receipt, seed_site, adopt_commit, contract["image"], transformed_hashes)
        run_checked(["docker", "build", "--pull=false", "-t", child_tag, str(context)], capture=False)
        run_checked(["docker", "run", "-d", "--name", preflight, "--network", "daojie_net",
                     "--mount", _docker_mount(manager.root), *_docker_env_args(contract["env"]), child_tag])
        run_checked(["docker", "exec", preflight, "wget", "-qO-", "http://127.0.0.1/"])
        run_checked(["docker", "exec", preflight, "wget", "-qO-", "http://127.0.0.1/version.json"])
        run_checked(["docker", "exec", preflight, "wget", "-qO-", "http://127.0.0.1/socket.io/?EIO=4&transport=polling"])
        run_checked(["docker", "rm", "-f", preflight])
        run_checked(["docker", "image", "tag", contract["image"], rollback_tag])
        if subprocess.run(["docker", "inspect", backup], capture_output=True, check=False).returncode == 0:
            raise ReleaseError(f"bootstrap backup container already exists: {backup}")
        run_checked(["docker", "stop", "--time", "30", "daojie-client"])
        old_stopped = True
        run_checked(["docker", "rename", "daojie-client", backup])
        switched = True
        run_checked(["docker", "run", "-d", "--name", "daojie-client", "--restart", "unless-stopped",
                     "--stop-timeout", "30", "--network", "daojie_net", "-p", "11921:80",
                     "--mount", _docker_mount(manager.root), *_docker_env_args(contract["env"]),
                     *_docker_alias_args(contract["aliases"]), child_tag])
        wait_urls(list(READINESS_URLS), check_timeout)
        _probe_expected_build(adopted["buildId"])
        protected = {name: before[name] for name in PROTECTED_CONTAINERS}
        _verify_protected(protected)
        hot_client_id = docker_inspect("daojie-client").get("Id")
        first_publish_root = seed_parent / "first-publish"
        first_publish_payload = first_publish_root / "payload"
        first_publish_payload.mkdir(parents=True)
        shutil.copy2(payload_dir.parent / "receipt.json", first_publish_root / "receipt.json")
        for archive_path in manager.plan(receipt)["changed"]:
            target = safe_child(first_publish_payload, archive_path)
            target.parent.mkdir(parents=True, exist_ok=True)
            os.link(safe_child(payload_dir, archive_path), target)
        publish_result = manager.publish(
            receipt,
            first_publish_payload,
            adopted["artifactVersion"],
            checked_postcheck(receipt["buildId"], protected, check_timeout),
        )
        if docker_inspect("daojie-client").get("Id") != hot_client_id:
            raise ReleaseError("client container changed during the first hot publish")
        run_checked(["docker", "image", "tag", child_tag, "daojie-client:lxc"])
        state = manager.state() or {}
        state.update({"bootstrapBackupContainer": backup, "bootstrapRollbackImage": rollback_tag,
                      "runtimeChildImage": docker_inspect("daojie-client").get("Image")})
        atomic_json(manager.state_path, state)
        return {"backupContainer": backup, "rollbackImage": rollback_tag,
                "runtimeChildImage": state["runtimeChildImage"],
                "adoptedArtifactVersion": adopted["artifactVersion"],
                "firstHotPublish": publish_result,
                "hotClientContainerId": hot_client_id,
                "protectedContainerIds": protected}
    except Exception:
        subprocess.run(["docker", "rm", "-f", preflight], capture_output=True, check=False)
        if switched:
            subprocess.run(["docker", "rm", "-f", "daojie-client"], capture_output=True, check=False)
            run_checked(["docker", "rename", backup, "daojie-client"])
            run_checked(["docker", "start", "daojie-client"])
            wait_urls(list(READINESS_URLS), check_timeout)
            _verify_protected({name: before[name] for name in PROTECTED_CONTAINERS})
        elif old_stopped:
            run_checked(["docker", "start", "daojie-client"])
            wait_urls(list(READINESS_URLS), check_timeout)
        if manager.root.exists() and manager.root.is_dir() and not manager.root.is_symlink():
            shutil.rmtree(manager.root)
        raise
    finally:
        shutil.rmtree(seed_parent, ignore_errors=True)
        shutil.rmtree(context, ignore_errors=True)


def checked_postcheck(build_id: str, expected_ids: dict[str, str], timeout: int) -> Callable[[], None]:
    def check() -> None:
        wait_urls(list(READINESS_URLS), timeout)
        _probe_expected_build(build_id)
        _verify_protected(expected_ids)
        if not (docker_inspect("daojie-client").get("State") or {}).get("Running"):
            raise ReleaseError("client container stopped during static switch")
    return check


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("plan", "bootstrap", "publish", "rollback"), default="plan")
    parser.add_argument("--site-root", type=Path, default=Path("/opt/daojie/client-site"))
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--payload-dir", type=Path)
    parser.add_argument("--expected-current")
    parser.add_argument("--target")
    parser.add_argument("--expected-image")
    parser.add_argument("--adopt-commit")
    parser.add_argument("--check-timeout", type=int, default=30)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    manager = RemoteReleaseManager(args.site_root)
    if args.check_timeout < 1 or args.check_timeout > 120:
        raise ReleaseError("check timeout must be between 1 and 120 seconds")
    receipt = load_receipt(args.receipt) if args.receipt else None
    if args.mode == "plan":
        if not receipt:
            raise ReleaseError("plan requires --receipt")
        result = manager.plan(receipt)
    elif args.mode == "bootstrap":
        if not all((receipt, args.payload_dir, args.expected_image, args.adopt_commit)):
            raise ReleaseError("bootstrap requires receipt, payload, expected-image and adopt-commit")
        server_evidence = verify_coordinated_server_ready(receipt, args.check_timeout)
        result = bootstrap_docker(manager, receipt, args.payload_dir, args.check_timeout,
                                  args.expected_image, args.adopt_commit,
                                  server_evidence["containerId"] if server_evidence else None)
    elif args.mode == "publish":
        if not all((receipt, args.payload_dir, args.expected_current)):
            raise ReleaseError("publish requires receipt, payload and expected current")
        server_evidence = verify_coordinated_server_ready(receipt, args.check_timeout)
        expected_ids = container_ids(PROTECTED_CONTAINERS)
        if server_evidence and expected_ids["daojie-server"] != server_evidence["containerId"]:
            raise ReleaseError("server container changed after coordinated full readiness verification")
        result = manager.publish(receipt, args.payload_dir, args.expected_current,
                                 checked_postcheck(receipt["buildId"], expected_ids, args.check_timeout))
    else:
        if not args.expected_current or not args.target:
            raise ReleaseError("rollback requires explicit expected current and target")
        expected_ids = container_ids(PROTECTED_CONTAINERS)
        target_receipt = manager.receipt_for(args.target)
        result = manager.rollback(args.expected_current, args.target,
                                  checked_postcheck(target_receipt["buildId"], expected_ids, args.check_timeout))
    print(json.dumps({"ok": True, "mode": args.mode, **result}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ReleaseError as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False, sort_keys=True), file=sys.stderr)
        raise SystemExit(1)
