#!/usr/bin/env python3
"""Validate, diff and publish a prepared client bundle over SSH/SFTP.

Without --execute every requested mode is reduced to a read-only plan.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import shlex
import stat
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

try:
    import paramiko
except ImportError:  # local filesystem tests do not need the SSH dependency
    paramiko = None

from remote_apply import EXPECTED_NGINX_TEMPLATES, ReleaseError, load_receipt, normalize_relative, sha256_file, validate_receipt


ENVELOPE_KIND = "daojie-client-release-envelope"
REQUIRED_ENV = ("LXC_HOST", "LXC_SSH_USER", "LXC_SSH_PASSWORD")
SAFE_REMOTE_ROOT = re.compile(r"^/[A-Za-z0-9._/-]+$")


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError as error:
        raise ReleaseError(f"cannot read env file: {error}") from error
    for line in lines:
        match = re.fullmatch(r"\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*", line)
        if match:
            values[match.group(1)] = match.group(2).strip("\"'")
    if any(not values.get(key) for key in REQUIRED_ENV):
        raise ReleaseError("deployment env is missing LXC SSH settings")
    return values


def redact(text: str, secrets: list[str]) -> str:
    for secret in sorted((value for value in secrets if value), key=len, reverse=True):
        text = text.replace(secret, "[REDACTED]")
    return text


def verify_record(path: Path, record: dict) -> None:
    if not path.is_file() or path.is_symlink() or path.stat().st_size != record["bytes"] or sha256_file(path) != record["sha256"]:
        raise ReleaseError(f"bundle hash mismatch: {record['path']}")


def validate_bundle(bundle: Path, extract_root: Path) -> tuple[dict, Path]:
    if bundle.is_symlink() or not bundle.is_dir():
        raise ReleaseError("--bundle must be a normal directory")
    envelope_path = bundle / "bundle-envelope.json"
    receipt_path = bundle / "receipt.json"
    try:
        envelope = json.loads(envelope_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseError(f"invalid bundle envelope: {error}") from error
    receipt = load_receipt(receipt_path)
    if (not isinstance(envelope, dict) or envelope.get("schemaVersion") != receipt["schemaVersion"]
            or envelope.get("kind") != ENVELOPE_KIND or envelope.get("artifactVersion") != receipt["artifactVersion"]):
        raise ReleaseError("bundle envelope identity mismatch")
    receipt_record = envelope.get("receipt") or {}
    archive_record = envelope.get("archive") or {}
    if receipt_record.get("path") != "receipt.json":
        raise ReleaseError("bundle receipt path is not canonical")
    verify_record(receipt_path, receipt_record)
    archive_name = normalize_relative(archive_record.get("path"))
    if PurePosixPath(archive_name).parent != PurePosixPath("."):
        raise ReleaseError("bundle archive must be beside its envelope")
    archive_path = bundle / archive_name
    verify_record(archive_path, archive_record)

    expected_files = {item["path"]: item for item in receipt["files"]}
    expected_members = set(expected_files) | {"receipt.json"}
    seen: set[str] = set()
    extract_root.mkdir(parents=True, exist_ok=False)
    with tarfile.open(archive_path, "r:") as archive:
        for member in archive.getmembers():
            name = normalize_relative(member.name.rstrip("/"))
            if member.isdir():
                continue
            if not member.isfile() or member.issym() or member.islnk() or name not in expected_members or name in seen:
                raise ReleaseError(f"unsafe or unexpected tar member: {member.name}")
            seen.add(name)
            target = extract_root.joinpath(*PurePosixPath(name).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                raise ReleaseError(f"cannot extract tar member: {name}")
            with target.open("xb") as output:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
    if seen != expected_members:
        raise ReleaseError(f"tar member scope mismatch: missing={sorted(expected_members-seen)}")
    if (extract_root / "receipt.json").read_bytes() != receipt_path.read_bytes():
        raise ReleaseError("inner and outer receipt bytes differ")
    for record in receipt["files"]:
        verify_record(extract_root.joinpath(*PurePosixPath(record["path"]).parts), record)
    return receipt, extract_root


class Remote:
    def __init__(self, env: dict[str, str], known_hosts: Path):
        if paramiko is None:
            raise ReleaseError("paramiko is required for SSH/SFTP execution")
        self.secrets = list(env.values())
        self.client = paramiko.SSHClient()
        if not known_hosts.is_file():
            raise ReleaseError("--known-hosts must name a readable known_hosts file")
        try:
            self.client.load_host_keys(str(known_hosts))
            self.client.set_missing_host_key_policy(paramiko.RejectPolicy())
            self.client.connect(
                env["LXC_HOST"],
                username=env["LXC_SSH_USER"],
                password=env["LXC_SSH_PASSWORD"],
                timeout=20,
                look_for_keys=False,
                allow_agent=False,
            )
            self.sftp = self.client.open_sftp()
        except Exception as error:
            self.client.close()
            raise ReleaseError("SSH host key verification or connection failed") from error

    def close(self) -> None:
        self.sftp.close()
        self.client.close()

    def run(self, command: str, timeout: int = 900) -> str:
        _stdin, stdout, stderr = self.client.exec_command(command, timeout=timeout)
        output = stdout.read().decode("utf-8", "replace")
        error = stderr.read().decode("utf-8", "replace")
        status_code = stdout.channel.recv_exit_status()
        if status_code != 0:
            raise ReleaseError(redact((error or output)[-4000:], self.secrets))
        return redact(output, self.secrets)

    def exists(self, path: str) -> bool:
        try:
            self.sftp.lstat(path)
            return True
        except FileNotFoundError:
            return False

    def mkdirs(self, path: str) -> None:
        current = "/"
        for part in PurePosixPath(path).parts[1:]:
            current = posixpath.join(current, part)
            try:
                mode = self.sftp.lstat(current).st_mode
                if not stat.S_ISDIR(mode):
                    raise ReleaseError(f"remote path is not a directory: {current}")
            except FileNotFoundError:
                self.sftp.mkdir(current, mode=0o700)

    def read_json(self, path: str) -> dict:
        with self.sftp.file(path, "r") as stream:
            return json.loads(stream.read().decode("utf-8"))

    def put(self, source: Path, destination: str, mode: int = 0o600) -> None:
        self.mkdirs(posixpath.dirname(destination))
        temporary = f"{destination}.{os.getpid()}.tmp"
        self.sftp.put(str(source), temporary)
        self.sftp.chmod(temporary, mode)
        self.sftp.rename(temporary, destination)

    def remove_tree(self, root: str, allowed_upload_root: str) -> None:
        expected_prefix = posixpath.join(allowed_upload_root, "")
        if not root.startswith(expected_prefix) or root == allowed_upload_root:
            raise ReleaseError("refusing to remove a remote path outside upload staging")
        try:
            entries = self.sftp.listdir_attr(root)
        except FileNotFoundError:
            return
        for entry in entries:
            child = posixpath.join(root, entry.filename)
            if stat.S_ISDIR(entry.st_mode):
                self.remove_tree(child, allowed_upload_root)
            elif stat.S_ISREG(entry.st_mode) or stat.S_ISLNK(entry.st_mode):
                # listdir_attr uses lstat metadata.  Remove only this entry in
                # the bounded staging tree; never resolve or recurse through a link.
                self.sftp.remove(child)
            else:
                raise ReleaseError(f"unexpected remote staging file type: {child}")
        self.sftp.rmdir(root)


def remote_current(remote: Remote, site_root: str) -> tuple[str | None, dict | None, dict | None]:
    state_path = posixpath.join(site_root, ".release-state.json")
    current_path = posixpath.join(site_root, "current")
    if not remote.exists(state_path):
        return None, None, None
    state = remote.read_json(state_path)
    raw = remote.sftp.readlink(current_path).replace("\\", "/")
    match = re.fullmatch(r"releases/([A-Za-z0-9._-]{1,160})/site", raw)
    if not match:
        raise ReleaseError(f"unsafe remote current symlink: {raw}")
    artifact = match.group(1)
    receipt = validate_receipt(remote.read_json(posixpath.join(site_root, "releases", artifact, "receipt.json")))
    return artifact, receipt, state


def diff_receipts(current: dict | None, upcoming: dict) -> dict:
    before = {item["path"]: item for item in ((current or {}).get("dist") or {}).get("files", [])}
    after = {item["path"]: item for item in upcoming["dist"]["files"]}
    changed = sorted(path for path, item in after.items()
                     if path not in before or before[path].get("sha256") != item["sha256"] or before[path].get("bytes") != item["bytes"])
    removed = sorted(set(before) - set(after))
    return {"changed": changed, "removed": removed}


def upload_apply_tool(remote: Remote, site_root: str) -> str:
    source = Path(__file__).with_name("remote_apply.py")
    digest = sha256_file(source)
    destination = posixpath.join(site_root, ".tools", f"remote_apply-{digest}.py")
    if not remote.exists(destination):
        remote.put(source, destination, mode=0o700)
    return destination


def upload_release(remote: Remote, site_root: str, receipt: dict, extracted: Path,
                   changed: list[str], include_nginx: bool) -> tuple[str, str]:
    upload_root = posixpath.join(site_root, ".uploads", f"{receipt['artifactVersion']}-{os.getpid()}-{int(os.times().elapsed * 1000)}")
    payload_root = posixpath.join(upload_root, "payload")
    remote.mkdirs(payload_root)
    remote.put(extracted / "receipt.json", posixpath.join(upload_root, "receipt.json"))
    for archive_path in changed:
        remote.put(extracted.joinpath(*PurePosixPath(archive_path).parts), posixpath.join(payload_root, archive_path))
    if include_nginx:
        for archive_path in sorted(EXPECTED_NGINX_TEMPLATES):
            remote.put(extracted.joinpath(*PurePosixPath(archive_path).parts), posixpath.join(payload_root, archive_path))
    return upload_root, payload_root


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("plan", "bootstrap", "publish", "rollback"), default="plan")
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--known-hosts", type=Path,
                        help="explicit known_hosts trust file; required for every SSH plan or execution")
    parser.add_argument("--site-root", default="/opt/daojie/client-site")
    parser.add_argument("--expected-current")
    parser.add_argument("--target")
    parser.add_argument("--expected-image")
    parser.add_argument("--adopt-commit")
    parser.add_argument("--check-timeout", type=int, default=30)
    parser.add_argument("--execute", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if not SAFE_REMOTE_ROOT.fullmatch(args.site_root) or ".." in PurePosixPath(args.site_root).parts:
        raise ReleaseError("unsafe --site-root")
    if args.check_timeout < 1 or args.check_timeout > 120:
        raise ReleaseError("--check-timeout must be between 1 and 120")
    if args.mode != "rollback" and not args.bundle:
        raise ReleaseError("plan/bootstrap/publish require --bundle")
    if args.execute and not args.env_file:
        raise ReleaseError("--execute requires --env-file")
    if args.env_file and not args.known_hosts:
        raise ReleaseError("--env-file requires --known-hosts")

    requested_mode = args.mode
    effective_mode = requested_mode if args.execute else "plan"
    with tempfile.TemporaryDirectory(prefix="daojie-client-bundle-") as temporary:
        receipt = None
        extracted = None
        if args.bundle:
            receipt, extracted = validate_bundle(args.bundle.resolve(), Path(temporary) / "bundle")
        remote = Remote(load_env(args.env_file.resolve()), args.known_hosts.resolve()) if args.env_file else None
        try:
            artifact, current_receipt, state = remote_current(remote, args.site_root) if remote else (None, None, None)
            if receipt:
                delta = diff_receipts(current_receipt, receipt)
                template_hashes = {item["path"]: item["sha256"] for item in receipt["nginxTemplates"]}
                config_matches = state is None or state.get("sourceNginxTemplateHashes") == template_hashes
                plan = {"requestedMode": requested_mode, "effectiveMode": effective_mode,
                        "artifactVersion": receipt["artifactVersion"], "current": artifact,
                        "classification": receipt["classification"],
                        "coordinatedServerCommit": ((receipt.get("coordinatedFull") or {}).get("serverCommit")),
                        "changedFiles": len(delta["changed"]), "removedFiles": len(delta["removed"]),
                        "changed": delta["changed"], "nginxConfigContractMatches": config_matches}
            else:
                plan = {"requestedMode": requested_mode, "effectiveMode": effective_mode,
                        "current": artifact, "target": args.target}
            if effective_mode == "plan":
                print(json.dumps({"ok": True, **plan}, ensure_ascii=False, indent=2, sort_keys=True))
                return 0
            if remote is None:
                raise ReleaseError("remote connection is unavailable")
            if requested_mode == "publish":
                if not receipt or not extracted or not artifact or not current_receipt:
                    raise ReleaseError("publish requires a bootstrapped current release")
                if args.expected_current != artifact:
                    raise ReleaseError("--expected-current does not match remote current")
                if receipt["baseCommit"] != current_receipt.get("commit"):
                    raise ReleaseError("bundle baseCommit does not match current receipt commit")
                if not plan["nginxConfigContractMatches"]:
                    raise ReleaseError("nginx template contract changed; run bootstrap")
                changed = delta["changed"]
            elif requested_mode == "bootstrap":
                if artifact is not None:
                    raise ReleaseError("bootstrap refused because hot static state already exists")
                if not args.expected_image or not args.adopt_commit:
                    raise ReleaseError("bootstrap requires --expected-image and --adopt-commit")
                if receipt["baseCommit"] != args.adopt_commit:
                    raise ReleaseError("bundle baseCommit must equal --adopt-commit")
                changed = [item["path"] for item in receipt["dist"]["files"]]
            else:
                if not artifact or args.expected_current != artifact or not args.target:
                    raise ReleaseError("rollback requires exact --expected-current and --target")
                tool = upload_apply_tool(remote, args.site_root)
                command = ["python3", tool, "--mode", "rollback", "--site-root", args.site_root,
                           "--expected-current", args.expected_current, "--target", args.target,
                           "--check-timeout", str(args.check_timeout)]
                output = remote.run(" ".join(shlex.quote(value) for value in command))
                print(output)
                return 0

            upload_root, payload_root = upload_release(remote, args.site_root, receipt, extracted, changed,
                                                       include_nginx=requested_mode == "bootstrap")
            try:
                tool = upload_apply_tool(remote, args.site_root)
                command = ["python3", tool, "--mode", requested_mode, "--site-root", args.site_root,
                           "--receipt", posixpath.join(upload_root, "receipt.json"),
                           "--payload-dir", payload_root, "--check-timeout", str(args.check_timeout)]
                if requested_mode == "publish":
                    command.extend(("--expected-current", args.expected_current))
                else:
                    command.extend(("--expected-image", args.expected_image, "--adopt-commit", args.adopt_commit))
                output = remote.run(" ".join(shlex.quote(value) for value in command), timeout=1800)
                print(output)
            finally:
                remote.remove_tree(upload_root, posixpath.join(args.site_root, ".uploads"))
            return 0
        finally:
            if remote:
                remote.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ReleaseError, OSError, json.JSONDecodeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
