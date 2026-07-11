"""Markdown / TXT 读取器测试（M2）。"""

import shutil
import tempfile
import unittest
from pathlib import Path

from oak_manuscript_core.readers.md_reader import read_md
from oak_manuscript_core.readers.txt_reader import read_txt


class MdReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def _md(self, content: str) -> Path:
        path = self.tmp / "t.md"
        path.write_text(content, encoding="utf-8")
        return path

    def test_atx_headings_with_levels(self):
        doc = read_md(self._md("# 一级\n\n正文。\n\n## 二级\n\n### 三级\n"))
        levels = [(p.heading_level, p.text) for p in doc.paragraphs]
        self.assertEqual(
            levels,
            [(1, "一级"), (None, "正文。"), (2, "二级"), (3, "三级")],
        )
        self.assertEqual([p.index for p in doc.paragraphs], [1, 2, 3, 4])

    def test_blocks_merge_adjacent_lines(self):
        doc = read_md(self._md("第一行\n第二行\n\n新段落\n"))
        self.assertEqual([p.text for p in doc.paragraphs], ["第一行 第二行", "新段落"])

    def test_fenced_code_not_parsed_as_heading(self):
        content = "# 标题\n\n```\n# 这不是标题\n```\n\n正文。\n"
        doc = read_md(self._md(content))
        headings = [p for p in doc.paragraphs if p.heading_level]
        self.assertEqual(len(headings), 1)
        self.assertEqual(headings[0].text, "标题")

    def test_trailing_hashes_stripped(self):
        doc = read_md(self._md("## 二级 ##\n"))
        self.assertEqual(doc.paragraphs[0].text, "二级")
        self.assertEqual(doc.paragraphs[0].heading_level, 2)

    def test_empty_file_yields_empty_document(self):
        doc = read_md(self._md(""))
        self.assertEqual(doc.paragraphs, [])


class TxtReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_blank_line_separates_paragraphs(self):
        path = self.tmp / "t.txt"
        path.write_text("段一行一\n段一行二\n\n段二\n\n\n段三\n", encoding="utf-8")
        doc = read_txt(path)
        self.assertEqual([p.text for p in doc.paragraphs], ["段一行一 段一行二", "段二", "段三"])
        self.assertTrue(all(p.heading_level is None for p in doc.paragraphs))

    def test_handles_bom_and_crlf(self):
        path = self.tmp / "t.txt"
        path.write_bytes("﻿首段\r\n\r\n次段\r\n".encode("utf-8"))
        doc = read_txt(path)
        self.assertEqual([p.text for p in doc.paragraphs], ["首段", "次段"])


if __name__ == "__main__":
    unittest.main()
