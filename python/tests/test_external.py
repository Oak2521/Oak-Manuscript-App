"""外部验证工具测试（EpubCheck / 阶段化 Ace）。

工具缺失的机器上自动跳过（unittest.skipUnless），统一测试入口不因此失败。
Ace 较慢（数十秒），默认跳过，设 OAK_TEST_ACE=1 启用。
"""

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from oak_manuscript_core import ops
from oak_manuscript_core.external import (
    _chrome_candidates,
    _jre_lock_relative,
    _sanitized_java_env,
    _sanitized_process_env,
    _trusted_bundled_java,
    _trusted_epubcheck_distribution,
    _trusted_staged_ace,
    build_ace_command,
    discover_tools,
    evaluate_ace_report,
    run_ace,
    run_epubcheck,
)
from oak_manuscript_core.errors import OakError
from oak_manuscript_core.project import Project
from oak_manuscript_core.reports import render_markdown
from oak_manuscript_core.rulepack import load_rulepack

REPO = Path(__file__).resolve().parents[2]
PACK = load_rulepack(REPO / "config" / "rule-packs" / "oak-rules-2.1.0.json")
SAMPLES = REPO / "samples"
ACE_CONTROLLED_RUNNER = (
    REPO / "scripts" / "patches" / "ace-axe-runner-puppeteer-1.4.6.js"
)
ACE_PATCH_BEFORE_SHA256 = (
    "681b52d047d5f6eebbfc62a925b7dc22b82589ab63b36a9ea602297f8cd86ea6"
)
ACE_PATCH_AFTER_SHA256 = (
    "6c7da7364d05548355fb1ab90c3d6d77366e2fd01b6f67551b648c5fb8285614"
)
TOOLS = discover_tools()
HAS_EPUBCHECK = bool(TOOLS["epubcheck_jar"] and TOOLS["java"])
HAS_ACE = bool(TOOLS["ace"] and TOOLS["chrome"]) and os.environ.get("OAK_TEST_ACE") == "1"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audited_runner_fixture() -> bytes:
    controlled = (
        ACE_CONTROLLED_RUNNER.read_text(encoding="utf-8")
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .encode("utf-8")
    )
    if hashlib.sha256(controlled).hexdigest() != ACE_PATCH_AFTER_SHA256:
        raise AssertionError("Ace 1.4.6 受控替换 runner 哈希漂移")
    return controlled


