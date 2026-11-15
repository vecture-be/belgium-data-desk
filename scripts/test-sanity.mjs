// Offline tests for the catalogue sanity gates (scripts/catalogue-sanity.mjs).
import assert from "node:assert/strict";
import { sanity } from "./catalogue-sanity.mjs";

const mk=(n,src,extra={})=>Array.from({length:n},(_,i)=>({id:src+i,title:"Dataset "+i,description:"A dataset about something measurable.",topic:"population",dataKind:"dataset",license:"CC BY",distributions:[{format:"CSV",url:"https://x.example/"+i+".csv"}],_src:src,...extra}));
const healthy={items:[...mk(10000,"data.gov.be"),...mk(1000,"harvest")],sources:{}};
const ok=sanity(healthy,{records:11000});
assert.ok(ok.gates.every(g=>g.ok),"a healthy catalogue passes");
assert.ok(!sanity(healthy,{records:20000}).gates.every(g=>g.ok),"losing 45 % of records against the deployed catalogue fails");
assert.ok(!sanity({items:[...mk(10000,"data.gov.be"),...mk(10,"harvest")],sources:{}}).gates.every(g=>g.ok),"portals that return almost nothing fail");
assert.ok(!sanity({items:[...mk(10000,"data.gov.be",{topic:"other"}),...mk(1000,"harvest")],sources:{}}).gates.every(g=>g.ok),"topics collapsing into other fails");
const future=mk(10,"harvest",{updatedAt:"2099-01-01"});
assert.ok(!sanity({items:[...healthy.items,...future],sources:{}}).gates.every(g=>g.ok),"update dates in the future fail");
const fb=sanity({...healthy,sources:{elia:{fallback:true,error:"timeout"}}});
assert.ok(fb.gates.every(g=>g.ok)&&fb.gates.some(g=>g.warn&&/elia/.test(g.name)),"a source on fallback is a warning, not a failure");
const notes=sanity({items:[...healthy.items,...mk(5,"harvest",{license:"",distributions:[{format:"CSV",url:"http://x.example/a.csv"}]})],sources:{}}).notes;
assert.equal(notes.no_licence.count,5);assert.equal(notes.plain_http_links_only.count,5);
console.log(JSON.stringify({ok:true,sanity:"gates/notes"}));
