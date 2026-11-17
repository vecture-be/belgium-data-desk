// Polite link + format probe for catalogue distributions.
//   node scripts/probe-links.mjs [--out .cache/link-probe.jsonl] [--limit 500] [--formats CSV,TSV,...] [--curated-only]
// Reads the harvested catalogue from public/, fetches the first 32 KiB of each file (256 KiB for CSV/TSV, which also yields the column profile behind the dataset
// cards, scripts/dataset-card.mjs) with a Range GET, and records
// whether the link answers, what the bytes look like, and which browser-relevant headers it sends.
// Resumable: URLs already present in --out are skipped. Intended for the self-hosted runner or a laptop, never a Worker.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { interpretProbe } from "./curate.mjs";
import { encodingFor } from "./tabular-profile.mjs";
import { profileColumns, setNisReference } from "./dataset-card.mjs";
import { loadCuratedItems } from "./build-mcp-index.mjs";
import { canonicalFormat } from "./national-dcat.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url)),pub=path.resolve(__dirname,"../public");
const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,all)=>x.startsWith("--")?[...a,[x.slice(2),all[i+1]&&!all[i+1].startsWith("--")?all[i+1]:"1"]]:a,[]));
const outFile=path.resolve(args.out||path.join(__dirname,"../.cache/link-probe.jsonl")),limit=Number(args.limit||0);
const FORMATS=new Set((args.formats||"CSV,TSV,JSON,GeoJSON,XLSX,XLS,Parquet,XML,LDES").split(","));
const UA="Belgium-Data-Desk-QA/1.0 (+https://data.vecture.be)";

