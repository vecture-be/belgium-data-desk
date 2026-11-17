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
import { canonicalPublisher, cityGeography, cleanFrequency, cleanPeriod, cutText, htmlToText, httpsLink, unifyPublisherNames, validUpdated } from "./metadata-clean.mjs";
import { normalizeLicense } from "../public/dataset-licence-v1.mjs";
import { AUTHORITIES } from "../public/dataset-authority-v1.mjs";
import { DETAIL_CHUNK, DOC_CHUNK, idShard, prefixKey, tokenShard, tokenize } from "../mcp-server.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url)),pub=path.resolve(__dirname,"../public");
const clean=s=>String(s??"").replace(/\s+/g," ").trim();
const relayIdFor=url=>"f_"+createHash("sha256").update(url).digest("hex").slice(0,32);
/** Some catalogues declare a format as a vocabulary URI; show the last path segment. */
// One label per format: ISO and DCAT records spell them "ESRI Shapefile (.shp)", "CSV CSV", "TIFF (.tif, .tiff)", "application/xml", "x c"…
const FORMAT_FIX=[
  [/shapefile|\.shp\b/i,"Shapefile"],[/geopackage|\.gpkg\b/i,"GeoPackage"],[/file ?geodatabase|\bfgdb\b|\.gdb\b/i,"File Geodatabase"],
  [/^geo ?tiff?\b|^tiff?\b|\(\.tiff?/i,"GEOTIFF"],[/^gml\b|\(\.gml\)/i,"GML"],[/comma.separated|^csv\b/i,"CSV"],[/^(application|text)\/xml$|^xml\b/i,"XML"],
  [/octet.?stream/i,"BIN"],[/^x[ -](c|tcl|python|r)$|^text\/x-/i,"Source code"],[/^(application\/)?zip\b/i,"ZIP"],[/^(application\/)?pdf\b/i,"PDF"],
  [/^geo ?json\b/i,"GeoJSON"],[/^(application\/)?json\b/i,"JSON"],[/^kml\b|\.kmz?\b/i,"KML"],[/^png\b|image\/png/i,"PNG"],[/^txt\b|text\/plain/i,"TXT"]
];
export function formatLabel(f){
  let s=clean(f);if(/^https?:\/\//i.test(s))s=s.split(/[/#]/).filter(Boolean).pop()||s;
  s=s.replace(/^(.+?)\s+\1$/i,"$1");   // "TIFF TIFF"
  for(const [re,label] of FORMAT_FIX)if(re.test(s))return label;
  return s;
}

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
      distributions:(a.distributions||[]).filter(d=>/^https:/i.test(d[4]||"")).map(d=>({name:d[0],format:d[1],url:d[4]})),tier:"download",
      temporal:curatedPeriod(a)};
    // The source's topic list covers everything that publisher does (Statbel: population, economy, mobility...); judge the asset by its own title first.
    const own=topicOf({...item,themes:[]});
    item.topic=own!=="other"?own:topicOf(item);
    return item;
  });
}

/**
 * The period a hand-reviewed asset covers, from its written time field ("reference year 2026", "2019–2026", "since 2019"),
 * else from a year in its title ("…, 2026", "— 2017–2024"). Years in the description are not used: they are often
 * reference or legal years ("index base 1920", "law of 2004").
 */
export function curatedPeriod(a){
  const parse=raw=>{
    // revision and metadata dates say when the record changed, not what the data covers
    const s=String(raw||"").replace(/(last )?revision[^;]*|metadata (updated|modified)[^;]*/gi," ");
    if(/\b(through|until|up to|tot en met|jusqu)\b/i.test(s)&&!/\b(from|since|vanaf|depuis)\b/i.test(s))return null;   // an end with no start
    const ys=(s.match(/\b(?:18|19|20)\d{2}\b/g)||[]).map(Number).filter(y=>y<=new Date().getUTCFullYear()+1);if(!ys.length)return null;
    if(/\bscenario|horizon|projection|forecast\b/i.test(s))return null;
    const lo=Math.min(...ys),hi=Math.max(...ys),open=/\b(since|from|vanaf|sinds|depuis|onwards|ongoing|to date|present|current|latest|live|real-?time)\b|[–-]\s*$/i.test(s);
    return{start:lo+"-01-01",end:open?null:hi+"-12-31"};
  };
  return parse(a?.time)||parse(String(a?.title||"").match(/(?:,|—|–|-|\bin\b)\s*((?:\d{1,2} \w+ )?(?:18|19|20)\d{2}(?:\s*[–-]\s*(?:18|19|20)\d{2})?)\s*\)?$/)?.[1])||null;
}

/** [firstYear, lastYear] of a declared period; an open end means "up to now". */
export function periodYears(t){
  const y=v=>{const m=String(v||"").match(/^(\d{4})/);return m?Number(m[1]):null};
  const a=y(t?.start),b=y(t?.end);
  if(a==null&&b==null)return null;
  return[a??b,b??new Date().getUTCFullYear()];
}

