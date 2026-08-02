"""规则包加载、语言识别与「默认」体例映射测试。"""

import unittest
from pathlib import Path

from oak_manuscript_core.errors import OakError
from oak_manuscript_core.rulepack import (
    detect_language,
    load_rulepack,
    load_standards,
    resolve_citation_style,
    validate_rulepack_identity,
)

REPO = Path(__file__).resolve().parents[2]
PACK_PATH = REPO / "config" / "rule-packs" / "oak-rules-1.0.0.json"
STANDARDS_PATH = REPO / "config" / "standards.json"


class RulepackLoadTest(unittest.TestCase):
    def test_loads_frozen_pack(self):
        pack = load_rulepack(PACK_PATH)
        self.assertEqual(pack["pack_name"], "oak-rules")
        self.assertEqual(pack["pack_version"], "1.0.0")
        self.assertEqual(len(pack["rules"]), 35)

    def test_rule_ids_unique(self):
        pack = load_rulepack(PACK_PATH)
        ids = [r["rule_id"] for r in pack["rules"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_all_standard_refs_registered(self):
        pack = load_rulepack(PACK_PATH)
        standards = load_standards(STANDARDS_PATH)
        known = {s["standard_id"] for s in standards["standards"]}
        for rule in pack["rules"]:
            for ref in rule["standard_refs"]:
                self.assertIn(ref, known, f"{rule['rule_id']} 引用了未注册标准 {ref}")

    def test_auto_fixable_rules_are_high_confidence(self):
        pack = load_rulepack(PACK_PATH)
        for rule in pack["rules"]:
            if rule["auto_fixable"]:
                self.assertEqual(
                    rule["confidence"], "high", f"{rule['rule_id']} 进白名单但置信度非 high"
                )
                self.assertIsNotNone(rule["fix_id"])

    def test_project_pin_sequence_is_cross_runtime_safe_integer(self):
        identity = {
            "name": "oak-rules",
            "version": "1.0.0",
            "pinned": True,
            "sha256": "a" * 64,
            "bundle_id": "oak-standards",
            "release_sequence": 9_007_199_254_740_992,
            "manifest_sha256": "b" * 64,
        }
        with self.assertRaisesRegex(OakError, "安全整数"):
            validate_rulepack_identity(identity)


class LanguageDetectTest(unittest.TestCase):
    def test_chinese_dominant(self):
        text = "这是一段足够长的中文文字。" * 30
        self.assertEqual(detect_language(text), "zh")

    def test_english_dominant(self):
        text = "This is a sufficiently long English sample text. " * 20
        self.assertEqual(detect_language(text), "en")

    def test_mixed(self):
        text = ("中文内容 English content 混合出现。mixed usage here. " * 20)
        self.assertEqual(detect_language(text), "mixed")

    def test_short_sample_falls_back_to_mixed(self):
        self.assertEqual(detect_language("短文本。short"), "mixed")


class CitationMappingTest(unittest.TestCase):
    def setUp(self):
        self.pack = load_rulepack(PACK_PATH)

    def test_paper_zh_maps_to_gbt(self):
        style, version = resolve_citation_style(self.pack, "paper", "zh")
        self.assertEqual(style, "gbt7714-2025")
        self.assertEqual(version, "1.0.0")

    def test_paper_mixed_maps_to_gbt(self):
        style, _ = resolve_citation_style(self.pack, "paper", "mixed")
        self.assertEqual(style, "gbt7714-2025")

    def test_paper_en_maps_to_apa(self):
        style, _ = resolve_citation_style(self.pack, "paper", "en")
        self.assertEqual(style, "apa-7")

    def test_print_book_maps_to_chicago(self):
        style, _ = resolve_citation_style(self.pack, "print_book", "zh")
        self.assertEqual(style, "chicago-18-nb")

    def test_ebook_maps_to_none(self):
        style, _ = resolve_citation_style(self.pack, "ebook", "en")
        self.assertEqual(style, "none")


if __name__ == "__main__":
    unittest.main()
