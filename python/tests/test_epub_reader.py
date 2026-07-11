"""EPUB 读取器测试（M3）。"""

import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

from oak_manuscript_core.errors import OakError
from oak_manuscript_core.readers.epub_reader import read_epub
from tests.epub_factory import EpubBuilder


class EpubReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def _save(self, builder: EpubBuilder, name: str = "t.epub") -> Path:
        path = self.tmp / name
        builder.save(str(path))
        return path

    def _good(self) -> EpubBuilder:
        return (
            EpubBuilder()
            .chapter("chapter1.xhtml", "<h1 id=\"c1\">第一章</h1><p>构造正文。</p>")
            .chapter("chapter2.xhtml", "<h1 id=\"c2\">第二章</h1><p>更多正文。</p>")
        )

    def test_good_epub_parses_cleanly(self):
        book = read_epub(self._save(self._good()))
        self.assertTrue(book.mimetype_ok)
        self.assertEqual(book.opf_path, "OEBPS/content.opf")
        self.assertEqual(book.title, "示例电子书")
        self.assertEqual(book.language, "zh")
        self.assertEqual(book.identifier, "urn:oak:sample-epub-0001")
        self.assertTrue(book.has_nav)
        hrefs = [d.href for d in book.docs]
        self.assertIn("OEBPS/chapter1.xhtml", hrefs)
        self.assertIn("OEBPS/nav.xhtml", hrefs)
        ch1 = next(d for d in book.docs if d.href.endswith("chapter1.xhtml"))
        self.assertTrue(ch1.has_lang)
        self.assertIn("第一章", ch1.text)
        self.assertIn("c1", ch1.anchor_ids)

    def test_mimetype_not_first_detected(self):
        book = read_epub(self._save(EpubBuilder(mimetype_first=False).chapter("c.xhtml", "<p>x</p>")))
        self.assertFalse(book.mimetype_ok)

    def test_mimetype_compressed_detected(self):
        book = read_epub(self._save(EpubBuilder(mimetype_stored=False).chapter("c.xhtml", "<p>x</p>")))
        self.assertFalse(book.mimetype_ok)

    def test_mimetype_missing_detected(self):
        book = read_epub(self._save(EpubBuilder(mimetype_present=False).chapter("c.xhtml", "<p>x</p>")))
        self.assertFalse(book.mimetype_ok)

    def test_missing_metadata_reported_as_none(self):
        b = EpubBuilder(language=None, title=None).chapter("c.xhtml", "<p>x</p>")
        book = read_epub(self._save(b))
        self.assertIsNone(book.language)
        self.assertIsNone(book.title)
        self.assertEqual(book.identifier, "urn:oak:sample-epub-0001")

    def test_nav_absence_detected(self):
        book = read_epub(self._save(EpubBuilder(include_nav=False).chapter("c.xhtml", "<p>x</p>")))
        self.assertFalse(book.has_nav)

    def test_chapter_without_lang_detected(self):
        b = EpubBuilder().chapter("c.xhtml", "<p>x</p>", lang=None)
        book = read_epub(self._save(b))
        ch = next(d for d in book.docs if d.href.endswith("c.xhtml"))
        self.assertFalse(ch.has_lang)

    def test_images_and_alt_captured(self):
        body = '<p>图：</p><img src="pic1.png" alt="描述"/><img src="pic2.png"/>'
        book = read_epub(self._save(EpubBuilder().chapter("c.xhtml", body)))
        ch = next(d for d in book.docs if d.href.endswith("c.xhtml"))
        self.assertEqual([(i["src"], i["has_alt"]) for i in ch.images],
                         [("pic1.png", True), ("pic2.png", False)])

    def test_links_and_anchors_captured(self):
        b = (
            EpubBuilder()
            .chapter("a.xhtml", '<h1 id="top">A</h1><p><a href="b.xhtml#sec">去B</a>'
                                '<a href="#top">回顶</a><a href="https://example.org/x">外链</a></p>')
            .chapter("b.xhtml", '<h1 id="sec">B</h1>')
        )
        book = read_epub(self._save(b))
        a = next(d for d in book.docs if d.href.endswith("a.xhtml"))
        self.assertEqual(a.links, ["b.xhtml#sec", "#top", "https://example.org/x"])

    def test_missing_container_raises_friendly_error(self):
        path = self.tmp / "broken.epub"
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("mimetype", "application/epub+zip")
        with self.assertRaises(OakError) as ctx:
            read_epub(path)
        self.assertIn("container", str(ctx.exception))

    def test_non_zip_raises(self):
        path = self.tmp / "x.epub"
        path.write_bytes(b"not a zip")
        with self.assertRaises(OakError):
            read_epub(path)


if __name__ == "__main__":
    unittest.main()
