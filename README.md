# Belgium Data Desk

Belgian public data, answered from the official sources.

Belgium Data Desk is a catalogue of about 21,700 Belgian open-data records (data.gov.be plus directly harvested federal, regional and city portals), a website to search it, and an [MCP](https://modelcontextprotocol.io) server that lets AI assistants search it and answer common questions from the authoritative publisher: Statbel figures, IRCEL-CELINE air quality, VMM flood maps and the Flemish subsurface database (DOV).

Hosted instance: **https://data.vecture.be** · MCP endpoint: `https://data.vecture.be/mcp` (no account, read-only)

```bash
claude mcp add --transport http belgium-open-data https://data.vecture.be/mcp
```

The public service combines a searchable catalogue, browser-based analysis and read-only MCP tools. No account is required, and the website does not use tracking scripts.

## What the MCP server offers

| Tool | Answers from |
| --- | --- |
| `search_datasets`, `get_dataset`, `catalogue_overview` | The catalogue: metadata, licence, contact, link checks. For 21 common needs the official source is pinned first with guidance (`public/dataset-authority-v1.mjs`). |
| `preview_dataset` | The first 64 KiB of a catalogued CSV/TSV, fetched from the publisher |
| `belgian_statistics` | Statbel: population, income, inflation, unemployment by municipality, province, region |
| `air_quality` | IRCEL-CELINE: now, forecast, annual means against WHO and EU limits |
| `flood_risk` | VMM's official flood-prone maps (Flanders) |
| `subsurface_at_location`, `search_subsurface`, `get_subsurface_record` | Databank Ondergrond Vlaanderen: soil, geology, boreholes, groundwater |
| `search`, `fetch` | Same catalogue, in the shape ChatGPT deep research expects |

Answers start with `key_facts` built only from data in the same answer, and carry a `provenance` block. Catalogue results are metadata and link-check evidence, not claims that the data is correct.

## Run it locally

Requires Node 22+.

```bash
npm ci
npm test                 # offline unit tests, about 5 seconds
npm run snapshot         # download the current catalogue from data.vecture.be (about 25 MB)
npm run build:index      # build the MCP search shards and the static SEO pages
npm run dev              # http://localhost:8787 and http://localhost:8787/mcp
```

`npm run harvest` rebuilds the catalogue from the source portals instead of the snapshot. It takes a few minutes and some portals may not answer from every network; the harvest then keeps the previous records for that source.

Check a running server (yours or the hosted one):

```bash
npm run eval                                         # search relevance against eval-relevance/queries.json
node scripts/smoke-mcp.mjs http://localhost:8787     # every MCP tool once
node scripts/verify-live.mjs http://localhost:8787   # catalogue, relay, MCP and page integrity
```

## Architecture

[Logical architecture and editable diagrams](docs/ARCHITECTURE.md) describe the public interfaces, the indexed catalogue pipeline, live-source answer tools, shared evidence controls, and the release process.

The catalogue path harvests and checks source metadata before publishing search artifacts. Live answer tools query authoritative services with validated inputs, bounded upstream access, and source attribution. Both paths share consistent identifiers and provenance.

| Where | What |
| --- | --- |
| `scripts/harvest.mjs`, `scripts/national-dcat.mjs` | Source adapters: CKAN, OpenDataSoft, OGC API, CSW and the national DCAT feed |
| `scripts/curate.mjs`, `public/dataset-*.mjs` | Curation: kinds, topics, licences, publishers, authoritative sources, synonyms |
| `mcp-server.mjs` | MCP protocol, tool definitions, search ranking |
| `statbel.mjs`, `air.mjs`, `flood.mjs`, `dov.mjs`, `dov-search.mjs`, `place.mjs` | Live answer tools |
| `eval-relevance/queries.json` | Real questions with the answer an expert would expect |
| `scripts/test-*.mjs` | Offline tests (`npm test`) |
| `docs/reference/` | Design notes: relay security model, SQL Lab, DOV details, catalogue audit |

## Contributing

You do not need to write code to help. The most useful contributions are a wrong answer you noticed, a better official source, a correction to a publisher or licence, or a real question the search gets wrong. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Hosting your own

Deployment configuration lives in `wrangler.jsonc`. For your own installation, configure `PUBLIC_ORIGIN` and the bindings for your account, then run `npx wrangler deploy`. Keep credentials in deployment secrets, not source control.

## Licence

Code: MIT. Catalogue metadata and answers come from the publishers named in each record and keep their licences; every answer cites its source.
