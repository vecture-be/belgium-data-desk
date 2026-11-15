// Catalogue sanity: checks on the catalogue as a whole, run at every build after the topics and link health are applied.
//   node scripts/catalogue-sanity.mjs [--previous https://data.vecture.be]
// Two kinds of result, written to public/catalogue-sanity.json (catalogue_overview returns it):
//   gates   stop the deploy: a catalogue that shrank sharply against the deployed one, a harvested source that returned almost
//           nothing, topics collapsing into "other", dates in the future. A broken harvest must never replace a good catalogue.
//   notes   counts and examples of record-level problems the publishers own (no licence, plain-http links, titles that are file
//           names or ids): published as evidence, never a reason to stop.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pub=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../public");
const arg=process.argv.indexOf("--previous"),previousOrigin=arg>0?process.argv[arg+1]:process.env.SANITY_PREVIOUS_ORIGIN||null;

export function loadItems(dir=pub){
  const items=[],idx=JSON.parse(fs.readFileSync(path.join(dir,"national-catalog.json"),"utf8"));
  for(const c of idx.chunks||[])items.push(...(JSON.parse(fs.readFileSync(path.join(dir,c.file),"utf8")).items||[]).map(x=>({...x,_src:"data.gov.be"})));
  const hv=JSON.parse(fs.readFileSync(path.join(dir,"harvested-catalog.json"),"utf8"));
  for(const x of hv.items||[])items.push({...x,_src:"harvest"});
  return{items,sources:hv.sources||{}};
}
const dist=x=>(x.distributions||[]).map(d=>Array.isArray(d)?{format:d[1],url:d[4]}:d);
const NOTES={
  no_licence:x=>!x.license&&(!x.licenseFamily||x.licenseFamily==="unknown"),
  plain_http_links_only:x=>dist(x).length>0&&dist(x).every(d=>/^http:\/\//i.test(d.url||"")),
  no_links:x=>dist(x).length===0&&!x.officialUrl,
  title_is_file_or_id:x=>/^[\w.-]+\.(csv|json|xlsx?|zip|shp)$|^[0-9a-f-]{20,}$|^[a-z0-9]+(_[a-z0-9]+){2,}$/i.test(String(x.title||"").trim()),
  description_missing_or_title:x=>{const d=String(x.description||"").trim().toLowerCase();return d.length<20||d===String(x.title||"").trim().toLowerCase()}
};

/** Pure: the checks for a catalogue, against the previously deployed counts when given. Returns {gates, notes, counts}. */
export function sanity({items,sources},previous=null,{now=Date.now()}={}){
  const datasets=items.filter(x=>(x.dataKind||"dataset")==="dataset");
  const counts={records:items.length,datasets:datasets.length,national:items.filter(x=>x._src==="data.gov.be").length,harvested:items.filter(x=>x._src==="harvest").length,
    topic_other_pct:datasets.length?Math.round(datasets.filter(x=>x.topic==="other").length/datasets.length*1000)/10:0};
  const gates=[],gate=(ok,name,detail)=>gates.push({ok,name,detail});
  gate(counts.national>=10000,"national catalogue has at least 10,000 records",String(counts.national));
  gate(counts.harvested>=1000,"directly harvested portals give at least 1,000 records",String(counts.harvested));
  if(previous?.records)gate(counts.records>=previous.records*0.85,"no more than 15 % fewer records than the deployed catalogue",counts.records+" vs "+previous.records);
  gate(counts.topic_other_pct<=10,"at most 10 % of datasets without a topic",counts.topic_other_pct+" %");
  const future=items.filter(x=>Date.parse(x.updatedAt||"")>now+2*86400000);
  gate(future.length<=5,"no update dates in the future",future.length+(future.length?" e.g. "+future.slice(0,2).map(x=>x.title.slice(0,40)+" "+x.updatedAt).join("; "):""));
  for(const [name,s] of Object.entries(sources||{}))if(s.fallback)gates.push({ok:true,warn:true,name:"source "+name+" kept its previous records",detail:s.error||""});
  const notes={};
  for(const [k,f] of Object.entries(NOTES)){const hit=items.filter(x=>{try{return f(x)}catch{return false}});notes[k]={count:hit.length,pct:Math.round(hit.length/items.length*1000)/10,examples:hit.slice(0,3).map(x=>({id:x.id,title:String(x.title||"").slice(0,80)}))}}
  return{gates,notes,counts};
}

async function main(){
  let previous=null;
  if(previousOrigin){try{const r=await fetch(previousOrigin.replace(/\/$/,"")+"/catalogue-sanity.json");if(r.ok)previous=(await r.json()).counts}catch{}}
  const result=sanity(loadItems(),previous);
  fs.writeFileSync(path.join(pub,"catalogue-sanity.json"),JSON.stringify({checked:new Date().toISOString().slice(0,10),...result})+"\n");
  for(const g of result.gates)console.log((g.ok?(g.warn?"  WARN ":"  PASS "):"  FAIL ")+g.name+(g.detail?" ("+g.detail+")":""));
  console.log("  notes: "+Object.entries(result.notes).map(([k,v])=>k+" "+v.count+" ("+v.pct+" %)").join(", "));
  if(result.gates.some(g=>!g.ok)){console.error("[sanity] a gate failed: the catalogue is not deployed");process.exit(1)}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
