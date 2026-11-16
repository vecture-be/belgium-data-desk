// Full-file check: download each dataset's best CSV/TSV file whole (up to --max-mb, default 100 MB) and profile every row, so the
// dataset card states exact row counts, the real time coverage, duplicate rows and a content hash instead of figures from the
// first 256 KiB (scripts/probe-links.mjs).
//   node scripts/full-check.mjs [--out .cache/full-check.jsonl] [--previous .cache/full-check-prev.jsonl] [--shard 1/6]
//                               [--max-mb 100] [--budget-minutes 300] [--limit 50]
// One file per dataset (pickTabularDistribution), at most 2 requests per host at a time. A file unchanged since the previous run
// (ETag / Last-Modified answered with 304) keeps its previous profile. Files over the size cap are recorded as too_large and left for
// a bigger machine. Resumable: URLs already in --out are skipped. Runs on CI runners or a laptop, never in the Worker.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { encodingFor, detectDelimiter, pickTabularDistribution, safePublicUrl } from "./tabular-profile.mjs";
import { createColumnProfiler, setNisReference } from "./dataset-card.mjs";
import { loadRecords } from "./build-cards.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(__dirname,".."),pub=path.join(root,"public");
const UA="Belgium-Data-Desk-QA/1.0 (+https://data.vecture.be)";
const PER_HOST=2,MAX_LANES=16,FILE_TIMEOUT_MS=6*60*1000;

export function loadWork(items){
  const seen=new Map();
  for(const it of items){
    if(it?.tier==="broken")continue;
    const d=pickTabularDistribution(it);
    if(!d?.url||seen.has(d.url)||!safePublicUrl(d.url))continue;
    seen.set(d.url,{url:d.url,fmt:/tsv/i.test(d.format||d.url)?"TSV":"CSV",ds:it.id,prov:it.provider||""});
  }
  return [...seen.values()];
}
const hostOf=u=>{try{return new URL(u).host}catch{return"bad"}};
/** Shards split by host, so the per-host limit holds across parallel jobs. */
export function inShard(url,shard){
  if(!shard)return true;
  const [i,n]=shard;const h=createHash("sha1").update(hostOf(url)).digest().readUInt32BE(0);
  return h%n===i-1;
}

export async function checkFile(w,{previous=null,maxBytes=100*1024*1024,fetchImpl=fetch,timeoutMs=FILE_TIMEOUT_MS}={}){
  const t0=Date.now(),r={url:w.url,fmt:w.fmt,ds:w.ds,prov:w.prov,full:true};
  const headers={"user-agent":UA,accept:"text/csv,text/tab-separated-values,text/plain;q=0.9,*/*;q=0.2"};
  if(previous?.profile){if(previous.etag)headers["if-none-match"]=previous.etag;else if(previous.lastModified)headers["if-modified-since"]=previous.lastModified}
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeoutMs);
  try{
    const res=await fetchImpl(w.url,{headers,redirect:"follow",signal:ctl.signal});
    r.status=res.status;
    if(res.status===304&&previous?.profile){try{await res.body?.cancel()}catch{}
      return{...previous,status:304,unchanged:true,checkedAt:new Date().toISOString(),ms:Date.now()-t0}}
    if(!res.ok){try{await res.body?.cancel()}catch{}r.error="HTTP "+res.status;return finish(r,t0)}
    r.ct=(res.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
    r.lastModified=res.headers.get("last-modified")||null;r.etag=res.headers.get("etag")||null;
    const declared=Number(res.headers.get("content-length"))||null;
    if(declared&&declared>maxBytes){try{await res.body?.cancel()}catch{}r.too_large=true;r.total=declared;return finish(r,t0)}
    const reader=res.body.getReader(),sha=createHash("sha256");
    let n=0,decoder=null,profiler=null;
    for(;;){
      const {done,value}=await reader.read();if(done)break;if(!value?.length)continue;
      n+=value.length;
      if(n>maxBytes){try{await reader.cancel()}catch{}r.too_large=true;r.total=declared;r.bytes=n;return finish(r,t0)}
      sha.update(value);
      let chunk=value;
      if(!decoder){
        const {encoding,skip}=encodingFor(chunk);decoder=new TextDecoder(encoding);chunk=chunk.subarray(skip);
        const text=decoder.decode(chunk,{stream:true});
        if(/^\s*<(?:!doctype|html)\b/i.test(text)){try{await reader.cancel()}catch{}r.error="html instead of a table";return finish(r,t0)}
        profiler=createColumnProfiler(detectDelimiter(text,{url:w.url,format:w.fmt}));profiler.push(text);
      }else profiler.push(decoder.decode(chunk,{stream:true}));
    }
    if(!profiler){r.error="empty file";return finish(r,t0)}
    profiler.push(decoder.decode());
    r.bytes=r.total=n;r.sha256=sha.digest("hex").slice(0,32);
    r.profile=profiler.finish({exact:true});
    if(previous?.sha256&&previous.sha256===r.sha256)r.unchanged=true;
  }catch(e){r.error=ctl.signal.aborted?"timeout":String(e.cause?.code||e.message||e).slice(0,120)}
  finally{clearTimeout(timer)}
  return finish(r,t0);
}
function finish(r,t0){r.ms=Date.now()-t0;r.checkedAt=new Date().toISOString();return r}

