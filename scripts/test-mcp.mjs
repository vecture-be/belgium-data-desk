import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, writeIndex } from "./build-mcp-index.mjs";
import { handleMcp, idShard, prefixKey, publicOrigin, tokenize, tokenShard } from "../mcp-server.mjs";
import worker, { makePreviewFile } from "../worker.mjs";
import { AUTHORITIES, authoritiesFor } from "../public/dataset-authority-v1.mjs";
import { expandWord } from "../public/dataset-synonyms-v1.mjs";

assert.deepEqual(tokenize("Bevolking per gemeente — population of the Région"),["bevolking","gemeente","population","region"]);
assert.equal(prefixKey("bevolking"),"~bevolk");assert.equal(prefixKey("gas"),null);
assert.equal(tokenShard("~bevolk"),"be");assert.equal(idShard("national:x").length,2);

const d=(format,url)=>({format,url,name:format});
const items=[
  {id:"national:1",title:"Bevolking per gemeente",provider:"Statbel",description:"Population by municipality",dataKind:"dataset",topic:"population",licenseFamily:"open",license:"CC BY",tier:"ready",probe:{at:"2026-10-02",n:1,ok:1,mm:0,cors:1},distributions:[d("CSV","https://statbel.example/pop.csv")],formats:["CSV"],fields:[{name:"nis"},{name:"pop"}]},
  {id:"national:2",title:"Bevolkingsaantal historiek",provider:"Statbel",description:"",dataKind:"publication",topic:"population",licenseFamily:"unknown",distributions:[d("PDF","https://statbel.example/h.pdf")],formats:["PDF"]},
  {id:"national:3",title:"Luchtkwaliteit stations",provider:"VMM",description:"Air quality stations",dataKind:"dataset",topic:"environment",licenseFamily:"non-commercial",license:"CC BY-NC",tier:"download",distributions:[d("CSV","https://vmm.example/air.csv")],formats:["CSV"]},
  {id:"national:5",title:"Census 2021 - Bevolking naar leeftijd",provider:"Statbel",dataKind:"dataset",topic:"population",licenseFamily:"open",seriesId:"series:census",distributions:[d("CSV","https://statbel.example/c1.csv")],formats:["CSV"]},
  {id:"national:6",title:"Census 2021 - Bevolking naar geslacht",provider:"Statbel",dataKind:"dataset",topic:"population",licenseFamily:"open",seriesId:"series:census",distributions:[d("CSV","https://statbel.example/c2.csv")],formats:["CSV"]},
  {id:"national:7",title:"Municipal council election results",provider:"FPS Interior",description:"Results by municipality",dataKind:"dataset",topic:"government",licenseFamily:"open",tier:"ready",distributions:[d("CSV","https://ibz.example/e.csv")],formats:["CSV"]},
  {id:"national:8",title:"Same title",provider:"Pub",dataKind:"dataset",topic:"other",distributions:[d("CSV","https://p.example/1.csv")]},
  {id:"national:9",title:"Same title",provider:"Pub",dataKind:"dataset",topic:"other",distributions:[d("CSV","https://p.example/2.csv")]},
  {id:"national:4",title:"Bevolking kaartlaag",provider:"NGI",dataKind:"map-service",topic:"places",licenseFamily:"open",distributions:[d("WMS","https://ngi.example/wms")],formats:["WMS"]}
];
const relay={["f_"+"0".repeat(32)]:{}};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"mcp-"));
const built=buildIndex(items,{relay});
writeIndex(path.join(dir,"mcp"),built,{records:items.length,ranges:built.ranges,scopes:{datasets:{count:2}},links_last_checked:"2026-10-02"});
let reads=0;
const env={ASSETS:{fetch:async req=>{reads++;const f=path.join(dir,new URL(req.url).pathname);return fs.existsSync(f)?new Response(fs.readFileSync(f),{headers:{"content-type":"application/json"}}):new Response("nf",{status:404})}}};
const rpc=async(method,params,id=1)=>{
  const r=await worker.fetch(new Request("https://desk.example/mcp",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id,method,params})}),env);
  return{status:r.status,body:r.status===202?null:await r.json()};
};

