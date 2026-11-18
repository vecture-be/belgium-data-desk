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
