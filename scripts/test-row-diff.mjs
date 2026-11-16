// Offline tests for row-level change tracking: row packs, diffs, change summaries, card sentence and the public change log.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeChange, diffSorted, readRowPack, rowKey, writeRowPack } from "./row-diff.mjs";
import { checkFile, ROWS } from "./full-check.mjs";
import { buildCard, changeSentence, profileColumns, setNisReference } from "./dataset-card.mjs";
import { buildChangeLog, renderReadme } from "./change-log.mjs";

const pub=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../public");
setNisReference(JSON.parse(fs.readFileSync(path.join(pub,"statbel/places-v1.json"),"utf8")).places);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"rowdiff-"));

// 1. diff of sorted distinct hashes
assert.deepEqual(diffSorted(new Float64Array([1,3,5,7]),new Float64Array([1,2,5,8,9])),{added:3,removed:2,kept:2});
assert.deepEqual(diffSorted(new Float64Array([]),new Float64Array([4])),{added:1,removed:0,kept:0});

// 2. packs: round trip with 53-bit values, carry-over of entries not seen this run, expiry, mismatched pair
{
  const big=2**53-1,a=new Float64Array([0,12345,big]).sort(),b=new Float64Array([7]);
  const prev=new Map([["old",{hashes:b,checkedAt:"2026-11-01T00:00:00Z"}],["stale",{hashes:b,checkedAt:"2026-01-01T00:00:00Z"}]]);
  const n=writeRowPack(tmp,"rows-1",new Map([["k1",{hashes:a,checkedAt:"2026-11-14T00:00:00Z"}]]),prev,{now:Date.parse("2026-11-14T00:00:00Z")});
  assert.equal(n,2,"current + carried-over, the stale one dropped");
  const back=readRowPack(tmp,"rows-1");
  assert.deepEqual([...back.get("k1").hashes],[0,12345,big],"53-bit hashes survive exactly");
  assert.deepEqual([...back.get("old").hashes],[7]);assert.equal(back.has("stale"),false);
  fs.appendFileSync(path.join(tmp,"rows-1.bin"),Buffer.alloc(8));
  assert.equal(readRowPack(tmp,"rows-1").size,0,"index and data of different sizes: no baseline");
  assert.equal(readRowPack(tmp,"missing").size,0);
  assert.match(rowKey("https://x.be/a.csv"),/^[0-9a-f]{16}$/);
}

