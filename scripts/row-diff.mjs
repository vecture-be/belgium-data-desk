// Row-level change tracking for the full-file check (scripts/full-check.mjs).
//
// Each run keeps, per file, the sorted 53-bit hashes of its distinct rows (createColumnProfiler keepRowHashes). The next run
// compares its own hashes with them: rows added and removed since the previous check, without keeping any of the data itself.
// Hashes are stored per shard as a pack of two files, rows-<shard>.json (index) and rows-<shard>.bin (little-endian float64),
// which the workflow keeps as release assets so they outlive the Actions cache.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const rowKey=url=>createHash("sha1").update(url).digest("hex").slice(0,16);

/** Read a pack: Map key -> {hashes: Float64Array, checkedAt}. Missing or broken packs read as empty. */
export function readRowPack(dir,name){
  const out=new Map(),ix=path.join(dir,name+".json"),bin=path.join(dir,name+".bin");
  if(!fs.existsSync(ix)||!fs.existsSync(bin))return out;
  let index;try{index=JSON.parse(fs.readFileSync(ix,"utf8"))}catch{return out}
  const buf=fs.readFileSync(bin);
  if(index.bytes!==buf.length)return out;   // index and data from different runs (an interrupted upload): no baseline
  for(const [k,{off,n,checkedAt}] of Object.entries(index.files||{})){
    if(off+n*8>buf.length)continue;
    const a=new Float64Array(n);for(let i=0;i<n;i++)a[i]=buf.readDoubleLE(off+i*8);
    out.set(k,{hashes:a,checkedAt});
  }
  return out;
}
/** Write a pack. Entries of the previous pack that this run did not replace are carried over, so a shard that ran out of time
 *  keeps the baseline of the files it did not reach. Entries older than maxAgeDays are dropped. */
export function writeRowPack(dir,name,current,previous=new Map(),{now=Date.now(),maxAgeDays=56}={}){
  fs.mkdirSync(dir,{recursive:true});
  const all=new Map(previous);for(const [k,v] of current)all.set(k,v);
  const files={},parts=[];let off=0;
  for(const [k,{hashes,checkedAt}] of all){
    if(!current.has(k)&&now-Date.parse(checkedAt||0)>maxAgeDays*86400000)continue;
    const b=Buffer.alloc(hashes.length*8);for(let i=0;i<hashes.length;i++)b.writeDoubleLE(hashes[i],i*8);
    files[k]={off,n:hashes.length,checkedAt};parts.push(b);off+=b.length;
  }
  fs.writeFileSync(path.join(dir,name+".json"),JSON.stringify({v:1,bytes:off,files}));
  fs.writeFileSync(path.join(dir,name+".bin"),Buffer.concat(parts));
  return Object.keys(files).length;
}

/** Distinct rows added and removed between two sorted hash arrays. */
export function diffSorted(before,after){
  let i=0,j=0,kept=0;
  while(i<before.length&&j<after.length){
    if(before[i]===after[j]){kept++;i++;j++}else if(before[i]<after[j])i++;else j++;
  }
  return{added:after.length-kept,removed:before.length-kept,kept};
}

/** What changed between the previous and the current whole-file profile of a file, as plain numbers. */
export function describeChange(prev,cur,diff=null){
  const pc=new Map((prev.profile?.columns||[]).map(c=>[c.name,c])),cc=new Map((cur.profile?.columns||[]).map(c=>[c.name,c]));
  const added=[...cc.keys()].filter(k=>!pc.has(k)),removed=[...pc.keys()].filter(k=>!cc.has(k));
  // where dated columns now end (or start), the usual sign of new periods; and numeric ranges that moved
  const coverage=[],ranges=[];
  for(const [name,c] of cc){
    const p=pc.get(name);if(!p)continue;
    if(c.to!=null&&p.to!=null&&(c.to!==p.to||c.from!==p.from))coverage.push({column:name,before:[p.from,p.to],after:[c.from,c.to]});
    else if((c.type==="number"||c.type==="integer")&&p.min!=null&&(c.min!==p.min||c.max!==p.max))ranges.push({column:name,before:[p.min,p.max],after:[c.min,c.max]});
  }
  return{
    since:prev.checkedAt,
    rows:{before:prev.profile?.rows??null,after:cur.profile?.rows??null},
    ...(diff?{distinct_rows_added:diff.added,distinct_rows_removed:diff.removed}:{}),
    ...(added.length||removed.length?{columns_added:added,columns_removed:removed}:{}),
    ...(coverage.length?{coverage:coverage.slice(0,5)}:{}),
    ...(ranges.length?{ranges:ranges.slice(0,5)}:{}),
  };
}
