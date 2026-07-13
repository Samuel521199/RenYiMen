from types import SimpleNamespace
import unittest

from app.services.background_prompt import build_background_prompt, map_size_ratio_to_pixels


class BackgroundPromptTests(unittest.TestCase):
    def test_build_background_prompt_renders_required_structure_and_guardrails(self):
        batch = SimpleNamespace(
            purpose="活动、节日",
            scene="海边",
            mood=["轻松", "浪漫"],
            color_style="蓝金",
            whitespace_positions=["top", "right"],
            localized=True,
            size_ratio="16:9",
        )

        prompt = build_background_prompt(batch)

        self.assertIn("Generate a high-quality social media background for a Philippines gaming platform.", prompt)
        self.assertIn("Purpose: 活动、节日", prompt)
        self.assertIn("Scene: 海边", prompt)
        self.assertIn("Mood: 轻松, 浪漫", prompt)
        self.assertIn("Color style: 蓝金", prompt)
        self.assertIn("- top and right areas reserved for text overlay", prompt)
        self.assertIn("Subtle Philippines atmosphere, tropical lighting, Southeast Asia lifestyle hints.", prompt)
        self.assertIn("Output size: 16:9", prompt)
        self.assertIn("No text, no logo, no watermark, no readable signs", prompt)
        self.assertIn("No identifiable faces", prompt)
        self.assertIn("Keep whitespace areas clean and uncluttered", prompt)

    def test_build_background_prompt_falls_back_to_appropriate_areas_without_whitespace_selection(self):
        batch = SimpleNamespace(
            purpose="日常",
            scene="室内",
            mood=["轻松"],
            color_style="暖色调",
            whitespace_positions=[],
            localized=False,
            size_ratio="4:5",
        )

        prompt = build_background_prompt(batch)

        self.assertIn("- appropriate areas reserved for text overlay", prompt)
        self.assertNotIn("Subtle Philippines atmosphere", prompt)

    def test_build_background_prompt_uses_atmosphere_based_game_feel_copy_and_blocks_game_props(self):
        medium_prompt = build_background_prompt(SimpleNamespace(game_feel="medium"))
        strong_prompt = build_background_prompt(SimpleNamespace(game_feel="strong"))
        weak_prompt = build_background_prompt(SimpleNamespace(game_feel="weak"))

        self.assertIn(
            "Game feel direction: Subtle game-inspired atmosphere, slightly magical lighting and color tone, feels like a game world without specific game props.",
            medium_prompt,
        )
        self.assertIn(
            "Game feel direction: Strong fantasy game world atmosphere, magical lighting, vivid saturated colors, epic scene composition.",
            strong_prompt,
        )
        self.assertIn(
            "Game feel direction: Natural scene, clean and realistic, no game elements.",
            weak_prompt,
        )
        self.assertIn("No game props, coins, treasure boxes, or UI elements in the scene.", medium_prompt)
        self.assertNotIn("Suitable for adding mascot, coins, reward boxes, UI buttons", medium_prompt)

    def test_build_background_prompt_includes_extra_prompt_before_restrictions(self):
        prompt = build_background_prompt(
            SimpleNamespace(
                purpose="活动",
                scene="市场",
                mood=["热闹"],
                color_style="暖色调",
                whitespace_positions=["right"],
                localized=False,
                size_ratio="16:9",
                extra_prompt="地方集市，摊位密集，彩色遮阳布，热闹氛围",
            )
        )

        self.assertIn("Additional details:", prompt)
        self.assertIn("地方集市，摊位密集，彩色遮阳布，热闹氛围", prompt)
        self.assertLess(prompt.index("Additional details:"), prompt.index("Restrictions:"))

    def test_map_size_ratio_to_pixels_covers_common_background_ratios(self):
        self.assertEqual(map_size_ratio_to_pixels("1:1"), "1024x1024")
        self.assertEqual(map_size_ratio_to_pixels("4:5"), "1024x1280")
        self.assertEqual(map_size_ratio_to_pixels("16:9"), "1920x1080")
        self.assertEqual(map_size_ratio_to_pixels("9:16"), "1080x1920")
        self.assertEqual(map_size_ratio_to_pixels("unknown"), "1024x1024")
