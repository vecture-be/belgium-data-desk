# Catalogue quality audit — 2 October 2026

Method: full national DCAT dump (`Fedict/dcat` → `datagovbe.nt.gz`) parsed with the production code, 13,678 tabular-format
distribution URLs probed with a 32 KiB Range GET (`scripts/probe-links.mjs`), the shipped merge/publisher logic replayed in
Node against the real catalogue, and the ODS / CSW portals queried directly. Everything below is reproducible.

## 1. What the national catalogue is

| | |
|---|---|
| Datasets / publishers / distributions | 18,875 / 327 / 55,688 |
| Concentration | DOV 5,730 (30%) + Statbel 4,294 (23%) = **53%** of all records; 203 publishers have ≤3 datasets |
| Description ≥ 80 chars | 94% |
| Licence stated | 90% |
| Publisher contact email | 99.9% |
| Modification date | 71% (29% have none) |
| Update frequency stated | 32% — and 22 points of that are `IRREG` |
| Last modified > 3 years ago | 37% (only 15% within a year) |
| No distribution at all | 9.4% |

What a record actually *is* (rule-based, `scripts/curate.mjs → kindOf`):

| Kind | Records | Share |
|---|---|---|
| Dataset (a data file or API) | 8,226 | 44% |
| Map / web service only (WMS, WFS, KML…) | 4,579 | 24% |
| Publication (PDF only — mostly Statbel historic periodicals) | 3,744 | 20% |
| Metadata only | 1,767 | 9% |
| Research supplement (university repositories) | 559 | 3% |

Roughly 6,200 records are members of numbered series — 4,269 are DOV model layers (G3D / H3D / H3O) and ~1,900 are Statbel
periodicals — which `detectSeries` collapses into 293 collections.

## 2. Are the links and formats true? (13,678 probed URLs)

* **97.9%** answered with 2xx; 1.0% are 404, 0.7% 403, ~0.3% time out or fail TLS.
* Declared **CSV: 89.9%** really delimited text; 7.4% are Excel files, 1.9% are HTML pages (login / landing pages), a handful PDF/XML.
* Declared XLSX: 98% real; JSON: 98.6%; Parquet 100%; GeoJSON 98%.
* Only **56%** send `Access-Control-Allow-Origin` → just over half of files can be read by a browser directly; the catalogue relay is
  essential, not an edge case. Only 29% honour `Range`; only 30% announce a size; 6% of known sizes exceed the 8 MiB relay ceiling.
* `dcat:byteSize` is present on only ~21% of distributions. The pre-audit code turned a missing size into `0`, so the data
  claimed "known size" for 100% of distributions.

The 102 curated-atlas URLs: 91 answer; the 11 that do not are API endpoints that need parameters or keys (400/401), a templated
URL and one rate limit — not dead links. Liveness for services must use `GetCapabilities`, not a bare GET.

## 3. Defects found in the shipped app (all fixed in this change)

1. **46% of national datasets were silently merged away.** `identityKeys` treated any shared URL path (a DOV WMS endpoint used by
   829 layers, a catalogue landing page used by 851 KU Leuven records) as dataset identity. The UI said "10,452 unique datasets";
   the data has 18,875 + harvested. Fix: a key attached by one source to several differently-titled records is ignored; true
   cross-source duplicates still merge. Regression tests added.
2. **64% of national datasets showed the wrong publisher** (12,089 records). A fuzzy host-suffix match rebranded 5,730 DOV
   datasets, Ghent's open-data portal and 737 Departement Omgeving datasets as "Digitaal Vlaanderen" because they share
   `vlaanderen.be`. Fix: the publisher the catalogue declares wins; only an *exact* curated host is a fallback for unusable names.
3. **Licence `v1.0`** was shown for 7,603 datasets (the Flemish free-reuse model licence URI's last path segment). Licences are now
   normalised to a label and an openness family (open / share-alike / non-commercial / no-derivatives / custom / unknown).
4. **Place shown as a GeoNames number** (`3337388`) for 94% of records. Resolved to Flanders / Wallonia / Brussels / Belgium / sea / city.
5. **Harvest CSW sources reported `ok` with 0 records** (Metawal, geo.be): the XML regexes had doubled backslashes (`\\w`) so
   nothing ever matched. Fixed; additionally a source returning 0 rows is now a failure with fallback, and one unreadable
   GeoNetwork record no longer aborts a whole page.
6. `byteSize 0` presented as a known size (see §2).

## 4. Completeness

data.gov.be does not carry everything its publishers expose:

| Portal | Portal total | In data.gov.be | Harvested directly now |
|---|---|---|---|
| Open Data Wallonie-Bruxelles | 1,268 | ~1,031 | 868 (400 skipped: already harvested from Infrabel, Elia and the city portals) |
| City of Namur | 295 | 192 | 295 |
| Fluvius | 28 | 55 (URL forms) | 28 |
| Brussels open data | 208 | partial | 208 |
| City of Liège | 100 | 97 | 100 |
| City of Ghent | 311 | 311 | 311 (adds publisher schema + record counts) |
| Metawal (GeoNetwork) | 1,947 | partial | 1,944 (2 records the server cannot serialise are skipped) |
| geo.be (GeoNetwork) | 402 | partial | 402 |

After all merges the browser sees 21,667 distinct records (it showed 10,452 before this change); 1,820 of them are known to both catalogues.

The directly harvested ODS records carry a publisher-declared schema, record counts and live preview, which DCAT does not.
Federal registers (KBO, NBB, Federal Police, RIZIV) remain in the curated atlas because data.gov.be barely lists them.

## 5. Classification review

* `topic` (new) is assigned in a fixed order: the publisher-declared EU data-theme → title keywords (never the publisher name) →
  publisher default → weak EU codes. The first prototype matched publisher names inside keyword rules ("Teleworking days" →
  transport because the publisher was Infrabel); the shipped rule order and tests prevent that.
* The old "themes" mix publisher keywords and EU codes; DOV alone contributes 12 near-identical keyword themes. Keep them for
  search, do not use them for navigation.
* EU codes `REGI`, `TECH`, `GOVE` are attached to most records and are therefore weak signals.

## 6. Remaining risks (next increments)

* The browser downloads ~40 MiB of catalogue JSON (≈3.5 MiB on the wire) and merges 21k records on the main thread at start-up.
  A compact search index with lazily loaded detail chunks is the next structural change.
* Link-probe results are not yet part of the catalogue: ship a weekly self-hosted-runner job and show "link checked on …".
* Series detection is rule-based; review the 293 collections after each harvest (the harvest log prints their sizes).
