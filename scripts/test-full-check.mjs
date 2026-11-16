// Offline tests for the full-file check (scripts/full-check.mjs) against a local HTTP server, and the streaming column profiler.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFile, inShard, loadWork, mergeRuns } from "./full-check.mjs";
import { createColumnProfiler, profileColumns, setNisReference, buildCard } from "./dataset-card.mjs";
import { mergeFull } from "./build-cards.mjs";

const pub=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../public");
setNisReference(JSON.parse(fs.readFileSync(path.join(pub,"statbel/places-v1.json"),"utf8")).places);

// a municipal table of 3,000 rows with 25 repeated rows, dates running to 2025-06-30
const rows=Array.from({length:3000},(_,i)=>["44021",new Date(Date.UTC(2020,0,1)+((i%2000)*86400000)).toISOString().slice(0,10),i<25?"7":String(i)].join(";"));
for(let i=0;i<25;i++)rows[2975+i]=rows[i];
const csv="NIS;datum;waarde\n"+rows.join("\n")+"\n";

// 1. streaming in odd-sized pieces gives the same profile as one string, plus duplicate rows
const whole=profileColumns(csv,{bytesRead:csv.length,totalBytes:csv.length});
const p=createColumnProfiler(";");for(let i=0;i<csv.length;i+=777)p.push(csv.slice(i,i+777));
const streamed=p.finish({exact:true});
assert.equal(streamed.rows,3000);assert.equal(streamed.rows_exact,true);
assert.deepEqual(streamed.columns,whole.columns,"chunked and whole-string profiles agree");
assert.equal(streamed.duplicate_rows,25,"rows 2975..2999 repeat rows 0..24");
assert.equal(whole.duplicate_rows,streamed.duplicate_rows);
const partial=profileColumns(csv.slice(0,4000),{bytesRead:4000,totalBytes:csv.length});
assert.equal(partial.duplicate_rows,undefined,"a partial read makes no duplicate claim");

