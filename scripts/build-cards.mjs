// Build dataset cards (scripts/dataset-card.mjs) from the weekly link probe's column profiles.
//   node scripts/build-cards.mjs [--probe .cache/link-probe.jsonl] [--previous .cache/link-probe-prev.jsonl] [--full .cache/full-check.jsonl]
// Writes public/cards/<shard>.json ({id: card}, sharded like the MCP id index) and public/cards/summary.json. The previous probe,
// when present, gives schema drift ("columns changed since ..."). Whole-file profiles from scripts/full-check.mjs, when present,
// replace the probe's first-256-KiB profile of the same file. A no-op without either file, so local builds keep working.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCard } from "./dataset-card.mjs";
import { pickTabularDistribution } from "./tabular-profile.mjs";
import { idShard } from "../mcp-server.mjs";
import { buildScorecards } from "./health.mjs";
import { facetsOf } from "./build-mcp-index.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),pub=path.join(root,"public"),out=path.join(pub,"cards");
const arg=(name,def)=>{const i=process.argv.indexOf("--"+name);return path.resolve(i>=0?process.argv[i+1]:def)};
const probeFile=arg("probe",path.join(root,".cache/link-probe.jsonl")),prevFile=arg("previous",path.join(root,".cache/link-probe-prev.jsonl"));
const fullFile=arg("full",path.join(root,".cache/full-check.jsonl"));

function loadProfiles(file){
  const byUrl=new Map();
  if(!fs.existsSync(file))return byUrl;
  for(const line of fs.readFileSync(file,"utf8").split("\n")){
    let r;try{r=JSON.parse(line)}catch{continue}
    if(r?.url&&r.profile&&!r.profile.error&&r.profile.rows>0)byUrl.set(r.url,r);
  }
  return byUrl;
}
// Cards follow the published MCP records (public/mcp/, built just before by scripts/build-mcp-index.mjs): the index merges records
// that several catalogues carry, so its ids are the ones get_dataset answers for. Light docs give id and update date, details the
// declared frequency and file links.
export function loadRecords(){
  const dir=path.join(pub,"mcp"),items=[];
  if(!fs.existsSync(path.join(dir,"manifest.json")))throw new Error("public/mcp is missing: run scripts/build-mcp-index.mjs first");
  const docs=[],details=[];
  const chunks=sub=>fs.readdirSync(path.join(dir,sub)).filter(f=>/^\d+\.json$/.test(f)).sort((a,b)=>parseInt(a)-parseInt(b));
  for(const f of chunks("d"))docs.push(...JSON.parse(fs.readFileSync(path.join(dir,"d",f),"utf8")));
  for(const f of chunks("x"))details.push(...JSON.parse(fs.readFileSync(path.join(dir,"x",f),"utf8")));
  docs.forEach((d,i)=>{const x=details[i]||{};items.push({id:d.id,title:d.t||"",publisher:d.p||"",topic:d.tp||"",authoritative:!!d.c,updatedAt:d.u||null,frequency:x.fq||"",distributions:(x.files||[]).map(f=>({url:f.u,format:f.f}))})});
  return items;
}
const distUrl=d=>Array.isArray(d)?d[4]:d?.url;
const distFormat=d=>Array.isArray(d)?d[1]:d?.format;

export function buildCards(records,current,previous,{now=new Date().toISOString()}={}){
  const cards=new Map();
  for(const rec of records){
    if(!rec?.id||cards.has(rec.id))continue;
    const dists=(rec.distributions||[]).map(d=>({url:distUrl(d),format:distFormat(d),name:Array.isArray(d)?d[0]:d?.name})).filter(d=>d.url);
    const best=pickTabularDistribution({distributions:dists});
    const d=[best,...dists].find(x=>x&&current.has(x.url));if(!d)continue;
    const p=current.get(d.url),prev=previous.get(d.url);
    const prevCard=prev?buildCard(rec,prev.profile,{now:prev.checkedAt||now,file:{}}):null;
    cards.set(rec.id,buildCard(rec,p.profile,{previous:prevCard,now:p.checkedAt||now,
      file:{url:d.url,format:d.format||p.fmt,bytesRead:p.bytes,totalBytes:p.total,lastModified:p.lastModified,etag:p.etag,sha256:p.sha256,headerCheck:p.header_check,change:p.change||null,
        ...(p.content_since?{content:{since:p.content_since,changedAt:p.content_changed_at,changedAfter:p.changed_after,observedSince:p.observed_since,lastModifiedUsable:p.header_check?.last_modified_usable,rowOrderUnstable:!!p.row_order_unstable}}:{})}}));
  }
  return cards;
}

