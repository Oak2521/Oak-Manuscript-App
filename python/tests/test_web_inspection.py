"""Web 上传结构/主动内容门禁测试。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from oak_manuscript_core.errors import OakError
from oak_manuscript_core.web_inspection import inspect_web_document


class WebInspectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _zip(self, name: str, members: dict[str, bytes], *, stored: set[str] | None = None) -> Path:
        target = self.root / name
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
            for member, data in members.items():
                archive.writestr(
                    member,
                    data,
                    compress_type=zipfile.ZIP_STORED if member in (stored or set()) else zipfile.ZIP_DEFLATED,
                )
        return target

    def _docx(self, extra: dict[str, bytes] | None = None) -> Path:
        members = {
            "[Content_Types].xml": b"<Types/>",
            "_rels/.rels": b"<Relationships/>",
            "word/document.xml": b"<w:document xmlns:w='urn:w'><w:body/></w:document>",
            **(extra or {}),
        }
        return self._zip("sample.docx", members)

    def _epub(self, markup: bytes = b"<html xmlns='http://www.w3.org/1999/xhtml'><body/></html>") -> Path:
        return self._zip("sample.epub", {
            "mimetype": b"application/epub+zip",
            "META-INF/container.xml": b"<container/>",
            "OEBPS/chapter.xhtml": markup,
        }, stored={"mimetype"})

    def test_text_and_safe_packages_return_only_content_free_counts(self) -> None:
        text = self.root / "sample.txt"
        text.write_text("湖岸稿件\n", encoding="utf-8")
        values = [
            inspect_web_document(text, "txt"),
            inspect_web_document(self._docx(), "docx"),
            inspect_web_document(self._epub(), "epub"),
        ]
        for value in values:
            self.assertEqual(value["ok"], True)
            self.assertEqual(set(value), {
                "ok", "schema_version", "inspection_type", "format", "size_bytes",
                "package_members", "expanded_bytes",
            })
            self.assertNotIn(str(self.root), json.dumps(value))

    def test_invalid_utf8_nul_and_format_spoof_are_rejected(self) -> None:
        bad = self.root / "bad.txt"
        for data in (b"bad\x00text", b"\xff\xfe"):
            bad.write_bytes(data)
            with self.assertRaises(OakError):
                inspect_web_document(bad, "txt")
        bad.write_bytes(b"not a zip")
        with self.assertRaises(OakError):
            inspect_web_document(bad, "docx")

    def test_zip_traversal_link_duplicate_encryption_and_bomb_are_rejected(self) -> None:
        for index, member in enumerate(("../escape.txt", "word/./hidden.xml", "word//hidden.xml")):
            with self.subTest(member=member):
                traversal = self._docx({member: b"x"})
                traversal.replace(self.root / f"unsafe-{index}.docx")
                with self.assertRaises(OakError):
                    inspect_web_document(self.root / f"unsafe-{index}.docx", "docx")

        linked = self._docx()
        with zipfile.ZipFile(linked, "a") as archive:
            info = zipfile.ZipInfo("word/link")
            info.create_system = 3
            info.external_attr = 0o120777 << 16
            archive.writestr(info, "target")
        with self.assertRaises(OakError):
            inspect_web_document(linked, "docx")

        duplicate = self._docx({"WORD/DOCUMENT.XML": b"<duplicate/>"})
        with self.assertRaises(OakError):
            inspect_web_document(duplicate, "docx")

        encrypted = self._docx()
        raw = bytearray(encrypted.read_bytes())
        local = raw.find(b"PK\x03\x04")
        central = raw.find(b"PK\x01\x02")
        raw[local + 6:local + 8] = (1).to_bytes(2, "little")
        raw[central + 8:central + 10] = (1).to_bytes(2, "little")
        encrypted.write_bytes(raw)
        with self.assertRaises(OakError):
            inspect_web_document(encrypted, "docx")

        bomb = self._docx({"word/huge.txt": b"A" * (1024 * 1024)})
        with self.assertRaises(OakError):
            inspect_web_document(bomb, "docx")

    def test_docx_active_content_and_epub_script_are_rejected(self) -> None:
        for member in ("word/vbaProject.bin", "word/embeddings/object1.bin", "word/activeX/activeX1.bin"):
            with self.subTest(member=member):
                with self.assertRaises(OakError):
                    inspect_web_document(self._docx({member: b"active"}), "docx")
        dde = self._docx({
            "word/document.xml": (
                b"<w:document xmlns:w='urn:w'><w:body><w:instrText> DDEAUTO cmd </w:instrText>"
                b"</w:body></w:document>"
            ),
        })
        with self.assertRaises(OakError):
            inspect_web_document(dde, "docx")
        macro_type = self._docx({
            "[Content_Types].xml": b"<Types><Default ContentType='application/macroEnabled'/></Types>",
        })
        with self.assertRaises(OakError):
            inspect_web_document(macro_type, "docx")
        scripted = self._epub(b"<html xmlns='http://www.w3.org/1999/xhtml'><script>bad()</script></html>")
        with self.assertRaises(OakError):
            inspect_web_document(scripted, "epub")

    def test_cli_returns_exact_content_free_success(self) -> None:
        text = self.root / "sample.md"
        text.write_text("# 标题\n", encoding="utf-8")
        result = subprocess.run(
            [sys.executable, "-m", "oak_manuscript_core", "web-inspect",
             "--input", str(text), "--format", "md"],
            check=False, capture_output=True, text=True, encoding="utf-8",
            env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value["inspection_type"], "oak_manuscript_web_upload_inspection")
        self.assertNotIn(str(text), result.stdout)


if __name__ == "__main__":
    unittest.main()
