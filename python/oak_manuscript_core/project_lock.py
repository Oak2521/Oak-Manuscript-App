"""项目级跨进程写事务锁（Windows / macOS / POSIX，纯标准库）。

锁文件是持久诊断载体；真正的互斥由内核字节锁/``flock`` 提供。进程崩溃
时内核自动释放锁，因此绝不依据可能陈旧的 PID 元数据删除所谓“活锁”。
"""

from __future__ import annotations

import json
import os
import re
import secrets
import stat
from pathlib import Path

from .errors import OakError, StructuredOakError
from .safety import is_link_or_reparse
from .util import now_iso

PROJECT_LOCK_FILENAME = ".oak-project-write.lock"
_MAX_METADATA_BYTES = 16 * 1024
_LOCK_BYTE_OFFSET = 64 * 1024
_LOCK_SCHEMA_VERSION = "1.0"
_LOCK_PROTOCOL = "kernel-advisory-lock-v1"
_TOKEN_RE = re.compile(r"^[0-9a-f]{32}$")


class ProjectLockError(StructuredOakError):
    pass


def _decode_metadata(raw: bytes) -> dict:
    if len(raw) > _MAX_METADATA_BYTES or raw[:1] != b"\x00":
        raise ProjectLockError(
            "同名写锁文件不是湖岸稿件锁协议文件，拒绝接管。",
            code="PROJECT_WRITE_LOCK_UNAVAILABLE",
        )
    try:
        value = json.loads(raw[1:].decode("utf-8"))
    except (UnicodeError, ValueError) as exc:
        raise ProjectLockError(
            "同名写锁文件不是湖岸稿件锁协议文件，拒绝接管。",
            code="PROJECT_WRITE_LOCK_UNAVAILABLE",
        ) from exc
    if (
        not isinstance(value, dict)
        or value.get("schema_version") != _LOCK_SCHEMA_VERSION
        or value.get("protocol") != _LOCK_PROTOCOL
        or value.get("state") not in {"held", "released"}
        or not isinstance(value.get("pid"), int)
        or isinstance(value.get("pid"), bool)
        or value["pid"] <= 0
        or not isinstance(value.get("command"), str)
        or not value["command"]
        or not isinstance(value.get("acquired_at"), str)
        or not isinstance(value.get("process_token"), str)
        or not _TOKEN_RE.fullmatch(value["process_token"])
    ):
        raise ProjectLockError(
            "同名写锁文件协议字段非法，拒绝接管。",
            code="PROJECT_WRITE_LOCK_UNAVAILABLE",
        )
    return value


def _validate_lock_file_identity(path: Path) -> os.stat_result:
    try:
        info = os.lstat(path)
    except OSError as exc:
        raise ProjectLockError(
            "同名写锁文件无法安全读取，拒绝接管。",
            code="PROJECT_WRITE_LOCK_UNAVAILABLE",
        ) from exc
    if (
        is_link_or_reparse(path)
        or not stat.S_ISREG(info.st_mode)
        or getattr(info, "st_nlink", 1) != 1
    ):
        raise ProjectLockError(
            "同名写锁文件不是安全的独立常规文件，拒绝接管。",
            code="PROJECT_WRITE_LOCK_UNAVAILABLE",
        )
    return info


def validate_existing_lock_file(path: Path) -> bytes:
    """只读确认同名文件确为本应用协议锁；返回供失败恢复的原始字节。"""
    _validate_lock_file_identity(path)
    try:
        size = path.stat().st_size
        if size <= 1 or size > _MAX_METADATA_BYTES:
            raise ProjectLockError(
                "同名写锁文件大小不符合湖岸稿件锁协议，拒绝接管。",
                code="PROJECT_WRITE_LOCK_UNAVAILABLE",
            )
        raw = path.read_bytes()
    except ProjectLockError:
        raise
    except OSError as exc:
        raise ProjectLockError(
            "同名写锁文件无法安全读取，拒绝接管。",
            code="PROJECT_WRITE_LOCK_UNAVAILABLE",
        ) from exc
    _decode_metadata(raw)
    return raw


def _read_fd_bytes(fd: int) -> bytes:
    size = os.fstat(fd).st_size
    if size <= 1 or size > _MAX_METADATA_BYTES:
        raise ProjectLockError(
            "同名写锁文件大小不符合湖岸稿件锁协议，拒绝接管。",
            code="PROJECT_WRITE_LOCK_UNAVAILABLE",
        )
    os.lseek(fd, 0, os.SEEK_SET)
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = os.read(fd, remaining)
        if not chunk:
            raise ProjectLockError(
                "无法完整读取同名写锁文件，拒绝接管。",
                code="PROJECT_WRITE_LOCK_UNAVAILABLE",
            )
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _read_metadata_for_contention(path: Path) -> dict | None:
    try:
        return _decode_metadata(validate_existing_lock_file(path))
    except ProjectLockError:
        return None


