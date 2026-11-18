// "About this data" in the dataset inspector: fills the grid with what the weekly check measured in the file
// (scripts/dataset-card.mjs, /cards/<shard>.json) and lists the other facts. No card means no change, not a verdict.
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

const KEY_LABEL={nis_code:"NIS municipality code",enterprise_number:"Enterprise number (KBO/BCE)",postcode:"Postcode",wgs84_point:"Coordinates",latitude:"Latitude",longitude:"Longitude",lambert72:"Lambert 72"};

const KEY_KINDS=new Set(Object.keys(KEY_LABEL));
const n=v=>Number(v).toLocaleString("en-GB");
// facts the grid above already states: row count, period, join keys, grain
const inGrid=e=>(e.rows!=null&&e.columns!=null)||(e.from&&e.to&&e.column&&e.min==null)||(e.kind&&KEY_KINDS.has(e.kind))||e.rows_tested!=null;
export function renderCard(c){
  // where the publisher's own metadata and the file disagree: first, on their own, so they are not read past
  const dis=(c.disagreements||[]).map(x=>'<li>'+esc(x.text)+'</li>').join("");
  const facts=(c.facts||[]).filter(x=>!inGrid(x.evidence||{})&&!x.evidence?.disagreement).map(x=>'<li>'+esc(x.text)+'</li>').join("");
  return (dis?'<div class="card-disagree"><h4>The publisher\'s metadata and the file disagree</h4><ul class="card-facts">'+dis+'</ul><p class="dk-note">We cannot correct the publisher; where they disagree, the file is what you get.</p></div>':"")+
    (facts?'<div class="card-measured"><h4>Measured in the file</h4><ul class="card-facts">'+facts+'</ul></div>':"");
}
/** Replaces the catalogue's guesses in the "About this data" grid with what the weekly check measured in the file. */
function fillGrid(section,c){
  const set=(k,html)=>{const el=section.querySelector('[data-about="'+k+'"]');if(el)el.innerHTML=html};
  const read=c.file?.rows_exact?"the whole file":"the first "+Math.round((c.file?.bytes_read||0)/1024)+" KB";
  set("when","measured "+esc(c.profiled_at)+" from "+esc(read));
  const g=c.coverage?.grain;
  if(g&&g.rows_tested>=10){
    const cols=g.columns.map(esc).join(" × ");
    set("grain",g.unique?cols+' <em>tested on '+(g.rows_total?"the first "+n(g.rows_tested):n(g.rows_tested))+' rows</em>'
      :g.capped?'not settled <em>'+n(g.rows_tested-g.keys)+' rows still repeat after '+g.columns.length+' columns: '+cols+'</em>'
      :'not unique <em>even by '+cols+', '+n(g.rows_tested-g.keys)+' rows repeat their labels</em>');
  }
  if(c.file?.rows!=null)set("size",(c.file.rows_exact?"":"at least ")+n(c.file.rows)+" rows"+(c.columns?.length?", "+c.columns.length+" columns":""));
  const t=c.coverage?.time;if(t)set("period",esc(t.from===t.to?t.from:t.from+" to "+t.to)+' <em>column '+esc(t.column)+'</em>');
  const keys=c.coverage?.keys||[];if(keys.length)set("keys",esc([...new Set(keys.map(k=>KEY_LABEL[k.kind]||k.kind))].join(", "))+' <em>checked in the file</em>');
  // the Freshness check reads the catalogue date; when the file shows older data, say so there too
  const stale=(c.disagreements||[]).find(d=>d.kind==="catalogue_date_newer_than_data"||d.kind==="declared_cadence_not_met"||d.kind==="declared_cadence_overdue");
  const li=section.querySelector('[data-check="freshness"]');
  if(stale&&li){
    li.className="trust-check warn";const mark=li.querySelector(":scope > .trust-mark");if(mark){mark.textContent="!";mark.setAttribute("aria-label","warn")}
    const span=li.querySelector(":scope > div > span");if(span)span.textContent=t?.to?"The newest date in the file is "+t.to+" (column '"+t.column+"'), whatever the catalogue date says.":stale.text;
  }
}
/** Fills every [data-card-slot] in root with the card of its data-card-slot id. */
export async function fillCardSlots(root=document){
  for(const el of root.querySelectorAll("[data-card-slot]")){
    const id=el.getAttribute("data-card-slot"),c=await loadCard(id);
    if(el.getAttribute("data-card-slot")!==id)continue;   // the inspector moved on to another dataset meanwhile
    el.innerHTML=c?renderCard(c):"";
    const section=el.closest("[data-about-for]");if(c&&section)fillGrid(section,c);
  }
}