def make_staged_ace(root: Path) -> Path:
    tool = root / "tools" / "ace"
    entry = tool / "ace.js"
    target = tool / "node_modules" / "@daisy" / "ace-axe-runner-puppeteer" / "lib" / "index.js"
    dependency = tool / "node_modules" / "runtime-dependency" / "index.js"
    sanitizer = tool / "node_modules" / "@xmldom" / "xmldom" / "package.json"
    target.parent.mkdir(parents=True)
    dependency.parent.mkdir(parents=True)
    sanitizer.parent.mkdir(parents=True)
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_bytes(
        b'#!/usr/bin/env node\n"use strict";\n'
        b'require("./node_modules/@daisy/ace-cli/bin/ace.js");\n'
    )
    target.write_bytes(audited_runner_fixture())
    dependency.write_text("module.exports = 'runtime';\n", encoding="utf-8")
    sanitizer.write_text(
        json.dumps({"name": "@xmldom/xmldom", "version": "0.9.10"}) + "\n",
        encoding="utf-8",
    )

    def record(path: Path) -> dict:
        return {
            "path": path.relative_to(tool).as_posix(),
            "size_bytes": path.stat().st_size,
            "sha256": sha256(path),
        }

    packages = [{
        "name": "@daisy/ace-cli",
        "version": "1.4.6",
        "path": "node_modules/@daisy/ace-cli",
    }]
    files = [record(entry), record(target), record(dependency), record(sanitizer)]
    manifest = {
        "schema_version": "1.0",
        "root_package": {"name": "@daisy/ace-cli", "version": "1.4.6"},
        "entry": "ace.js",
        "package_count": len(packages),
        "file_count": len(files),
        "total_bytes": sum(item["size_bytes"] for item in files),
        "packages": packages,
        "patches": [{
            "patch_id": "OAK-ACE-ISOLATION-002",
            "target_package": "@daisy/ace-axe-runner-puppeteer",
            "target_version": "1.4.6",
            "target_file": "node_modules/@daisy/ace-axe-runner-puppeteer/lib/index.js",
            "before_sha256": ACE_PATCH_BEFORE_SHA256,
            "after_sha256": ACE_PATCH_AFTER_SHA256,
            "controlled_replacement": "scripts/patches/ace-axe-runner-puppeteer-1.4.6.js",
            "sanitizer": {
                "package_name": "@xmldom/xmldom",
                "package_version": "0.9.10",
            },
            "effect": (
                "作者 XHTML 在 JavaScript 禁用状态下清洗；仅放行 basedir 内 file:；"
                "OS 级网络隔离仍是正式发布阻断项"
            ),
        }],
        "files": files,
    }
    manifest_path = tool / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    lock = {
        "schema_version": "1.0",
        "lock_type": "oak-ace-stage",
        "tool": {"name": "@daisy/ace-cli", "version": "1.4.6"},
        "stage_manifest_sha256": sha256(manifest_path),
        "entry": manifest["entry"],
        "package_count": manifest["package_count"],
        "file_count": manifest["file_count"],
        "total_bytes": manifest["total_bytes"],
        "package_closure": packages,
        "patches": manifest["patches"],
        "files": manifest["files"],
    }
    lock_path = root / "config" / "tool-manifests" / "ace-1.4.6.json"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text(
        json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return entry


def make_staged_jre(
    root: Path,
    *,
    directory: str = "jre-win32-x64",
    platform_name: str = "win32",
    arch: str = "x64",
) -> Path:
    runtime = root / "tools" / directory
    entry_relative = "bin/java.exe" if platform_name == "win32" else "bin/java"
    entry = runtime.joinpath(*entry_relative.split("/"))
    runtime_modules = ["java.base", "java.se", "java.xml", "jdk.unsupported", "jdk.xml.dom"]
    files = {
        entry_relative: b"fake java runtime\n",
        "NOTICE": b"Temurin notice\n",
        "SOURCE_JDK_RELEASE.txt": b'IMPLEMENTOR="Eclipse Adoptium"\n',
        "THIRD_PARTY_NOTICES.md": b"Temurin notices\n",
    }
    files.update({
        f"legal/{module_name}/LICENSE": b"GPLv2 with Classpath Exception\n"
        for module_name in runtime_modules
    })
    for relative, content in files.items():
        target = runtime.joinpath(*relative.split("/"))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    records = [{
        "path": relative,
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    } for relative, content in sorted(files.items())]
    manifest = {
        "schema_version": "1.0",
        "runtime": {
            "distribution": "Temurin",
            "vendor": "Eclipse Adoptium",
            "implementor_version": "Temurin-21.0.11+10",
            "java_version": "21.0.11",
            "java_runtime_version": "21.0.11+10-LTS",
            "feature_version": 21,
        },
        "target": {"platform": platform_name, "arch": arch},
        "entry": entry_relative,
        "module_policy": "fixed-conservative-java-se",
        "requested_modules": ["java.se", "jdk.unsupported", "jdk.xml.dom"],
        "modules": runtime_modules,
        "jdeps_modules": ["java.base", "java.xml"],
        "source_jdk": {
            "release_file": "SOURCE_JDK_RELEASE.txt",
            "release_sha256": hashlib.sha256(files["SOURCE_JDK_RELEASE.txt"]).hexdigest(),
            "notice_file": "NOTICE",
            "notice_sha256": hashlib.sha256(files["NOTICE"]).hexdigest(),
        },
        "epubcheck_probe": {
            "version": "5.3.0",
            "checker_version": "5.3.0",
            "n_fatal": 0,
            "n_error": 0,
            "n_warning": 0,
        },
        "license_materials": sorted([
            "NOTICE",
            "SOURCE_JDK_RELEASE.txt",
            "THIRD_PARTY_NOTICES.md",
            *(f"legal/{module_name}/LICENSE" for module_name in runtime_modules),
        ]),
        "file_count": len(records),
        "total_bytes": sum(item["size_bytes"] for item in records),
        "files": records,
    }
    manifest_path = runtime / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    lock_path = (
        root / "config" / "tool-manifests"
        / f"jre-{platform_name}-{arch}.json"
    )
    distribution_manifest = root / "config" / "tool-manifests" / "epubcheck-5.3.0.json"
    distribution_manifest.parent.mkdir(parents=True, exist_ok=True)
    if not distribution_manifest.exists():
        distribution_manifest.write_text("{}\n", encoding="utf-8")
    lock = {
        "schema_version": "1.0",
        "lock_type": "oak-jre-runtime",
        "target": {"platform": platform_name, "arch": arch},
        "runtime": manifest["runtime"],
        "source_jdk": {
            "release_sha256": manifest["source_jdk"]["release_sha256"],
            "java_sha256": "1" * 64,
            "jdeps_sha256": "2" * 64,
            "jlink_sha256": "3" * 64,
            "tree_file_count": 10,
            "tree_total_bytes": 1000,
            "tree_sha256": "4" * 64,
        },
        "epubcheck_distribution_manifest_sha256": sha256(distribution_manifest),
        "formal_source_provenance_audit_required": True,
        "runtime_manifest_sha256": sha256(manifest_path),
    }
    lock_path.write_text(json.dumps(lock), encoding="utf-8")
    return entry


def make_epubcheck_distribution(root: Path) -> Path:
    distribution = root / "tools" / "epubcheck-5.3.0"
    manifest_path = root / "config" / "tool-manifests" / "epubcheck-5.3.0.json"
    required = [
        "CHANGELOG.txt",
        "LICENSE.txt",
        "README.txt",
        "THIRD-PARTY.txt",
        "epubcheck.jar",
        "licenses/Apache-2.0.txt",
        "licenses/BSD-3-Clause.txt",
        "licenses/MIT.txt",
        "licenses/MPL-2.0.txt",
        "licenses/W3C.txt",
    ]
    files = {relative: f"fixture {relative}\n".encode("utf-8") for relative in required}
    files["lib/dependency.jar"] = b"fixture dependency\n"
    for relative, content in files.items():
        target = distribution.joinpath(*relative.split("/"))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    records = [{
        "path": relative,
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    } for relative, content in sorted(files.items())]
    licenses = [
        relative for relative in sorted(files)
        if relative in {"LICENSE.txt", "THIRD-PARTY.txt"}
        or relative.startswith("licenses/")
    ]
    manifest = {
        "schema_version": "1.0",
        "tool": {"name": "EpubCheck", "version": "5.3.0"},
        "distribution": "tools/epubcheck-5.3.0",
        "entry": "epubcheck.jar",
        "required_files": required,
        "license_files": licenses,
        "formal_provenance_audit_required": True,
        "file_count": len(records),
        "total_bytes": sum(item["size_bytes"] for item in records),
        "files": records,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return distribution / "epubcheck.jar"


class EpubCheckDistributionIntegrityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-epubcheck-integrity-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.entry = make_epubcheck_distribution(self.tmp)

    def test_complete_distribution_is_trusted(self):
        self.assertEqual(_trusted_epubcheck_distribution(self.tmp), self.entry)

    def test_changed_or_extra_dependency_is_rejected(self):
        dependency = self.entry.parent / "lib" / "dependency.jar"
        dependency.write_bytes(b"tampered\n")
        self.assertIsNone(_trusted_epubcheck_distribution(self.tmp))

        shutil.rmtree(self.tmp)
        self.tmp.mkdir()
        self.entry = make_epubcheck_distribution(self.tmp)
        (self.entry.parent / "lib" / "extra.jar").write_bytes(b"extra\n")
        self.assertIsNone(_trusted_epubcheck_distribution(self.tmp))

    def test_relaxed_provenance_flag_is_rejected(self):
        manifest_path = self.tmp / "config" / "tool-manifests" / "epubcheck-5.3.0.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["formal_provenance_audit_required"] = False
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        self.assertIsNone(_trusted_epubcheck_distribution(self.tmp))


class StagedAceIntegrityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-ace-integrity-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.entry = make_staged_ace(self.tmp)
        self.tool = self.tmp / "tools" / "ace"
        self.manifest_path = self.tool / "manifest.json"

    def test_complete_manifest_is_trusted(self):
        self.assertEqual(_trusted_staged_ace(self.tmp), self.entry)
        lock_path = self.tmp / "config" / "tool-manifests" / "ace-1.4.6.json"
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        lock["tool"]["version"] = "1.4.7"
        lock_path.write_text(json.dumps(lock), encoding="utf-8")
        self.assertIsNone(_trusted_staged_ace(self.tmp))

    def test_self_described_dynamic_runner_hash_is_rejected(self):
        target = (
            self.tool / "node_modules" / "@daisy"
            / "ace-axe-runner-puppeteer" / "lib" / "index.js"
        )
        target.write_text("// attacker-controlled runner\n", encoding="utf-8")
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        dynamic_hash = sha256(target)
        target_record = next(
            item for item in manifest["files"] if item["path"].endswith("/lib/index.js")
        )
        target_record["size_bytes"] = target.stat().st_size
        target_record["sha256"] = dynamic_hash
        manifest["patches"][0]["after_sha256"] = dynamic_hash
        self.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        self.assertIsNone(_trusted_staged_ace(self.tmp))

    def test_modified_launcher_with_matching_manifest_hash_is_rejected(self):
        self.entry.write_text("require('./attacker.js');\n", encoding="utf-8")
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        entry_record = next(item for item in manifest["files"] if item["path"] == "ace.js")
        entry_record["size_bytes"] = self.entry.stat().st_size
        entry_record["sha256"] = sha256(self.entry)
        self.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        self.assertIsNone(_trusted_staged_ace(self.tmp))

    def test_root_version_and_patch_gate_are_pinned_and_unique(self):
        original = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        mutations = {
            "root version": lambda item: item["root_package"].update(version="1.4.7"),
            "second patch": lambda item: item["patches"].append(dict(item["patches"][0])),
            "patch id": lambda item: item["patches"][0].update(patch_id="custom"),
            "target package": lambda item: item["patches"][0].update(target_package="custom"),
            "target version": lambda item: item["patches"][0].update(target_version="1.4.7"),
            "target file": lambda item: item["patches"][0].update(target_file="ace.js"),
            "before hash": lambda item: item["patches"][0].update(before_sha256="0" * 64),
            "after hash": lambda item: item["patches"][0].update(after_sha256="0" * 64),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                manifest = json.loads(json.dumps(original))
                mutate(manifest)
                self.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                self.assertIsNone(_trusted_staged_ace(self.tmp))

    def test_tampered_non_entry_dependency_is_rejected(self):
        dependency = self.tool / "node_modules" / "runtime-dependency" / "index.js"
        dependency.write_text("module.exports = 'tampered';\n", encoding="utf-8")
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        record = next(
            item for item in manifest["files"]
            if item["path"] == "node_modules/runtime-dependency/index.js"
        )
        record["size_bytes"] = dependency.stat().st_size
        record["sha256"] = sha256(dependency)
        manifest["total_bytes"] = sum(item["size_bytes"] for item in manifest["files"])
        self.manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        self.assertIsNone(_trusted_staged_ace(self.tmp))

    def test_extra_unlisted_javascript_is_rejected(self):
        (self.tool / "extra.js").write_text("throw new Error('extra');\n", encoding="utf-8")
        self.assertIsNone(_trusted_staged_ace(self.tmp))

    def test_duplicate_manifest_path_is_rejected(self):
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        manifest["files"].append(dict(manifest["files"][0]))
        self.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        self.assertIsNone(_trusted_staged_ace(self.tmp))

    def test_escaping_manifest_path_is_rejected(self):
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        manifest["files"][0]["path"] = "../ace.js"
        self.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        self.assertIsNone(_trusted_staged_ace(self.tmp))


class BundledJreDiscoveryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-jre-discovery-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_development_prefers_trusted_staged_jre_over_path(self):
        bundled = make_staged_jre(self.tmp)
        tools = discover_tools(
            self.tmp,
            platform_name="Windows",
            machine_name="AMD64",
            packaged=False,
            which_func=lambda name: "C:/system/java.exe" if name == "java" else None,
        )
        self.assertEqual(tools["java"], str(bundled))
        self.assertEqual(tools["java_source"], "bundled")

    def test_lock_path_is_derived_from_exact_target(self):
        self.assertEqual(
            _jre_lock_relative("win32", "x64"),
            "config/tool-manifests/jre-win32-x64.json",
        )
        self.assertEqual(
            _jre_lock_relative("darwin", "x64"),
            "config/tool-manifests/jre-darwin-x64.json",
        )
        self.assertEqual(
            _jre_lock_relative("darwin", "arm64"),
            "config/tool-manifests/jre-darwin-arm64.json",
        )
        self.assertIsNone(_jre_lock_relative("linux", "x64"))
        self.assertIsNone(_jre_lock_relative("darwin", "ppc64"))

    def test_macos_x64_and_arm64_select_their_own_locks(self):
        for arch, machine in (("x64", "x86_64"), ("arm64", "arm64")):
            with self.subTest(arch=arch):
                root = self.tmp / arch
                bundled = make_staged_jre(
                    root,
                    directory=f"jre-darwin-{arch}",
                    platform_name="darwin",
                    arch=arch,
                )
                tools = discover_tools(
                    root,
                    platform_name="Darwin",
                    machine_name=machine,
                    packaged=False,
                    which_func=lambda _name: None,
                )
                self.assertEqual(tools["java"], str(bundled))
                self.assertEqual(tools["java_source"], "bundled")

    def test_development_can_fallback_to_system_java_only_when_bundle_is_absent(self):
        tools = discover_tools(
            self.tmp,
            platform_name="Windows",
            machine_name="AMD64",
            packaged=False,
            which_func=lambda name: "C:/system/java.exe" if name == "java" else None,
        )
        self.assertEqual(tools["java"], "C:/system/java.exe")
        self.assertEqual(tools["java_source"], "system")

    def test_packaged_mode_uses_only_canonical_bundle_and_never_path(self):
        canonical = make_staged_jre(self.tmp, directory="jre")
        tools = discover_tools(
            self.tmp,
            platform_name="Windows",
            machine_name="AMD64",
            packaged=True,
            which_func=lambda name: "C:/system/java.exe" if name == "java" else None,
        )
        self.assertEqual(tools["java"], str(canonical))
        self.assertEqual(tools["java_source"], "bundled")

        canonical.write_bytes(b"tampered\n")
        rejected = discover_tools(
            self.tmp,
            platform_name="Windows",
            machine_name="AMD64",
            packaged=True,
            which_func=lambda name: "C:/system/java.exe" if name == "java" else None,
        )
        self.assertIsNone(rejected["java"])
        self.assertIsNone(rejected["java_source"])

    def test_packaged_mode_missing_bundle_does_not_fallback_to_path(self):
        tools = discover_tools(
            self.tmp,
            environ={"OAK_APP_PACKAGED": "1"},
            platform_name="Windows",
            machine_name="AMD64",
            which_func=lambda name: "C:/system/java.exe" if name == "java" else None,
        )
        self.assertIsNone(tools["java"])
        self.assertIsNone(tools["java_source"])

    def test_platform_and_arch_manifest_mismatch_is_rejected(self):
        entry = make_staged_jre(self.tmp)
        runtime = entry.parents[1]
        self.assertIsNone(_trusted_bundled_java(
            runtime, expected_platform="darwin", expected_arch="x64"
        ))
        self.assertIsNone(_trusted_bundled_java(
            runtime, expected_platform="win32", expected_arch="arm64"
        ))


class AceDiscoveryAndCommandTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-ace-discovery-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.entry = make_staged_ace(self.tmp)
        self.node = self.tmp / "node.exe"
        self.node.write_bytes(b"node")
        self.program_files = self.tmp / "ProgramFiles"
        self.chrome = self.program_files / "Google" / "Chrome" / "Application" / "chrome.exe"
        self.chrome.parent.mkdir(parents=True)
        self.chrome.write_bytes(b"chrome")

    def test_packaged_discovery_exposes_fixed_entry_for_utility_process(self):
        tools = discover_tools(
            self.tmp,
            environ={
                "OAK_APP_PACKAGED": "1",
                "ProgramFiles": str(self.program_files),
                "ProgramFiles(x86)": str(self.tmp / "ProgramFilesX86"),
            },
            platform_name="Windows",
            which_func=lambda _name: None,
        )
        self.assertIsNone(tools["ace"])
        self.assertEqual(tools["ace_entry"], str(self.entry))
        self.assertIsNone(tools["ace_runtime"])
        self.assertIsNone(tools["ace_runtime_kind"])
        self.assertEqual(tools["chrome"], str(self.chrome))

        without_host = discover_tools(
            self.tmp,
            environ={
                "OAK_APP_PACKAGED": "1",
                "ProgramFiles": str(self.program_files),
                "ProgramFiles(x86)": str(self.tmp / "ProgramFilesX86"),
            },
            platform_name="Windows",
            which_func=lambda name: str(self.node) if name == "node" else None,
        )
        self.assertIsNone(without_host["ace"])
        self.assertIsNone(without_host["ace_runtime"])

    def test_development_discovery_uses_system_node_for_the_same_staged_entry(self):
        tools = discover_tools(
            self.tmp,
            environ={"ProgramFiles": str(self.program_files)},
            platform_name="Windows",
            which_func=lambda name: str(self.node) if name == "node" else None,
        )
        self.assertEqual(tools["ace"], str(self.entry))
        self.assertEqual(tools["ace_runtime_kind"], "node")
        self.assertEqual(tools["ace_runtime"], str(self.node.resolve()))

    def test_command_uses_fixed_entry_and_development_node(self):
        command, updates, kind = build_ace_command(
            self.entry, node_exec=self.node
        )
        self.assertEqual(command, [str(self.node.resolve()), str(self.entry.resolve())])
        self.assertEqual(updates, {})
        self.assertEqual(kind, "node")

    def test_macos_chrome_candidates_cover_system_and_user_applications(self):
        candidates = [path.as_posix() for path in _chrome_candidates(
            environ={"HOME": "/Users/oak"}, platform_name="Darwin"
        )]
        self.assertIn(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", candidates
        )
        self.assertIn(
            "/Users/oak/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
            candidates,
        )

    def test_no_runtime_keeps_ace_not_discoverable(self):
        tools = discover_tools(
            self.tmp,
            environ={"ProgramFiles": str(self.program_files)},
            platform_name="Windows",
            which_func=lambda _name: None,
        )
        self.assertIsNone(tools["ace"])
        self.assertEqual(tools["ace_entry"], str(self.entry))


class AceInvocationSafetyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-ace-run-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.entry = make_staged_ace(self.tmp)
        self.node = self.tmp / "node.exe"
        self.chrome = self.tmp / "chrome.exe"
        self.epub = self.tmp / "book.epub"
        for path in (self.node, self.chrome, self.epub):
            path.write_bytes(b"fixture")
        self.out = self.tmp / "report"

    def test_run_ace_uses_fixed_args_shell_false_and_sanitized_environment(self):
        captured = {}

        def fake_run(command, **kwargs):
            captured["command"] = command
            captured.update(kwargs)
            self.assertTrue(self.out.is_dir())
            (self.out / "report.json").write_text(json.dumps({
                "earl:result": {"earl:outcome": "pass"},
                "assertions": [],
            }), encoding="utf-8")
            return SimpleNamespace(returncode=0)

        injected = {
            "NODE_OPTIONS": "--require C:/evil.js",
            "NODE_PATH": "C:/evil-modules",
            "ELECTRON_RUN_AS_NODE": "attacker-value",
            "ELECTRON_NO_ASAR": "1",
            "PUPPETEER_EXECUTABLE_PATH": "C:/evil-chrome.exe",
            "OAK_UNTRUSTED_VALUE": "must-not-inherit",
            "ACE_TIMEOUT_INITIAL": "1",
            "LD_PRELOAD": "/tmp/evil.so",
        }
        with patch.dict(os.environ, injected, clear=False):
            with patch("oak_manuscript_core.external.subprocess.run", side_effect=fake_run):
                result = run_ace(
                    self.epub,
                    self.out,
                    ace=str(self.entry),
                    chrome=str(self.chrome),
                    node_exec=str(self.node),
                )

        self.assertEqual(result["status"], "passed")
        self.assertEqual(captured["command"], [
            str(self.node.resolve()),
            str(self.entry.resolve()),
            "-f", "-o", str(self.out), str(self.epub),
        ])
        self.assertIs(captured["shell"], False)
        child_env = captured["env"]
        for key in injected:
            if key not in {"PUPPETEER_EXECUTABLE_PATH", "ACE_TIMEOUT_INITIAL"}:
                self.assertNotIn(key, child_env)
        self.assertNotIn("ELECTRON_RUN_AS_NODE", child_env)
        self.assertEqual(child_env["PUPPETEER_EXECUTABLE_PATH"], str(self.chrome.resolve()))
        self.assertEqual(child_env["ACE_TIMEOUT_INITIAL"], "30000")

    def test_stale_pass_report_cannot_mask_nonzero_process(self):
        self.out.mkdir(parents=True)
        stale_report = self.out / "report.json"
        stale_report.write_text(json.dumps({
            "earl:result": {"earl:outcome": "pass"},
            "assertions": [],
        }), encoding="utf-8")

        def fail_without_report(_command, **_kwargs):
            self.assertTrue(self.out.is_dir())
            self.assertFalse(stale_report.exists(), "调用前必须清除旧报告")
            return SimpleNamespace(returncode=1)

        with patch(
            "oak_manuscript_core.external.subprocess.run", side_effect=fail_without_report
        ):
            result = run_ace(
                self.epub,
                self.out,
                ace=str(self.entry),
                chrome=str(self.chrome),
                node_exec=str(self.node),
            )
        self.assertEqual(result["status"], "not_run")
        self.assertIn("未生成安全的本次报告", result["detail"])
        self.assertFalse(stale_report.exists())

    def test_nonzero_exit_with_valid_fail_report_is_not_run(self):
        def fail_with_report(_command, **_kwargs):
            (self.out / "report.json").write_text(json.dumps({
                "earl:result": {"earl:outcome": "fail"},
                "assertions": [],
            }), encoding="utf-8")
            return SimpleNamespace(returncode=1)

        with patch(
            "oak_manuscript_core.external.subprocess.run", side_effect=fail_with_report
        ):
            result = run_ace(
                self.epub,
                self.out,
                ace=str(self.entry),
                chrome=str(self.chrome),
                node_exec=str(self.node),
            )
        self.assertEqual(result["status"], "not_run")
        self.assertIn("报告为 fail", result["detail"])
        self.assertIn("退出码为 1", result["detail"])

    def test_zero_exit_with_valid_fail_report_is_failed(self):
        def fail_with_report(_command, **_kwargs):
            (self.out / "report.json").write_text(json.dumps({
                "earl:result": {"earl:outcome": "fail"},
                "assertions": [{"assertions": [{"rule": "fixture"}]}],
            }), encoding="utf-8")
            return SimpleNamespace(returncode=0)

        with patch(
            "oak_manuscript_core.external.subprocess.run", side_effect=fail_with_report
        ):
            result = run_ace(
                self.epub,
                self.out,
                ace=str(self.entry),
                chrome=str(self.chrome),
                node_exec=str(self.node),
            )
        self.assertEqual(result["status"], "failed")
        self.assertIn("整体 fail", result["detail"])

    def test_outcome_and_violation_count_mismatches_are_not_run(self):
        cases = (
            ("pass", [{"assertions": [{"rule": "unexpected"}]}]),
            ("fail", []),
        )
        for outcome, assertions in cases:
            with self.subTest(outcome=outcome, assertions=assertions):
                def inconsistent_report(_command, **_kwargs):
                    (self.out / "report.json").write_text(json.dumps({
                        "earl:result": {"earl:outcome": outcome},
                        "assertions": assertions,
                    }), encoding="utf-8")
                    return SimpleNamespace(returncode=0)

                with patch(
                    "oak_manuscript_core.external.subprocess.run",
                    side_effect=inconsistent_report,
                ):
                    result = run_ace(
                        self.epub,
                        self.out,
                        ace=str(self.entry),
                        chrome=str(self.chrome),
                        node_exec=str(self.node),
                    )
                self.assertEqual(result["status"], "not_run")
                self.assertIn("outcome 与断言数量不一致", result["detail"])

    def test_unsafe_output_file_is_rejected_without_launching(self):
        self.out.write_text("not a directory", encoding="utf-8")
        with patch("oak_manuscript_core.external.subprocess.run") as run:
            result = run_ace(
                self.epub,
                self.out,
                ace=str(self.entry),
                chrome=str(self.chrome),
                node_exec=str(self.node),
            )
        self.assertEqual(result["status"], "not_run")
        run.assert_not_called()

    def test_timeout_is_not_misreported_as_a_manuscript_failure(self):
        with patch(
            "oak_manuscript_core.external.subprocess.run",
            side_effect=subprocess.TimeoutExpired([str(self.node)], 300),
        ):
            result = run_ace(
                self.epub, self.out, ace=str(self.entry), chrome=str(self.chrome),
                node_exec=str(self.node),
            )
        self.assertEqual(result["status"], "not_run")
        self.assertIn("超时", result["detail"])

    def test_missing_chrome_or_runtime_is_truthfully_not_run(self):
        with patch("oak_manuscript_core.external.subprocess.run") as run:
            missing_chrome = run_ace(
                self.epub, self.out, ace=str(self.entry), chrome=None,
                node_exec=str(self.node),
            )
            with patch.dict(os.environ, {}, clear=True):
                with patch("oak_manuscript_core.external.shutil.which", return_value=None):
                    missing_runtime = run_ace(
                        self.epub, self.out, ace=str(self.entry), chrome=str(self.chrome)
                    )
        self.assertEqual(missing_chrome["status"], "not_run")
        self.assertEqual(missing_runtime["status"], "not_run")

        with patch.dict(os.environ, {"OAK_APP_PACKAGED": "1"}, clear=True):
            packaged_without_host = run_ace(
                self.epub,
                self.out,
                ace=str(self.entry),
                chrome=str(self.chrome),
                node_exec=str(self.node),
            )
        self.assertEqual(packaged_without_host["status"], "not_run")
        self.assertIn("受控 Node.js 宿主", packaged_without_host["detail"])
        run.assert_not_called()

    def test_arbitrary_script_is_never_executed(self):
        arbitrary = self.tmp / "attacker.js"
        arbitrary.write_text("throw new Error('must not run');\n", encoding="utf-8")
        with patch("oak_manuscript_core.external.subprocess.run") as run:
            result = run_ace(
                self.epub, self.out, ace=str(arbitrary), chrome=str(self.chrome),
                node_exec=str(self.node),
            )
        self.assertEqual(result["status"], "not_run")
        run.assert_not_called()

    def test_sanitizer_removes_case_insensitive_node_and_electron_injection(self):
        clean = _sanitized_process_env({
            "Path": "C:/Windows",
            "node_options": "--inspect",
            "Electron_Run_As_Node": "0",
            "PUPPETEER_FOO": "bar",
            "SAFE_VALUE": "kept",
        })
        self.assertEqual(clean, {"Path": "C:/Windows", "SAFE_VALUE": "kept"})


class EpubcheckInvocationSafetyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-epubcheck-run-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.epub = self.tmp / "book.epub"
        self.jar = self.tmp / "epubcheck.jar"
        self.java = self.tmp / "java.exe"
        for target in (self.epub, self.jar, self.java):
            target.write_bytes(b"fixture")
        self.report = self.tmp / "report.json"

    @staticmethod
    def report_data(*, fatals=0, errors=0, warnings=0):
        return {
            "checker": {
                "checkerVersion": "5.3.0",
                "nFatal": fatals,
                "nError": errors,
                "nWarning": warnings,
            }
        }

    def test_stale_report_is_removed_and_valid_current_pass_is_required(self):
        self.report.write_text(json.dumps(self.report_data(errors=9)), encoding="utf-8")
        captured = {}

        def complete(command, **kwargs):
            captured["command"] = command
            captured.update(kwargs)
            self.assertFalse(self.report.exists(), "调用前必须清除旧 EpubCheck 报告")
            self.report.write_text(json.dumps(self.report_data()), encoding="utf-8")
            return SimpleNamespace(returncode=0)

        injected = {
            "CLASSPATH": "C:/evil.jar",
            "JAVA_TOOL_OPTIONS": "-javaagent:C:/evil.jar",
            "JDK_JAVA_OPTIONS": "--module-path=C:/evil",
            "_JAVA_OPTIONS": "-Duser.home=C:/evil",
            "SAFE_VALUE": "kept",
        }
        with patch.dict(os.environ, injected, clear=False):
            with patch("oak_manuscript_core.external.subprocess.run", side_effect=complete):
                result = run_epubcheck(
                    self.epub, self.report, jar=str(self.jar), java=str(self.java)
                )
        self.assertEqual(result["status"], "passed")
        self.assertIs(captured["shell"], False)
        self.assertEqual(captured["command"], [
            str(self.java), "-jar", str(self.jar), "--json", str(self.report), str(self.epub)
        ])
        for key in injected:
            if key != "SAFE_VALUE":
                self.assertNotIn(key, captured["env"])
        self.assertEqual(captured["env"]["SAFE_VALUE"], "kept")

    def test_validation_errors_are_failed_even_with_nonzero_exit(self):
        def complete(_command, **_kwargs):
            self.report.write_text(
                json.dumps(self.report_data(fatals=1, errors=2, warnings=3)),
                encoding="utf-8",
            )
            return SimpleNamespace(returncode=1)

        with patch("oak_manuscript_core.external.subprocess.run", side_effect=complete):
            result = run_epubcheck(
                self.epub, self.report, jar=str(self.jar), java=str(self.java)
            )
        self.assertEqual(result["status"], "failed")
        self.assertIn("1 fatal / 2 error / 3 warning", result["detail"])

    def test_crash_without_current_report_is_truthfully_not_run(self):
        self.report.write_text(json.dumps(self.report_data()), encoding="utf-8")

        def crash(_command, **_kwargs):
            self.assertFalse(self.report.exists())
            return SimpleNamespace(returncode=2)

        with patch("oak_manuscript_core.external.subprocess.run", side_effect=crash):
            result = run_epubcheck(
                self.epub, self.report, jar=str(self.jar), java=str(self.java)
            )
        self.assertEqual(result["status"], "not_run")
        self.assertIn("未生成合法的本次报告", result["detail"])

    def test_timeout_and_start_error_are_truthfully_not_run(self):
        for side_effect, marker in [
            (subprocess.TimeoutExpired([str(self.java)], 300), "超时"),
            (OSError("blocked"), "无法启动"),
        ]:
            with self.subTest(marker=marker):
                with patch(
                    "oak_manuscript_core.external.subprocess.run", side_effect=side_effect
                ):
                    result = run_epubcheck(
                        self.epub, self.report, jar=str(self.jar), java=str(self.java)
                    )
                self.assertEqual(result["status"], "not_run")
                self.assertIn(marker, result["detail"])

    def test_exit_code_and_report_count_mismatches_are_not_run(self):
        cases = [
            (0, self.report_data(errors=1)),
            (1, self.report_data()),
            (2, self.report_data()),
            (2, self.report_data(errors=1)),
        ]
        for returncode, report in cases:
            with self.subTest(returncode=returncode, report=report):
                def inconsistent(_command, **_kwargs):
                    self.report.write_text(json.dumps(report), encoding="utf-8")
                    return SimpleNamespace(returncode=returncode)

                with patch(
                    "oak_manuscript_core.external.subprocess.run", side_effect=inconsistent
                ):
                    result = run_epubcheck(
                        self.epub, self.report, jar=str(self.jar), java=str(self.java)
                    )
                self.assertEqual(result["status"], "not_run")
                self.assertIn("退出码与报告计数不一致", result["detail"])

    def test_report_version_mismatch_is_not_run(self):
        report = self.report_data()
        report["checker"]["checkerVersion"] = "5.4.0"

        def mismatched(_command, **_kwargs):
            self.report.write_text(json.dumps(report), encoding="utf-8")
            return SimpleNamespace(returncode=0)

        with patch("oak_manuscript_core.external.subprocess.run", side_effect=mismatched):
            result = run_epubcheck(
                self.epub, self.report, jar=str(self.jar), java=str(self.java)
            )
        self.assertEqual(result["status"], "not_run")
        self.assertIn("固定版本 5.3.0 不一致", result["detail"])

    def test_java_sanitizer_is_case_insensitive(self):
        self.assertEqual(_sanitized_java_env({
            "Path": "C:/Windows",
            "classpath": "evil",
            "Java_Tool_Options": "evil",
            "SAFE": "kept",
        }), {"Path": "C:/Windows", "SAFE": "kept"})


@unittest.skipUnless(HAS_EPUBCHECK, "本机没有 EpubCheck + Java，跳过")
class EpubcheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_good_sample_passes(self):
        r = run_epubcheck(SAMPLES / "epub_good.epub", self.tmp / "r.json",
                          jar=TOOLS["epubcheck_jar"], java=TOOLS["java"])
        self.assertEqual(r["status"], "passed", r["detail"])

    def test_defect_sample_fails(self):
        r = run_epubcheck(SAMPLES / "epub_needs_review.epub", self.tmp / "r.json",
                          jar=TOOLS["epubcheck_jar"], java=TOOLS["java"])
        self.assertEqual(r["status"], "failed")
        self.assertIn("error", r["detail"])

    def test_exported_basic_epub_passes_epubcheck(self):
        """基础 EPUB 导出的产物必须真实通过 EpubCheck（不只是自检）。"""
        import stat

        proj = Project.create(SAMPLES / "paper_good.docx", self.tmp / "proj",
                              manuscript_type="paper", epub_preview=True)
        self.addCleanup(lambda: [
            os.chmod(os.path.join(r, f), stat.S_IWRITE)
            for r, _d, fs in os.walk(self.tmp) for f in fs
        ])
        ops.run_check(proj, PACK)
        written = ops.export_project(proj, PACK)
        preview = next(p for p in written if p.name == "preview.epub")
        r = run_epubcheck(preview, self.tmp / "p.json",
                          jar=TOOLS["epubcheck_jar"], java=TOOLS["java"])
        self.assertEqual(r["status"], "passed", r["detail"])


class ExternalTwoPhaseProtocolTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-external-plan-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.project = Project.create(
            SAMPLES / "epub_good.epub", self.tmp / "project", manuscript_type="ebook"
        )
        ops.run_check(self.project, PACK)
        self.entry = make_staged_ace(self.tmp / "runtime")
        self.chrome = self.tmp / "chrome.exe"
        self.java = self.tmp / "java.exe"
        self.jar = self.tmp / "epubcheck.jar"
        for target in (self.chrome, self.java, self.jar):
            target.write_bytes(b"fixed external tool\n")
        self.tools = {
            "java": str(self.java),
            "java_source": "bundled",
            "epubcheck_jar": str(self.jar),
            "ace": None,
            "ace_entry": str(self.entry),
            "ace_runtime": None,
            "ace_runtime_kind": None,
            "chrome": str(self.chrome),
        }

    def test_plan_prepare_finalize_binds_one_current_run_and_clears_stale_report(self):
        plan = ops.plan_external_validation(self.project, tools=self.tools)
        self.assertRegex(plan["plan_id"], r"^external-plan-[0-9a-f]{64}$")
        self.assertEqual(plan["ace_request"]["entry"], str(self.entry.resolve()))

        out_dir = Path(plan["ace_request"]["out_dir"])
        out_dir.mkdir()
        (out_dir / "report.json").write_text('{"stale":true}', encoding="utf-8")
        prepared = ops.prepare_external_ace(
            self.project, plan["plan_id"], tools=self.tools
        )
        self.assertTrue(prepared["prepared"])
        self.assertFalse((out_dir / "report.json").exists())

        (out_dir / "report.json").write_text(json.dumps({
            "earl:result": {"earl:outcome": "pass"},
            "assertions": [],
        }), encoding="utf-8")
        with patch(
            "oak_manuscript_core.external.run_epubcheck",
            return_value={"status": "passed", "detail": "fixture"},
        ):
            results = ops.finalize_external_validation(
                self.project,
                plan["plan_id"],
                ace_exit_code=0,
                tools=self.tools,
            )
        self.assertEqual(results["epubcheck"]["status"], "passed")
        self.assertEqual(results["ace"]["status"], "passed")
        latest = self.project.data["checks"][-1]
        stored = json.loads(self.project.report_path(latest["result_file"]).read_text(
            encoding="utf-8"
        ))
        self.assertEqual(stored["external_tools"]["ace"], "passed")

    def test_missing_helper_exit_is_truthfully_not_run_but_epubcheck_still_finishes(self):
        plan = ops.plan_external_validation(self.project, tools=self.tools)
        ops.prepare_external_ace(self.project, plan["plan_id"], tools=self.tools)
        with patch(
            "oak_manuscript_core.external.run_epubcheck",
            return_value={"status": "passed", "detail": "fixture"},
        ):
            results = ops.finalize_external_validation(
                self.project, plan["plan_id"], tools=self.tools
            )
        self.assertEqual(results["epubcheck"]["status"], "passed")
        self.assertEqual(results["ace"]["status"], "not_run")
        self.assertIn("helper", results["ace"]["detail"])

    def test_plan_rejects_tool_identity_drift_and_invalid_exit_code(self):
        plan = ops.plan_external_validation(self.project, tools=self.tools)
        self.chrome.write_bytes(b"changed external tool\n")
        with self.assertRaises(OakError):
            ops.prepare_external_ace(self.project, plan["plan_id"], tools=self.tools)

        current = ops.plan_external_validation(self.project, tools=self.tools)
        with self.assertRaises(OakError):
            ops.finalize_external_validation(
                self.project, current["plan_id"], ace_exit_code=256, tools=self.tools
            )


@unittest.skipUnless(HAS_EPUBCHECK, "本机没有 EpubCheck + Java，跳过")
class RunExternalFlowTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_external_updates_report_status(self):
        proj = Project.create(SAMPLES / "epub_good.epub", self.tmp / "proj",
                              manuscript_type="ebook")
        ops.run_check(proj, PACK)
        results = ops.run_external(proj)
        self.assertEqual(results["epubcheck"]["status"], "passed")
        report = ops.build_report_data(proj, PACK)
        self.assertEqual(report["external_tools"]["epubcheck"], "passed")
        md = render_markdown(report)
        self.assertIn("已运行：未发现问题", md)
        self.assertIn("EpubCheck", md)

    def test_external_rejects_non_epub(self):
        proj = Project.create(SAMPLES / "paper_sample.md", self.tmp / "proj-md")
        from oak_manuscript_core.errors import OakError

        with self.assertRaises(OakError):
            ops.run_external(proj)


@unittest.skipUnless(HAS_ACE, "Ace 未启用（设 OAK_TEST_ACE=1 且需 Ace + Chrome）")
class AceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_ace_runs_and_reports(self):
        from oak_manuscript_core.external import run_ace

        r = run_ace(SAMPLES / "epub_good.epub", self.tmp / "ace",
                    ace=TOOLS["ace"], chrome=TOOLS["chrome"])
        self.assertEqual(r["status"], "passed", r["detail"])
        self.assertRegex(r["detail"], r"^Ace：整体 pass，")
        report_path = self.tmp / "ace" / "report.json"
        self.assertTrue(report_path.is_file(), r["detail"])
        report = json.loads(report_path.read_text(encoding="utf-8"))
        self.assertEqual(report.get("earl:result", {}).get("earl:outcome"), "pass")

    def test_ace_defect_sample_generates_a_real_fail_report(self):
        from oak_manuscript_core.external import run_ace

        r = run_ace(SAMPLES / "epub_needs_review.epub", self.tmp / "ace-defect",
                    ace=TOOLS["ace"], chrome=TOOLS["chrome"])
        self.assertEqual(r["status"], "failed", r["detail"])
        self.assertRegex(r["detail"], r"^Ace：整体 fail，")
        report_path = self.tmp / "ace-defect" / "report.json"
        self.assertTrue(report_path.is_file(), r["detail"])
        report = json.loads(report_path.read_text(encoding="utf-8"))
        self.assertEqual(report.get("earl:result", {}).get("earl:outcome"), "fail")


if __name__ == "__main__":
    unittest.main()
