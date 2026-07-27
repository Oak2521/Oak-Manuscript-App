"""外部验证工具运行器（EpubCheck / Ace）。

纪律（方案 §24 第 9 条）：工具未实际运行绝不声称「通过」。
状态取值：not_run（未运行/工具缺失）| passed（已运行且零错误）| failed（已运行且发现问题）。
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import subprocess
from pathlib import Path, PurePosixPath

_REPO = Path(__file__).resolve().parents[2]
_TIMEOUT = 300
_ACE_ELECTRON_ENV = "OAK_ELECTRON_EXEC_PATH"
_ACE_ROOT_PACKAGE = "@daisy/ace-cli"
_ACE_ROOT_VERSION = "1.4.6"
_ACE_LOCK_SCHEMA_VERSION = "1.0"
_ACE_LOCK_TYPE = "oak-ace-stage"
_ACE_LOCK_RELATIVE = f"config/tool-manifests/ace-{_ACE_ROOT_VERSION}.json"
_ACE_LAUNCHER_SHA256 = (
    "765c7c3792690a66dadfa2fcf4e0b17238f09c5f77679bb09938a861c993747e"
)
_ACE_PATCH_ID = "OAK-ACE-ISOLATION-002"
_ACE_PATCH_PACKAGE = "@daisy/ace-axe-runner-puppeteer"
_ACE_PATCH_VERSION = "1.4.6"
_ACE_PATCH_FILE = "node_modules/@daisy/ace-axe-runner-puppeteer/lib/index.js"
_ACE_PATCH_BEFORE_SHA256 = (
    "681b52d047d5f6eebbfc62a925b7dc22b82589ab63b36a9ea602297f8cd86ea6"
)
_ACE_PATCH_AFTER_SHA256 = (
    "025a0766beaa48e8eb48f640d2bacf72029a61486aec276a393450d406ac67cc"
)
_ACE_PATCH_SOURCE = "scripts/patches/ace-axe-runner-puppeteer-1.4.6.js"
_ACE_SANITIZER_PACKAGE = "@xmldom/xmldom"
_ACE_SANITIZER_VERSION = "0.9.10"
_ACE_SANITIZER_PACKAGE_JSON = "node_modules/@xmldom/xmldom/package.json"
_JRE_SCHEMA_VERSION = "1.0"
_JRE_DISTRIBUTION = "Temurin"
_JRE_VENDOR = "Eclipse Adoptium"
_JRE_FEATURE_VERSION = 21
_JRE_IMPLEMENTOR_VERSION = "Temurin-21.0.11+10"
_JRE_JAVA_VERSION = "21.0.11"
_JRE_RUNTIME_VERSION = "21.0.11+10-LTS"
_JRE_MODULE_POLICY = "fixed-conservative-java-se"
_JRE_REQUESTED_MODULES = ["java.se", "jdk.unsupported", "jdk.xml.dom"]
_EPUBCHECK_VERSION = "5.3.0"
_EPUBCHECK_MANIFEST_SCHEMA = "1.0"
_EPUBCHECK_DISTRIBUTION = f"tools/epubcheck-{_EPUBCHECK_VERSION}"
_EPUBCHECK_MANIFEST = f"config/tool-manifests/epubcheck-{_EPUBCHECK_VERSION}.json"
_EPUBCHECK_REQUIRED_FILES = [
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
_JAVA_UNSAFE_ENV = {
    "CLASSPATH",
    "JAVA_TOOL_OPTIONS",
    "JDK_JAVA_OPTIONS",
    "_JAVA_OPTIONS",
}


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _chrome_candidates(
    *,
    environ: dict[str, str] | None = None,
    platform_name: str | None = None,
    home: str | Path | None = None,
) -> list[Path]:
    env = dict(os.environ if environ is None else environ)
    system = (platform_name or platform.system()).lower()
    candidates: list[Path] = []
    if system.startswith("win"):
        for base in (
            env.get("ProgramFiles", r"C:\Program Files"),
            env.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
        ):
            candidates.extend([
                Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe",
                Path(base) / "Google" / "Chrome Beta" / "Application" / "chrome.exe",
            ])
        local = env.get("LOCALAPPDATA")
        if local:
            candidates.extend([
                Path(local) / "Google" / "Chrome" / "Application" / "chrome.exe",
                Path(local) / "Google" / "Chrome Beta" / "Application" / "chrome.exe",
                Path(local) / "Google" / "Chrome SxS" / "Application" / "chrome.exe",
            ])
    elif system == "darwin":
        user_home = Path(home or env.get("HOME") or Path.home())
        for applications in (Path("/Applications"), user_home / "Applications"):
            candidates.extend([
                applications / "Google Chrome.app" / "Contents" / "MacOS" / "Google Chrome",
                applications / "Google Chrome Beta.app" / "Contents" / "MacOS" / "Google Chrome Beta",
                applications / "Google Chrome Canary.app" / "Contents" / "MacOS" / "Google Chrome Canary",
            ])
    else:
        candidates.extend([
            Path("/usr/bin/google-chrome"),
            Path("/usr/bin/google-chrome-stable"),
            Path("/usr/bin/chromium"),
            Path("/usr/bin/chromium-browser"),
        ])
    deduplicated: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key not in seen:
            deduplicated.append(candidate)
            seen.add(key)
    return deduplicated


def _trusted_staged_ace(root: Path) -> Path | None:
    tool_root = root / "tools" / "ace"
    entry = tool_root / "ace.js"
    manifest_path = tool_root / "manifest.json"
    lock_path = root.joinpath(*PurePosixPath(_ACE_LOCK_RELATIVE).parts)
    if (
        tool_root.is_symlink()
        or entry.is_symlink()
        or manifest_path.is_symlink()
        or lock_path.is_symlink()
        or not entry.is_file()
        or not manifest_path.is_file()
        or not lock_path.is_file()
    ):
        return None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        if manifest.get("entry") != "ace.js":
            return None
        root_package = manifest.get("root_package") or {}
        if (
            root_package.get("name") != _ACE_ROOT_PACKAGE
            or root_package.get("version") != _ACE_ROOT_VERSION
        ):
            return None
        packages = manifest.get("packages")
        package_count = manifest.get("package_count")
        file_count = manifest.get("file_count")
        total_bytes = manifest.get("total_bytes")
        if (
            not isinstance(packages, list)
            or not isinstance(package_count, int)
            or isinstance(package_count, bool)
            or package_count != len(packages)
            or not isinstance(file_count, int)
            or isinstance(file_count, bool)
            or file_count <= 0
            or not isinstance(total_bytes, int)
            or isinstance(total_bytes, bool)
            or total_bytes <= 0
        ):
            return None
        raw_records = manifest.get("files")
        if not isinstance(raw_records, list) or not raw_records:
            return None
        file_records: dict[str, dict] = {}
        for item in raw_records:
            if not isinstance(item, dict):
                return None
            relative = item.get("path")
            size = item.get("size_bytes")
            expected_hash = item.get("sha256")
            if (
                not isinstance(relative, str)
                or not relative
                or "\\" in relative
                or relative in file_records
                or not isinstance(size, int)
                or size < 0
                or not isinstance(expected_hash, str)
                or len(expected_hash) != 64
                or any(ch not in "0123456789abcdef" for ch in expected_hash)
            ):
                return None
            pure = PurePosixPath(relative)
            if (
                pure.is_absolute()
                or ".." in pure.parts
                or "." in pure.parts
                or pure.as_posix() != relative
                or relative == "manifest.json"
            ):
                return None
            file_records[relative] = item

        package_closure = []
        for item in packages:
            if not isinstance(item, dict):
                return None
            closure_item = {
                "name": item.get("name"),
                "version": item.get("version"),
                "path": item.get("path"),
            }
            if any(not isinstance(value, str) or not value for value in closure_item.values()):
                return None
            package_closure.append(closure_item)
        stage_manifest_sha256 = lock.get("stage_manifest_sha256")
        if (
            lock.get("schema_version") != _ACE_LOCK_SCHEMA_VERSION
            or lock.get("lock_type") != _ACE_LOCK_TYPE
            or lock.get("tool") != {
                "name": _ACE_ROOT_PACKAGE,
                "version": _ACE_ROOT_VERSION,
            }
            or not isinstance(stage_manifest_sha256, str)
            or len(stage_manifest_sha256) != 64
            or any(ch not in "0123456789abcdef" for ch in stage_manifest_sha256)
            or stage_manifest_sha256 != _sha256_file(manifest_path)
            or lock.get("entry") != manifest.get("entry")
            or lock.get("package_count") != package_count
            or lock.get("file_count") != file_count
            or lock.get("total_bytes") != total_bytes
            or lock.get("package_closure") != package_closure
            or lock.get("patches") != manifest.get("patches")
            or lock.get("files") != raw_records
        ):
            return None

        actual_files: dict[str, Path] = {}
        for candidate in tool_root.rglob("*"):
            if candidate.is_symlink():
                return None
            if candidate.is_file() and candidate != manifest_path:
                relative = candidate.relative_to(tool_root).as_posix()
                actual_files[relative] = candidate
        if set(actual_files) != set(file_records):
            return None
        if file_count != len(actual_files) or total_bytes != sum(
            candidate.stat().st_size for candidate in actual_files.values()
        ):
            return None
        for relative, candidate in actual_files.items():
            record = file_records[relative]
            if (
                candidate.stat().st_size != record["size_bytes"]
                or _sha256_file(candidate) != record["sha256"]
            ):
                return None

        entry_record = file_records.get("ace.js")
        if not entry_record or entry_record["sha256"] != _ACE_LAUNCHER_SHA256:
            return None
        patches = manifest.get("patches")
        if not isinstance(patches, list) or len(patches) != 1:
            return None
        patch_record = patches[0]
        if not isinstance(patch_record, dict):
            return None
        expected_patch = {
            "patch_id": _ACE_PATCH_ID,
            "target_package": _ACE_PATCH_PACKAGE,
            "target_version": _ACE_PATCH_VERSION,
            "target_file": _ACE_PATCH_FILE,
            "before_sha256": _ACE_PATCH_BEFORE_SHA256,
            "after_sha256": _ACE_PATCH_AFTER_SHA256,
            "controlled_replacement": _ACE_PATCH_SOURCE,
        }
        if any(patch_record.get(key) != value for key, value in expected_patch.items()):
            return None
        if patch_record.get("sanitizer") != {
            "package_name": _ACE_SANITIZER_PACKAGE,
            "package_version": _ACE_SANITIZER_VERSION,
        }:
            return None
        effect = patch_record.get("effect")
        if not isinstance(effect, str) or not all(
            marker in effect
            for marker in (
                "作者 XHTML 在 JavaScript 禁用状态下",
                "basedir 内 file:",
                "OS 级网络隔离仍是正式发布阻断项",
            )
        ):
            return None
        if _ACE_PATCH_FILE not in file_records:
            return None
        if file_records[_ACE_PATCH_FILE]["sha256"] != _ACE_PATCH_AFTER_SHA256:
            return None
        sanitizer_package_path = tool_root.joinpath(*_ACE_SANITIZER_PACKAGE_JSON.split("/"))
        if _ACE_SANITIZER_PACKAGE_JSON not in file_records:
            return None
        sanitizer_package = json.loads(sanitizer_package_path.read_text(encoding="utf-8"))
        if (
            sanitizer_package.get("name") != _ACE_SANITIZER_PACKAGE
            or sanitizer_package.get("version") != _ACE_SANITIZER_VERSION
        ):
            return None
    except (OSError, ValueError, TypeError):
        return None
    return entry


def _safe_manifest_relative(value: object) -> str | None:
    if not isinstance(value, str) or not value or "\\" in value:
        return None
    pure = PurePosixPath(value)
    if (
        pure.is_absolute()
        or ".." in pure.parts
        or "." in pure.parts
        or pure.as_posix() != value
    ):
        return None
    return value


def _trusted_epubcheck_distribution(root: Path) -> Path | None:
    """验证 EpubCheck JAR、完整 lib 闭包和许可证材料的固定清单。"""
    project_root = Path(root)
    manifest_path = project_root.joinpath(*PurePosixPath(_EPUBCHECK_MANIFEST).parts)
    distribution = project_root.joinpath(*PurePosixPath(_EPUBCHECK_DISTRIBUTION).parts)
    if (
        manifest_path.is_symlink()
        or distribution.is_symlink()
        or not manifest_path.is_file()
        or not distribution.is_dir()
    ):
        return None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if (
            not isinstance(manifest, dict)
            or manifest.get("schema_version") != _EPUBCHECK_MANIFEST_SCHEMA
            or (manifest.get("tool") or {}).get("name") != "EpubCheck"
            or (manifest.get("tool") or {}).get("version") != _EPUBCHECK_VERSION
            or manifest.get("distribution") != _EPUBCHECK_DISTRIBUTION
            or manifest.get("entry") != "epubcheck.jar"
            or manifest.get("formal_provenance_audit_required") is not True
            or manifest.get("required_files") != _EPUBCHECK_REQUIRED_FILES
        ):
            return None
        raw_records = manifest.get("files")
        if not isinstance(raw_records, list) or not raw_records:
            return None
        records: dict[str, dict] = {}
        for item in raw_records:
            if not isinstance(item, dict):
                return None
            relative = _safe_manifest_relative(item.get("path"))
            size = item.get("size_bytes")
            expected_hash = item.get("sha256")
            if (
                relative is None
                or relative in records
                or not isinstance(size, int)
                or isinstance(size, bool)
                or size <= 0
                or not isinstance(expected_hash, str)
                or len(expected_hash) != 64
                or any(ch not in "0123456789abcdef" for ch in expected_hash)
            ):
                return None
            records[relative] = item

        actual: dict[str, Path] = {}
        for candidate in distribution.rglob("*"):
            if candidate.is_symlink():
                return None
            if candidate.is_file():
                relative = candidate.relative_to(distribution).as_posix()
                actual[relative] = candidate
            elif not candidate.is_dir():
                return None
        if set(actual) != set(records):
            return None
        for relative, candidate in actual.items():
            record = records[relative]
            if (
                candidate.stat().st_size != record["size_bytes"]
                or _sha256_file(candidate) != record["sha256"]
            ):
                return None
        if (
            manifest.get("file_count") != len(actual)
            or manifest.get("total_bytes")
            != sum(candidate.stat().st_size for candidate in actual.values())
            or any(item not in actual for item in _EPUBCHECK_REQUIRED_FILES)
        ):
            return None
        # 按清单原始记录顺序比较；生成端使用固定 UTF-16 代码单元顺序，
        # Python 不再用自身排序规则重排，以免跨运行时产生假阴性。
        expected_licenses = [
            item["path"] for item in raw_records
            if item["path"] in {"LICENSE.txt", "THIRD-PARTY.txt"}
            or item["path"].startswith("licenses/")
        ]
        if manifest.get("license_files") != expected_licenses:
            return None
        entry = distribution / "epubcheck.jar"
        return entry if entry.is_file() and not entry.is_symlink() else None
    except (OSError, ValueError, TypeError):
        return None


def _normalized_platform(platform_name: str | None = None) -> str | None:
    system = (platform_name or platform.system()).lower()
    if system.startswith("win"):
        return "win32"
    if system == "darwin":
        return "darwin"
    return None


def _normalized_arch(machine_name: str | None = None) -> str | None:
    machine = (machine_name or platform.machine()).lower()
    if machine in {"amd64", "x86_64", "x64"}:
        return "x64"
    if machine in {"arm64", "aarch64"}:
        return "arm64"
    return None


def _jre_lock_relative(expected_platform: str, expected_arch: str) -> str | None:
    """返回目标平台专属 JRE 锁路径；未知目标必须 fail-closed。"""
    if expected_platform not in {"win32", "darwin"}:
        return None
    if expected_arch not in {"x64", "arm64"}:
        return None
    return f"config/tool-manifests/jre-{expected_platform}-{expected_arch}.json"


def _trusted_bundled_java(
    runtime_root: Path,
    *,
    expected_platform: str,
    expected_arch: str,
    trust_root: Path | None = None,
) -> Path | None:
    """仅接受 stage_epubcheck_jre 生成且全量清单匹配的 JRE。"""
    root = Path(runtime_root)
    manifest_path = root / "manifest.json"
    expected_entry = "bin/java.exe" if expected_platform == "win32" else "bin/java"
    entry = root.joinpath(*PurePosixPath(expected_entry).parts)
    if (
        root.is_symlink()
        or manifest_path.is_symlink()
        or entry.is_symlink()
        or not root.is_dir()
        or not manifest_path.is_file()
        or not entry.is_file()
    ):
        return None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        runtime = manifest.get("runtime") or {}
        target = manifest.get("target") or {}
        if (
            manifest.get("schema_version") != _JRE_SCHEMA_VERSION
            or manifest.get("entry") != expected_entry
            or runtime.get("distribution") != _JRE_DISTRIBUTION
            or runtime.get("vendor") != _JRE_VENDOR
            or runtime.get("implementor_version") != _JRE_IMPLEMENTOR_VERSION
            or runtime.get("java_version") != _JRE_JAVA_VERSION
            or runtime.get("java_runtime_version") != _JRE_RUNTIME_VERSION
            or runtime.get("feature_version") != _JRE_FEATURE_VERSION
            or target.get("platform") != expected_platform
            or target.get("arch") != expected_arch
        ):
            return None
        runtime_lock = None
        if trust_root is not None:
            lock_relative = _jre_lock_relative(expected_platform, expected_arch)
            if lock_relative is None:
                return None
            lock_path = Path(trust_root).joinpath(*PurePosixPath(lock_relative).parts)
            if lock_path.is_symlink() or not lock_path.is_file():
                return None
            runtime_lock = json.loads(lock_path.read_text(encoding="utf-8"))
            locked_runtime = runtime_lock.get("runtime") or {}
            locked_source = runtime_lock.get("source_jdk") or {}
            hash_fields = [
                "release_sha256",
                "java_sha256",
                "jdeps_sha256",
                "jlink_sha256",
                "tree_sha256",
            ]
            if (
                runtime_lock.get("schema_version") != "1.0"
                or runtime_lock.get("lock_type") != "oak-jre-runtime"
                or (runtime_lock.get("target") or {}).get("platform") != expected_platform
                or (runtime_lock.get("target") or {}).get("arch") != expected_arch
                or runtime_lock.get("runtime_manifest_sha256") != _sha256_file(manifest_path)
                or runtime_lock.get("formal_source_provenance_audit_required") is not True
                or locked_runtime.get("distribution") != _JRE_DISTRIBUTION
                or locked_runtime.get("vendor") != _JRE_VENDOR
                or locked_runtime.get("implementor_version") != _JRE_IMPLEMENTOR_VERSION
                or locked_runtime.get("java_version") != _JRE_JAVA_VERSION
                or locked_runtime.get("java_runtime_version") != _JRE_RUNTIME_VERSION
                or locked_runtime.get("feature_version") != _JRE_FEATURE_VERSION
                or any(
                    not isinstance(locked_source.get(field), str)
                    or len(locked_source[field]) != 64
                    or any(ch not in "0123456789abcdef" for ch in locked_source[field])
                    for field in hash_fields
                )
                or not isinstance(locked_source.get("tree_file_count"), int)
                or locked_source["tree_file_count"] <= 0
                or not isinstance(locked_source.get("tree_total_bytes"), int)
                or locked_source["tree_total_bytes"] <= 0
            ):
                return None

        modules = manifest.get("modules")
        jdeps_modules = manifest.get("jdeps_modules")
        if (
            manifest.get("module_policy") != _JRE_MODULE_POLICY
            or manifest.get("requested_modules") != _JRE_REQUESTED_MODULES
            or not isinstance(modules, list)
            or not modules
            or any(not isinstance(item, str) or not item for item in modules)
            or modules != sorted(set(modules))
            or not isinstance(jdeps_modules, list)
            or not jdeps_modules
            or any(item not in modules for item in jdeps_modules)
            or any(item not in modules for item in _JRE_REQUESTED_MODULES)
        ):
            return None

        raw_records = manifest.get("files")
        if not isinstance(raw_records, list) or not raw_records:
            return None
        records: dict[str, dict] = {}
        for item in raw_records:
            if not isinstance(item, dict):
                return None
            relative = item.get("path")
            size = item.get("size_bytes")
            expected_hash = item.get("sha256")
            if (
                not isinstance(relative, str)
                or not relative
                or "\\" in relative
                or relative in records
                or not isinstance(size, int)
                or isinstance(size, bool)
                or size < 0
                or not isinstance(expected_hash, str)
                or not all(ch in "0123456789abcdef" for ch in expected_hash)
                or len(expected_hash) != 64
            ):
                return None
            pure = PurePosixPath(relative)
            if (
                pure.is_absolute()
                or ".." in pure.parts
                or "." in pure.parts
                or pure.as_posix() != relative
                or relative == "manifest.json"
            ):
                return None
            records[relative] = item

        actual: dict[str, Path] = {}
        for candidate in root.rglob("*"):
            if candidate.is_symlink():
                return None
            if candidate.is_file() and candidate != manifest_path:
                relative = candidate.relative_to(root).as_posix()
                actual[relative] = candidate
        if set(actual) != set(records):
            return None
        for relative, candidate in actual.items():
            record = records[relative]
            if (
                candidate.stat().st_size != record["size_bytes"]
                or _sha256_file(candidate) != record["sha256"]
            ):
                return None
        if (
            manifest.get("file_count") != len(actual)
            or manifest.get("total_bytes")
            != sum(candidate.stat().st_size for candidate in actual.values())
        ):
            return None

        license_materials = manifest.get("license_materials")
        expected_licenses = sorted({
            "NOTICE",
            "SOURCE_JDK_RELEASE.txt",
            "THIRD_PARTY_NOTICES.md",
            *(relative for relative in actual if relative.startswith("legal/")),
        })
        if (
            not isinstance(license_materials, list)
            or license_materials != expected_licenses
            or "legal/java.base/LICENSE" not in license_materials
            or any(item not in records for item in license_materials)
            or any(
                not any(relative.startswith(f"legal/{module_name}/") for relative in actual)
                for module_name in modules
            )
        ):
            return None
        probe = manifest.get("epubcheck_probe") or {}
        if (
            probe.get("version") != _EPUBCHECK_VERSION
            or probe.get("checker_version") != _EPUBCHECK_VERSION
            or probe.get("n_fatal") != 0
            or probe.get("n_error") != 0
        ):
            return None
        if runtime_lock is not None:
            distribution_manifest_path = Path(trust_root).joinpath(
                *PurePosixPath(_EPUBCHECK_MANIFEST).parts
            )
            if (
                not distribution_manifest_path.is_file()
                or distribution_manifest_path.is_symlink()
                or runtime_lock.get("epubcheck_distribution_manifest_sha256")
                != _sha256_file(distribution_manifest_path)
                or locked_source.get("release_sha256")
                != (manifest.get("source_jdk") or {}).get("release_sha256")
            ):
                return None
    except (OSError, ValueError, TypeError):
        return None
    return entry


def build_ace_command(
    ace: str | Path,
    *,
    electron_exec: str | Path | None = None,
    node_exec: str | Path | None = None,
) -> tuple[list[str], dict[str, str], str] | None:
    """构造 shell=False 的固定 Ace 入口命令，不接受额外脚本或 CLI 参数。"""
    entry = str(Path(ace).resolve())
    if electron_exec:
        return [str(Path(electron_exec).resolve()), entry], {"ELECTRON_RUN_AS_NODE": "1"}, "electron"
    if node_exec:
        return [str(Path(node_exec).resolve()), entry], {}, "node"
    return None


def _sanitized_process_env(source: dict[str, str] | None = None) -> dict[str, str]:
    """剔除可向 Node/Electron/Puppeteer 注入代码或参数的继承环境。"""
    unsafe_exact = {
        _ACE_ELECTRON_ENV,
        "NPM_CONFIG_NODE_OPTIONS",
        "CHROME_PATH",
        "GOOGLE_CHROME_SHIM",
        "LD_PRELOAD",
        "DYLD_INSERT_LIBRARIES",
    }
    cleaned = {}
    for key, value in dict(os.environ if source is None else source).items():
        upper = key.upper()
        if (
            upper in unsafe_exact
            or upper.startswith("NODE_")
            or upper.startswith("ELECTRON_")
            or upper.startswith("PUPPETEER_")
        ):
            continue
        cleaned[key] = value
    return cleaned


def _sanitized_java_env(source: dict[str, str] | None = None) -> dict[str, str]:
    """剔除会改变 Java 类路径、模块或启动参数的继承环境。"""
    return {
        key: value
        for key, value in dict(os.environ if source is None else source).items()
        if key.upper() not in _JAVA_UNSAFE_ENV
    }


def discover_tools(
    repo_root: Path | None = None,
    *,
    environ: dict[str, str] | None = None,
    platform_name: str | None = None,
    machine_name: str | None = None,
    packaged: bool | None = None,
    which_func=None,
) -> dict:
    root = Path(repo_root) if repo_root else _REPO
    env = dict(os.environ if environ is None else environ)
    which = which_func or shutil.which
    if packaged is None:
        packaged = env.get("OAK_APP_PACKAGED") == "1"
    platform_key = _normalized_platform(platform_name)
    arch_key = _normalized_arch(machine_name)
    java = None
    java_source = None
    if platform_key and arch_key:
        if packaged:
            runtime_candidates = [root / "tools" / "jre"]
        elif platform_key == "win32":
            runtime_candidates = [root / "tools" / "jre-win32-x64"]
        else:
            runtime_candidates = [root / "tools" / f"jre-darwin-{arch_key}"]
        for runtime_root in runtime_candidates:
            bundled = _trusted_bundled_java(
                runtime_root,
                expected_platform=platform_key,
                expected_arch=arch_key,
                trust_root=root,
            )
            if bundled is not None:
                java = str(bundled)
                java_source = "bundled"
                break
    # 打包态 fail-closed：捆绑 JRE 缺失或清单失效时绝不使用系统 PATH。
    if java is None and not packaged:
        java = which("java")
        if java:
            java_source = "system"
    trusted_epubcheck = _trusted_epubcheck_distribution(root)
    jar = str(trusted_epubcheck) if trusted_epubcheck is not None else None
    # 只信任 stage_ace.js 生成、清单和安全补丁哈希均匹配的固定入口。
    ace_entry = _trusted_staged_ace(root)
    electron_exec = env.get(_ACE_ELECTRON_ENV)
    if electron_exec and not Path(electron_exec).is_file():
        electron_exec = None
    # 打包态只允许由 Electron 主进程注入的受控宿主；绝不回退系统 Node。
    node_exec = None if packaged else which("node")
    invocation = None
    if ace_entry is not None:
        invocation = build_ace_command(
            ace_entry,
            electron_exec=electron_exec,
            node_exec=node_exec,
        )
    ace = str(ace_entry) if invocation is not None else None

    chrome = next(
        (
            str(candidate)
            for candidate in _chrome_candidates(
                environ=env,
                platform_name=platform_name,
            )
            if candidate.is_file()
        ),
        None,
    )
    if chrome is None:
        for executable in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
            located = which(executable)
            if located:
                chrome = located
                break
    return {
        "java": java,
        "java_source": java_source,
        "epubcheck_jar": jar,
        "ace": ace,
        "ace_entry": str(ace_entry) if ace_entry is not None else None,
        "ace_runtime": invocation[0][0] if invocation is not None else None,
        "ace_runtime_kind": invocation[2] if invocation is not None else None,
        "chrome": chrome,
    }


def _prepare_epubcheck_report(report_json: Path) -> tuple[Path, tuple[int, int]]:
    requested = Path(report_json)
    if not requested.name or ".." in requested.parts:
        raise OSError("EpubCheck 报告路径不安全")
    requested.parent.mkdir(parents=True, exist_ok=True)
    if requested.parent.is_symlink() or not requested.parent.is_dir():
        raise OSError("EpubCheck 报告父目录不安全")
    parent = requested.parent.resolve()
    target = parent / requested.name
    if target.exists() or target.is_symlink():
        if target.is_dir() and not target.is_symlink():
            raise OSError("EpubCheck 报告路径是目录")
        target.unlink()
    stat = parent.stat()
    return target, (stat.st_dev, stat.st_ino)


def _read_epubcheck_report(
    report_path: Path,
    parent_identity: tuple[int, int],
) -> tuple[str, int, int, int] | None:
    try:
        parent_stat = report_path.parent.stat()
        if (
            report_path.parent.is_symlink()
            or (parent_stat.st_dev, parent_stat.st_ino) != parent_identity
            or report_path.is_symlink()
            or not report_path.is_file()
            or report_path.resolve() != report_path.parent.resolve() / report_path.name
        ):
            return None
        data = json.loads(report_path.read_text(encoding="utf-8"))
        checker = data.get("checker") if isinstance(data, dict) else None
        if not isinstance(checker, dict):
            return None
        version = checker.get("checkerVersion")
        counts = [checker.get("nFatal"), checker.get("nError"), checker.get("nWarning")]
        if (
            not isinstance(version, str)
            or not version
            or any(not isinstance(value, int) or isinstance(value, bool) or value < 0 for value in counts)
        ):
            return None
        return version, counts[0], counts[1], counts[2]
    except (OSError, json.JSONDecodeError, TypeError):
        return None


def run_epubcheck(epub_path: Path, report_json: Path, *, jar: str, java: str) -> dict:
    """运行 EpubCheck；只有本次合法报告能产生 passed / failed。"""
    try:
        report_path, parent_identity = _prepare_epubcheck_report(Path(report_json))
    except OSError as exc:
        return {"status": "not_run", "detail": f"EpubCheck 未完成：{exc}"}
    try:
        proc = subprocess.run(
            [java, "-jar", jar, "--json", str(report_path), str(epub_path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=_TIMEOUT, shell=False, env=_sanitized_java_env(),
        )
    except subprocess.TimeoutExpired:
        return {"status": "not_run", "detail": f"EpubCheck 未完成：运行超时（{_TIMEOUT} 秒）"}
    except OSError as exc:
        return {"status": "not_run", "detail": f"EpubCheck 未完成：无法启动（{exc}）"}

    parsed = _read_epubcheck_report(report_path, parent_identity)
    if parsed is None:
        return {
            "status": "not_run",
            "detail": f"EpubCheck 未完成：未生成合法的本次报告（退出码 {proc.returncode}）",
        }
    version, fatals, errors, warnings = parsed
    detail = f"EpubCheck {version}：{fatals} fatal / {errors} error / {warnings} warning"
    if version != _EPUBCHECK_VERSION:
        return {
            "status": "not_run",
            "detail": f"EpubCheck 未完成：报告版本 {version} 与固定版本 {_EPUBCHECK_VERSION} 不一致",
        }
    if proc.returncode == 1 and fatals + errors > 0:
        return {"status": "failed", "detail": detail}
    if proc.returncode == 0 and fatals + errors == 0:
        return {"status": "passed", "detail": detail}
    return {
        "status": "not_run",
        "detail": f"EpubCheck 未完成：退出码与报告计数不一致（退出码 {proc.returncode}）；{detail}",
    }


def _validated_ace_entry(ace: str | Path) -> Path | None:
    entry = Path(ace).resolve()
    if (
        entry.name != "ace.js"
        or entry.parent.name != "ace"
        or entry.parent.parent.name != "tools"
    ):
        return None
    root = entry.parents[2]
    trusted = _trusted_staged_ace(root)
    return entry if trusted is not None and trusted.resolve() == entry else None


def _prepare_clean_ace_output(out_dir: Path) -> tuple[Path, tuple[int, int]]:
    """建立本次调用独占的空输出目录；拒绝符号链接和危险路径。"""
    requested = Path(out_dir)
    if not requested.name or ".." in requested.parts:
        raise OSError("Ace 输出路径不安全")
    requested.parent.mkdir(parents=True, exist_ok=True)
    if requested.parent.is_symlink() or not requested.parent.is_dir():
        raise OSError("Ace 输出目录的父路径不安全")
    target = requested.parent.resolve() / requested.name
    if target == target.parent or target.is_symlink():
        raise OSError("Ace 输出路径不安全")
    if target.exists():
        if not target.is_dir():
            raise OSError("Ace 输出路径不是目录")
        if any(candidate.is_symlink() for candidate in target.rglob("*")):
            raise OSError("Ace 输出目录包含符号链接")
        shutil.rmtree(target)
    target.mkdir()
    stat = target.stat()
    return target, (stat.st_dev, stat.st_ino)


def run_ace(
    epub_path: Path,
    out_dir: Path,
    *,
    ace: str,
    chrome: str | None = None,
    electron_exec: str | None = None,
    node_exec: str | None = None,
) -> dict:
    """运行阶段化 Ace；固定入口、固定参数、shell=False，绝不接受用户脚本。"""
    entry = _validated_ace_entry(ace)
    if entry is None:
        return {"status": "not_run", "detail": "Ace 阶段化入口或安全清单无效"}
    if not chrome or not Path(chrome).is_file():
        return {"status": "not_run", "detail": "缺少可用的系统 Chrome"}

    electron = electron_exec or os.environ.get(_ACE_ELECTRON_ENV)
    if electron and not Path(electron).is_file():
        electron = None
    packaged = os.environ.get("OAK_APP_PACKAGED") == "1"
    node = None if packaged else (node_exec or shutil.which("node"))
    invocation = build_ace_command(entry, electron_exec=electron, node_exec=node)
    if invocation is None:
        return {"status": "not_run", "detail": "缺少可执行 Ace 的宿主 Electron 或 Node.js"}
    command, env_updates, _runtime_kind = invocation

    try:
        clean_out, output_identity = _prepare_clean_ace_output(Path(out_dir))
    except OSError as exc:
        return {"status": "not_run", "detail": f"Ace 未完成：输出目录无法安全清理（{exc}）"}

    env = _sanitized_process_env()
    env.update(env_updates)
    env["PUPPETEER_EXECUTABLE_PATH"] = str(Path(chrome).resolve())
    try:
        proc = subprocess.run(
            [*command, "-f", "-o", str(clean_out), str(epub_path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=_TIMEOUT, shell=False, env=env,
        )
    except subprocess.TimeoutExpired:
        return {"status": "not_run", "detail": f"Ace 未完成：运行超时（{_TIMEOUT} 秒）"}
    except OSError as exc:
        return {"status": "not_run", "detail": f"Ace 未完成：无法启动（{exc}）"}

    report_path = clean_out / "report.json"
    try:
        out_stat = clean_out.stat()
        if (
            clean_out.is_symlink()
            or not clean_out.is_dir()
            or (out_stat.st_dev, out_stat.st_ino) != output_identity
            or report_path.is_symlink()
            or not report_path.is_file()
            or report_path.resolve() != clean_out.resolve() / "report.json"
        ):
            return {"status": "not_run", "detail": "Ace 未完成：未生成安全的本次报告"}
    except OSError:
        return {"status": "not_run", "detail": "Ace 未完成：未生成安全的本次报告"}
    outcome = None
    violations = -1
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        result = report.get("earl:result") if isinstance(report, dict) else None
        assertions = report.get("assertions") if isinstance(report, dict) else None
        outcome = result.get("earl:outcome") if isinstance(result, dict) else None
        if outcome not in {"pass", "fail"} or not isinstance(assertions, list):
            raise ValueError("invalid Ace report")
        violations = 0
        for audit in assertions:
            if not isinstance(audit, dict) or not isinstance(audit.get("assertions", []), list):
                raise ValueError("invalid Ace assertions")
            violations += len(audit.get("assertions", []))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return {
            "status": "not_run",
            "detail": f"Ace 未完成：本次报告非法（退出码 {proc.returncode}）",
        }
    if proc.returncode != 0:
        return {
            "status": "not_run",
            "detail": (
                f"Ace 未完成：报告为 {outcome}，但进程退出码为 {proc.returncode}"
                "（仅接受退出码 0）"
            ),
        }
    if (outcome == "pass" and violations != 0) or (outcome == "fail" and violations < 1):
        return {
            "status": "not_run",
            "detail": (
                "Ace 未完成：报告 outcome 与断言数量不一致"
                f"（{outcome} / {violations}）"
            ),
        }
    status = "passed" if outcome == "pass" else "failed"
    detail = f"Ace：整体 {outcome}，{violations} 项断言（含可访问性元数据检查）"
    return {"status": status, "detail": detail}
