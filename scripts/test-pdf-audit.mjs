import assert from "node:assert/strict";
import { test } from "node:test";
import { audit } from "./audit-pdf-distributions.mjs";

test("deduplicates PDFs, preserves references and detects alternatives", () => {
  const url = "https://example.org/stats.pdf";
  const result = audit([
    {id:"a", title:"Annual report", distributions:[{url:url+"#page=1",format:"PDF",license:"CC BY"}]},
    {id:"b", title:"Manual", formats:["CSV","PDF"], distributions:[{url,format:"PDF"},{url:"https://example.org/stats.csv",format:"CSV"}]},
    {id:"c", distributions:[{url:"https://example.org/other.PDF?download=1",format:"unknown"}]},
    {id:"d", distributions:[{url:"https://example.org/other.csv",format:"CSV"}]}
  ]);
  assert.deepEqual(result.counts,{recordsScanned:4,pdfRecords:3,noAlternativeRecords:2,pdfOccurrences:3,uniquePdfUrls:2});
  const first = result.candidates[0];
  assert.equal(first.url,url);
  assert.equal(first.references.length,2);
  assert.equal(first.references[0].licenceHint,"explicit-open-hint");
  assert.equal(first.references[1].machineReadableAlternativeHint,true);
  assert.equal(first.references[1].documentationHint,true);
  assert.equal(first.rightsReviewRequired,true);
});

test("unknown and conflicting rights require review, invalid URLs excluded", () => {
  const result = audit([
    {id:"a",license:"CC BY-ND",distributions:[{url:"https://example.org/a.pdf",format:"PDF",license:"CC BY"}]},
    {id:"b",license:"CC BY",distributions:[{url:"https://example.org/b.pdf",format:"PDF"}]},
    {id:"c",distributions:[{url:"file:///etc/test.pdf",format:"PDF"}]},
    {id:"d",distributions:[{url:"https://user:pass@example.org/c.pdf",format:"PDF"}]}
  ]);
  assert.equal(result.counts.uniquePdfUrls,2);
  for (const c of result.candidates) assert.equal(c.references[0].licenceHint,"manual-rights-check");
  assert.equal(result.candidates.find(c=>c.url.endsWith("/a.pdf")).references[0].licenceConflict,true);
});
