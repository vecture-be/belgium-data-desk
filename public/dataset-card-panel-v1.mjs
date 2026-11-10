// "Dataset card" section of the dataset inspector: the facts computed weekly from the file itself (scripts/dataset-card.mjs),
// fetched lazily from /cards/<shard>.json. Nothing is shown when a dataset has no card; a missing card is not a verdict.
const cache=new Map();
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/** Same shard function as the MCP index (mcp-server.mjs idShard): FNV-1a of the id, low byte in hex. */
export function idShard(id){
  let h=0x811c9dc5;for(let i=0;i<id.length;i++){h^=id.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}
  return(h&0xff).toString(16).padStart(2,"0");
}
async function shard(k){
  if(!cache.has(k))cache.set(k,fetch("/cards/"+k+".json").then(r=>r.ok?r.json():{}).catch(()=>({})));
  return cache.get(k);
}
export async function loadCard(id){
  for(const key of [id,"curated:"+id]){const s=await shard(idShard(key));if(s[key])return s[key]}
  return null;
}

const FRESH={current:["ok","Kept up to date"],overdue:["warn","Overdue"],unknown:["","No update cycle to check"]};
const KEY_LABEL={nis_code:"NIS municipality code",enterprise_number:"Enterprise number (KBO/BCE)",postcode:"Postcode",wgs84_point:"Coordinates",latitude:"Latitude",longitude:"Longitude",lambert72:"Lambert 72"};

export function renderCard(c){
  const f=c.freshness||{},[cls,label]=FRESH[f.status]||FRESH.unknown,time=c.coverage?.time,keys=c.coverage?.keys||[];
  const chips=[
    '<span class="card-chip '+cls+'"><small>UPDATES</small><b>'+esc(label)+'</b>'+(f.declared?'<em>declared '+esc(f.declared)+(f.last_change?', last change '+esc(f.last_change):'')+'</em>':'')+'</span>',
    time?'<span class="card-chip"><small>DATA COVERS</small><b>'+esc(time.from===time.to?time.from:time.from+" – "+time.to)+'</b><em>column '+esc(time.column)+'</em></span>':'',
    keys.length?'<span class="card-chip ok"><small>JOINS ON</small><b>'+esc([...new Set(keys.map(k=>KEY_LABEL[k.kind]||k.kind))].join(", "))+'</b>'+(keys.some(k=>k.pre_2025_codes_pct)?'<em>includes pre-2025 municipality codes</em>':'')+'</span>':'',
    c.schema?.changed_since?'<span class="card-chip warn"><small>COLUMNS</small><b>Changed</b><em>since '+esc(c.schema.changed_since)+'</em></span>':''
  ].join("");
  const facts=(c.facts||[]).map(x=>'<li>'+esc(x.text)+'</li>').join("");
  const read=c.file?.rows_exact?"the whole file":"the first "+Math.round((c.file?.bytes_read||0)/1024)+" KiB of the file";
  return '<section class="dataset-card-panel"><div class="section-cap"><h3>Dataset card</h3><span>Computed on '+esc(c.profiled_at)+' from '+esc(read)+' — facts with their evidence, not a quality verdict</span></div>'+
    '<div class="card-chips">'+chips+'</div><ul class="card-facts">'+facts+'</ul></section>';
}

/** Fills every [data-card-slot] in root with the card of its data-card-slot id. */
export async function fillCardSlots(root=document){
  for(const el of root.querySelectorAll("[data-card-slot]")){
    const id=el.getAttribute("data-card-slot"),c=await loadCard(id);
    if(el.getAttribute("data-card-slot")!==id)continue;   // the inspector moved on to another dataset meanwhile
    el.innerHTML=c?renderCard(c):"";
  }
}
