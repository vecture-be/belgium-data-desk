# GIPOD LDES change intelligence — verified research pilot

**Status (2026-11-10):** Real GIPOD production data ingested and interpreted on a GitHub Actions runner; no deployment, no public MCP endpoint, no auto-posting, **no claim of complete stream/window coverage**. Reuses the TREEcg LDES client, not a custom fragment crawler. The only proposed product contribution is a conservative, publisher-specific change evidence/review layer.

## Purpose

Turn successive public GIPOD mobility-hindrance versions into source-backed, *per-entity net-change* candidates. Many individual immutable versions are administrative churn; first-seen events are not automatically newly created roadworks. A candidate is not a verified real-world traffic closure or a finished social post.

## Official data contracts

- Source stream: https://gipod.api.vlaanderen.be/api/v1/ldes/mobility-hindrances
- GIPOD LDES reference: https://docs.athumi.eu/gipod/help/ldes-mobilityhindrance
- Publisher's JS client shape: https://docs.athumi.eu/gipod/help/example-ldes-implementation-guide
- Geometry documentation: https://docs.athumi.eu/gipod/help/geometry-information (Lambert 72, EPSG:31370)
- Existing standard client: https://github.com/TREEcg/event-stream-client
- Existing endpoint monitor: https://github.com/lblod/ldes-monitoring-service (not duplicated here)

## Run once, locally or on an isolated runner

Requires Node 22+. The interpreter needs no additional dependencies. The optional **research collector** requires an external client:

    node scripts/ldes-gipod-events.mjs --self-test
    npm install --no-save --package-lock=false @treecg/actor-init-ldes-client@4.0.9
    node scripts/ldes-gipod-collect.mjs --since 2026-11-09T00:00:00Z --limit 12 --out .cache/ldes-gipod

Use the **same** --out and --since to resume a run via saved TREE client state. The timestamp is an entry point for GIPOD's fragment traversal, **not** a server-side filter and not proof that a time window is fully traversed. Some fetched members may have earlier generatedAtTime. Results explicitly filter candidate publication time and report records before since. The --limit argument is a **soft pause target**, not a network response/page size: the client can deliver a whole batch of 250 members before pausing. Every delivered member must be persisted, not silently truncated. This is why the storage ceiling is bounded at 1750 parsed members / 24 MiB: the collector fails closed rather than advancing its checkpoint if a batch cannot be retained.

Everything is stored under an ignored .cache/ directory: members.json, state.json, change-evidence.json, manifest.json. The importer rejects reuse of an output path with another stream/timestamp. It checks previously stored immutable IRI fingerprints on restart, retains only one copy of duplicated members, and writes the member data and report **before** writing an advanced checkpoint.

The npm install of the optional TREEcg 4.0.9 package on 2026-11-10 reported **17 dependency vulnerabilities, four rated high**. It is **not** added to our runtime package.json or Cloudflare deployment. Audit and select a maintained, secure, lower-dependency strategy before this is a scheduled service.

The standalone interpretation CLI accepts a bounded JSON array of the parsed TREE client member objects:

    node scripts/ldes-gipod-events.mjs .cache/ldes-gipod/members.json

A member's publisher GIPOD ID and version-position URI are used for identity and ordering. An incomplete or inconsistent identity is flagged, never inferred from business names, geographical proximity or record text.

## Verified on real GIPOD public data

- First live fragment: 250 members parsed, **zero parsing errors**.
- In the 2026-11-05 starting-fragment sample, 160 per-version comparisons became **3 net per-entity change candidates**; two were geometry-only technical reviews, not editorial stories.
- With the 2026-11-09 entry point, one fragment had 250 members and **zero net review candidates** in the *sample*. Not evidence that no changes occurred that day.
- Resuming the same persisted client state across a second fragment yielded **500 stored members** and **31 net-change candidates**, of which **17 passed the *structural* editorial-review gate**. These are *unreviewed candidates*, not published news or verified traffic impacts.
- A third fragment in that run exceeded the prior 7 MiB bounded capacity. The script refused to checkpoint the dropped records; that failure prompted increasing the ceiling and adding restart integrity checks. See GitHub Actions logs for the validation run. No claim that the aborted third fragment had complete coverage.

## Evidence and quality gates

The output includes source IRIs, publisher timestamps, version relationships, event types, changed fields with **before and after** evidence, planned work periods, publisher-labelled consequences, Lambert 72 geometry envelopes, version counts, and a deterministic review priority.

- Publication time generatedAtTime != planned work period != actual physical road closure.
- Draft records (In opmaak), unvalidated changes, and geometry-only churn stay on the technical-review path.
- Even validated status + substantive fields implies **editorial review only**. It is never automatically sent to social channels.
- A first_observed_version means first version in our partial sample, **not** entity creation.
- Tied publication timestamps are ordered only when numeric publisher version positions make the order explicit.
- A net change is computed across the available observed versions; intermediate versions might be missing. A temporary change later reversed is suppressed.
- Geometry is handled in EPSG:31370; bounding envelopes do **not** establish exact intersections or safe addresses.
- A stream sample with no candidates is not evidence of no recent changes.
- The candidate priority measures field-level importance; does not model physical severity or regional significance.

## Next product acceptance gates

1. Demonstrate multiple persisted full-fragment continuations without dropped records and with an honest partial-coverage indicator.
2. Validate a few candidate before/after pairs against the publisher's own historical record API, including a nontrivial mobility-consequence or schedule edit. Current matching is at parsed-client semantics, not independently audited against every publisher object.
3. Establish defensible **time-window completeness** and a source-ID-to-place lookup before powering public map, city subscriptions or story generation.
4. Expose a read-only, evidence-driven search_changes MCP tool only after those gates. Add editorial publication separately, with source-version links, context, exact location and human-review or strongly verified story gates.

No client-owned POC implementation, data, artifacts, or proprietary assumptions were used.
