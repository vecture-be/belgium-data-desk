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
const stackKey="bdd-asset-stack-v2",pinMetaKey="bdd-asset-pin-meta-v1";
const safePins=()=>{try{const ids=JSON.parse(localStorage.getItem(stackKey)||"[]");return new Set(Array.isArray(ids)?ids.filter(x=>typeof x==="string"):[])}catch{return new Set()}};
const savedPinMeta=()=>{try{return JSON.parse(localStorage.getItem(pinMetaKey)||"{}")||{}}catch{return {}}};
const state={q:"",source:"",kind:"",format:"",depth:"",selected:MODELED[0]?.id||"",stack:safePins(),pinnedOnly:false,harvested:[],national:[],nationalLoaded:false};

const harvestToAsset=h=>{
  const schemaOrigin=h.schemaOrigin||h.enrichment?.schemaOrigin||"none";
  const depth=schemaOrigin==="publisher-schema"&&(h.fields||[]).length?"structured":"harvested";
  return {
    id:h.id,depth,sourceId:"",product:h.provider||h.platform||"Harvested catalogue",
    title:h.title,datasetId:h.datasetId||h.id,kind:h.kind||"catalogue dataset",shape:h.platform||"catalogue metadata",
    grain:"semantic grain not manually audited",time:h.updatedAt?"publisher metadata updated "+String(h.updatedAt).slice(0,10):"publisher metadata",
    space:h.extent?.spatial?"published spatial extent":"see publisher metadata",cadence:"publisher-defined",formats:h.formats||[],
    schema:(h.fields||[]).map(x=>[x.name||x.label||"field",x.type||"field",x.description||x.label||"published field"]),
    distributions:(h.distributions||[]).map(d=>[d.name||d.format||"resource",d.format||"resource","publisher-defined","see source",d.url||h.officialUrl]),
    versioning:"Machine-harvested publisher metadata; not manually version-audited.",
    caveat:depth==="structured"?"Field names/types come from a publisher-exposed schema. Observation grain and semantics are still not manually audited.":schemaOrigin==="sample-observed"?"Fields were observed in a sample response, not supplied as an authoritative schema.":"Catalogue metadata only; schema and observation grain are not audited.",
    evidence:[h.officialUrl].filter(Boolean),description:h.description||"",provider:h.provider||"",platform:h.platform||"",updatedAt:h.updatedAt||null,
    recordCount:Number.isFinite(h.recordCount)?h.recordCount:null,previewRows:h.previewRows||[],extent:h.extent||{},themes:h.themes||[],license:h.license||"",
    schemaOrigin,sampleOrigin:h.sampleOrigin||"none",harvestedAt:h.harvestedAt||null,enrichment:h.enrichment||{level:"harvested",score:0,reasons:[]}
  };
};
const sourceAlias=a=>{
  if(a.depth==="modelled")return a.sourceId||norm(a.product);
  const p=norm(a.provider||a.product);
  const aliases=[["elia","elia"],["infrabel","infrabel"],["transportdata","transportdata"],["de lijn","transportdata"],["digitaal vlaanderen — grb","grb"],["grb","grb"],["vkbo","datavlaanderen"],["dov","dov"],["spw wallonia","wallonia"],["wallonia","wallonia"],["brussels","brussels"],["geo.be","ngi"],["national geographic institute","ngi"]];
  return aliases.find(([needle])=>p.includes(needle))?.[1]||p.replace(/[^a-z0-9]+/g,"-");
};
const canonicalKey=a=>sourceAlias(a)+"|"+norm(a.datasetId||a.title).replace(/\s+/g," ");
const depthRank={modelled:3,structured:2,harvested:1};
const AUDITED=new Set(["statbel-pop-residence-2026","kbo-open-full-active","nbb-auth-refs","nbbstat-aa-sector","delijn-gtfs-static","infrabel-punct-monthly","elia-ods001","ircel-pm10-station","basis-address-v2","grb-adp","agri-flanders-2026-s1","agri-wallonia-all-years","brussels-urbis-contours","vkbo-ogc","rmi-aws","riziv-nomensoft-full","finance-cadastral-current","ngi-territorial-divisions","dov-groundwater-locations","onem-unemployment-municipality","bipt-mobile-coverage-2016","omgeving-dsi-public"]);
const AUDIT_DATE="2026-09-30";
const all=()=>{
  const m=new Map();
  for(const a of [...MODELED,...state.harvested,...state.national]){
    const k=canonicalKey(a),prev=m.get(k);
    if(!prev||(depthRank[a.depth]||0)>(depthRank[prev.depth]||0))m.set(k,a);
  }
  return [...m.values()];
};
const by=id=>all().find(a=>a.id===id);
const srcLabel=a=>a.depth==="modelled"?(sourceBy(a.sourceId)?.name||a.product):(a.provider||a.product);
const pinDetails=a=>({id:a.id,title:a.title,datasetId:a.datasetId,publisher:srcLabel(a),depth:a.depth,kind:a.kind,sourceUrl:a.evidence?.[0]||a.distributions?.[0]?.[4]||"",formats:a.formats||[]});
function selectedPinDetails(){
  const prior=savedPinMeta();
  return [...state.stack].map(id=>by(id)?pinDetails(by(id)):prior[id]||{id,title:id,publisher:"Unavailable in current catalogue",depth:"harvested",kind:"dataset",sourceUrl:"",formats:[]});
}
function toggleDatasetPin(id){
  if(!state.stack.has(id)&&!by(id))return;
  state.stack.has(id)?state.stack.delete(id):state.stack.add(id);
  saveStack();renderList();
}

