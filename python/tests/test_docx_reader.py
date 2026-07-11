"""DOCX 读取器测试：解析正确性 + ZIP 安全防护。"""

import io
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

from oak_manuscript_core.errors import OakError
from oak_manuscript_core.readers.docx_reader import read_docx
from oak_manuscript_core.safety import ZipLimits
from tests.docx_factory import DocxBuilder


class ReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def _save(self, builder: DocxBuilder, name: str = "t.docx") -> Path:
        path = self.tmp / name
        builder.save(str(path))
        return path

    def test_paragraph_texts_in_order_with_one_based_index(self):
        doc = read_docx(self._save(DocxBuilder().p("第一段").p("第二段").p("第三段")))
        self.assertEqual([p.text for p in doc.paragraphs], ["第一段", "第二段", "第三段"])
        self.assertEqual([p.index for p in doc.paragraphs], [1, 2, 3])
        self.assertTrue(all(p.part == "document" for p in doc.paragraphs))

    def test_heading_levels_from_styles(self):
        b = (
            DocxBuilder()
            .p("题名")
            .p("一级", style="Heading1")
            .p("二级", style="Heading2")
            .p("三级", style="Heading3")
            .p("正文")
        )
        doc = read_docx(self._save(b))
        levels = [p.heading_level for p in doc.paragraphs]
        self.assertEqual(levels, [None, 1, 2, 3, None])

    def test_tab_count_and_cross_run_text(self):
        b = DocxBuilder().p_runs([("t", "前半"), ("tab",), ("t", "后半")])
        doc = read_docx(self._save(b))
        para = doc.paragraphs[0]
        self.assertEqual(para.tab_count, 1)
        # 合并文本中制表符以 \t 呈现，保证列位置语义
        self.assertEqual(para.text, "前半\t后半")

    def test_empty_paragraph_flags(self):
        doc = read_docx(self._save(DocxBuilder().p("正文").p_empty().p_empty()))
        self.assertFalse(doc.paragraphs[0].is_empty)
        self.assertTrue(doc.paragraphs[1].is_empty)
        self.assertTrue(doc.paragraphs[2].is_empty)

    def test_footnotes_parsed_and_separators_excluded(self):
        b = (
            DocxBuilder()
            .p_runs([("t", "正文"), ("fnref", 1), ("t", "继续"), ("fnref", 2)])
            .footnote(1, "有内容的注")
            .footnote(2, "")
            .footnote(3, "孤立注")
        )
        doc = read_docx(self._save(b))
        self.assertEqual(sorted(n.note_id for n in doc.footnotes), [1, 2, 3])
        texts = {n.note_id: n.text for n in doc.footnotes}
        self.assertEqual(texts[1], "有内容的注")
        self.assertEqual(texts[2], "")
        self.assertEqual(doc.footnote_ref_ids, [1, 2])
        self.assertEqual(doc.paragraphs[0].footnote_refs, [1, 2])

    def test_rejects_non_zip_file(self):
        bad = self.tmp / "broken.docx"
        bad.write_bytes(b"this is not a zip archive")
        with self.assertRaises(OakError) as ctx:
            read_docx(bad)
        self.assertIn("无法", str(ctx.exception))

    def test_rejects_docx_without_document_xml(self):
        path = self.tmp / "empty.docx"
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("hello.txt", "x")
        with self.assertRaises(OakError):
            read_docx(path)


class ZipSafetyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_rejects_path_traversal_member(self):
        path = self.tmp / "evil.docx"
        base = DocxBuilder().p("正文").bytes()
        with zipfile.ZipFile(path, "w") as zf:
            with zipfile.ZipFile(io.BytesIO(base)) as src:
                for name in src.namelist():
                    zf.writestr(name, src.read(name))
            zf.writestr("../evil.txt", "escape")
        with self.assertRaises(OakError) as ctx:
            read_docx(path)
        self.assertIn("路径", str(ctx.exception))

    def test_rejects_too_many_members(self):
        path = self.tmp / "many.docx"
        DocxBuilder().p("正文").save(str(path))
        limits = ZipLimits(max_members=3)
        with self.assertRaises(OakError):
            read_docx(path, limits=limits)

    def test_rejects_oversized_total(self):
        path = self.tmp / "big.docx"
        DocxBuilder().p("正文" * 5000).save(str(path))
        limits = ZipLimits(max_total_bytes=100)
        with self.assertRaises(OakError):
            read_docx(path, limits=limits)

    def test_rejects_oversized_member(self):
        path = self.tmp / "bigmember.docx"
        DocxBuilder().p("正文" * 5000).save(str(path))
        limits = ZipLimits(max_member_bytes=100)
        with self.assertRaises(OakError):
            read_docx(path, limits=limits)


if __name__ == "__main__":
    unittest.main()