def _try_kernel_lock(fd: int) -> bool:
    # Windows 的字节锁会拒绝其他进程读取被锁区间；锁定元数据区之外的
    # 固定字节，使失败方仍可只读诊断信息且绝不能覆盖它。
    os.lseek(fd, _LOCK_BYTE_OFFSET, os.SEEK_SET)
    if os.name == "nt":
        import msvcrt

        try:
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        except OSError:
            return False
        return True

    import fcntl

    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (BlockingIOError, OSError):
        return False
    return True


def _kernel_unlock(fd: int) -> None:
    os.lseek(fd, _LOCK_BYTE_OFFSET, os.SEEK_SET)
    if os.name == "nt":
        import msvcrt

        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        return

    import fcntl

    fcntl.flock(fd, fcntl.LOCK_UN)


class ProjectWriteLock:
    """立即取得单项目独占写锁；争用时不等待并 fail-closed。"""

    def __init__(
        self,
        project_root: Path,
        *,
        command: str,
        create_root: bool = False,
        cleanup_on_error: bool = False,
    ) -> None:
        self.project_root = Path(project_root)
        self.command = command
        self.create_root = create_root
        self.cleanup_on_error = cleanup_on_error
        self.path: Path | None = None
        self.metadata: dict | None = None
        self._fd: int | None = None
        self._root_created = False
        self._root_path: Path | None = None
        self._root_identity: tuple[int, int] | None = None
        self._lock_created = False
        self._lock_identity: tuple[int, int] | None = None
        self._previous_lock_bytes: bytes | None = None

    def __enter__(self) -> "ProjectWriteLock":
        root = self.project_root
        if root.exists():
            if is_link_or_reparse(root) or not root.is_dir():
                raise ProjectLockError(
                    "项目根目录不是安全的常规目录，拒绝创建写事务锁。",
                    code="PROJECT_WRITE_LOCK_UNAVAILABLE",
                )
        elif self.create_root:
            try:
                root.mkdir(parents=True, exist_ok=False)
                self._root_created = True
                created_info = os.lstat(root)
                self._root_path = root.absolute()
                self._root_identity = (created_info.st_dev, created_info.st_ino)
            except OSError as exc:
                raise ProjectLockError(
                    f"无法创建项目目录并取得写事务锁：{exc}",
                    code="PROJECT_WRITE_LOCK_UNAVAILABLE",
                ) from exc
        else:
            raise OakError(f"该目录不是湖岸稿件项目（目录不存在）：{root}")

        try:
            if is_link_or_reparse(root) or not root.is_dir():
                raise ProjectLockError(
                    "项目根目录在加锁前发生变化，拒绝继续。",
                    code="PROJECT_WRITE_LOCK_UNAVAILABLE",
                )
            root_resolved = root.resolve(strict=True)
            self._root_path = root_resolved
            root_info = os.lstat(root_resolved)
            self._root_identity = (root_info.st_dev, root_info.st_ino)
        except Exception:
            self._cleanup_created_paths()
            raise
        lock_path = root_resolved / PROJECT_LOCK_FILENAME
        self.path = lock_path

        flags = os.O_RDWR | os.O_CREAT
        if hasattr(os, "O_BINARY"):
            flags |= os.O_BINARY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            try:
                fd = os.open(lock_path, flags | os.O_EXCL, 0o600)
                self._lock_created = True
            except FileExistsError:
                # 在 O_RDWR 打开前只读证明它是本应用协议文件；普通同名文件
                # 即使位于合法项目中也绝不覆盖一个字节。
                validate_existing_lock_file(lock_path)
                fd = os.open(lock_path, flags & ~os.O_CREAT, 0o600)
        except OSError as exc:
            self._cleanup_created_paths()
            raise ProjectLockError(
                f"无法打开项目写事务锁：{exc}",
                code="PROJECT_WRITE_LOCK_UNAVAILABLE",
            ) from exc
        except Exception:
            self._cleanup_created_paths()
            raise

        try:
            lst = os.lstat(lock_path)
            fst = os.fstat(fd)
            self._lock_identity = (fst.st_dev, fst.st_ino)
            if (
                is_link_or_reparse(lock_path)
                or not stat.S_ISREG(fst.st_mode)
                or getattr(fst, "st_nlink", 1) != 1
                or (lst.st_dev, lst.st_ino) != (fst.st_dev, fst.st_ino)
            ):
                raise ProjectLockError(
                    "项目写事务锁文件不是安全的独立常规文件，拒绝继续。",
                    code="PROJECT_WRITE_LOCK_UNAVAILABLE",
                )
            if not _try_kernel_lock(fd):
                owner = _read_metadata_for_contention(lock_path)
                public_owner = None
                if owner is not None:
                    public_owner = {
                        key: owner.get(key)
                        for key in ("pid", "command", "acquired_at", "process_token")
                    }
                raise ProjectLockError(
                    "项目正由另一个写操作使用；本次操作未执行，请稍后重试。",
                    code="PROJECT_WRITE_LOCKED",
                    retryable=True,
                    details={"owner": public_owner},
                )

            if not self._lock_created:
                previous = _read_fd_bytes(fd)
                _decode_metadata(previous)
                self._previous_lock_bytes = previous

            self._fd = fd
            self.metadata = {
                "schema_version": _LOCK_SCHEMA_VERSION,
                "protocol": _LOCK_PROTOCOL,
                "state": "held",
                "pid": os.getpid(),
                "command": self.command,
                "acquired_at": now_iso(),
                "process_token": secrets.token_hex(16),
            }
            self._write_metadata(self.metadata)
            return self
        except Exception:
            if self._fd is not None:
                try:
                    _kernel_unlock(fd)
                except OSError:
                    pass
                self._fd = None
            os.close(fd)
            self._cleanup_created_paths()
            raise

    @staticmethod
    def _write_all(fd: int, payload: bytes) -> None:
        view = memoryview(payload)
        while view:
            written = os.write(fd, view)
            if written <= 0:  # pragma: no cover - 常规文件写入的极端系统故障
                raise OSError("无法完整写入项目锁元数据")
            view = view[written:]

    def _write_raw(self, payload: bytes) -> None:
        if self._fd is None:
            raise ProjectLockError(
                "项目写事务锁尚未取得，不能写入锁元数据。",
                code="PROJECT_WRITE_LOCK_UNAVAILABLE",
            )
        os.lseek(self._fd, 0, os.SEEK_SET)
        os.ftruncate(self._fd, 0)
        self._write_all(self._fd, payload)
        os.fsync(self._fd)

    def _write_metadata(self, metadata: dict) -> None:
        if self._fd is None:
            raise ProjectLockError(
                "项目写事务锁尚未取得，不能写入锁元数据。",
                code="PROJECT_WRITE_LOCK_UNAVAILABLE",
            )
        payload = json.dumps(metadata, ensure_ascii=False, sort_keys=True).encode("utf-8")
        if len(payload) > _MAX_METADATA_BYTES - 1:
            raise ProjectLockError(
                "项目写事务锁元数据超过安全上限。",
                code="PROJECT_WRITE_LOCK_UNAVAILABLE",
            )
        self._write_raw(b"\x00" + payload)

    def _cleanup_created_paths(self) -> None:
        """只移除本实例创建且身份未变化的锁/新根；从不递归删除。"""
        lock_path = self.path
        if self._lock_created and lock_path is not None and os.path.lexists(lock_path):
            try:
                info = os.lstat(lock_path)
                identity = (info.st_dev, info.st_ino)
                if (
                    self._lock_identity == identity
                    and stat.S_ISREG(info.st_mode)
                    and not is_link_or_reparse(lock_path)
                    and getattr(info, "st_nlink", 1) == 1
                ):
                    lock_path.unlink()
            except OSError:
                pass
        root = self._root_path or self.project_root
        if self._root_created and os.path.lexists(root):
            try:
                info = os.lstat(root)
                if (
                    (info.st_dev, info.st_ino) == self._root_identity
                    and stat.S_ISDIR(info.st_mode)
                    and not is_link_or_reparse(root)
                ):
                    root.rmdir()
            except OSError:
                # 非空意味着出现了非本实例内容；绝不递归清理用户目录。
                pass

    def __exit__(self, exc_type, exc, traceback) -> None:
        fd = self._fd
        if fd is None:
            return
        failed_create = exc_type is not None and self.cleanup_on_error
        restore_error: Exception | None = None
        try:
            if failed_create and not self._lock_created and self._previous_lock_bytes is not None:
                try:
                    self._write_raw(self._previous_lock_bytes)
                except Exception as error:  # pragma: no cover - 极端磁盘故障
                    restore_error = error
            elif not failed_create and self.metadata is not None:
                released = dict(self.metadata)
                released["state"] = "released"
                released["released_at"] = now_iso()
                try:
                    self._write_metadata(released)
                except Exception:
                    # 业务事务已经结束；释放内核锁比诊断元数据更重要。
                    pass
        finally:
            try:
                _kernel_unlock(fd)
            finally:
                os.close(fd)
                self._fd = None
        if failed_create:
            self._cleanup_created_paths()
        if restore_error is not None:
            raise ProjectLockError(
                f"创建项目失败，且无法恢复原写锁元数据：{restore_error}",
                code="PROJECT_WRITE_LOCK_UNAVAILABLE",
            ) from restore_error
