# Belgium Data Desk

A static, zero-account research workbench for discovering authoritative Belgian public-data sources.

## What it does

- fast search across source, topic, region, format and use-case
- filter by access mode: downloads, API/web service, lookup or geospatial service
- source cards with practical "use it for" guidance
- local pinning via `localStorage`
- a stack builder that exports the selected sources as JSON
- shareable filtered views via the URL
- keyboard shortcut: `/` focuses search
- browser-side CSV profiling and validation without uploading user files
- dataset-level publisher feedback with reproducible data-quality evidence
- publisher contacts are resolved from catalogue metadata such as DCAT-AP contact points, CKAN and OpenDataSoft metadata when available
- feedback is prepared locally: the user explicitly opens an email draft, copies the report, or opens the publisher contact page
- no Belgium Data Desk mail relay, feedback inbox or hidden submission endpoint
- no tracking or user account

Production: https://data.vecture.be/


## Publisher feedback

Each dataset inspector includes **Report data issue**. Reports can classify duplicate/non-unique keys, missing values, schema changes, stale data, access problems, metadata errors, suspicious values, coverage gaps, unclear licensing, or another issue.

When the browser profiler has been run, the report can include measured evidence such as scanned row count, missing/duplicate counts, tested business-key fields, null key rows, duplicate rows and duplicate groups. Bounded profiles are explicitly labelled as bounded so they are not presented as whole-file proof.

Contact resolution prefers machine-readable dataset metadata. The national DCAT harvest reads `dcat:contactPoint` with vCard name/email/URL fields; CKAN and OpenDataSoft contact metadata are retained when exposed. Contact metadata is preserved across catalogue deduplication even when a richer publisher record wins over the national catalogue record.

The browser never sends a report automatically. If an email address is published, **Open email draft** uses a `mailto:` link. Otherwise the user can copy the generated report and open the publisher's official/contact page. This keeps Belgium Data Desk out of the mail path and avoids creating an open relay or storing reporter identity.

Global public issue counters are intentionally not part of this first version: they would require a write backend plus abuse controls and a moderation/privacy policy. They can be added separately without changing the direct publisher-reporting flow.


## Catalogue-backed dataset relay

The browser still tries official publisher URLs directly first. If browser CORS blocks a CSV/TSV file, the fallback is **not** a generic URL proxy.

The harvest builds `relay-index.mjs` from known catalogue distributions. Each approved HTTPS CSV/TSV URL receives an opaque SHA-256-derived relay ID. The browser requests only:

```text
/api/dataset-file/f_<32 hex characters>
```

The upstream URL never appears in the relay request and query parameters are rejected. A relay ID that is absent from the generated index returns 404.

Relay protections:

- only `GET` and `HEAD`
- no request body and no arbitrary query parameters
- incoming cookies, authorization and arbitrary headers are never forwarded
- only a fixed `Accept`, bounded `Range` and Belgium Data Desk user-agent are sent upstream
- HTTPS only; URL credentials are rejected
- literal private, loopback, link-local, local/internal hostnames and reserved IP ranges are rejected
- redirects are manual and every destination must remain inside the entry's approved host set
- a single byte range starting at zero is accepted and clamped to 8 MiB for relayed reads (direct browser reads may still profile up to 64 MiB)
- upstream fetches time out after 20 seconds
- streamed bodies are cut off at the approved byte budget even if a publisher ignores `Range`
- safe GET responses may use Cloudflare edge caching for five minutes
- Cloudflare Rate Limiting bindings cap each relay ID at 60 requests/minute/location and the relay as a whole at 300 requests/minute/location

The retired `/api/publisher-file?url=...` route returns HTTP 410 and cannot be used as an arbitrary proxy.


## SQL Lab security and access model

SQL Lab runs DuckDB-Wasm inside the visitor's browser. Catalogue data is loaded through an application-controlled ingest path; user-authored SQL is not allowed to open arbitrary files or URLs itself.

Access semantics:

