from typing import Any


def ok(data: Any = None, msg: str = "success") -> dict[str, Any]:
    return {"code": 0, "msg": msg, "data": data if data is not None else {}}


def err(msg: str = "error", code: int = 1) -> dict[str, Any]:
    return {"code": code, "msg": msg, "data": {}}