async function loadHarvest(){
  try{
    const r=await fetch("/harvested-catalog.json",{cache:"no-store"});
    if(!r.ok)throw new Error(String(r.status));
    const j=await r.json();
    state.harvested=(j.items||[]).map(h=>harvestToAsset({...h,harvestedAt:j.generatedAt||null}));
    const hasSeedOnly=Object.keys(j.sources||{}).length===1&&!!j.sources?.seed;
    const structured=state.harvested.filter(x=>x.depth==="structured").length;
    const sampled=state.harvested.filter(x=>x.previewRows?.length).length;
    const failed=Object.values(j.sources||{}).filter(x=>x?.ok===false).length;
    $("#harvestMeta").textContent=MODELED.length+" curated · "+state.harvested.length+" harvested · "+structured+" publisher-schema · "+sampled+" sampled"+(failed?" · "+failed+" refresh failed":"")+(hasSeedOnly?" · seed fallback":"");
    $("#harvestMeta").title="Harvest file generated "+(j.generatedAt||"at an unknown time")+". Curated records are manually reviewed; harvested counts are catalogue records and may include stale fallback snapshots.";
  }catch{$("#harvestMeta").textContent="harvest unavailable"}
  renderFilters();renderList();renderStack();
}
async function loadNational(){
  const btn=$("#dsNational");if(state.nationalLoaded){state.depth="harvested";$("#dsDepth").value="harvested";renderList();return}
  btn.disabled=true;btn.textContent="Loading national…";
  try{
    const r=await fetch("/national-catalog.json",{cache:"no-store"});if(!r.ok)throw new Error(String(r.status));
    const j=await r.json();
    if(!Array.isArray(j.items)||!j.items.length){btn.textContent="National unavailable";btn.title="The published national catalogue currently contains no datasets.";return}
    state.national=j.items.map(h=>harvestToAsset({...h,harvestedAt:j.generatedAt||null}));
    state.nationalLoaded=true;btn.textContent="National +"+state.national.length.toLocaleString();
    renderFilters();renderList();renderStack();
  }catch(e){btn.textContent="National unavailable";btn.title=e.message}
  finally{btn.disabled=false}
}