// 3. a real change between two downloads: rows added and removed, coverage moved, column added
const v1="station;datum;waarde\n"+["A;2026-11-01;1","B;2026-11-02;2","C;2026-11-03;3"].join("\n")+"\n";
const v2="station;datum;waarde\n"+["A;2026-11-01;1","C;2026-11-03;3","D;2026-11-04;4","E;2026-11-05;5"].join("\n")+"\n";
let body=v1;
const server=http.createServer((req,res)=>{res.writeHead(200,{"content-type":"text/csv"});res.end(body)});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const url="http://127.0.0.1:"+server.address().port+"/m.csv";
try{
  const first=await checkFile({url,fmt:"CSV",ds:"rec-1",prov:"P"});
  assert.equal(first[ROWS].length,3);assert.equal(first.change,undefined,"no change on first sight");
  body=v2;
  const second=await checkFile({url,fmt:"CSV",ds:"rec-1",prov:"P"},{previous:first,prevRows:first[ROWS]});
  const c=second.change;
  assert.deepEqual([c.rows.before,c.rows.after,c.distinct_rows_added,c.distinct_rows_removed],[3,4,2,1]);
  assert.deepEqual(c.coverage,[{column:"datum",before:["2026-11-01","2026-11-03"],after:["2026-11-01","2026-11-05"]}]);
  assert.equal(c.since,first.checkedAt);assert.equal(c.seen_at,second.checkedAt);
  assert.equal(JSON.stringify(second).includes("hashes"),false,"row hashes are not serialised into the results");
  // unchanged next time: the last change seen stays, no new one
  const third=await checkFile({url,fmt:"CSV"},{previous:second,prevRows:second[ROWS]});
  assert.deepEqual(third.change,c);assert.equal(third.unchanged,true);
  // without a row baseline the change is still described, just without row counts
  const noRows=await checkFile({url,fmt:"CSV"},{previous:{...first,profile:{...first.profile}},prevRows:null});
  assert.equal(noRows.change.distinct_rows_added,undefined);assert.deepEqual([noRows.change.rows.before,noRows.change.rows.after],[3,4]);

  // 4. card sentence
  const s=changeSentence({...c,since:"2026-11-07T01:00:00Z",seen_at:"2026-11-14T01:00:00Z"});
  assert.equal(s,"Between the checks of 2026-11-07 and 2026-11-14 the file changed: rows went from 3 to 4; 2 distinct rows added and 1 removed; 'datum' now runs from 2026-11-01 to 2026-11-05 (was 2026-11-01 to 2026-11-03); 'waarde' now ranges from 1 to 5 (was 1 to 3).");
  const card=buildCard({id:"rec-1"},second.profile,{now:second.checkedAt,file:{url,bytesRead:second.bytes,totalBytes:second.total,change:c,content:{since:second.content_since,changedAt:second.content_changed_at,changedAfter:second.changed_after,observedSince:second.observed_since}}});
  assert.deepEqual(card.last_change_seen,c);
  assert.equal(card.facts.filter(f=>/the file changed|content changed between/.test(f.text)).length,1,"one change sentence, not two");

  // 5. change log of the run: only changes seen in this run, biggest first, titles from the records
  const since=new Date(Date.parse(second.checkedAt)-1000).toISOString();
  const other={url:"u2",ds:"rec-2",checkedAt:second.checkedAt,profile:{rows:9},header_check:{last_modified:"missing",issues:[],compared_with:"x"},
    change:{since:"2026-11-07T00:00:00Z",seen_at:second.checkedAt,rows:{before:5,after:9},distinct_rows_added:4,distinct_rows_removed:0}};
  const oldChange={url:"u3",ds:"rec-3",checkedAt:second.checkedAt,profile:{rows:1},header_check:{last_modified:"plausible",issues:["content_changed_etag_same"]},change:{seen_at:"2026-10-01T00:00:00Z",rows:{before:1,after:1}}};
  const log=buildChangeLog([{...second,header_check:{...second.header_check,compared_with:first.checkedAt}},other,oldChange,{url:"u4",ds:"rec-4",checkedAt:second.checkedAt,error:"HTTP 404"}],
    {since,titles:new Map([["rec-1",{title:"Meetstations",publisher:"VMM"}]]),date:"2026-11-14T03:00:00Z"});
  assert.equal(log.run.files_changed,2,"the change seen in October is not in this run's log");
  assert.deepEqual(log.changed.map(x=>x.id),["rec-2","rec-1"],"4+4 rows outweigh 2+1");
  assert.equal(log.changed[1].title,"Meetstations");assert.equal(log.run.failed,1);
  assert.deepEqual(log.run.header_issues,{content_changed_etag_same:1});
  const md=renderReadme(log,[log.run]);
  assert.match(md,/Changed since the previous check: \*\*2\*\*/);
  assert.match(md,/\| \[Meetstations\]\(http:\/\/127\.0\.0\.1:\d+\/m\.csv\) \| VMM \| 3 → 4 \| \+2 \/ −1 distinct rows; datum now 2026-11-01 to 2026-11-05 \(was 2026-11-01 to 2026-11-03\); waarde now 1–5 \(was 1–3\) \|/);
  assert.match(renderReadme({run:log.run,changed:[{id:"x",url:"u",rows:{before:1,after:1}}]},[]),/\| 1 → 1 \| values changed \|/,"never an empty change cell");
  assert.match(md,/- \[2026-11-14\]\(changes\/2026-11-14\.json\): 2 changed of 2 compared/);
}finally{server.close();fs.rmSync(tmp,{recursive:true,force:true})}

console.log(JSON.stringify({ok:true,"row-diff":"diff/pack/change/card/log"}));
