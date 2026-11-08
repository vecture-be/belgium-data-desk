// Polite link + format probe for catalogue distributions.
//   node scripts/probe-links.mjs [--out .cache/link-probe.jsonl] [--limit 500] [--formats CSV,TSV,...]
// Reads the harvested catalogue from public/, fetches only the first 32 KiB of each file (Range GET), and records
// whether the link answers, what the bytes look like, and which browser-relevant headers it sends.
// Resumable: URLs already present in --out are skipped. Intended for the self-hosted runner or a laptop, never a Worker.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { interpretProbe } from "./curate.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url)),pub=path.resolve(__dirname,"../public");
const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,all)=>x.startsWith("--")?[...a,[x.slice(2),all[i+1]&&!all[i+1].startsWith("--")?all[i+1]:"1"]]:a,[]));
const outFile=path.resolve(args.out||path.join(__dirname,"../.cache/link-probe.jsonl")),limit=Number(args.limit||0);
const FORMATS=new Set((args.formats||"CSV,TSV,JSON,GeoJSON,XLSX,XLS,Parquet,XML").split(","));
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
function loadWork(){
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
  return [...seen.values()];
}
async function probe(w){
  const t0=Date.now(),r={url:w.url,fmt:w.fmt,ds:w.ds,prov:w.prov};
  try{
    const res=await fetch(w.url,{headers:{range:"bytes=0-32767","user-agent":UA,accept:"*/*"},redirect:"follow",signal:AbortSignal.timeout(20000)});
    r.status=res.status;r.finalHost=new URL(res.url).host;
    r.ct=(res.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
    const cr=res.headers.get("content-range"),cl=res.headers.get("content-length");
    r.total=cr?Number(cr.split("/")[1])||null:(res.status===200&&cl?Number(cl):null);
    r.range=res.status===206;r.lastModified=res.headers.get("last-modified")||null;r.cors=res.headers.get("access-control-allow-origin")||null;
    const reader=res.body.getReader(),chunks=[];let n=0;
    while(n<32768){const {done,value}=await reader.read();if(done)break;chunks.push(value);n+=value.length}
    try{await reader.cancel()}catch{}
    const buf=Buffer.concat(chunks.map(c=>Buffer.from(c))).subarray(0,32768);r.bytes=buf.length;r.sniff=sniff(buf);
    if(r.sniff==="delimited"){
      const first=buf.toString("utf8").split(/\r?\n/).filter(Boolean)[0]||"";
      const best=[",",";","\t","|"].map(d=>[d,first.split(d).length]).sort((a,b)=>b[1]-a[1])[0];r.delim=best[0];r.cols=best[1];
    }
  }catch(e){r.error=String(e.cause?.code||e.name||"error")}
  r.ms=Date.now()-t0;r.checkedAt=new Date().toISOString();return r;
}
async function main(){
  fs.mkdirSync(path.dirname(outFile),{recursive:true});
  const done=new Set();
  if(fs.existsSync(outFile))for(const l of fs.readFileSync(outFile,"utf8").split("\n")){try{done.add(JSON.parse(l).url)}catch{}}
  let work=loadWork().filter(w=>!done.has(w.url));
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
