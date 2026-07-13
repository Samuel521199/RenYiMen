import inspect
import base64
import io
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from fastapi import HTTPException

from app.models.model_config import ModelConfig
from app.schemas.generate import ImageGenerateRequest
from app.services import (
    ai_gateway,
    audit_service,
    auth_service,
    cost_service,
    prompt_builder,
    storage_service,
    task_service,
)


class FakeDB:
    def __init__(self):
        self.added = []
        self.commits = 0
        self.refreshed = []

    def add(self, item):
        self.added.append(item)

    async def commit(self):
        self.commits += 1

    async def refresh(self, item):
        self.refreshed.append(item)


class FakeScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class FakeModelConfigDB(FakeDB):
    def __init__(self, model_config):
        super().__init__()
        self.model_config = model_config

    async def execute(self, query):
        return FakeScalarResult(self.model_config)


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_public_service_functions_accept_db_first(self):
        functions = [
            auth_service.login_user,
            task_service.create_task,
            task_service.list_tasks,
            task_service.get_task,
            task_service.update_task_status,
            task_service.get_task_cost_summary,
            prompt_builder.build_prompt,
            ai_gateway.generate_image,
            cost_service.log_generation_cost,
            storage_service.save_file,
            audit_service.write_audit_log,
        ]

        for func in functions:
            with self.subTest(func=func.__name__):
                first_param = next(iter(inspect.signature(func).parameters.values()))
                self.assertEqual(first_param.name, "db")

    def test_task_status_transition_follows_prd_order(self):
        self.assertTrue(task_service.is_valid_status_transition("created", "exploring"))
        self.assertTrue(task_service.is_valid_status_transition("reviewing", "done"))
        self.assertTrue(task_service.is_valid_status_transition("reviewing", "closed"))
        self.assertFalse(task_service.is_valid_status_transition("created", "done"))

        with self.assertRaises(HTTPException):
            task_service.validate_status_transition("created", "done")

    def test_prompt_template_replaces_known_variables(self):
        rendered = prompt_builder.render_template(
            "Theme={{theme}} Scene={{scene}} Size={{size}} Missing={{missing}}",
            {"theme": "Payday", "scene": "Pusoy", "size": "1080x1350"},
        )

        self.assertEqual(
            rendered,
            "Theme=Payday Scene=Pusoy Size=1080x1350 Missing={{missing}}",
        )

    def test_cost_calculation_uses_provider_rates(self):
        self.assertEqual(cost_service.calculate_cost_usd(None, "openai", 1000), Decimal("0.0100"))
        self.assertEqual(cost_service.calculate_cost_usd(None, "google", 1000), Decimal("0.0050"))

        with self.assertRaises(HTTPException):
            cost_service.calculate_cost_usd(None, "midjourney", 1000)

    async def test_storage_service_writes_local_file_and_returns_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = await storage_service.save_file(
                None,
                task_id=42,
                file_bytes=b"image-bytes",
                filename="draft.png",
                image_type="draft",
                storage_root=tmp,
            )

            self.assertEqual(result, "/static/task/42/draft/draft.png")
            self.assertEqual(
                Path(tmp, "task", "42", "draft", "draft.png").read_bytes(),
                b"image-bytes",
            )

    async def test_ai_gateway_base64_image_save_uses_unique_filenames_for_repeated_task_calls(self):
        saved_filenames = []

        async def fake_save_file(db, task_id, file_bytes, filename, image_type):
            saved_filenames.append(filename)
            return f"/static/task/{task_id}/{image_type}/{filename}"

        original_save_file = ai_gateway.storage_service.save_file
        ai_gateway.storage_service.save_file = fake_save_file
        try:
            png_base64 = base64.b64encode(b"\x89PNG\r\n\x1a\nimage").decode("ascii")
            first_url = await ai_gateway._save_base64_image(None, 42, "image/png", png_base64, 1)
            second_url = await ai_gateway._save_base64_image(None, 42, "image/png", png_base64, 1)
        finally:
            ai_gateway.storage_service.save_file = original_save_file

        self.assertEqual(len(saved_filenames), 2)
        self.assertNotEqual(saved_filenames[0], saved_filenames[1])
        self.assertTrue(saved_filenames[0].startswith("chat-generated-42-"))
        self.assertTrue(saved_filenames[0].endswith(".png"))
        self.assertNotEqual(first_url, second_url)

    async def test_storage_service_writes_asset_file_and_returns_static_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = await storage_service.save_asset_file(
                None,
                file_bytes=b"asset-bytes",
                filename="../hero.png",
                storage_root=tmp,
            )

            self.assertEqual(result, "/static/assets/hero.png")
            self.assertEqual(Path(tmp, "assets", "hero.png").read_bytes(), b"asset-bytes")

    async def test_audit_service_records_log(self):
        db = FakeDB()

        log = await audit_service.write_audit_log(
            db,
            user_id=1,
            action="task.create",
            detail="created task",
            ip_address="127.0.0.1",
        )

        self.assertEqual(log.user_id, 1)
        self.assertEqual(log.action, "task.create")
        self.assertEqual(db.added, [log])
        self.assertEqual(db.commits, 1)
        self.assertEqual(db.refreshed, [log])

    async def test_ai_gateway_rejects_unsupported_provider(self):
        request = ImageGenerateRequest(
            task_id=1,
            model_config_id=1,
            model_provider="midjourney",
            model_name="mj",
            prompt="draw",
            size="1080x1350",
        )

        with self.assertRaises(HTTPException) as raised:
            await ai_gateway.generate_image(None, request)

        self.assertEqual(raised.exception.status_code, 501)

    async def test_ai_gateway_uses_model_config_key_and_updates_used_today(self):
        model_config = ModelConfig(
            id=10,
            name="GPT Image",
            provider="openai",
            model_name="gpt-image-1",
            api_key="sk-db-key",
            price_per_image=Decimal("0.040000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        calls = []

        async def fake_post_json(url, headers, json):
            calls.append({"url": url, "headers": headers, "json": json})
            return {"data": [{"url": "https://example.com/image.png"}]}

        original = ai_gateway._post_json
        ai_gateway._post_json = fake_post_json
        try:
            response = await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=1,
                    model_config_id=10,
                    model_provider="openai",
                    model_name="ignored-by-config",
                    prompt="draw",
                    size="1080x1350",
                    count=1,
                ),
            )
        finally:
            ai_gateway._post_json = original

        self.assertEqual(calls[0]["headers"]["Authorization"], "Bearer sk-db-key")
        self.assertEqual(calls[0]["json"]["model"], "gpt-image-1")
        self.assertEqual(response.model_name, "gpt-image-1")
        self.assertEqual(response.cost_usd, Decimal("0.0400"))
        self.assertEqual(model_config.used_today, Decimal("0.0400"))
        self.assertEqual(db.commits, 1)

    async def test_ai_gateway_openai_uses_edits_endpoint_when_reference_image_exists(self):
        model_config = ModelConfig(
            id=11,
            name="GPT Image",
            provider="openai",
            model_name="gpt-image-2",
            api_key="sk-db-key",
            price_per_image=Decimal("0.010000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        calls = []

        async def fake_download(urls):
            self.assertEqual(urls, ["https://cdn.example.com/ref.png"])
            return [ai_gateway.DownloadedReferenceImage(mime_type="image/png", data_base64="abc123")]

        async def fake_post_json(url, headers, json):
            calls.append({"url": url, "headers": headers, "json": json})
            return {"data": [{"url": "https://example.com/edited.png"}]}

        original_download = ai_gateway._download_reference_images
        original_post_json = ai_gateway._post_json
        ai_gateway._download_reference_images = fake_download
        ai_gateway._post_json = fake_post_json
        try:
            await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=1,
                    model_config_id=11,
                    model_provider="openai",
                    model_name="ignored",
                    prompt="align character",
                    size="1024x1024",
                    count=1,
                ),
                reference_image_urls=["https://cdn.example.com/ref.png"],
            )
        finally:
            ai_gateway._download_reference_images = original_download
            ai_gateway._post_json = original_post_json

        self.assertEqual(calls[0]["url"], "https://api.openai.com/v1/images/edits")
        self.assertEqual(calls[0]["json"]["prompt"], "align character")
        self.assertEqual(calls[0]["json"]["image"], "data:image/png;base64,abc123")

    async def test_ai_gateway_google_includes_inline_image_parts_when_reference_images_exist(self):
        model_config = ModelConfig(
            id=12,
            name="Gemini Image",
            provider="google",
            model_name="gemini-2.5-flash-image",
            api_key="google-key",
            price_per_image=Decimal("0.010000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        calls = []

        async def fake_download(urls):
            self.assertEqual(urls, ["https://cdn.example.com/a.png", "https://cdn.example.com/b.jpg"])
            return [
                ai_gateway.DownloadedReferenceImage(mime_type="image/png", data_base64="png-data"),
                ai_gateway.DownloadedReferenceImage(mime_type="image/jpeg", data_base64="jpg-data"),
            ]

        async def fake_post_json(url, headers, json):
            calls.append({"url": url, "headers": headers, "json": json})
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {"inlineData": {"mimeType": "image/png", "data": "generated"}}
                            ]
                        }
                    }
                ]
            }

        original_download = ai_gateway._download_reference_images
        original_post_json = ai_gateway._post_json
        ai_gateway._download_reference_images = fake_download
        ai_gateway._post_json = fake_post_json
        try:
            await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=1,
                    model_config_id=12,
                    model_provider="google",
                    model_name="ignored",
                    prompt="match reference",
                    size="1024x1024",
                    count=1,
                ),
                reference_image_urls=["https://cdn.example.com/a.png", "https://cdn.example.com/b.jpg"],
            )
        finally:
            ai_gateway._download_reference_images = original_download
            ai_gateway._post_json = original_post_json

        parts = calls[0]["json"]["contents"][0]["parts"]
        self.assertEqual(parts[0]["inline_data"], {"mime_type": "image/png", "data": "png-data"})
        self.assertEqual(parts[1]["inline_data"], {"mime_type": "image/jpeg", "data": "jpg-data"})
        self.assertEqual(parts[2], {"text": "match reference"})

    async def test_ai_gateway_downloads_at_most_four_reference_images_and_compresses_before_base64(self):
        import httpx

        requested_urls = []
        compressed_inputs = []

        class FakeResponse:
            def __init__(self, content):
                self.content = content
                self.headers = {"content-type": "image/png"}

            def raise_for_status(self):
                return None

        class FakeAsyncClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            async def get(self, url):
                requested_urls.append(url)
                return FakeResponse(f"original-{len(requested_urls)}".encode())

        def fake_compress_image(image_bytes, max_size_kb=500):
            compressed_inputs.append((image_bytes, max_size_kb))
            return b"compressed-" + image_bytes

        original_client = httpx.AsyncClient
        original_compress = ai_gateway.compress_image
        httpx.AsyncClient = FakeAsyncClient
        ai_gateway.compress_image = fake_compress_image
        try:
            images = await ai_gateway._download_reference_images(
                [
                    "/static/assets/a.png",
                    "https://cdn.example.com/b.png",
                    "https://cdn.example.com/c.png",
                    "https://cdn.example.com/d.png",
                    "https://cdn.example.com/e.png",
                ]
            )
        finally:
            httpx.AsyncClient = original_client
            ai_gateway.compress_image = original_compress

        self.assertEqual(
            requested_urls,
            [
                "http://localhost:8000/static/assets/a.png",
                "https://cdn.example.com/b.png",
                "https://cdn.example.com/c.png",
                "https://cdn.example.com/d.png",
            ],
        )
        self.assertEqual(
            compressed_inputs,
            [(b"original-1", 500), (b"original-2", 500), (b"original-3", 500), (b"original-4", 500)],
        )
        self.assertEqual([image.mime_type for image in images], ["image/jpeg", "image/jpeg", "image/jpeg", "image/jpeg"])
        self.assertEqual(
            [image.data_base64 for image in images],
            [
                base64.b64encode(b"compressed-original-1").decode("ascii"),
                base64.b64encode(b"compressed-original-2").decode("ascii"),
                base64.b64encode(b"compressed-original-3").decode("ascii"),
                base64.b64encode(b"compressed-original-4").decode("ascii"),
            ],
        )

    async def test_ai_gateway_post_json_uses_long_timeout_and_backoff_between_retries(self):
        import httpx

        client_timeouts = []
        client_http2_values = []
        post_timeouts = []
        sleep_calls = []
        responses = [
            {"status": 500, "body": {"error": "first"}},
            {"status": 502, "body": {"error": "second"}},
            {"status": 200, "body": {"ok": True}},
        ]

        class FakeResponse:
            def __init__(self, status_code, body):
                self.status_code = status_code
                self._body = body
                self.text = str(body)

            def raise_for_status(self):
                if self.status_code >= 400:
                    raise httpx.HTTPStatusError(
                        "provider failed",
                        request=httpx.Request("POST", "https://provider.example.com/v1"),
                        response=httpx.Response(self.status_code),
                    )

            def json(self):
                return self._body

        class FakeAsyncClient:
            def __init__(self, *args, **kwargs):
                client_timeouts.append(kwargs.get("timeout"))
                client_http2_values.append(kwargs.get("http2"))

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            async def post(self, url, headers, json, timeout):
                post_timeouts.append(timeout)
                response = responses.pop(0)
                return FakeResponse(response["status"], response["body"])

        async def fake_sleep(seconds):
            sleep_calls.append(seconds)

        original_client = httpx.AsyncClient
        original_sleep = ai_gateway.asyncio.sleep
        httpx.AsyncClient = FakeAsyncClient
        ai_gateway.asyncio.sleep = fake_sleep
        try:
            result = await ai_gateway._post_json(
                "https://provider.example.com/v1/images",
                headers={},
                json={"prompt": "slow image"},
            )
        finally:
            httpx.AsyncClient = original_client
            ai_gateway.asyncio.sleep = original_sleep

        self.assertEqual(result, {"ok": True})
        self.assertEqual(client_timeouts, [600.0, 600.0, 600.0])
        self.assertEqual(client_http2_values, [False, False, False])
        self.assertEqual(post_timeouts, [600.0, 600.0, 600.0])
        self.assertEqual(sleep_calls, [5, 10])

    async def test_ai_gateway_post_multipart_disables_http2(self):
        import httpx

        client_http2_values = []
        post_payloads = []

        class FakeResponse:
            status_code = 200
            text = "{}"

            def raise_for_status(self):
                return None

            def json(self):
                return {"ok": True}

        class FakeAsyncClient:
            def __init__(self, *args, **kwargs):
                client_http2_values.append(kwargs.get("http2"))

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            async def post(self, url, headers, data, files, timeout):
                post_payloads.append(
                    {
                        "url": url,
                        "headers": headers,
                        "data": data,
                        "files": files,
                        "timeout": timeout,
                    }
                )
                return FakeResponse()

        original_client = httpx.AsyncClient
        httpx.AsyncClient = FakeAsyncClient
        try:
            result = await ai_gateway._post_multipart(
                "https://provider.example.com/v1/images/edits",
                headers={"Authorization": "Bearer test"},
                data={"model": "gpt-image-2"},
                files=[
                    (
                        "image[]",
                        ("reference-1.png", io.BytesIO(b"image-bytes"), "image/png"),
                    )
                ],
            )
        finally:
            httpx.AsyncClient = original_client

        self.assertEqual(result, {"ok": True})
        self.assertEqual(client_http2_values, [False])
        self.assertEqual(post_payloads[0]["timeout"], 600.0)
        self.assertEqual(post_payloads[0]["files"][0][0], "image[]")

    async def test_ai_gateway_post_json_waits_longer_after_rate_limit(self):
        import httpx

        sleep_calls = []
        raise_calls = []
        responses = [
            {"status": 429, "body": {"error": "rate limited"}},
            {"status": 200, "body": {"ok": True}},
        ]

        class FakeResponse:
            def __init__(self, status_code, body):
                self.status_code = status_code
                self._body = body
                self.text = str(body)

            def raise_for_status(self):
                raise_calls.append(self.status_code)
                if self.status_code >= 400:
                    raise httpx.HTTPStatusError(
                        "provider failed",
                        request=httpx.Request("POST", "https://provider.example.com/v1"),
                        response=httpx.Response(self.status_code),
                    )

            def json(self):
                return self._body

        class FakeAsyncClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            async def post(self, url, headers, json, timeout):
                response = responses.pop(0)
                return FakeResponse(response["status"], response["body"])

        async def fake_sleep(seconds):
            sleep_calls.append(seconds)

        original_client = httpx.AsyncClient
        original_sleep = ai_gateway.asyncio.sleep
        httpx.AsyncClient = FakeAsyncClient
        ai_gateway.asyncio.sleep = fake_sleep
        try:
            result = await ai_gateway._post_json(
                "https://provider.example.com/v1/images",
                headers={},
                json={"prompt": "slow image"},
            )
        finally:
            httpx.AsyncClient = original_client
            ai_gateway.asyncio.sleep = original_sleep

        self.assertEqual(result, {"ok": True})
        self.assertEqual(sleep_calls, [30])
        self.assertEqual(raise_calls, [200])

    async def test_ai_gateway_uses_openai_compatible_chat_completions_when_base_url_is_set(self):
        model_config = ModelConfig(
            id=13,
            name="Gemini Relay",
            provider="google",
            model_name="gemini-3.1-flash-image-preview",
            api_key="relay-key",
            base_url="https://aihubmix.com/v1",
            price_per_image=Decimal("0.010000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        calls = []

        async def fake_post_json(url, headers, json):
            calls.append({"url": url, "headers": headers, "json": json})
            return {
                "choices": [
                    {
                        "message": {
                            "content": "https://example.com/relay.png"
                        }
                    }
                ]
            }

        original_post_json = ai_gateway._post_json
        ai_gateway._post_json = fake_post_json
        try:
            await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=1,
                    model_config_id=13,
                    model_provider="google",
                    model_name="ignored",
                    prompt="relay image",
                    size="1024x1024",
                    count=1,
                ),
            )
        finally:
            ai_gateway._post_json = original_post_json

        self.assertEqual(calls[0]["url"], "https://aihubmix.com/v1/chat/completions")
        self.assertEqual(calls[0]["headers"]["Authorization"], "Bearer relay-key")
        self.assertEqual(calls[0]["json"]["model"], "gemini-3.1-flash-image-preview")
        self.assertEqual(
            calls[0]["json"]["messages"],
            [{"role": "user", "content": "请生成一张图片：relay image"}],
        )
        self.assertNotIn("models/gemini-3.1-flash-image-preview:generateContent", calls[0]["url"])

    async def test_ai_gateway_image_model_with_references_uses_multipart_edits(self):
        model_config = ModelConfig(
            id=21,
            name="APIYI GPT Image",
            provider="openai",
            model_name="gpt-image-2",
            api_key="apiyi-key",
            base_url="https://api.apiyi.com/v1",
            price_per_image=Decimal("0.100000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        multipart_calls = []
        saved = []

        async def fake_download(urls):
            self.assertEqual(urls, ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"])
            return [
                ai_gateway.DownloadedReferenceImage(
                    mime_type="image/png",
                    data_base64=base64.b64encode(b"reference-a").decode("ascii"),
                ),
                ai_gateway.DownloadedReferenceImage(
                    mime_type="image/jpeg",
                    data_base64=base64.b64encode(b"reference-b").decode("ascii"),
                ),
            ]

        async def fake_post_multipart(url, headers, data, files):
            multipart_calls.append({"url": url, "headers": headers, "data": data, "files": files})
            return {"data": [{"b64_json": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"}]}

        async def fake_save_base64_image(db, task_id, mime_type, data_base64, index):
            saved.append(
                {
                    "task_id": task_id,
                    "mime_type": mime_type,
                    "data_base64": data_base64,
                    "index": index,
                }
            )
            return "/static/task/7/draft/chat-generated-7-1.png"

        original_download = ai_gateway._download_reference_images
        original_post_multipart = ai_gateway._post_multipart
        original_save_base64_image = ai_gateway._save_base64_image
        ai_gateway._download_reference_images = fake_download
        ai_gateway._post_multipart = fake_post_multipart
        ai_gateway._save_base64_image = fake_save_base64_image
        try:
            response = await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=7,
                    model_config_id=21,
                    model_provider="openai",
                    model_name="ignored",
                    prompt="make a final cow",
                    size="1024x1024",
                    count=1,
                ),
                reference_image_urls=["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"],
            )
        finally:
            ai_gateway._download_reference_images = original_download
            ai_gateway._post_multipart = original_post_multipart
            ai_gateway._save_base64_image = original_save_base64_image

        self.assertEqual(multipart_calls[0]["url"], "https://api.apiyi.com/v1/images/edits")
        self.assertEqual(multipart_calls[0]["headers"]["Authorization"], "Bearer apiyi-key")
        self.assertEqual(
            multipart_calls[0]["data"],
            {
                "model": "gpt-image-2",
                "prompt": "make a final cow",
                "size": "1024x1024",
                "quality": "high",
                "output_format": "png",
            },
        )
        self.assertEqual([field for field, _ in multipart_calls[0]["files"]], ["image[]", "image[]"])
        first_file = multipart_calls[0]["files"][0][1]
        second_file = multipart_calls[0]["files"][1][1]
        self.assertEqual(first_file[0], "reference-1.png")
        self.assertEqual(first_file[1].getvalue(), b"reference-a")
        self.assertEqual(first_file[2], "image/png")
        self.assertEqual(second_file[0], "reference-2.jpg")
        self.assertEqual(second_file[1].getvalue(), b"reference-b")
        self.assertEqual(second_file[2], "image/jpeg")
        self.assertEqual(saved[0]["mime_type"], "image/png")
        self.assertEqual(saved[0]["data_base64"], "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB")
        self.assertEqual(response.images[0]["url"], "/static/task/7/draft/chat-generated-7-1.png")
        self.assertEqual(response.cost_usd, Decimal("0.1000"))

    async def test_ai_gateway_image_model_without_references_uses_generations_json(self):
        model_config = ModelConfig(
            id=22,
            name="APIYI GPT Image",
            provider="openai",
            model_name="gpt-image-2",
            api_key="apiyi-key",
            base_url="https://api.apiyi.com/v1",
            price_per_image=Decimal("0.100000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        json_calls = []
        saved = []

        async def fake_post_json(url, headers, json):
            json_calls.append({"url": url, "headers": headers, "json": json})
            return {"data": [{"b64_json": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"}]}

        async def fake_save_base64_image(db, task_id, mime_type, data_base64, index):
            saved.append(
                {
                    "task_id": task_id,
                    "mime_type": mime_type,
                    "data_base64": data_base64,
                    "index": index,
                }
            )
            return "/static/task/8/draft/chat-generated-8-1.png"

        original_post_json = ai_gateway._post_json
        original_save_base64_image = ai_gateway._save_base64_image
        ai_gateway._post_json = fake_post_json
        ai_gateway._save_base64_image = fake_save_base64_image
        try:
            response = await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=8,
                    model_config_id=22,
                    model_provider="openai",
                    model_name="ignored",
                    prompt="make a draft cow",
                    size="1024x1024",
                    count=4,
                ),
            )
        finally:
            ai_gateway._post_json = original_post_json
            ai_gateway._save_base64_image = original_save_base64_image

        self.assertEqual(json_calls[0]["url"], "https://api.apiyi.com/v1/images/generations")
        self.assertEqual(json_calls[0]["headers"]["Authorization"], "Bearer apiyi-key")
        self.assertEqual(
            json_calls[0]["json"],
            {
                "model": "gpt-image-2",
                "prompt": "make a draft cow",
                "n": 1,
                "size": "1024x1024",
                "quality": "high",
            },
        )
        self.assertEqual(saved[0]["mime_type"], "image/png")
        self.assertEqual(response.images[0]["url"], "/static/task/8/draft/chat-generated-8-1.png")

    def test_ai_gateway_recognizes_human_spaced_gpt_image_model_names(self):
        self.assertTrue(ai_gateway._is_image_api_model("GPT Image 2"))
        self.assertTrue(ai_gateway._is_image_api_model("gpt_image_1"))
        self.assertFalse(ai_gateway._is_image_api_model("gemini-3.1-flash-image-preview"))

    def test_ai_gateway_selects_image_field_name_by_base_url(self):
        self.assertEqual(ai_gateway.get_image_field_name("https://api.pucoding.com/v1"), "image")
        self.assertEqual(ai_gateway.get_image_field_name("https://api.apiyi.com/v1"), "image[]")
        self.assertEqual(ai_gateway.get_image_field_name(None), "image[]")

    async def test_ai_gateway_pucoding_image_model_uses_single_image_field_name(self):
        model_config = ModelConfig(
            id=24,
            name="Pucoding GPT Image",
            provider="openai",
            model_name="gpt-image-2",
            api_key="pucoding-key",
            base_url="https://api.pucoding.com/v1",
            price_per_image=Decimal("0.100000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        multipart_calls = []

        async def fake_download(urls):
            self.assertEqual(urls, ["https://cdn.example.com/ref.png"])
            return [
                ai_gateway.DownloadedReferenceImage(
                    mime_type="image/png",
                    data_base64=base64.b64encode(b"reference").decode("ascii"),
                ),
            ]

        async def fake_post_multipart(url, headers, data, files):
            multipart_calls.append({"url": url, "headers": headers, "data": data, "files": files})
            return {"data": [{"b64_json": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"}]}

        async def fake_save_base64_image(db, task_id, mime_type, data_base64, index):
            return "/static/task/10/draft/chat-generated-10-1.png"

        original_download = ai_gateway._download_reference_images
        original_post_multipart = ai_gateway._post_multipart
        original_save_base64_image = ai_gateway._save_base64_image
        ai_gateway._download_reference_images = fake_download
        ai_gateway._post_multipart = fake_post_multipart
        ai_gateway._save_base64_image = fake_save_base64_image
        try:
            response = await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=10,
                    model_config_id=24,
                    model_provider="openai",
                    model_name="ignored",
                    prompt="make a cow",
                    size="1024x1024",
                    count=1,
                ),
                reference_image_urls=["https://cdn.example.com/ref.png"],
            )
        finally:
            ai_gateway._download_reference_images = original_download
            ai_gateway._post_multipart = original_post_multipart
            ai_gateway._save_base64_image = original_save_base64_image

        self.assertEqual(multipart_calls[0]["url"], "https://api.pucoding.com/v1/images/edits")
        self.assertEqual(multipart_calls[0]["headers"]["Authorization"], "Bearer pucoding-key")
        self.assertEqual([field for field, _ in multipart_calls[0]["files"]], ["image"])
        self.assertEqual(multipart_calls[0]["files"][0][1][0], "reference-1.png")
        self.assertEqual(multipart_calls[0]["files"][0][1][1].getvalue(), b"reference")
        self.assertEqual(response.images[0]["url"], "/static/task/10/draft/chat-generated-10-1.png")

    async def test_ai_gateway_gpt_image_2_all_with_references_uses_multipart_edits(self):
        model_config = ModelConfig(
            id=23,
            name="APIYI GPT Image All",
            provider="openai",
            model_name="gpt-image-2-all",
            api_key="apiyi-key",
            base_url="https://api.apiyi.com/v1",
            price_per_image=Decimal("0.100000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        multipart_calls = []
        saved = []

        async def fake_download(urls):
            self.assertEqual(
                urls,
                [
                    "https://cdn.example.com/first.png",
                    "https://cdn.example.com/second.png",
                    "https://cdn.example.com/third.png",
                    "https://cdn.example.com/fourth.png",
                ],
            )
            return [
                ai_gateway.DownloadedReferenceImage(
                    mime_type="image/jpeg",
                    data_base64=base64.b64encode(b"first-reference").decode("ascii"),
                ),
                ai_gateway.DownloadedReferenceImage(
                    mime_type="image/png",
                    data_base64=base64.b64encode(b"second-reference").decode("ascii"),
                ),
                ai_gateway.DownloadedReferenceImage(
                    mime_type="image/jpeg",
                    data_base64=base64.b64encode(b"third-reference").decode("ascii"),
                ),
                ai_gateway.DownloadedReferenceImage(
                    mime_type="image/png",
                    data_base64=base64.b64encode(b"fourth-reference").decode("ascii"),
                ),
            ]

        async def fake_post_multipart(url, headers, data, files):
            multipart_calls.append({"url": url, "headers": headers, "data": data, "files": files})
            return {"data": [{"b64_json": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"}], "usage": {"total_tokens": 12}}

        async def fake_save_base64_image(db, task_id, mime_type, data_base64, index):
            saved.append(
                {
                    "task_id": task_id,
                    "mime_type": mime_type,
                    "data_base64": data_base64,
                    "index": index,
                }
            )
            return "/static/task/9/draft/chat-generated-9-1.png"

        original_download = ai_gateway._download_reference_images
        original_post_multipart = ai_gateway._post_multipart
        original_save_base64_image = ai_gateway._save_base64_image
        ai_gateway._download_reference_images = fake_download
        ai_gateway._post_multipart = fake_post_multipart
        ai_gateway._save_base64_image = fake_save_base64_image
        try:
            response = await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=9,
                    model_config_id=23,
                    model_provider="openai",
                    model_name="ignored",
                    prompt="动作：惊讶张嘴，只生成单张图片，一只牛，不要拼图。",
                    size="1024x1024",
                    count=1,
                ),
                reference_image_urls=[
                    "https://cdn.example.com/first.png",
                    "https://cdn.example.com/second.png",
                    "https://cdn.example.com/third.png",
                    "https://cdn.example.com/fourth.png",
                    "https://cdn.example.com/fifth.png",
                ],
            )
        finally:
            ai_gateway._download_reference_images = original_download
            ai_gateway._post_multipart = original_post_multipart
            ai_gateway._save_base64_image = original_save_base64_image

        self.assertEqual(multipart_calls[0]["url"], "https://api.apiyi.com/v1/images/edits")
        self.assertEqual(multipart_calls[0]["headers"]["Authorization"], "Bearer apiyi-key")
        self.assertEqual(
            multipart_calls[0]["data"],
            {
                "model": "gpt-image-2-all",
                "prompt": "动作：惊讶张嘴，只生成单张图片，一只牛，不要拼图。",
                "size": "1024x1024",
                "quality": "high",
                "output_format": "png",
            },
        )
        self.assertEqual([field for field, _ in multipart_calls[0]["files"]], ["image[]", "image[]", "image[]", "image[]"])
        self.assertEqual(multipart_calls[0]["files"][0][1][0], "reference-1.jpg")
        self.assertEqual(multipart_calls[0]["files"][0][1][1].getvalue(), b"first-reference")
        self.assertEqual(multipart_calls[0]["files"][1][1][0], "reference-2.png")
        self.assertEqual(multipart_calls[0]["files"][2][1][0], "reference-3.jpg")
        self.assertEqual(multipart_calls[0]["files"][2][1][1].getvalue(), b"third-reference")
        self.assertEqual(multipart_calls[0]["files"][3][1][0], "reference-4.png")
        self.assertEqual(multipart_calls[0]["files"][3][1][1].getvalue(), b"fourth-reference")
        self.assertEqual(multipart_calls[0]["files"][1][1][1].getvalue(), b"second-reference")
        self.assertEqual(len(multipart_calls[0]["files"]), 4)
        self.assertEqual(saved[0]["mime_type"], "image/png")
        self.assertEqual(response.images[0]["url"], "/static/task/9/draft/chat-generated-9-1.png")
        self.assertEqual(response.token_used, 12)
        self.assertEqual(response.cost_usd, Decimal("0.1000"))

    async def test_ai_gateway_openai_compatible_chat_completions_sends_reference_images(self):
        model_config = ModelConfig(
            id=14,
            name="Gemini Relay",
            provider="google",
            model_name="gemini-3.1-flash-image-preview",
            api_key="relay-key",
            base_url="https://aihubmix.com/v1",
            price_per_image=Decimal("0.010000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        calls = []

        async def fake_download(urls):
            self.assertEqual(urls, ["https://cdn.example.com/ref.png"])
            return [ai_gateway.DownloadedReferenceImage(mime_type="image/png", data_base64="ref-base64")]

        async def fake_post_json(url, headers, json):
            calls.append({"url": url, "headers": headers, "json": json})
            return {
                "choices": [
                    {
                        "message": {
                            "content": "https://example.com/generated.png"
                        }
                    }
                ]
            }

        original_download = ai_gateway._download_reference_images
        original_post_json = ai_gateway._post_json
        ai_gateway._download_reference_images = fake_download
        ai_gateway._post_json = fake_post_json
        try:
            response = await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=1,
                    model_config_id=14,
                    model_provider="google",
                    model_name="ignored",
                    prompt="relay with image",
                    size="1024x1024",
                    count=1,
                ),
                reference_image_urls=["https://cdn.example.com/ref.png"],
            )
        finally:
            ai_gateway._download_reference_images = original_download
            ai_gateway._post_json = original_post_json

        content = calls[0]["json"]["messages"][0]["content"]
        self.assertEqual(calls[0]["url"], "https://aihubmix.com/v1/chat/completions")
        self.assertEqual(content[0]["type"], "image_url")
        self.assertEqual(content[0]["image_url"]["url"], "data:image/png;base64,ref-base64")
        self.assertEqual(content[1], {"type": "text", "text": "参考以上图片风格，生成：relay with image"})
        self.assertEqual(response.images[0]["url"], "https://example.com/generated.png")

    async def test_ai_gateway_openai_compatible_chat_completions_saves_raw_base64_image(self):
        model_config = ModelConfig(
            id=15,
            name="Gemini Relay",
            provider="google",
            model_name="gemini-3.1-flash-image-preview",
            api_key="relay-key",
            base_url="https://aihubmix.com/v1",
            price_per_image=Decimal("0.010000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        saved = []

        async def fake_post_json(url, headers, json):
            return {
                "choices": [
                    {
                        "message": {
                            "content": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
                        }
                    }
                ]
            }

        async def fake_save_base64_image(db, task_id, mime_type, data_base64, index):
            saved.append(
                {
                    "task_id": task_id,
                    "mime_type": mime_type,
                    "data_base64": data_base64,
                    "index": index,
                }
            )
            return "/static/task/2/draft/chat-generated-2-1.png"

        original_post_json = ai_gateway._post_json
        original_save_base64_image = ai_gateway._save_base64_image
        ai_gateway._post_json = fake_post_json
        ai_gateway._save_base64_image = fake_save_base64_image
        try:
            response = await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=2,
                    model_config_id=15,
                    model_provider="google",
                    model_name="ignored",
                    prompt="relay raw base64",
                    size="1024x1024",
                    count=1,
                ),
            )
        finally:
            ai_gateway._post_json = original_post_json
            ai_gateway._save_base64_image = original_save_base64_image

        self.assertEqual(saved[0]["mime_type"], "image/png")
        self.assertEqual(saved[0]["data_base64"], "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB")
        self.assertEqual(response.images[0]["url"], "/static/task/2/draft/chat-generated-2-1.png")

    async def test_ai_gateway_openai_compatible_chat_completions_reads_multi_mod_content(self):
        model_config = ModelConfig(
            id=16,
            name="Gemini Relay",
            provider="google",
            model_name="gemini-3.1-flash-image-preview",
            api_key="relay-key",
            base_url="https://aihubmix.com/v1",
            price_per_image=Decimal("0.010000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        saved = []

        async def fake_post_json(url, headers, json):
            return {
                "choices": [
                    {
                        "message": {
                            "content": "",
                            "multi_mod_content": [
                                {
                                    "inline_data": {
                                        "mime_type": "image/png",
                                        "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
                                    }
                                }
                            ],
                        }
                    }
                ]
            }

        async def fake_save_base64_image(db, task_id, mime_type, data_base64, index):
            saved.append(
                {
                    "task_id": task_id,
                    "mime_type": mime_type,
                    "data_base64": data_base64,
                    "index": index,
                }
            )
            return "/static/task/3/draft/chat-generated-3-1.png"

        original_post_json = ai_gateway._post_json
        original_save_base64_image = ai_gateway._save_base64_image
        ai_gateway._post_json = fake_post_json
        ai_gateway._save_base64_image = fake_save_base64_image
        try:
            response = await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=3,
                    model_config_id=16,
                    model_provider="google",
                    model_name="ignored",
                    prompt="relay multi mod",
                    size="1024x1024",
                    count=1,
                ),
            )
        finally:
            ai_gateway._post_json = original_post_json
            ai_gateway._save_base64_image = original_save_base64_image

        self.assertEqual(saved[0]["mime_type"], "image/png")
        self.assertEqual(saved[0]["data_base64"], "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB")
        self.assertEqual(response.images[0]["url"], "/static/task/3/draft/chat-generated-3-1.png")

    def test_ai_gateway_extracts_markdown_data_uri_images(self):
        content = "生成完成：![image](data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==)"

        self.assertEqual(
            ai_gateway.extract_base64_from_markdown(content),
            [("image/jpeg", "/9j/4AAQSkZJRgABAQ==")],
        )

    async def test_ai_gateway_openai_compatible_chat_completions_reads_markdown_data_uri_image(self):
        model_config = ModelConfig(
            id=25,
            name="Gemini Relay",
            provider="google",
            model_name="gemini-3.1-flash-image-preview",
            api_key="relay-key",
            base_url="https://aihubmix.com/v1",
            price_per_image=Decimal("0.010000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        saved = []

        async def fake_post_json(url, headers, json):
            return {
                "choices": [
                    {
                        "message": {
                            "content": "生成完成：![image](data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==)"
                        }
                    }
                ],
                "usage": {"total_tokens": 8},
            }

        async def fake_save_base64_image(db, task_id, mime_type, data_base64, index):
            saved.append(
                {
                    "task_id": task_id,
                    "mime_type": mime_type,
                    "data_base64": data_base64,
                    "index": index,
                }
            )
            return "/static/task/25/draft/chat-generated-25-1.jpg"

        original_post_json = ai_gateway._post_json
        original_save_base64_image = ai_gateway._save_base64_image
        ai_gateway._post_json = fake_post_json
        ai_gateway._save_base64_image = fake_save_base64_image
        try:
            response = await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=25,
                    model_config_id=25,
                    model_provider="google",
                    model_name="ignored",
                    prompt="relay markdown image",
                    size="1024x1024",
                    count=1,
                ),
            )
        finally:
            ai_gateway._post_json = original_post_json
            ai_gateway._save_base64_image = original_save_base64_image

        self.assertEqual(saved[0]["mime_type"], "image/jpeg")
        self.assertEqual(saved[0]["data_base64"], "/9j/4AAQSkZJRgABAQ==")
        self.assertEqual(response.images[0]["url"], "/static/task/25/draft/chat-generated-25-1.jpg")
        self.assertEqual(response.token_used, 8)

    async def test_ai_gateway_draft_count_calls_openai_compatible_relay_once(self):
        model_config = ModelConfig(
            id=26,
            name="Gemini Relay",
            provider="google",
            model_name="gemini-3.1-flash-image-preview",
            api_key="relay-key",
            base_url="https://aihubmix.com/v1",
            price_per_image=Decimal("0.010000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        calls = []
        saved_indices = []

        async def fake_post_json(url, headers, json):
            calls.append({"url": url, "headers": headers, "json": json})
            return {
                "choices": [
                    {
                        "message": {
                            "multi_mod_content": [
                                {
                                    "inline_data": {
                                        "mime_type": "image/png",
                                        "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
                                    }
                                },
                                {
                                    "inline_data": {
                                        "mime_type": "image/png",
                                        "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
                                    }
                                },
                            ]
                        }
                    }
                ],
                "usage": {"total_tokens": 7},
            }

        async def fake_save_base64_image(db, task_id, mime_type, data_base64, index):
            saved_indices.append(index)
            return f"/static/task/26/draft/chat-generated-26-{index}.png"

        original_post_json = ai_gateway._post_json
        original_save_base64_image = ai_gateway._save_base64_image
        ai_gateway._post_json = fake_post_json
        ai_gateway._save_base64_image = fake_save_base64_image
        try:
            response = await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=26,
                    model_config_id=26,
                    mode="draft",
                    model_provider="google",
                    model_name="ignored",
                    prompt="relay draft collage",
                    size="1024x1024",
                    count=4,
                ),
            )
        finally:
            ai_gateway._post_json = original_post_json
            ai_gateway._save_base64_image = original_save_base64_image

        self.assertEqual(len(calls), 1)
        self.assertEqual(saved_indices, [1, 2])
        self.assertEqual(
            [image["url"] for image in response.images],
            [
                "/static/task/26/draft/chat-generated-26-1.png",
                "/static/task/26/draft/chat-generated-26-2.png",
            ],
        )
        self.assertEqual(response.token_used, 7)
        self.assertEqual(response.cost_usd, Decimal("0.0200"))

    async def test_ai_gateway_openai_compatible_chat_completions_calls_once_per_count(self):
        model_config = ModelConfig(
            id=17,
            name="Gemini Relay",
            provider="google",
            model_name="gemini-3.1-flash-image-preview",
            api_key="relay-key",
            base_url="https://aihubmix.com/v1",
            price_per_image=Decimal("0.010000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        calls = []

        async def fake_post_json(url, headers, json):
            calls.append({"url": url, "headers": headers, "json": json})
            return {
                "choices": [
                    {
                        "message": {
                            "content": f"https://example.com/generated-{len(calls)}.png"
                        }
                    }
                ],
                "usage": {"total_tokens": 10},
            }

        original_post_json = ai_gateway._post_json
        ai_gateway._post_json = fake_post_json
        try:
            response = await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=4,
                    model_config_id=17,
                    model_provider="google",
                    model_name="ignored",
                    prompt="relay count",
                    size="1024x1024",
                    count=3,
                ),
            )
        finally:
            ai_gateway._post_json = original_post_json

        self.assertEqual(len(calls), 3)
        self.assertEqual(
            [image["url"] for image in response.images],
            [
                "https://example.com/generated-1.png",
                "https://example.com/generated-2.png",
                "https://example.com/generated-3.png",
            ],
        )
        self.assertEqual(response.token_used, 30)
        self.assertEqual(response.cost_usd, Decimal("0.0300"))

    async def test_ai_gateway_openai_compatible_chat_completions_keeps_successes_after_failure(self):
        model_config = ModelConfig(
            id=18,
            name="Gemini Relay",
            provider="google",
            model_name="gemini-3.1-flash-image-preview",
            api_key="relay-key",
            base_url="https://aihubmix.com/v1",
            price_per_image=Decimal("0.010000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        calls = []

        async def fake_post_json(url, headers, json):
            calls.append({"url": url, "headers": headers, "json": json})
            if len(calls) == 2:
                raise RuntimeError("provider timeout")
            return {
                "choices": [
                    {
                        "message": {
                            "content": f"https://example.com/generated-{len(calls)}.png"
                        }
                    }
                ],
                "usage": {"total_tokens": 10},
            }

        original_post_json = ai_gateway._post_json
        ai_gateway._post_json = fake_post_json
        try:
            with self.assertLogs(ai_gateway.logger, level="WARNING") as logs:
                response = await ai_gateway.generate_image(
                    db,
                    ImageGenerateRequest(
                        task_id=5,
                        model_config_id=18,
                        model_provider="google",
                        model_name="ignored",
                        prompt="relay partial",
                        size="1024x1024",
                        count=3,
                    ),
                )
        finally:
            ai_gateway._post_json = original_post_json

        self.assertEqual(len(calls), 3)
        self.assertIn("Generation 2/3 failed", "\n".join(logs.output))
        self.assertEqual(
            [image["url"] for image in response.images],
            [
                "https://example.com/generated-1.png",
                "https://example.com/generated-3.png",
            ],
        )
        self.assertEqual(response.token_used, 20)
        self.assertEqual(response.cost_usd, Decimal("0.0200"))

    async def test_ai_gateway_openai_compatible_chat_completions_uses_count_index_for_saved_files(self):
        model_config = ModelConfig(
            id=19,
            name="Gemini Relay",
            provider="google",
            model_name="gemini-3.1-flash-image-preview",
            api_key="relay-key",
            base_url="https://aihubmix.com/v1",
            price_per_image=Decimal("0.010000"),
            used_today=Decimal("0"),
            active=True,
        )
        db = FakeModelConfigDB(model_config)
        saved_indices = []

        async def fake_post_json(url, headers, json):
            return {
                "choices": [
                    {
                        "message": {
                            "multi_mod_content": [
                                {
                                    "inline_data": {
                                        "mime_type": "image/png",
                                        "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
                                    }
                                }
                            ]
                        }
                    }
                ],
                "usage": {"total_tokens": 1},
            }

        async def fake_save_base64_image(db, task_id, mime_type, data_base64, index):
            saved_indices.append(index)
            return f"/static/task/6/draft/chat-generated-6-{index}.png"

        original_post_json = ai_gateway._post_json
        original_save_base64_image = ai_gateway._save_base64_image
        ai_gateway._post_json = fake_post_json
        ai_gateway._save_base64_image = fake_save_base64_image
        try:
            response = await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=6,
                    model_config_id=19,
                    model_provider="google",
                    model_name="ignored",
                    prompt="relay saved index",
                    size="1024x1024",
                    count=3,
                ),
            )
        finally:
            ai_gateway._post_json = original_post_json
            ai_gateway._save_base64_image = original_save_base64_image

        self.assertEqual(saved_indices, [1, 2, 3])
        self.assertEqual(
            [image["url"] for image in response.images],
            [
                "/static/task/6/draft/chat-generated-6-1.png",
                "/static/task/6/draft/chat-generated-6-2.png",
                "/static/task/6/draft/chat-generated-6-3.png",
            ],
        )


if __name__ == "__main__":
    unittest.main()
