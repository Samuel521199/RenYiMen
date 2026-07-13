import unittest

from app.middleware.static_cache import (
    build_static_cache_control,
    parse_static_cache_max_age,
)


class StaticCacheTests(unittest.TestCase):
    def test_parse_static_cache_max_age_defaults(self) -> None:
        self.assertEqual(parse_static_cache_max_age(None), 86_400)
        self.assertEqual(parse_static_cache_max_age("7200"), 7200)
        self.assertEqual(parse_static_cache_max_age("bad"), 86_400)

    def test_build_static_cache_control(self) -> None:
        self.assertEqual(
            build_static_cache_control(3600),
            "public, max-age=3600, must-revalidate",
        )


if __name__ == "__main__":
    unittest.main()
