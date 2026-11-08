import assert from "node:assert/strict";
import { expandSearchHay, familyKey, inferIdentifierHints, inferDatasetBrief, joinHint } from "../public/dataset-discovery-intelligence-v1.mjs";

const a={title:"Population by municipality 2024 CSV",description:"Annual population by NIS code",grain:"municipality × year",space:"Belgium",schema:[["nis_code","string","NIS code"],["year","integer","year"],["population","integer","population"]]};
const b={title:"Population by municipality 2025",description:"Population per gemeente using REFNIS",grain:"municipality × year",space:"Belgium",schema:[["cd_refnis","string","REFNIS"],["year","integer","year"]]};
assert.equal(familyKey(a,"Statbel"),familyKey(b,"Statbel"));
assert.match(expandSearchHay("municipality population"),/gemeente/);
assert.ok(inferIdentifierHints(a).some(x=>x.id==="nis-municipality"));
assert.ok(inferDatasetBrief(a).grain.includes("municipality"));
const plan=joinHint(a,b);
assert.equal(plan.kind,"identifier");
assert.ok(plan.shared.some(x=>x.id==="nis-municipality"));

const c={title:"Belgian companies",description:"KBO enterprise number and NACE activity",schema:[["enterprise_number","string",""],["nace","string",""]]};
const ids=inferIdentifierHints(c).map(x=>x.id);
assert.ok(ids.includes("enterprise-number"));
assert.ok(ids.includes("nace-bel"));

console.log("discovery intelligence tests passed");