function vals(field){return[...new Set(all().flatMap(a=>Array.isArray(a[field])?a[field]:[a[field]])).values()].filter(Boolean).sort()}
function searchText(a){
  return norm([a.title,a.datasetId,srcLabel(a),a.product,a.kind,a.shape,a.grain,a.time,a.space,a.cadence,a.description,...a.formats,...(a.themes||[]),...(a.schema||[]).flat(),...(a.distributions||[]).flat()].join(" "));
}
function matches(a){
  const terms=norm(state.q).trim().split(/\s+/).filter(Boolean),hay=searchText(a);
  return(!state.pinnedOnly||state.stack.has(a.id))&&terms.every(t=>hay.includes(t))&&(!state.depth||a.depth===state.depth)&&(!state.source||srcLabel(a)===state.source)&&(!state.kind||a.kind===state.kind)&&(!state.format||a.formats.includes(state.format));
}
function relevance(a){
  const q=norm(state.q).trim(),title=norm(a.title),id=norm(a.datasetId),publisher=norm(srcLabel(a));
  if(!q)return(depthRank[a.depth]||0)*100;
  let score=(depthRank[a.depth]||0)*4;
  if(id===q)score+=120;if(title===q)score+=100;if(title.startsWith(q))score+=35;if(id.startsWith(q))score+=30;
  for(const t of q.split(/\s+/).filter(Boolean)){if(title.includes(t))score+=14;if(id.includes(t))score+=16;if(publisher.includes(t))score+=8;if(norm(a.kind).includes(t))score+=5;if((a.schema||[]).some(f=>norm(f[0]).includes(t)))score+=3}
  return score;
}
function fill(sel,items,label){const el=$(sel),cur=el.value;el.innerHTML='<option value="">'+esc(label)+'</option>'+items.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");if(items.includes(cur))el.value=cur}
function renderFilters(){
  fill("#dsSource",[...new Set(all().map(srcLabel))].sort(),"All publishers");
  fill("#dsKind",vals("kind"),"All kinds");
  fill("#dsFormat",vals("formats"),"All formats");
  $("#dsSource").value=state.source;$("#dsKind").value=state.kind;$("#dsFormat").value=state.format;$("#dsDepth").value=state.depth;
}
function row(a){
  const active=a.id===state.selected,pinned=state.stack.has(a.id),id=esc(a.id);
  const label=a.depth==="modelled"?"CURATED":a.depth==="structured"?"PUBLISHER SCHEMA":"HARVESTED";
  return '<div class="asset-entry '+(active?"active":"")+'"><button type="button" class="asset-row '+(active?"active":"")+'" data-asset="'+id+'"><div class="asset-row-top"><span>'+esc(srcLabel(a))+'</span><em class="depth '+a.depth+'">'+label+'</em></div><b>'+esc(a.title)+'</b><div class="asset-line"><code>'+esc(a.datasetId)+'</code><span>'+esc(a.kind)+'</span>'+(a.recordCount!=null?'<span>'+Number(a.recordCount).toLocaleString()+" records reported</span>":"")+(a.previewRows?.length?'<span class="sample-chip">record sample</span>':"")+'</div></button><button type="button" class="asset-pin '+(pinned?"active":"")+'" data-dataset-pin="'+id+'" aria-pressed="'+pinned+'" aria-label="'+(pinned?"Unpin ":"Pin ")+esc(a.title)+'">'+(pinned?"✓ PINNED":"+ PIN")+'</button></div>';
}

function renderList(){
  const list=all().filter(matches).sort((a,b)=>relevance(b)-relevance(a)||a.title.localeCompare(b.title)),limit=600,shown=list.slice(0,limit);
  $("#dsCount").textContent=list.length.toLocaleString()+" datasets";
  $("#assetList").innerHTML=(shown.map(row).join("")+(list.length>limit?'<div class="dataset-empty">Showing first '+limit+'. Refine search to narrow '+list.length.toLocaleString()+' matches.</div>':""))||'<div class="dataset-empty">No datasets match the selected filters</div>';
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
    rows=rows.slice(0,5);if(!rows.length){box.textContent="The API returned no records for this request.";return}
    const cols=[...new Set(rows.flatMap(x=>Object.keys(x)))].slice(0,6);
    box.innerHTML='<div class="preview-table"><div class="preview-row head">'+cols.map(k=>'<b>'+esc(k)+'</b>').join("")+'</div>'+rows.map(row=>'<div class="preview-row">'+cols.map(k=>'<span>'+esc(cell(row[k]))+'</span>').join("")+'</div>').join("")+'</div><small>live sample · up to 5 rows · '+esc(new URL(url).hostname)+'</small>';
  }catch(e){box.innerHTML='<div class="preview-error">Preview unavailable ('+esc(e.message)+').</div>'}
}

