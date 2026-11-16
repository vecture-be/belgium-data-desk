# Dataset cards

A dataset card says what a dataset is, whether it can be trusted today, and what it says, as facts computed by code from the catalogue record and a bounded read of the file. No language model writes any part of it. Each fact carries the numbers it rests on, so an assistant, the website or a social post can quote a card without inventing anything.

## How cards are made

1. **Weekly probe** (`scripts/probe-links.mjs`, `.github/workflows/link-health.yml`). The same request that checks a link reads the first 256 KiB of each CSV/TSV file and profiles its columns (`profileColumns` in `scripts/dataset-card.mjs`). The previous week's results are kept for comparison.
2. **Weekly full-file check** (`scripts/full-check.mjs`, `.github/workflows/full-check.yml`, Saturday). For each dataset, its best CSV/TSV file is downloaded whole, up to 100 MB, and every row is profiled with the same code, which also counts duplicate rows and hashes the file. Six jobs split the hosts between them, with at most two requests per host at a time. Every file is downloaded every week, with no conditional request. ETag and Last-Modified headers are often missing, regenerated on each request or left stale, so the check tests them instead of relying on them (see "Change dates" below). Larger files are recorded as `too_large` and keep the partial profile. A slow but steady download is given up only when no bytes arrive for a minute (`stalled`) or it passes 30 minutes (`timeout`). Some hosts refuse automated requests from cloud servers on every attempt (connections that never open, 401, 403, 429 or 503). After five refusals in a row with no success, the host's remaining files are not requested in that run. They are recorded as `host_refused` and listed in the change log, so the refusal can be raised with the publisher rather than retried against its wishes. A file that fails one week keeps its previous profile for up to eight weeks, marked `last_error`. When a whole-file profile exists, it replaces the probe's partial one.
3. **Build** (`scripts/build-cards.mjs`, part of `npm run build:index`). For every published record (the MCP index in `public/mcp/`), the profile of its best tabular file becomes a card (`buildCard`). Output: `public/cards/<shard>.json` (sharded like the MCP id index) and `public/cards/summary.json`.
4. **Use**. `get_dataset` returns the card; `catalogue_overview` returns the summary.

A host that blocks or throttles the probe yields no profile and therefore no card. A missing card is never a claim about the data.

## Fields

| Field | Meaning |
| --- | --- |
| `facts[]` | `{text, evidence}`: short sentences built only from the fields below, with the numbers behind them. Quote these. |
| `freshness.declared` | The update cycle the publisher declares (EU frequency code, in words). |
| `freshness.last_change` | The latest of the catalogue's update date, the file's `Last-Modified` and a content change seen by the full-file check, each only when it holds up (see "Change dates"). `last_change_basis` says which one it is. |
| `freshness.content_unchanged_since` / `observed_since` / `content_change_seen` | Whole-file checks: the first run that saw today's bytes, the first run that read the file at all, and the run that saw the bytes change. |
| `freshness.metadata_date_not_reflected_in_file` | The catalogue's update date is later than the first run that saw today's bytes, so the file did not change with it. |
| `freshness.file_header_ignored` | A `Last-Modified` date left out because the check caught it misleading. |
| `freshness.status` | `current`, `overdue` (past the cycle, with `overdue_days`) or `unknown` (no cycle declared, irregular, or no date). |
| `freshness.latest_data_point` | The latest date or year found in the data. |
| `coverage.time` | `{from, to, column}`: the period the data covers, from the best-filled date or year column. |
| `coverage.keys[]` | Columns that join with other Belgian data: `nis_code` (with `match_pct` against the 565 municipalities of 2025 plus districts, provinces and regions, and `pre_2025_codes_pct` for codes of municipalities merged on 1 January 2025), `enterprise_number` (KBO/BCE, check digits verified), `postcode`, `latitude`/`longitude`, `wgs84_point`, `lambert72`. |
| `quality.sparse_columns[]` | Columns filled in less than half of the rows read. |
| `quality.constant_columns[]` | Columns with one value in (nearly) every row read. |
| `schema.fingerprint` | Hash of the column names. `changed_since`, `added`, `removed` when it differs from the previous probe; `stable_since` when it does not. |
| `columns[]` | Per column: `type` (`integer`, `number`, `date`, `year`, `boolean`, `text`), `filled_pct`, `distinct`, `min`/`max`, `from`/`to`, and `top` values for repeating categories. |
| `quality.duplicate_rows` | Rows identical to an earlier row. Only for whole-file profiles (the fact says "at least" past two million distinct rows). |
| `file` | The file profiled: `read` (`whole file` or `first bytes`), bytes read, `rows` and `rows_exact` (false when only the first 256 KiB were read: counts and ranges then describe those rows), and `sha256` (first 32 hex characters) for whole files. `headers` holds the header check: `last_modified` (`missing`, `request_time`, `future`, `plausible`), `etag` (`present`, `missing`), `issues[]` and `last_modified_usable`. |

