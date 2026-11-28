# Statbel television registration pilot

Staged for review, not approved for publication.

Source: Statbel, archive collection S750.A1, table 2 A(a) in the French 1983 and 1987 editions, PDF page 8 (printed page 2). URLs are recorded on every row. The catalogue reports CC BY 4.0; check document-specific rights before publishing. Values manually transcribed from rendered pages; source hashes and independent review remain outstanding.

22 source rows, 15 distinct years, 220 numeric values (nine historical provinces plus national total), 70 overlapping numeric comparisons, of which 69 agree. Non-localized registrations are printed as dashes and excluded from the sum test. 20 of 22 rows pass province sum versus published national total.

Exceptions requiring reinspection:
- 1978 Limburg: 172986 in the 1983 transcription vs 172886 in the 1987 transcription. The latter balances the national total; do not silently replace the first value.
- 1987: the nine transcribed provinces sum to 3172036, while the transcribed national total is 3172636. The difference is 600. Could be transcription or original publication error; do not treat as resolved.

The source explicitly notes a change from device counts to licence counts from 1977. Historical Brabant is not a present-day province. Do not equate registrations to households, individual devices, or penetration rates. No missing values imputed. Existing national historical statistics are known; provincial coverage novelty is unverified. No production integration.

Collection inventory: run python scripts/statbel-series-pilot.py pdf-audit.json --out statbel-series. The editorial shortlist is a human-review priority, not a novelty score. Filename years do not establish coverage and language editions are not unique observations.
