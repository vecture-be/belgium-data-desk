// Pure catalogue-curation helpers shared by the harvest, the index builder and tests.
// Everything here is deterministic metadata interpretation: nothing fetches, nothing guesses beyond the stated rules.
import { createHash } from "node:crypto";
import { KIND_LABELS, TOPIC_LABELS, topicOf } from "../public/dataset-taxonomy-v1.mjs";
export { KIND_LABELS, TOPIC_LABELS, topicOf };
const clean=s=>String(s??"").replace(/\s+/g," ").trim();
const norm=s=>String(s??"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase();

import { LICENSE_FAMILY_NOTE, normalizeLicense } from "../public/dataset-licence-v1.mjs";
export { LICENSE_FAMILY_NOTE, normalizeLicense };

/* ---------- places ---------- */
const PLACES={
  "geonames:2802361":["Belgium","belgium"],"geonames:3337388":["Flanders","flanders"],"geonames:3337387":["Wallonia","wallonia"],
  "geonames:3337389":["Brussels-Capital Region","brussels"],"geonames:2800867":["Brussels-Capital","brussels"],
  "geonames:2797657":["Ghent","local"],"geonames:2803139":["Antwerp","local"],"geonames:2800935":["Bruges","local"],"geonames:2792483":["Leuven","local"],
  "geonames:3333250":["Flemish Brabant","province"],"geonames:2789733":["East Flanders","province"],"geonames:2796741":["Hainaut","province"],
  "geonames:2792347":["Limburg","province"],"geonames:2803136":["Antwerp Province","province"],
  "marine:3293":["Belgian North Sea (EEZ)","sea"],"marine:2550":["Belgian coast","sea"],"marine:4812":["Scheldt estuary","sea"],
  "marine:2350":["North Sea","sea"],"marine:22253":["Southern North Sea","sea"],"marine:2399":["Southern Bight","sea"],"marine:50155":["Greater North Sea","sea"]
};
export function resolveSpatial(uri){
  const u=clean(uri);let m;
  if((m=u.match(/geonames\.org\/(\d+)/i))){const hit=PLACES["geonames:"+m[1]];return hit?{label:hit[0],scope:hit[1]}:{label:"",scope:"local"}}
  if((m=u.match(/marineregions\.org\/mrgid\/(\d+)/i))){const hit=PLACES["marine:"+m[1]];return hit?{label:hit[0],scope:hit[1]}:{label:"",scope:"sea"}}
  return{label:"",scope:""};
}

/* ---------- themes ---------- */
export const EU_THEMES={
  AGRI:"Agriculture & food",ECON:"Economy & business",EDUC:"Education, culture & sport",ENER:"Energy",ENVI:"Environment & climate",GOVE:"Government & public sector",
  HEAL:"Health",INTR:"International",JUST:"Justice & public safety",REGI:"Regions, cities & maps",SOCI:"Population & society",TECH:"Science & technology",TRAN:"Transport & mobility"
};

/* ---------- formats / kinds / tiers ---------- */
const TABULAR=new Set(["CSV","TSV","JSON","JSONL","XLSX","XLS","Parquet","GeoJSON","ODS"]);
const SERVICE=new Set(["WMS","WFS","WCS","WMTS","KML","OGC API Features","OGC API","Esri REST","Explore API 2.1","REST/JSON"]);
const DOCUMENT=new Set(["PDF","HTML","DOC","DOCX","TXT"]);
const DATAFILE=new Set(["ZIP","GZIP","GML","Shapefile","GeoPackage","GEOTIFF","XML","RDF","Turtle RDF","JSON LD","N3","DWCA","NetCDF","BIN","Other"]);
export const formatClass=f=>TABULAR.has(f)?"tabular":SERVICE.has(f)?"service":DOCUMENT.has(f)?"document":DATAFILE.has(f)?"file":"file";
const RESEARCH_TITLE=/^(replication (data|code)|supplementary|supplement(al)? (data|material)|data (for|from) (the )?(paper|article|study)|dataset (for|of) (the )?(paper|article|thesis)|raw data (for|of)|code (and data )?for)/i;
export function kindOf(item){
  const dists=item.distributions||[];
  if(!dists.length)return"metadata-only";
  if(/^national:doi:/i.test(item.id||"")||RESEARCH_TITLE.test(clean(item.title)))return"research";
  const classes=new Set(dists.map(d=>formatClass(d.format)));
  if(classes.size===1&&classes.has("document"))return"publication";
  if([...classes].every(c=>c==="service"||c==="document")&&classes.has("service")){
    return"map-service";
  }
  return"dataset";
}

// Tier answers: "what can I actually do with this right now?"  Only the probe can earn READY.
export function accessTier(item,health={}){
  const dists=item.distributions||[];
  if(!dists.length)return"metadata";
  const tab=dists.filter(d=>formatClass(d.format)==="tabular");
  if(tab.some(d=>health[d.url]?.ok&&health[d.url]?.formatMatch!==false))return"ready";
  if(tab.length)return health&&tab.every(d=>health[d.url]&&!health[d.url].ok)?"broken":"download";
  if(dists.some(d=>formatClass(d.format)==="file"))return"download";
  if(dists.some(d=>formatClass(d.format)==="service"))return"service";
  return"document";
}
export const TIER_LABELS={ready:"Ready to use",download:"Data download",service:"Map / service",document:"Document",metadata:"Metadata only",broken:"Link broken"};
export const TIER_RANK={ready:5,download:4,service:3,document:2,metadata:1,broken:0};

/* ---------- series / collections ---------- */
const STOP=new Set(["the","de","het","een","van","voor","en","et","du","des","le","la","les","of","and","for","in","op","au","aux","par","sur"]);
// Model-code prefixes such as G3Dv3.1 / H3Dv2 / H3O mark layers of one model, so they share a family across releases.
const CODE_PREFIX=/^([a-z]\d[a-z])[a-z0-9.]*[\s,:-]/i;
export function seriesTemplate(title){
  const t=clean(title),code=t.match(CODE_PREFIX);
  if(code)return"code "+code[1].toLowerCase();
  const toks=norm(t).replace(/[^\p{L}\p{N} ]+/gu," ").split(/\s+/).filter(w=>w.length>1&&!/\d/.test(w)&&!STOP.has(w));
  return toks.slice(0,4).join(" ");
}
function readableSeriesTitle(sample,template){
  if(template.startsWith("code "))return clean(sample.title).match(CODE_PREFIX)[1].toUpperCase()+" model layers";
  const words=clean(sample.title).split(" ").filter(w=>!/\d/.test(w)).join(" ").split(" ").slice(0,7).join(" ").replace(/[,:;(-]+$/,"");
  return words||clean(sample.title);
}
export function detectSeries(items,{minMembers=5}={}){
  const groups=new Map();
  for(const item of items){
    const t=seriesTemplate(item.title);if(!t)continue;
    const key=norm(item.provider)+"|"+t;(groups.get(key)||groups.set(key,[]).get(key)).push(item);
  }
  const series=[];
  for(const [key,members] of groups){
    const template=key.split("|")[1],single=!template.startsWith("code ")&&template.split(" ").length<2;
    // A lone distinctive word only counts as a series when it is a numbered periodical ("Weekbericht 3078").
    if(members.length<(single?Math.max(10,minMembers):minMembers)||(single&&members.filter(m=>/\d/.test(m.title)).length<members.length*0.8))continue;
    const years=members.flatMap(m=>(String(m.title).match(/\b(?:19|20)\d{2}\b/g)||[]).map(Number));
    const sample=members.slice().sort((a,b)=>String(a.title).length-String(b.title).length)[0];
    series.push({key,id:"series:"+key.replace(/[^a-z0-9]+/g,"-").slice(0,70)+"-"+createHash("sha1").update(key).digest("hex").slice(0,6),provider:members[0].provider,title:readableSeriesTitle(sample,template),count:members.length,
      yearMin:years.length?Math.min(...years):null,yearMax:years.length?Math.max(...years):null,memberIds:members.map(m=>m.id)});
  }
  return series.sort((a,b)=>b.count-a.count);
}

import { freshness, summarizeChecks, trustChecks } from "../public/dataset-trust-v1.mjs";
export { freshness, summarizeChecks, trustChecks };

/* ---------- link-probe interpretation ---------- */
const SNIFF_OK={CSV:["delimited"],TSV:["delimited"],JSON:["json"],GeoJSON:["json"],XLSX:["zip/xlsx"],XLS:["ole/xls","xml","zip/xlsx"],Parquet:["parquet"],XML:["xml"]};
export function interpretProbe(p){
  const ok=!p.error&&p.status>=200&&p.status<300;
  const expected=SNIFF_OK[p.fmt];
  return{ok,status:p.status||null,error:p.error||null,formatMatch:ok&&expected?expected.includes(p.sniff):null,sniff:p.sniff||null,total:p.total??null,cors:!!p.cors,range:!!p.range,lastModified:p.lastModified||null};
}
/** Whether a probe result says something about the link itself, not about where the probe ran. A success, a definitive "gone"
 *  (404, 410), a host that does not exist or a malformed URL are conclusive. Timeouts, refused or reset connections, 401/403/429
 *  and 5xx are not: some Belgian government hosts block or slow down foreign or cloud IP ranges, and a link that answers from
 *  Belgium must not be labelled broken because the probe ran in a US data centre. Inconclusive results are left out of health. */
const GONE=new Set([404,410]),NO_HOST=new Set(["ENOTFOUND","ERR_INVALID_URL","ERR_TLS_CERT_ALTNAME_INVALID","CERT_HAS_EXPIRED"]);
export function probeIsConclusive(p){
  if(!p.error&&p.status>=200&&p.status<300)return true;
  if(p.error)return NO_HOST.has(p.error);
  return GONE.has(p.status);
}
