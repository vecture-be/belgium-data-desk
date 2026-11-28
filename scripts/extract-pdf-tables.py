"""Stage tables from an explicitly selected local PDF; never publishes data."""
import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

import pdfplumber

MAX_BYTES = 30 * 1024 * 1024
MAX_PAGES = 200
NUMBER = re.compile(r"[+-]?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?\Z")


def csv_safe(value):
    if value is None:
        return True
    s = value.lstrip()
    return not s or s[0] not in "=+-@" or bool(NUMBER.fullmatch(s))


def recover(pdf, output, dataset_id, source_url, declared_license=""):
    """Keep raw cells, page/table positions and source hash; no inferred values."""
    source = urlsplit(source_url)
    if source.scheme not in ("https", "http") or not source.hostname or source.username or source.password:
        raise ValueError("Provide the original public HTTP(S) source URL")
    if pdf.stat().st_size > MAX_BYTES:
        raise ValueError("PDF exceeds pilot size cap")
    data = pdf.read_bytes()
    if not data.startswith(b"%PDF-"):
        raise ValueError("Input is not a PDF")
    digest = hashlib.sha256(data).hexdigest()
    tables, no_text, no_tables = [], [], []
    import io
    with pdfplumber.open(io.BytesIO(data)) as doc:
        if len(doc.pages) > MAX_PAGES:
            raise ValueError("PDF exceeds pilot page cap")
        page_count = len(doc.pages)
        for page in doc.pages:
            try:
                if not page.chars:
                    no_text.append(page.page_number)
                    continue
                found = page.find_tables()
                if not found:
                    no_tables.append(page.page_number)
                for index, table in enumerate(found, 1):
                    rows = table.extract()
                    widths = {len(row) for row in rows}
                    if len(rows) < 2 or not widths or max(widths) < 2:
                        continue
                    rectangular = len(widths) == 1
                    # Blank and missing cells are distinct in JSON; CSV is only a preview.
                    safe = rectangular and all(csv_safe(cell) for row in rows for cell in row)
                    tables.append({
                        "page": page.page_number, "table": index, "bbox_pt": list(table.bbox),
                        "rows": rows, "rectangular": rectangular,
                        "csv_preview_safe": safe,
                        "null_cells": sum(cell is None for row in rows for cell in row),
                        "status": "needs_review"
                    })
            finally:
                page.close()
    output.mkdir(parents=True, exist_ok=False)
    for table in tables:
        name = f"page-{table['page']:04d}-table-{table['table']:02d}"
        if table["csv_preview_safe"]:
            with (output / (name + ".csv")).open("w", encoding="utf-8", newline="") as file:
                csv.writer(file).writerows(table["rows"])
            table["csv_preview"] = name + ".csv"
    manifest = {
        "schema_version": 1, "dataset_id": dataset_id, "source_url": source_url,
        "source_sha256": digest, "source_bytes": len(data), "page_count": page_count,
        "declared_license": declared_license, "extractor": "pdfplumber",
        "extractor_version": pdfplumber.__version__, "method": "default line-based table detection",
        "status": "needs_review", "publication_allowed": False,
        "pages_without_text": no_text, "pages_without_detected_tables": no_tables,
        "tables": tables,
        "limitations": [
            "No OCR, inferred headers, merged-page tables or type coercion.",
            "A rectangular table can still contain wrong values.",
            "CSV previews lose null versus empty distinctions; JSON is authoritative.",
            "Source rights, personal data, table completeness and cell accuracy require review."
        ]
    }
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--declared-license", default="")
    args = parser.parse_args()
    manifest = recover(args.pdf, args.out, args.dataset_id, args.source_url, args.declared_license)
    print(json.dumps({"tables": len(manifest["tables"]), "status": manifest["status"],
                      "pages_without_text": manifest["pages_without_text"]}))


if __name__ == "__main__":
    main()
