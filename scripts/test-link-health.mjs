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
