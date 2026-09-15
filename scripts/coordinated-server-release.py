#!/usr/bin/env python3
"""CAS guarded server-only release helper for the Daojie LXC.

The default plan mode is read-only and prints only a sanitized Docker contract.
Publish and rollback require --execute and run the mutating worker on the LXC.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,160}$")
FULL_GATES = ("with-db", "gm-database-backup-persistence", "shadow", "gm")
FULL_VERIFICATION_KIND = "daojie-full-release-verification"
FULL_VERIFICATION_COMMAND = "pnpm verify:release:full"
SCOPED_VERIFICATION_KIND = "daojie-scoped-source-verification"
SCOPED_VERIFICATION_COMMAND = "node scripts/scoped-source-verification.mjs"
REQUIRED_SCOPED_COMMANDS = (
    ("setup:dependencies", "pnpm", ["install", "--frozen-lockfile"]),
    ("check:shared-types", "pnpm", ["--dir", "packages/shared", "exec", "tsc"]),
    ("check:server-types", "pnpm", ["--dir", "packages/server", "exec", "tsc", "-p", "tsconfig.json", "--pretty", "false"]),
)
SAFE_PROOF_SCRIPT = re.compile(
    r"^(?:scripts|packages/client/scripts)/(?:[a-z0-9._-]+/)*(?:check|prove|verify|test)[a-z0-9._-]*\.(?:c?js|mjs|py)$"
)
PROTECTED = ("daojie-client", "daojie-postgres", "daojie-redis")
SERVER_NAME = "daojie-server"
SERVER_NETWORK = "daojie_net"
SERVER_DATA_SOURCE = "/opt/daojie/server-data"
SERVER_DATA_DESTINATION = "/var/lib/server"
SERVER_PORT = "13001"
READINESS_URLS = ("http://127.0.0.1:13001/health", "http://127.0.0.1:13001/live")
SOCKET_PROBE_URL = "http://127.0.0.1:13001/socket.io/?EIO=4&transport=polling"
CLIENT_NAME = "daojie-client"
CLIENT_SOCKET_PROBE_URL = "http://127.0.0.1:11921/socket.io/?EIO=4&transport=polling"
DEFAULT_REMOTE_ROOT = "/opt/daojie/coordinated-server-releases"
MIN_SHARED_BUILD_FREE_BYTES = 6 * 1024 * 1024 * 1024
MIN_DOCKER_BUILD_FREE_BYTES = 5 * 1024 * 1024 * 1024
MIN_STAGE_FREE_BYTES = 1 * 1024 * 1024 * 1024
REQUIRED_ENV = ("LXC_HOST", "LXC_SSH_USER", "LXC_SSH_PASSWORD")


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
    temporary.chmod(0o600)
    os.replace(temporary, path)


def run_checked(command: list[str], *, timeout: float = 120, capture: bool = True) -> str:
    try:
        result = subprocess.run(command, text=True, capture_output=capture, check=False, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        raise ReleaseError(f"command timed out after {timeout}s: {command[0]}") from error
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "")[-4000:] if capture else ""
        raise ReleaseError(f"command failed ({command[0]}): {detail.strip()}")
    return result.stdout.strip() if capture else ""


def docker_inspect(name: str) -> dict:
    value = json.loads(run_checked(["docker", "inspect", name]))
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        raise ReleaseError(f"unexpected docker inspect result: {name}")
    return value[0]


def image_revision(image_id: str) -> str | None:
    image = docker_inspect(image_id)
    return ((image.get("Config") or {}).get("Labels") or {}).get("org.opencontainers.image.revision")


def validate_built_image(image_id: str, commit: str) -> None:
    image = docker_inspect(image_id)
    config = image.get("Config") or {}
    if ((config.get("Labels") or {}).get("org.opencontainers.image.revision") != commit
            or config.get("Cmd") != ["node", "dist/main.js"]
            or config.get("Entrypoint") != ["docker-entrypoint.sh"]
            or config.get("User") != "appuser"
            or config.get("WorkingDir") != "/app/packages/server"
            or set(config.get("ExposedPorts") or {}) != {"13001/tcp"}):
        raise ReleaseError("built server image runtime contract or OCI revision is invalid")


def container_ids(names: tuple[str, ...]) -> dict[str, str]:
    return {name: str(docker_inspect(name).get("Id")) for name in names}


def safe_server_summary(server: dict) -> dict:
    host = server.get("HostConfig") or {}
    config = server.get("Config") or {}
    network = ((server.get("NetworkSettings") or {}).get("Networks") or {}).get(SERVER_NETWORK) or {}
    env_keys = sorted(value.split("=", 1)[0] for value in config.get("Env") or [] if "=" in value)
    return {
        "id": server.get("Id"),
        "imageId": server.get("Image"),
        "revision": image_revision(str(server.get("Image"))),
        "running": (server.get("State") or {}).get("Running"),
        "networkMode": host.get("NetworkMode"),
        "restartPolicy": (host.get("RestartPolicy") or {}).get("Name"),
        "stopTimeout": config.get("StopTimeout"),
        "ports": host.get("PortBindings"),
        "mounts": [
            {"type": item.get("Type"), "source": item.get("Source"),
             "destination": item.get("Destination"), "rw": item.get("RW")}
            for item in server.get("Mounts") or []
        ],
        "aliases": [value for value in network.get("Aliases") or [] if value == "server"],
        "cmd": config.get("Cmd"),
        "entrypoint": config.get("Entrypoint"),
        "user": config.get("User"),
        "envKeys": env_keys,
        "envCount": len(config.get("Env") or []),
    }


def validate_server_contract(server: dict) -> list[str]:
    errors: list[str] = []
    host = server.get("HostConfig") or {}
    config = server.get("Config") or {}
    networks = (server.get("NetworkSettings") or {}).get("Networks") or {}
    mounts = server.get("Mounts") or []
    expected_ports = {"13001/tcp": [{"HostIp": "", "HostPort": SERVER_PORT}]}
    if not (server.get("State") or {}).get("Running"):
        errors.append("server container is not running")
    if host.get("NetworkMode") != SERVER_NETWORK or set(networks) != {SERVER_NETWORK}:
        errors.append("server network contract is not daojie_net")
    if "server" not in (networks.get(SERVER_NETWORK) or {}).get("Aliases", []):
        errors.append("server network alias is missing")
    if host.get("PortBindings") != expected_ports:
        errors.append("server port contract is not 13001:13001")
    if (host.get("RestartPolicy") or {}).get("Name") != "unless-stopped":
        errors.append("server restart policy is not unless-stopped")
    if config.get("StopTimeout") != 30:
        errors.append("server stop timeout is not 30 seconds")
    if config.get("Cmd") != ["node", "dist/main.js"] or config.get("Entrypoint") != ["docker-entrypoint.sh"]:
        errors.append("server command or entrypoint is unexpected")
    if config.get("User") != "appuser":
        errors.append("server user is not appuser")
    if len(mounts) != 1 or mounts[0].get("Type") != "bind" or mounts[0].get("Source") != SERVER_DATA_SOURCE \
            or mounts[0].get("Destination") != SERVER_DATA_DESTINATION or mounts[0].get("RW") is not True:
        errors.append("server data mount contract is unexpected")
    for key, expected in (("Privileged", False), ("ReadonlyRootfs", False), ("AutoRemove", False),
                          ("Memory", 0), ("NanoCpus", 0)):
        if host.get(key) != expected:
            errors.append(f"server HostConfig.{key} is unexpected")
    for key in ("CapAdd", "SecurityOpt"):
        if host.get(key) not in (None, []):
            errors.append(f"server HostConfig.{key} is unexpected")
    env = config.get("Env") or []
    env_keys: set[str] = set()
    for value in env:
        if not isinstance(value, str) or "=" not in value or "\n" in value or "\x00" in value:
            errors.append("server environment contains an unsafe record")
            break
        key = value.split("=", 1)[0]
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) or key in env_keys:
            errors.append("server environment keys are invalid or duplicated")
            break
        env_keys.add(key)
    return errors


def existing_filesystem_anchor(path: Path) -> Path:
    current = path.resolve()
    while not current.exists() and current != current.parent:
        current = current.parent
    if not current.is_dir():
        raise ReleaseError(f"filesystem anchor is unavailable: {current}")
    return current


def build_capacity(remote_root: Path) -> dict:
    docker_anchor = existing_filesystem_anchor(Path("/var/lib/docker"))
    stage_anchor = existing_filesystem_anchor(remote_root)
    docker_available = shutil.disk_usage(docker_anchor).free
    stage_available = shutil.disk_usage(stage_anchor).free
    same_filesystem = os.stat(docker_anchor).st_dev == os.stat(stage_anchor).st_dev
    if same_filesystem:
        ready = min(docker_available, stage_available) >= MIN_SHARED_BUILD_FREE_BYTES
    else:
        ready = (docker_available >= MIN_DOCKER_BUILD_FREE_BYTES
                 and stage_available >= MIN_STAGE_FREE_BYTES)
    return {
        "ready": ready,
        "sameFilesystem": same_filesystem,
        "dockerAvailableBytes": docker_available,
        "stageAvailableBytes": stage_available,
        "sharedRequiredFreeBytes": MIN_SHARED_BUILD_FREE_BYTES if same_filesystem else None,
        "dockerRequiredFreeBytes": None if same_filesystem else MIN_DOCKER_BUILD_FREE_BYTES,
        "stageRequiredFreeBytes": None if same_filesystem else MIN_STAGE_FREE_BYTES,
    }


def require_build_capacity(remote_root: Path) -> dict:
    capacity = build_capacity(remote_root)
    if not capacity["ready"]:
        if capacity["sameFilesystem"]:
            detail = (f"require {capacity['sharedRequiredFreeBytes']} free bytes; "
                      f"have {capacity['dockerAvailableBytes']}")
        else:
            detail = (f"require Docker/staging free bytes {capacity['dockerRequiredFreeBytes']}/"
                      f"{capacity['stageRequiredFreeBytes']}; have "
                      f"{capacity['dockerAvailableBytes']}/{capacity['stageAvailableBytes']}")
        raise ReleaseError(f"insufficient server image build capacity: {detail}")
    return capacity


def sanitized_plan(remote_root: Path = Path(DEFAULT_REMOTE_ROOT)) -> dict:
    server = docker_inspect(SERVER_NAME)
    errors = validate_server_contract(server)
    capacity = build_capacity(remote_root)
    if not capacity["ready"]:
        errors.append("server image build capacity is below the required minimum")
    readiness_ready = True
    client_nginx_ready = True
    client_proxy_ready = True
    try:
        wait_ready(5)
    except ReleaseError as error:
        readiness_ready = False
        errors.append(str(error))
    try:
        verify_client_nginx_config()
    except ReleaseError as error:
        client_nginx_ready = False
        errors.append(str(error))
    try:
        wait_client_proxy(5)
    except ReleaseError as error:
        client_proxy_ready = False
        errors.append(str(error))
    return {
        "ok": True,
        "mode": "plan",
        "contractReady": not errors,
        "contractErrors": errors,
        "readinessReady": readiness_ready,
        "clientNginxConfigReady": client_nginx_ready,
        "clientProxySocketReady": client_proxy_ready,
        "buildCapacity": capacity,
        "server": safe_server_summary(server),
        "protectedContainerIds": container_ids(PROTECTED),
        "mutated": False,
    }


def parse_utc(value: object, label: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ReleaseError(f"{label} must be UTC ISO")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as error:
        raise ReleaseError(f"{label} is invalid") from error
    if parsed.tzinfo != timezone.utc:
        raise ReleaseError(f"{label} must be UTC")
    return parsed


def validate_scoped_report(report: dict, expected_commit: str) -> None:
    if (report.get("kind") != SCOPED_VERIFICATION_KIND
            or report.get("command") != SCOPED_VERIFICATION_COMMAND
            or report.get("commit") != expected_commit or report.get("exitCode") != 0
            or not HEX40.fullmatch(report.get("baseCommit") or "")):
        raise ReleaseError("scoped verification identity, commit, command or exit code is invalid")
    scope = report.get("changeScope")
    paths = scope.get("paths") if isinstance(scope, dict) else None
    if (not isinstance(scope, dict) or scope.get("baseCommit") != report["baseCommit"]
            or scope.get("commit") != expected_commit or not isinstance(paths, list) or not paths
            or paths != sorted(set(paths))):
        raise ReleaseError("scoped verification change scope is incomplete")
    for value in paths:
        pure = PurePosixPath(value) if isinstance(value, str) else PurePosixPath("/")
        if (not isinstance(value, str) or pure.is_absolute() or ".." in pure.parts
                or pure.as_posix() != value or "\\" in value):
            raise ReleaseError("scoped verification change scope path is unsafe")
    selected = report.get("selectedProofs")
    commands = report.get("commands")
    if (not isinstance(selected, list) or not selected or not isinstance(commands, list)
            or len(commands) != len(REQUIRED_SCOPED_COMMANDS) + len(selected)):
        raise ReleaseError("scoped verification proofs or command evidence is incomplete")
    for proof in selected:
        if (not isinstance(proof, dict) or proof.get("kind") != "script"
                or proof.get("input") != proof.get("path")
                or not isinstance(proof.get("path"), str)
                or not SAFE_PROOF_SCRIPT.fullmatch(proof["path"])):
            raise ReleaseError("scoped verification selected proof is outside the allowlist")
    report_started = parse_utc(report.get("startedAt"), "startedAt")
    report_completed = parse_utc(report.get("completedAt"), "completedAt")
    if report_started > report_completed:
        raise ReleaseError("scoped verification timestamps are reversed")
    for index, result in enumerate(commands):
        if (not isinstance(result, dict) or result.get("exitCode") != 0 or result.get("cwd") != "."
                or parse_utc(result.get("startedAt"), "command startedAt") < report_started
                or parse_utc(result.get("completedAt"), "command completedAt") > report_completed
                or parse_utc(result.get("startedAt"), "command startedAt")
                > parse_utc(result.get("completedAt"), "command completedAt")):
            raise ReleaseError("scoped verification command result is invalid")
        if index < len(REQUIRED_SCOPED_COMMANDS):
            label, executable, argv = REQUIRED_SCOPED_COMMANDS[index]
            if (result.get("label") != label or result.get("executable") != executable or result.get("argv") != argv):
                raise ReleaseError(f"scoped verification required command is invalid: {label}")
            continue
        proof = selected[index - len(REQUIRED_SCOPED_COMMANDS)]
        expected_argv = (["-B", "-X", "utf8", proof["path"]]
                         if proof["path"].endswith(".py") else [proof["path"]])
        expected_executable = "python" if proof["path"].endswith(".py") else "node"
        if (result.get("label") != f"proof:script:{proof['path']}"
                or result.get("executable") != expected_executable or result.get("argv") != expected_argv):
            raise ReleaseError("scoped verification proof command does not match selected proof")


def validate_full_evidence(report_path: Path, archive_path: Path, expected_commit: str) -> dict:
    if report_path.is_symlink() or archive_path.is_symlink() or not report_path.is_file() or not archive_path.is_file():
        raise ReleaseError("full verification report and source archive must be normal files")
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseError(f"invalid full verification report: {error}") from error
    if not isinstance(report, dict) or report.get("schemaVersion") != 1:
        raise ReleaseError("verification report schema is invalid")
    if report.get("kind") == FULL_VERIFICATION_KIND:
        if (report.get("commit") != expected_commit or report.get("command") != FULL_VERIFICATION_COMMAND
                or report.get("exitCode") != 0):
            raise ReleaseError("full verification identity, commit, command or exit code is invalid")
        if parse_utc(report.get("startedAt"), "startedAt") > parse_utc(report.get("completedAt"), "completedAt"):
            raise ReleaseError("full verification timestamps are reversed")
        gates = report.get("gates")
        if (not isinstance(gates, list) or len(gates) != len(FULL_GATES)
                or any(not isinstance(gate, dict) or gate.get("label") != FULL_GATES[index]
                       or gate.get("exitCode") != 0 for index, gate in enumerate(gates))):
            raise ReleaseError("full verification gate list is incomplete")
    elif report.get("kind") == SCOPED_VERIFICATION_KIND:
        validate_scoped_report(report, expected_commit)
    else:
        raise ReleaseError("verification report kind is unsupported")
    source = report.get("sourceArchive")
    archive_size = archive_path.stat().st_size
    archive_sha = sha256_file(archive_path)
    if (not isinstance(source, dict) or source.get("path") != archive_path.name
            or source.get("bytes") != archive_size or source.get("sha256") != archive_sha):
        raise ReleaseError("source archive does not match full verification report")
    return {"report": report, "kind": report["kind"], "archiveBytes": archive_size, "archiveSha256": archive_sha,
            "reportSha256": sha256_file(report_path)}


def safe_extract_tar(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=False)
    seen: set[str] = set()
    total = 0
    with tarfile.open(archive_path, "r:") as archive:
        for member in archive.getmembers():
            pure = PurePosixPath(member.name.rstrip("/"))
            if pure.is_absolute() or not pure.parts or any(part in ("", ".", "..") for part in pure.parts):
                raise ReleaseError(f"unsafe source archive path: {member.name}")
            name = pure.as_posix()
            if name in seen or member.issym() or member.islnk() or not (member.isdir() or member.isfile()):
                raise ReleaseError(f"unsafe source archive member: {member.name}")
            seen.add(name)
            target = destination.joinpath(*pure.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            total += member.size
            if total > 2 * 1024 * 1024 * 1024:
                raise ReleaseError("source archive expands beyond 2 GiB")
            target.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                raise ReleaseError(f"cannot read source archive member: {member.name}")
            with target.open("xb") as output:
                shutil.copyfileobj(source, output, 1024 * 1024)


def wait_ready(timeout: int) -> None:
    deadline = time.monotonic() + timeout
    last = ""
    while time.monotonic() < deadline:
        try:
            for url in READINESS_URLS:
                with urllib.request.urlopen(url, timeout=3) as response:
                    if response.status != 200:
                        raise ReleaseError(f"HTTP {response.status}: {url}")
                    body = json.loads(response.read().decode("utf-8"))
                    if not isinstance(body, dict) or body.get("ok") is not True:
                        raise ReleaseError(f"unhealthy readiness payload: {url}")
            with urllib.request.urlopen(SOCKET_PROBE_URL, timeout=3) as response:
                if not response.read(128).decode("utf-8", "replace").startswith("0{"):
                    raise ReleaseError("Socket.IO polling handshake is invalid")
            return
        except Exception as error:
            last = str(error)
            time.sleep(1)
    raise ReleaseError(f"server readiness timed out: {last}")


def verify_client_nginx_config() -> None:
    run_checked(["docker", "exec", CLIENT_NAME, "nginx", "-t"], timeout=15)


def wait_client_proxy(timeout: int) -> None:
    deadline = time.monotonic() + timeout
    last = ""
    while time.monotonic() < deadline:
        try:
            separator = "&" if "?" in CLIENT_SOCKET_PROBE_URL else "?"
            url = f"{CLIENT_SOCKET_PROBE_URL}{separator}t={time.time_ns()}"
            with urllib.request.urlopen(url, timeout=3) as response:
                if not response.read(128).decode("utf-8", "replace").startswith("0{"):
                    raise ReleaseError("client proxy Socket.IO polling handshake is invalid")
            return
        except Exception as error:
            last = str(error)
            time.sleep(1)
    raise ReleaseError(f"client proxy readiness timed out: {last}")


def reload_client_proxy(expected_client_id: str, timeout: int) -> None:
    if docker_inspect(CLIENT_NAME).get("Id") != expected_client_id:
        raise ReleaseError("client container identity changed before nginx reload")
    verify_client_nginx_config()
    run_checked(["docker", "exec", CLIENT_NAME, "nginx", "-s", "reload"], timeout=15)
    if docker_inspect(CLIENT_NAME).get("Id") != expected_client_id:
        raise ReleaseError("client container identity changed during nginx reload")
    wait_client_proxy(timeout)
    if docker_inspect(CLIENT_NAME).get("Id") != expected_client_id:
        raise ReleaseError("client container identity changed after proxy verification")


def verify_expected_ids(server_id: str, protected: dict[str, str]) -> tuple[dict, dict[str, str]]:
    server = docker_inspect(SERVER_NAME)
    if server.get("Id") != server_id:
        raise ReleaseError("server current CAS mismatch")
    actual = container_ids(PROTECTED)
    if actual != protected:
        raise ReleaseError("client/Postgres/Redis container identity mismatch")
    return server, actual


def write_env_snapshot(path: Path, server: dict) -> None:
    env = (server.get("Config") or {}).get("Env") or []
    path.write_text("\n".join(env) + "\n", encoding="utf-8", newline="\n")
    path.chmod(0o600)


def create_server_container(name: str, image: str, env_file: Path) -> str:
    run_checked([
        "docker", "create", "--name", name,
        "--restart", "unless-stopped", "--stop-timeout", "30",
        "--network", SERVER_NETWORK, "--network-alias", "server",
        "--publish", f"{SERVER_PORT}:{SERVER_PORT}",
        "--mount", f"type=bind,src={SERVER_DATA_SOURCE},dst={SERVER_DATA_DESTINATION}",
        "--env-file", str(env_file), image,
    ])
    return str(docker_inspect(name).get("Id"))


def preserve_failed_attempt(root: Path, attempt: Path, commit: str, phase: str, error: Exception) -> Path:
    atomic_json(attempt / "attempt-state.json", {
        "schemaVersion": 1,
        "kind": "daojie-coordinated-server-attempt",
        "commit": commit,
        "status": "failed",
        "phase": phase,
        "failedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "error": str(error),
    })
    failed = root / f".failed-{commit[:12]}-{int(time.time())}-{os.getpid()}"
    os.replace(attempt, failed)
    return failed


def publish_worker(args: argparse.Namespace) -> dict:
    if not HEX40.fullmatch(args.commit or ""):
        raise ReleaseError("publish requires a full 40-character commit")
    verification_report, _ = selected_verification(args)
    if verification_report is None or args.source_archive is None:
        raise ReleaseError("publish requires source archive and one verification report")
    stage_root = args.stage_root.resolve()
    for evidence_path in (verification_report.resolve(), args.source_archive.resolve()):
        if os.path.commonpath((str(stage_root), str(evidence_path))) != str(stage_root):
            raise ReleaseError("publish evidence is outside the bounded staging directory")
    evidence = validate_full_evidence(verification_report, args.source_archive, args.commit)
    expected_protected = expected_protected_from_args(args)
    old_server, _ = verify_expected_ids(args.expected_current_server, expected_protected)
    contract_errors = validate_server_contract(old_server)
    if contract_errors:
        raise ReleaseError("server contract is not reproducible: " + "; ".join(contract_errors))

    root = Path(args.remote_root).resolve()
    require_build_capacity(root)
    final_release_dir = root / args.commit
    if final_release_dir.exists():
        raise ReleaseError(f"release state already exists: {final_release_dir}")
    root.mkdir(parents=True, exist_ok=True)
    root.chmod(0o700)
    stamp = int(time.time())
    attempt_dir = root / f".attempt-{args.commit[:12]}-{stamp}-{os.getpid()}"
    attempt_dir.mkdir(mode=0o700)
    atomic_json(attempt_dir / "attempt-state.json", {
        "schemaVersion": 1, "kind": "daojie-coordinated-server-attempt",
        "commit": args.commit, "status": "preparing", "phase": "snapshot",
    })
    candidate = None
    phase = "snapshot"
    try:
        inspect_path = attempt_dir / "previous-server-inspect.json"
        env_path = attempt_dir / "previous-server.env"
        atomic_json(inspect_path, old_server)
        write_env_snapshot(env_path, old_server)
        inspect_sha = sha256_file(inspect_path)
        env_sha = sha256_file(env_path)

        phase = "source-extract"
        source_dir = args.stage_root / "source"
        safe_extract_tar(args.source_archive, source_dir)
        if not (source_dir / "packages/server/Dockerfile").is_file():
            raise ReleaseError("source archive does not contain packages/server/Dockerfile")
        image_tag = f"daojie-server:coordinated-{args.commit[:12]}"
        build_log = attempt_dir / "docker-build.log"
        phase = "image-build"
        with build_log.open("w", encoding="utf-8", newline="\n") as log:
            try:
                build = subprocess.run(
                    ["docker", "build", "--build-arg", f"BUILD_CACHEBUST={args.commit}",
                     "-f", "packages/server/Dockerfile", "-t", image_tag, "."],
                    cwd=source_dir, stdout=log, stderr=subprocess.STDOUT, text=True, check=False, timeout=1800,
                    env={**os.environ, "DOCKER_BUILDKIT": "1"},
                )
            except subprocess.TimeoutExpired as error:
                raise ReleaseError(f"server image build timed out; inspect {build_log}") from error
        build_log.chmod(0o600)
        if build.returncode != 0:
            raise ReleaseError(f"server image build failed; inspect {build_log}")
        new_image = str(docker_inspect(image_tag).get("Id"))
        validate_built_image(new_image, args.commit)

        old_image = str(old_server.get("Image"))
        rollback_tag = f"daojie-server:rollback-{args.commit[:12]}"
        run_checked(["docker", "image", "tag", old_image, rollback_tag])
        candidate = f"daojie-server-candidate-{args.commit[:12]}-{stamp}"
        backup = f"daojie-server-backup-{str(image_revision(old_image) or 'unknown')[:12]}-{stamp}"
        phase = "candidate-create"
        candidate_id = create_server_container(candidate, image_tag, env_path)

        phase = "pre-switch-cas"
        current_server, _ = verify_expected_ids(args.expected_current_server, expected_protected)
        if validate_server_contract(current_server):
            raise ReleaseError("server runtime contract drifted while building the candidate")
        atomic_json(attempt_dir / "attempt-state.json", {
            "schemaVersion": 1, "kind": "daojie-coordinated-server-attempt",
            "commit": args.commit, "status": "prepared", "phase": phase,
            "candidateContainerId": candidate_id, "expectedCurrentServerId": args.expected_current_server,
        })
        os.replace(attempt_dir, final_release_dir)
    except Exception as error:
        if candidate:
            subprocess.run(["docker", "rm", "-f", candidate], capture_output=True, check=False)
        failed_dir = preserve_failed_attempt(root, attempt_dir, args.commit, phase, error)
        raise ReleaseError(f"server preparation failed; retry is allowed after inspecting {failed_dir}: {error}") from error

    release_dir = final_release_dir
    old_stopped = False
    old_renamed = False
    candidate_renamed = False
    try:
        verify_client_nginx_config()
        current_server, _ = verify_expected_ids(args.expected_current_server, expected_protected)
        if validate_server_contract(current_server):
            raise ReleaseError("server runtime contract drifted immediately before stop")
        run_checked(["docker", "stop", "--time", "30", SERVER_NAME], timeout=60)
        old_stopped = True
        run_checked(["docker", "rename", SERVER_NAME, backup])
        old_renamed = True
        run_checked(["docker", "rename", candidate, SERVER_NAME])
        candidate_renamed = True
        run_checked(["docker", "start", SERVER_NAME])
        wait_ready(args.check_timeout)
        reload_client_proxy(expected_protected[CLIENT_NAME], args.check_timeout)
        current = docker_inspect(SERVER_NAME)
        if current.get("Id") != candidate_id or image_revision(str(current.get("Image"))) != args.commit:
            raise ReleaseError("started server identity or OCI revision is incorrect")
        if container_ids(PROTECTED) != expected_protected:
            raise ReleaseError("client/Postgres/Redis changed during server switch")
    except Exception as publish_error:
        if not old_stopped and not candidate_renamed:
            subprocess.run(["docker", "rm", "-f", candidate], capture_output=True, check=False)
        if candidate_renamed:
            subprocess.run(["docker", "stop", "--time", "10", SERVER_NAME], capture_output=True, check=False)
            subprocess.run(["docker", "rename", SERVER_NAME, candidate], capture_output=True, check=False)
        if old_renamed:
            run_checked(["docker", "rename", backup, SERVER_NAME])
            run_checked(["docker", "start", SERVER_NAME])
            wait_ready(args.check_timeout)
            reload_client_proxy(expected_protected[CLIENT_NAME], args.check_timeout)
        elif old_stopped:
            run_checked(["docker", "start", SERVER_NAME])
            wait_ready(args.check_timeout)
            reload_client_proxy(expected_protected[CLIENT_NAME], args.check_timeout)
        restored_server, _ = verify_expected_ids(args.expected_current_server, expected_protected)
        if not (restored_server.get("State") or {}).get("Running"):
            raise ReleaseError("automatic server rollback did not restore a running server")
        subprocess.run(["docker", "rm", "-f", candidate], capture_output=True, check=False)
        atomic_json(release_dir / "release-state.json", {
            "schemaVersion": 1, "kind": "daojie-coordinated-server-release",
            "commit": args.commit, "status": "rolled-back-on-publish-error",
            "candidateContainerName": candidate, "backupContainerName": backup,
            "error": str(publish_error),
        })
        failed_dir = root / f".failed-{args.commit[:12]}-{int(time.time())}-{os.getpid()}"
        os.replace(release_dir, failed_dir)
        raise ReleaseError(f"publish failed and the previous server was restored; retry is allowed after inspecting {failed_dir}: {publish_error}") from publish_error

    state = {
        "schemaVersion": 1,
        "kind": "daojie-coordinated-server-release",
        "commit": args.commit,
        "status": "active",
        "releasedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "previous": {"containerId": args.expected_current_server, "containerName": backup,
                     "imageId": old_image, "rollbackTag": rollback_tag,
                     "inspectSha256": inspect_sha, "envSha256": env_sha},
        "current": {"containerId": candidate_id, "imageId": new_image, "imageTag": image_tag,
                    "revision": args.commit},
        "protectedContainerIds": expected_protected,
        "evidence": {"sourceArchiveBytes": evidence["archiveBytes"],
                     "sourceArchiveSha256": evidence["archiveSha256"],
                     "verificationKind": evidence["kind"],
                     "verificationSha256": evidence["reportSha256"],
                     **({"fullVerificationSha256": evidence["reportSha256"]}
                        if evidence["kind"] == FULL_VERIFICATION_KIND else {})},
    }
    atomic_json(release_dir / "release-state.json", state)
    return {"ok": True, "mode": "publish", "commit": args.commit,
            "previousServerContainerId": args.expected_current_server,
            "currentServerContainerId": candidate_id, "currentServerImageId": new_image,
            "protectedContainerIds": expected_protected, "stateDir": str(release_dir)}


def rollback_worker(args: argparse.Namespace) -> dict:
    if not HEX40.fullmatch(args.commit or ""):
        raise ReleaseError("rollback requires the released full commit")
    expected_protected = expected_protected_from_args(args)
    release_dir = Path(args.remote_root).resolve() / args.commit
    state_path = release_dir / "release-state.json"
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseError(f"cannot read rollback state: {error}") from error
    if state.get("commit") != args.commit or state.get("kind") != "daojie-coordinated-server-release":
        raise ReleaseError("rollback state identity is invalid")
    current, _ = verify_expected_ids(args.expected_current_server, expected_protected)
    if current.get("Id") != (state.get("current") or {}).get("containerId"):
        raise ReleaseError("rollback current server does not match recorded release")
    previous = state.get("previous") or {}
    backup = previous.get("containerName")
    if not isinstance(backup, str) or not SAFE_ID.fullmatch(backup):
        raise ReleaseError("rollback backup container name is invalid")
    old = docker_inspect(backup)
    if old.get("Id") != previous.get("containerId") or old.get("Image") != previous.get("imageId"):
        raise ReleaseError("rollback backup container or image identity drifted")
    if sha256_file(release_dir / "previous-server-inspect.json") != previous.get("inspectSha256") \
            or sha256_file(release_dir / "previous-server.env") != previous.get("envSha256"):
        raise ReleaseError("rollback configuration snapshot integrity check failed")

    stamp = int(time.time())
    rolled_back = f"daojie-server-rolled-back-{args.commit[:12]}-{stamp}"
    new_stopped = False
    new_renamed = False
    old_renamed = False
    try:
        verify_client_nginx_config()
        current, _ = verify_expected_ids(args.expected_current_server, expected_protected)
        if validate_server_contract(current):
            raise ReleaseError("server runtime contract drifted immediately before rollback stop")
        run_checked(["docker", "stop", "--time", "30", SERVER_NAME], timeout=60)
        new_stopped = True
        run_checked(["docker", "rename", SERVER_NAME, rolled_back])
        new_renamed = True
        run_checked(["docker", "rename", backup, SERVER_NAME])
        old_renamed = True
        run_checked(["docker", "start", SERVER_NAME])
        wait_ready(args.check_timeout)
        reload_client_proxy(expected_protected[CLIENT_NAME], args.check_timeout)
        if docker_inspect(SERVER_NAME).get("Id") != previous.get("containerId"):
            raise ReleaseError("rollback did not restore the recorded server container")
        if container_ids(PROTECTED) != expected_protected:
            raise ReleaseError("client/Postgres/Redis changed during rollback")
    except Exception:
        if old_renamed:
            subprocess.run(["docker", "stop", "--time", "10", SERVER_NAME], capture_output=True, check=False)
            subprocess.run(["docker", "rename", SERVER_NAME, backup], capture_output=True, check=False)
        if new_renamed:
            run_checked(["docker", "rename", rolled_back, SERVER_NAME])
            run_checked(["docker", "start", SERVER_NAME])
            wait_ready(args.check_timeout)
            reload_client_proxy(expected_protected[CLIENT_NAME], args.check_timeout)
        elif new_stopped:
            run_checked(["docker", "start", SERVER_NAME])
            wait_ready(args.check_timeout)
            reload_client_proxy(expected_protected[CLIENT_NAME], args.check_timeout)
        raise
    state["rolledBackAt"] = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    state["rolledBackReleaseContainer"] = rolled_back
    atomic_json(state_path, state)
    return {"ok": True, "mode": "rollback", "commit": args.commit,
            "currentServerContainerId": previous.get("containerId"),
            "rolledBackReleaseContainer": rolled_back, "protectedContainerIds": expected_protected}


def expected_protected_from_args(args: argparse.Namespace) -> dict[str, str]:
    result = {
        "daojie-client": args.expected_client,
        "daojie-postgres": args.expected_postgres,
        "daojie-redis": args.expected_redis,
    }
    if any(not isinstance(value, str) or not HEX64.fullmatch(value) for value in result.values()):
        raise ReleaseError("execute requires exact 64-character protected container IDs")
    return result


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        match = re.fullmatch(r"\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*", line)
        if match:
            values[match.group(1)] = match.group(2).strip("\"'")
    if any(not values.get(key) for key in REQUIRED_ENV):
        raise ReleaseError("deployment env is missing LXC SSH settings")
    return values


class Remote:
    def __init__(self, env: dict[str, str], known_hosts: Path):
        try:
            import paramiko
        except ImportError as error:
            raise ReleaseError("paramiko is required for remote orchestration") from error
        self.secrets = list(env.values())
        self.client = paramiko.SSHClient()
        if not known_hosts.is_file():
            raise ReleaseError("--known-hosts must name a readable trust file")
        self.client.load_host_keys(str(known_hosts))
        self.client.set_missing_host_key_policy(paramiko.RejectPolicy())
        self.client.connect(env["LXC_HOST"], username=env["LXC_SSH_USER"], password=env["LXC_SSH_PASSWORD"],
                            timeout=20, look_for_keys=False, allow_agent=False)
        self.sftp = self.client.open_sftp()

    def close(self) -> None:
        self.sftp.close()
        self.client.close()

    def run(self, command: str, timeout: int = 2400) -> str:
        _stdin, stdout, stderr = self.client.exec_command(command, timeout=timeout)
        output = stdout.read().decode("utf-8", "replace")
        error = stderr.read().decode("utf-8", "replace")
        status_code = stdout.channel.recv_exit_status()
        if status_code != 0:
            detail = error or output
            for secret in sorted((value for value in self.secrets if value), key=len, reverse=True):
                detail = detail.replace(secret, "[REDACTED]")
            raise ReleaseError(detail[-4000:].strip())
        return output

    def mkdirs(self, path: str) -> None:
        current = "/"
        for part in PurePosixPath(path).parts[1:]:
            current = f"{current.rstrip('/')}/{part}"
            try:
                mode = self.sftp.lstat(current).st_mode
                if not stat.S_ISDIR(mode):
                    raise ReleaseError(f"remote path is not a directory: {current}")
            except FileNotFoundError:
                self.sftp.mkdir(current, mode=0o700)

    def put(self, source: Path, destination: str, mode: int) -> None:
        self.mkdirs(str(PurePosixPath(destination).parent))
        temporary = f"{destination}.{os.getpid()}.tmp"
        self.sftp.put(str(source), temporary)
        self.sftp.chmod(temporary, mode)
        self.sftp.rename(temporary, destination)

    def remove_tree(self, root: str, allowed_root: str) -> None:
        if not root.startswith(allowed_root.rstrip("/") + "/"):
            raise ReleaseError("refusing to clean outside remote staging root")
        try:
            entries = self.sftp.listdir_attr(root)
        except FileNotFoundError:
            return
        for entry in entries:
            child = f"{root.rstrip('/')}/{entry.filename}"
            if stat.S_ISDIR(entry.st_mode):
                self.remove_tree(child, allowed_root)
            elif stat.S_ISREG(entry.st_mode) or stat.S_ISLNK(entry.st_mode):
                self.sftp.remove(child)
            else:
                raise ReleaseError(f"unexpected remote staging entry: {child}")
        self.sftp.rmdir(root)


def validate_canonical_archive(repo_root: Path, archive: Path, report: Path, commit: str) -> dict:
    evidence = validate_full_evidence(report, archive, commit)
    temporary_root = repo_root.resolve() / ".runtime" / "releases"
    temporary_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="daojie-server-canonical-", dir=temporary_root) as temporary:
        canonical = Path(temporary) / "source.tar"
        result = subprocess.run(["git", "archive", "--format=tar", "--output", str(canonical), commit],
                                cwd=repo_root, text=True, capture_output=True, check=False)
        if result.returncode != 0:
            raise ReleaseError(f"cannot produce canonical git archive: {result.stderr.strip()}")
        if canonical.stat().st_size != evidence["archiveBytes"] or sha256_file(canonical) != evidence["archiveSha256"]:
            raise ReleaseError("source archive is not the canonical git archive for the requested commit")
    if evidence["kind"] == SCOPED_VERIFICATION_KIND:
        scope = evidence["report"]["changeScope"]
        result = subprocess.run(
            ["git", "diff", "--name-only", "-z", scope["baseCommit"], commit, "--"],
            cwd=repo_root, capture_output=True, check=False,
        )
        if result.returncode != 0:
            raise ReleaseError("cannot reproduce scoped verification change scope")
        try:
            actual_paths = sorted(value for value in result.stdout.decode("utf-8", "strict").split("\0") if value)
        except UnicodeDecodeError as error:
            raise ReleaseError("scoped verification change scope is not UTF-8") from error
        if actual_paths != scope["paths"]:
            raise ReleaseError("scoped verification change scope does not match base..commit")
    return evidence


def selected_verification(args: argparse.Namespace) -> tuple[Path | None, str | None]:
    supplied = [(args.full_verification, "--full-verification"),
                (args.scoped_verification, "--scoped-verification")]
    selected = [(path, option) for path, option in supplied if path is not None]
    if len(selected) > 1:
        raise ReleaseError("full and scoped verification reports are mutually exclusive")
    return selected[0] if selected else (None, None)


def inline_worker_command(worker_args: list[str]) -> str:
    source = Path(__file__).read_bytes()
    encoded = base64.b64encode(source).decode("ascii")
    launcher = f'import base64;exec(compile(base64.b64decode("{encoded}"),"coordinated-server-release.py","exec"))'
    return " ".join(shlex.quote(value) for value in (["python3", "-c", launcher, "--worker"] + worker_args))


def worker_args_for_execute(args: argparse.Namespace, remote_stage: str) -> list[str]:
    values = [
        "--mode", args.mode, "--commit", args.commit,
        "--expected-current-server", args.expected_current_server,
        "--expected-client", args.expected_client,
        "--expected-postgres", args.expected_postgres,
        "--expected-redis", args.expected_redis,
        "--check-timeout", str(args.check_timeout),
        "--remote-root", args.remote_root,
        "--stage-root", remote_stage,
    ]
    if args.mode == "publish":
        report, option = selected_verification(args)
        values.extend(("--source-archive", f"{remote_stage}/{args.source_archive.name}",
                       option, f"{remote_stage}/{report.name}"))
    return values


def orchestrate(args: argparse.Namespace) -> int:
    if args.check_timeout < 1 or args.check_timeout > 120:
        raise ReleaseError("--check-timeout must be between 1 and 120")
    if not re.fullmatch(r"/[A-Za-z0-9._/-]+", args.remote_root) or ".." in PurePosixPath(args.remote_root).parts:
        raise ReleaseError("--remote-root is unsafe")
    local_evidence = None
    verification_report, _ = selected_verification(args)
    if args.mode == "publish" and not args.execute:
        supplied = (args.commit, args.source_archive, verification_report)
        if any(supplied) and not all(supplied):
            raise ReleaseError("publish plan evidence requires commit, source archive and one verification report together")
        if all(supplied):
            if not HEX40.fullmatch(args.commit):
                raise ReleaseError("publish plan requires a full 40-character commit")
            local_evidence = validate_canonical_archive(
                Path(__file__).resolve().parents[1], args.source_archive.resolve(),
                verification_report.resolve(), args.commit,
            )
    env = load_env(args.env_file.resolve())
    remote = Remote(env, args.known_hosts.resolve())
    try:
        if args.mode == "plan" or not args.execute:
            live_plan = json.loads(remote.run(inline_worker_command([
                "--mode", "plan", "--remote-root", args.remote_root,
            ])))
            live_plan.update({"requestedMode": args.mode, "effectiveMode": "plan"})
            if local_evidence:
                live_plan["targetCommit"] = args.commit
                live_plan["evidence"] = {
                    "valid": True,
                    "sourceArchiveBytes": local_evidence["archiveBytes"],
                    "sourceArchiveSha256": local_evidence["archiveSha256"],
                    "verificationKind": local_evidence["kind"],
                    "verificationSha256": local_evidence["reportSha256"],
                    **({"fullVerificationSha256": local_evidence["reportSha256"]}
                       if local_evidence["kind"] == FULL_VERIFICATION_KIND else {}),
                }
            print(json.dumps(live_plan, ensure_ascii=False, sort_keys=True))
            return 0
        if args.mode not in ("publish", "rollback"):
            raise ReleaseError("--execute supports only publish or rollback")
        required_ids = (args.expected_current_server, args.expected_client, args.expected_postgres, args.expected_redis)
        if any(not HEX64.fullmatch(value or "") for value in required_ids):
            raise ReleaseError("execute requires exact current and protected container IDs")
        if not HEX40.fullmatch(args.commit or ""):
            raise ReleaseError("execute requires --commit with a full 40-character SHA")
        if args.mode == "publish":
            if not args.source_archive or not verification_report:
                raise ReleaseError("publish requires --source-archive and one verification report")
            validate_canonical_archive(Path(__file__).resolve().parents[1], args.source_archive.resolve(),
                                       verification_report.resolve(), args.commit)
            if not SAFE_ID.fullmatch(args.source_archive.name) or not SAFE_ID.fullmatch(verification_report.name):
                raise ReleaseError("evidence filenames contain unsafe characters")

        staging_root = f"{args.remote_root.rstrip('/')}/.staging"
        remote_stage = f"{staging_root}/{args.mode}-{args.commit[:12]}-{os.getpid()}-{int(time.time())}"
        remote.mkdirs(remote_stage)
        worker_remote = f"{remote_stage}/coordinated-server-release.py"
        remote.put(Path(__file__).resolve(), worker_remote, 0o700)
        if args.mode == "publish":
            remote.put(args.source_archive.resolve(), f"{remote_stage}/{args.source_archive.name}", 0o600)
            remote.put(verification_report.resolve(), f"{remote_stage}/{verification_report.name}", 0o600)
        try:
            command = " ".join(shlex.quote(value) for value in (
                ["python3", worker_remote, "--worker"] + worker_args_for_execute(args, remote_stage)
            ))
            output = remote.run(command)
            print(output.strip())
        finally:
            remote.remove_tree(remote_stage, staging_root)
        return 0
    finally:
        remote.close()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--mode", choices=("plan", "publish", "rollback"), default="plan")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--known-hosts", type=Path)
    parser.add_argument("--commit")
    parser.add_argument("--source-archive", type=Path)
    parser.add_argument("--full-verification", type=Path)
    parser.add_argument("--scoped-verification", type=Path)
    parser.add_argument("--expected-current-server")
    parser.add_argument("--expected-client")
    parser.add_argument("--expected-postgres")
    parser.add_argument("--expected-redis")
    parser.add_argument("--check-timeout", type=int, default=30)
    parser.add_argument("--remote-root", default=DEFAULT_REMOTE_ROOT)
    parser.add_argument("--stage-root", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if args.worker:
        if args.mode == "plan":
            print(json.dumps(sanitized_plan(Path(args.remote_root)), ensure_ascii=False, sort_keys=True))
            return 0
        staging_parent = (Path(args.remote_root) / ".staging").resolve()
        resolved_stage = args.stage_root.resolve() if args.stage_root else None
        if (not resolved_stage
                or os.path.commonpath((str(staging_parent), str(resolved_stage))) != str(staging_parent)
                or resolved_stage == staging_parent):
            raise ReleaseError("worker stage root is outside the coordinated staging directory")
        result = publish_worker(args) if args.mode == "publish" else rollback_worker(args)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    if not args.env_file or not args.known_hosts:
        raise ReleaseError("local orchestration requires --env-file and --known-hosts")
    return orchestrate(args)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ReleaseError, OSError, json.JSONDecodeError, tarfile.TarError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
