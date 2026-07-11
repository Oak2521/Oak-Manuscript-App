"""M3 六条 EPUB 规则的单元测试（含反例）。"""

import shutil
import tempfile
import unittest
from pathlib import Path

from oak_manuscript_core.readers.epub_reader import read_epub
from oak_manuscript_core.rules import RULE_FUNCS
from tests.epub_factory import EpubBuilder


def book_from(builder: EpubBuilder):
    tmp = Path(tempfile.mkdtemp(prefix="oak-test-"))
    try:
        path = tmp / "t.epub"
        builder.save(str(path))
        return read_epub(path)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def run_rule(rule_id: str, book):
    return RULE_FUNCS[rule_id](book, {"language": "zh", "citation_style": "none"})


def good() -> EpubBuilder:
    return EpubBuilder().chapter("c1.xhtml", '<h1 id="t">章</h1><p>正文。</p>')


class MimetypeRuleTest(unittest.TestCase):
    def test_compressed_mimetype_flagged(self):
        findings = run_rule("EPUB-MIME-001", book_from(
            EpubBuilder(mimetype_stored=False).chapter("c.xhtml", "<p>x</p>")))
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["resource"], "mimetype")

    def test_good_mimetype_ok(self):
        self.assertEqual(run_rule("EPUB-MIME-001", book_from(good())), [])


class OpfMetadataRuleTest(unittest.TestCase):
    def test_missing_language_and_title_flagged_separately(self):
        book = book_from(EpubBuilder(language=None, title=None).chapter("c.xhtml", "<p>x</p>"))
        findings = run_rule("EPUB-OPF-001", book)
        self.assertEqual(len(findings), 2)
        previews = " ".join(f["preview"] for f in findings)
        self.assertIn("title", previews)
        self.assertIn("language", previews)

    def test_complete_metadata_ok(self):
        self.assertEqual(run_rule("EPUB-OPF-001", book_from(good())), [])


class NavRuleTest(unittest.TestCase):
    def test_missing_nav_flagged(self):
        findings = run_rule("EPUB-NAV-001", book_from(
            EpubBuilder(include_nav=False).chapter("c.xhtml", "<p>x</p>")))
        self.assertEqual(len(findings), 1)

    def test_nav_present_ok(self):
        self.assertEqual(run_rule("EPUB-NAV-001", book_from(good())), [])


class LangRuleTest(unittest.TestCase):
    def test_chapter_without_lang_flagged(self):
        b = EpubBuilder().chapter("a.xhtml", "<p>x</p>", lang=None).chapter("b.xhtml", "<p>y</p>")
        findings = run_rule("EPUB-LANG-001", book_from(b))
        self.assertEqual(len(findings), 1)
        self.assertTrue(findings[0]["resource"].endswith("a.xhtml"))

    def test_all_lang_present_ok(self):
        self.assertEqual(run_rule("EPUB-LANG-001", book_from(good())), [])


class ImgAltRuleTest(unittest.TestCase):
    def test_missing_alt_flagged_empty_alt_ok(self):
        body = '<img src="a.png" alt="有描述"/><img src="b.png" alt=""/><img src="c.png"/>'
        findings = run_rule("EPUB-IMG-001", book_from(EpubBuilder().chapter("c.xhtml", body)))
        self.assertEqual(len(findings), 1)
        self.assertIn("c.png", findings[0]["preview"])


class LinkRuleTest(unittest.TestCase):
    def test_broken_targets_flagged(self):
        b = (
            EpubBuilder()
            .chapter("a.xhtml",
                     '<h1 id="top">A</h1>'
                     '<p><a href="b.xhtml#sec">好链接</a>'
                     '<a href="missing.xhtml">断文件</a>'
                     '<a href="b.xhtml#nope">断锚点</a>'
                     '<a href="#top">本页锚点好</a>'
                     '<a href="#gone">本页锚点断</a>'
                     '<a href="https://example.org/">外链不查</a></p>')
            .chapter("b.xhtml", '<h1 id="sec">B</h1>')
        )
        findings = run_rule("EPUB-LINK-001", book_from(b))
        self.assertEqual(len(findings), 3)
        previews = " ".join(f["preview"] for f in findings)
        self.assertIn("missing.xhtml", previews)
        self.assertIn("nope", previews)
        self.assertIn("gone", previews)

    def test_clean_links_ok(self):
        b = (
            EpubBuilder()
            .chapter("a.xhtml", '<p><a href="b.xhtml">去B</a></p>')
            .chapter("b.xhtml", "<p>B</p>")
        )
        self.assertEqual(run_rule("EPUB-LINK-001", book_from(b)), [])


if __name__ == "__main__":
    unittest.main()
