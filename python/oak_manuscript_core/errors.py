"""统一异常类型。message 面向用户，说明发生了什么、文件是否安全、下一步做什么。"""


class OakError(Exception):
    """可预期的业务错误（输入不合法、状态不满足等）。CLI 捕获后退出码 2。"""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class StructuredOakError(OakError):
    """需要同时返回稳定机器码与人类提示的安全错误。"""

    def __init__(
        self,
        message: str,
        *,
        code: str,
        retryable: bool = False,
        details: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.details = details or {}

    def as_payload(self) -> dict:
        return {
            "ok": False,
            "error": {
                "code": self.code,
                "message": self.message,
                "retryable": self.retryable,
                "details": self.details,
            },
        }


class ProjectValidationError(StructuredOakError):
    """项目清单或路径边界不可信；任何业务读写都必须停止。"""

    def __init__(self, message: str) -> None:
        super().__init__(
            message,
            code="PROJECT_VALIDATION_FAILED",
            retryable=False,
        )
