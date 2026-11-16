// Offline tests for the full-file check (scripts/full-check.mjs) against a local HTTP server, and the streaming column profiler.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFile, contentHistory, headerCheck, inShard, loadWork, mergeRuns } from "./full-check.mjs";
import { createColumnProfiler, profileColumns, setNisReference, buildCard } from "./dataset-card.mjs";
import { mergeFull } from "./build-cards.mjs";
import { encodingFor } from "./tabular-profile.mjs";

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
// the row-set fingerprint ignores row order but not content, nor the header
const lines=csv.trim().split("\n"),shuffled=[lines[0],...lines.slice(1).reverse()].join("\n")+"\n";
const prof=t=>profileColumns(t,{bytesRead:t.length,totalBytes:t.length});
assert.equal(prof(shuffled).row_set,whole.row_set,"same rows in another order");
assert.notEqual(prof(csv.replace("44021;2020-01-01","44021;2020-01-02")).row_set,whole.row_set,"one value changed");
assert.notEqual(prof(csv.replace("NIS;datum","NIS;date")).row_set,whole.row_set,"header renamed");
assert.equal(partial.row_set,undefined);

// 2. HTTP: always a full read (no conditional request), size cap, HTML error page, 404; headers judged, not trusted
const big="a,b\n"+"1,2\n".repeat(300000);
let conditional=0;
const server=http.createServer((req,res)=>{
  if(req.headers["if-none-match"]||req.headers["if-modified-since"])conditional++;
  if(req.url==="/data.csv"){res.writeHead(200,{"content-type":"text/csv",etag:'"v1"',"last-modified":"Tue, 01 Jul 2025 08:00:00 GMT"});return res.end(csv)}
  // generated on request: Last-Modified is "now"
  if(req.url==="/live.csv"){res.writeHead(200,{"content-type":"text/csv","last-modified":new Date().toUTCString()});return res.end(csv)}
  if(req.url==="/big.csv"){res.writeHead(200,{"content-type":"text/csv","content-length":Buffer.byteLength(big)});return res.end(big)}
  if(req.url==="/stream.csv"){res.writeHead(200,{"content-type":"text/csv"});return res.end(big)}   // chunked, no length
  if(req.url==="/page.csv"){res.writeHead(200,{"content-type":"text/html"});return res.end("<!doctype html><html><body>Login</body></html>")}
  // UTF-8 whose first network chunk ends inside the two bytes of "è" (C3 | A8)
  if(req.url==="/split.csv"){res.writeHead(200,{"content-type":"text/csv"});const b=Buffer.from(accented),cut=b.indexOf(0xc3)+1;
    res.write(b.subarray(0,cut));return setTimeout(()=>res.end(b.subarray(cut)),50)}
  res.writeHead(404);res.end();
});
const accented="province;n\nProvince de Liège;1\nProvince de Namur;2\n";
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const base="http://127.0.0.1:"+server.address().port;
try{
  const first=await checkFile({url:base+"/data.csv",fmt:"CSV",ds:"x"});
  assert.equal(first.profile.rows,3000);assert.equal(first.profile.rows_exact,true);assert.equal(first.etag,'"v1"');
  assert.equal(first.bytes,Buffer.byteLength(csv));assert.match(first.sha256,/^[0-9a-f]{32}$/);
  assert.deepEqual(first.header_check.issues,[]);assert.equal(first.header_check.last_modified,"plausible");assert.equal(first.header_check.last_modified_usable,true);
  assert.equal(first.content_since,first.checkedAt);assert.equal(first.content_changed_at,null,"first sight is no change");
  const again=await checkFile({url:base+"/data.csv",fmt:"CSV",ds:"x"},{previous:{...first,checkedAt:"2025-07-20T00:00:00Z",content_since:"2025-07-13T00:00:00Z",observed_since:"2025-07-06T00:00:00Z"}});
  assert.equal(again.status,200,"downloaded again even though an ETag was known");assert.equal(conditional,0,"no If-None-Match / If-Modified-Since sent");
  assert.equal(again.unchanged,true);assert.equal(again.content_since,"2025-07-13T00:00:00Z","same bytes: unchanged since the first run that saw them");
  assert.equal(again.observed_since,"2025-07-06T00:00:00Z");
  const live=await checkFile({url:base+"/live.csv",fmt:"CSV"});
  assert.deepEqual(live.header_check.issues,["last_modified_is_request_time"]);assert.equal(live.header_check.last_modified_usable,false);
  const capped=await checkFile({url:base+"/big.csv",fmt:"CSV"},{maxBytes:100000});
  assert.equal(capped.too_large,true);assert.equal(capped.profile,undefined);
  const cappedStream=await checkFile({url:base+"/stream.csv",fmt:"CSV"},{maxBytes:100000});
  assert.equal(cappedStream.too_large,true,"a file without Content-Length is cut off at the cap too");
  const ok=await checkFile({url:base+"/stream.csv",fmt:"CSV"});assert.equal(ok.profile.rows,300000);
  assert.equal((await checkFile({url:base+"/page.csv",fmt:"CSV"})).error,"html instead of a table");
  // a chunk boundary inside "è" must not switch the file to windows-1252 (it did: "LiÃ¨ge", and a false change of every such row)
  const b=Buffer.from(accented);
  assert.equal(encodingFor(b.subarray(0,b.indexOf(0xc3)+1)).encoding,"utf-8","a sample cut inside a character is still UTF-8");
  assert.equal(encodingFor(Buffer.from([0x4c,0x69,0xe8,0x67,0x65,0x0a])).encoding,"windows-1252","a real Latin-1 byte still is not");
  const split=await checkFile({url:base+"/split.csv",fmt:"CSV"}),whole1=profileColumns(accented,{bytesRead:b.length,totalBytes:b.length});
  assert.deepEqual(split.profile.columns[0].top?.[0]??split.profile.columns[0],whole1.columns[0].top?.[0]??whole1.columns[0]);
  assert.equal(split.profile.row_set,whole1.row_set,"same rows whatever the chunking");
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

// 4. header truth against content, run over run
{
  const prev={sha256:"aaa",checkedAt:"2026-11-07T01:00:00Z",lastModified:"Mon, 03 Nov 2026 10:00:00 GMT",etag:'"e1"',content_since:"2026-10-17T01:00:00Z",profile:{row_set:"rs1"}};
  const at="2026-11-14T01:00:00Z",date="Sat, 14 Nov 2026 01:00:00 GMT";
  // same bytes, Last-Modified and ETag moved: misleading
  let h=headerCheck({sha256:"aaa",checkedAt:at,serverDate:date,lastModified:"Thu, 13 Nov 2026 10:00:00 GMT",etag:'"e2"'},prev);
  assert.deepEqual(h.issues,["last_modified_moved_content_same","etag_moved_content_same"]);assert.equal(h.last_modified_usable,false);
  // bytes changed, headers stayed: stale
  h=headerCheck({sha256:"bbb",checkedAt:at,serverDate:date,lastModified:prev.lastModified,etag:'W/"e1"',profile:{row_set:"rs2"}},prev);
  assert.deepEqual(h.issues,["content_changed_last_modified_same","content_changed_etag_same"],"a weak ETag of the same value counts as the same");
  // bytes changed, headers moved with them: fine
  h=headerCheck({sha256:"bbb",checkedAt:at,serverDate:date,lastModified:"Thu, 13 Nov 2026 10:00:00 GMT",etag:'"e2"',profile:{row_set:"rs2"}},prev);
  assert.deepEqual(h.issues,[]);assert.equal(h.last_modified_usable,true);
  assert.deepEqual(headerCheck({sha256:"x",checkedAt:at,serverDate:date,lastModified:"Mon, 01 Jan 2030 00:00:00 GMT"},null).issues,["last_modified_in_future"]);
  assert.equal(headerCheck({sha256:"x",checkedAt:at},null).last_modified,"missing");
  const withRows=(r,rs)=>({...r,profile:{row_set:rs}}),{profile:_p,...prevNoRows}=prev;
  const ch=contentHistory(withRows({sha256:"bbb",checkedAt:at},"rs2"),withRows(prev,"rs1"));
  assert.deepEqual([ch.content_since,ch.content_changed_at,ch.changed_after],[at,at,prev.checkedAt]);
  // a previous run without row fingerprints: no change claimed either way
  const old=contentHistory(withRows({sha256:"bbb",checkedAt:at},"rs2"),prevNoRows);
  assert.deepEqual([old.content_changed_at,old.content_since,old.unchanged],[null,at,undefined]);
  // same rows, other order: not a change, flagged; headers judged neither way
  const pr={...prev,profile:{row_set:"rs1"}},re={sha256:"ccc",checkedAt:at,serverDate:date,lastModified:"Thu, 13 Nov 2026 10:00:00 GMT",etag:'"e2"',profile:{row_set:"rs1"}};
  const rh=contentHistory(re,pr);
  assert.equal(rh.unchanged,true);assert.equal(rh.row_order_unstable,true);assert.equal(rh.content_since,prev.content_since);assert.equal(rh.content_changed_at,null);
  assert.deepEqual(headerCheck(re,pr).issues,[]);
  // the flag sticks on later identical runs
  assert.equal(contentHistory({sha256:"ccc",checkedAt:"2026-11-21T01:00:00Z",profile:{row_set:"rs1"}},{...re,...rh}).row_order_unstable,true);
}

// 5. cards from the content: misleading headers are ignored, a catalogue date the file never followed does not count
{
  const rec={id:"r",frequency:"MONTHLY",updatedAt:"2026-11-10"},prof=profileColumns("a;b\n1;2\n",{bytesRead:8,totalBytes:8});
  const base={url:"u",bytesRead:8,totalBytes:8};
  // catalogue says updated 10 Nov, bytes identical since 1 Sep, Last-Modified generated per request
  let card=buildCard(rec,prof,{now:"2026-11-14T00:00:00Z",file:{...base,lastModified:"Sat, 14 Nov 2026 01:00:00 GMT",headerCheck:{last_modified:"request_time",issues:["last_modified_is_request_time"],last_modified_usable:false},
    content:{since:"2026-09-01T01:00:00Z",observedSince:"2026-08-01T01:00:00Z",lastModifiedUsable:false}}});
  assert.equal(card.freshness.metadata_date_not_reflected_in_file,true);assert.equal(card.freshness.file_changed,null);assert.equal(card.freshness.file_header_ignored,"2026-11-14");
  assert.equal(card.freshness.status,"overdue");assert.equal(card.freshness.at_least,true);assert.equal(card.freshness.last_change,"2026-09-01");
  const texts=card.facts.map(f=>f.text).join("\n");
  assert.match(texts,/catalogue says it was updated on 2026-11-10, but the file is byte-for-byte the same as on 2026-09-01/);
  assert.match(texts,/byte-for-byte the same since at least 2026-09-01, 29 days longer/);
  assert.match(texts,/Last-Modified date is the time of each request/);
  // unchanged only since our first sight and nothing else: never "current"
  card=buildCard({id:"r",frequency:"ANNUAL"},prof,{now:"2026-11-14T00:00:00Z",file:{...base,content:{since:"2026-11-07T01:00:00Z",observedSince:"2026-11-07T01:00:00Z"}}});
  assert.equal(card.freshness.status,"unknown");
  // a change seen by the check counts as a change
  card=buildCard({id:"r",frequency:"MONTHLY",updatedAt:"2026-06-01"},prof,{now:"2026-11-14T00:00:00Z",file:{...base,content:{since:"2026-11-14T01:00:00Z",changedAt:"2026-11-14T01:00:00Z",changedAfter:"2026-11-07T01:00:00Z",observedSince:"2026-10-01T01:00:00Z"}}});
  assert.equal(card.freshness.status,"current");assert.equal(card.freshness.last_change_basis,"content change seen");
  assert.match(card.facts.map(f=>f.text).join("\n"),/content changed between 2026-11-07 and 2026-11-14/);
}

// 6. merging runs: a failure keeps last week's profile; stale profiles expire
{
  const now=Date.parse("2026-11-20T00:00:00Z"),ok={url:"u1",profile:{rows:1},checkedAt:"2026-11-13T00:00:00Z"};
  const m=mergeRuns(new Map([["u1",ok],["u2",{url:"u2",profile:{rows:2},checkedAt:"2026-08-01T00:00:00Z"}]]),
    [new Map([["u1",{url:"u1",error:"timeout",checkedAt:"2026-11-20T00:00:00Z"}]]),new Map([["u3",{url:"u3",too_large:true}]])],{now});
  assert.equal(m.get("u1").profile.rows,1);assert.equal(m.get("u1").last_error,"timeout");
  assert.equal(m.has("u2"),false,"a profile older than eight weeks is dropped");assert.equal(m.get("u3").too_large,true);
}

// 7. one file per dataset, public URLs only, shards split by host
const work=loadWork([
  {id:"a",distributions:[{format:"JSON",url:"https://x.be/a.json"},{format:"CSV",url:"https://x.be/a.csv"},{format:"CSV",url:"https://x.be/a_nl.csv"}]},
  {id:"b",distributions:[{format:"CSV",url:"http://127.0.0.1/b.csv"}]},
  {id:"c",tier:"broken",distributions:[{format:"CSV",url:"https://y.be/c.csv"}]},
]);
assert.deepEqual(work.map(w=>w.url),["https://x.be/a_nl.csv"]);
const n=4,urls=Array.from({length:40},(_,i)=>"https://h"+i+".be/f.csv");
for(const u of urls)assert.equal([1,2,3,4].filter(i=>inShard(u,[i,n])).length,1,"every host lands in exactly one shard");
assert.equal(inShard("https://h1.be/a.csv",[2,n]),inShard("https://h1.be/b.csv",[2,n]),"same host, same shard");

console.log(JSON.stringify({ok:true,"full-check":"stream/row-set/headers/history/cap/html/cards/merge/shards",duplicates:streamed.duplicate_rows}));
