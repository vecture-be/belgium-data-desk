# Data sanity check, 18 November 2026

Checks on the data itself, not on the catalogue metadata: the figures this service publishes (Statbel tables), the values in the
2,948 profiled files (dataset cards), and live answers of the tools.

## Fixed in this round

| Where | Problem | Fix |
|---|---|---|
| Column profiles (`scripts/dataset-card.mjs`) | A number with one separator and three digits after it (`3.775`, `98,125`) was always read as a thousands group. Ghent longitudes became 3,775, Infrabel punctuality 98,125 %, and about 20 files with three-decimal coordinates lost their latitude/longitude join key. | The column decides: other decimals or ungrouped integers of 1000+ make it a decimal; grouped numbers, `1.000` or plain integers only make it a thousands group. |
| `air_quality` station values | IRCEL's SOS answers `-9999` for "no value"; the last value was passed on as a measurement. | Negative and absurd values are skipped and the next series is used. |
| `river_levels` | A brook that rose and fell with three showers was called a "tidal gauge" (Xhendremael, 145 m TAW, during the 17–18 Nov rain). | The shape-based tide guess only applies below 10 m TAW; named tidal gauges are unchanged. |

## Now flagged on every card (`quality.suspect_values`, also a fact on the card)

- `coordinates_outside_belgium`: a latitude/longitude column that leaves Belgium (wrong rows, swapped axes, or wider coverage).
- `not_degrees`: a latitude/longitude column holding metres or degrees without their decimal point.
- `missing_value_code`: `-999`, `-9999`, `99999`-style codes that would distort a sum or average.

## New gate: `scripts/data-sanity.mjs` (in `npm test`)

Checks the Statbel tables behind `belgian_statistics` and `real_estate_prices` before a hand rebuild can ship: men + women = total,
age bands = total, 80+ ≤ 65+, municipalities add up to provinces, regions and Belgium (population exactly, income within a euro
per municipality of Statbel's rounding), income residents = population of 1 January of the next year, 565 municipalities, the
ranking table recomputes from the rows, price quartiles ordered, municipal sales never above their province's. All pass today;
Belgium on 1 January 2025 is 11,825,551, as Statbel publishes.

Warnings (kept, they are in Statbel's source): 30 year-on-year jumps of the median price over 50 % with 30+ sales, mostly detached
houses at the coast (De Panne 2022 → 2023: €193,500 → €402,500).

## Publisher-side problems found (to report, not to fix here)

Coordinates:
- SPW enterprise lists (`entreprises-spw-*`, ODWB): Lambert 72 metres in columns named `latitude`/`longitude`.
- Brussels cemeteries (`cimetieres`): degrees × 10⁶ without a decimal point (50864386).
- Seneffe playgrounds (`aires-de-jeux-seneffe`): latitude and longitude swapped.
- `commission-mixte-locale`, `andenne-secteur-de-la-sante`: a few rows at 45–48° N (France or typing errors).
- ODWB `enseignement-primaire-et-secondaire`: `0` for unknown coordinates.
- Chaudfontaine `reouverture-des-commerces`, transport.data.gov.be `e422db9e…` and `caf44d1e…`: decimal point lost on part of the rows.
- Ghent `dataset-scholenzoeker-gent`: Web Mercator metres in `lat`/`long`.

Missing-value codes inside numbers: Brussels public car parks (`-999` floors, widths, heights), Namur road sections
(`MNT_ALT_MIN/MAX -9999`), Elia ods064/ods069/ods157 bid prices (`-999`).

Values worth a look: Liège canopy (`Nombre d'arbres plantés` −518), ODWB `commercesrues` (`Pourcentage de cellules vides` up to 200).

## Second round: read wrong values the way they were meant

Publishers will keep sending swapped axes and `-999`. Where the meant value is unambiguous the desk now reads it that way, says what
it changed, and leaves the file untouched (`public/data-repair-v1.mjs`, used by the cards, `get_dataset` and the SQL Lab):

| Written as | Read as | Example |
|---|---|---|
| latitude and longitude exchanged | swapped back | Seneffe playgrounds |
| Lambert 72 metres in degree columns | converted to WGS84 (within 10 m) | SPW enterprise lists: 99.8 % of 3,312 rows |
| Web Mercator metres | converted | Ghent school finder |
| degrees without their decimal point, or with spreadsheet digit groups (`50.880.263`) | point restored | Chaudfontaine shops, Brussels cemeteries |
| `-999`, `-9999`, `99999`… far from the rest of a column | no value | Brussels car parks, Namur road altitudes |
| a position that lands outside Belgium in every reading | kept as published, not mapped | a few health providers in Andenne |

"In Belgium" is tested against a simplified outline of the country (44 border towns inside, 26 foreign towns outside in the tests),
not a rectangle, so a reading that lands in Lille or Terneuzen does not count as a repair.

Where it shows: the card's "How the desk reads this file" box and `card.repairs`; `get_dataset` → `trust.read_differently_than_published`
and `analysis.duckdb_repaired` (a DuckDB query with the repairs applied); the SQL Lab adds a `<table>_repaired` view with
`lat_wgs84`, `lon_wgs84` and a per-row `coordinate_repair` column. The SQL gives the same reading as the card for every row
(checked on DuckDB 1.1, 1.4 and 2.0, 3,000+ rows).

Repairs are computed while profiling the whole file, so they appear for each file at its next full check (weekly, Saturday).
