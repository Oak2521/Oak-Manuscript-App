"""EPUB 白名单修复测试（M3）：mimetype 重建、lang 补齐、幂等与反例。"""

import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

from oak_manuscript_core.fixes import WHITELIST, apply_fixes
from oak_manuscript_core.readers.epub_reader import read_epub
from tests.epub_factory import EpubBuilder

EPUB_FIX_IDS = {"FIX-EPUB-MIME-001", "FIX-EPUB-LANG-001"}


class EpubFixTestBase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def _make(self, builder: EpubBuilder) -> Path:
        path = self.tmp / "work.epub"
        builder.save(str(path))
        return path


class WhitelistExpansionTest(EpubFixTestBase):
    def test_whitelist_now_has_six_entries(self):
        self.assertEqual(
            WHITELIST,
            {"FIX-SPACE-001", "FIX-TAB-001", "FIX-EMPTYPARA-001", "FIX-PUNCT-001",
             "FIX-EPUB-MIME-001", "FIX-EPUB-LANG-001"},
        )


class MimetypeFixTest(EpubFixTestBase):
    def test_repositions_and_stores_mimetype(self):
        path = self._make(EpubBuilder(mimetype_first=False, mimetype_stored=False)
                          .chapter("c.xhtml", "<p>x</p>"))
        counts = apply_fixes(path, {"FIX-EPUB-MIME-001"})
        self.assertEqual(counts["FIX-EPUB-MIME-001"], 1)
        book = read_epub(path)
        self.assertTrue(book.mimetype_ok, book.mimetype_problem)
        with zipfile.ZipFile(path) as zf:
            info = zf.infolist()[0]
            self.assertEqual(info.filename, "mimetype")
            self.assertEqual(info.compress_type, zipfile.ZIP_STORED)

    def test_creates_missing_mimetype(self):
        path = self._make(EpubBuilder(mimetype_present=False).chapter("c.xhtml", "<p>x</p>"))
        counts = apply_fixes(path, {"FIX-EPUB-MIME-001"})
        self.assertEqual(counts["FIX-EPUB-MIME-001"], 1)
        self.assertTrue(read_epub(path).mimetype_ok)

    def test_other_members_preserved(self):
        path = self._make(EpubBuilder(mimetype_stored=False).chapter("c.xhtml", "<p>唯一正文</p>"))
        with zipfile.ZipFile(path) as zf:
            before = {n: zf.read(n) for n in zf.namelist() if n != "mimetype"}
        apply_fixes(path, {"FIX-EPUB-MIME-001"})
        with zipfile.ZipFile(path) as zf:
            after = {n: zf.read(n) for n in zf.namelist() if n != "mimetype"}
        self.assertEqual(before, after)

    def test_idempotent(self):
        path = self._make(EpubBuilder(mimetype_first=False).chapter("c.xhtml", "<p>x</p>"))
        apply_fixes(path, {"FIX-EPUB-MIME-001"})
        first = path.read_bytes()
        counts = apply_fixes(path, {"FIX-EPUB-MIME-001"})
        self.assertEqual(counts["FIX-EPUB-MIME-001"], 0)
        self.assertEqual(path.read_bytes(), first)


class LangFixTest(EpubFixTestBase):
    def test_fills_lang_from_opf_language(self):
        path = self._make(EpubBuilder().chapter("a.xhtml", "<p>无语言</p>", lang=None)
                          .chapter("b.xhtml", "<p>有语言</p>"))
        counts = apply_fixes(path, {"FIX-EPUB-LANG-001"})
        self.assertEqual(counts["FIX-EPUB-LANG-001"], 1)
        book = read_epub(path)
        self.assertTrue(all(d.has_lang for d in book.docs))

    def test_counterexample_no_dc_language_no_fix(self):
        path = self._make(EpubBuilder(language=None).chapter("a.xhtml", "<p>x</p>", lang=None))
        before = path.read_bytes()
        counts = apply_fixes(path, {"FIX-EPUB-LANG-001"})
        self.assertEqual(counts["FIX-EPUB-LANG-001"], 0, "语言未知时不得擅自补写")
        self.assertEqual(path.read_bytes(), before)

    def test_does_not_touch_docs_with_lang(self):
        path = self._make(EpubBuilder().chapter("a.xhtml", "<p>有</p>"))
        before = path.read_bytes()
        counts = apply_fixes(path, {"FIX-EPUB-LANG-001"})
        self.assertEqual(counts["FIX-EPUB-LANG-001"], 0)
        self.assertEqual(path.read_bytes(), before)

    def test_idempotent(self):
        path = self._make(EpubBuilder().chapter("a.xhtml", "<p>x</p>", lang=None))
        apply_fixes(path, {"FIX-EPUB-LANG-001"})
        first = path.read_bytes()
        counts = apply_fixes(path, {"FIX-EPUB-LANG-001"})
        self.assertEqual(counts["FIX-EPUB-LANG-001"], 0)
        self.assertEqual(path.read_bytes(), first)


class DispatchTest(EpubFixTestBase):
    def test_docx_fix_ids_are_noop_on_epub(self):
        path = self._make(EpubBuilder().chapter("a.xhtml", "<p>x  双空格不修</p>"))
        before = path.read_bytes()
        counts = apply_fixes(path, {"FIX-SPACE-001"})
        self.assertEqual(sum(counts.values()), 0)
        self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