export function sniff(buf){
  const head=Buffer.from(buf.subarray(0,16)),text=Buffer.from(buf.subarray(0,2048)).toString("utf8"),lead=text.trimStart().slice(0,300).toLowerCase();
  if(head[0]===0x50&&head[1]===0x4b)return"zip/xlsx";
  if(head.subarray(0,4).toString()==="PAR1")return"parquet";
  if(head[0]===0xd0&&head[1]===0xcf)return"ole/xls";
  if(/^<!doctype html|^<html|<head|<body/.test(lead))return"html";
  if(/^<\?xml|^<[a-z]/.test(lead))return"xml";
  if(/^[[{]/.test(lead))return"json";
  if(/^%pdf/.test(lead))return"pdf";
  if(text.includes("\n")&&/[,;\t|]/.test(text.split("\n")[0]))return"delimited";
  return"text/other";
}
// Hand-reviewed links are often landing pages or APIs rather than files: those are checked for answering only (format "PAGE").
// A declared format counts only when the URL is a file (extension or download/format parameter): the atlas lists landing pages
// such as ".../fietstellingen/index.html" under "CSV", and their HTML is not a format mismatch.
const FILE_URL=/\.(csv|tsv|json|geojson|xlsx?|zip|parquet|xml)(\?|$)|[?&](format|f|outputformat)=|\/download\b|@@download/i;
export const curatedFormat=(f,url)=>{const c=canonicalFormat(f||"",url||"");return FORMATS.has(c)&&FILE_URL.test(url||"")?c:"PAGE"};
/** The URL to check for a hand-reviewed link: never an API template ("…/{objectId}"); an OGC service is asked for its capabilities. */
export function curatedProbeUrl(url){
  if(/[{}]/.test(url))return null;
  if(/\/(wfs|wms|wmts)\b|\/(MapServer|FeatureServer)\/(WFSServer|WMSServer)|\/geoserver\/[^?]*\/(wfs|wms)/i.test(url)&&!/[?&]request=/i.test(url)){
    const svc=/wms/i.test(url)&&!/wfs/i.test(url)?"WMS":"WFS";
    return url+(url.includes("?")?"&":"?")+"service="+svc+"&request=GetCapabilities";
  }
  return url;
}
export async function loadCuratedWork(){
  const out=[];
  for(const it of await loadCuratedItems())for(const d of it.distributions||[]){
    const u=d?.url&&/^https:\/\//i.test(d.url)?curatedProbeUrl(d.url):null;
    if(u)out.push({url:d.url,probeUrl:u,fmt:curatedFormat(d.format,d.url),ds:it.id,prov:it.provider});
  }
  return out;
}
async function loadWork(){
  const items=[];
  const idx=path.join(pub,"national-catalog.json");
  if(fs.existsSync(idx)){
    const index=JSON.parse(fs.readFileSync(idx,"utf8"));
    for(const c of index.chunks||[])items.push(...JSON.parse(fs.readFileSync(path.join(pub,c.file),"utf8")).items||[]);
  }
  const hv=path.join(pub,"harvested-catalog.json");
  if(fs.existsSync(hv))items.push(...(JSON.parse(fs.readFileSync(hv,"utf8")).items||[]));
  const seen=new Map();
  for(const it of items)for(const d of it.distributions||[]){
    if(!d?.url||!/^https:\/\//i.test(d.url)||!FORMATS.has(d.format)||seen.has(d.url))continue;
    seen.set(d.url,{url:d.url,fmt:d.format,ds:it.id,prov:it.provider});
  }
  for(const w of await loadCuratedWork())if(!seen.has(w.url))seen.set(w.url,w);
  return [...seen.values()];
}
// CSV/TSV files are read further (PROFILE_BYTES) so the same request also yields the column profile behind the dataset card.
const SNIFF_BYTES=32768,PROFILE_BYTES=256*1024;
const LDES_ACCEPT="application/ld+json, text/turtle;q=0.9, */*;q=0.1",LDES_TERMS=/w3id\.org\/(ldes|tree)|ldes#|\bldes:EventStream|"EventStream"|\btree:(relation|member|view|node|Node)/;
async function probe(w){
  const t0=Date.now(),r={url:w.url,fmt:w.fmt,ds:w.ds,prov:w.prov};
  // LDES pages can put their stream vocabulary after large JSON-LD contexts or members: read 128 KiB
  const want=w.fmt==="CSV"||w.fmt==="TSV"?PROFILE_BYTES:w.fmt==="LDES"?128*1024:SNIFF_BYTES;
  try{
    const res=await fetch(w.probeUrl||w.url,{headers:{range:"bytes=0-"+(want-1),"user-agent":UA,accept:w.fmt==="LDES"?LDES_ACCEPT:"*/*"},redirect:"follow",signal:AbortSignal.timeout(20000)});
    r.status=res.status;r.finalHost=new URL(res.url).host;
    r.ct=(res.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
    const cr=res.headers.get("content-range"),cl=res.headers.get("content-length");
    r.total=cr?Number(cr.split("/")[1])||null:(res.status===200&&cl?Number(cl):null);
    r.range=res.status===206;r.lastModified=res.headers.get("last-modified")||null;r.cors=res.headers.get("access-control-allow-origin")||null;
    const reader=res.body.getReader(),chunks=[];let n=0;
    while(n<want){const {done,value}=await reader.read();if(done)break;chunks.push(value);n+=value.length}
    try{await reader.cancel()}catch{}
    const buf=Buffer.concat(chunks.map(c=>Buffer.from(c))).subarray(0,want);r.bytes=buf.length;r.sniff=sniff(buf);
    // an LDES endpoint answers with a stream description: LDES or TREE vocabulary (https://w3id.org/ldes, https://w3id.org/tree)
    if(w.fmt==="LDES"&&LDES_TERMS.test(buf.toString("utf8")))r.sniff="ldes";
    if(r.sniff==="delimited"){
      const first=buf.toString("utf8").split(/\r?\n/).filter(Boolean)[0]||"";
      const best=[",",";","\t","|"].map(d=>[d,first.split(d).length]).sort((a,b)=>b[1]-a[1])[0];r.delim=best[0];r.cols=best[1];
      if(res.status>=200&&res.status<300)r.profile=profileFile(buf,r,w);
    }
  }catch(e){r.error=String(e.cause?.code||e.name||"error")}
  r.ms=Date.now()-t0;r.checkedAt=new Date().toISOString();return r;
}
function profileFile(buf,r,w){
  try{
    const {encoding,skip}=encodingFor(buf),text=new TextDecoder(encoding).decode(buf.subarray(skip));
    // the whole file was read when the server sent less than asked and no larger total
    const total=r.total||(buf.length<(w.fmt==="CSV"||w.fmt==="TSV"?PROFILE_BYTES:SNIFF_BYTES)?buf.length:null);
    return profileColumns(text,{url:w.url,format:w.fmt,bytesRead:buf.length,totalBytes:total});
  }catch(e){return{error:String(e.message||e).slice(0,120)}}
}
async function main(){
  fs.mkdirSync(path.dirname(outFile),{recursive:true});
  // municipality code list for NIS detection in column profiles (committed with the Statbel tables)
  setNisReference(JSON.parse(fs.readFileSync(path.join(pub,"statbel/places-v1.json"),"utf8")).places);
  const done=new Set();
  if(fs.existsSync(outFile))for(const l of fs.readFileSync(outFile,"utf8").split("\n")){try{done.add(JSON.parse(l).url)}catch{}}
  // --curated-only checks just the hand-reviewed links (a quick run after the atlas changes)
  let work=(args["curated-only"]?[...new Map((await loadCuratedWork()).map(w=>[w.url,w])).values()]:await loadWork()).filter(w=>!done.has(w.url));
  if(limit)work=work.slice(0,limit);
  const byHost=new Map();
  for(const w of work){let h="bad";try{h=new URL(w.url).host}catch{}(byHost.get(h)||byHost.set(h,[]).get(h)).push(w)}
  const out=fs.createWriteStream(outFile,{flags:"a"});let n=0;
  const lane=async q=>{while(q.length){const r=await probe(q.shift());out.write(JSON.stringify({...r,...interpretProbe(r),url:r.url,fmt:r.fmt})+"\n");if(++n%500===0)console.error(n+"/"+work.length)}};
  const lanes=[];for(const [,q] of byHost)for(let i=0;i<3;i++)lanes.push(lane(q));   // at most 3 concurrent requests per host
  await Promise.all(lanes);await new Promise(r=>out.end(r));
  console.log("probed "+n+" URLs -> "+outFile);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
