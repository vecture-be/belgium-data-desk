# Dataset cards

A dataset card says what a dataset is, whether it can be trusted today, and what it says, as facts computed by code from the catalogue record and a bounded read of the file. No language model writes any part of it. Each fact carries the numbers it rests on, so an assistant, the website or a social post can quote a card without inventing anything.

## How cards are made

1. **Weekly probe** (`scripts/probe-links.mjs`, `.github/workflows/link-health.yml`). The same request that checks a link reads the first 256 KiB of each CSV/TSV file and profiles its columns (`profileColumns` in `scripts/dataset-card.mjs`). The previous week's results are kept for comparison.
2. **Weekly full-file check** (`scripts/full-check.mjs`, `.github/workflows/full-check.yml`, Saturday). For each dataset, its best CSV/TSV file is downloaded whole, up to 100 MB, and every row is profiled with the same code, which also counts duplicate rows and hashes the file. Six jobs split the hosts between them, with at most two requests per host at a time. A file that is unchanged (the server answers `304` to its ETag or Last-Modified) keeps last week's profile without being downloaded. Larger files are recorded as `too_large` and keep the partial profile. A file that fails one week keeps its previous profile for up to eight weeks, marked `last_error`. When a whole-file profile exists, it replaces the probe's partial one.
3. **Build** (`scripts/build-cards.mjs`, part of `npm run build:index`). For every published record (the MCP index in `public/mcp/`), the profile of its best tabular file becomes a card (`buildCard`). Output: `public/cards/<shard>.json` (sharded like the MCP id index) and `public/cards/summary.json`.
4. **Use**. `get_dataset` returns the card; `catalogue_overview` returns the summary.

A host that blocks or throttles the probe yields no profile and therefore no card. A missing card is never a claim about the data.

## Fields

| Field | Meaning |
| --- | --- |
| `facts[]` | `{text, evidence}`: short sentences built only from the fields below, with the numbers behind them. Quote these. |
| `freshness.declared` | The update cycle the publisher declares (EU frequency code, in words). |
| `freshness.last_change` | The later of the catalogue's update date and the file's `Last-Modified`. |
| `freshness.status` | `current`, `overdue` (past the cycle, with `overdue_days`) or `unknown` (no cycle declared, irregular, or no date). |
| `freshness.latest_data_point` | The latest date or year found in the data. |
| `coverage.time` | `{from, to, column}`: the period the data covers, from the best-filled date or year column. |
| `coverage.keys[]` | Columns that join with other Belgian data: `nis_code` (with `match_pct` against the 565 municipalities of 2025 plus districts, provinces and regions, and `pre_2025_codes_pct` for codes of municipalities merged on 1 January 2025), `enterprise_number` (KBO/BCE, check digits verified), `postcode`, `latitude`/`longitude`, `wgs84_point`, `lambert72`. |
| `quality.sparse_columns[]` | Columns filled in less than half of the rows read. |
| `quality.constant_columns[]` | Columns with one value in (nearly) every row read. |
| `schema.fingerprint` | Hash of the column names. `changed_since`, `added`, `removed` when it differs from the previous probe; `stable_since` when it does not. |
| `columns[]` | Per column: `type` (`integer`, `number`, `date`, `year`, `boolean`, `text`), `filled_pct`, `distinct`, `min`/`max`, `from`/`to`, and `top` values for repeating categories. |
| `quality.duplicate_rows` | Rows identical to an earlier row. Only for whole-file profiles (the fact says "at least" past two million distinct rows). |
| `file` | The file profiled: `read` (`whole file` or `first bytes`), bytes read, `rows` and `rows_exact` (false when only the first 256 KiB were read: counts and ranges then describe those rows), and `sha256` (first 32 hex characters) for whole files. |

Numbers are parsed the Belgian way where it is unambiguous (`1.234,5` is one thousand two hundred and thirty-four and a half); dates accept ISO, `YYYY-MM`, and `DD/MM/YYYY`, `DD-MM-YYYY` or `DD.MM.YYYY`.

## Writing about a dataset from its card

The card is meant to replace screenshot trivia with statements a reader can use:

- **What it can answer**: time coverage plus join keys ("municipal figures from 2019 to 2024 with NIS codes, so they join with Statbel population").
- **Whether it is maintained**: freshness against the declared cycle.
- **What to watch out for**: pre-2025 municipality codes, sparse key columns, columns that changed.

Only state what a fact or field says, keep its qualifiers ("in the rows read"), and link to the dataset.
