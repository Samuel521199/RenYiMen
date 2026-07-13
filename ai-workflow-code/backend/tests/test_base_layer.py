import os
import unittest

from fastapi import HTTPException

from app.config import Settings
from app.utils.response import err, ok
from app.utils.security import (
    create_access_token,
    get_password_hash,
    verify_password,
    verify_token,
)


class BaseLayerTests(unittest.TestCase):
    def test_response_helpers_return_uniform_shape(self):
        self.assertEqual(ok(), {"code": 0, "msg": "success", "data": {}})
        self.assertEqual(ok({"id": 1}, "done"), {"code": 0, "msg": "done", "data": {"id": 1}})
        self.assertEqual(ok([]), {"code": 0, "msg": "success", "data": []})
        self.assertEqual(err("bad request", 400), {"code": 400, "msg": "bad request", "data": {}})

    def test_settings_read_environment_values(self):
        settings = Settings(
            DATABASE_URL="postgresql+asyncpg://user:pass@localhost:5432/db",
            REDIS_URL="redis://localhost:6379",
            SECRET_KEY="test-secret",
            ACCESS_TOKEN_EXPIRE_MINUTES=30,
            STORAGE_TYPE="local",
            STORAGE_LOCAL_PATH="../storage",
        )

        self.assertEqual(settings.database_url, "postgresql+asyncpg://user:pass@localhost:5432/db")
        self.assertEqual(settings.redis_url, "redis://localhost:6379")
        self.assertEqual(settings.secret_key, "test-secret")
        self.assertEqual(settings.access_token_expire_minutes, 30)
        self.assertEqual(settings.storage_type, "local")
        self.assertEqual(settings.storage_local_path, "../storage")

    def test_password_hash_and_jwt_round_trip(self):
        password_hash = get_password_hash("admin123")

        self.assertNotEqual(password_hash, "admin123")
        self.assertTrue(verify_password("admin123", password_hash))
        self.assertFalse(verify_password("wrong", password_hash))

        token = create_access_token({"sub": "1", "username": "admin", "role": "admin"})
        payload = verify_token(token)

        self.assertEqual(payload["sub"], "1")
        self.assertEqual(payload["username"], "admin")
        self.assertEqual(payload["role"], "admin")

    def test_invalid_token_raises_http_401(self):
        with self.assertRaises(HTTPException) as raised:
            verify_token("not-a-token")

        self.assertEqual(raised.exception.status_code, 401)


if __name__ == "__main__":
    os.environ.setdefault("SECRET_KEY", "test-secret")
    unittest.main()
