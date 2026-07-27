"""alpha.3 项目级规则包显式升级/回退、计划绑定与事务回归。"""

from __future__ import annotations

import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from oak_manuscript_core import ops
from oak_manuscript_core import rulepack_upgrade as upgrade_module
from oak_manuscript_core.__main__ import _MUTATING_COMMANDS
from oak_manuscript_core.errors import OakError, ProjectValidationError, StructuredOakError
from oak_manuscript_core.project import Project
from oak_manuscript_core.project_lock import PROJECT_LOCK_FILENAME, ProjectWriteLock
from oak_manuscript_core.rulepack_upgrade import (
    apply_rulepack_upgrade,
    plan_rulepack_upgrade,
)
from oak_manuscript_core.standards_store import (
    resolve_active_release,
    resolve_project_rulepack,
    resolve_release_by_manifest_sha256,
)
from oak_manuscript_core.util import sha256_file
from tests.test_standards_store import StandardStoreFixture, _rmtree_force

REPO = Path(__file__).resolve().parents[2]
PYTHON_ROOT = REPO / "python"
SAMPLE = REPO / "samples" / "paper_needs_review.docx"


def _tree_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }


def _mutate_target_payloads(standards: dict, pack: dict) -> None:
    removed_rule = pack["rules"].pop()
    removed_id = removed_rule["rule_id"]
    for standard in standards["standards"]:
        if removed_id in standard["rule_ids"]:
            standard["rule_ids"].remove(removed_id)

    changed_rule = pack["rules"][0]
    changed_rule["title"] += "（升级版说明）"
    changed_standard_id = changed_rule["standard_refs"][0]
    for standard in standards["standards"]:
        if standard["standard_id"] == changed_standard_id:
            standard["summary"] += " 本版本补充规则升级说明。"
            break

    for entry in pack["citation_default_mapping"]["map"]:
        if entry["manuscript_type"] == "paper" and "en" in entry["languages"]:
            entry["citation_style"] = "chicago-18-nb"
            break


class RulepackUpgradeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-rulepack-upgrade-"))
        self.addCleanup(_rmtree_force, self.tmp)
        self.fx = StandardStoreFixture(self.tmp / "fixture")
        self.bundled = resolve_active_release(resources_root=self.fx.resources)
        self.project = Project.create(
            SAMPLE,
            self.tmp / "project",
            rulepack_identity=self.bundled.identity,
        )
        ops.run_check(self.project, self.bundled.rulepack)
        self.target_manifest, self.target_sha, _package = self.fx.install_version(
            "1.0.1",
            release_sequence=2,
            mutate_payloads=_mutate_target_payloads,
        )
        self.fx.activate(
            bundle_id=self.target_manifest["bundle_id"],
            release_sequence=self.target_manifest["release_sequence"],
            version=self.target_manifest["version"],
            manifest_sha256=self.target_sha,
            source="installed",
        )
        self.resolver = {
            "store_root": self.fx.store,
            "resources_root": self.fx.resources,
        }

    def _plan(self) -> dict:
        return plan_rulepack_upgrade(
            self.project,
            self.target_sha,
            **self.resolver,
        )

    def _apply(self, plan: dict | None = None) -> dict:
        plan = plan or self._plan()
        return apply_rulepack_upgrade(
            self.project,
            self.target_sha,
            plan_id=plan["plan_id"],
            **self.resolver,
        )

    def test_plan_is_deterministic_read_only_and_contains_complete_diff(self) -> None:
        before = _tree_bytes(self.project.root)
        data_before = copy.deepcopy(self.project.data)

        first = self._plan()
        second = self._plan()

        self.assertEqual(first, second)
        self.assertEqual(_tree_bytes(self.project.root), before)
        self.assertEqual(self.project.data, data_before)
        self.assertEqual(first["direction"], "upgrade")
        self.assertEqual(first["current_rulepack"], self.bundled.identity)
        self.assertEqual(first["target_rulepack"]["manifest_sha256"], self.target_sha)
        self.assertTrue(first["plan_id"].startswith("rulepack-plan-"))
        self.assertEqual(len(first["diff_sha256"]), 64)
        self.assertGreater(len(first["diff"]["rules"]["removed"]), 0)
        self.assertGreater(len(first["diff"]["rules"]["changed"]), 0)
        self.assertIn("added", first["diff"]["rules"])
        self.assertGreater(len(first["diff"]["standards"]["changed"]), 0)
        self.assertTrue(first["diff"]["citation_mapping"]["changed"])
        self.assertEqual(
            first["bindings"]["working_sha256"],
            sha256_file(self.project.working_path),
        )
        self.assertIsNotNone(first["bindings"]["issues_sha256"])
        self.assertEqual(first["bindings"]["issue_count"], len(ops.load_issues(self.project)))

    def test_apply_checkpoints_archives_issues_and_requires_fresh_check(self) -> None:
        plan = self._plan()
        source_before = sha256_file(self.project.source_path)
        working_before = sha256_file(self.project.working_path)
        issues_before = self.project.issues_path(required=True).read_bytes()
        checks_before = copy.deepcopy(self.project.data["checks"])
        report_bytes_before = {
            check["result_file"]: self.project.report_path(
                check["result_file"], required=True
            ).read_bytes()
            for check in checks_before
        }

        result = self._apply(plan)
        reopened = Project.open(self.project.root)

        self.assertEqual(result["rulepack"], plan["target_rulepack"])
        self.assertEqual(reopened.data["rulepack"], plan["target_rulepack"])
        self.assertTrue(reopened.data["rulepack_check_required"])
        self.assertIsNone(reopened.data["issues_file"])
        self.assertFalse(reopened.issues_path(required=False).exists())
        self.assertEqual(reopened.data["checks"], checks_before)
        for relative, payload in report_bytes_before.items():
            self.assertEqual(reopened.report_path(relative, required=True).read_bytes(), payload)
        self.assertEqual(reopened.verify(), [])
        self.assertEqual(sha256_file(reopened.source_path), source_before)
        self.assertEqual(sha256_file(reopened.working_path), working_before)

        change = reopened.data["rulepack_history"][-1]
        self.assertEqual(change["direction"], "upgrade")
        self.assertEqual(change["plan_id"], plan["plan_id"])
        self.assertEqual(change["diff_sha256"], plan["diff_sha256"])
        self.assertEqual(
            reopened.data["checkpoints"][-1]["reason"],
            "before_rulepack_upgrade:1.0.1",
        )
        archive = reopened.root / change["issues_archive"]
        self.assertEqual(archive.read_bytes(), issues_before)
        self.assertIsNone(reopened.data["settings"]["citation_style_resolved"])
        self.assertIsNone(reopened.data["settings"]["citation_resolved_by"])
        self.assertIsNone(reopened.data["settings"]["citation_mapping_version"])

        target = resolve_release_by_manifest_sha256(self.target_sha, **self.resolver)
        with self.assertRaisesRegex(OakError, "重新运行 check"):
            ops.build_report_data(reopened, target.rulepack)
        with self.assertRaisesRegex(OakError, "重新运行 check"):
            ops.plan_fixes(reopened, target.rulepack)

        ops.run_check(reopened, target.rulepack)
        checked = Project.open(reopened.root)
        self.assertFalse(checked.data["rulepack_check_required"])
        self.assertEqual(checked.data["issues_file"], "reports/issues.json")
        self.assertEqual(len(checked.data["checks"]), 2)
        self.assertEqual(checked.data["checks"][0]["rulepack"], self.bundled.identity)
        self.assertEqual(checked.data["checks"][1]["rulepack"], target.identity)
        self.assertEqual(checked.verify(), [])

        old_check = checked.data["checks"][0]
        old_report_path = checked.report_path(old_check["result_file"], required=True)
        old_report = json.loads(old_report_path.read_text(encoding="utf-8"))
        old_report["rulepack"] = copy.deepcopy(target.identity)
        old_report_path.write_text(
            json.dumps(old_report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        self.assertTrue(
            any(
                old_check["result_file"] in problem and "规则包身份" in problem
                for problem in checked.verify()
            )
        )

    def test_stale_working_or_issue_state_is_rejected_before_checkpoint(self) -> None:
        plan = self._plan()
        checkpoints_before = copy.deepcopy(self.project.data["checkpoints"])
        working_before = self.project.working_path.read_bytes()
        self.project.working_path.write_bytes(working_before + b"stale")
        with self.assertRaisesRegex(StructuredOakError, "过期") as working_ctx:
            self._apply(plan)
        self.assertEqual(working_ctx.exception.code, "RULEPACK_UPGRADE_PLAN_STALE")
        self.assertEqual(self.project.data["checkpoints"], checkpoints_before)
        self.assertEqual(self.project.data["rulepack"], self.bundled.identity)

        self.project.working_path.write_bytes(working_before)
        plan = self._plan()
        issue_id = ops.load_issues(self.project)[0]["issue_id"]
        ops.set_issue_status(self.project, issue_id, "rejected")
        with self.assertRaisesRegex(StructuredOakError, "过期") as issues_ctx:
            self._apply(plan)
        self.assertEqual(issues_ctx.exception.code, "RULEPACK_UPGRADE_PLAN_STALE")
        self.assertEqual(self.project.data["checkpoints"], checkpoints_before)
        self.assertEqual(self.project.data["rulepack"], self.bundled.identity)

    def test_commit_failure_restores_entire_project_and_checkpoint_tree(self) -> None:
        plan = self._plan()
        tree_before = _tree_bytes(self.project.root)
        data_before = copy.deepcopy(self.project.data)
        with mock.patch(
            "oak_manuscript_core.rulepack_upgrade._commit_project_manifest",
            side_effect=OSError("injected manifest commit failure"),
        ):
            with self.assertRaisesRegex(OakError, "升级/回退失败"):
                self._apply(plan)
        self.assertEqual(_tree_bytes(self.project.root), tree_before)
        self.assertEqual(self.project.data, data_before)
        reopened = Project.open(self.project.root)
        self.assertEqual(reopened.data, data_before)

    def test_failure_after_real_manifest_replace_restores_every_file(self) -> None:
        plan = self._plan()
        tree_before = _tree_bytes(self.project.root)
        data_before = copy.deepcopy(self.project.data)

        def replace_then_fail(staged, manifest_path, identity):
            upgrade_module._commit_project_manifest(staged, manifest_path, identity)
            raise OSError("injected failure after real replace")

        with mock.patch(
            "oak_manuscript_core.rulepack_upgrade._commit_project_manifest",
            side_effect=replace_then_fail,
        ):
            with self.assertRaisesRegex(StructuredOakError, "升级/回退失败") as ctx:
                self._apply(plan)
        self.assertEqual(ctx.exception.code, "RULEPACK_UPGRADE_TRANSACTION_FAILED")
        self.assertEqual(_tree_bytes(self.project.root), tree_before)
        self.assertEqual(self.project.data, data_before)
        self.assertEqual(Project.open(self.project.root).data, data_before)

    def test_archive_write_failure_restores_checkpoint_tree(self) -> None:
        plan = self._plan()
        tree_before = _tree_bytes(self.project.root)
        data_before = copy.deepcopy(self.project.data)
        with mock.patch(
            "oak_manuscript_core.rulepack_upgrade._write_exclusive_bytes",
            side_effect=OSError("injected archive fsync failure"),
        ):
            with self.assertRaisesRegex(StructuredOakError, "升级/回退失败") as ctx:
                self._apply(plan)
        self.assertEqual(ctx.exception.code, "RULEPACK_UPGRADE_TRANSACTION_FAILED")
        self.assertEqual(_tree_bytes(self.project.root), tree_before)
        self.assertEqual(self.project.data, data_before)

    def test_post_commit_checkpoint_cleanup_failure_is_reported_not_rolled_back(self) -> None:
        for index in range(5):
            self.project.make_checkpoint(reason=f"fill-{index}")
        plan = self._plan()
        with mock.patch.object(
            Project,
            "_delete_checkpoint_directories",
            side_effect=OSError("injected post-commit cleanup failure"),
        ):
            result = self._apply(plan)
        self.assertIn("cleanup_warning", result)
        self.assertIn("injected post-commit cleanup failure", result["cleanup_warning"])
        committed = Project.open(self.project.root)
        self.assertEqual(committed.data["rulepack"], plan["target_rulepack"])
        self.assertTrue(committed.data["rulepack_check_required"])
        self.assertEqual(len(committed.data["checkpoints"]), 5)

    def test_existing_archive_collision_fails_without_moving_current_issues(self) -> None:
        plan = self._plan()
        next_checkpoint = self.project.data["checkpoint_seq"] + 1
        collision = (
            self.project.safe_subdir("reports")
            / f"issues.before-rulepack-cp-{next_checkpoint:04d}.json"
        )
        collision.write_text("do not overwrite", encoding="utf-8")
        before = _tree_bytes(self.project.root)
        data_before = copy.deepcopy(self.project.data)

        with self.assertRaisesRegex(OakError, "归档目标已存在"):
            self._apply(plan)

        self.assertEqual(_tree_bytes(self.project.root), before)
        self.assertEqual(self.project.data, data_before)

    def test_default_only_citation_reset_and_external_gate(self) -> None:
        self.project.data["settings"].update(
            {
                "citation_style": "apa-7",
                "citation_style_resolved": "apa-7",
                "citation_resolved_by": "user",
                "citation_mapping_version": None,
            }
        )
        self.project.save()
        plan = self._plan()
        self._apply(plan)
        reopened = Project.open(self.project.root)
        self.assertEqual(reopened.data["settings"]["citation_style_resolved"], "apa-7")
        self.assertEqual(reopened.data["settings"]["citation_resolved_by"], "user")
        with self.assertRaisesRegex(OakError, "重新运行 check"):
            ops.run_external(reopened)

    def test_cross_rulepack_checkpoint_restore_is_blocked_and_rollback_is_explicit(self) -> None:
        upgrade_plan = self._plan()
        self._apply(upgrade_plan)
        upgraded = Project.open(self.project.root)
        before_upgrade_checkpoint = upgraded.data["checkpoints"][-1]["checkpoint_id"]
        with self.assertRaisesRegex(OakError, "显式升级/回退计划"):
            upgraded.restore_checkpoint(before_upgrade_checkpoint)
        self.assertEqual(upgraded.data["rulepack_history"], self.project.data["rulepack_history"])

        target = resolve_release_by_manifest_sha256(self.target_sha, **self.resolver)
        ops.run_check(upgraded, target.rulepack)
        rollback_plan = plan_rulepack_upgrade(
            upgraded,
            self.bundled.identity["manifest_sha256"],
            **self.resolver,
        )
        self.assertEqual(rollback_plan["direction"], "rollback")
        self.assertGreater(len(rollback_plan["diff"]["rules"]["added"]), 0)
        rollback_result = apply_rulepack_upgrade(
            upgraded,
            self.bundled.identity["manifest_sha256"],
            plan_id=rollback_plan["plan_id"],
            **self.resolver,
        )
        rolled_back = Project.open(upgraded.root)
        self.assertEqual(rollback_result["change"]["direction"], "rollback")
        self.assertEqual(rolled_back.data["rulepack"], self.bundled.identity)
        self.assertEqual(len(rolled_back.data["rulepack_history"]), 2)
        self.assertTrue(rolled_back.data["rulepack_check_required"])
        before_rollback_checkpoint = rolled_back.data["checkpoints"][-1]["checkpoint_id"]
        with self.assertRaisesRegex(OakError, "显式升级/回退计划"):
            rolled_back.restore_checkpoint(before_rollback_checkpoint)
        self.assertEqual(len(rolled_back.data["rulepack_history"]), 2)

        broken = copy.deepcopy(rolled_back.data)
        disconnected = copy.deepcopy(broken["rulepack_history"][1]["from_rulepack"])
        disconnected["version"] = "1.0.2"
        disconnected["release_sequence"] = 3
        disconnected["manifest_sha256"] = "e" * 64
        broken["rulepack_history"][1]["from_rulepack"] = disconnected
        rolled_back.data = broken
        with self.assertRaisesRegex(ProjectValidationError, "pin 链不连续"):
            rolled_back.save()

    def test_same_pin_checkpoint_cannot_clear_required_recheck(self) -> None:
        self._apply()
        upgraded = Project.open(self.project.root)
        checkpoint = upgraded.make_checkpoint(reason="pre_recheck_same_pin")
        state_path = (
            upgraded.safe_subdir("checkpoints")
            / checkpoint["checkpoint_id"]
            / "state.json"
        )
        # 模拟 alpha.3 之前缺少 additive 字段的旧 checkpoint state。
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["project_state"].pop("rulepack_check_required")
        state_path.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        next(
            item
            for item in upgraded.data["checkpoints"]
            if item["checkpoint_id"] == checkpoint["checkpoint_id"]
        )["state_sha256"] = sha256_file(state_path)
        upgraded.save(touch=False)

        target = resolve_release_by_manifest_sha256(self.target_sha, **self.resolver)
        ops.run_check(upgraded, target.rulepack)
        upgraded.restore_checkpoint(checkpoint["checkpoint_id"])
        restored = Project.open(upgraded.root)
        self.assertTrue(restored.data["rulepack_check_required"])
        with self.assertRaisesRegex(OakError, "重新运行 check"):
            ops.build_report_data(restored, target.rulepack)

    def test_revoked_expired_or_incompatible_current_can_migrate_only(self) -> None:
        self.fx.activate(
            bundle_id=self.target_manifest["bundle_id"],
            release_sequence=self.target_manifest["release_sequence"],
            version=self.target_manifest["version"],
            manifest_sha256=self.target_sha,
            source="installed",
            revoked=[self.bundled.identity["manifest_sha256"]],
        )
        revoked_plan = self._plan()
        self.assertEqual(revoked_plan["current_rulepack"], self.bundled.identity)
        status_env = dict(os.environ)
        status_env["PYTHONIOENCODING"] = "utf-8"
        status_env["OAK_STANDARDS_STORE"] = str(self.fx.store)
        status = subprocess.run(
            [
                sys.executable,
                "-m",
                "oak_manuscript_core",
                "project-standard-status",
                "--project",
                str(self.project.root),
            ],
            cwd=str(PYTHON_ROOT),
            env=status_env,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(status.returncode, 0, status.stderr)
        self.assertEqual(json.loads(status.stdout)["standard_identity"], self.bundled.identity)
        self._apply(revoked_plan)

        current_manifest, current_sha, _package = self.fx.install_version(
            "1.0.0",
            release_sequence=1,
            released_at="2026-07-25T00:00:00Z",
            expires_at="2026-07-26T00:00:00Z",
            min_app="0.1.0-alpha.1",
            max_app_exclusive="0.1.0-alpha.2",
        )
        current_identity = {
            "name": current_manifest["rulepack"]["name"],
            "version": current_manifest["rulepack"]["version"],
            "pinned": True,
            "sha256": current_manifest["rulepack"]["sha256"],
            "bundle_id": current_manifest["bundle_id"],
            "release_sequence": current_manifest["release_sequence"],
            "manifest_sha256": current_sha,
        }
        migration_project = Project.create(
            SAMPLE,
            self.tmp / "inactive-current-project",
            rulepack_identity=current_identity,
        )
        fixed_now = datetime(2026, 7, 27, 2, 0, tzinfo=timezone.utc)
        with self.assertRaises(StructuredOakError) as strict_ctx:
            resolve_project_rulepack(
                current_identity,
                now=fixed_now,
                **self.resolver,
            )
        self.assertIn(
            strict_ctx.exception.code,
            {"STANDARD_RELEASE_EXPIRED", "STANDARD_RELEASE_INCOMPATIBLE"},
        )
        migration_plan = plan_rulepack_upgrade(
            migration_project,
            self.target_sha,
            now=fixed_now,
            **self.resolver,
        )
        self.assertEqual(migration_plan["current_rulepack"], current_identity)
        apply_rulepack_upgrade(
            migration_project,
            self.target_sha,
            plan_id=migration_plan["plan_id"],
            now=fixed_now,
            **self.resolver,
        )
        self.assertEqual(migration_project.data["rulepack"]["manifest_sha256"], self.target_sha)

    def test_noop_and_missing_target_have_stable_codes(self) -> None:
        with self.assertRaises(StructuredOakError) as noop:
            plan_rulepack_upgrade(
                self.project,
                self.bundled.identity["manifest_sha256"],
                **self.resolver,
            )
        self.assertEqual(noop.exception.code, "RULEPACK_UPGRADE_NOT_NEEDED")
        with self.assertRaises(StructuredOakError) as missing:
            plan_rulepack_upgrade(self.project, "f" * 64, **self.resolver)
        self.assertEqual(missing.exception.code, "RULEPACK_UPGRADE_TARGET_MISSING")

    def test_cli_upgrade_fails_closed_when_project_lock_is_held(self) -> None:
        plan = self._plan()
        before = {
            key: value
            for key, value in _tree_bytes(self.project.root).items()
            if key != PROJECT_LOCK_FILENAME
        }
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        env["OAK_STANDARDS_STORE"] = str(self.fx.store)
        with ProjectWriteLock(self.project.root, command="held-by-test"):
            completed = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "oak_manuscript_core",
                    "upgrade-rulepack",
                    "--project",
                    str(self.project.root),
                    "--to-manifest-sha256",
                    self.target_sha,
                    "--plan-id",
                    plan["plan_id"],
                ],
                cwd=str(PYTHON_ROOT),
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(json.loads(completed.stdout)["error"]["code"], "PROJECT_WRITE_LOCKED")
        after = {
            key: value
            for key, value in _tree_bytes(self.project.root).items()
            if key != PROJECT_LOCK_FILENAME
        }
        self.assertEqual(after, before)

    def test_old_format_1_project_without_additive_fields_remains_compatible(self) -> None:
        self.project.data.pop("rulepack_history")
        self.project.data.pop("rulepack_check_required")
        self.project.save()
        reopened = Project.open(self.project.root)
        plan = plan_rulepack_upgrade(reopened, self.target_sha, **self.resolver)
        apply_rulepack_upgrade(
            reopened,
            self.target_sha,
            plan_id=plan["plan_id"],
            **self.resolver,
        )
        migrated = Project.open(reopened.root)
        self.assertEqual(len(migrated.data["rulepack_history"]), 1)
        self.assertTrue(migrated.data["rulepack_check_required"])

    def test_cli_plan_is_read_only_and_apply_is_classified_mutating(self) -> None:
        self.assertNotIn("plan-rulepack-upgrade", _MUTATING_COMMANDS)
        self.assertIn("upgrade-rulepack", _MUTATING_COMMANDS)
        before = _tree_bytes(self.project.root)
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        env["OAK_STANDARDS_STORE"] = str(self.fx.store)
        command = [
            sys.executable,
            "-m",
            "oak_manuscript_core",
            "plan-rulepack-upgrade",
            "--project",
            str(self.project.root),
            "--to-manifest-sha256",
            self.target_sha,
        ]
        planned = subprocess.run(
            command,
            cwd=str(PYTHON_ROOT),
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(planned.returncode, 0, planned.stderr)
        payload = json.loads(planned.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(_tree_bytes(self.project.root), before)

        applied = subprocess.run(
            [
                sys.executable,
                "-m",
                "oak_manuscript_core",
                "upgrade-rulepack",
                "--project",
                str(self.project.root),
                "--to-manifest-sha256",
                self.target_sha,
                "--plan-id",
                payload["plan_id"],
            ],
            cwd=str(PYTHON_ROOT),
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(applied.returncode, 0, applied.stderr)
        result = json.loads(applied.stdout)
        self.assertEqual(result["rulepack"]["manifest_sha256"], self.target_sha)
        self.assertTrue(Project.open(self.project.root).data["rulepack_check_required"])


if __name__ == "__main__":
    unittest.main()
