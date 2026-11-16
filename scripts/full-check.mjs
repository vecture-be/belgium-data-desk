// Full-file check: download each dataset's best CSV/TSV file whole (up to --max-mb, default 100 MB) and profile every row, so the
// dataset card states exact row counts, the real time coverage, duplicate rows and a content hash instead of figures from the
// first 256 KiB (scripts/probe-links.mjs).
//   node scripts/full-check.mjs [--out .cache/full-check.jsonl] [--previous .cache/full-check-prev.jsonl] [--shard 1/6]
//                               [--max-mb 100] [--budget-minutes 300] [--limit 50]
// One file per dataset (pickTabularDistribution), at most 2 requests per host at a time. Every file is downloaded every run: the
// content hash, compared with the previous run, says whether and when the data changed (contentHistory), and the ETag /
// Last-Modified headers are checked against it (headerCheck) rather than trusted. Files over the size cap are recorded as too_large
// and left for a bigger machine. Resumable: URLs already in --out are skipped. Runs on CI runners or a laptop, never in the Worker.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { encodingFor, detectDelimiter, pickTabularDistribution, safePublicUrl } from "./tabular-profile.mjs";
import { createColumnProfiler, setNisReference } from "./dataset-card.mjs";
import { loadRecords } from "./build-cards.mjs";
import { describeChange, diffSorted, readRowPack, rowKey, writeRowPack } from "./row-diff.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(__dirname,".."),pub=path.join(root,"public");
const UA="Belgium-Data-Desk-QA/1.0 (+https://data.vecture.be)";
const PER_HOST=2,MAX_LANES=16,FILE_TIMEOUT_MS=6*60*1000,RETRY_DELAY_MS=15000;
const TRANSIENT=/^(UND_ERR_CONNECT_TIMEOUT|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_SOCKET|HTTP 429|HTTP 502|HTTP 503|HTTP 504)$/;

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

export const ROWS=Symbol("rowHashes");
export async function checkFile(w,{previous=null,prevRows=null,maxBytes=100*1024*1024,fetchImpl=fetch,timeoutMs=FILE_TIMEOUT_MS}={}){
  const t0=Date.now(),r={url:w.url,fmt:w.fmt,ds:w.ds,prov:w.prov,full:true};
  // No conditional request: ETag and Last-Modified are often missing, regenerated per request or left stale, so they are what this
  // check tests (headerCheck), not something it relies on. Every file is downloaded and compared by content hash.
  const headers={"user-agent":UA,accept:"text/csv,text/tab-separated-values,text/plain;q=0.9,*/*;q=0.2","cache-control":"no-cache"};
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeoutMs);
  try{
    const res=await fetchImpl(w.url,{headers,redirect:"follow",signal:ctl.signal});
    r.status=res.status;
    if(!res.ok){try{await res.body?.cancel()}catch{}r.error="HTTP "+res.status;return finish(r,t0)}
    r.ct=(res.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
    r.lastModified=res.headers.get("last-modified")||null;r.etag=res.headers.get("etag")||null;r.serverDate=res.headers.get("date")||null;
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
    r.profile=profiler.finish({exact:true,keepRowHashes:true});
    if(profiler.rowHashes)r[ROWS]=profiler.rowHashes;   // not serialised: written to the row pack by main()
    finish(r,t0);
    Object.assign(r,contentHistory(r,previous));
    r.header_check=headerCheck(r,previous);
    // what changed since the previous run: row diff when both runs kept row hashes; otherwise the last change seen stays
    if(previous&&r.content_changed_at===r.checkedAt){
      const diff=prevRows&&r[ROWS]?diffSorted(prevRows,r[ROWS]):null;
      r.change={...describeChange(previous,r,diff),seen_at:r.checkedAt};
    }else if(previous?.change)r.change=previous.change;
    return r;
  }catch(e){r.error=ctl.signal.aborted?"timeout":String(e.cause?.code||e.message||e).slice(0,120)}
  finally{clearTimeout(timer)}
  return finish(r,t0);
}
function finish(r,t0){r.ms=Date.now()-t0;r.checkedAt=new Date().toISOString();return r}

// ---------- change evidence from the content itself ----------
// observed_since: first run that read this file; content_since: first run that saw today's bytes (the content last changed on or
// before that day); content_changed_at: the run that saw the bytes differ from the run before (the change happened after the
// previous run, on or before this one).
// "Same content" means the same rows: an export that returns the same rows in a different order (row_set equal, sha256 not) has
// not changed its data; it is flagged row_order_unstable instead, since it defeats caches and diffs.
export function compareContent(cur,prev){
  if(!prev?.sha256)return null;
  if(prev.sha256===cur.sha256)return"same";
  const a=cur.profile?.row_set,b=prev.profile?.row_set;
  if(!a||!b)return"unknown";   // a run from before row fingerprints: the bytes differ, but whether the rows do is not known
  return a===b?"reordered":"changed";
}
export function contentHistory(cur,prev){
  const p=prev?.sha256?prev:null,observed=p?.observed_since||p?.checkedAt||cur.checkedAt,cmp=compareContent(cur,p);
  if(!cmp||cmp==="unknown")return{observed_since:observed,content_since:cur.checkedAt,content_changed_at:null};
  if(cmp!=="changed")return{observed_since:observed,content_since:p.content_since||p.checkedAt,content_changed_at:p.content_changed_at||null,
    ...(p.changed_after&&p.content_changed_at?{changed_after:p.changed_after}:{}),unchanged:true,
    ...(cmp==="reordered"||p.row_order_unstable?{row_order_unstable:true}:{})};
  return{observed_since:observed,content_since:cur.checkedAt,content_changed_at:cur.checkedAt,changed_after:p.checkedAt,...(p.row_order_unstable?{row_order_unstable:true}:{})};
}