// 2. HTTP: full read with ETag, then 304 reuse, size cap, HTML error page, 404
const big="a,b\n"+"1,2\n".repeat(300000);
const server=http.createServer((req,res)=>{
  if(req.url==="/data.csv"){if(req.headers["if-none-match"]==='"v1"'){res.writeHead(304);return res.end()}res.writeHead(200,{"content-type":"text/csv",etag:'"v1"'});return res.end(csv)}
  if(req.url==="/big.csv"){res.writeHead(200,{"content-type":"text/csv","content-length":Buffer.byteLength(big)});return res.end(big)}
  if(req.url==="/stream.csv"){res.writeHead(200,{"content-type":"text/csv"});return res.end(big)}   // chunked, no length
  if(req.url==="/page.csv"){res.writeHead(200,{"content-type":"text/html"});return res.end("<!doctype html><html><body>Login</body></html>")}
  res.writeHead(404);res.end();
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const base="http://127.0.0.1:"+server.address().port;
try{
  const first=await checkFile({url:base+"/data.csv",fmt:"CSV",ds:"x"});
  assert.equal(first.profile.rows,3000);assert.equal(first.profile.rows_exact,true);assert.equal(first.etag,'"v1"');
  assert.equal(first.bytes,Buffer.byteLength(csv));assert.match(first.sha256,/^[0-9a-f]{32}$/);
  const again=await checkFile({url:base+"/data.csv",fmt:"CSV",ds:"x"},{previous:first});
  assert.equal(again.status,304);assert.equal(again.unchanged,true);assert.deepEqual(again.profile,first.profile,"304 keeps last week's profile");
  const capped=await checkFile({url:base+"/big.csv",fmt:"CSV"},{maxBytes:100000});
  assert.equal(capped.too_large,true);assert.equal(capped.profile,undefined);
  const cappedStream=await checkFile({url:base+"/stream.csv",fmt:"CSV"},{maxBytes:100000});
  assert.equal(cappedStream.too_large,true,"a file without Content-Length is cut off at the cap too");
  const ok=await checkFile({url:base+"/stream.csv",fmt:"CSV"});assert.equal(ok.profile.rows,300000);
  assert.equal((await checkFile({url:base+"/page.csv",fmt:"CSV"})).error,"html instead of a table");
  assert.equal((await checkFile({url:base+"/missing.csv",fmt:"CSV"})).error,"HTTP 404");

  // 3. the card says whole file and duplicates; full results replace the probe's partial profile
  const card=buildCard({id:"x",frequency:"ANNUAL",updatedAt:"2025-07-01"},first.profile,{now:"2025-08-01T00:00:00Z",file:{url:base+"/data.csv",bytesRead:first.bytes,totalBytes:first.total,sha256:first.sha256}});
  assert.equal(card.file.read,"whole file");assert.equal(card.quality.duplicate_rows,25);assert.equal(card.file.sha256,first.sha256);
  assert.ok(card.facts.some(f=>/25 of the 3,000 rows \(0\.8 %\) repeat an earlier row exactly/.test(f.text)),card.facts.map(f=>f.text).join("\n"));
  assert.ok(card.facts[0].text.endsWith("columns."),"no 'in the part read' qualifier for a whole file");
  const probe=new Map([[base+"/data.csv",{url:base+"/data.csv",profile:partial}],[base+"/other.csv",{url:base+"/other.csv",profile:partial}]]);
  const merged=mergeFull(probe,new Map([[base+"/data.csv",first],[base+"/other.csv",{url:base+"/other.csv",error:"timeout"}]]));
  assert.equal(merged.get(base+"/data.csv").profile.rows_exact,true);assert.equal(merged.get(base+"/other.csv").profile,partial,"a failed full check keeps the probe profile");
}finally{server.close()}

// 4. merging runs: a failure keeps last week's profile; stale profiles expire
{
  const now=Date.parse("2026-11-20T00:00:00Z"),ok={url:"u1",profile:{rows:1},checkedAt:"2026-11-13T00:00:00Z"};
  const m=mergeRuns(new Map([["u1",ok],["u2",{url:"u2",profile:{rows:2},checkedAt:"2026-08-01T00:00:00Z"}]]),
    [new Map([["u1",{url:"u1",error:"timeout",checkedAt:"2026-11-20T00:00:00Z"}]]),new Map([["u3",{url:"u3",too_large:true}]])],{now});
  assert.equal(m.get("u1").profile.rows,1);assert.equal(m.get("u1").last_error,"timeout");
  assert.equal(m.has("u2"),false,"a profile older than eight weeks is dropped");assert.equal(m.get("u3").too_large,true);
}

// 5. one file per dataset, public URLs only, shards split by host
const work=loadWork([
  {id:"a",distributions:[{format:"JSON",url:"https://x.be/a.json"},{format:"CSV",url:"https://x.be/a.csv"},{format:"CSV",url:"https://x.be/a_nl.csv"}]},
  {id:"b",distributions:[{format:"CSV",url:"http://127.0.0.1/b.csv"}]},
  {id:"c",tier:"broken",distributions:[{format:"CSV",url:"https://y.be/c.csv"}]},
]);
assert.deepEqual(work.map(w=>w.url),["https://x.be/a_nl.csv"]);
const n=4,urls=Array.from({length:40},(_,i)=>"https://h"+i+".be/f.csv");
for(const u of urls)assert.equal([1,2,3,4].filter(i=>inShard(u,[i,n])).length,1,"every host lands in exactly one shard");
assert.equal(inShard("https://h1.be/a.csv",[2,n]),inShard("https://h1.be/b.csv",[2,n]),"same host, same shard");

console.log(JSON.stringify({ok:true,"full-check":"stream/304/cap/html/cards/merge/shards",duplicates:streamed.duplicate_rows}));
