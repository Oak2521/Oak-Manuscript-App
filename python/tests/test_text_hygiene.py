"""TXT/Markdown 专项检查与覆盖披露回归。"""

from __future__ import annotations

import hashlib
import shutil
import tempfile
import unittest
from pathlib import Path

from oak_manuscript_core.engine import check_document
from oak_manuscript_core.readers.md_reader import read_md
from oak_manuscript_core.readers.txt_reader import read_txt
from oak_manuscript_core.rulepack import load_rulepack


REPO = Path(__file__).resolve().parents[2]
PACK = load_rulepack(REPO / "config" / "rule-packs" / "oak-rules-2.1.0.json")
TEXT_RULES = {
    "TEXT-EMPTY-001",
    "TEXT-SPACE-001",
    "TEXT-TAB-001",
    "TEXT-BLANK-001",
}


def settings(manuscript_type: str = "paper") -> dict:
    return {
        "manuscript_type": manuscript_type,
        "language": "auto",
        "citation_style": "default",
        "check_depth": "full",
    }


class TextHygieneTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-text-hygiene-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def _write(self, name: str, content: str, *, newline: str | None = None) -> Path:
        target = self.tmp / name
        with target.open("w", encoding="utf-8-sig" if content.startswith("\ufeff") else "utf-8",
                         newline=newline) as handle:
            handle.write(content.removeprefix("\ufeff"))
        return target

    @staticmethod
    def _digest(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    @staticmethod
    def _text_issues(outcome) -> list[dict]:
        return [issue for issue in outcome.issues if issue["rule_id"] in TEXT_RULES]

    def test_txt_reports_only_warning_or_suggestion_and_never_autofix(self) -> None:
        path = self._write(
            "ordinary.txt",
            "第一段  有连续空格\n第二行\t含制表符\n\n\n\n下一段。\n",
        )
        before = self._digest(path)
        outcome = check_document(read_txt(path), settings(), PACK, doc_format="txt")
        issues = self._text_issues(outcome)

        self.assertEqual(
            [issue["rule_id"] for issue in issues],
            ["TEXT-SPACE-001", "TEXT-TAB-001", "TEXT-BLANK-001"],
        )
        self.assertEqual([issue["location"]["line"] for issue in issues], [1, 2, 3])
        self.assertTrue(all(issue["severity"] in {"warning", "suggestion"} for issue in issues))
        self.assertTrue(all(issue["auto_fixable"] is False for issue in issues))
        self.assertTrue(all(issue["fix_id"] is None for issue in issues))
        self.assertEqual(self._digest(path), before, "检查不得改写源文件")

    def test_markdown_protected_contexts_have_no_hygiene_findings(self) -> None:
        path = self._write(
            "protected.md",
            "# 标题\n\n"
            "`inline  code`\n\n"
            "| 第一列  | 第二列\t |\n"
            "| --- | --- |\n\n"
            "强制换行保留两个空格  \n下一行\n\n"
            "```text\n代码  空格\t\n\n\n\n仍在代码块\n```\n",
        )
        outcome = check_document(read_md(path), settings(), PACK, doc_format="md")
        self.assertEqual(self._text_issues(outcome), [])

    def test_layout_sensitive_short_lines_and_adjacent_blank_run_are_exempt(self) -> None:
        for name, reader, content, doc_format in (
            ("poem.txt", read_txt, "春风\n过湖\n入夜\n\n\n\n尾声\n", "txt"),
            ("layout.md", read_md, "  保留缩进  文本\n短行\n短行\n\n\n\n结尾\n", "md"),
        ):
            with self.subTest(name=name):
                path = self._write(name, content)
                outcome = check_document(reader(path), settings("print_book"), PACK,
                                         doc_format=doc_format)
                self.assertEqual(self._text_issues(outcome), [])

    def test_empty_and_whitespace_only_files_are_explicit(self) -> None:
        for name, reader, content, doc_format in (
            ("empty.md", read_md, "", "md"),
            ("blank.txt", read_txt, "\ufeff\r\n\r\n", "txt"),
        ):
            with self.subTest(name=name):
                path = self._write(name, content, newline="")
                outcome = check_document(reader(path), settings(), PACK, doc_format=doc_format)
                issues = self._text_issues(outcome)
                self.assertEqual([issue["rule_id"] for issue in issues], ["TEXT-EMPTY-001"])
                self.assertEqual(issues[0]["location"]["line"], 1)

    def test_coverage_is_exact_content_free_and_format_specific(self) -> None:
        md = self._write("coverage.md", "# 标题\n\n正文。\n")
        outcome = check_document(read_md(md), settings(), PACK, doc_format="md")
        coverage = outcome.format_coverage

        self.assertEqual(set(coverage), {
            "schema_version", "format", "status", "rule_ids", "auto_fixable_rule_ids",
            "excluded_contexts", "not_checked", "disclosure",
        })
        self.assertEqual(coverage["schema_version"], "1.0")
        self.assertEqual(coverage["format"], "md")
        self.assertEqual(coverage["status"], "limited")
        self.assertEqual(coverage["auto_fixable_rule_ids"], [])
        self.assertIn("fenced_code", coverage["excluded_contexts"])
        self.assertIn("inline_code", coverage["excluded_contexts"])
        self.assertIn("table", coverage["excluded_contexts"])
        self.assertIn("hard_break", coverage["excluded_contexts"])
        self.assertIn("semantic_rewriting", coverage["not_checked"])
        self.assertIn("不能代表全面审查", coverage["disclosure"])
        serialized = repr(coverage)
        self.assertNotIn("标题", serialized)
        self.assertNotIn("正文", serialized)
        self.assertNotIn(str(md), serialized)

    def test_bom_crlf_and_lf_are_processed_deterministically(self) -> None:
        bom_crlf = self._write("crlf.txt", "\ufeff第一行\r\n第二行\r\n", newline="")
        lf = self._write("lf.txt", "第一行\n第二行\n", newline="")
        first = check_document(read_txt(bom_crlf), settings(), PACK, doc_format="txt")
        second = check_document(read_txt(lf), settings(), PACK, doc_format="txt")
        self.assertEqual(self._text_issues(first), self._text_issues(second))
        self.assertEqual(first.format_coverage, second.format_coverage)


if __name__ == "__main__":
    unittest.main()
