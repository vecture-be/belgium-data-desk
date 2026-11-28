// Inventory only: does not fetch publisher URLs or grant redistribution rights.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLicense } from "../public/dataset-licence-v1.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DATA = /^(CSV|TSV|XLSX?|ODS|PARQUET|JSON|JSONL|GEOJSON|XML|RDF|TTL|GPKG|SHP|WFS|API|DATA SERVICE|LDES|SDMX)$/i;
const DOC = /\b(manual|handleiding|guide|mode d.emploi|licen[cs]e|licentie|methodology|methodologie|metadata|documentation|documentation technique)\b/i;
const STATS = /\b(statistics|statistiques|statistieken|annual report|jaarverslag|rapport annuel|yearbook|annuaire|jaarboek|budget|measurements|metingen|mesures|historical|historique|historisch|census|recensement|volkstelling)\b/i;
const fmt = d => String(d.format || "").trim();
const pdf = d => /^(PDF|application\/pdf)$/i.test(fmt(d)) || /\.pdf(?:$|[?#])/i.test(d.url || "");
const alternative = d => DATA.test(fmt(d)) || /\.(csv|tsv|xlsx?|ods|parquet|json|geojson|xml)(?:$|[?#])/i.test(d.url || "");
function webUrl(raw) {
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
    u.hash = "";
    return u.href;
  } catch { return null; }
}

export function audit(items) {
  const groups = new Map();
  let pdfOccurrences = 0, pdfRecords = 0, noAlternativeRecords = 0;
  for (const item of items) {
    const ds = (item.distributions || []).filter(d => d && typeof d === "object");
    const pdfs = ds.filter(pdf);
    if (!pdfs.length) continue;
    pdfRecords++;
    const other = ds.some(d => !pdf(d) && alternative(d)) ||
      (item.formats || []).some(f => DATA.test(String(f)));
    if (!other) noAlternativeRecords++;
    for (const d of pdfs) {
      const url = webUrl(d.url);
      if (!url) continue;
      pdfOccurrences++;
      const distributionLicence = d.licenseUri || d.license || "";
      const datasetLicence = item.licenseUri || item.license || "";
      const licence = normalizeLicense(distributionLicence || datasetLicence);
      const datasetRights = normalizeLicense(datasetLicence);
      const distributionRights = normalizeLicense(distributionLicence);
      const conflict = Boolean(distributionLicence && datasetLicence &&
        distributionRights.id !== datasetRights.id);
      // A dataset-level licence might not apply to a third-party PDF.
      const licenceHint = !conflict && distributionLicence &&
        ["cc0","cc-by","flemish-free-reuse","odc-by","odc-pddl"].includes(licence.id)
        ? "explicit-open-hint" : "manual-rights-check";
      const title = String(item.title || item.name || "");
      const name = String(d.name || "");
      const documentationHint = DOC.test(name) || DOC.test(title);
      const statisticalHint = STATS.test(title + " " + name);
      const priority = (other ? 0 : 50) + (statisticalHint ? 20 : 0) +
        (licenceHint === "explicit-open-hint" ? 15 : 0) - (documentationHint ? 40 : 0);
      const ref = {
        datasetId: item.id || null, title, provider: item.provider || item.publisher || null,
        officialUrl: item.officialUrl || null, distributionName: name,
        machineReadableAlternativeHint: other, documentationHint, statisticalHint,
        distributionLicence, datasetLicence, licenceHint, licenceConflict: conflict, priority
      };
      if (!groups.has(url)) groups.set(url, {url, references: []});
      groups.get(url).references.push(ref);
    }
  }
  const candidates = [...groups.values()].map(g => ({
    ...g, priority: Math.max(...g.references.map(r => r.priority)),
    rightsReviewRequired: true, status: "unreviewed"
  })).sort((a,b) => b.priority-a.priority || a.url.localeCompare(b.url));
  return {
    counts: {recordsScanned: items.length, pdfRecords, noAlternativeRecords,
      pdfOccurrences, uniquePdfUrls: candidates.length},
    caveats: ["Metadata hints only; no document inspection or equivalence check.",
      "Catalogue snapshots may truncate distribution lists. Counts are observed, not exhaustive.",
      "No licence hint authorizes extraction or redistribution."],
    candidates
  };
}

export async function main() {
  const args = process.argv.slice(2);
  const arg = key => { const i = args.indexOf(key); return i >= 0 ? args[i+1] : undefined; };
  const pub = arg("--public") || path.join(ROOT,"public");
  const out = arg("--out") || path.join(ROOT,".cache","pdf-audit.json");
  const {loadCatalogueItems} = await import("./lib-catalogue.mjs");
  const {items, generatedAt} = await loadCatalogueItems(pub);
  const result = {...audit(items), catalogueGeneratedAt: generatedAt};
  await fs.mkdir(path.dirname(out), {recursive:true});
  await fs.writeFile(out, JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify(result.counts));
  console.log("Review queue: "+out);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
