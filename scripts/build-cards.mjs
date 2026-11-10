// Build dataset cards (scripts/dataset-card.mjs) from the weekly link probe's column profiles.
//   node scripts/build-cards.mjs [--probe .cache/link-probe.jsonl] [--previous .cache/link-probe-prev.jsonl]
// Writes public/cards/<shard>.json ({id: card}, sharded like the MCP id index) and public/cards/summary.json. The previous probe,
// when present, gives schema drift ("columns changed since ..."). A no-op without a probe file, so local builds keep working.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCard } from "./dataset-card.mjs";
import { pickTabularDistribution } from "./tabular-profile.mjs";
import { idShard } from "../mcp-server.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),pub=path.join(root,"public"),out=path.join(pub,"cards");
const arg=(name,def)=>{const i=process.argv.indexOf("--"+name);return path.resolve(i>=0?process.argv[i+1]:def)};
const probeFile=arg("probe",path.join(root,".cache/link-probe.jsonl")),prevFile=arg("previous",path.join(root,".cache/link-probe-prev.jsonl"));

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
function loadRecords(){
  const dir=path.join(pub,"mcp"),items=[];
  if(!fs.existsSync(path.join(dir,"manifest.json")))throw new Error("public/mcp is missing: run scripts/build-mcp-index.mjs first");
  const docs=[],details=[];
  const chunks=sub=>fs.readdirSync(path.join(dir,sub)).filter(f=>/^\d+\.json$/.test(f)).sort((a,b)=>parseInt(a)-parseInt(b));
  for(const f of chunks("d"))docs.push(...JSON.parse(fs.readFileSync(path.join(dir,"d",f),"utf8")));
  for(const f of chunks("x"))details.push(...JSON.parse(fs.readFileSync(path.join(dir,"x",f),"utf8")));
  docs.forEach((d,i)=>{const x=details[i]||{};items.push({id:d.id,updatedAt:d.u||null,frequency:x.fq||"",distributions:(x.files||[]).map(f=>({url:f.u,format:f.f}))})});
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
      file:{url:d.url,format:d.format||p.fmt,bytesRead:p.bytes,totalBytes:p.total,lastModified:p.lastModified}}));
  }
  return cards;
}

function main(){
  const current=loadProfiles(probeFile);
  if(!current.size){console.log("[cards] no column profiles in "+probeFile+"; nothing to build");return}
  const cards=buildCards(loadRecords(),current,loadProfiles(prevFile));
  fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
  const shards=new Map();
  for(const [id,card] of cards){const k=idShard(id);if(!shards.has(k))shards.set(k,{});shards.get(k)[id]=card}
  for(const [k,s] of shards)fs.writeFileSync(path.join(out,k+".json"),JSON.stringify(s));
  const all=[...cards.values()],count=f=>all.filter(f).length;
  const keyKinds={};for(const c of all)for(const k of c.coverage.keys)keyKinds[k.kind]=(keyKinds[k.kind]||0)+1;
  const summary={built:new Date().toISOString().slice(0,10),cards:all.length,
    freshness:{current:count(c=>c.freshness.status==="current"),overdue:count(c=>c.freshness.status==="overdue"),unknown:count(c=>c.freshness.status==="unknown")},
    with_time_coverage:count(c=>c.coverage.time),join_keys:keyKinds,schema_changed:count(c=>c.schema.changed_since)};
  fs.writeFileSync(path.join(out,"summary.json"),JSON.stringify(summary));
  console.log("[cards] "+all.length+" dataset cards in "+shards.size+" shards; "+JSON.stringify(summary.freshness)+"; keys "+JSON.stringify(keyKinds)+"; schema changed "+summary.schema_changed);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
