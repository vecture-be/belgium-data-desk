# GIPOD LDES: first change-intelligence pilot

**Status: offline research prototype only.** No deployment, no new MCP tool, no live GIPOD data asserted. This is not a general LDES reader and does not traverse TREE fragments.

## Goal

Interpret successive versions of public GIPOD mobility-hindrance records without equating first-seen members with newly created roadworks. This is the part that ordinary LDES traversal and generic endpoint monitoring do not provide.

## Publisher documentation

- Public stream: https://gipod.api.vlaanderen.be/api/v1/ldes/mobility-hindrances
- Official guide: https://docs.athumi.eu/gipod/help/ldes-mobilityhindrance
- Official JavaScript consumer example: https://docs.athumi.eu/gipod/help/example-ldes-implementation-guide
- Recommended existing LDES client: https://github.com/TREEcg/event-stream-client
- Existing ecosystem endpoint monitor (do not duplicate): https://github.com/lblod/ldes-monitoring-service

## Run

Node 22+, no extra project dependencies:

    node scripts/ldes-gipod-events.mjs --self-test
    node scripts/ldes-gipod-events.mjs /path/to/parsed-client-members.json

Input is a small JSON array containing actual member objects exported from a proper, standards-aware LDES client configured for object representation. Each element must contain the immutable member IRI as an id and its publisher-decoded object (with a numeric gipodId, generatedAtTime, etc.). Limit: 2,000 members / 8 MiB. The script does not fetch endpoints itself.

Expected input shape (synthetic illustration only):

    [
      {
        "id": "https://example.org/stream/123-v1",
        "object": {
          "gipodId": {"value": "123"},
          "generatedAtTime": "2026-11-08T10:00:00Z",
          "status": {"id": "https://example.org/status/planned"},
          "period": [{"start": "2026-12-01T08:00:00Z", "end": "2026-12-01T17:00:00Z"}]
        }
      }
    ]

## Trust boundaries

- A first_observed_version is only first **in the supplied sample**, not evidence of a newly created roadwork.
- Observed revisions are linked exclusively on publisher-defined GIPOD identifiers. Missing identifiers are explicit; none are guessed.
- generatedAtTime is publication time; start/end in period describe planned real-world activity.
- The comparison covers status, description, periods, a schedule fingerprint and zone/consequence/geometry fingerprints. It does not interpret recurrence, assign geographical locations, infer severity, or claim observed traffic impact.
- A repeated immutable member IRI with conflicting payloads is rejected. Equal publication timestamps for the same entity are marked as ordering_unverified.
- No historical completeness is claimed. Input from an arbitrary recent page is insufficient for deciding when an entity first appeared.

## Next acceptance gate (not yet done)

1. Run the existing LDES client against the **public production** GIPOD endpoint from a network-enabled runner. Follow TREE links, save traversal/checkpoint state and choose a bounded recent starting point using the publisher-documented generatedAtTime parameter. Do not pull the entire history by accident.
2. Export a small real client-object sample outside the repository and inspect whether member fields and identifiers match the official example. Run this script and review a few revision pairs against source data.
3. Only after the live end-to-end data contract is verified, expose evidence-backed changes through a read-only MCP tool. Maintain producer provenance, source member IDs and honest history-window limitations. Never auto-post stories from unverified data.
4. Consider a publisher-friendly, reusable change-evidence format once the real sample shows which fields and cases matter.

This work uses open public specifications; no client code, records or proprietary POC assumptions are required.