const TIER_RANK={ready:5,download:4,service:3,document:2,metadata:1,broken:0};
const SCOPE_ORDER=Object.fromEntries(SCOPES.filter(s=>s.id!=="all").map((s,i)=>[s.id,i]));
const rankOf=it=>(5-SCOPE_ORDER[scopeOf(it)])*10000+(it.curated?5000:0)+(TIER_RANK[it.tier]??2)*100+(["open","open-sharealike"].includes(it.licenseFamily)?20:0)+((it.fields||[]).length?10:0)+(it.probe?.ok?5:0)+(it.description?2:0)-(it.successor?1:0);   // a superseded model version ranks just below its peers

export function toDocs(it,relay){
  // One label per licence: harvested records keep the publisher's spelling ("Modellicentie Gratis Hergebruik", "CC0 1.0"); show the canonical one.
  const norm=normalizeLicense(it.licenseUri||it.license),lic=norm.raw?norm:{label:"",family:it.licenseFamily||"unknown"};
  const desc=htmlToText(it.description),formats=[...new Set((it.formats||[]).map(formatLabel).filter(Boolean))].slice(0,5);
  const tc=cleanPeriod(it.temporal),period=periodYears(tc);
  // a licence written out as a paragraph (geo.be, Metawal: ~220 records) is named as the publisher's own terms; the text stays in the detail
  const termsText=lic.id==="other"&&lic.raw&&!/^https?:\/\//i.test(lic.raw)&&lic.raw.length>60;
  const licLabel=termsText?"Publisher's own terms (see source)":lic.label||"";
  const light={id:it.id,t:clean(it.title),p:canonicalPublisher(it.provider),k:it.dataKind||"dataset",tp:(!it.curated&&it.topic==="environment"&&enviOverride(it))||it.topic||topicOf(it),f:formats,l:licLabel,lf:lic.family||"unknown",
    u:validUpdated(it.dataProcessedAt)||validUpdated(it.updatedAt),tier:it.tier||"",sid:it.seriesId||"",s:cutText(desc,160),w:httpsLink(it.officialUrl||""),...(it.curated?{c:1}:{}),
    // search filters: years the data covers (declared), languages, and access other than public
    ...(period?{y:period}:{}),...(it.languages?.length?{lg:it.languages.slice(0,4)}:{}),...(it.accessRights&&it.accessRights!=="PUBLIC"?{ar:it.accessRights}:{})};
  const seen=new Set();
  const files=(it.distributions||[]).filter(d=>d?.url&&/^https:/i.test(d.url)&&!seen.has(d.url)&&seen.add(d.url)).slice(0,4).map(d=>{
    const r=relayIdFor(d.url);
    return{f:formatLabel(d.format||""),u:d.url,...(d.byteSize?{s:d.byteSize}:{}),...(relay&&relay[r]?{r}:{})};
  });
  const detail={fq:cleanFrequency(it.frequency),g:cityGeography(it.provider,it.geoCoverage),url:httpsLink(it.officialUrl||""),ce:it.contactEmail||"",cu:it.contactUrl||"",d:cutText(desc,600),
    ...(termsText?{lt:cutText(lic.raw,400)}:{}),
    cols:(it.fields||[]).slice(0,30).map(f=>f.name||f.label).filter(Boolean),...(it.licenseFrom?{lsrc:it.licenseFrom}:{}),...(it.licenseShare?{lshare:it.licenseShare}:{}),
    ...(tc?{tc:{s:tc.start||null,e:tc.end||null,...(tc.plannedEnd?{pe:tc.plannedEnd}:{})}}:{}),...(it.languages?.length?{lang:it.languages}:{}),
    ...(it.accessRights?{ar:it.accessRights}:{}),...(it.provenance?{prov:cutText(htmlToText(it.provenance),400)}:{}),...(it.crs?.length?{crs:it.crs}:{}),
    ...(it.spatialResolutionM?{res:it.spatialResolutionM}:{}),...(it.hvdCategories?.length?{hvd:it.hvdCategories}:{}),...(it.standards?.length?{std:it.standards.slice(0,4)}:{}),
    ...(it.contactName?{cn:clean(it.contactName).slice(0,120)}:{}),...(it.publisherInferredFrom?{pinf:it.publisherInferredFrom}:{}),
    ...(it.issuedAt?{iss:it.issuedAt}:{}),...(it.probe?{pr:it.probe}:{}),...(it.streamCheck?{sc:it.streamCheck}:{}),files};
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

/** Hand-reviewed records carry no licence of their own; when a harvested record points at the same landing page or file, its licence
 *  is the publisher's, so the curated record shows it too (with where it came from). */
const pubKey=s=>String(s||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
/** The catalogue's name for a hand-reviewed asset's publisher ("Statbel, Belgian statistical office" -> "Statbel"), when one clearly matches. */
export function catalogueNameFor(name,names){
  const k=pubKey(name);if(!k)return"";
  let best="";
  for(const n of names){const nk=pubKey(n);if(nk.length>=4&&(k===nk||k.startsWith(nk+" "))&&nk.length>pubKey(best).length)best=n}
  return best;
}
/**
 * Hand-reviewed assets carry no licence of their own. Take it from a catalogue record of the SAME publisher that links the same page or file,
 * else from what that publisher states on nearly all its records (>= 90 % of >= 20 records). A record of another catalogue that happens to
 * link the page (a geo.be record of a Statbel table said "open-data") is not evidence of the publisher's licence.
 */
export function inheritCuratedLicences(items){
  const key=u=>{try{const p=new URL(u);return(p.host+p.pathname).replace(/\/+$/,"").toLowerCase()}catch{return""}};
  const known=x=>{const f=x.licenseFamily||normalizeLicense(x.licenseUri||x.license).family;return f&&f!=="unknown"};
  const byUrl=new Map(),byPublisher=new Map(),names=new Set();
  for(const x of items){
    if(x.curated)continue;
    names.add(x.provider);
    if(!(x.license||x.licenseUri)||!known(x))continue;
    for(const u of [x.officialUrl,...(x.distributions||[]).map(d=>d?.url)])if(key(u))(byUrl.get(key(u))||byUrl.set(key(u),[]).get(key(u))).push(x);
    const lab=normalizeLicense(x.licenseUri||x.license).label;
    const m=byPublisher.get(x.provider)||byPublisher.set(x.provider,new Map()).get(x.provider);m.set(lab,(m.get(lab)||[]).concat(x));
  }
  let total=new Map();for(const x of items)if(!x.curated)total.set(x.provider,(total.get(x.provider)||0)+1);
  return items.map(x=>{
    if(!x.curated||x.license)return x;
    const pub=catalogueNameFor(x.provider,names);
    const sameUrl=[x.officialUrl,...(x.distributions||[]).map(d=>d?.url)].map(key).filter(Boolean).flatMap(k=>byUrl.get(k)||[]);
    const m=sameUrl.find(r=>pub&&r.provider===pub);
    if(m)return{...x,license:m.license||"",licenseUri:m.licenseUri||"",licenseFamily:m.licenseFamily||"",licenseFrom:m.id};
    if(pub&&byPublisher.has(pub)){
      const [lab,recs]=[...byPublisher.get(pub)].sort((a,b)=>b[1].length-a[1].length)[0];
      const n=total.get(pub)||0;
      if(recs.length>=20&&recs.length>=0.9*n){const r=recs[0];return{...x,license:r.license||lab,licenseUri:r.licenseUri||"",licenseFamily:r.licenseFamily||"",licenseFrom:"publisher:"+pub,licenseShare:Math.round(100*recs.length/n)}}
    }
    return x;
  });
}

export function buildIndex(rawItems,{relay=null}={}){
  const items=markSameTitle(inheritCuratedLicences(rawItems));
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

/**
 * Per-record filter facets in index order (public/mcp/f.json): years covered ([first,last] or 0) and languages (bits nl=1 fr=2 en=4 de=8).
 * One small file lets search filter every candidate before it picks which documents to read.
 */
export const LANG_BITS={nl:1,fr:2,en:4,de:8};
export const facetsOf=docs=>({y:docs.map(d=>d.y||0),lg:docs.map(d=>(d.lg||[]).reduce((b,l)=>b|(LANG_BITS[l]||0),0))});
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
  writeJson(path.join(outDir,"f.json"),facetsOf(docs));
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
  // one spelling per publisher across all sources (national, portals, curated)
  for(const it of items)it.provider=canonicalPublisher(it.provider);
  unifyPublisherNames(items);
  // hand-reviewed assets name their publisher as the catalogue does ("Statbel, Belgian statistical office" -> "Statbel")
  const catalogueNames=new Set(items.filter(x=>!x.curated).map(x=>x.provider));
  for(const it of items)if(it.curated)it.provider=catalogueNameFor(it.provider,catalogueNames)||it.provider;
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
  // The website renders hand-reviewed assets from the atlas modules; give it the facts the index adds (licence, period, publisher name).
  const facts={};
  for(const it of built.ranked)if(it.curated)facts[it.id.replace(/^curated:/,"")]={publisher:it.provider,
    ...(it.license?{license:normalizeLicense(it.licenseUri||it.license).label||it.license,licenseFamily:normalizeLicense(it.licenseUri||it.license).family,licenseFrom:it.licenseFrom||"",...(it.licenseShare?{licenseShare:it.licenseShare}:{})}:{}),
    ...(it.temporal?{period:it.temporal}:{})};
  fs.writeFileSync(path.join(pub,"curated-facts.json"),JSON.stringify(facts));
  const bytes=fs.readdirSync(path.join(pub,"mcp"),{recursive:true}).reduce((n,f)=>{const p=path.join(pub,"mcp",f);return n+(fs.statSync(p).isFile()?fs.statSync(p).size:0)},0);
  console.log("[mcp-index] "+built.docs.length+" records ("+curated.length+" curated), "+stats.docChunks+" doc chunks, "+stats.tokenShards+" token shards, "+stats.idShards+" id shards, "+(bytes/1048576).toFixed(1)+" MiB");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
