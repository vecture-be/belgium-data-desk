// Build the static search shards served by the MCP endpoint (mcp-server.mjs).
//   node scripts/build-mcp-index.mjs            (run after harvest + apply-link-health)
// Output (public/mcp/): manifest.json, d/<n>.json light documents (search results), x/<n>.json detail documents (get_dataset),
// t/<xx>.json token postings, i/<hh>.json id -> document index.
// Documents are ordered by scope (datasets, maps, publications, research, metadata) and then by evidence rank, so a scope is a
// contiguous index range and the best-evidenced records come first. Hand-curated assets outrank everything else.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mergeDiscoveredAssets } from "../public/dataset-discovery-v1.mjs";
import { SCOPES, enviOverride, scopeCounts, scopeOf, TOPIC_LABELS, topicOf } from "../public/dataset-taxonomy-v1.mjs";
import { normalizeLicense } from "../public/dataset-licence-v1.mjs";
import { AUTHORITIES } from "../public/dataset-authority-v1.mjs";
import { DETAIL_CHUNK, DOC_CHUNK, idShard, prefixKey, tokenShard, tokenize } from "../mcp-server.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url)),pub=path.resolve(__dirname,"../public");
const clean=s=>String(s??"").replace(/\s+/g," ").trim();
const stripHtml=s=>{let t=String(s??"");for(let i=0;i<2;i++)t=t.replace(/&nbsp;/g," ").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&").replace(/<[^>]*>/g," ");return clean(t);};
const relayIdFor=url=>"f_"+createHash("sha256").update(url).digest("hex").slice(0,32);
/** Some catalogues declare a format as a vocabulary URI; show the last path segment. */
const formatLabel=f=>{const s=clean(f);return /^https?:\/\//i.test(s)?s.split(/[/#]/).filter(Boolean).pop()||s:s};

// The same de-duplication the browser applies, so the MCP index and the UI agree on what a "dataset" is.
export function mergeItems(national,harvested){
  const toAsset=(h,discovery)=>({id:h.id,depth:h.enrichment?.schemaOrigin==="publisher-schema"&&(h.fields||[]).length?"structured":"harvested",provider:h.provider,product:h.provider,title:h.title,
    datasetId:h.datasetId||h.id,sourceRecord:h.sourceRecord||null,evidence:[h.officialUrl].filter(Boolean),discovery,discoverySources:[discovery],license:h.license||"",themes:h.themes||[],
    distributions:(h.distributions||[]).map(x=>[x.name,x.format,"","",x.url||h.officialUrl])});
  const byId=new Map(),assets=[];
  for(const h of harvested){byId.set(h.id,h);assets.push(toAsset(h,"publisher"))}
  for(const h of national){byId.set(h.id,{...h,discovery:"data.gov.be"});assets.push(toAsset(h,"data.gov.be"))}
  // keep the ids merged into each record (aliases) so get_dataset still answers for them
  return mergeDiscoveredAssets(assets).map(a=>{const h=byId.get(a.id);return h&&a.aliases?.length?{...h,aliases:a.aliases}:h}).filter(Boolean);
}

/** Hand-reviewed atlas assets share the catalogue item shape so they are searchable too — they are the best-evidenced records. */
export function curatedToItems(assets,sources){
  const bySource=new Map(sources.map(s=>[s.id,s]));
  return assets.map(a=>{
    const s=bySource.get(a.sourceId)||{};
    const item={id:"curated:"+a.id,title:a.title,provider:s.org||s.name||a.product||"",description:[a.kind,a.grain,a.caveat].filter(Boolean).join(". "),dataKind:"dataset",
      license:"",officialUrl:a.evidence?.[0]||s.url||"",updatedAt:"",frequency:/^[a-z]+$/i.test(a.cadence||"")?String(a.cadence).toUpperCase():"",
      formats:[...new Set((a.distributions||[]).map(d=>d[1]).filter(Boolean))].slice(0,5),themes:s.topics||[],fields:(a.schema||[]).map(f=>({name:f[0]})),curated:true,
      distributions:(a.distributions||[]).filter(d=>/^https:/i.test(d[4]||"")).map(d=>({name:d[0],format:d[1],url:d[4]})),tier:"download"};
    // The source's topic list covers everything that publisher does (Statbel: population, economy, mobility...); judge the asset by its own title first.
    const own=topicOf({...item,themes:[]});
    item.topic=own!=="other"?own:topicOf(item);
    return item;
  });
}

const TIER_RANK={ready:5,download:4,service:3,document:2,metadata:1,broken:0};
const SCOPE_ORDER=Object.fromEntries(SCOPES.filter(s=>s.id!=="all").map((s,i)=>[s.id,i]));
const rankOf=it=>(5-SCOPE_ORDER[scopeOf(it)])*10000+(it.curated?5000:0)+(TIER_RANK[it.tier]??2)*100+(["open","open-sharealike"].includes(it.licenseFamily)?20:0)+((it.fields||[]).length?10:0)+(it.probe?.ok?5:0)+(it.description?2:0);

export function toDocs(it,relay){
  const lic=it.licenseFamily?{label:it.license,family:it.licenseFamily}:normalizeLicense(it.licenseUri||it.license);
  const desc=stripHtml(it.description),formats=(it.formats||[]).map(formatLabel).filter(Boolean).slice(0,5);
  const light={id:it.id,t:clean(it.title),p:clean(it.provider),k:it.dataKind||"dataset",tp:(!it.curated&&it.topic==="environment"&&enviOverride(it))||it.topic||topicOf(it),f:formats,l:lic.label||"",lf:lic.family||"unknown",
    u:(it.dataProcessedAt||it.updatedAt||"").slice(0,10),tier:it.tier||"",sid:it.seriesId||"",s:desc.slice(0,160),w:it.officialUrl||"",...(it.curated?{c:1}:{})};
  const seen=new Set();
  const files=(it.distributions||[]).filter(d=>d?.url&&/^https:/i.test(d.url)&&!seen.has(d.url)&&seen.add(d.url)).slice(0,4).map(d=>{
    const r=relayIdFor(d.url);
    return{f:formatLabel(d.format||""),u:d.url,...(d.byteSize?{s:d.byteSize}:{}),...(relay&&relay[r]?{r}:{})};
  });
  const detail={fq:it.frequency||"",g:it.geoCoverage||"",url:it.officialUrl||"",ce:it.contactEmail||"",cu:it.contactUrl||"",d:desc.slice(0,600),
    cols:(it.fields||[]).slice(0,30).map(f=>f.name||f.label).filter(Boolean),...(it.probe?{pr:it.probe}:{}),...(it.streamCheck?{sc:it.streamCheck}:{}),files};
  return{light,detail};
}

/** Records with the same publisher and title but no series are near-duplicates; give them a shared collection key so search shows one. */
function markSameTitle(items){
  const key=it=>(it.provider+"|"+it.title).normalize("NFKD").replace(/[^a-zA-Z0-9]+/g," ").trim().toLowerCase();
  const groups=new Map();
  for(const it of items)if(!it.seriesId){const k=key(it);(groups.get(k)||groups.set(k,[]).get(k)).push(it)}
  return items.map(it=>{
    if(it.seriesId)return it;
    const g=groups.get(key(it));
    return g&&g.length>1?{...it,seriesId:"same:"+createHash("sha1").update(key(it)).digest("hex").slice(0,10)}:it;
  });
}

export function buildIndex(rawItems,{relay=null}={}){
  const items=markSameTitle(rawItems);
  const ranked=items.slice().sort((a,b)=>rankOf(b)-rankOf(a)||String(a.title).localeCompare(String(b.title)));
  const built=ranked.map(it=>toDocs(it,relay)),docs=built.map(b=>b.light),details=built.map(b=>b.detail),postings=new Map(),ids=new Map();
  docs.forEach((d,i)=>{
    ids.set(d.id,i);for(const alias of ranked[i].aliases||[])if(!ids.has(alias))ids.set(alias,i);
    const toks=new Set([...tokenize(d.t,{cap:30}),...tokenize(d.p,{cap:6}),...tokenize(details[i].d.slice(0,240),{cap:20}),...tokenize(TOPIC_LABELS[d.tp]||"",{cap:4})]);
    for(const t of [...toks]){const pk=prefixKey(t);if(pk)toks.add(pk)}
    for(const t of toks){let l=postings.get(t);if(!l)postings.set(t,l=[]);l.push(i)}
  });
  // contiguous [start,end) range per scope, valid because documents are ordered by scope first
  const ranges={};let start=0;
  for(const s of SCOPES.filter(x=>x.id!=="all")){
    const n=ranked.filter(it=>scopeOf(it)===s.id).length;ranges[s.id]=[start,start+n];start+=n;
  }
  return{docs,details,postings,ids,ranges,ranked};
}

function writeJson(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj))}