const init=await rpc("initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"t",version:"1"}});
assert.equal(init.body.result.protocolVersion,"2025-03-26");assert.ok(init.body.result.capabilities.tools);
const note=await worker.fetch(new Request("https://desk.example/mcp",{method:"POST",body:JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized"})}),env);
assert.equal(note.status,202);
const list=await rpc("tools/list");
assert.deepEqual(list.body.result.tools.map(t=>t.name).sort(),["air_quality","belgian_statistics","catalogue_overview","fetch","flood_risk","get_dataset","get_subsurface_record","preview_dataset","search","search_datasets","search_subsurface","subsurface_at_location"]);
// Anthropic directory requirements: every tool has a title, readOnlyHint/destructiveHint annotations and a name of at most 64 characters.
assert.ok(list.body.result.tools.every(t=>t.title&&t.annotations.title&&t.annotations.readOnlyHint===true&&t.annotations.destructiveHint===false&&t.name.length<=64));
// only preview_dataset (a publisher's server) and the two DOV tools (DOV's services) reach outside (openWorldHint); the rest answer from the static index
assert.deepEqual(list.body.result.tools.filter(t=>t.annotations.openWorldHint).map(t=>t.name),["preview_dataset","subsurface_at_location","get_subsurface_record","search_subsurface","belgian_statistics","air_quality","flood_risk"]);
// a subsurface question in search points to the live DOV tool; other searches do not
assert.equal((await rpc("tools/call",{name:"search_datasets",arguments:{query:"grondwater boringen"}})).body.result.structuredContent.related_tool.name,"subsurface_at_location");
assert.equal((await rpc("tools/call",{name:"search_datasets",arguments:{query:"bevolking"}})).body.result.structuredContent.related_tool.name,"belgian_statistics");
assert.equal((await rpc("tools/call",{name:"search_datasets",arguments:{query:"luchtkwaliteit"}})).body.result.structuredContent.related_tool.name,"air_quality");
assert.equal((await rpc("tools/call",{name:"search_datasets",arguments:{query:"census"}})).body.result.structuredContent.related_tool,undefined);

// default scope is datasets: the publication and map layer with the same word are excluded, ranking puts the checked dataset first
const s1=(await rpc("tools/call",{name:"search_datasets",arguments:{query:"bevolking"}})).body.result.structuredContent;
assert.equal(s1.results[0].id,"national:1");
assert.equal(s1.results.filter(r=>/Census/.test(r.title)).length,1,"series members collapse to one result");
assert.equal(s1.results.find(r=>/Census/.test(r.title)).more_in_collection,1);
assert.equal(s1.results[0].access_tier,"ready");
// inflection / compound words are found through the prefix fallback
const s2=(await rpc("tools/call",{name:"search_datasets",arguments:{query:"bevolkingsaantal",scope:"publications"}})).body.result.structuredContent;
assert.equal(s2.results[0].id,"national:2");
// description words, scope=all, filters
const s3=(await rpc("tools/call",{name:"search_datasets",arguments:{query:"bevolking",scope:"all"}})).body.result.structuredContent;
assert.equal(s3.results.length,4);assert.equal(s3.results[0].id,"national:1");
const s4=(await rpc("tools/call",{name:"search_datasets",arguments:{query:"air quality",open_licence_only:true}})).body.result.structuredContent;
assert.equal(s4.results.length,0,"non-commercial licence is excluded by open_licence_only");
const s5=(await rpc("tools/call",{name:"search_datasets",arguments:{query:"air quality"}})).body.result.structuredContent;
assert.equal(s5.results[0].id,"national:3");
assert.equal((await rpc("tools/call",{name:"search_datasets",arguments:{query:"???"}})).body.result.isError,true);

const g=(await rpc("tools/call",{name:"get_dataset",arguments:{id:"national:1"}})).body.result.structuredContent;
assert.equal(g.publisher,"Statbel");assert.equal(g.hand_reviewed,false);assert.equal(g.link_check.files_ok,1);assert.deepEqual(g.columns,["nis","pop"]);assert.equal(g.files[0].url,"https://statbel.example/pop.csv");assert.equal(g.preview_available,false);
assert.equal(g.update_cycle,null);assert.match(g.update_cycle_note,/does not state/);assert.equal(g.field_notes.columns,undefined);assert.equal(g.field_notes.link_check,undefined);
assert.equal((await rpc("tools/call",{name:"get_dataset",arguments:{id:"nope"}})).body.result.isError,true);
// a query word no record matches is named instead of silently dropped
const sb=(await rpc("tools/call",{name:"search_datasets",arguments:{query:"bevolking batterijen"}})).body.result.structuredContent;
assert.deepEqual(sb.words_not_matched,["batterijen"]);assert.match(sb.words_note,/No record in the catalogue matches 'batterijen'/);
assert.equal(s1.words_not_matched,undefined);
const ov=(await rpc("tools/call",{name:"catalogue_overview",arguments:{}})).body.result.structuredContent;
assert.equal(ov.links_last_checked,"2026-10-02");assert.match(ov.note,/Evidence, not correctness/);

// cross-language: a Dutch query finds an English-titled record (concept groups), and near-duplicate titles collapse
const nl=(await rpc("tools/call",{name:"search_datasets",arguments:{query:"verkiezingen uitslag"}})).body.result.structuredContent;
assert.equal(nl.results[0].id,"national:7","Dutch 'verkiezingen uitslag' must find 'election results'");
const fr=(await rpc("tools/call",{name:"search_datasets",arguments:{query:"resultats elections commune"}})).body.result.structuredContent;
assert.equal(fr.results[0].id,"national:7");
const dup=(await rpc("tools/call",{name:"search_datasets",arguments:{query:"same title"}})).body.result.structuredContent;
assert.equal(dup.results.length,1);assert.equal(dup.results[0].more_in_collection,1);
assert.ok((await rpc("tools/call",{name:"get_dataset",arguments:{id:"national:1"}})).body.result.structuredContent.web_url.endsWith("/?dataset=national%3A1"));

// ChatGPT deep-research compatibility: search -> [{id,title,url}], fetch(id) -> {id,title,text,url,metadata}
const cs=JSON.parse((await rpc("tools/call",{name:"search",arguments:{query:"bevolking"}})).body.result.content[0].text);
assert.ok(cs.results.length>=1&&cs.results.every(r=>r.id&&r.title&&r.url));
const cf=JSON.parse((await rpc("tools/call",{name:"fetch",arguments:{id:cs.results[0].id}})).body.result.content[0].text);
assert.equal(cf.id,cs.results[0].id);assert.match(cf.text,/Publisher: Statbel/);assert.ok(cf.metadata.licence_family);
assert.equal((await rpc("tools/call",{name:"fetch",arguments:{id:"nope"}})).body.result.isError,true);

// budget: no query may exceed the asset-read allowance (free-plan subrequest cap is 50)
reads=0;await rpc("tools/call",{name:"search_datasets",arguments:{query:"bevolking gemeente luchtkwaliteit census",scope:"all",limit:20}});
assert.ok(reads<=30,"asset reads per query must stay within budget, got "+reads);

// protocol hygiene
assert.equal((await rpc("nope")).body.error.code,-32601);
assert.equal((await rpc("tools/call",{name:"fetch_url",arguments:{url:"http://127.0.0.1"}})).body.error.code,-32602);
const get=await worker.fetch(new Request("https://desk.example/mcp"),env);assert.equal(get.status,405);
const bad=await worker.fetch(new Request("https://desk.example/mcp",{method:"POST",body:"{"}),env);assert.equal((await bad.json()).error.code,-32700);
const big=await worker.fetch(new Request("https://desk.example/mcp",{method:"POST",body:"x".repeat(20000)}),env);assert.equal((await big.json()).error.code,-32600);
const opt=await worker.fetch(new Request("https://desk.example/mcp",{method:"OPTIONS"}),env);assert.equal(opt.status,204);

// Public address: PUBLIC_ORIGIN overrides the request host (data.vecture.be proxies to workers.dev); invalid or non-https values are ignored
{
  const req=new Request("https://belgium-data-desk.example.workers.dev/mcp");
  assert.equal(publicOrigin({PUBLIC_ORIGIN:"https://data.vecture.be/"},req),"https://data.vecture.be");
  assert.equal(publicOrigin({},req),"https://belgium-data-desk.example.workers.dev");
  assert.equal(publicOrigin({PUBLIC_ORIGIN:"http://data.vecture.be"},req),"https://belgium-data-desk.example.workers.dev");
  assert.equal(publicOrigin({PUBLIC_ORIGIN:"not a url"},req),"https://belgium-data-desk.example.workers.dev");
  const r=await worker.fetch(new Request("https://belgium-data-desk.example.workers.dev/mcp",{method:"POST",body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"get_dataset",arguments:{id:"national:1"}}})}),{...env,PUBLIC_ORIGIN:"https://data.vecture.be"});
  assert.equal((await r.json()).result.structuredContent.web_url,"https://data.vecture.be/?dataset=national%3A1");
}

// Concept expansion: multi-word members are not split into stray words ("air quality" must not make "air" match "quality")
assert.ok(!expandWord("air").includes("quality"));assert.ok(!expandWord("poverty").includes("of"));
assert.ok(expandWord("solar").includes("photovoltaic")&&!expandWord("solar").includes("gas"));

// Authoritative sources: matching rules, and an index fixture where a weaker keyword match must not outrank the pinned source
assert.equal(authoritiesFor(["population","municipality"])[0].need,"population counts");
assert.equal(authoritiesFor(["btw","nummer"])[0].need,"enterprise register (enterprise numbers)");
assert.equal(authoritiesFor(["annual","accounts","companies"])[0].need,"company annual accounts","'unless' keeps KBO out of annual-account queries");
assert.equal(authoritiesFor(["bike","counts"])[0].need,"bicycle counts");
assert.equal(authoritiesFor(["bike"]).length,0,"two-part needs need both parts");
assert.equal(authoritiesFor(["energy"]).length,0,"one word cannot satisfy both groups of a two-part need");
for(const a of AUTHORITIES){assert.ok(a.ids.length&&a.why&&a.need&&a.when.length,a.need);for(const id of a.ids)assert.match(id,/^curated:/,a.need)}
{
  const mcpCall=(e,opts)=>async(name,args)=>(await (await handleMcp(new Request("https://desk.example/mcp",{method:"POST",body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}})}),e,opts)).json()).result;
  const dirEnv=dir=>({ASSETS:{fetch:async req=>{const f=path.join(dir,new URL(req.url).pathname);return fs.existsSync(f)?new Response(fs.readFileSync(f)):new Response("nf",{status:404})}}});
  const pinItems=[
    {id:"curated:statbel-pop-residence-2026",title:"Population by place of residence",provider:"Statbel",dataKind:"dataset",topic:"population",curated:true,tier:"download",distributions:[d("CSV","https://statbel.example/r.csv")]},
    {id:"national:p1",title:"City population by municipality and district",provider:"City of Somewhere",description:"population municipality",dataKind:"dataset",topic:"population",licenseFamily:"open",tier:"ready",distributions:[d("CSV","https://city.example/p.csv")]}
  ];
  const pdir=fs.mkdtempSync(path.join(os.tmpdir(),"mcp-pin-")),pb=buildIndex(pinItems);
  writeIndex(path.join(pdir,"mcp"),pb,{records:2,ranges:pb.ranges,pins:{"curated:statbel-pop-residence-2026":pb.ids.get("curated:statbel-pop-residence-2026")}});
  const call=mcpCall(dirEnv(pdir));
  const ps=(await call("search_datasets",{query:"population by municipality"})).structuredContent;
  assert.equal(ps.results[0].id,"curated:statbel-pop-residence-2026");assert.equal(ps.results[0].authoritative_source,true);
  assert.match(ps.guidance.authoritative_source,/Statbel/);assert.match(ps.guidance.caveat,/2025/);
  assert.equal(ps.results.filter(r=>r.id==="curated:statbel-pop-residence-2026").length,1,"a pinned record is not repeated");
  assert.equal((await call("search_datasets",{query:"population by municipality",scope:"maps"})).structuredContent.guidance,undefined,"no pinning outside dataset scope");
  assert.match((await call("get_dataset",{id:"curated:statbel-pop-residence-2026"})).structuredContent.authoritative_source.why,/National Register/);
  assert.match((await call("preview_dataset",{id:"national:p1"})).structuredContent.error,/No previewable CSV/);

  // preview_dataset through the real worker preview path: catalogue relay id only, Belgian CSV dialect, bounded read
  const pv=[{id:"national:pv",title:"Gemeentelijke cijfers",provider:"Statbel",dataKind:"dataset",topic:"population",tier:"ready",updatedAt:"2019-01-21",frequency:"b6d53d524c494e5a9b37bec45c748bf71265-3958c17a2fbfa500",distributions:[d("CSV","https://statbel.example/gem.csv")]}];
  const {createHash}=await import("node:crypto");
  const rid="f_"+createHash("sha256").update("https://statbel.example/gem.csv").digest("hex").slice(0,32);
  const index={[rid]:{url:"https://statbel.example/gem.csv",hosts:["statbel.example"]}};
  const vdir=fs.mkdtempSync(path.join(os.tmpdir(),"mcp-pv-")),vb=buildIndex(pv,{relay:{[rid]:{}}});
  writeIndex(path.join(vdir,"mcp"),vb,{records:1,ranges:vb.ranges});
  const venv=dirEnv(vdir);
  const csv="﻿REFNIS;Gemeente;Inwoners;Dichtheid;TIMESTAMP_EXTRACT\n11001;Aartselaar;14.512;1.340,5;2026-11-01 03:00:00\n11002;Antwerpen;536.079;2.623,1;2026-11-01 03:00:00\n11004;Boechout;13.749;670,2;2026-10-01\n";
  const seen=[];
  const fetchImpl=async(url,init)=>{seen.push({url,range:init.headers.range});return new Response(csv,{status:200,headers:{"content-type":"text/csv","content-length":String(new TextEncoder().encode(csv).length)}})};
  const vcall=mcpCall(venv,{previewFile:makePreviewFile({},{index,fetchImpl})});
  const gv=(await vcall("get_dataset",{id:"national:pv"})).structuredContent;
  assert.equal(gv.preview_available,true);
  // an unresolved blank-node frequency is "not stated", and empty fields say why they are empty
  assert.equal(gv.update_cycle,null);assert.match(gv.update_cycle_note,/cannot be resolved/);
  assert.match(gv.field_notes.columns,/preview_dataset reads the real columns/);assert.match(gv.field_notes.link_check,/not a sign of a broken link/);assert.match(gv.field_notes.updated,/not necessarily when the data was refreshed/);
  const p=(await vcall("preview_dataset",{id:"national:pv",rows:2})).structuredContent;
  assert.equal(p.delimiter,"semicolon");assert.equal(p.decimal_separator,"comma");assert.equal(p.whole_file_read,true);
  assert.deepEqual(p.columns.map(c=>c.name),["REFNIS","Gemeente","Inwoners","Dichtheid","TIMESTAMP_EXTRACT"]);
  // dates in the file later than the catalogue date are reported; numeric columns come with a units warning
  assert.equal(p.freshness.latest_date_in_rows_read,"2026-11-01");assert.equal(p.freshness.column,"TIMESTAMP_EXTRACT");assert.equal(p.freshness.data_newer_than_catalogue_date,true);
  assert.match(p.units,/Inwoners/);assert.match(p.units,/not declared rather than guessing/);
  assert.equal(p.rows.length,2);assert.equal(p.rows[1].Gemeente,"Antwerpen");assert.equal(p.rows_read,3);
  assert.equal(seen[0].url,"https://statbel.example/gem.csv");assert.equal(seen[0].range,"bytes=0-65535","reads only the first 64 KiB");
  // a web page instead of CSV, an unknown id, an id outside the relay index: actionable errors, no crash
  const ph=await mcpCall(venv,{previewFile:makePreviewFile({},{index,fetchImpl:async()=>new Response("<!doctype html><p>moved",{headers:{"content-type":"text/html"}})})})("preview_dataset",{id:"national:pv"});
  assert.equal(ph.isError,true);assert.match(ph.structuredContent.error,/web page instead of a CSV/);
  assert.match((await vcall("preview_dataset",{id:"nope"})).structuredContent.error,/Unknown dataset id/);
  assert.match((await makePreviewFile({},{index:{}})("f_"+"1".repeat(32),1024)).error,/not in the catalogue relay index/);
  // a large file is cut at the budget and labelled as partial
  const bigCsv="a;b\n"+"1;2\n".repeat(40000);
  const big2=(await mcpCall(venv,{previewFile:makePreviewFile({},{index,fetchImpl:async()=>new Response(bigCsv,{status:200})})})("preview_dataset",{id:"national:pv"})).structuredContent;
  assert.equal(big2.whole_file_read,false);assert.match(big2.note,/first 64 KiB/);assert.ok(big2.rows_read<40000);
}

// Every pinned id must exist in the real built index (only when public/mcp was built from a harvested catalogue)
const realManifest=path.join(path.dirname(fileURLToPath(import.meta.url)),"../public/mcp/manifest.json");
if(fs.existsSync(realManifest)){
  const m=JSON.parse(fs.readFileSync(realManifest,"utf8"));
  if(m.records>1000)assert.deepEqual(AUTHORITIES.flatMap(a=>a.ids).filter(id=>!(id in (m.pins||{}))),[],"authority ids missing from the index");
}

console.log(JSON.stringify({ok:true,mcp:"search/get/preview/overview/authority",tools:12}));
