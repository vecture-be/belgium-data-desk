// Merge link-probe results (scripts/probe-links.mjs) into the built catalogue files.
//   node scripts/apply-link-health.mjs [--probe .cache/link-probe.jsonl]
// Idempotent and a no-op when no probe file exists. Only a successful probe can earn the READY tier.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { accessTier, interpretProbe, probeIsConclusive } from "./curate.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url)),pub=path.resolve(__dirname,"../public");

export function loadProbes(file){
  const byUrl=new Map();let newest="";
  if(!fs.existsSync(file))return{byUrl,at:""};
  for(const line of fs.readFileSync(file,"utf8").split("\n")){
    if(!line.trim())continue;
    let r;try{r=JSON.parse(line)}catch{continue}
    if(!r.url||!probeIsConclusive(r))continue;
    const h=r.ok!==undefined&&"formatMatch" in r?{ok:r.ok,formatMatch:r.formatMatch,cors:!!r.cors,range:!!r.range,total:r.total??null,status:r.status??null,error:r.error??null}:interpretProbe(r);
    byUrl.set(r.url,{...h,at:(r.checkedAt||"").slice(0,10)});
    if(r.checkedAt&&r.checkedAt>newest)newest=r.checkedAt;
  }
  return{byUrl,at:newest.slice(0,10)};
}

/** Adds a compact `probe` summary and an access `tier` to every item that has at least one probed distribution. */
export function annotateItems(items,byUrl){
  let annotated=0;
  const health=Object.fromEntries([...byUrl].map(([u,h])=>[u,h]));
  for(const item of items){
    const probed=(item.distributions||[]).filter(d=>byUrl.has(d.url));
    if(!probed.length){delete item.probe;item.tier=accessTier(item,{});continue}
    const hs=probed.map(d=>byUrl.get(d.url));
    item.probe={at:hs.map(h=>h.at).sort().pop()||"",n:hs.length,ok:hs.filter(h=>h.ok).length,mm:hs.filter(h=>h.ok&&h.formatMatch===false).length,cors:hs.filter(h=>h.cors).length};
    item.tier=accessTier(item,health);
    // event streams: did each declared LDES endpoint answer as a stream (LDES/TREE vocabulary), answer otherwise, or not at all?
    const streams=probed.filter(d=>d.format==="LDES").map(d=>{const h=byUrl.get(d.url);
      return{url:d.url,at:h.at,result:h.ok?(h.formatMatch?"stream":"not_a_stream"):"unreachable",...(h.status?{status:h.status}:{}),...(h.error?{error:h.error}:{})}});
    if(streams.length)item.streamCheck=streams;else delete item.streamCheck;
    annotated++;
  }
  return annotated;
}

function sha(body){return createHash("sha256").update(body).digest("hex").slice(0,16)}
function main(){
  const args=process.argv.slice(2),i=args.indexOf("--probe");
  const file=path.resolve(i>=0?args[i+1]:path.join(__dirname,"../.cache/link-probe.jsonl"));
  const {byUrl,at}=loadProbes(file);
  if(!byUrl.size){console.log("[link-health] no probe file at "+file+"; nothing to apply");return}
  const manifestPath=path.join(pub,"catalogue-manifest.json"),manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,"utf8")):{files:{}};
  let total=0;
  const indexPath=path.join(pub,"national-catalog.json");
  if(fs.existsSync(indexPath)){
    const index=JSON.parse(fs.readFileSync(indexPath,"utf8"));
    for(const c of index.chunks||[]){
      const fp=path.join(pub,c.file),page=JSON.parse(fs.readFileSync(fp,"utf8"));
      total+=annotateItems(page.items||[],byUrl);
      const body=JSON.stringify(page)+"\n";fs.writeFileSync(fp,body);c.bytes=Buffer.byteLength(body);c.sha256=sha(body);
    }
    index.linkHealth={at,probedUrls:byUrl.size,ok:[...byUrl.values()].filter(h=>h.ok).length};
    const body=JSON.stringify(index)+"\n";fs.writeFileSync(indexPath,body);
    manifest.files["national-catalog.json"]={sha256:sha(body),bytes:Buffer.byteLength(body)};
  }
  const hvPath=path.join(pub,"harvested-catalog.json");
  if(fs.existsSync(hvPath)){
    const hv=JSON.parse(fs.readFileSync(hvPath,"utf8"));
    total+=annotateItems(hv.items||[],byUrl);hv.linkHealth={at,probedUrls:byUrl.size};
    const body=JSON.stringify(hv)+"\n";fs.writeFileSync(hvPath,body);
    manifest.files["harvested-catalog.json"]={sha256:sha(body),bytes:Buffer.byteLength(body)};
  }
  fs.writeFileSync(manifestPath,JSON.stringify(manifest)+"\n");
  console.log("[link-health] applied "+byUrl.size+" probe results (newest "+at+") to "+total+" catalogue records");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
