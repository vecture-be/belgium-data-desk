// Deployment gate: inspect the actual serialized cards and public impact manifest.
// Publisher data may legitimately change, but our release must not publish self-contradictory version claims.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { idShard, DOC_CHUNK } from "../mcp-server.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const dir=path.join(root,"public","cards"),summaryFile=path.join(dir,"summary.json");
const hasProfiles=[".cache/full-check.jsonl",".cache/link-probe.jsonl"].some(p=>fs.existsSync(path.join(root,p)));
const production=process.env.REQUIRE_FULL_FILE_PROFILE==="1";
const fullProfilePath=path.join(root,".cache","full-check.jsonl");
// A missing Actions cache must not silently replace thousands of evidence-backed
// cards with a small partial sample or an empty static directory in production.
if(production&&(!fs.existsSync(fullProfilePath)||fs.statSync(fullProfilePath).size===0))
  throw Error("Production version gate: full-file profile cache is missing or empty; restore full-check-state before deploying.");
if(!fs.existsSync(summaryFile)){
  if(hasProfiles)throw Error("Profiles exist but no cards/summary.json was generated");
  console.log("[version-gate] no profiles in this checkout; bootstrap check skipped");
}else{
  const summary=JSON.parse(fs.readFileSync(summaryFile,"utf8"));
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,"impact-manifest.json"),"utf8"));
  let count=0,review=0,informational=0;
  const ids=new Set(),problem=[];
  const fail=(id,reason)=>{if(problem.length<30)problem.push(id+": "+reason)};
  for(const f of fs.readdirSync(dir).filter(f=>/^[a-f0-9]{2}\.json$/.test(f))){
    const shard=JSON.parse(fs.readFileSync(path.join(dir,f),"utf8"));
    for(const [id,card] of Object.entries(shard)){
      count++;ids.add(id);
      const v=card.version_passport,lin=card.lineage,impact=card.change_impact;
      if(!v||v.dataset_id!==id||v.identity?.dataset_id!==id)fail(id,"missing/mismatched passport");
      if(v?.publisher_revision!==null||v?.publisher_release!==null)fail(id,"invented publisher version");
      if(v?.manifestation?.schema_fingerprint!==(card.schema?.fingerprint||null))fail(id,"schema fingerprint mismatch");
      if(v?.observation?.extent!==(card.file?.rows_exact?"whole_file":"first_bytes"))fail(id,"observation completeness mismatch");
      if(v?.manifestation?.content_sha256_prefix!==(card.file?.rows_exact?(card.file?.sha256||null):null))fail(id,"content prefix mismatch");
      if(lin?.confidence!=="declared_pipeline_only"||!lin.affected_outputs?.includes("mcp:get_dataset:"+id))fail(id,"lineage output missing");
      if(!impact||impact.automatic_release_block!==false)fail(id,"unsafe or missing impact decision");
      if(impact?.severity==="review")review++;
      if(impact?.severity==="informational")informational++;
    }
  }
  if(count!==summary.cards||count!==summary.versioning?.passports||count!==manifest.assessed)fail("counts","card/summary/manifest mismatch");
  if(production){
    const min=Number(process.env.MIN_FULL_FILE_CARDS||1);
    if(!Number.isSafeInteger(min)||min<1)fail("configuration","invalid MIN_FULL_FILE_CARDS");
    else if(summary.versioning?.whole_file<min)fail("coverage","only "+summary.versioning?.whole_file+" whole-file cards, minimum "+min);
  }
  if(review!==manifest.requiring_review||review!==summary.versioning?.requiring_review)fail("counts","review totals mismatch");
  if(!Array.isArray(manifest.entries)||manifest.entries.length>250)fail("manifest","invalid entries");
  // True selective release validation: only impacted records are cross-checked against
  // the built MCP id index and search shards, before the Worker can publish them.
  const mcp=path.join(root,"public","mcp"),idCache=new Map(),docCache=new Map();
  const getJson=(base,key,cache)=>{
    if(!cache.has(key))cache.set(key,JSON.parse(fs.readFileSync(path.join(base,key+".json"),"utf8")));
    return cache.get(key);
  };
  for(const e of manifest.entries||[]){
    if(!ids.has(e.dataset_id))fail(e.dataset_id,"impact points to nonexistent card");
    try{
      const idx=getJson(path.join(mcp,"i"),idShard(e.dataset_id),idCache)[e.dataset_id];
      if(!Number.isSafeInteger(idx))fail(e.dataset_id,"affected dataset missing from MCP id index");
      else{
        const chunk=Math.floor(idx/DOC_CHUNK),doc=getJson(path.join(mcp,"d"),String(chunk),docCache)[idx%DOC_CHUNK];
        if(doc?.id!==e.dataset_id)fail(e.dataset_id,"affected MCP search document is not the same dataset");
      }
    }catch(err){fail(e.dataset_id,"affected index unreadable: "+err.message)}
    if(!["review","informational"].includes(e.decision?.severity))fail(e.dataset_id,"unexpected impact severity");
  }
  if(problem.length)throw Error("Version release gate failed:\n"+problem.join("\n"));
  console.log("[version-gate] PASS",JSON.stringify({cards:count,review,informational,published_impacts:manifest.entries.length}));
}
