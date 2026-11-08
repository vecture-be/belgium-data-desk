import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { annotateItems, loadProbes } from "./apply-link-health.mjs";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lh-")),file=path.join(dir,"p.jsonl");
const rows=[
  {url:"https://a.example/ok.csv",fmt:"CSV",status:206,sniff:"delimited",cors:"*",checkedAt:"2026-10-02T01:00:00Z"},
  {url:"https://a.example/page.csv",fmt:"CSV",status:200,sniff:"html",checkedAt:"2026-10-02T01:00:01Z"},
  {url:"https://a.example/gone.csv",fmt:"CSV",status:404,checkedAt:"2026-10-02T01:00:02Z"}
];
fs.writeFileSync(file,rows.map(r=>JSON.stringify(r)).join("\n")+"\nnot json\n");
const {byUrl,at}=loadProbes(file);
assert.equal(byUrl.size,3);assert.equal(at,"2026-10-02");
assert.equal(byUrl.get("https://a.example/ok.csv").ok,true);
assert.equal(byUrl.get("https://a.example/page.csv").formatMatch,false);
assert.equal(loadProbes(path.join(dir,"missing.jsonl")).byUrl.size,0);
// Only answers about the link itself count: a probe that was blocked, throttled or timed out says nothing about the file.
const file2=path.join(dir,"p2.jsonl");
fs.writeFileSync(file2,[
  {url:"https://b.example/timeout.csv",fmt:"CSV",error:"TimeoutError"},
  {url:"https://b.example/reset.csv",fmt:"CSV",error:"ECONNRESET"},
  {url:"https://b.example/forbidden.csv",fmt:"CSV",status:403},
  {url:"https://b.example/throttled.csv",fmt:"CSV",status:429},
  {url:"https://b.example/down.csv",fmt:"CSV",status:503},
  {url:"https://b.example/gone.csv",fmt:"CSV",status:410},
  {url:"https://nohost.example/x.csv",fmt:"CSV",error:"ENOTFOUND"},
  // a line already interpreted by probe-links.mjs keeps its raw status and error, so the rule still applies
  {url:"https://b.example/interpreted-timeout.csv",fmt:"CSV",error:"TimeoutError",ok:false,formatMatch:null}
].map(r=>JSON.stringify(r)).join("\n")+"\n");
assert.deepEqual([...loadProbes(file2).byUrl.keys()].sort(),["https://b.example/gone.csv","https://nohost.example/x.csv"],"inconclusive probes are left out");

const d=(url,format="CSV")=>({url,format});
const items=[
  {id:"1",distributions:[d("https://a.example/ok.csv")]},
  {id:"2",distributions:[d("https://a.example/page.csv")]},
  {id:"3",distributions:[d("https://a.example/gone.csv")]},
  {id:"4",distributions:[d("https://b.example/never-probed.csv")]},
  {id:"5",distributions:[d("https://c.example/map","WMS")]},
  {id:"6",distributions:[d("https://a.example/gone.csv"),d("https://a.example/ok.csv")]}
];
assert.equal(annotateItems(items,byUrl),4);
const by=Object.fromEntries(items.map(i=>[i.id,i]));
assert.equal(by[1].tier,"ready");assert.equal(by[1].probe.ok,1);assert.equal(by[1].probe.cors,1);
assert.equal(by[2].tier,"download","HTML served as CSV must not earn READY");assert.equal(by[2].probe.mm,1);
assert.equal(by[3].tier,"broken");
assert.equal(by[4].tier,"download");assert.equal(by[4].probe,undefined,"unprobed records carry no probe claim");
assert.equal(by[5].tier,"service");
assert.equal(by[6].tier,"ready","one working file is enough");assert.equal(by[6].probe.n,2);assert.equal(by[6].probe.ok,1);
annotateItems(items,byUrl);assert.equal(by[1].probe.n,1,"idempotent");
console.log("link health tests passed");
