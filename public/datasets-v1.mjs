import { ASSETS, DATASET_RELATIONSHIPS, ATLAS_VERSION } from "./dataset-atlas-v1.mjs";
import { SOURCES as BASE } from "./data.mjs";
import { EXTRA_SOURCES } from "./deep-data.mjs";
import { SOURCE_OVERRIDES } from "./factcheck-v1.mjs";

const SOURCES=[...BASE,...EXTRA_SOURCES].map(s=>({...s,...(SOURCE_OVERRIDES[s.id]||{})}));
const sourceBy=id=>SOURCES.find(s=>s.id===id);
const by=id=>ASSETS.find(a=>a.id===id);
const $=(s,r=document)=>r.querySelector(s);
const esc=(v="")=>String(v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const norm=v=>String(v||"").toLowerCase();
const stackKey="bdd-asset-stack-v1";
const safe=()=>{try{let x=JSON.parse(localStorage.getItem(stackKey)||"[]");return Array.isArray(x)?x:[]}catch{return[]}};
const state={q:"",source:"",kind:"",shape:"",format:"",selected:ASSETS[0]?.id||"",stack:new Set(safe())};

function values(field){return[...new Set(ASSETS.flatMap(a=>Array.isArray(a[field])?a[field]:[a[field]])).values()].filter(Boolean).sort()}
function sourceName(id){return sourceBy(id)?.name||id}
function matches(a){
  const hay=norm([a.title,a.datasetId,a.product,a.kind,a.shape,a.grain,a.time,a.space,a.cadence,...a.formats,...a.schema.flat(),...a.distributions.flat(),a.versioning,a.caveat,sourceName(a.sourceId)].join(" "));
  return(!state.q||hay.includes(norm(state.q)))&&(!state.source||a.sourceId===state.source)&&(!state.kind||a.kind===state.kind)&&(!state.shape||a.shape===state.shape)&&(!state.format||a.formats.includes(state.format));
}
function fillSelect(sel,items,label,display=x=>x){
  let el=$(sel),current=el.value;el.innerHTML='<option value="">'+esc(label)+'</option>'+items.map(x=>'<option value="'+esc(x)+'">'+esc(display(x))+'</option>').join("");if(items.includes(current))el.value=current;
}
function renderFilters(){
  fillSelect("#dsSource",[...new Set(ASSETS.map(a=>a.sourceId))].sort(),"All publishers",sourceName);
  fillSelect("#dsKind",values("kind"),"All dataset kinds");
  fillSelect("#dsShape",values("shape"),"All shapes");
  fillSelect("#dsFormat",values("formats"),"All formats");
  $("#dsSource").value=state.source;$("#dsKind").value=state.kind;$("#dsShape").value=state.shape;$("#dsFormat").value=state.format;
}
function card(a){
  const src=sourceBy(a.sourceId),active=a.id===state.selected,pinned=state.stack.has(a.id);
  return '<button class="asset-row '+(active?"active":"")+'" data-asset="'+a.id+'"><div class="asset-row-top"><span>'+esc(src?.org||src?.name||a.sourceId)+'</span><code>'+esc(a.datasetId)+'</code></div><b>'+esc(a.title)+'</b><p>'+esc(a.grain)+'</p><div class="asset-row-meta"><span>'+esc(a.kind)+'</span><span>'+esc(a.time)+'</span><span>'+a.distributions.length+' distribution'+(a.distributions.length===1?"":"s")+'</span>'+(pinned?'<em>STACKED</em>':"")+'</div></button>';
}
function renderList(){
  let list=ASSETS.filter(matches);
  $("#dsCount").textContent=list.length+" concrete asset"+(list.length===1?"":"s");
  $("#assetList").innerHTML=list.map(card).join("")||'<div class="dataset-empty"><b>No matching concrete assets.</b><span>Clear a filter or search for a format, field, grain or dataset ID.</span></div>';
  if(!list.some(a=>a.id===state.selected)&&list[0])state.selected=list[0].id;
  renderInspector();
}
function rels(id){return DATASET_RELATIONSHIPS.filter(r=>r.from===id||r.to===id)}
function renderInspector(){
  const a=by(state.selected);if(!a){$("#assetInspector").innerHTML="";return}
  const src=sourceBy(a.sourceId),related=rels(a.id);
  $("#assetInspector").innerHTML='<div class="asset-inspector-head"><div class="hierarchy"><span>'+esc(src?.name||a.sourceId)+'</span><i>›</i><span>'+esc(a.product)+'</span><i>›</i><strong>'+esc(a.datasetId)+'</strong></div><h2>'+esc(a.title)+'</h2><div class="dataset-actions"><button id="assetStackToggle" class="'+(state.stack.has(a.id)?"stacked":"")+'">'+(state.stack.has(a.id)?"✓ In concrete stack":"+ Add concrete asset")+'</button><a href="'+esc(a.evidence[0])+'" target="_blank" rel="noopener">Official evidence ↗</a></div></div>'+
  '<section class="observation-model"><h3>Observation model</h3><div class="model-grid"><div><small>ONE RECORD / FEATURE</small><b>'+esc(a.grain)+'</b></div><div><small>TIME SEMANTICS</small><b>'+esc(a.time)+'</b></div><div><small>SPATIAL / ENTITY GRAIN</small><b>'+esc(a.space)+'</b></div><div><small>PUBLICATION CADENCE</small><b>'+esc(a.cadence)+'</b></div></div></section>'+
  '<section><div class="section-cap"><h3>Schema sample</h3><span>descriptive, not necessarily exhaustive</span></div><div class="schema-table">'+a.schema.map(f=>'<div class="schema-row"><code>'+esc(f[0])+'</code><span>'+esc(f[1])+'</span><p>'+esc(f[2])+'</p></div>').join("")+'</div></section>'+
  '<section><div class="section-cap"><h3>Distributions / endpoints</h3><span>same logical asset, different delivery mechanics</span></div><div class="distribution-list">'+a.distributions.map(d=>'<article><div><b>'+esc(d[0])+'</b><small>'+esc(d[1])+'</small></div><span>'+esc(d[2])+'</span><em>'+esc(d[3])+'</em><a href="'+esc(d[4])+'" target="_blank" rel="noopener">open ↗</a></article>').join("")+'</div></section>'+
  '<section class="version-box"><div><small>VERSION / SNAPSHOT SEMANTICS</small><p>'+esc(a.versioning)+'</p></div><div><small>DO NOT ASSUME</small><p>'+esc(a.caveat)+'</p></div></section>'+
  (related.length?'<section><div class="section-cap"><h3>Concrete relationships</h3><span>asset-to-asset, not publisher-to-publisher</span></div><div class="dataset-relations">'+related.map(r=>{let other=by(r.from===a.id?r.to:r.from);return'<button data-related="'+other.id+'"><div><b>'+esc(r.type)+'</b><span>'+esc(a.title)+' ↔ '+esc(other.title)+'</span></div><strong>'+esc(r.evidenceLevel||"typed relation")+'</strong><code>'+esc(r.key)+'</code><p>'+esc(r.note)+'</p></button>'}).join("")+'</div></section>':"")+
  '<section class="dataset-evidence"><div class="section-cap"><h3>Evidence</h3><span>atlas audit '+esc(ATLAS_VERSION)+'</span></div>'+a.evidence.map(u=>'<a href="'+esc(u)+'" target="_blank" rel="noopener">'+esc(u.replace(/^https?:\/\//,""))+' ↗</a>').join("")+'</section>';
  $("#assetStackToggle").onclick=()=>{state.stack.has(a.id)?state.stack.delete(a.id):state.stack.add(a.id);saveStack();renderList()};
}
function saveStack(){localStorage.setItem(stackKey,JSON.stringify([...state.stack]));renderStackBar()}
function renderStackBar(){
  let el=$("#datasetStackBar"),count=state.stack.size;if(!count){el.hidden=true;return}el.hidden=false;
  const picked=[...state.stack].map(by).filter(Boolean);
  el.innerHTML='<div><b>'+count+' concrete asset'+(count===1?"":"s")+'</b><span>'+picked.slice(0,3).map(a=>a.title).join(" · ")+(count>3?" · …":"")+'</span></div><div><button id="dsExport">Export concrete manifest</button><button id="dsClear">Clear</button></div>';
  $("#dsClear").onclick=()=>{state.stack.clear();saveStack();renderList()};
  $("#dsExport").onclick=()=>exportStack();
}
function exportStack(){
  const assets=[...state.stack].map(by).filter(Boolean),ids=new Set(assets.map(a=>a.id));
  const payload={title:"Belgium Data Desk — concrete asset manifest",atlasVersion:ATLAS_VERSION,generated:new Date().toISOString(),assets,relationships:DATASET_RELATIONSHIPS.filter(r=>ids.has(r.from)&&ids.has(r.to))};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="belgium-data-concrete-assets.json";link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
function reset(){state.q="";state.source=state.kind=state.shape=state.format="";$("#datasetSearch").value="";renderFilters();renderList()}
function init(){
  renderFilters();renderList();renderStackBar();
  $("#datasetSearch").oninput=e=>{state.q=e.target.value.trim();renderList()};
  for(const [id,key] of [["#dsSource","source"],["#dsKind","kind"],["#dsShape","shape"],["#dsFormat","format"]])$(id).onchange=e=>{state[key]=e.target.value;renderList()};
  $("#dsReset").onclick=reset;
  document.addEventListener("click",e=>{
    let a=e.target.closest("[data-asset]");if(a){state.selected=a.dataset.asset;renderList()}
    let r=e.target.closest("[data-related]");if(r){state.selected=r.dataset.related;renderList();$("#assetInspector").scrollIntoView({behavior:"smooth",block:"start"})}
  });
}
init();