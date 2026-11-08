import { ASSETS, ATLAS_VERSION } from "./dataset-atlas-v1.mjs";
import { EXTRA_ATLAS_ASSETS } from "./dataset-atlas-extra-v1.mjs";
import { COMPLETENESS_ASSETS } from "./dataset-atlas-completeness-v1.mjs";
import { COMPLETENESS_ASSETS_V2 } from "./dataset-atlas-completeness-v2.mjs";
import { COMPLETENESS_ASSETS_V3 } from "./dataset-atlas-completeness-v3.mjs";
import { COMPLETENESS_ASSETS_V4 } from "./dataset-atlas-completeness-v4.mjs";
import { IDENTIFIER_REGISTRY, CROSSWALK_REGISTRY, DATASET_RELATIONSHIPS_V2, DATASET_RELATION_TYPE_DEFS, grainSignature, identifierBindings, planDatasetIntegration, datasetRelationsFor } from "./dataset-knowledge-v1.mjs";
import { VALIDATION_MODEL_VERSION, VALIDATION_PACK, validationSpecFor, runValidation } from "./dataset-validation-v1.mjs";
import { pythonValidationRecipe, sqlValidationRecipe, validationRecipeKind } from "./dataset-validation-recipes-v1.mjs";
import { LOCAL_FILE_LIMITS, validateLocalFiles } from "./dataset-local-files-v2.mjs";
import { isNationalIndexed, mergeDiscoveredAssets, sourceAlias } from "./dataset-discovery-v1.mjs";
import { inspectTabularInBrowser, tabularDistributionForAsset } from "./dataset-tabular-preview-v2.mjs";
import { SOURCES as BASE } from "./data.mjs";
import { EXTRA_SOURCES } from "./deep-data.mjs";
import { SOURCE_OVERRIDES } from "./factcheck-v1.mjs";

