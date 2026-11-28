# Statbel inland navigation: historical pilot

Status: staged, not approved for publication.

Source: Statbel (Directorate-General Statistics – Statistics Belgium).
Catalogue record IDs:
- national:Q13840#ID (2000): https://doc.statbel.fgov.be/publications/S740.A3/S740.A3N_Binnenscheep_2000.pdf — PDF page 11 (printed page 4), table A, sections 1 and 2.
- national:Q13846#ID (2006): https://doc.statbel.fgov.be/publications/S740.A3/S740.A3N_Binnenscheep_2006.pdf — PDF page 10, table A, sections 1 and 2.

Licence evidence: both catalogue distributions declare CC BY 4.0.
https://statbel.fgov.be/en/cc-40 (third-party rights remain subject to review).
Changes: numeric transcription from rendered source pages, English column names,
thousands separators removed; units retained. Codes total/domestic refer to
the two source sections, not additional observations. No missing years imputed.

The CSV contains 46 source rows (32 distinct scope/year combinations).
The two editions share 14 scope/year combinations, with identical values in all
12 numeric measure columns (168 comparisons). The reported loaded and empty
distance percentages sum to 100 and agree with distances within 0.6 percentage
points, accounting for rounding, in all 46 rows.

## Known issues and limitations

- The total 2006 empty-vessel capacity is printed as 18 602 thousand tonnes,
  lower than the domestic subset (46 147). This is an unresolved source
  anomaly, not silently corrected. Do not treat this field as validated.
- Historical observations are selected years, not continuous annual coverage.
- The underlying reporting methodology changed in 1982, 1986 and 1993.
  The total series counted certain domestic trips via foreign territory twice
  through 1981 and once from 1982; the domestic series excluded those trips
  through 1981 and included them from 1982. Zeebrugge bunker supplies were
  excluded from 1986. The 1993 changes concerned collection and processing.
- Statbel also warns against direct comparison with data from 2007 onward
  after the goods classification changed:
  https://statbel.fgov.be/en/themes/mobility/transport/inland-water-transport-waterborne-transport
- Source PDF bytes were inaccessible in the execution environment. Hashes
  are not recorded yet; the transcription was from rendered pages, not an
  execution of the generic extractor. A second reviewer is still required.
- Existing structured historical sources (including Eurostat and Belgian
  transport datasets) have not been exhaustively checked for equivalence.
- This is a staged research artifact outside public/, not a new official
  publisher distribution. No production service changes.

Validate by comparing all cells against the two source pages, then obtain
source hashes, investigate the 2006 anomaly and identify whether this table
is already available in a structured source. Only then derive a public version.
