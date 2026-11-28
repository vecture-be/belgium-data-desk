# PDF recovery pilot

This is a staging pipeline, not a second official data source. It makes no
changes to the production catalogue, relay, SQL Lab or MCP responses.

## 1. Inventory

    node scripts/snapshot.mjs
    node scripts/audit-pdf-distributions.mjs

The audit writes .cache/pdf-audit.json. It scans the existing merged catalogue
and groups PDF URLs (ignoring fragments), preserving dataset references.
Priorities and alternative-format flags are metadata hints, not proof that the
PDF has unique data. The national snapshot may truncate distribution lists.

Check the publisher's original record, all distributions, document contents,
rights and personal-data risks before choosing a document. Unknown, conflicting
and dataset-level-only licence evidence needs review. Even an explicit open
licence hint is not approval.

## 2. Stage a selected PDF

Download the reviewed document from the official publisher outside this script.
Use a sandboxed, resource-limited environment for untrusted PDFs. The extraction
script takes a local file only; it performs no network requests.

    python -m pip install pdfplumber==0.11.9
    python scripts/extract-pdf-tables.py source.pdf --out .cache/pilot/one \
      --dataset-id example --source-url https://example.org/source.pdf \
      --declared-license "CC BY 4.0"

The output is a manifest with raw table cells, original source URL, source
SHA-256, extractor version, 1-based page and table number and table bounds.
CSV previews are emitted only for rectangular tables without formula-like
cells; raw JSON preserves nulls and text. Pages with no text are listed for
future OCR. It does not guess headers, numeric formats or table joins.

## 3. Review before publishing

Check against the original rendered pages, including all table cells, totals,
units, footnotes, header hierarchy, suppression symbols and missing data.
Reject incomplete or ambiguous tables rather than repairing them silently.
Confirm source rights, attribution, privacy and that no equivalent structured
distribution already exists. Every candidate remains needs_review and
publication_allowed=false. Do not copy unreviewed output into public/.

A future derived-distribution registry must identify Vecture as the extractor,
not the official publisher; retain source dataset ID, exact document hash,
page/table references, review evidence, extraction version and appropriate
licence. Keep reviewed historical versions immutable. Add only reviewed
derived distributions to the existing index/preview/SQL/MCP path.

## Tests and CI

    node --test scripts/test-pdf-audit.mjs
    python -m pip install pdfplumber==0.11.9 reportlab==4.4.9
    python scripts/test-pdf-extraction.py

The PR workflow also attempts a live catalogue snapshot and retains the audit
for seven days. It does not extract publisher PDFs automatically, publish
datasets, run scheduled jobs, or deploy the service.