function snapshotPreview(a){
  const rows=a.previewRows||[];if(!rows.length)return "";
  const cols=[...new Set(rows.flatMap(x=>Object.keys(x)))].slice(0,6);
  const captured=a.harvestedAt?String(a.harvestedAt).slice(0,10):"harvest snapshot";
  return '<section class="snapshot-preview"><div class="section-cap"><h3>Actual sampled records</h3><span>captured '+esc(captured)+'</span></div><div class="preview-table"><div class="preview-row head">'+cols.map(k=>'<b>'+esc(k)+'</b>').join("")+'</div>'+rows.map(row=>'<div class="preview-row">'+cols.map(k=>'<span>'+esc(cell(row[k]))+'</span>').join("")+'</div>').join("")+'</div><p class="harvest-note">Example records from the publisher response. They do not define the authoritative schema or full value domain.</p></section>';
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
  return '<details class="deep-details"><summary>'+(structured?"Publisher schema & harvested metadata":"Harvested metadata")+'</summary>'+
    (structured&&a.schema.length?'<div class="schema-mini">'+a.schema.slice(0,40).map(f=>'<div><code>'+esc(f[0])+'</code><span>'+esc(f[1])+'</span><p>'+esc(f[2])+'</p></div>').join("")+'</div>':"")+
    (a.description?'<p class="harvest-note">'+esc(a.description)+'</p>':"")+
    '<div class="harvest-facts">'+
      (a.recordCount!=null?'<span><b>'+Number(a.recordCount).toLocaleString()+'</b> records</span>':"")+
      (a.schema.length?'<span><b>'+a.schema.length+'</b> fields</span>':"")+
      (a.license?'<span>'+esc(a.license)+'</span>':"")+
      (a.extent?.temporal?'<span>time extent published</span>':"")+
      (a.extent?.spatial?'<span>spatial extent published</span>':"")+
    '</div></details>';
}
function provenanceChips(a){
  const chips=[];
  if(a.depth==="modelled")chips.push("manual curation","official evidence","grain is curated interpretation");
  else{chips.push("machine harvested");if(a.depth==="structured")chips.push("publisher-exposed schema");else if(a.schemaOrigin==="sample-observed")chips.push("fields observed in sample");else chips.push("schema not verified");if(a.previewRows?.length)chips.push("actual record sample")}
  if(AUDITED.has(a.id))chips.unshift("checked "+AUDIT_DATE);
  return '<div class="harvest-facts">'+chips.map(x=>'<span>'+esc(x)+'</span>').join("")+'</div>';
}
function renderInspector(){
  const a=by(state.selected);if(!a)return;
  const modelled=a.depth==="modelled";
  $("#assetInspector").innerHTML=
    '<header class="asset-inspector-head"><div class="hierarchy"><span>'+esc(srcLabel(a))+'</span><i>›</i><strong>'+esc(a.datasetId)+'</strong></div><h2>'+esc(a.title)+'</h2><div class="dataset-actions"><button id="assetStackToggle" class="'+(state.stack.has(a.id)?"stacked":"")+'">'+(state.stack.has(a.id)?"✓ Pinned":"+ Pin")+'</button>'+(a.evidence?.[0]?'<a href="'+esc(a.evidence[0])+'" target="_blank" rel="noopener">Official ↗</a>':"")+'</div></header>'+provenanceChips(a)+
    '<p class="harvest-note"><b>Contains</b> '+esc(a.description||[a.kind,a.shape].filter(Boolean).join(" · "))+'</p><div class="compact-facts"><div><small>GRAIN</small><b>'+esc(a.grain)+'</b></div><div><small>'+(modelled?"TIME":a.depth==="structured"?"STRUCTURE":"METADATA")+'</small><b>'+esc(modelled?a.time:(a.depth==="structured"?(a.schema.length+" fields"+(a.recordCount!=null?" · "+Number(a.recordCount).toLocaleString()+" rows":"")):"catalogue only"))+'</b></div><div><small>DELIVERY</small><b>'+esc(a.formats.slice(0,3).join(" · ")||a.shape)+'</b></div><div><small>'+(modelled?"CADENCE":"UPDATED")+'</small><b>'+esc(modelled?a.cadence:(a.updatedAt?String(a.updatedAt).slice(0,10):"publisher metadata"))+'</b></div></div>'+
    snapshotPreview(a)+'<section class="compact-section"><div class="section-cap"><h3>Distributions</h3><span>'+a.distributions.length+'</span></div><div class="distribution-list compact">'+a.distributions.map(d=>'<article><div><b>'+esc(d[0])+'</b><small>'+esc(d[1])+'</small></div><a href="'+esc(d[4])+'" target="_blank" rel="noopener">open ↗</a></article>').join("")+'</div></section>'+ (previewUrl(a)?'<section class="live-preview-section"><div class="section-cap"><h3>Live data</h3><button id="previewBtn">'+(a.previewRows?.length?"Refresh live":"Preview 5 rows")+'</button></div><div id="livePreview"></div></section>':"")+
    '<div class="one-warning"><b>Watch</b> '+esc(a.caveat||"Check the publisher metadata and distribution conditions before use.")+'</div>'+
    (modelled?detailsModeled(a):detailsHarvested(a));
  $("#assetStackToggle").onclick=()=>toggleDatasetPin(a.id);const pb=$("#previewBtn");if(pb)pb.onclick=()=>loadPreview(a);
}
function saveStack(){
  const ids=[...state.stack],meta=Object.fromEntries(selectedPinDetails().map(a=>[a.id,a]));
  localStorage.setItem(stackKey,JSON.stringify(ids));
  localStorage.setItem(pinMetaKey,JSON.stringify(meta));
  renderStack();
}
function renderStack(){
  const details=selectedPinDetails();
  document.dispatchEvent(new CustomEvent("bdd:dataset-stack-change",{detail:{items:details,count:details.length}}));
}
function exportDatasetManifest(){
  const picked=[...state.stack].map(by).filter(Boolean),ids=new Set(picked.filter(x=>x.depth==="modelled").map(x=>x.id));
  const missing=selectedPinDetails().filter(x=>!by(x.id));
  const payload={atlasVersion:ATLAS_VERSION,generated:new Date().toISOString(),assets:[...picked,...missing],relationships:DATASET_RELATIONSHIPS.filter(r=>ids.has(r.from)&&ids.has(r.to))};
  const b=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),l=document.createElement("a");
  l.href=URL.createObjectURL(b);l.download="belgium-data-assets.json";l.click();setTimeout(()=>URL.revokeObjectURL(l.href),800);
}
async function openPinnedDataset(id){
  if(!by(id)&&!state.nationalLoaded)await loadNational();
  const asset=by(id);if(!asset)return;
  state.q=state.source=state.kind=state.format=state.depth="";state.pinnedOnly=false;
  $("#datasetSearch").value="";renderFilters();$("#dsPinnedOnly").classList.remove("active");$("#dsPinnedOnly").setAttribute("aria-pressed","false");
  state.selected=id;renderList();
  $("#assetInspector").scrollIntoView({behavior:"smooth",block:"start"});
}

