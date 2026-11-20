# MCP performance, resilience and trustworthy usage

## Production diagnostics

Cloudflare Worker invocation metrics measure **CPU time**; MCP_USAGE Analytics Engine's
`double1` measures **elapsed time**, including network waits. Never confuse them.

`MCP_DIAGNOSTICS_SAMPLE_RATE` (configured to `0.1`) logs one in ten
`tools/call` invocations to Worker observability as `bdd.mcp.tool`.
Every sampled log carries only the tool name, tool status, elapsed time,
asset-read count, cache-hit count, and measured time spent parsing/freezing
index JSON. No query strings, IP addresses, dataset IDs, client headers,
tokens or conversation content are logged by this diagnostic.

In Cloudflare **Workers → Observability → Logs**, filter the service
`belgium-data-desk` and message `bdd.mcp.tool`. Correlate the diagnostic
message to its enclosing invocation by the Cloudflare request ID. Group
`$workers.cpuTimeMs` by tool name on the *same invocation* and compare
p50, p95 and p99 with the 10 ms Workers Free budget. Distinguish
`asset_reads > 0` (cold) from `asset_reads = 0` (warm). Do not use
the elapsed duration in `MCP_USAGE` as if it were CPU.

Do not change ranking or remove caching unless cold/warm CPU measurements
actually identify a bottleneck. The production shared shard cache remains
bounded (12 MiB of serialized JSON), and the 30-read request budget remains.

## Reproducible CPU benchmark

Run `npm run bench:mcp` to compare isolated (cold module cache) and warmed
MCP search requests against a synthetic 4,000-record catalogue with no network.
The output reports Node process CPU and elapsed time, median/p95 and asset
fetch counts. Set `BDD_BENCH_RECORDS=10000` to stress more records (maximum
23,000). Results are **not** Cloudflare CPU measurements and are not a
benchmark of real search relevance. Never establish hard pass/fail CPU limits
from CI runners alone.

## Identify your own tests, without user tracking

`MCP_USAGE` now includes `blob6 = self_test | unclassified`.
Only a request with the secret `MCP_TEST_TOKEN` in header
`x-bdd-test-token` is marked `self_test`. The secret must have at least
24 characters and must be configured with `wrangler secret put MCP_TEST_TOKEN`;
it is never committed to the repository. With no configured secret or no
matching header, events remain `unclassified` — **not** proven external
users. No historic traffic is reclassified.

To tag authenticated production smoke tests:

```sh
BDD_TEST_TOKEN="<the same secret stored in the Worker>" node scripts/smoke-mcp.mjs https://data.vecture.be
```

The script sends the test header but does not print its value. Use a
dedicated secret; do not reuse a general API key. Never report raw
`initialize` counts as unique users: retries, probes, scripts and clients
can initialize repeatedly. Classifying tests does not authenticate or
identify external users.

An example trend query against Analytics Engine:

```sql
SELECT toDate(timestamp) AS day, blob6 AS traffic_class,
       blob1 AS method, COUNT() AS events
FROM belgium_data_desk_mcp_usage
WHERE timestamp > NOW() - INTERVAL '14' DAY
GROUP BY day, traffic_class, method
ORDER BY day, traffic_class, method
FORMAT JSON
```

## River levels and partial answers

`river_levels` now gives essential gauge/history requests an 8-second
upstream timeout and optional forecast, status and historical-statistics
requests a 4-second timeout. This bounds waiting on unresponsive public
services and preserves their provenance. Failure to load measured history,
status or long-term statistics is explicitly reported as an incomplete
answer (`search.details_not_answering`); absent official status must never
be interpreted as normal. The existing forecast-partial and missing-provider
behavior is preserved.

The source still supplies time-stamped provisional measurements only, not
property-level flood safety. **No unlabelled stale measurements or invented
forecasts are served as a fallback.** Run `npm test`, especially
`scripts/test-rivers-weather.mjs`, before deploying. After deployment,
check upstream error and p95 latency by tool, and revert the lower timeouts
if legitimate upstream responses are systematically being abandoned.