const MODELED=[...ASSETS,...EXTRA_ATLAS_ASSETS,...COMPLETENESS_ASSETS,...COMPLETENESS_ASSETS_V2,...COMPLETENESS_ASSETS_V3,...COMPLETENESS_ASSETS_V4].map(a=>({...a,depth:"modelled"}));
const SOURCES=[...BASE,...EXTRA_SOURCES].map(s=>({...s,...(SOURCE_OVERRIDES[s.id]||{})}));
const sourceBy=id=>SOURCES.find(s=>s.id===id);
const modeledBy=id=>MODELED.find(a=>a.id===id);
const publisherDisplayName=a=>{
  const raw=String(a.provider||a.product||"").trim(),hay=norm([raw,a.title,a.datasetId,a.description,a.evidence?.[0],a.sourceRecord].join(" "));
  return /(^|[^a-z])(favv|fasfc|afsca)([^a-z]|$)/.test(hay)?"FAVV / FASFC":raw;
};
const publisherReference=a=>{
  const raw=String(a.provider||"").trim(),label=publisherDisplayName(a);
  return raw&&raw!==label&&/^\d{10}$/.test(raw.replace(/\D/g,""))?raw:"";
};
const $=(s,r=document)=>r.querySelector(s);
const esc=(v="")=>String(v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const norm=v=>String(v||"").toLowerCase();
const stackKey="bdd-asset-stack-v2",pinMetaKey="bdd-asset-pin-meta-v1",validationKey="bdd-validation-results-v1";
const safePins=()=>{try{const ids=JSON.parse(localStorage.getItem(stackKey)||"[]");return new Set(Array.isArray(ids)?ids.filter(x=>typeof x==="string"):[])}catch{return new Set()}};
const savedPinMeta=()=>{try{return JSON.parse(localStorage.getItem(pinMetaKey)||"{}")||{}}catch{return {}}};
const savedValidations=()=>{try{return JSON.parse(localStorage.getItem(validationKey)||"{}")||{}}catch{return {}}};
const state={q:"",source:"",kind:"",format:"",depth:"",selected:MODELED[0]?.id||"",planTarget:"",stack:safePins(),pinnedOnly:false,nationalOnly:false,harvested:[],national:[],nationalLoaded:false,nationalHealth:null,nationalProfileSummary:null,harvestStatus:null,validationResults:savedValidations()};

const harvestToAsset=h=>{
  const schemaOrigin=h.schemaOrigin||h.enrichment?.schemaOrigin||"none",observedFile=schemaOrigin==="observed-file-header";
  const depth=schemaOrigin==="publisher-schema"&&(h.fields||[]).length?"structured":"harvested";
  return {
    id:h.id,depth,sourceId:"",product:h.provider||h.platform||"Harvested catalogue",
    title:h.title,datasetId:h.datasetId||h.id,kind:h.kind||"catalogue dataset",shape:h.platform||"catalogue metadata",
    grain:"semantic grain not manually audited",time:h.dataProcessedAt?"publisher data processed "+String(h.dataProcessedAt).slice(0,19):h.metadataProcessedAt?"publisher metadata processed "+String(h.metadataProcessedAt).slice(0,19):h.catalogueModifiedAt?"catalogue definition modified "+String(h.catalogueModifiedAt).slice(0,19):h.updatedAt?"publisher timestamp "+String(h.updatedAt).slice(0,19):"publisher metadata",
    space:h.extent?.spatial?"published spatial extent":"see publisher metadata",cadence:h.frequency||"publisher-defined",formats:h.formats||[],
    schema:(h.fields||[]).map(x=>[x.name||x.label||"field",x.type||"field",x.description||x.label||"published field"]),
    distributions:(h.distributions||[]).map(d=>[d.name||d.format||"resource",d.format||"resource","publisher-defined","see source",d.url||h.officialUrl]),
    versioning:"Machine-harvested publisher metadata; not manually version-audited.",
    caveat:depth==="structured"?"Field names/types come from a publisher-exposed schema. Observation grain and semantics are still not manually audited.":observedFile?"Field names and sample rows were observed by downloading a publisher file. They are not a publisher-declared schema, and inferred types can be imperfect.":schemaOrigin==="sample-observed"?"Fields were observed in a sample response, not supplied as an authoritative schema.":"Catalogue metadata only; schema and observation grain are not audited.",
    evidence:[h.officialUrl].filter(Boolean),description:h.description||"",provider:h.provider||"",publisherUri:h.publisherUri||null,platform:h.platform||"",discovery:h.discovery||"publisher",discoverySources:[h.discovery||"publisher"],sourceRecord:h.sourceRecord||null,updatedAt:h.updatedAt||null,dataProcessedAt:h.dataProcessedAt||null,metadataProcessedAt:h.metadataProcessedAt||null,catalogueModifiedAt:h.catalogueModifiedAt||null,
    recordCount:Number.isFinite(h.recordCount)?h.recordCount:null,recordCountKind:h.recordCountKind||null,previewRows:h.previewRows||[],tabularProfile:h.tabularProfile||null,extent:h.extent||{},themes:h.themes||[],license:h.license||"",
    schemaOrigin,sampleOrigin:h.sampleOrigin||"none",harvestedAt:h.harvestedAt||null,enrichment:h.enrichment||{level:"harvested",score:0,reasons:[]}
  };
};
const depthRank={modelled:3,structured:2,harvested:1};
const AUDITED=new Set(["statbel-pop-residence-2026","kbo-open-full-active","nbb-auth-refs","nbbstat-aa-sector","delijn-gtfs-static","infrabel-punct-monthly","elia-ods001","ircel-pm10-station","basis-address-v2","grb-adp","agri-flanders-2026-s1","agri-wallonia-all-years","brussels-urbis-contours","vkbo-ogc","rmi-aws","riziv-nomensoft-full","finance-cadastral-current","ngi-territorial-divisions","dov-groundwater-locations","onem-unemployment-municipality","bipt-mobile-coverage-2016","omgeving-dsi-public","fluvius-consumption-sector-nace","fluvius-consumption-street","fluvius-local-production-municipality","fluvius-private-ev-chargepoints","fluvius-storage-systems","federal-police-recorded-crime","elections-2024-municipality-results","opgroeien-childcare-capacity-2026","opgroeien-childcare-coverage-2026","waterinfo-vha-watercourses","waterinfo-monitoring-points","vmm-climate-high-impact-summer","ibz-election-list-results","ibz-election-candidate-results","brussels-bike-counts","brussels-traffic-counts","onderwijs-instellingen-v2","onderwijs-locations-v1","onderwijs-bao-offering-v2","opgroeien-school-childcare-capacity-2026","awv-bike-counts-monthly","awv-speed-regimes-archive","waterinfo-discharge-timeseries","waterinfo-water-quality-sites-2023","ovam-known-landfills"]);
const AUDIT_DATE="2026-09-30";
const all=()=>mergeDiscoveredAssets([...MODELED,...state.harvested,...state.national]);
const by=id=>all().find(a=>a.id===id);
const srcLabel=a=>a.depth==="modelled"?(sourceBy(a.sourceId)?.name||a.product):publisherDisplayName(a);
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

function renderCatalogueMeta(){
  const el=$("#harvestMeta"),structured=state.harvested.filter(x=>x.depth==="structured").length,sampled=state.harvested.filter(x=>x.previewRows?.length).length;
  const pools=[MODELED.length+" curated",state.harvested.length+" direct harvested"];
  if(state.nationalLoaded)pools.push(state.national.length.toLocaleString()+" data.gov.be");
  const details=["direct detail: "+structured+" with publisher schema",sampled+" with record samples"],ps=state.nationalProfileSummary;
  if(ps?.succeeded)details.push(Number(ps.succeeded).toLocaleString()+" national files inspected in browser"+(ps.exact?" · "+Number(ps.exact).toLocaleString()+" exact row counts":""));
  if(ps?.reused)details.push(Number(ps.reused).toLocaleString()+" profiles retained");
  if(ps?.failed)details.push(Number(ps.failed).toLocaleString()+" profile attempts failed");
  if(state.harvestStatus?.failed)details.push(state.harvestStatus.failed+" direct refresh failed");
  el.textContent=pools.join(" · ")+" → "+all().length.toLocaleString()+" unique · "+details.join(" · ");
  const health=state.nationalHealth;
  el.title="Pool counts overlap after browser-side deduplication. Direct harvest generated "+(state.harvestStatus?.generatedAt||"at an unknown time")+(health?"; data.gov.be generated "+(health.generatedAt||"unknown")+" with "+Number(health.datasetCount||state.national.length).toLocaleString()+" datasets / "+Number(health.publisherCount||0).toLocaleString()+" publishers.":".");
}
let catalogueManifestPromise;
async function catalogueRequest(name){
  if(!catalogueManifestPromise)catalogueManifestPromise=fetch("/catalogue-manifest.json",{cache:"no-cache"}).then(r=>r.ok?r.json():null).catch(()=>null);
  const manifest=await catalogueManifestPromise,v=manifest?.files?.[name]?.sha256,url="/"+name+(v?"?v="+encodeURIComponent(v):"");
  return fetch(url,{cache:v?"force-cache":"no-cache"});
}
async function catalogueJson(name){
  const r=await catalogueRequest(name);if(!r.ok)throw new Error(name+" "+r.status);return r.json();
}
async function nationalCatalogueJson(){
  const index=await catalogueJson("national-catalog.json");
  if(!Array.isArray(index.chunks)||!index.chunks.length)return index;
  const groups=await Promise.all(index.chunks.map(async chunk=>{
    const url="/"+chunk.file+(chunk.sha256?"?v="+encodeURIComponent(chunk.sha256):""),r=await fetch(url,{cache:chunk.sha256?"force-cache":"no-cache"});
    if(!r.ok)throw new Error(chunk.file+" "+r.status);
    const page=await r.json();return page.items||[];
  }));
  return{...index,items:groups.flat()};
}
async function loadHarvest(){
  try{
    const j=await catalogueJson("harvested-catalog.json");
    state.harvested=(j.items||[]).map(h=>harvestToAsset({...h,harvestedAt:j.generatedAt||null}));
    state.harvestStatus={generatedAt:j.generatedAt||null,failed:Object.values(j.sources||{}).filter(x=>x?.ok===false).length};
  }catch{state.harvestStatus={failed:1};}
  renderCatalogueMeta();renderFilters();renderList();renderStack();
}
async function loadNational({focus=false}={}){
  const btn=$("#dsNational");
  if(state.nationalLoaded){
    if(focus){state.nationalOnly=!state.nationalOnly;btn.classList.toggle("active",state.nationalOnly);btn.setAttribute("aria-pressed",String(state.nationalOnly));renderList()}
    return;
  }
  btn.disabled=true;btn.textContent="Loading data.gov.be…";
  try{
    const j=await nationalCatalogueJson();
    if(!Array.isArray(j.items)||!j.items.length)throw new Error("published national catalogue contains no datasets");
    state.national=j.items.map(h=>harvestToAsset({...h,discovery:"data.gov.be",harvestedAt:j.generatedAt||null}));
    state.nationalLoaded=true;state.nationalHealth={...(j.health||{}),generatedAt:j.generatedAt||null,datasetCount:j.itemCount||j.items.length};state.nationalProfileSummary=j.profileSummary||null;
    btn.textContent="data.gov.be "+state.national.length.toLocaleString();
    btn.title="National DCAT discovery is loaded by default. Click to show only datasets discovered through data.gov.be.";
    if(focus){state.nationalOnly=true;btn.classList.add("active");btn.setAttribute("aria-pressed","true")}
    renderCatalogueMeta();renderFilters();renderList();renderStack();
  }catch(e){
    btn.textContent="data.gov.be unavailable";btn.title=e.message;
    state.nationalHealth={ok:false,error:e.message};
    renderCatalogueMeta();
  }finally{btn.disabled=false}
}

function vals(field){return[...new Set(all().flatMap(a=>Array.isArray(a[field])?a[field]:[a[field]])).values()].filter(Boolean).sort()}
function searchText(a){
  return norm([a.title,a.datasetId,srcLabel(a),a.product,a.kind,a.shape,a.grain,a.time,a.space,a.cadence,a.description,...a.formats,...(a.themes||[]),...(a.schema||[]).flat(),...(a.distributions||[]).flat()].join(" "));
}
function matches(a){
  const terms=norm(state.q).trim().split(/\s+/).filter(Boolean),hay=searchText(a);
  return(!state.pinnedOnly||state.stack.has(a.id))&&(!state.nationalOnly||isNationalIndexed(a))&&terms.every(t=>hay.includes(t))&&(!state.depth||a.depth===state.depth)&&(!state.source||srcLabel(a)===state.source)&&(!state.kind||a.kind===state.kind)&&(!state.format||a.formats.includes(state.format));
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
function rowCountLabel(a){
  if(a.recordCount==null)return"";
  const n=Number(a.recordCount).toLocaleString();
  if(a.recordCountKind==="lower-bound")return"≥ "+n+" rows before profile cap";
  if(a.schemaOrigin==="observed-file-header")return n+" rows stream-counted";
  return n+" records reported";
}
function previewGrid(rows,maxCols=12){
  if(!rows?.length)return"";
  const cols=[...new Set(rows.flatMap(x=>Object.keys(x)))].slice(0,maxCols),style="grid-template-columns:repeat("+cols.length+",minmax(140px,1fr));min-width:"+Math.max(720,cols.length*140)+"px";
  return '<div class="preview-table"><div class="preview-row head" style="'+style+'">'+cols.map(k=>'<b>'+esc(k)+'</b>').join("")+'</div>'+rows.map(row=>'<div class="preview-row" style="'+style+'">'+cols.map(k=>'<span title="'+esc(cell(row[k]))+'">'+esc(cell(row[k]))+'</span>').join("")+'</div>').join("")+'</div>';
}
function row(a){
  const active=a.id===state.selected,pinned=state.stack.has(a.id),id=esc(a.id);
  const label=a.depth==="modelled"?"CURATED":a.depth==="structured"?"PUBLISHER SCHEMA":a.discovery==="data.gov.be"?"NATIONAL DCAT":"HARVESTED";
  const publisherId=publisherReference(a);
  return '<div class="asset-entry '+(active?"active":"")+'"><button type="button" class="asset-row '+(active?"active":"")+'" data-asset="'+id+'"><div class="asset-row-top"><span>'+esc(srcLabel(a))+'</span><em class="depth '+a.depth+'">'+label+'</em></div><b>'+esc(a.title)+'</b><div class="asset-line"><code>'+esc(a.datasetId)+'</code>'+(publisherId?'<span>publisher '+esc(publisherId)+'</span>':"")+'<span>'+esc(a.kind)+'</span>'+(a.recordCount!=null?'<span>'+esc(rowCountLabel(a))+"</span>":"")+(a.previewRows?.length?'<span class="sample-chip">'+(a.sampleOrigin==="profiled-file-records"?"file sample":"record sample")+"</span>":"")+'</div></button><button type="button" class="asset-pin '+(pinned?"active":"")+'" data-dataset-pin="'+id+'" aria-pressed="'+pinned+'" aria-label="'+(pinned?"Unpin ":"Pin ")+esc(a.title)+'">'+(pinned?"✓ PINNED":"+ PIN")+'</button></div>';
}

function renderList(){
  const list=all().filter(matches).sort((a,b)=>relevance(b)-relevance(a)||a.title.localeCompare(b.title)),limit=600,shown=list.slice(0,limit);
  $("#dsCount").textContent=list.length.toLocaleString()+" datasets";
  $("#assetList").innerHTML=(shown.map(row).join("")+(list.length>limit?'<div class="dataset-empty">Showing first '+limit+'. Refine search to narrow '+list.length.toLocaleString()+' matches.</div>':""))||'<div class="dataset-empty">No datasets match the selected filters</div>';
  if(!list.some(a=>a.id===state.selected)&&list[0])state.selected=list[0].id;
  renderInspector();
}
function relations(id){return datasetRelationsFor(id)}
function previewUrl(a){
  const urls=(a.distributions||[]).map(d=>d[4]).filter(Boolean);
  const ods=urls.find(u=>/\/api\/explore\/v2\.1\/catalog\/datasets\/[^/]+\/records/.test(u));
  if(ods)return /[?&]limit=\d+/.test(ods)?ods.replace(/([?&]limit=)\d+/,(_,prefix)=>prefix+"5"):ods+(ods.includes("?")?"&":"?")+"limit=5";
  if(a.depth!=="modelled"){
    const u=urls.find(u=>/\/items(?:\?|$)/.test(u));
    return u?(/\/items$/.test(u)?u+"?limit=5":u.replace(/limit=20/,"limit=5")):null;
  }
  return urls.find(u=>/\/items(?:\?|$)/.test(u))||null;
}
function livePreviewKind(a){return previewUrl(a)?"api":tabularDistributionForAsset(a)?"tabular":null}
function cell(v){if(v==null)return"—";if(typeof v==="object")v=JSON.stringify(v);v=String(v);return v.length>120?v.slice(0,117)+"…":v}
async function loadPreview(a){
  const box=$("#livePreview"),api=previewUrl(a),tab=tabularDistributionForAsset(a);if(!box||(!api&&!tab))return;
  box.innerHTML='<div class="preview-loading">'+(tab?"streaming publisher CSV directly in your browser…":"loading bounded live preview…")+'</div>';
  if(api){
    try{
      const r=await fetch(api,{headers:{accept:"application/json"}});if(!r.ok)throw new Error(String(r.status));
      const j=await r.json();let rows=j.results||j.features?.map(x=>({...x.properties,_geometry:x.geometry?.type}))||[];
      rows=rows.slice(0,5);if(!rows.length){box.textContent="The API returned no records for this request.";return}
      box.innerHTML=previewGrid(rows,12)+'<small>live API sample · up to 5 rows · '+esc(new URL(api).hostname)+'</small>';
    }catch(e){box.innerHTML='<div class="preview-error">Preview unavailable ('+esc(e.message)+').</div>'}
    return;
  }
  try{
    const p=await inspectTabularInBrowser(a),host=(()=>{try{return new URL(p.url).hostname}catch{return"publisher"}})();
    const count=p.rowCountKind==="exact"
      ?Number(p.rowCount).toLocaleString()+" rows counted in your browser"
      :"≥ "+Number(p.rowCount).toLocaleString()+" rows before the 64 MB browser cap";
    const meta='<div class="harvest-facts"><span><b>'+esc(count)+'</b></span><span><b>'+p.fields.length+'</b> observed fields</span><span>'+esc(p.encoding)+' · '+esc(p.delimiter)+'</span><span>'+Math.round(p.bytesRead/1024).toLocaleString()+' KiB read</span></div>';
    const grid=p.rows.length?previewGrid(p.rows,12):'<div class="preview-error">No data rows were found after the header.</div>';
    box.innerHTML=meta+grid+'<small>direct publisher → your browser · '+esc(host)+' · Cloudflare is not in the data path'+(p.lastModified?' · file Last-Modified '+esc(p.lastModified):"")+'</small>';
  }catch(e){
    box.innerHTML='<div class="preview-error">'+esc(e.message)+' No server-side proxy or fallback was used.</div>';
  }
}

function snapshotPreview(a){
  const rows=a.previewRows||[];if(!rows.length)return"";
  const prof=a.tabularProfile,observed=a.schemaOrigin==="observed-file-header";
  const captured=prof?.profiledAt?String(prof.profiledAt).slice(0,19).replace("T"," "):a.harvestedAt?String(a.harvestedAt).slice(0,10):"harvest snapshot";
  const title=observed?"Observed file sample":"Actual sampled records";
  const note=observed
    ?"Rows were read from the published file during harvest. Header names are real file columns; types are inferred from sampled values."
    :"Example records from the publisher response. They do not define the authoritative schema or full value domain.";
  return '<section class="snapshot-preview"><div class="section-cap"><h3>'+title+'</h3><span>captured '+esc(captured)+'</span></div>'+previewGrid(rows,12)+'<p class="harvest-note">'+esc(note)+'</p></section>';
}

function detailsModeled(a){
  const rel=relations(a.id);
  return '<details class="deep-details"><summary>Schema, version & evidence</summary>'+
    '<div class="schema-mini">'+(a.schema||[]).map(f=>'<div><code>'+esc(f[0])+'</code><span>'+esc(f[1])+'</span><p>'+esc(f[2])+'</p></div>').join("")+'</div>'+
    '<div class="notes-mini"><p><b>Version</b> '+esc(a.versioning)+'</p><p><b>Watch</b> '+esc(a.caveat)+'</p></div>'+
    (rel.length?'<div class="relations-mini">'+rel.map(r=>{const other=modeledBy(r.from===a.id?r.to:r.from),t=DATASET_RELATION_TYPE_DEFS[r.kind];return other?'<button data-related="'+other.id+'"><b>'+esc(t?.label||r.kind)+'</b><span>'+esc(other.title)+'</span><code>'+esc(r.operation+" · "+r.key)+'</code></button>':""}).join("")+'</div>':"")+
    '<div class="evidence-mini">'+(a.evidence||[]).map(u=>'<a href="'+esc(u)+'" target="_blank" rel="noopener">evidence ↗</a>').join("")+'</div></details>';
}
function detailsHarvested(a){
  const structured=a.depth==="structured",observed=a.schemaOrigin==="observed-file-header",prof=a.tabularProfile,tab=tabularDistributionForAsset(a);
  const schemaTitle=structured?"Publisher schema & harvested metadata":observed?"Observed file structure & DCAT metadata":"Harvested metadata";
  const schema=(structured||observed)&&a.schema.length?'<div class="schema-mini">'+a.schema.slice(0,80).map(f=>'<div><code>'+esc(f[0])+'</code><span>'+esc(f[1])+'</span><p>'+esc(f[2])+'</p></div>').join("")+'</div>':"";
  const profile=prof?.status==="failed"
    ?'<p class="harvest-note profile-failed"><b>File profile attempt failed</b> '+esc(prof.error||"unknown error")+(prof.sourceUrl?' · '+esc(prof.sourceUrl):"")+'</p>'
    :prof?'<p class="harvest-note"><b>File profile</b> '+esc(rowCountLabel(a)||"row count unavailable")+' · '+esc(prof.encoding||"encoding unknown")+' · '+esc(prof.delimiter||"delimiter unknown")+(prof.bytesRead?' · '+Number(prof.bytesRead).toLocaleString()+' bytes streamed':"")+(prof.fileLastModified?' · file Last-Modified '+esc(prof.fileLastModified):"")+(prof.reusedFromSnapshot?' · retained from previous successful profile':"")+'</p>':"";
  const browserCode=tab?'<details class="tabular-code"><summary>Browser JavaScript example</summary><pre><code>'+esc('const { inspectTabularInBrowser } = await import("/dataset-tabular-preview-v2.mjs");\nconst asset = { distributions: [["CSV", "CSV", "", "", '+JSON.stringify(tab[4])+']] };\nconst result = await inspectTabularInBrowser(asset);\nconsole.log(result.rowCount, result.rowCountKind);\nconsole.table(result.rows);')+'</code></pre><small>The CSV is fetched directly from the publisher by your browser. Cloudflare does not receive or parse the file.</small></details>':"";
  return '<details class="deep-details"><summary>'+schemaTitle+'</summary>'+schema+
    (a.description?'<p class="harvest-note">'+esc(a.description)+'</p>':"")+profile+
    (()=>{const f=publisherFreshness(a);return'<p class="harvest-note"><b>'+esc(f.label)+'</b> '+esc(f.value)+' · '+esc(f.note||"")+'</p>'})()+
    '<div class="harvest-facts">'+
      (a.recordCount!=null?'<span><b>'+esc(rowCountLabel(a))+'</b></span>':"")+
      (a.schema.length?'<span><b>'+a.schema.length+'</b> '+(observed?"observed fields":"fields")+'</span>':"")+
      (a.license?'<span>'+esc(a.license)+'</span>':"")+
      (a.extent?.temporal?'<span>time extent published</span>':"")+
      (a.extent?.spatial?'<span>spatial extent published</span>':"")+
    '</div>'+browserCode+'</details>';
}
function publisherFreshness(a){
  if(a.depth==="modelled")return{label:"CADENCE",value:a.cadence||"publisher-defined",note:"Curated publication cadence."};
  if(a.dataProcessedAt)return{label:"DATA PROCESSED",value:String(a.dataProcessedAt).slice(0,19),kind:"data",note:"Publisher platform data-processing timestamp; not automatically the newest observation timestamp."};
  if(a.metadataProcessedAt)return{label:"METADATA PROCESSED",value:String(a.metadataProcessedAt).slice(0,19),kind:"metadata",note:"Publisher metadata-processing timestamp; it does not establish data freshness."};
  if(a.catalogueModifiedAt)return{label:"CATALOGUE MODIFIED",value:String(a.catalogueModifiedAt).slice(0,19),kind:"catalogue",note:"Catalogue definition/metadata modification timestamp; it does not establish data freshness."};
  if(a.discovery==="data.gov.be"&&a.updatedAt)return{label:"DCAT MODIFIED",value:String(a.updatedAt).slice(0,19),kind:"metadata",note:"Modification timestamp from data.gov.be metadata; it does not establish source-data freshness."};
  if(a.updatedAt)return{label:"PUBLISHER TIMESTAMP",value:String(a.updatedAt).slice(0,19),kind:"unknown",note:"Publisher-supplied timestamp with source-specific semantics."};
  return{label:"FRESHNESS",value:"not published",kind:"unknown",note:"No reliable freshness timestamp was harvested."};
}
function provenanceChips(a){
  const chips=[],publisherId=publisherReference(a);if(publisherId)chips.push("publisher id "+publisherId);
  if(a.depth==="modelled")chips.push("manual curation","official evidence","grain is curated interpretation");
  else{chips.push("machine harvested");if(a.depth==="structured")chips.push("publisher-exposed schema");else if(a.schemaOrigin==="observed-file-header")chips.push("downloaded file header");else if(a.schemaOrigin==="sample-observed")chips.push("fields observed in sample");else chips.push("schema not verified");if(isNationalIndexed(a))chips.push(a.discovery==="data.gov.be"?"discovered via data.gov.be":"also indexed by data.gov.be");if(a.sampleOrigin==="profiled-file-records")chips.push("sampled downloaded file");else if(a.previewRows?.length)chips.push("actual record sample");if(a.recordCountKind==="exact")chips.push("exact streamed row count");else if(a.recordCountKind==="lower-bound")chips.push("bounded row count");if(a.tabularProfile?.status==="failed")chips.push("file profile attempt failed");if(a.dataProcessedAt)chips.push("data processed "+String(a.dataProcessedAt).slice(0,16));if(a.metadataProcessedAt)chips.push("metadata processed "+String(a.metadataProcessedAt).slice(0,16));if(a.catalogueModifiedAt)chips.push("catalogue modified "+String(a.catalogueModifiedAt).slice(0,10));if(!a.dataProcessedAt&&!a.metadataProcessedAt&&!a.catalogueModifiedAt&&a.updatedAt)chips.push(a.discovery==="data.gov.be"?"DCAT modified "+String(a.updatedAt).slice(0,10):"publisher timestamp "+String(a.updatedAt).slice(0,10))}
  if(AUDITED.has(a.id))chips.unshift("checked "+AUDIT_DATE);
  return '<div class="harvest-facts">'+chips.map(x=>'<span>'+esc(x)+'</span>').join("")+'</div>';
}
function dkTitle(s,n=28){s=String(s||"");return s.length>n?s.slice(0,n-1)+"…":s}
function datasetMiniGraph(a){
  const rels=relations(a.id).slice(0,6),binds=identifierBindings(a).slice(0,5);
  if(!rels.length&&!binds.length)return '<div class="dk-empty">No explicit dataset edge or recognised identifier is recorded yet.</div>';
  const w=780,h=Math.max(330,100+Math.max(rels.length,binds.length)*48),cx=390,cy=h/2;
  const left=rels.map((r,i)=>({r,other:modeledBy(r.from===a.id?r.to:r.from),x:145,y:58+i*((h-116)/Math.max(1,rels.length-1))})).filter(x=>x.other);
  const right=binds.map((b,i)=>({b,meta:IDENTIFIER_REGISTRY.find(x=>x.id===b.identifier),x:635,y:58+i*((h-116)/Math.max(1,binds.length-1))}));
  const lines=left.map(x=>'<line class="dk-edge" x1="'+cx+'" y1="'+cy+'" x2="'+x.x+'" y2="'+x.y+'"></line>').join("")+right.map(x=>'<line class="dk-edge identifier" x1="'+cx+'" y1="'+cy+'" x2="'+x.x+'" y2="'+x.y+'"></line>').join("");
  const lnodes=left.map(x=>'<g class="dk-node related" data-related="'+esc(x.other.id)+'" transform="translate('+x.x+' '+x.y+')"><rect x="-112" y="-18" width="224" height="36" rx="4"></rect><text text-anchor="middle" y="-2">'+esc(dkTitle(x.other.title,31))+'</text><text class="sub" text-anchor="middle" y="11">'+esc(DATASET_RELATION_TYPE_DEFS[x.r.kind]?.label||x.r.kind)+'</text></g>').join("");
  const rnodes=right.map(x=>'<g class="dk-node identifier" transform="translate('+x.x+' '+x.y+')"><rect x="-112" y="-18" width="224" height="36" rx="4"></rect><text text-anchor="middle" y="-2">'+esc(dkTitle(x.meta?.label||x.b.identifier,31))+'</text><text class="sub" text-anchor="middle" y="11">'+esc(x.b.strength+" · "+(x.meta?.family||"identifier"))+'</text></g>').join("");
  const center='<g class="dk-node current" transform="translate('+cx+' '+cy+')"><rect x="-122" y="-23" width="244" height="46" rx="5"></rect><text text-anchor="middle" y="-3">'+esc(dkTitle(a.title,34))+'</text><text class="sub" text-anchor="middle" y="12">selected dataset</text></g>';
  return '<div class="dk-graph"><svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Dataset relationship neighbourhood">'+lines+lnodes+rnodes+center+'</svg><small>Left: explicit dataset contracts · right: recognised identifier bindings. Click a dataset node to inspect it.</small></div>';
}
function plannerTarget(a){
  if(state.planTarget&&state.planTarget!==a.id&&modeledBy(state.planTarget))return state.planTarget;
  const rel=relations(a.id)[0],rid=rel&&(rel.from===a.id?rel.to:rel.from);
  if(rid&&rid!==a.id&&modeledBy(rid))return state.planTarget=rid;
  return state.planTarget=MODELED.find(x=>x.id!==a.id)?.id||"";
}
function pct(v){return Number.isFinite(v)?(v*100).toFixed(1)+"%":"—"}
function renderObservedValidation(result){
  if(!result)return'<div class="rv-empty"><b>No observed sample yet</b><span>A contract or recipe is not evidence that the live data currently joins.</span></div>';
  if(result.modelVersion!==VALIDATION_MODEL_VERSION)return'<div class="rv-empty"><b>Stored observation is stale</b><span>It was produced by '+esc(result.modelVersion||"an older unversioned validator")+'. Rerun this bounded validation before treating it as current evidence.</span></div>';
  const d=result.data||{},stamp=String(result.observedAt||"").replace("T"," ").slice(0,19)+"Z";
  let facts="";
  if(result.kind==="join")facts=[
    ["left sample",d.leftRows],["right sample",d.rightRows],["matched unique keys",d.matchedUnique],["observed cardinality",d.cardinality],
    ["left key overlap (sample)",pct(d.leftUniqueMatchRate)],["right key overlap (sample)",pct(d.rightUniqueMatchRate)],
    ["left row overlap (sample)",pct(d.leftRecordMatchRate??d.leftMatchRate)],["right row overlap (sample)",pct(d.rightRecordMatchRate??d.rightMatchRate)],
    ["left null-key rate",pct(d.leftNullRate)],["right null-key rate",pct(d.rightNullRate)],
    ["left duplicate records",d.leftDuplicateRecords],["right duplicate records",d.rightDuplicateRecords]
  ].map(x=>'<div><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b></div>').join("");
  else if(result.kind==="key-probe")facts=[
    ["sample rows",d.rows],["key field",d.field],["unique keys",d.uniqueKeys],["null keys",d.nullKeys],["duplicate records",d.duplicateRecords],["9-char key rate",pct(d.nineCharacterRate)]
  ].map(x=>'<div><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b></div>').join("");
  else if(result.kind==="derivation")facts=[
    ["capacity rows",d.leftRows],["coverage rows",d.rightRows],["matched geographies",d.matchedGeographies],["missing capacity",d.missingCapacityGeographies],
    ["ratio within tolerance (provisional)",pct(d.ratioReconciliationRate)],["ratio outliers",d.ratioOutliers],["max ratio delta",Number.isFinite(d.maxAbsoluteRatioDelta)?d.maxAbsoluteRatioDelta.toFixed(3):"—"],
    ["geography field",d.leftGeographyField+" ↔ "+d.rightGeographyField]
  ].map(x=>'<div><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b></div>').join("");
  else facts=[
    ["parcel object",d.parcelObjectId],["address references",d.addressReferences],["first address",d.firstAddressId||"—"],["first lookup",d.firstStatus||"—"]
  ].map(x=>'<div><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b></div>').join("");
  return'<div class="rv-observed"><div class="rv-observed-head"><b>OBSERVED SAMPLE</b><span>'+esc(stamp)+'</span></div><div class="rv-metrics">'+facts+'</div>'+
    ((result.notes||[]).length?'<ul>'+result.notes.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>':"")+'</div>';
}
function renderValidationPanel(a,target,plan){
  const spec=validationSpecFor(a,target);
  if(!spec)return'<section class="rv-panel rv-none"><div class="rv-head"><div><small>VALIDATION</small><h4>No validation-pack entry</h4></div><span>planner only</span></div><p>This pair still uses the typed planner, but no executable validation contract has been curated for it yet.</p></section>';
  const latest=state.validationResults[spec.id],canRun=spec.runner!=="none",canFiles=spec.tier==="file-assisted"||spec.tier==="hybrid";
  const params=(spec.parameters||[]).map(p=>'<label>'+esc(p.label)+'<input data-validation-param="'+esc(p.id)+'" placeholder="'+esc(p.placeholder||"")+'"></label>').join("");
  const files=canFiles?'<div class="rv-files"><div><label>LEFT FILE<input type="file" data-validation-file="left" accept=".xlsx,.csv,.tsv,.json,.geojson,application/json,text/csv"></label><small>'+esc(a.title)+'</small></div><div><label>RIGHT FILE<input type="file" data-validation-file="right" accept=".xlsx,.csv,.tsv,.json,.geojson,application/json,text/csv"></label><small>'+esc(target.title)+'</small></div><p>Processed only in this browser. Files are not uploaded. Maximum 60 MB per file.</p></div>':"";
  const py=pythonValidationRecipe(spec,plan),sql=sqlValidationRecipe(spec,plan);
  return'<section class="rv-panel" data-validation-spec="'+esc(spec.id)+'"><div class="rv-head"><div><small>VALIDATION PACK · '+esc(spec.tier.toUpperCase())+'</small><h4>'+esc(spec.label)+'</h4></div><span>'+esc(validationRecipeKind(spec))+'</span></div>'+
    '<div class="rv-contract"><div><small>EXPECTED</small><b>'+esc(spec.expected)+'</b></div><div><small>'+(canFiles?"LOCAL ROW CAP":canRun?"LIVE SAMPLE CAP":"MODE")+'</small><b>'+(canFiles?Number(LOCAL_FILE_LIMITS.maxRowsPerSheet).toLocaleString()+" / sheet":canRun?Number(spec.sampleLimit).toLocaleString():"contract only")+'</b></div></div>'+
    ((spec.notes||[]).length?'<ul class="rv-notes">'+spec.notes.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>':"")+
    (params?'<div class="rv-params">'+params+'</div>':"")+files+
    '<div class="rv-actions">'+(canRun?'<button class="primary" data-run-validation="'+esc(spec.id)+'">Run bounded live validation</button>':'')+(canFiles?'<button class="primary" data-run-file-validation="'+esc(spec.id)+'">Validate local files</button>':(!canRun?'<button disabled>No anonymous live runner</button>':''))+'<span id="validationRunStatus"></span></div>'+
    renderObservedValidation(latest)+
    '<details class="rv-code"><summary>Python validation scaffold</summary><pre><code>'+esc(py)+'</code></pre></details>'+
    '<details class="rv-code"><summary>SQL assertion template</summary><pre><code>'+esc(sql)+'</code></pre></details>'+
  '</section>';
}
async function runValidationUi(button){
  const a=modeledBy(state.selected),target=modeledBy(state.planTarget);if(!a||!target)return;
  const spec=validationSpecFor(a,target);if(!spec)return;
  const panel=button.closest(".rv-panel"),status=panel?.querySelector("#validationRunStatus"),params={};
  panel?.querySelectorAll("[data-validation-param]").forEach(x=>params[x.dataset.validationParam]=x.value.trim());
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  button.disabled=true;button.textContent="Validating…";if(status)status.textContent="bounded request in progress";
  try{
    const result=await runValidation(spec,params,controller.signal);
    state.validationResults[spec.id]=result;localStorage.setItem(validationKey,JSON.stringify(state.validationResults));
    const host=$("#datasetPlanResult");if(host)host.innerHTML=renderPlanCard(a,target);
  }catch(e){
    if(status)status.textContent=(e.name==="AbortError"?"Timed out after 12s":e.message)+". No observation stored.";
    button.disabled=false;button.textContent="Run bounded live validation";
  }finally{clearTimeout(timer)}
}
async function runLocalValidationUi(button){
  const a=modeledBy(state.selected),target=modeledBy(state.planTarget);if(!a||!target)return;
  const spec=validationSpecFor(a,target);if(!spec)return;
  const panel=button.closest(".rv-panel"),status=panel?.querySelector("#validationRunStatus");
  const left=panel?.querySelector('[data-validation-file="left"]')?.files?.[0],right=panel?.querySelector('[data-validation-file="right"]')?.files?.[0];
  if(!left||!right){if(status)status.textContent="Choose both local files first.";return}
  button.disabled=true;button.textContent="Parsing locally…";if(status)status.textContent="No upload · validating in this browser";
  try{
    const result=await validateLocalFiles(spec,left,right);
    state.validationResults[spec.id]=result;localStorage.setItem(validationKey,JSON.stringify(state.validationResults));
    const host=$("#datasetPlanResult");if(host)host.innerHTML=renderPlanCard(a,target);
  }catch(e){
    if(status)status.textContent=e.message+". No observation stored.";
    button.disabled=false;button.textContent="Validate local files";
  }
}
function renderPlanCard(a,target){
  const p=planDatasetIntegration(a,target),cls=esc(p.status||"context");
  const grain=(p.commonDimensions?.length||p.leftOnly?.length||p.rightOnly?.length)?'<div class="dk-grain-delta">'+
    (p.commonDimensions?.length?'<div><b>COMMON</b><span>'+esc(p.commonDimensions.join(" · "))+'</span></div>':"")+
    (p.leftOnly?.length?'<div><b>LEFT ONLY</b><span>'+esc(p.leftOnly.join(" · "))+'</span></div>':"")+
    (p.rightOnly?.length?'<div><b>RIGHT ONLY</b><span>'+esc(p.rightOnly.join(" · "))+'</span></div>':"")+'</div>':"";
  const xwalk=(p.crosswalks||[]).length?'<div class="dk-plan-crosswalk"><b>CROSSWALK PATH</b>'+p.crosswalks.map(x=>'<code>'+esc(x.from+" → "+x.to+" · "+x.operation)+'</code>').join("")+'</div>':"";
  return '<article class="dk-plan '+cls+'"><header><div><small>'+esc((p.confidence||"inferred").toUpperCase())+'</small><h4>'+esc(p.label||"Integration plan")+'</h4></div><span>'+esc(p.lossiness||"unknown")+' loss</span></header>'+
    '<div class="dk-plan-facts"><div><b>operation</b><code>'+esc(p.operation||"—")+'</code></div><div><b>cardinality</b><code>'+esc(p.cardinality||"unknown")+'</code></div><div><b>key / alignment</b><code>'+esc(p.key||"none")+'</code></div><div><b>namespace</b><code>'+esc(p.namespace||"dataset-specific")+'</code></div></div>'+grain+xwalk+
    (p.temporal?'<p><b>Temporal contract</b> '+esc(p.temporal)+'</p>':"")+
    ((p.steps||[]).length?'<div class="dk-steps"><b>Plan</b><ol>'+p.steps.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ol></div>':"")+
    ((p.warnings||[]).length?'<div class="dk-warnings"><b>Do not skip</b><ul>'+p.warnings.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul></div>':"")+
  '</article>'+renderValidationPanel(a,target,p);
}
function renderKnowledge(a){
  const sig=grainSignature(a),binds=identifierBindings(a),bound=new Set(binds.map(x=>x.identifier));
  const cross=CROSSWALK_REGISTRY.filter(x=>bound.has(x.from)||bound.has(x.to)),rels=relations(a.id),targetId=plannerTarget(a),target=modeledBy(targetId);
  const dims=sig.dimensions.length?sig.dimensions.map(id=>'<span>'+esc(id)+'</span>').join(""):'<span class="muted">no specific dimension inferred</span>';
  const identifiers=binds.length?binds.map(b=>{const m=IDENTIFIER_REGISTRY.find(x=>x.id===b.identifier);return '<div class="dk-id"><div><b>'+esc(m?.label||b.identifier)+'</b><small>'+esc(b.strength+" · "+(m?.namespace||""))+'</small></div><p>'+esc(m?.caveat||"")+'</p></div>'}).join(""):'<div class="dk-empty">No canonical identifier binding was inferred from the curated schema. Grain-based planning remains available.</div>';
  const xwalks=cross.length?'<div class="dk-crosswalks">'+cross.map(x=>'<div><code>'+esc(x.from)+' → '+esc(x.to)+'</code><span>'+esc(x.operation+" · "+x.cardinality)+'</span><small>'+esc(x.caveat)+'</small></div>').join("")+'</div>':"";
  const registry='<details class="dk-registry"><summary>Crosswalk registry · '+CROSSWALK_REGISTRY.length+' mappings / '+IDENTIFIER_REGISTRY.length+' identifiers</summary><div class="dk-registry-grid">'+CROSSWALK_REGISTRY.map(x=>'<div><code>'+esc(x.from)+' → '+esc(x.to)+'</code><b>'+esc(x.operation+' · '+x.cardinality)+'</b><span>'+esc(x.evidenceLevel)+'</span><p>'+esc(x.caveat)+'</p></div>').join("")+'</div></details>';
  const options=MODELED.filter(x=>x.id!==a.id).slice().sort((x,y)=>x.title.localeCompare(y.title)).map(x=>'<option value="'+esc(x.id)+'" '+(x.id===targetId?"selected":"")+'>'+esc(x.title)+'</option>').join("");
  return '<section class="dk-section"><div class="section-cap"><h3>Grain algebra</h3><span>inferred · curated metadata</span></div><div class="dk-signature"><div><small>DIMENSIONS</small><div class="dk-chips">'+dims+'</div></div><div><small>TEMPORAL GRAIN</small><b>'+esc(sig.temporal+(sig.years.length?" · "+sig.years.join(" / "):""))+'</b></div><div><small>SPATIAL DIMENSIONS</small><b>'+esc(sig.spatial.join(" · ")||"not explicit")+'</b></div></div><p class="dk-note">This signature is inferred from the manually curated grain/schema description. It is a planning aid, not a publisher-declared schema contract.</p></section>'+
    '<section class="dk-section"><div class="section-cap"><h3>Identifiers & crosswalks</h3><span>'+binds.length+' recognised</span></div><div class="dk-identifiers">'+identifiers+'</div>'+xwalks+registry+'</section>'+
    '<section class="dk-section"><div class="section-cap"><h3>Dataset relationship graph</h3><span>'+rels.length+' explicit edges</span></div>'+datasetMiniGraph(a)+'</section>'+
    '<section class="dk-section"><div class="section-cap"><h3>Integration planner</h3><span>explicit contract first · algebra fallback</span></div><label class="dk-target">COMBINE WITH<select id="datasetPlanTarget">'+options+'</select></label><div id="datasetPlanResult">'+(target?renderPlanCard(a,target):'<div class="dk-empty">No target dataset available.</div>')+'</div></section>';
}
function renderInspector(){
  const a=by(state.selected);if(!a)return;
  const modelled=a.depth==="modelled",observedFile=a.schemaOrigin==="observed-file-header",fresh=publisherFreshness(a),liveKind=livePreviewKind(a);
  $("#assetInspector").innerHTML=
    '<header class="asset-inspector-head"><div class="hierarchy"><span>'+esc(srcLabel(a))+'</span><i>›</i><strong>'+esc(a.datasetId)+'</strong></div><h2>'+esc(a.title)+'</h2><div class="dataset-actions"><button id="assetStackToggle" class="'+(state.stack.has(a.id)?"stacked":"")+'">'+(state.stack.has(a.id)?"✓ Pinned":"+ Pin")+'</button>'+(a.evidence?.[0]?'<a href="'+esc(a.evidence[0])+'" target="_blank" rel="noopener">Official ↗</a>':"")+'</div></header>'+provenanceChips(a)+
    '<p class="harvest-note"><b>Contains</b> '+esc(a.description||[a.kind,a.shape].filter(Boolean).join(" · "))+'</p><div class="compact-facts"><div><small>GRAIN</small><b>'+esc(a.grain)+'</b></div><div><small>'+(modelled?"TIME":a.depth==="structured"?"STRUCTURE":observedFile?"OBSERVED FILE":"METADATA")+'</small><b>'+esc(modelled?a.time:(a.depth==="structured"?(a.schema.length+" fields"+(a.recordCount!=null?" · "+Number(a.recordCount).toLocaleString()+" rows":"")):observedFile?(a.schema.length+" observed fields"+(a.recordCount!=null?" · "+rowCountLabel(a):"")):"catalogue only"))+'</b></div><div><small>DELIVERY</small><b>'+esc(a.formats.slice(0,3).join(" · ")||a.shape)+'</b></div><div title="'+esc(fresh.note||"")+'"><small>'+esc(fresh.label)+'</small><b>'+esc(fresh.value)+'</b></div></div>'+
    snapshotPreview(a)+'<section class="compact-section"><div class="section-cap"><h3>Distributions</h3><span>'+a.distributions.length+'</span></div><div class="distribution-list compact">'+a.distributions.map(d=>'<article><div><b>'+esc(d[0])+'</b><small>'+esc(d[1])+(a.tabularProfile?.sourceUrl===d[4]?' · profiled':"")+'</small></div><a href="'+esc(d[4])+'" target="_blank" rel="noopener">'+(/\.(?:csv|tsv)(?:$|[?#])/i.test(d[4])?"download/open ↗":"open ↗")+'</a></article>').join("")+'</div></section>'+ (liveKind?'<section class="live-preview-section"><div class="section-cap"><h3>'+ (liveKind==="tabular"?"Live file preview":"Live data") +'</h3><button id="previewBtn">'+(liveKind==="tabular"?"Inspect CSV in browser":a.previewRows?.length?"Refresh live":"Preview 5 rows")+'</button></div><div id="livePreview"></div></section>':"")+
    '<div class="one-warning"><b>Watch</b> '+esc(a.caveat||"Check the publisher metadata and distribution conditions before use.")+'</div>'+
    (modelled?renderKnowledge(a):"")+(modelled?detailsModeled(a):detailsHarvested(a));
  $("#assetStackToggle").onclick=()=>toggleDatasetPin(a.id);const pb=$("#previewBtn");if(pb)pb.onclick=()=>loadPreview(a);const pt=$("#datasetPlanTarget");if(pt)pt.onchange=e=>{state.planTarget=e.target.value;const t=modeledBy(state.planTarget);$("#datasetPlanResult").innerHTML=t?renderPlanCard(a,t):""};
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
  const curated=picked.filter(x=>x.depth==="modelled"),bindings=curated.flatMap(a=>identifierBindings(a).map(b=>({...b,dataset:a.id}))),bound=new Set(bindings.map(x=>x.identifier));
  const relevantValidationSpecs=VALIDATION_PACK.filter(v=>ids.has(v.left)&&ids.has(v.right));
  const currentValidationSpecs=relevantValidationSpecs.filter(v=>state.validationResults[v.id]?.modelVersion===VALIDATION_MODEL_VERSION);
  const observedValidations=Object.fromEntries(currentValidationSpecs.map(v=>[v.id,state.validationResults[v.id]]));
  const staleValidationIds=relevantValidationSpecs.filter(v=>state.validationResults[v.id]&&state.validationResults[v.id].modelVersion!==VALIDATION_MODEL_VERSION).map(v=>v.id);
  const payload={atlasVersion:ATLAS_VERSION,knowledgeModel:"dataset-knowledge-v1",validationModel:"dataset-validation-v1",validationModelVersion:VALIDATION_MODEL_VERSION,generated:new Date().toISOString(),assets:[...picked,...missing],relationships:DATASET_RELATIONSHIPS_V2.filter(r=>ids.has(r.from)&&ids.has(r.to)),grainSignatures:Object.fromEntries(curated.map(a=>[a.id,grainSignature(a)])),identifierBindings:bindings,identifiers:IDENTIFIER_REGISTRY.filter(x=>bound.has(x.id)),crosswalks:CROSSWALK_REGISTRY.filter(x=>bound.has(x.from)||bound.has(x.to)),validationSpecs:relevantValidationSpecs,observedValidations,staleValidationIds};
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

function reset(){state.q=state.source=state.kind=state.format=state.depth="";state.pinnedOnly=state.nationalOnly=false;$("#datasetSearch").value="";$("#dsPinnedOnly").classList.remove("active");$("#dsNational").classList.remove("active");$("#dsNational").setAttribute("aria-pressed","false");renderFilters();renderList()}
function init(){
  renderFilters();renderList();renderStack();loadHarvest();loadNational();
  $("#datasetSearch").oninput=e=>{state.q=e.target.value.trim();renderList()};
  [["#dsSource","source"],["#dsKind","kind"],["#dsFormat","format"],["#dsDepth","depth"]].forEach(([s,k])=>$(s).onchange=e=>{state[k]=e.target.value;renderList()});
  $("#dsReset").onclick=reset;$("#dsNational").onclick=()=>loadNational({focus:true});
  $("#dsPinnedOnly").onclick=()=>{state.pinnedOnly=!state.pinnedOnly;$("#dsPinnedOnly").classList.toggle("active",state.pinnedOnly);$("#dsPinnedOnly").setAttribute("aria-pressed",String(state.pinnedOnly));renderList()};
  document.addEventListener("bdd:dataset-pin-toggle",e=>toggleDatasetPin(e.detail?.id));
  document.addEventListener("bdd:dataset-clear",()=>{state.stack.clear();saveStack();renderList()});
  document.addEventListener("bdd:dataset-export",exportDatasetManifest);
  document.addEventListener("bdd:dataset-open",e=>openPinnedDataset(e.detail?.id));
  document.addEventListener("click",e=>{const local=e.target.closest("[data-run-file-validation]");if(local){runLocalValidationUi(local);return}const run=e.target.closest("[data-run-validation]");if(run){runValidationUi(run);return}const pin=e.target.closest("[data-dataset-pin]");if(pin){toggleDatasetPin(pin.dataset.datasetPin);return}const a=e.target.closest("[data-asset]");if(a){state.selected=a.dataset.asset;renderList()}const r=e.target.closest("[data-related]");if(r){state.selected=r.dataset.related;renderList();$("#assetInspector").scrollIntoView({behavior:"smooth",block:"start"})}});
}
init();