// ---------- do the HTTP change headers tell the truth? ----------
// last_modified: missing | request_time (the moment of the request: generated on the fly, says nothing) | future | plausible.
// With a previous run: a header that moved while the bytes stayed the same, or stayed while the bytes changed, is misleading.
const strongEtag=e=>String(e||"").replace(/^W\//,"").replace(/-(gzip|br|deflate)"$/,'"');
export function headerCheck(cur,prev){
  const lm=Date.parse(cur.lastModified||""),at=Date.parse(cur.serverDate||"")||Date.parse(cur.checkedAt);
  const lastModified=!cur.lastModified||!Number.isFinite(lm)?"missing":lm>at+3600e3?"future":Math.abs(at-lm)<=120e3?"request_time":"plausible";
  const out={last_modified:lastModified,etag:cur.etag?"present":"missing",issues:[]};
  if(lastModified==="request_time")out.issues.push("last_modified_is_request_time");
  if(lastModified==="future")out.issues.push("last_modified_in_future");
  const p=prev?.sha256?prev:null;
  const cmp=compareContent(cur,p);
  // only the same bytes or a real change of rows say anything about the headers; a mere reordering judges neither way
  if(p&&cmp!=="reordered"&&cmp!=="unknown"){
    const same=cmp==="same";
    const lmMoved=!!(p.lastModified&&cur.lastModified&&p.lastModified!==cur.lastModified),lmStayed=!!(p.lastModified&&p.lastModified===cur.lastModified);
    const etMoved=!!(p.etag&&cur.etag&&strongEtag(p.etag)!==strongEtag(cur.etag)),etStayed=!!(p.etag&&strongEtag(p.etag)===strongEtag(cur.etag));
    if(same&&lmMoved&&lastModified!=="request_time")out.issues.push("last_modified_moved_content_same");
    if(!same&&lmStayed)out.issues.push("content_changed_last_modified_same");
    if(same&&etMoved)out.issues.push("etag_moved_content_same");
    if(!same&&etStayed)out.issues.push("content_changed_etag_same");
  }
  if(p)out.compared_with=p.checkedAt;
  // a date a client may use: present, not the request time or in the future, and never caught contradicting the content
  out.last_modified_usable=lastModified==="plausible"&&!out.issues.some(i=>/last_modified/.test(i));
  return out;
}

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
  // row hashes of the previous run (--rows-prev) and of this one (--rows-out), packed per shard as <pack>.json/.bin (scripts/row-diff.mjs)
  const pack=args.pack||(shard?"rows-"+shard[0]:"rows");
  const prevPack=args["rows-prev"]?readRowPack(path.resolve(args["rows-prev"]),pack):new Map(),newPack=new Map();
  const out=fs.createWriteStream(outFile,{flags:"a"});
  // unchanged/changed = same or different bytes than the previous run; headers = how the Last-Modified headers fared
  const stats={checked:0,retried:0,profiled:0,unchanged:0,changed:0,reordered:0,too_large:0,failed:0,bytes:0,skipped_budget:0,last_modified:{},issues:{}};
  // each lane takes the next host with free capacity: at most PER_HOST lanes per host, MAX_LANES in total
  const active=new Map();
  const nextItem=()=>{for(const q of queues){const h=q.length&&hostOf(q[0].url);if(h&&(active.get(h)||0)<PER_HOST)return q.shift()}return null};
  const lane=async()=>{
    for(;;){
      if(Date.now()>deadline){stats.skipped_budget=queues.reduce((s,q)=>s+q.length,0);return}
      const w=nextItem();if(!w){if(queues.some(q=>q.length)){await new Promise(r=>setTimeout(r,250));continue}return}
      const h=hostOf(w.url);active.set(h,(active.get(h)||0)+1);
      const opts={previous:previous.get(w.url),prevRows:prevPack.get(rowKey(w.url))?.hashes||null,maxBytes};
      let r=await checkFile(w,opts);
      // a connection that never opened or a DNS hiccup says more about the runner's network than about the publisher: try once more
      if(TRANSIENT.test(r.error||"")){await new Promise(z=>setTimeout(z,RETRY_DELAY_MS));r=await checkFile(w,opts);if(!r.error)r.retried=true}
      active.set(h,active.get(h)-1);
      if(r[ROWS])newPack.set(rowKey(w.url),{hashes:r[ROWS],checkedAt:r.checkedAt});
      out.write(JSON.stringify(r)+"\n");stats.checked++;if(r.retried)stats.retried++;
      if(r.too_large)stats.too_large++;else if(r.error)stats.failed++;else{stats.profiled++;stats.bytes+=r.bytes||0;if(r.unchanged)stats.unchanged++;if(r.content_changed_at===r.checkedAt)stats.changed++;if(r.row_order_unstable)stats.reordered++;
        const hc=r.header_check;stats.last_modified[hc.last_modified]=(stats.last_modified[hc.last_modified]||0)+1;for(const i of hc.issues)stats.issues[i]=(stats.issues[i]||0)+1}
      if(stats.checked%200===0)console.error("[full-check] "+stats.checked+"/"+work.length+" "+JSON.stringify(stats));
    }
  };
  await Promise.all(Array.from({length:Math.min(MAX_LANES,work.length)},lane));
  await new Promise(r=>out.end(r));
  if(args["rows-out"])stats.row_baselines=writeRowPack(path.resolve(args["rows-out"]),pack,newPack,prevPack);
  console.log("[full-check] "+(shard?"shard "+shard.join("/")+": ":"")+JSON.stringify({...stats,gb:Math.round(stats.bytes/1e7)/100}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
