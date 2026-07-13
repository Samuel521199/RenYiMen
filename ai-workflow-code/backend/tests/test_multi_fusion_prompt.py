import unittest

from app.services.multi_fusion_prompt import build_multi_fusion_prompt


class MultiFusionPromptTests(unittest.TestCase):
    def test_single_reference_prefix(self) -> None:
        prompt = build_multi_fusion_prompt("Blend the character into the scene.", 1)
        self.assertIn("reference image", prompt.lower())
        self.assertIn("Blend the character into the scene.", prompt)

    def test_multi_reference_prefix(self) -> None:
        prompt = build_multi_fusion_prompt("Put Image 1 subject into Image 2 background.", 3)
        self.assertIn("3 reference images", prompt)
        self.assertIn("Image 1 through Image 3", prompt)
        self.assertIn("Put Image 1 subject into Image 2 background.", prompt)

    def test_no_reference_returns_user_prompt(self) -> None:
        prompt = build_multi_fusion_prompt("Generate a poster.", 0)
        self.assertEqual(prompt, "Generate a poster.")


if __name__ == "__main__":
    unittest.main()