function readJsonl(file){
  const m=new Map();if(!file||!fs.existsSync(file))return m;
  for(const l of fs.readFileSync(file,"utf8").split("\n")){try{const r=JSON.parse(l);if(r?.url)m.set(r.url,r)}catch{}}
  return m;
}
// The published MCP records (public/mcp/, from scripts/build-mcp-index.mjs): the same records and file links the cards are built
// from, after records several catalogues carry were merged.
function loadItems(){return loadRecords().map(r=>({...r,provider:r.publisher}))}

/** Combine shard outputs with the previous run: a file that failed or was not reached this time keeps its last profile
 *  (with last_error), so one bad week does not drop a card. Profiles older than maxAgeDays are dropped. */
export function mergeRuns(previous,runs,{now=Date.now(),maxAgeDays=56}={}){
  const out=new Map();
  for(const [url,r] of previous)if(r.profile&&now-Date.parse(r.checkedAt||0)<maxAgeDays*86400000)out.set(url,r);
  for(const run of runs)for(const [url,r] of run){
    const old=out.get(url);
    if(r.profile||!old?.profile)out.set(url,r);
    else out.set(url,{...old,last_error:r.too_large?"too_large":r.error||"no profile",last_attempt:r.checkedAt});
  }
  return out;
}

async function main(){
  if(process.argv[2]==="--merge"){
    // node scripts/full-check.mjs --merge <out> <previous> <shard files...>
    const [,, ,outFile,prevFile,...inputs]=process.argv;
    const merged=mergeRuns(readJsonl(prevFile),inputs.map(readJsonl));
    fs.mkdirSync(path.dirname(path.resolve(outFile)),{recursive:true});
    fs.writeFileSync(outFile,[...merged.values()].map(r=>JSON.stringify(r)).join("\n")+"\n");
    const v=[...merged.values()];
    console.log("[full-check] merged "+v.length+" files: "+v.filter(r=>r.profile).length+" profiled, "+v.filter(r=>r.last_error).length+" kept from the previous run, "+v.filter(r=>r.too_large).length+" too large");
    return;
  }
  const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,all)=>x.startsWith("--")?[...a,[x.slice(2),all[i+1]&&!all[i+1].startsWith("--")?all[i+1]:"1"]]:a,[]));
  const outFile=path.resolve(args.out||path.join(root,".cache/full-check.jsonl"));
  const previous=readJsonl(args.previous?path.resolve(args.previous):null);
  const shard=args.shard?args.shard.split("/").map(Number):null;
  const maxBytes=Number(args["max-mb"]||100)*1024*1024,deadline=Date.now()+Number(args["budget-minutes"]||300)*60000,limit=Number(args.limit||0);
  setNisReference(JSON.parse(fs.readFileSync(path.join(pub,"statbel/places-v1.json"),"utf8")).places);
  fs.mkdirSync(path.dirname(outFile),{recursive:true});
  const done=readJsonl(outFile);
  let work=loadWork(loadItems()).filter(w=>inShard(w.url,shard)&&!done.has(w.url));
  if(limit)work=work.slice(0,limit);
  const byHost=new Map();for(const w of work)(byHost.get(hostOf(w.url))||byHost.set(hostOf(w.url),[]).get(hostOf(w.url))).push(w);
  // biggest hosts first so they are not the tail of the run
  const queues=[...byHost.values()].sort((a,b)=>b.length-a.length);
  const out=fs.createWriteStream(outFile,{flags:"a"});
  // unchanged = same content as last run (304, or same hash after downloading: most portal exports send no ETag/Last-Modified)
  const stats={checked:0,profiled:0,unchanged:0,not_downloaded:0,too_large:0,failed:0,bytes:0,skipped_budget:0};
  // each lane takes the next host with free capacity: at most PER_HOST lanes per host, MAX_LANES in total
  const active=new Map();
  const nextItem=()=>{for(const q of queues){const h=q.length&&hostOf(q[0].url);if(h&&(active.get(h)||0)<PER_HOST)return q.shift()}return null};
  const lane=async()=>{
    for(;;){
      if(Date.now()>deadline){stats.skipped_budget=queues.reduce((s,q)=>s+q.length,0);return}
      const w=nextItem();if(!w){if(queues.some(q=>q.length)){await new Promise(r=>setTimeout(r,250));continue}return}
      const h=hostOf(w.url);active.set(h,(active.get(h)||0)+1);
      const r=await checkFile(w,{previous:previous.get(w.url),maxBytes});
      active.set(h,active.get(h)-1);
      out.write(JSON.stringify(r)+"\n");stats.checked++;
      if(r.too_large)stats.too_large++;else if(r.error)stats.failed++;else{stats.profiled++;if(r.status===304)stats.not_downloaded++;else stats.bytes+=r.bytes||0;if(r.unchanged)stats.unchanged++}
      if(stats.checked%200===0)console.error("[full-check] "+stats.checked+"/"+work.length+" "+JSON.stringify(stats));
    }
  };
  await Promise.all(Array.from({length:Math.min(MAX_LANES,work.length)},lane));
  await new Promise(r=>out.end(r));
  console.log("[full-check] "+(shard?"shard "+shard.join("/")+": ":"")+JSON.stringify({...stats,gb:Math.round(stats.bytes/1e7)/100}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
