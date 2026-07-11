"""统一异常类型。message 面向用户，说明发生了什么、文件是否安全、下一步做什么。"""


class OakError(Exception):
    """可预期的业务错误（输入不合法、状态不满足等）。CLI 捕获后退出码 2。"""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