export function writeIndex(outDir,{docs,details,postings,ids},meta){
  fs.rmSync(outDir,{recursive:true,force:true});
  for(let i=0;i*DOC_CHUNK<docs.length;i++)writeJson(path.join(outDir,"d",i+".json"),docs.slice(i*DOC_CHUNK,(i+1)*DOC_CHUNK));
  for(let i=0;i*DETAIL_CHUNK<details.length;i++)writeJson(path.join(outDir,"x",i+".json"),details.slice(i*DETAIL_CHUNK,(i+1)*DETAIL_CHUNK));
  const shards=new Map();
  for(const [t,l] of postings){const k=tokenShard(t);let s=shards.get(k);if(!s)shards.set(k,s={});s[t]=l}
  for(const [k,s] of shards)writeJson(path.join(outDir,"t",k+".json"),s);
  const idShards=new Map();
  for(const [id,i] of ids){const k=idShard(id);let s=idShards.get(k);if(!s)idShards.set(k,s={});s[id]=i}
  for(const [k,s] of idShards)writeJson(path.join(outDir,"i",k+".json"),s);
  writeJson(path.join(outDir,"manifest.json"),meta);
  return{docChunks:Math.ceil(docs.length/DOC_CHUNK),tokenShards:shards.size,idShards:idShards.size};
}

