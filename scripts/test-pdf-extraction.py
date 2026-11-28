import importlib.util
import tempfile
import unittest
from pathlib import Path

from reportlab.pdfgen import canvas

SPEC = importlib.util.spec_from_file_location("extract", Path(__file__).with_name("extract-pdf-tables.py"))
extract = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(extract)


class RecoveryTest(unittest.TestCase):
    def make_pdf(self, file, value):
        c = canvas.Canvas(str(file))
        xs, ys = (80, 200, 320), (650, 680, 710, 740)
        for x in xs:
            c.line(x, ys[0], x, ys[-1])
        for y in ys:
            c.line(xs[0], y, xs[-1], y)
        for i, row in enumerate([("Year", "Value"), ("1939", value), ("1940", "-2.50")]):
            for j, cell in enumerate(row):
                c.drawString(xs[j]+5, ys[-1]-20-30*i, cell)
        c.showPage()
        c.showPage()
        c.save()

    def test_extract_real_pdf_and_keep_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.make_pdf(root/"input.pdf", "12,50")
            result = extract.recover(root/"input.pdf", root/"out", "demo", "https://example.org/input.pdf")
            self.assertEqual(result["tables"][0]["rows"], [["Year","Value"],["1939","12,50"],["1940","-2.50"]])
            self.assertEqual(result["pages_without_text"], [2])
            self.assertFalse(result["publication_allowed"])
            self.assertEqual(len(result["source_sha256"]), 64)
            self.assertTrue((root/"out"/"page-0001-table-01.csv").is_file())
            with self.assertRaises(FileExistsError):
                extract.recover(root/"input.pdf", root/"out", "demo", "https://example.org/input.pdf")

    def test_formula_like_text_is_not_exported_as_csv(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.make_pdf(root/"input.pdf", "=1+1")
            result = extract.recover(root/"input.pdf", root/"out", "demo", "https://example.org/input.pdf")
            self.assertFalse(result["tables"][0]["csv_preview_safe"])
            self.assertFalse(list((root/"out").glob("*.csv")))
            self.assertEqual(result["tables"][0]["rows"][1][1], "=1+1")

    def test_non_pdf_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/"bad.pdf").write_text("not a PDF")
            with self.assertRaises(ValueError):
                extract.recover(root/"bad.pdf", root/"out", "demo", "https://example.org/input.pdf")
            self.assertFalse((root/"out").exists())


if __name__ == "__main__":
    unittest.main()
