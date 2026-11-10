# Contributing

Belgium Data Desk is useful only if its answers are right and point to the source a Belgian data professional would use. Most of what makes it better is knowledge, not code: which source is official, what a publisher is really called, which question goes wrong. Pick whichever of these fits.

## 1. Report a wrong or weak answer (no code)

Open an issue with the **Wrong answer** form. Give the tool or the question you asked, what came back, what the right answer is, and the official page that shows it. A link to the publisher's own page is worth more than a long explanation.

## 2. Add a real question to the relevance set (small JSON edit)

`eval-relevance/queries.json` holds questions people actually ask, with what a good answer must contain. Every deploy runs them; a change that makes them worse does not ship.

```json
{ "q": "aantal inwoners Gent", "expect": "population|bevolking", "best": "Population by place of residence" }
```

- `q`: the question as someone would type it, in Dutch, French or English.
- `expect`: a regular expression one of the top 5 results must match (title, publisher or description).
- `best` (optional): a regular expression for the record an expert would point to first. It must be in the top 3.

Run `npm run snapshot && npm run build:index && npm run eval` to see where your question lands today. A question that fails is still a good contribution: say so in the pull request, and it becomes a starting point for a ranking fix.

## 3. Correct the catalogue's knowledge (small code edits, each covered by `npm test`)

| To change | Edit |
| --- | --- |
| Which source is the official one for a common need (population, KBO, air quality …), and its caveats | `public/dataset-authority-v1.mjs` |
| Words that mean the same thing across Dutch, French and English | `public/dataset-synonyms-v1.mjs` |
| A publisher's name when the catalogue only has an enterprise number | `KNOWN_PUBLISHERS` in `public/dataset-publisher-v1.mjs` |
| Hand-reviewed descriptions of key datasets (grain, columns, pitfalls) | `public/dataset-atlas*.mjs` |
| How records are classified (dataset, map service, publication …) and topics | `scripts/curate.mjs` |

Please cite the publisher's page for every factual statement in the pull request. Keep entries factual and about the source; caveats should name a trap people actually fall into.

## 4. Add a source (code)

There are two kinds.

**A catalogue source** (a portal whose dataset list should be searchable). Add an adapter to `scripts/harvest.mjs` and list it in `jobs`. Existing adapters cover CKAN (`harvestCkan`), OpenDataSoft (`harvestOds`), OGC API (`harvestOgc`) and CSW (`harvestCsw`), so a new portal on one of those platforms is often one line. An adapter returns records with at least `id`, `title`, `provider`, `license`, `officialUrl` and `distributions` (`{name, format, url}`); a failing source falls back to its previous records, so one portal being down never empties the catalogue.

**A live answer tool** (answers a question from an official service, like `flood_risk`). A tool is one file in `tools/`: you write the domain logic and real example questions; the platform derives the tool listing, upstream allow-list, search hints and tests from it. Start with `npm run tool:new -- <name>` and follow [docs/adding-a-tool.md](docs/adding-a-tool.md). `tools/flood-risk.mjs` with `flood.mjs` is the smallest complete example.

Requirements for a live tool (the contract test checks most of them):

- The upstream is the official publisher (or its official service), with a licence that allows reuse, and needs **no API key**: the hosted instance must work without secrets.
- No tool accepts a URL. Inputs are validated before any request is made.
- A call stays within bounded upstream-request, response-size and execution-time budgets.
- No personal data in answers: name enterprises and public bodies, not private persons.

## Development

```bash
npm ci
npm test                  # offline, ~5 s; CI runs the same
npm run snapshot          # current catalogue from data.vecture.be
npm run build:index       # search shards and static pages
npm run dev               # local Worker on :8787
npm run eval              # relevance set
node scripts/smoke-mcp.mjs http://localhost:8787
```

Code style: plain ES modules, no build step, no runtime dependencies. Match the style of the file you are editing. Comments explain why, not what.

Pull requests need `npm test` to pass. If you changed search or curation, include the `npm run eval` summary line before and after.

## Security

The dataset relay and the live tools fetch from the internet on behalf of users. If you find a way to make them fetch something they should not, please report it privately (see [SECURITY.md](SECURITY.md)) instead of opening an issue.
