import { ASSETS, DATASET_RELATIONSHIPS, ATLAS_VERSION } from "./dataset-atlas-v1.mjs";
import { EXTRA_ATLAS_ASSETS } from "./dataset-atlas-extra-v1.mjs";
import { COMPLETENESS_ASSETS } from "./dataset-atlas-completeness-v1.mjs";
import { COMPLETENESS_ASSETS_V2 } from "./dataset-atlas-completeness-v2.mjs";
import { SOURCES as BASE } from "./data.mjs";
import { EXTRA_SOURCES } from "./deep-data.mjs";
import { SOURCE_OVERRIDES } from "./factcheck-v1.mjs";

const MODELED=[...ASSETS,...EXTRA_ATLAS_ASSETS,...COMPLETENESS_ASSETS,...COMPLETENESS_ASSETS_V2].map(a=>({...a,depth:"modelled"}));
const SOURCES=[...BASE,...EXTRA_SOURCES].map(s=>({...s,...(SOURCE_OVERRIDES[s.id]||{})}));
const sourceBy=id=>SOURCES.find(s=>s.id===id);
const modeledBy=id=>MODELED.find(a=>a.id===id);
const $=(s,r=document)=>r.querySelector(s);
const esc=(v="")=>String(v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const norm=v=>String(v||"").toLowerCase();
const stackKey="bdd-asset-stack-v2";
const state={q:"",source:"",kind:"",format:"",depth:"",selected:MODELED[0]?.id||"",stack:new Set(JSON.parse(localStorage.getItem(stackKey)||"[]")),harvested:[]};

const harvestToAsset=h=>({
  id:h.id,depth:h.enrichment?.level||"harvested",sourceId:"",product:h.provider||h.platform||"Harvested catalogue",
  title:h.title,datasetId:h.datasetId||h.id,kind:h.kind||"catalogue dataset",shape:h.platform||"catalogue metadata",
  grain:"semantic grain not audited",time:h.updatedAt?"updated "+String(h.updatedAt).slice(0,10):"catalogue metadata",
  space:h.extent?.spatial?"published spatial extent":"see publisher metadata",cadence:"publisher-defined",formats:h.formats||[],
  schema:(h.fields||[]).map(x=>[x.name||x.label||"field",x.type||"field",x.description||x.label||"published field"]),
  distributions:(h.distributions||[]).map(d=>[d.name||d.format||"resource",d.format||"resource","publisher-defined","see source",d.url||h.officialUrl]),
  versioning:"Machine-harvested catalogue/schema metadata.",caveat:h.enrichment?.level==="structured"?"Field schema is publisher-exposed, but observation semantics are not yet human-audited.":"Catalogue metadata only; schema and grain are not audited.",
  evidence:[h.officialUrl].filter(Boolean),description:h.description||"",provider:h.provider||"",platform:h.platform||"",updatedAt:h.updatedAt||null,
  recordCount:Number.isFinite(h.recordCount)?h.recordCount:null,previewRows:h.previewRows||[],extent:h.extent||{},themes:h.themes||[],license:h.license||"",enrichment:h.enrichment||{level:"harvested",score:0,reasons:[]}
});
const all=()=>[...MODELED,...state.harvested];
const by=id=>all().find(a=>a.id===id);
const srcLabel=a=>a.depth==="harvested"?(a.provider||a.product):(sourceBy(a.sourceId)?.name||a.product);

async function loadHarvest(){
  try{
    const r=await fetch("/harvested-catalog.json",{cache:"no-store"});
    if(!r.ok)throw new Error(String(r.status));
    const j=await r.json();
    state.harvested=(j.items||[]).map(harvestToAsset).filter(x=>!MODELED.some(m=>m.datasetId===x.datasetId&&srcLabel(m).includes(x.provider)));
    $("#harvestMeta").textContent=MODELED.length+" modelled · "+(j.structuredCount||state.harvested.filter(x=>x.depth==="structured").length)+" structured · "+(j.previewCount||state.harvested.filter(x=>x.previewRows?.length).length)+" sampled";
  }catch{$("#harvestMeta").textContent="harvest unavailable"}
  renderFilters();renderList();
}
function vals(field){return[...new Set(all().flatMap(a=>Array.isArray(a[field])?a[field]:[a[field]])).values()].filter(Boolean).sort()}
function matches(a){
  const hay=norm([a.title,a.datasetId,a.product,a.kind,a.shape,a.grain,a.time,a.space,a.cadence,a.description,...a.formats,...(a.schema||[]).flat(),...(a.distributions||[]).flat()].join(" "));
  return(!state.q||hay.includes(norm(state.q)))&&(!state.depth||a.depth===state.depth)&&(!state.source||srcLabel(a)===state.source)&&(!state.kind||a.kind===state.kind)&&(!state.format||a.formats.includes(state.format));
}
function fill(sel,items,label){const el=$(sel),cur=el.value;el.innerHTML='<option value="">'+esc(label)+'</option>'+items.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");if(items.includes(cur))el.value=cur}
function renderFilters(){
  fill("#dsSource",[...new Set(all().map(srcLabel))].sort(),"All publishers");
  fill("#dsKind",vals("kind"),"All kinds");
  fill("#dsFormat",vals("formats"),"All formats");
  $("#dsSource").value=state.source;$("#dsKind").value=state.kind;$("#dsFormat").value=state.format;$("#dsDepth").value=state.depth;
}
function row(a){
  const active=a.id===state.selected,pinned=state.stack.has(a.id);
  return '<button class="asset-row '+(active?"active":"")+'" data-asset="'+esc(a.id)+'"><div class="asset-row-top"><span>'+esc(srcLabel(a))+'</span><em class="depth '+a.depth+'">'+(a.depth==="modelled"?"MODELLED":a.depth==="structured"?"STRUCTURED":"HARVESTED")+'</em></div><b>'+esc(a.title)+'</b><div class="asset-line"><code>'+esc(a.datasetId)+'</code><span>'+esc(a.kind)+'</span>'+(a.recordCount!=null?'<span>'+Number(a.recordCount).toLocaleString()+" rows</span>":"")+(a.previewRows?.length?'<span class="sample-chip">sample</span>':"")+'</div>'+(pinned?'<small class="stack-mark">STACKED</small>':"")+'</button>';
}
function renderList(){
  const list=all().filter(matches);
  $("#dsCount").textContent=list.length+" assets";
  $("#assetList").innerHTML=list.map(row).join("")||'<div class="dataset-empty">No match.</div>';
  if(!list.some(a=>a.id===state.selected)&&list[0])state.selected=list[0].id;
  renderInspector();
}
function relations(id){return DATASET_RELATIONSHIPS.filter(r=>r.from===id||r.to===id)}
function previewUrl(a){
  if(a.depth!=="modelled"){
    const u=(a.distributions||[]).map(d=>d[4]).find(u=>u&&(/\/api\/explore\/v2\.1\//.test(u)||/\/items(?:\?|$)/.test(u)));
    return u?(/\/items$/.test(u)?u+"?limit=5":u.replace(/limit=20/,"limit=5")):null;
  }
  if(a.sourceId==="elia")return "https://opendata.elia.be/api/explore/v2.1/catalog/datasets/"+encodeURIComponent(a.datasetId)+"/records?limit=5";
  if(a.sourceId==="infrabel")return "https://opendata.infrabel.be/api/explore/v2.1/catalog/datasets/"+encodeURIComponent(a.datasetId)+"/records?limit=5";
  return (a.distributions||[]).map(d=>d[4]).find(u=>u&&/\/items(?:\?|$)/.test(u))||null;
}
function cell(v){if(v==null)return "—";if(typeof v==="object")v=JSON.stringify(v);v=String(v);return v.length>90?v.slice(0,87)+"…":v}
async function loadPreview(a){
  const box=$("#livePreview"),url=previewUrl(a);if(!box||!url)return;
  box.innerHTML='<div class="preview-loading">loading…</div>';
  try{
    const r=await fetch(url,{headers:{accept:"application/json"}});if(!r.ok)throw new Error(String(r.status));
    const j=await r.json();
    let rows=j.results||j.features?.map(x=>({...x.properties,_geometry:x.geometry?.type}))||[];
    rows=rows.slice(0,5);if(!rows.length){box.textContent="No rows returned.";return}
    const cols=[...new Set(rows.flatMap(x=>Object.keys(x)))].slice(0,6);
    box.innerHTML='<div class="preview-table"><div class="preview-row head">'+cols.map(k=>'<b>'+esc(k)+'</b>').join("")+'</div>'+rows.map(row=>'<div class="preview-row">'+cols.map(k=>'<span>'+esc(cell(row[k]))+'</span>').join("")+'</div>').join("")+'</div><small>live sample · up to 5 rows · '+esc(new URL(url).hostname)+'</small>';
  }catch(e){box.innerHTML='<div class="preview-error">Preview unavailable ('+esc(e.message)+').</div>'}
}

function snapshotPreview(a){
  const rows=a.previewRows||[];if(!rows.length)return "";
  const cols=[...new Set(rows.flatMap(x=>Object.keys(x)))].slice(0,6);
  return '<section class="snapshot-preview"><div class="section-cap"><h3>Sample</h3><span>ingested at build</span></div><div class="preview-table"><div class="preview-row head">'+cols.map(k=>'<b>'+esc(k)+'</b>').join("")+'</div>'+rows.map(row=>'<div class="preview-row">'+cols.map(k=>'<span>'+esc(cell(row[k]))+'</span>').join("")+'</div>').join("")+'</div></section>';
}

function detailsModeled(a){
  const rel=relations(a.id);
  return '<details class="deep-details"><summary>Schema, version & evidence</summary>'+
    '<div class="schema-mini">'+(a.schema||[]).map(f=>'<div><code>'+esc(f[0])+'</code><span>'+esc(f[1])+'</span><p>'+esc(f[2])+'</p></div>').join("")+'</div>'+
    '<div class="notes-mini"><p><b>Version</b> '+esc(a.versioning)+'</p><p><b>Watch</b> '+esc(a.caveat)+'</p></div>'+
    (rel.length?'<div class="relations-mini">'+rel.map(r=>{const other=modeledBy(r.from===a.id?r.to:r.from);return other?'<button data-related="'+other.id+'"><b>'+esc(r.type)+'</b><span>'+esc(other.title)+'</span><code>'+esc(r.key)+'</code></button>':""}).join("")+'</div>':"")+
    '<div class="evidence-mini">'+(a.evidence||[]).map(u=>'<a href="'+esc(u)+'" target="_blank" rel="noopener">evidence ↗</a>').join("")+'</div></details>';
}
function detailsHarvested(a){
  const structured=a.depth==="structured";
  return '<details class="deep-details"><summary>'+(structured?"Published schema & metadata":"Harvested metadata")+'</summary>'+
    (structured&&a.schema.length?'<div class="schema-mini">'+a.schema.slice(0,40).map(f=>'<div><code>'+esc(f[0])+'</code><span>'+esc(f[1])+'</span><p>'+esc(f[2])+'</p></div>').join("")+'</div>':"")+
    '<p class="harvest-note">'+esc(a.description||"No description in catalogue snapshot.")+'</p>'+
    '<div class="harvest-facts">'+
      (a.recordCount!=null?'<span><b>'+Number(a.recordCount).toLocaleString()+'</b> records</span>':"")+
      (a.schema.length?'<span><b>'+a.schema.length+'</b> fields</span>':"")+
      (a.license?'<span>'+esc(a.license)+'</span>':"")+
      (a.extent?.temporal?'<span>time extent published</span>':"")+
      (a.extent?.spatial?'<span>spatial extent published</span>':"")+
    '</div><p class="harvest-note"><b>Scope:</b> '+(structured?"machine-published structure; semantic grain not yet human-audited.":"real catalogue entry; schema/grain not yet audited.")+'</p></details>';
}
function renderInspector(){
  const a=by(state.selected);if(!a)return;
  const modelled=a.depth==="modelled";
  $("#assetInspector").innerHTML=
    '<header class="asset-inspector-head"><div class="hierarchy"><span>'+esc(srcLabel(a))+'</span><i>›</i><strong>'+esc(a.datasetId)+'</strong></div><h2>'+esc(a.title)+'</h2><div class="dataset-actions"><button id="assetStackToggle" class="'+(state.stack.has(a.id)?"stacked":"")+'">'+(state.stack.has(a.id)?"✓ Stacked":"+ Stack")+'</button>'+(a.evidence?.[0]?'<a href="'+esc(a.evidence[0])+'" target="_blank" rel="noopener">Official ↗</a>':"")+'</div></header>'+
    '<div class="compact-facts"><div><small>GRAIN</small><b>'+esc(a.grain)+'</b></div><div><small>'+(modelled?"TIME":a.depth==="structured"?"STRUCTURE":"METADATA")+'</small><b>'+esc(modelled?a.time:(a.depth==="structured"?(a.schema.length+" fields"+(a.recordCount!=null?" · "+Number(a.recordCount).toLocaleString()+" rows":"")):"catalogue only"))+'</b></div><div><small>DELIVERY</small><b>'+esc(a.formats.slice(0,3).join(" · ")||a.shape)+'</b></div><div><small>'+(modelled?"CADENCE":"UPDATED")+'</small><b>'+esc(modelled?a.cadence:(a.updatedAt?String(a.updatedAt).slice(0,10):"publisher metadata"))+'</b></div></div>'+
    snapshotPreview(a)+'<section class="compact-section"><div class="section-cap"><h3>Distributions</h3><span>'+a.distributions.length+'</span></div><div class="distribution-list compact">'+a.distributions.map(d=>'<article><div><b>'+esc(d[0])+'</b><small>'+esc(d[1])+'</small></div><a href="'+esc(d[4])+'" target="_blank" rel="noopener">open ↗</a></article>').join("")+'</div></section>'+ (previewUrl(a)?'<section class="live-preview-section"><div class="section-cap"><h3>Live</h3><button id="previewBtn">'+(a.previewRows?.length?"Refresh live":"Preview 5 rows")+'</button></div><div id="livePreview"></div></section>':"")+
    (modelled?'<div class="one-warning">'+esc(a.caveat)+'</div>':"")+
    (modelled?detailsModeled(a):detailsHarvested(a));
  $("#assetStackToggle").onclick=()=>{state.stack.has(a.id)?state.stack.delete(a.id):state.stack.add(a.id);saveStack();renderList()};const pb=$("#previewBtn");if(pb)pb.onclick=()=>loadPreview(a);
}
function saveStack(){localStorage.setItem(stackKey,JSON.stringify([...state.stack]));renderStack()}
function renderStack(){
  const el=$("#datasetStackBar"),picked=[...state.stack].map(by).filter(Boolean);if(!picked.length){el.hidden=true;return}
  el.hidden=false;el.innerHTML='<div><b>'+picked.length+' stacked</b><span>'+picked.slice(0,2).map(x=>x.title).join(" · ")+(picked.length>2?" · …":"")+'</span></div><div><button id="dsExport">Export</button><button id="dsClear">Clear</button></div>';
  $("#dsClear").onclick=()=>{state.stack.clear();saveStack();renderList()};
  $("#dsExport").onclick=()=>{const ids=new Set(picked.filter(x=>x.depth==="modelled").map(x=>x.id));const payload={atlasVersion:ATLAS_VERSION,generated:new Date().toISOString(),assets:picked,relationships:DATASET_RELATIONSHIPS.filter(r=>ids.has(r.from)&&ids.has(r.to))};const b=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),l=document.createElement("a");l.href=URL.createObjectURL(b);l.download="belgium-data-assets.json";l.click();setTimeout(()=>URL.revokeObjectURL(l.href),800)};
}
function reset(){state.q=state.source=state.kind=state.format=state.depth="";$("#datasetSearch").value="";renderFilters();renderList()}
function init(){
  renderFilters();renderList();renderStack();loadHarvest();
  $("#datasetSearch").oninput=e=>{state.q=e.target.value.trim();renderList()};
  [["#dsSource","source"],["#dsKind","kind"],["#dsFormat","format"],["#dsDepth","depth"]].forEach(([s,k])=>$(s).onchange=e=>{state[k]=e.target.value;renderList()});
  $("#dsReset").onclick=reset;
  document.addEventListener("click",e=>{const a=e.target.closest("[data-asset]");if(a){state.selected=a.dataset.asset;renderList()}const r=e.target.closest("[data-related]");if(r){state.selected=r.dataset.related;renderList();$("#assetInspector").scrollIntoView({behavior:"smooth",block:"start"})}});
}
init();