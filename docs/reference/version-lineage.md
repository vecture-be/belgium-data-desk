# Dataset version passports, change semantics and release impact

Belgium Data Desk **observes** public datasets. It is not the publisher, and cannot infer official releases or revisions from HTTP headers, catalogue modification dates or file hashes.

## Reading the evidence

- MCP get_dataset returns card.version_passport, card.lineage and card.change_impact when a tabular profile exists; the dataset page uses the same card.
- /cards/summary.json reports coverage, and /cards/impact-manifest.json reports recent observed changes with affected catalogue outputs (maximum 250 entries, with a truncated flag).
- The data-changes branch publishes observed change types and their raw row/column/period deltas. It does not archive the publisher's data rows.
- No previous comparable baseline means **unassessed**, never unchanged.

## Five distinct concepts

| Concept | Evidence | Limitation |
| --- | --- | --- |
| Revision | Explicit publisher revision (currently unknown) | Do not fabricate a revision from timestamps |
| Release | Official publisher release (currently unknown) | An updated export need not be a new release |
| Manifestation | Publisher distribution URL, observed content hash prefix and row-set fingerprint | Not an immutable archive or certified integrity |
| Granularity | Inferred row-identifying column candidates and sample size | Not a publisher-declared primary key |
| Citation | Publisher landing page, file URL, observation date, completeness | The publisher remains the authoritative citation |

Change types distinguish append with period extension, append-only observations, schema evolution, potential breaking changes, replaced or removed rows, unknown content change and unchanged/unassessed. Append-only requires two complete comparable sets of distinct-row fingerprints. A row removal may be a rolling window instead of a historical correction.

## Internal lineage and deployment gates

Declared dependency path: publisher file → weekly observation → dataset card → (MCP get_dataset, website dataset view).

Only these internal connections are asserted. No dependency is claimed between a harvested CSV and a live tool that independently queries a publisher. This avoids spurious propagation.

Publisher anomalies create review tasks without blocking the entire site. The release gate blocks only if our own serialized card, fingerprint, publisher-version claim or affected-output manifest contradicts the underlying generated artifact. Existing Statbel data-sanity checks, golden-answer regressions and MCP contract tests remain separate safeguards.

Local commands: npm test; npm run build:index; node scripts/validate-version-output.mjs. The final command is invoked by build:index and therefore by the production deploy job. If no profile exists during bootstrap, the gate explicitly reports that it skipped.

## Scientific evaluation

Use historical weekly snapshots and independently labelled publisher changes, together with injected empty files, removed columns, invalid keys, temporal shrinkage, metadata-only updates and row reordering. Measure true/false positives, recall and precision by issue class, the fraction of files with comparable baselines, detection delay, and CI runtime/cost. Do not transfer a result measured at Google to this service.

## Limitations and next steps

- The row-set fingerprint covers distinct rows, not duplicate multiplicity or immutable archival versions.
- Column-name fingerprints do not certify units, type evolution or semantic definitions.
- The full-file checker covers accessible CSV/TSV files up to 100 MB. Other datasets receive no complete-file version.
- Dataset cards currently describe one selected tabular distribution; multiple representations require distribution-aware history.
- Official revision and release fields remain null absent explicit publisher evidence.
- Impact manifests are bounded; the underlying cards and public change logs retain individual evidence.

Next: explicit publisher revision identifiers where documented, keyed diffs for verified data grain, independent labelled detection benchmarks, and longitudinal false-positive measurements.