async function main(){
  const idx=path.join(pub,"national-catalog.json"),national=[];
  if(fs.existsSync(idx))for(const c of JSON.parse(fs.readFileSync(idx,"utf8")).chunks||[])national.push(...JSON.parse(fs.readFileSync(path.join(pub,c.file),"utf8")).items||[]);
  const hvPath=path.join(pub,"harvested-catalog.json"),hv=fs.existsSync(hvPath)?JSON.parse(fs.readFileSync(hvPath,"utf8")):{items:[]};
  if(!national.length&&!hv.items.length)throw new Error("no catalogue files in public/; run harvest first");
  const items=mergeItems(national,hv.items||[]);
  const [{ASSETS},{EXTRA_ATLAS_ASSETS},{COMPLETENESS_ASSETS},{COMPLETENESS_ASSETS_V2},{COMPLETENESS_ASSETS_V3},{COMPLETENESS_ASSETS_V4},{SOURCES},{EXTRA_SOURCES}]=await Promise.all([
    import("../public/dataset-atlas-v1.mjs"),import("../public/dataset-atlas-extra-v1.mjs"),import("../public/dataset-atlas-completeness-v1.mjs"),import("../public/dataset-atlas-completeness-v2.mjs"),
    import("../public/dataset-atlas-completeness-v3.mjs"),import("../public/dataset-atlas-completeness-v4.mjs"),import("../public/data.mjs"),import("../public/deep-data.mjs")]);
  const curated=curatedToItems([...ASSETS,...EXTRA_ATLAS_ASSETS,...COMPLETENESS_ASSETS,...COMPLETENESS_ASSETS_V2,...COMPLETENESS_ASSETS_V3,...COMPLETENESS_ASSETS_V4],[...SOURCES,...EXTRA_SOURCES]);
  items.push(...curated);
  const {RELAY_INDEX}=await import("../relay-index.mjs");
  const built=buildIndex(items,{relay:RELAY_INDEX});
  const counts=scopeCounts(items),topics={};
  for(const d of built.docs)if((d.k||"dataset")==="dataset")topics[d.tp]=(topics[d.tp]||0)+1;
  const indexJson=fs.existsSync(idx)?JSON.parse(fs.readFileSync(idx,"utf8")):{};
  const meta={server:"belgium-open-data",catalogue_built:hv.generatedAt||indexJson.generatedAt||null,records:built.docs.length,curated_records:curated.length,ranges:built.ranges,
    scopes:Object.fromEntries(SCOPES.map(s=>[s.id,{label:s.label,hint:s.hint,count:counts[s.id]||0}])),
    dataset_topics:Object.fromEntries(Object.entries(topics).sort((a,b)=>b[1]-a[1]).map(([id,n])=>[id,{label:TOPIC_LABELS[id],count:n}])),
    links_last_checked:indexJson.linkHealth?.at||hv.linkHealth?.at||null,
    // positions of the records search pins for common needs (public/dataset-authority-v1.mjs), so pinning costs no id-shard reads
    pins:Object.fromEntries(AUTHORITIES.flatMap(a=>a.ids).filter(id=>built.ids.has(id)).map(id=>[id,built.ids.get(id)])),
    tiers:Object.fromEntries(["ready","download","service","document","metadata","broken"].map(t=>[t,built.docs.filter(d=>d.tier===t).length]))};
  const stats=writeIndex(path.join(pub,"mcp"),built,meta);
  const bytes=fs.readdirSync(path.join(pub,"mcp"),{recursive:true}).reduce((n,f)=>{const p=path.join(pub,"mcp",f);return n+(fs.statSync(p).isFile()?fs.statSync(p).size:0)},0);
  console.log("[mcp-index] "+built.docs.length+" records ("+curated.length+" curated), "+stats.docChunks+" doc chunks, "+stats.tokenShards+" token shards, "+stats.idShards+" id shards, "+(bytes/1048576).toFixed(1)+" MiB");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
