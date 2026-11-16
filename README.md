# Belgian open data: what changed

Every week the [Belgium Data Desk](https://data.vecture.be) downloads each published dataset's main CSV/TSV file in full (up to 100 MB) and compares it with the previous check. This branch keeps the result: which datasets changed, by how many rows, and whether their columns or time coverage moved. Only facts about the files are kept, never the data itself.

Rows are compared as a set of distinct rows (a fingerprint per row), so an export that only shuffles its rows does not count as changed. Modified rows show up as one removed and one added. A renamed or added column changes every row.

## Latest check: 2026-11-16

- Files checked: 3,375 (2,924 read in full, 0 compared with a previous check)
- Changed since the previous check: **0**
- Same rows, different order on each download: 0
- Last-Modified header: plausible 246, missing 2,673, request time 5
- Change headers that contradict the content: `last_modified_is_request_time` 5

No dataset changed since the previous check.

## Earlier checks

- [2026-11-16](changes/2026-11-16.json): 0 changed of 0 compared

Data: `changes/<date>.json`, one file per check. Fields are described in the Data Desk repository under `docs/reference/dataset-cards.md` ("Change log").
