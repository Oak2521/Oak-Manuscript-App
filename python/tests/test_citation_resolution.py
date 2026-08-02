"""Deterministic, privacy-safe citation resolution contract tests."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from oak_manuscript_core.citation import (
    analyze_language,
    extract_citation_signals,
    resolve_citation,
    validate_citation_resolution,
)
from oak_manuscript_core.errors import OakError
from oak_manuscript_core.model import Document, Footnote, Paragraph
from oak_manuscript_core.rulepack import load_rulepack


REPO = Path(__file__).resolve().parents[2]


def settings(
    profile: str = "paper",
    language: str = "zh",
    citation_style: str = "default",
) -> dict:
    return {
        "manuscript_type": profile,
        "language": language,
        "citation_style": citation_style,
    }


def paragraph(index: int, text: str, *, heading: int | None = None) -> Paragraph:
    return Paragraph(part="document", index=index, text=text, heading_level=heading)


def document(
    body: list[str],
    entries: list[str] | None = None,
    *,
    notes: list[tuple[int, str]] | None = None,
    note_refs: list[int] | None = None,
) -> Document:
    paragraphs = [paragraph(index, text) for index, text in enumerate(body, start=1)]
    if entries is not None:
        paragraphs.append(paragraph(len(paragraphs) + 1, "参考文献", heading=1))
        first_entry_index = len(paragraphs) + 1
        paragraphs.extend(
            paragraph(first_entry_index + offset, text)
            for offset, text in enumerate(entries)
        )
    return Document(
        paragraphs=paragraphs,
        footnotes=[Footnote(note_id=note_id, text=text) for note_id, text in (notes or [])],
        footnote_ref_ids=list(note_refs or []),
    )


def capability_rule(rule_id: str, style: str, formats: list[str], profiles: list[str], languages: list[str]) -> dict:
    return {
        "rule_id": rule_id,
        "enabled_by_default": True,
        "applies_to": {
            "formats": formats,
            "manuscript_types": profiles,
            "languages": languages,
            "citation_styles": [style],
        },
    }


def new_pack() -> dict:
    capability_ids = {
        "gbt7714-2025": ["CAP-GBT"],
        "apa-7": ["CAP-APA"],
        "chicago-18-nb": ["CAP-CHI-NB"],
        "chicago-18-ad": ["CAP-CHI-AD"],
    }
    return {
        "citation_default_mapping": {
            "version": "1.1.0",
            "standard_ref": "OAK-CITATION-DEFAULT-001",
            "map": [],
            "resolver": {
                "id": "oak-citation-structure-resolver",
                "version": "2.0.0",
                "signal_extractor_version": "1.0.0",
                "thresholds": {
                    "strong_min_unique": 3,
                    "moderate_min_unique": 2,
                    "strong_min_coverage_percent": 80,
                    "moderate_min_coverage_percent": 50,
                },
                "style_capability_rules": capability_ids,
            },
        },
        "rules": [
            capability_rule("CAP-GBT", "gbt7714-2025", ["docx"], ["paper"], ["zh"]),
            capability_rule("CAP-APA", "apa-7", ["docx", "md"], ["paper"], ["en"]),
            capability_rule(
                "CAP-CHI-NB", "chicago-18-nb", ["docx"], ["print_book"], ["*"]
            ),
            capability_rule(
                "CAP-CHI-AD", "chicago-18-ad", ["docx", "md"], ["print_book"], ["en"]
            ),
        ],
    }


def legacy_pack() -> dict:
    return {
        "citation_default_mapping": {
            "version": "1.0.0",
            "standard_ref": "OAK-CITATION-DEFAULT-001",
            "map": [
                {
                    "manuscript_type": "paper",
                    "languages": ["zh", "mixed"],
                    "citation_style": "gbt7714-2025",
                },
                {
                    "manuscript_type": "paper",
                    "languages": ["en"],
                    "citation_style": "apa-7",
                },
                {
                    "manuscript_type": "print_book",
                    "languages": ["zh", "en", "mixed"],
                    "citation_style": "chicago-18-nb",
                },
                {
                    "manuscript_type": "ebook",
                    "languages": ["zh", "en", "mixed"],
                    "citation_style": "none",
                },
            ],
        },
        "rules": [],
    }


class LanguageEvidenceTest(unittest.TestCase):
    def test_language_evidence_is_count_only_and_distinguishes_short_input(self):
        zh = analyze_language("这是中文内容。" * 50)
        en = analyze_language("This is English prose. " * 30)
        short = analyze_language("短文 short")
        self.assertEqual(zh["language"], "zh")
        self.assertEqual(en["language"], "en")
        self.assertEqual(short["language"], "mixed")
        self.assertEqual(short["basis"], "auto_insufficient")
        self.assertFalse(short["sufficient"])
        self.assertEqual(
            set(short),
            {"language", "basis", "sample_chars", "cjk_chars", "ascii_letters", "sufficient"},
        )


class SignalExtractionTest(unittest.TestCase):
    def test_numeric_unique_and_coverage_include_lists_and_ranges(self):
        doc = document(
            ["正文引用 [1]、[2, 3] 和 [4-5]。"],
            ["[1] A", "[2] B", "[3] C", "[4] D"],
        )
        evidence = extract_citation_signals(doc, doc_format="docx")
        self.assertEqual(evidence["numeric_citation_unique"], 5)
        self.assertEqual(evidence["numbered_entry_unique"], 4)
        self.assertEqual(evidence["numeric_matched_unique"], 4)
        self.assertEqual(evidence["numeric_coverage_percent"], 80)
        self.assertEqual(evidence["signal_availability"], "full")

    def test_author_year_and_note_matches_are_structural_counts(self):
        doc = document(
            ["See (Smith, 2020), (Jones, 2021), and (White, 2022)."],
            ["Smith. 2020. A.", "Jones. 2021. B."],
            notes=[(1, "First"), (2, "Second"), (3, "")],
            note_refs=[1, 2, 3],
        )
        evidence = extract_citation_signals(doc, doc_format="md")
        self.assertEqual(evidence["author_year_citation_unique"], 3)
        self.assertEqual(evidence["author_year_matched_unique"], 2)
        self.assertEqual(evidence["author_year_coverage_percent"], 66)
        self.assertEqual(evidence["note_reference_unique"], 3)
        self.assertEqual(evidence["note_matched_unique"], 2)
        self.assertEqual(evidence["note_coverage_percent"], 66)

    def test_author_year_accepts_chicago_spacing_and_chinese_names(self):
        doc = document(
            ["See (Smith 2020), (Jones 2021), （张伟，2022） and （李明 2023）。"],
            ["Smith. 2020.", "Jones. 2021.", "张伟，2022。", "李明 2023。"],
        )
        evidence = extract_citation_signals(doc, doc_format="docx")
        self.assertEqual(evidence["author_year_citation_unique"], 4)
        self.assertEqual(evidence["author_year_matched_unique"], 4)
        self.assertEqual(evidence["author_year_entry_matched_unique"], 4)

    def test_epub_is_always_partial_even_when_body_text_has_patterns(self):
        class Epub:
            body_text = "See (Smith, 2020) and [1]."

        evidence = extract_citation_signals(Epub(), doc_format="epub")
        self.assertEqual(evidence["signal_availability"], "partial")
        self.assertEqual(evidence["reference_heading_count"], 0)


class ResolutionTest(unittest.TestCase):
    def test_repository_v2_pack_matches_the_resolver_contract(self):
        pack = load_rulepack(REPO / "config" / "rule-packs" / "oak-rules-2.1.0.json")
        numeric = document(
            ["引用 [1]、[2]、[3]。"],
            ["[1] 甲", "[2] 乙", "[3] 丙"],
        )
        author_year = document(
            ["(Smith, 2020); (Jones, 2021); (White, 2022)."],
            ["Smith 2020", "Jones 2021", "White 2022"],
        )
        self.assertEqual(
            resolve_citation(numeric, settings(), pack, doc_format="docx")["resolved_style"],
            "gbt7714-2025",
        )
        self.assertEqual(
            resolve_citation(
                author_year,
                settings("print_book", "en"),
                pack,
                doc_format="docx",
            )["resolved_style"],
            "chicago-18-ad",
        )

    def test_strong_and_moderate_numeric_resolve_to_gbt(self):
        strong = document(
            ["引用 [1]、[2]、[3]。"],
            ["[1] 甲", "[2] 乙", "[3] 丙"],
        )
        moderate = document(["引用 [1]、[2]。"], ["[1] 甲", "[2] 乙"])
        high = resolve_citation(strong, settings(), new_pack(), doc_format="docx")
        medium = resolve_citation(moderate, settings(), new_pack(), doc_format="docx")
        self.assertEqual((high["resolved_style"], high["confidence"]), ("gbt7714-2025", "high"))
        self.assertEqual((medium["resolved_style"], medium["confidence"]), ("gbt7714-2025", "medium"))
        self.assertEqual(high["reason_code"], "numeric_reference_structure")

    def test_strong_author_year_selects_apa_or_chicago_author_date_by_profile(self):
        doc = document(
            ["(Smith, 2020); (Jones, 2021); (White, 2022)."],
            ["Smith 2020", "Jones 2021", "White 2022"],
        )
        apa = resolve_citation(doc, settings("paper", "en"), new_pack(), doc_format="docx")
        chicago = resolve_citation(
            doc, settings("print_book", "en"), new_pack(), doc_format="docx"
        )
        self.assertEqual(apa["resolved_style"], "apa-7")
        self.assertEqual(chicago["resolved_style"], "chicago-18-ad")
        self.assertEqual(apa["confidence"], "high")

    def test_strong_notes_select_chicago_notes_bibliography(self):
        doc = document(
            ["正文。"],
            ["Bibliography item one", "item two", "item three"],
            notes=[(1, "One"), (2, "Two"), (3, "Three")],
            note_refs=[1, 2, 3],
        )
        result = resolve_citation(
            doc, settings("print_book", "zh"), new_pack(), doc_format="docx"
        )
        self.assertEqual(result["resolved_style"], "chicago-18-nb")
        self.assertEqual(result["reason_code"], "notes_bibliography_structure")
        self.assertEqual(result["confidence"], "high")

    def test_conflict_low_coverage_and_profile_mismatch_fall_back(self):
        conflict = document(
            ["[1] [2] [3] (Smith, 2020) (Jones, 2021) (White, 2022)"],
            [
                "[1] Smith 2020",
                "[2] Jones 2021",
                "[3] White 2022",
            ],
        )
        conflict_result = resolve_citation(
            conflict, settings("paper", "zh"), new_pack(), doc_format="docx"
        )
        self.assertEqual(conflict_result["mode"], "structure_only")
        self.assertEqual(conflict_result["reason_code"], "conflicting_structures")

        low_coverage = document(
            ["[1] [2] [3]"],
            ["[1] only one match"],
        )
        low_result = resolve_citation(
            low_coverage, settings("paper", "zh"), new_pack(), doc_format="docx"
        )
        self.assertEqual(low_result["reason_code"], "insufficient_evidence")

        author_in_zh_paper = document(
            ["(Smith, 2020) (Jones, 2021) (White, 2022)"],
            ["Smith 2020", "Jones 2021", "White 2022"],
        )
        mismatch = resolve_citation(
            author_in_zh_paper, settings("paper", "zh"), new_pack(), doc_format="docx"
        )
        self.assertEqual(mismatch["reason_code"], "signal_profile_mismatch")

    def test_short_auto_language_and_partial_epub_fall_back_before_style_choice(self):
        short = document(
            ["[1] [2] [3]"],
            ["[1] A", "[2] B", "[3] C"],
        )
        short_result = resolve_citation(
            short, settings("paper", "auto"), new_pack(), doc_format="docx"
        )
        self.assertEqual(short_result["reason_code"], "language_evidence_insufficient")
        self.assertIsNone(short_result["resolved_style"])

        class Epub:
            body_text = "English " * 100 + "[1] [2] [3]"

        epub_result = resolve_citation(
            Epub(), settings("ebook", "en"), new_pack(), doc_format="epub"
        )
        self.assertEqual(epub_result["reason_code"], "extractor_coverage_insufficient")
        self.assertEqual(epub_result["mode"], "structure_only")

    def test_complete_ebook_with_zero_signals_can_disable(self):
        doc = document(["Ordinary ebook prose without references. " * 10])
        result = resolve_citation(
            doc, settings("ebook", "en"), new_pack(), doc_format="txt"
        )
        self.assertEqual(result["mode"], "disabled")
        self.assertEqual(result["resolved_style"], "none")
        self.assertEqual(result["reason_code"], "ebook_no_citation_signals")

        auto = resolve_citation(
            doc, settings("ebook", "auto"), new_pack(), doc_format="txt"
        )
        self.assertEqual(auto["reason_code"], "ebook_no_citation_signals")

    def test_explicit_style_and_none_take_priority(self):
        conflicting = document(
            ["[1] [2] [3] (Smith, 2020) (Jones, 2021) (White, 2022)"],
            ["[1] Smith 2020", "[2] Jones 2021", "[3] White 2022"],
        )
        explicit = resolve_citation(
            conflicting,
            settings("paper", "zh", "gbt7714-2025"),
            new_pack(),
            doc_format="docx",
        )
        disabled = resolve_citation(
            conflicting,
            settings("paper", "zh", "none"),
            new_pack(),
            doc_format="docx",
        )
        self.assertEqual((explicit["resolved_by"], explicit["confidence"]), ("user", None))
        self.assertEqual(disabled["mode"], "disabled")
        self.assertEqual(disabled["resolved_style"], "none")

    def test_new_pack_fails_closed_when_selected_capability_is_unavailable(self):
        doc = document(["正文。"])
        with self.assertRaisesRegex(OakError, "没有可用于"):
            resolve_citation(
                doc,
                settings("paper", "zh", "apa-7"),
                new_pack(),
                doc_format="docx",
            )
        broken = new_pack()
        broken["citation_default_mapping"]["resolver"]["style_capability_rules"][
            "gbt7714-2025"
        ] = ["MISSING-RULE"]
        numeric = document(["[1] [2] [3]"], ["[1] A", "[2] B", "[3] C"])
        with self.assertRaisesRegex(OakError, "不存在的能力规则"):
            resolve_citation(numeric, settings(), broken, doc_format="docx")

    def test_legacy_default_mapping_is_preserved(self):
        empty = document(["short"])
        paper = resolve_citation(
            empty, settings("paper", "zh"), legacy_pack(), doc_format="docx"
        )
        ebook = resolve_citation(
            empty, settings("ebook", "en"), legacy_pack(), doc_format="docx"
        )
        self.assertEqual(paper["resolved_style"], "gbt7714-2025")
        self.assertEqual(paper["resolved_by"], "legacy_mapping")
        self.assertIsNone(paper["confidence"])
        self.assertEqual((ebook["mode"], ebook["resolved_style"]), ("disabled", "none"))

    def test_schema_is_exact_deterministic_and_evidence_is_private(self):
        doc = document(
            ["Sensitive author Smith cites [1], [2], and [3]."],
            ["[1] Secret A", "[2] Secret B", "[3] Secret C"],
        )
        first = resolve_citation(doc, settings(), new_pack(), doc_format="docx")
        second = resolve_citation(doc, settings(), new_pack(), doc_format="docx")
        self.assertEqual(first, second)
        self.assertEqual(
            set(first),
            {
                "schema_version",
                "requested_style",
                "mode",
                "resolved_style",
                "resolved_by",
                "resolver",
                "reason_code",
                "reason",
                "confidence",
                "evidence",
                "coverage",
            },
        )
        evidence_json = json.dumps(first["evidence"], ensure_ascii=False, sort_keys=True)
        for forbidden in ("Sensitive", "Smith", "Secret", "[1]"):
            self.assertNotIn(forbidden, evidence_json)
        self.assertEqual(first["coverage"]["rule_ids"], [])
        self.assertEqual(
            json.dumps(first, ensure_ascii=False, sort_keys=True),
            json.dumps(second, ensure_ascii=False, sort_keys=True),
        )

    def test_resolver_schema_and_thresholds_are_exact(self):
        doc = document(["正文。"])
        unknown = new_pack()
        unknown["citation_default_mapping"]["resolver"]["unknown"] = True
        with self.assertRaisesRegex(OakError, "冻结 schema"):
            resolve_citation(doc, settings(), unknown, doc_format="docx")

        changed = new_pack()
        changed["citation_default_mapping"]["resolver"]["thresholds"][
            "strong_min_unique"
        ] = 4
        with self.assertRaisesRegex(OakError, "冻结值"):
            resolve_citation(doc, settings(), changed, doc_format="docx")

    def test_multiple_reference_headings_and_tampered_reason_fail_closed(self):
        paragraphs = [
            paragraph(1, "中文正文" * 100),
            paragraph(2, "参考文献", heading=1),
            paragraph(3, "[1] 甲"),
            paragraph(4, "Bibliography", heading=1),
            paragraph(5, "[2] 乙"),
        ]
        ambiguous = resolve_citation(
            Document(paragraphs=paragraphs),
            settings("paper", "zh"),
            new_pack(),
            doc_format="docx",
        )
        self.assertEqual(ambiguous["reason_code"], "ambiguous_reference_sections")
        ambiguous["reason_code"] = "numeric_reference_structure"
        ambiguous["reason"] = "检测到 0 个唯一编号引用，对应覆盖率 0%。默认采用 None。"
        with self.assertRaisesRegex(OakError, "状态不一致"):
            validate_citation_resolution(ambiguous)


if __name__ == "__main__":
    unittest.main()
