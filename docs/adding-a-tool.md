# Adding a live answer tool

A live answer tool answers a question from an official service: "is this address flood-prone", "what is under this place", "how many people live here". You bring the domain knowledge: which service is authoritative, what its fields mean, what an answer must and must not claim. The platform handles the MCP protocol, the tool listing, input limits, upstream safety, caching, search hints and tests.

A tool is **one file** in `tools/`. Nothing else in the server needs to change.

## Steps

```bash
npm run tool:new -- water_level          # writes tools/water-level.mjs and registers it in tools/index.mjs
# fill in the TODOs (below)
npm run tool:record -- water_level       # calls the real service once and saves its answers as tools/fixtures/water_level.json
npm test                                 # contract and replay tests for every tool, offline
npm run dev                              # then: node scripts/smoke-mcp.mjs http://localhost:8787
```

Open a pull request with the tool file, its fixture and the one-line registry change. `npm test` must pass; CI runs the same tests.

## What the definition contains

| Field | What to write | Checked by |
| --- | --- | --- |
| `name` | `lower_snake_case`, says what it answers (`water_level`, not `waterinfo_api`) | contract |
| `title` | short, as the assistant shows it | contract |
| `description` | 80–1600 characters: what it answers, from which source, which area and period, what the main fields mean, and **what it does not answer**. Assistants choose tools by this text. | contract |
| `inputSchema` | JSON Schema. Every argument has a type and a description with an example. Location tools spread `COORDINATE_PROPERTIES` next to `address`. | contract |
| `source` | publisher, licence (must allow reuse), a page about the data | contract |
| `hosts` | every hostname `run()` calls. Add `GEOCODER_HOSTS` when you accept an address. | contract; the client refuses every other host |
| `maxRequests` | upstream requests per call, at most 20 | contract; the client stops at the budget |
| `run(client, args, ctx)` | the domain logic (below) | replay test |
| `examples` | at least two real questions as arguments; one has `replay: true` and is recorded as the test fixture | contract (arguments must fit the schema) |
| `routing` (optional) | `{words, hint}`: query words for which `search_datasets` points to your tool instead of listing files | test: a word may lead to one tool only |

## Writing `run()`

`run` receives a bounded **client**, the **arguments** and `{assets}` for committed static tables. Use the helpers in `lib/tool-kit.mjs`:

- `resolveLocation(client, args, {area: "belgium" | "flanders"})` turns an address or coordinates into `{x, y, latitude, longitude, ...}` (x/y are Lambert 72 metres, which most Belgian map services use).
- `getJson(client, url, {maxBytes, ttl})` reads a JSON service; `client.get(url, {binary})` reads XML, CSV or ZIP. Both return `{error}` instead of throwing. Responses are edge-cached for `ttl` seconds; choose it from how often the source changes (`HOUR` for live measurements, `DAY` or more for maps).
- `placeContext(client, assets, loc)` adds the municipality with NIS code, population and income.
- `clean(obj)` drops empty fields so answers stay small.

Return either `{ error: "a sentence the assistant can pass on" }` or an answer object:

```js
{
  key_facts: ["Complete sentences with the numbers, units and reference dates, built only from values in this answer."],
  // the evidence: the values, identifiers (so a follow-up call can ask for more), definitions, thresholds
  provenance: { source: "Publisher, dataset", licence: "...", url: "...", citation: "as the publisher asks, consulted on <date>" }
}
```

The contract test rejects answers without `key_facts` or `provenance.source`, answers over 64 KiB, and any `undefined`, `NaN` or `[object Object]` in the text.

## Rules that keep answers trustworthy

- **Official source only**, with a licence that allows reuse and **no API key**: the hosted service runs without secrets.
- **No tool accepts a URL.** Arguments are identifiers, places, dates and values; build every upstream URL in your code. The contract refuses argument names such as `url` or `source_url`.
- **Say what the figure means and what it does not.** "Modelled for a 4 km cell", "describes the location, not the building", "reference date 1 January". Put the limits in the description, the answer and `key_facts`.
- **Identifiers over names.** Return NIS codes, record ids and station codes, so answers can be joined and followed up.
- **No personal data.** Name enterprises and public bodies, never private persons.
- **Small and bounded.** Ask the service for the fields you use (`propertyName`, `outFields`, `count`), not whole layers.

## When the service changes

If a test says a request is "not in the fixture", your code now asks something different: run `npm run tool:record -- <name>` again and commit the new fixture. If the real service changed its answer format, the recording fails with the reason, and the fixture shows what it used to say.