export function headerSummary(cards){
  const lm={},issues={};let usable=0,etag=0;
  for(const c of cards){const h=c.file.headers;lm[h.last_modified]=(lm[h.last_modified]||0)+1;if(h.last_modified_usable)usable++;if(h.etag==="present")etag++;
    for(const i of h.issues)issues[i]=(issues[i]||0)+1}
  return{files:cards.length,last_modified:lm,last_modified_usable:usable,etag_present:etag,issues};
}

/**
 * Facts the weekly check measured in the file go back into the search documents (public/mcp/d), so search and filters see them:
 * the years the data covers, when the publisher declares no period. Marked ym:1 (measured), never overwriting a declared period.
 */
export function backfillDocs(docs,cards){
  let n=0;
  for(const d of docs){
    const c=d&&cards.get(d.id),t=c?.coverage?.time;if(!t||d.y)continue;
    const a=Number(String(t.from||"").slice(0,4)),b=Number(String(t.to||"").slice(0,4));
    if(!(a>1800&&b>=a&&b<2101))continue;
    d.y=[a,b];d.ym=1;n++;
  }
  return n;
}
function backfillIndex(cards){
  const dir=path.join(pub,"mcp","d");let n=0;const all=[];
  for(const f of fs.readdirSync(dir).filter(f=>/^\d+\.json$/.test(f)).sort((a,b)=>parseInt(a)-parseInt(b))){
    const file=path.join(dir,f),docs=JSON.parse(fs.readFileSync(file,"utf8")),k=backfillDocs(docs,cards);
    if(k){fs.writeFileSync(file,JSON.stringify(docs));n+=k}
    all.push(...docs);
  }
  // the search filter facets follow the documents
  fs.writeFileSync(path.join(pub,"mcp","f.json"),JSON.stringify(facetsOf(all)));
  return n;
}

/** Whole-file profiles win over the probe's partial read of the same URL. */
export function mergeFull(probe,full){
  const out=new Map(probe);
  for(const [url,r] of full)if(r.profile?.rows_exact)out.set(url,r);
  return out;
}

function main(){
  const full=loadProfiles(fullFile),current=mergeFull(loadProfiles(probeFile),full);
  if(!current.size){console.log("[cards] no column profiles in "+probeFile+" or "+fullFile+"; nothing to build");return}
  const records=loadRecords(),cards=buildCards(records,current,loadProfiles(prevFile));
  fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
  const shards=new Map();
  for(const [id,card] of cards){const k=idShard(id);if(!shards.has(k))shards.set(k,{});shards.get(k)[id]=card}
  for(const [k,s] of shards)fs.writeFileSync(path.join(out,k+".json"),JSON.stringify(s));
  const all=[...cards.values()],count=f=>all.filter(f).length;
  const keyKinds={};for(const c of all)for(const k of c.coverage.keys)keyKinds[k.kind]=(keyKinds[k.kind]||0)+1;
  const summary={built:new Date().toISOString().slice(0,10),cards:all.length,
    freshness:{current:count(c=>c.freshness.status==="current"),overdue:count(c=>c.freshness.status==="overdue"),unknown:count(c=>c.freshness.status==="unknown")},
    whole_file:count(c=>c.file.rows_exact),with_duplicate_rows:count(c=>c.quality.duplicate_rows>0),
    // how far the change dates publishers state can be trusted, from whole-file checks
    change_headers:headerSummary(all.filter(c=>c.file.headers)),
    catalogue_date_not_in_file:count(c=>c.freshness.metadata_date_not_reflected_in_file),
    row_order_unstable:count(c=>c.quality.row_order_unstable),
    with_change_seen:count(c=>c.last_change_seen),
    with_time_coverage:count(c=>c.coverage.time),join_keys:keyKinds,schema_changed:count(c=>c.schema.changed_since),
    cadence_not_met:count(c=>c.freshness.cadence_not_met),
    period_read_from_file:backfillIndex(cards)};
  // publisher scorecards from every full-check result, readable or not (scripts/health.mjs)
  if(fs.existsSync(fullFile)){
    const checks=fs.readFileSync(fullFile,"utf8").split("\n").flatMap(l=>{try{return[JSON.parse(l)]}catch{return[]}});
    const sc=buildScorecards(checks,records);
    fs.writeFileSync(path.join(out,"publishers.json"),JSON.stringify(sc));
    summary.publisher_health={...sc.totals,publishers:sc.publishers.length,details:"/cards/publishers.json"};
  }
  fs.writeFileSync(path.join(out,"summary.json"),JSON.stringify(summary));
  console.log("[cards] "+all.length+" dataset cards in "+shards.size+" shards; "+JSON.stringify(summary.freshness)+"; keys "+JSON.stringify(keyKinds)+"; schema changed "+summary.schema_changed);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