- **SQL READY** means an actual DuckDB load succeeded in this browser. A HEAD request alone never earns this label.
- **SQL POSSIBLE** means the distribution format is compatible but has not completed an actual DuckDB load yet.
- Direct publisher loading is always attempted first.
- When direct CORS blocks an approved catalogue CSV/TSV, SQL Lab can request its opaque relay ID and register the returned bytes with DuckDB-Wasm.
- Relay-backed SQL is accepted only when the complete file is proven to fit within the 8 MiB relay ceiling. A bounded prefix is never represented as a complete SQL table.
- JSON and Parquet still require direct browser/CORS access or local download/drop; the bounded relay is not used for them.
- Local CSV, TSV, JSON/JSONL and Parquet files can be explicitly selected or dropped into the browser and remain local.

User SQL is restricted to one `SELECT` or `WITH ... SELECT` statement. The SQL guard rejects mutation/configuration statements, direct quoted file relations, DuckDB's dynamic `query(...)` function, `read_*` functions, `*_scan` functions, Parquet file-inspection functions, CSV sniffers, HTTP helpers, spatial file readers, secret inspection and other external-I/O/side-effect paths.

DuckDB is additionally initialized with extension auto-install disabled, community/unsigned extensions disabled, persistent/unredacted secrets disabled where supported, two execution threads, a 512 MiB memory limit, a 64 MiB temp limit, reduced expression depth, configuration locking and a 20-second user-query timeout/cancellation path. These controls are defense-in-depth; DuckDB-Wasm remains the primary execution sandbox.

Remote URL ingest accepts public HTTPS URLs without embedded credentials and rejects obvious local/private/reserved literal addresses. The catalogue relay remains stricter: only pre-indexed opaque IDs can cause a Worker-side upstream request.

CSV exported for Excel neutralizes string cells beginning with spreadsheet formula prefixes (`=`, `+`, `-`, `@`) to prevent formula injection from publisher-controlled data.


## Catalogue curation (find · understand · trust)

`scripts/curate.mjs` interprets catalogue metadata at harvest time. It is pure and unit-tested (`npm run test:curate`); the browser never guesses.

- **Licence** → label plus openness family: open, open (share-alike), non-commercial, no-derivatives, custom (read the terms), unknown. Raw licence URIs are never shown as bare path segments.
- **Place** → GeoNames / MarineRegions IDs resolved to Belgium, Flanders, Wallonia, Brussels, a city, or the sea.
- **Kind** → dataset, map/web service, publication (PDF-only), research supplement, metadata-only — judged only from the record's own distributions.
- **Topic** → publisher-declared EU data-theme first, then title keywords (never the publisher name), then a publisher default. It is labelled as auto-assigned.
- **Collections** → numbered periodicals and model-layer families (for example 1,663 DOV H3D layers) share one `seriesId`; the list shows one collection card instead of thousands of near-identical rows.
- **Access tier** → READY needs a successful link probe; a failed or HTML-instead-of-CSV probe never earns it.
- **Freshness** → judged against the publisher's own declared update cycle, and always labelled as metadata date, not observation date.
- **Trust checks** → pass / warn / fail / unknown per dimension (source, licence, freshness, link, format, contact, structure). Unknown is never rendered as a pass.

`scripts/probe-links.mjs` checks the first 32 KiB of each tabular distribution (3 requests per host at most) and records status, real format, CORS, Range support and size. See `docs/catalogue-quality-audit-2026-10.md` for the measured state of the catalogue and the defects this layer fixed.

Identity and attribution rules in the browser: two records merge only through an identifier that one source does not attach to several differently-titled records, and the displayed publisher is the one the catalogue declares (`public/dataset-publisher-v1.mjs`).


## MCP server (read-only)

The Worker also serves a stateless Model Context Protocol endpoint at `POST /mcp` (Streamable HTTP, JSON-RPC 2.0), so an AI assistant can search Belgian open data with the same evidence the web app shows.