function reset(){state.q=state.source=state.kind=state.format=state.depth="";state.pinnedOnly=false;$("#datasetSearch").value="";$("#dsPinnedOnly").classList.remove("active");renderFilters();renderList()}
function init(){
  renderFilters();renderList();renderStack();loadHarvest();
  $("#datasetSearch").oninput=e=>{state.q=e.target.value.trim();renderList()};
  [["#dsSource","source"],["#dsKind","kind"],["#dsFormat","format"],["#dsDepth","depth"]].forEach(([s,k])=>$(s).onchange=e=>{state[k]=e.target.value;renderList()});
  $("#dsReset").onclick=reset;$("#dsNational").onclick=loadNational;
  $("#dsPinnedOnly").onclick=()=>{state.pinnedOnly=!state.pinnedOnly;$("#dsPinnedOnly").classList.toggle("active",state.pinnedOnly);$("#dsPinnedOnly").setAttribute("aria-pressed",String(state.pinnedOnly));renderList()};
  document.addEventListener("bdd:dataset-pin-toggle",e=>toggleDatasetPin(e.detail?.id));
  document.addEventListener("bdd:dataset-clear",()=>{state.stack.clear();saveStack();renderList()});
  document.addEventListener("bdd:dataset-export",exportDatasetManifest);
  document.addEventListener("bdd:dataset-open",e=>openPinnedDataset(e.detail?.id));
  document.addEventListener("click",e=>{const pin=e.target.closest("[data-dataset-pin]");if(pin){toggleDatasetPin(pin.dataset.datasetPin);return}const a=e.target.closest("[data-asset]");if(a){state.selected=a.dataset.asset;renderList()}const r=e.target.closest("[data-related]");if(r){state.selected=r.dataset.related;renderList();$("#assetInspector").scrollIntoView({behavior:"smooth",block:"start"})}});
}
init();