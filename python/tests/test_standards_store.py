"""标准 release CAS、active 指针、撤回与项目完整 pin 的安全回归。"""

from __future__ import annotations

import base64
import copy
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from oak_manuscript_core import ops
from oak_manuscript_core.errors import OakError, StructuredOakError
from oak_manuscript_core.project import Project
from oak_manuscript_core.rulepack import load_rulepack
from oak_manuscript_core.standards_store import (
    EXPECTED_IDENTITY_ENV,
    _parse_semver,
    resolve_active_release,
    resolve_project_rulepack,
)

REPO = Path(__file__).resolve().parents[2]
SAMPLE = REPO / "samples" / "paper_needs_review.docx"


def _rmtree_force(path: Path) -> None:
    for root, _dirs, files in os.walk(path):
        for filename in files:
            try:
                os.chmod(Path(root) / filename, stat.S_IWRITE)
            except OSError:
                pass
    shutil.rmtree(path, ignore_errors=True)


def _json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode(
        "utf-8"
    )


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


class StandardStoreFixture:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.resources = root / "resources"
        self.config = self.resources / "config"
        self.store = root / "store"
        (self.config / "rule-packs").mkdir(parents=True)
        (self.config / "standard-packs").mkdir()
        shutil.copy2(REPO / "config" / "standards.json", self.config / "standards.json")
        shutil.copy2(REPO / "config" / "rule-capabilities.json", self.config / "rule-capabilities.json")
        shutil.copy2(
            REPO / "config" / "rule-packs" / "oak-rules-1.0.0.json",
            self.config / "rule-packs" / "oak-rules-1.0.0.json",
        )
        shutil.copy2(
            REPO / "config" / "standard-packs" / "oak-standards-1.0.0.manifest.json",
            self.config / "standard-packs" / "oak-standards-1.0.0.manifest.json",
        )
        (self.store / "packages").mkdir(parents=True)

    def bundled(self):
        return resolve_active_release(resources_root=self.resources)

    def install_version(
        self,
        version: str = "1.0.1",
        *,
        release_sequence: int = 2,
        mutate_payloads=None,
        released_at: str = "2026-07-27T01:00:00Z",
        expires_at: str | None = None,
        min_app: str = "0.1.0-alpha.2",
        max_app_exclusive: str = "0.2.0",
    ) -> tuple[dict, str, Path]:
        standards = json.loads((self.config / "standards.json").read_text(encoding="utf-8"))
        standards["registry_version"] = version

        pack = json.loads(
            (self.config / "rule-packs" / "oak-rules-1.0.0.json").read_text(encoding="utf-8")
        )
        pack["pack_version"] = version
        if mutate_payloads is not None:
            mutate_payloads(standards, pack)
        standards_raw = _json_bytes(standards)
        pack_raw = _json_bytes(pack)
        capability_sha = _sha((self.config / "rule-capabilities.json").read_bytes())
        manifest = {
            "schema_version": "1.0",
            "kind": "oak-standard-release",
            "bundle_id": "oak-standards",
            "release_sequence": release_sequence,
            "version": version,
            "channel": "stable",
            "released_at": released_at,
            "expires_at": expires_at,
            "min_app": min_app,
            "max_app_exclusive": max_app_exclusive,
            "signing_role": "release",
            "files": [
                {
                    "path": "standards.json",
                    "size_bytes": len(standards_raw),
                    "sha256": _sha(standards_raw),
                    "media_type": "application/json",
                },
                {
                    "path": "rulepack.json",
                    "size_bytes": len(pack_raw),
                    "sha256": _sha(pack_raw),
                    "media_type": "application/json",
                },
            ],
            "rulepack": {
                "name": "oak-rules",
                "version": version,
                "sha256": _sha(pack_raw),
                "capability_set_sha256": capability_sha,
            },
            "rollback_target": None,
            "change_summary": ["测试安装版本"],
        }
        manifest_raw = _json_bytes(manifest)
        manifest_sha = _sha(manifest_raw)
        package = self.store / "packages" / manifest_sha
        package.mkdir()
        (package / "manifest.json").write_bytes(manifest_raw)
        (package / "standards.json").write_bytes(standards_raw)
        (package / "rulepack.json").write_bytes(pack_raw)
        envelope = {
            "schema_version": "1.0",
            "kind": "oak-standards-envelope",
            "manifest_b64": _b64(manifest_raw),
            "signatures": [
                {
                    "keyid": "a" * 64,
                    "alg": "ed25519",
                    "sig_b64": _b64(b"\x00" * 64),
                }
            ],
            "files": [
                {"path": "standards.json", "payload_b64": _b64(standards_raw)},
                {"path": "rulepack.json", "payload_b64": _b64(pack_raw)},
            ],
        }
        (package / "release.envelope.json").write_bytes(_json_bytes(envelope))
        return manifest, manifest_sha, package

    def cache_current_bundled(self) -> tuple[dict, str, Path]:
        manifest_path = next((self.config / "standard-packs").glob("*.manifest.json"))
        manifest_raw = manifest_path.read_bytes()
        manifest = json.loads(manifest_raw.decode("utf-8"))
        standards_raw = (self.config / "standards.json").read_bytes()
        pack_candidates = list((self.config / "rule-packs").glob("*.json"))
        pack_raw = next(
            raw
            for raw in (path.read_bytes() for path in pack_candidates)
            if _sha(raw) == manifest["rulepack"]["sha256"]
        )
        manifest_sha = _sha(manifest_raw)
        package = self.store / "packages" / manifest_sha
        package.mkdir()
        (package / "manifest.json").write_bytes(manifest_raw)
        (package / "standards.json").write_bytes(standards_raw)
        (package / "rulepack.json").write_bytes(pack_raw)
        envelope = {
            "schema_version": "1.0",
            "kind": "oak-standards-bundled-envelope",
            "manifest_b64": _b64(manifest_raw),
            "files": [
                {"path": "standards.json", "payload_b64": _b64(standards_raw)},
                {"path": "rulepack.json", "payload_b64": _b64(pack_raw)},
            ],
        }
        (package / "release.envelope.json").write_bytes(_json_bytes(envelope))
        return manifest, manifest_sha, package

    def activate(
        self,
        *,
        bundle_id: str,
        release_sequence: int,
        version: str,
        manifest_sha256: str,
        source: str,
        revoked: list[str] | None = None,
    ) -> None:
        active = {
            "bundle_id": bundle_id,
            "release_sequence": release_sequence,
            "version": version,
            "manifest_sha256": manifest_sha256,
            "source": source,
        }
        state = {
            "schema_version": "1.0",
            "active": active,
            "previous": None,
            "highest_seen_sequence": release_sequence,
            "revoked_manifest_sha256s": revoked or [],
        }
        (self.store / "active.json").write_bytes(_json_bytes(state))


class StandardsStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-standard-store-"))
        self.addCleanup(_rmtree_force, self.tmp)
        self.fx = StandardStoreFixture(self.tmp)

    def test_bundled_release_resolves_to_full_content_identity(self):
        release = self.fx.bundled()
        self.assertEqual(release.identity["name"], "oak-rules")
        self.assertEqual(release.identity["version"], "1.0.0")
        self.assertTrue(release.identity["pinned"])
        self.assertEqual(len(release.identity["sha256"]), 64)
        self.assertEqual(len(release.identity["manifest_sha256"]), 64)
        self.assertEqual(release.source, "bundled")

    def test_semver_core_rejects_values_not_exact_in_javascript(self):
        for version in (
            "9007199254740992.0.0",
            "0.9007199254740992.0",
            "0.0.9007199254740992",
        ):
            with self.subTest(version=version), self.assertRaisesRegex(
                StructuredOakError, "安全整数"
            ):
                _parse_semver(version, "测试版本")

    def test_installed_active_revalidates_manifest_payloads_and_pointer(self):
        manifest, manifest_sha, _package = self.fx.install_version()
        self.fx.activate(
            bundle_id=manifest["bundle_id"],
            release_sequence=manifest["release_sequence"],
            version=manifest["version"],
            manifest_sha256=manifest_sha,
            source="installed",
        )
        release = resolve_active_release(
            store_root=self.fx.store,
            resources_root=self.fx.resources,
        )
        self.assertEqual(release.identity["version"], "1.0.1")
        self.assertEqual(release.identity["manifest_sha256"], manifest_sha)

    def test_verified_payload_bytes_are_parsed_without_reopening_paths(self):
        manifest, manifest_sha, _package = self.fx.install_version()
        self.fx.activate(
            bundle_id=manifest["bundle_id"],
            release_sequence=manifest["release_sequence"],
            version=manifest["version"],
            manifest_sha256=manifest_sha,
            source="installed",
        )
        with mock.patch(
            "oak_manuscript_core.standards_store.load_rulepack",
            side_effect=AssertionError("payload path must not be reopened"),
        ):
            release = resolve_active_release(
                store_root=self.fx.store,
                resources_root=self.fx.resources,
            )
        self.assertEqual(release.identity["manifest_sha256"], manifest_sha)

    def test_protected_capability_bytes_are_anchored_by_manifest(self):
        capability_path = self.fx.config / "rule-capabilities.json"
        capability_path.write_bytes(capability_path.read_bytes() + b" ")
        with self.assertRaises(StructuredOakError) as ctx:
            self.fx.bundled()
        self.assertIn(
            ctx.exception.code,
            {"STANDARD_CAPABILITY_INVALID", "STANDARD_CAPABILITY_MISMATCH"},
        )

    def test_migration_source_never_relaxes_protected_capability_mapping(self):
        def mutate_capability(_standards: dict, pack: dict) -> None:
            rule = pack["rules"][0]
            rule["milestone"] = "M2" if rule["milestone"] != "M2" else "M1"

        manifest, manifest_sha, _package = self.fx.install_version(
            mutate_payloads=mutate_capability,
        )
        identity = {
            "name": manifest["rulepack"]["name"],
            "version": manifest["rulepack"]["version"],
            "pinned": True,
            "sha256": manifest["rulepack"]["sha256"],
            "bundle_id": manifest["bundle_id"],
            "release_sequence": manifest["release_sequence"],
            "manifest_sha256": manifest_sha,
        }
        self.fx.activate(
            bundle_id=manifest["bundle_id"],
            release_sequence=manifest["release_sequence"],
            version=manifest["version"],
            manifest_sha256=manifest_sha,
            source="installed",
            revoked=[manifest_sha],
        )

        with self.assertRaises(StructuredOakError) as ctx:
            resolve_project_rulepack(
                identity,
                store_root=self.fx.store,
                resources_root=self.fx.resources,
                _allow_inactive_for_migration=True,
            )
        self.assertEqual(ctx.exception.code, "STANDARD_CAPABILITY_MISMATCH")

    def test_rulepack_tamper_and_unlisted_cas_file_fail_closed(self):
        manifest, manifest_sha, package = self.fx.install_version()
        self.fx.activate(
            bundle_id=manifest["bundle_id"],
            release_sequence=manifest["release_sequence"],
            version=manifest["version"],
            manifest_sha256=manifest_sha,
            source="installed",
        )
        (package / "rulepack.json").write_bytes((package / "rulepack.json").read_bytes() + b" ")
        with self.assertRaisesRegex(StructuredOakError, "SHA-256|大小|内嵌字节"):
            resolve_active_release(store_root=self.fx.store, resources_root=self.fx.resources)

        # 还原后加入未列文件；CAS 文件集合也必须精确。
        _rmtree_force(package)
        _manifest, _sha_value, package = self.fx.install_version()
        (package / "extra.json").write_bytes(b"{}\n")
        with self.assertRaisesRegex(StructuredOakError, "文件集合"):
            resolve_active_release(store_root=self.fx.store, resources_root=self.fx.resources)

    def test_revoked_active_and_pinned_release_are_rejected(self):
        manifest, manifest_sha, _package = self.fx.install_version()
        self.fx.activate(
            bundle_id=manifest["bundle_id"],
            release_sequence=manifest["release_sequence"],
            version=manifest["version"],
            manifest_sha256=manifest_sha,
            source="installed",
            revoked=[manifest_sha],
        )
        with self.assertRaises(StructuredOakError) as active_ctx:
            resolve_active_release(store_root=self.fx.store, resources_root=self.fx.resources)
        self.assertEqual(active_ctx.exception.code, "STANDARD_RELEASE_REVOKED")

        identity = {
            "name": "oak-rules",
            "version": "1.0.1",
            "pinned": True,
            "sha256": manifest["rulepack"]["sha256"],
            "bundle_id": manifest["bundle_id"],
            "release_sequence": manifest["release_sequence"],
            "manifest_sha256": manifest_sha,
        }
        with self.assertRaises(StructuredOakError) as pin_ctx:
            resolve_project_rulepack(
                identity,
                store_root=self.fx.store,
                resources_root=self.fx.resources,
            )
        self.assertEqual(pin_ctx.exception.code, "STANDARD_RELEASE_REVOKED")

    def test_active_pointer_mismatch_is_not_treated_as_an_upgrade(self):
        manifest, manifest_sha, _package = self.fx.install_version()
        self.fx.activate(
            bundle_id=manifest["bundle_id"],
            release_sequence=99,
            version=manifest["version"],
            manifest_sha256=manifest_sha,
            source="installed",
        )
        with self.assertRaises(StructuredOakError) as ctx:
            resolve_active_release(store_root=self.fx.store, resources_root=self.fx.resources)
        self.assertEqual(ctx.exception.code, "STANDARD_ACTIVE_INVALID")

    def test_missing_or_tampered_full_pin_never_falls_back_to_active(self):
        release = self.fx.bundled()
        missing = copy.deepcopy(release.identity)
        missing["manifest_sha256"] = "f" * 64
        with self.assertRaises(StructuredOakError) as missing_ctx:
            resolve_project_rulepack(missing, resources_root=self.fx.resources)
        self.assertEqual(missing_ctx.exception.code, "PROJECT_RULEPACK_MISSING")

        tampered = copy.deepcopy(release.identity)
        tampered["bundle_id"] = "other-bundle"
        with self.assertRaises(StructuredOakError) as tampered_ctx:
            resolve_project_rulepack(tampered, resources_root=self.fx.resources)
        self.assertEqual(tampered_ctx.exception.code, "PROJECT_RULEPACK_MISMATCH")

        with self.assertRaises(StructuredOakError) as unpinned_ctx:
            resolve_project_rulepack(
                {"name": None, "version": None, "pinned": True},
                resources_root=self.fx.resources,
            )
        self.assertEqual(unpinned_ctx.exception.code, "PROJECT_RULEPACK_UNPINNED")

    def test_legacy_name_version_only_backfills_only_on_unique_match(self):
        bundled = self.fx.bundled()
        legacy = {"name": "oak-rules", "version": "1.0.0", "pinned": True}
        resolved = resolve_project_rulepack(legacy, resources_root=self.fx.resources)
        self.assertEqual(resolved.identity, bundled.identity)

        # 同一 name+version 但不同 manifest identity 进入 CAS 后，旧 pin 必须拒绝猜测。
        manifest, manifest_sha, package = self.fx.install_version("1.0.0")
        manifest["release_sequence"] = 2
        raw = _json_bytes(manifest)
        new_sha = _sha(raw)
        new_package = self.fx.store / "packages" / new_sha
        package.rename(new_package)
        (new_package / "manifest.json").write_bytes(raw)
        envelope_path = new_package / "release.envelope.json"
        envelope = json.loads(envelope_path.read_text(encoding="utf-8"))
        envelope["manifest_b64"] = _b64(raw)
        envelope_path.write_bytes(_json_bytes(envelope))
        self.fx.activate(
            bundle_id=manifest["bundle_id"],
            release_sequence=manifest["release_sequence"],
            version=manifest["version"],
            manifest_sha256=new_sha,
            source="installed",
        )
        with self.assertRaises(StructuredOakError) as ctx:
            resolve_project_rulepack(
                legacy,
                store_root=self.fx.store,
                resources_root=self.fx.resources,
            )
        self.assertEqual(ctx.exception.code, "PROJECT_RULEPACK_AMBIGUOUS")

    def test_existing_project_keeps_old_pin_after_active_changes(self):
        bundled = self.fx.bundled()
        project = Project.create(
            SAMPLE,
            self.tmp / "project",
            rulepack_identity=bundled.identity,
        )
        ops.run_check(project, bundled.rulepack)
        pinned_before = copy.deepcopy(project.data["rulepack"])

        manifest, manifest_sha, _package = self.fx.install_version()
        self.fx.activate(
            bundle_id=manifest["bundle_id"],
            release_sequence=manifest["release_sequence"],
            version=manifest["version"],
            manifest_sha256=manifest_sha,
            source="installed",
        )
        old_release = resolve_project_rulepack(
            project.data["rulepack"],
            store_root=self.fx.store,
            resources_root=self.fx.resources,
        )
        self.assertEqual(old_release.identity, pinned_before)
        ops.run_check(project, old_release.rulepack, kind="recheck")
        self.assertEqual(project.data["rulepack"], pinned_before)

    def test_historical_bundled_cas_survives_new_active_and_missing_old_assets(self):
        bundled = self.fx.bundled()
        _manifest, bundled_sha, _package = self.fx.cache_current_bundled()
        self.assertEqual(bundled_sha, bundled.identity["manifest_sha256"])
        project = Project.create(
            SAMPLE,
            self.tmp / "historical-bundled-project",
            rulepack_identity=bundled.identity,
        )
        ops.run_check(project, bundled.rulepack)

        target_manifest, target_sha, _target_package = self.fx.install_version("1.0.1")
        self.fx.activate(
            bundle_id=target_manifest["bundle_id"],
            release_sequence=target_manifest["release_sequence"],
            version=target_manifest["version"],
            manifest_sha256=target_sha,
            source="installed",
        )
        # 模拟下一版 APP 已不再携带旧 bundled manifest/payload；旧 pin 只能从
        # CAS 的 bundled envelope + 代码历史 digest allowlist 解析。
        for path in (self.fx.config / "standard-packs").glob("*.manifest.json"):
            path.unlink()
        for path in (self.fx.config / "rule-packs").glob("*.json"):
            path.unlink()

        active = resolve_active_release(
            store_root=self.fx.store,
            resources_root=self.fx.resources,
        )
        self.assertEqual(active.identity["manifest_sha256"], target_sha)
        historical = resolve_project_rulepack(
            project.data["rulepack"],
            store_root=self.fx.store,
            resources_root=self.fx.resources,
        )
        self.assertEqual(historical.source, "bundled")
        self.assertEqual(historical.identity, bundled.identity)
        ops.run_check(project, historical.rulepack, kind="recheck")
        self.assertEqual(project.data["checks"][-1]["rulepack"], bundled.identity)

    def test_cas_envelope_kind_must_match_active_source(self):
        manifest, manifest_sha, _package = self.fx.cache_current_bundled()
        self.fx.activate(
            bundle_id=manifest["bundle_id"],
            release_sequence=manifest["release_sequence"],
            version=manifest["version"],
            manifest_sha256=manifest_sha,
            source="installed",
        )
        with self.assertRaises(StructuredOakError) as ctx:
            resolve_active_release(
                store_root=self.fx.store,
                resources_root=self.fx.resources,
            )
        self.assertEqual(ctx.exception.code, "STANDARD_RELEASE_SOURCE_MISMATCH")

    def test_expected_identity_is_canonical_and_exactly_bound(self):
        release = self.fx.bundled()
        canonical = json.dumps(
            release.identity,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        with mock.patch.dict(os.environ, {EXPECTED_IDENTITY_ENV: canonical}):
            resolved = resolve_active_release(resources_root=self.fx.resources)
        self.assertEqual(resolved.identity, release.identity)

        wrong = copy.deepcopy(release.identity)
        wrong["manifest_sha256"] = "f" * 64
        wrong_raw = json.dumps(wrong, sort_keys=True, separators=(",", ":"))
        with mock.patch.dict(os.environ, {EXPECTED_IDENTITY_ENV: wrong_raw}):
            with self.assertRaises(StructuredOakError) as mismatch:
                resolve_active_release(resources_root=self.fx.resources)
        self.assertEqual(mismatch.exception.code, "EXPECTED_STANDARD_IDENTITY_MISMATCH")

        with mock.patch.dict(os.environ, {EXPECTED_IDENTITY_ENV: json.dumps(release.identity)}):
            with self.assertRaises(StructuredOakError) as invalid:
                resolve_active_release(resources_root=self.fx.resources)
        self.assertEqual(invalid.exception.code, "EXPECTED_STANDARD_IDENTITY_INVALID")

        create_target = self.tmp / "expected-mismatch-create"
        with mock.patch.dict(os.environ, {EXPECTED_IDENTITY_ENV: wrong_raw}):
            with self.assertRaises(StructuredOakError) as create_mismatch:
                Project.create(
                    SAMPLE,
                    create_target,
                    rulepack_identity=release.identity,
                )
        self.assertEqual(
            create_mismatch.exception.code,
            "EXPECTED_STANDARD_IDENTITY_MISMATCH",
        )
        self.assertFalse(create_target.exists())

    def test_project_standard_status_is_read_only_and_reports_legacy_pin(self):
        release = self.fx.bundled()
        project = Project.create(
            SAMPLE,
            self.tmp / "status-project",
            rulepack_identity=release.identity,
        )
        project.data["rulepack"] = {
            "name": release.identity["name"],
            "version": release.identity["version"],
            "pinned": True,
        }
        project.save()
        before = {
            path.relative_to(project.root).as_posix(): path.read_bytes()
            for path in project.root.rglob("*")
            if path.is_file()
        }
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        env.pop(EXPECTED_IDENTITY_ENV, None)
        env.pop("OAK_STANDARDS_STORE", None)
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "oak_manuscript_core",
                "project-standard-status",
                "--project",
                str(project.root),
            ],
            cwd=str(REPO / "python"),
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertEqual(
            set(payload),
            {"ok", "project", "standard_identity", "stored_identity", "legacy_migratable"},
        )
        self.assertEqual(payload["project"], str(project.root))
        self.assertEqual(payload["standard_identity"], release.identity)
        self.assertEqual(payload["stored_identity"], project.data["rulepack"])
        self.assertTrue(payload["legacy_migratable"])
        after = {
            path.relative_to(project.root).as_posix(): path.read_bytes()
            for path in project.root.rglob("*")
            if path.is_file()
        }
        self.assertEqual(after, before)

    def test_check_plan_and_export_reject_another_pack_before_writing(self):
        release = self.fx.bundled()
        project = Project.create(
            SAMPLE,
            self.tmp / "mismatch-project",
            rulepack_identity=release.identity,
        )
        changed = json.loads(self.config_pack_path.read_text(encoding="utf-8"))
        changed["rules"][0]["title"] += "（同版本不同内容）"
        wrong_path = self.tmp / "same-version-different-content.json"
        wrong_path.write_bytes(_json_bytes(changed))
        wrong = load_rulepack(wrong_path)
        before = (project.root / "project.json").read_bytes()
        with self.assertRaisesRegex(OakError, "完整 pin"):
            ops.run_check(project, wrong)
        self.assertEqual((project.root / "project.json").read_bytes(), before)
        self.assertEqual(project.data["checks"], [])

    @property
    def config_pack_path(self) -> Path:
        return self.fx.config / "rule-packs" / "oak-rules-1.0.0.json"

    def test_legacy_project_is_backfilled_with_full_identity_on_check(self):
        release = self.fx.bundled()
        project = Project.create(SAMPLE, self.tmp / "legacy-project")
        project.data["rulepack"] = {
            "name": "oak-rules",
            "version": "1.0.0",
            "pinned": True,
        }
        project.save()
        resolved = resolve_project_rulepack(
            project.data["rulepack"],
            resources_root=self.fx.resources,
        )
        ops.run_check(project, resolved.rulepack)
        self.assertEqual(project.data["rulepack"], release.identity)
        reopened = Project.open(project.root)
        self.assertEqual(reopened.data["rulepack"], release.identity)
        self.assertEqual(reopened.data["checks"][-1]["rulepack"], release.identity)


if __name__ == "__main__":
    unittest.main()