## Change dates

Publishers state when data changed in three places: the catalogue's update date, and the file's `Last-Modified` and `ETag` headers. All three are often wrong, which is a quality problem in itself. The full-file check compares them with what the bytes do from one week to the next:

| Issue | What was seen |
| --- | --- |
| `last_modified_is_request_time` | `Last-Modified` is within two minutes of the server's own clock: the file is generated on each request, so the date means nothing. |
| `last_modified_in_future` | `Last-Modified` lies more than an hour after the server's clock. |
| `last_modified_moved_content_same` | `Last-Modified` changed since the previous run, but the bytes are identical. |
| `content_changed_last_modified_same` | The bytes changed, but `Last-Modified` did not. |
| `etag_moved_content_same` | The ETag changed, but the bytes are identical, so caches download the file again for nothing. |
| `content_changed_etag_same` | The bytes changed, but the ETag did not (weak and compression variants count as the same), so caches may keep serving the old file. |

"Same content" means the same rows. Besides `sha256` of the bytes, every whole-file profile has `row_set`: a fingerprint of the header and the set of rows that does not depend on row order. Some portal exports return the same rows in a different order on each request. Their bytes change while their data does not, so this is not counted as a change. It is reported as `quality.row_order_unstable` instead, because caches and simple diffs see a new file every time. A mere reordering is not used to judge the headers either way.

How a card uses this:

- A `Last-Modified` date with any of the `last_modified` issues is ignored (`file_header_ignored`).
- A catalogue update date after which the file stayed byte-for-byte the same no longer counts as a change (`metadata_date_not_reflected_in_file`). The update may have touched only the description.
- A content change seen by the check counts as a change, dated to the run that saw it.
- "Unchanged since the first run that saw it" can show that a dataset is overdue (`at_least: true`), but never that it is current: the real change may be much older.

`catalogue_overview` reports these counts in `change_headers` and `catalogue_date_not_in_file`.

## Change log

Each full-file check also says *what* changed since the previous check, without keeping any of the data:

- **Row baselines.** Per file, the sorted 53-bit hashes of its distinct rows (`scripts/row-diff.mjs`), about 8 bytes per row, up to two million distinct rows. They are stored per shard as `rows-<shard>.json` / `.bin` assets of the `full-check-state` release, which does not expire like the Actions cache. A file the run did not reach keeps its baseline for up to eight weeks.
- **Change summary** (`last_change_seen` on the card, `change` in the check results): `since` (the previous check), `seen_at`, `rows.before` / `rows.after`, `distinct_rows_added` / `distinct_rows_removed` (when both checks have a baseline), `columns_added` / `columns_removed`, `coverage` (date or year columns whose range moved) and `ranges` (numeric columns whose min/max moved). Rows are compared as a set: a modified row counts as one removed and one added, a duplicate is counted once, and a renamed or added column changes every row. A change stays on the card until the next one is seen.
- **Public log.** Scheduled runs publish `changes/<date>.json` (every change seen in that run, with run totals for header and row-order findings) and a `README.md` overview to the `data-changes` branch of this repository (`scripts/change-log.mjs`). It holds only facts about the files, never their rows, so it can cover every licence.

Numbers are parsed the Belgian way where it is unambiguous (`1.234,5` is one thousand two hundred and thirty-four and a half); dates accept ISO, `YYYY-MM`, and `DD/MM/YYYY`, `DD-MM-YYYY` or `DD.MM.YYYY`.

## Writing about a dataset from its card

The card is meant to replace screenshot trivia with statements a reader can use:

- **What it can answer**: time coverage plus join keys ("municipal figures from 2019 to 2024 with NIS codes, so they join with Statbel population").
- **Whether it is maintained**: freshness against the declared cycle.
- **What to watch out for**: pre-2025 municipality codes, sparse key columns, columns that changed.

Only state what a fact or field says, keep its qualifiers ("in the rows read"), and link to the dataset.