Tools (all read-only): `catalogue_overview`; `search_datasets` (scope, topic, open-licence filter; series collapse into one result with a count; for 21 common needs the authoritative source is pinned first with a `guidance` block, see `public/dataset-authority-v1.mjs`); `get_dataset` (publisher, licence, contact, update cycle, declared columns, link-check evidence, `preview_available`); `preview_dataset` (columns, inferred types, delimiter, encoding and sample rows from the first 64 KiB of a relay-indexed CSV/TSV, fetched with the relay's host, redirect, timeout and rate-limit rules); `subsurface_at_location` and `get_subsurface_record` (live Databank Ondergrond Vlaanderen access, below); plus ChatGPT deep-research-compatible `search` and `fetch`.

Design constraints: search and records come only from pre-built static shards (`public/mcp/`, built by `scripts/build-mcp-index.mjs` at deploy after link health is applied); no tool accepts a URL, and `preview_dataset` can only read files whose opaque relay id is in the generated index; each request reads a handful of small shards so it fits the free-tier CPU budget; request bodies are capped at 16 KiB. Results are metadata and link-check evidence, never statements about data correctness; SQL analysis stays in the visitor's browser.

### Subsurface of Flanders (DOV)

`dov.mjs` gives location-based access to Databank Ondergrond Vlaanderen (DOV), the Flemish Government's subsurface database, which is also about half of the national DCAT catalogue as map-layer records. The catalogue says DOV exists; these two tools answer what DOV knows about a place:

- `subsurface_at_location` (address in Flanders, WGS84 latitude/longitude or Lambert 72 x/y; radius 25-500 m): soil-map unit, Tertiary and Quaternary geological map units, groundwater bodies and drinking-water protection zone at the point; the modelled column of geological (G3Dv3.1) and hydrogeological (H3Dv2.1, HCOV v2) units with depths, from one WMS GetFeatureInfo per model on its multiband coverage (unit names from `dov-model-units.mjs`, generated from DOV's layer titles by `scripts/build-dov-model-units.mjs`; regenerate when DOV publishes a new model); boreholes, CPTs and groundwater monitoring screens within the radius (count, nearest five, deepest others, with record ids); the current shallow-groundwater status at the nearest status well.
- `search_subsurface` (`dov-search.mjs`): boreholes, CPTs, groundwater screens, soil profiles or current groundwater permits by municipality (official 2025 boundary from Digitaal Vlaanderen's VRBG2025, generalised to 100 m and sent to DOV as the spatial filter, because DOV's own municipality labels are missing on ~40 % of boreholes and use pre-merger names), by address/coordinates and radius (≤ 5 km), or for all of Flanders; filters on depth, date, purpose, stratigraphy, CPT method, aquifer (HCOV code or name words resolved with the code list), quality data, lab data and licensed volume; sorting and counting run on DOV's server, so only the requested rows travel. Permit searches add the licensed total per aquifer.
- Groundwater permits and soil profiles also appear in `subsurface_at_location` (within at least 1 km). DOV publishes permit operators by name, including private persons; the tools name only KBO-registered enterprises and public bodies.
- Every answer starts with `key_facts`, a few sentences built only from the fields in the same answer (no model text).
- `get_subsurface_record` (`boring/…`, `filter/…`, `sondering/…`, `bodemlocatie/…`, `interpretatie/…`): soil profiles are summarised per horizon (Munsell colour, texture, organic C, pH, lime, mottling) with site data (water table, drainage, land use, parent material) and the Belgian soil code decoded with the soil-map legend; borehole metadata with up to two interpretations in full (formal stratigraphy, logged description, hydrogeological units; codes decoded with DOV's published XSD code lists), for a screen the water-level summary (latest, extremes, last 12 readings, yearly means) and groundwater quality (all results of the latest lab sample; nitrate, chloride, sulphate, ammonium, EC and pH over the last 20 samples), or for a CPT qc, fs, friction ratio and the Robertson (2010) soil behaviour type per metre.

How it works: live, read-only requests to DOV's GeoServer WFS (JSON, only the needed properties, never polygon geometry), the xdov record export and the code-list XSDs; addresses go to the Flemish geolocation service (Digitaal Vlaanderen). Nothing is harvested or stored. Per tool call: at most 16 upstream requests to two fixed hosts, 12 s timeout, 2-3 MiB byte caps, manual redirects (none followed), Cloudflare edge caching (1 h to 7 days by data type) and a `DOV_RATE_LIMITER` binding (60 calls/min per location). Inputs are numbers or `kind/permkey` ids validated before any request; no tool accepts a URL. WGS84 is converted to Lambert 72 in code (Helmert BD72 + Lambert conformal conic; matches the geolocation service to the centimetre). CPU per call (measured by replaying recorded DOV answers): about 1 ms at the default radius, 2.5 ms at 500 m in central Antwerp, 3 ms for a well with quality, 5 ms for a 2,700-reading electric CPT.

Licence and citation: DOV data is under the Flemish *Modellicentie Gratis Hergebruik*; every answer carries a `provenance` block with the citation DOV asks for. Tests: `scripts/test-dov.mjs` (offline, part of `npm test`); `npm run live:dov` runs twelve realistic questions against the real services (manual only, add `--mcp https://data.vecture.be/mcp` to test a deployment).

### Answer tools: statistics, air quality, flood risk

Beyond finding datasets, these tools answer the question with the official source and say how (`key_facts` first, then the evidence, definitions and a citation). All are read-only, use the same bounded client as the DOV tools (fixed hosts, request budget, byte caps, timeouts, edge caching, `DOV_RATE_LIMITER`), and give every place the same identifiers: the 2025 municipality with its NIS code, province and region (`place.mjs`).

- `belgian_statistics` (`statbel.mjs`): population on 1 January 2019–2026 (total, sex, age bands, non-Belgian nationality) and fiscal income 2014–2023 for every municipality, province, region and Belgium, from `public/statbel/` built by `scripts/build-statbel.mjs` out of Statbel's open-data files. Earlier years are summed onto the 2025 municipalities with an explicit merger table that the build checks against both years' totals; the totals are checked against be.STAT (Belgium 11,867,634 on 1 January 2026; 6,846,186 income declarations in 2023). Names resolve in Dutch, French and English, including pre-merger names, with explicit notes for ambiguous names (Brussels, Limburg/Limbourg, Antwerpen). Rankings within a province, region or Belgium. Prices come live from Statbel's CPI open-data file (be.STAT's CPI views stopped at December 2025), labour figures live from be.STAT's quarterly view. Run the build by hand when Statbel publishes a new year and commit `public/statbel/`.
- `air_quality` (`air.mjs`): IRCEL-CELINE for any address in Belgium (Flemish geolocation, else federal BeSt Address): RIO hourly and 24-hour values, the BelAQI forecast for four days, annual means (ATMO-Street street level in Flanders, RIO elsewhere) against WHO 2021 and EU current/2030 limits, and the nearest stations sorted by distance (the SOS 'near' search is unsorted) with stale stations skipped. Several layers per GetFeatureInfo; answers are accepted only when the value count matches.
- `flood_risk` (`flood.mjs`): VMM's official flood-prone maps (fluvial, pluvial, from the sea; classes A–D from the services' own legend) at a point in Flanders, via ArcGIS identify on inspirepub.waterinfo.be.

`scripts/test-live.mjs` (offline, part of `npm test`) covers these; `npm run live:dov` also runs them against the real services. www.waterinfo.be does not answer from some networks (it did not from the development machine; it does from the runner VM and from Cloudflare).

Connect (Claude Code): `claude mcp add --transport http belgium-open-data https://data.vecture.be/mcp`

Claude plugin (connector + skill): https://github.com/mhatipog/belgium-data-desk-claude


## Visual Data Studio

The SQL Lab's **Visualize SQL** button reruns its existing guarded SELECT in DuckDB-Wasm with a 10,000-row maximum (and one extra row to detect truncation). The normal table preview stays capped at 500. A **Try visual demo** button loads visibly labelled synthetic Belgian regional metrics. When invoked, the browser downloads pinned Perspective 5.5.1 (Apache-2.0) CDN assets for interactive pivot tables, filtering, grouping and charts. Results are processed client-side in a Perspective Web Worker; no upload endpoint or paid API is needed. The studio enforces 80 uniquely named columns and a 12 MiB text budget. View settings can be exported and imported as JSON without including data. Source: https://github.com/perspective-dev/perspective .
