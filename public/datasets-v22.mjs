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
import { inspectTabularInBrowser, isTabularDistribution, tabularDistributionForAsset } from "./dataset-tabular-preview-v5.mjs";
import { expandSearchHay, familyKey, familyTitle, inferDatasetBrief, inferIdentifierHints, joinHint } from "./dataset-discovery-intelligence-v1.mjs";
import { SOURCES as BASE } from "./data.mjs";
import { EXTRA_SOURCES } from "./deep-data.mjs";
import { SOURCE_OVERRIDES } from "./factcheck-v1.mjs";
import { feedbackCard, openDatasetFeedback } from "./dataset-feedback-v1.mjs";
import { createPublisherNamer, publisherReference } from "./dataset-publisher-v1.mjs";
import { summarizeChecks, trustChecks } from "./dataset-trust-v1.mjs";
import { LICENSE_FAMILY_NOTE, normalizeLicense } from "./dataset-licence-v1.mjs";
import { fillCardSlots } from "./dataset-card-panel-v1.mjs";
import { SCOPES, TOPIC_LABELS, inScope, scopeCounts, topicOf } from "./dataset-taxonomy-v1.mjs";
import { isLdesEndpoint, isLdesDistribution, ldesCapability } from "./dataset-ldes-v1.mjs";

const MODELED=[...ASSETS,...EXTRA_ATLAS_ASSETS,...COMPLETENESS_ASSETS,...COMPLETENESS_ASSETS_V2,...COMPLETENESS_ASSETS_V3,...COMPLETENESS_ASSETS_V4].map(a=>({...a,depth:"modelled"}));
const SOURCES=[...BASE,...EXTRA_SOURCES].map(s=>({...s,...(SOURCE_OVERRIDES[s.id]||{})}));
const sourceBy=id=>SOURCES.find(s=>s.id===id);
const modeledBy=id=>MODELED.find(a=>a.id===id);
const canonicalFormatLabel=(value,url="")=>{
  const raw=String(value||"").trim(),hay=(raw+" "+url).toLowerCase();
  if(isLdesEndpoint(url)||/\bldes\b|linked data event stream/i.test(raw))return"LDES";
  const map=[
    ["GeoJSON",/geojson|\.geojson(?:$|[?#])/],["JSON-LD",/json-ld|ld\+json/],["CSV",/\bcsv\b|text\/csv|file-type\/csv|\.csv(?:$|[?#])/],
    ["TSV",/\btsv\b|tab[- ]separated|\.tsv(?:$|[?#])/],["JSON",/\bjson\b|application\/json|file-type\/json|\.json(?:$|[?#])/],
    ["XML",/\bxml\b|application\/xml|text\/xml|file-type\/xml|\.xml(?:$|[?#])/],["XLSX",/xlsx|openxmlformats-officedocument\.spreadsheetml|\.xlsx(?:$|[?#])/],
    ["XLS",/\bxls\b|vnd\.ms-excel|\.xls(?:$|[?#])/],["PDF",/\bpdf\b|application\/pdf|\.pdf(?:$|[?#])/],["ZIP",/\bzip\b|application\/zip|\.zip(?:$|[?#])/],
    ["GeoPackage",/geopackage|\bgpkg\b|\.gpkg(?:$|[?#])/],["Shapefile",/shapefile|\bshp\b|\.shp(?:$|[?#])/],["GML",/\bgml\b|\.gml(?:$|[?#])/],
    ["KML",/\bkml\b|\.kml(?:$|[?#])/],["WFS",/\bwfs\b|wfs_srvc/],["WMS",/\bwms\b|wms_srvc/],["WCS",/\bwcs\b|wcs_srvc/],
    ["OGC API Features",/ogc api features|\/collections(?:\/|$)/],["GTFS",/\bgtfs\b/],["Parquet",/parquet|\.parquet(?:$|[?#])/],["NetCDF",/netcdf|\.nc(?:$|[?#])/]
  ];
  for(const [label,re] of map)if(re.test(hay))return label;
  const tail=raw.split(/[\/#]/).filter(Boolean).pop()?.replace(/[_-]+/g," ").trim();
  return tail&&tail.length<=32?tail:"Other";
};
const {publisherDisplayName}=createPublisherNamer(SOURCES);
const $=(s,r=document)=>r.querySelector(s);
const esc=(v="")=>String(v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const norm=v=>String(v||"").toLowerCase();
const searchNorm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const QUERY_STOP=new Set(["by","per","in","for","the","a","an","of","and","van","de","het","een","voor","op","par","des","les","du","la","le","et"]);
const queryTerms=q=>searchNorm(q).trim().split(/\s+/).filter(x=>x&&!QUERY_STOP.has(x));
const stackKey="bdd-asset-stack-v2",pinMetaKey="bdd-asset-pin-meta-v1",validationKey="bdd-validation-results-v1",sqlAccessKey="bdd-sql-access-v3",SQL_ACCESS_TTL=24*60*60*1000;
const safePins=()=>{try{const ids=JSON.parse(localStorage.getItem(stackKey)||"[]");return new Set(Array.isArray(ids)?ids.filter(x=>typeof x==="string"):[])}catch{return new Set()}};
const savedPinMeta=()=>{try{return JSON.parse(localStorage.getItem(pinMetaKey)||"{}")||{}}catch{return {}}};
const savedValidations=()=>{try{return JSON.parse(localStorage.getItem(validationKey)||"{}")||{}}catch{return {}}};
const savedSqlAccess=()=>{try{return JSON.parse(localStorage.getItem(sqlAccessKey)||"{}")||{}}catch{return {}}};
const state={q:"",source:"",kind:"",format:"",depth:"",delivery:"",analysis:"",selected:MODELED[0]?.id||"",planTarget:"",stack:safePins(),pinnedOnly:false,nationalOnly:false,groupFamilies:true,harvested:[],national:[],nationalLoaded:false,nationalMetaLoaded:false,nationalHealth:null,nationalProfileSummary:null,harvestStatus:null,nationalSeries:new Map(),scope:"datasets",topic:"",licence:"",validationResults:savedValidations(),sqlAccess:savedSqlAccess(),sqlProbing:new Set(),joinTarget:""};
const joinCandidateCache=new Map();
const liveProfiles=new Map();

const harvestToAsset=h=>{
  const schemaOrigin=h.schemaOrigin||h.enrichment?.schemaOrigin||"none",observedFile=schemaOrigin==="observed-file-header";
  const depth=schemaOrigin==="publisher-schema"&&(h.fields||[]).length?"structured":"harvested";
  return {
    id:h.id,depth,sourceId:"",product:h.provider||h.platform||"Harvested catalogue",
    title:h.title,datasetId:h.datasetId||h.id,kind:h.kind||"catalogue dataset",shape:h.platform||"catalogue metadata",
    grain:"semantic grain not manually audited",time:h.dataProcessedAt?"publisher data processed "+String(h.dataProcessedAt).slice(0,19):h.metadataProcessedAt?"publisher metadata processed "+String(h.metadataProcessedAt).slice(0,19):h.catalogueModifiedAt?"catalogue definition modified "+String(h.catalogueModifiedAt).slice(0,19):h.updatedAt?"publisher timestamp "+String(h.updatedAt).slice(0,19):"publisher metadata",
    space:h.extent?.spatial?"published spatial extent":"see publisher metadata",cadence:h.frequency||"publisher-defined",
    formats:[...new Set([...(h.formats||[]).map(f=>canonicalFormatLabel(f)),...(h.distributions||[]).map(x=>canonicalFormatLabel(x.format,x.url))].filter(Boolean))],
    schema:(h.fields||[]).map(x=>[x.name||x.label||"field",x.type||"field",x.description||x.label||"published field"]),
    distributions:(h.distributions||[]).map(x=>[x.name||x.format||"resource",canonicalFormatLabel(x.format,x.url),"publisher-defined","see source",x.url||h.officialUrl,Number.isFinite(Number(x.byteSize))?Number(x.byteSize):null]),
    serviceType:h.serviceType||null,endpointDescription:h.endpointDescription||"",
    servesDataset:h.servesDataset||[],conformsTo:h.conformsTo||[],
    versioning:"Machine-harvested publisher metadata; not manually version-audited.",
    caveat:depth==="structured"?"Field names/types come from a publisher-exposed schema. Observation grain and semantics are still not manually audited.":observedFile?"Field names and sample rows were observed by downloading a publisher file. They are not a publisher-declared schema, and inferred types can be imperfect.":schemaOrigin==="sample-observed"?"Fields were observed in a sample response, not supplied as an authoritative schema.":"Catalogue metadata only; schema and observation grain are not audited.",
    evidence:[h.officialUrl].filter(Boolean),description:h.description||"",provider:h.provider||"",publisherUri:h.publisherUri||null,contactName:h.contactName||"",contactEmail:h.contactEmail||"",contactUrl:h.contactUrl||"",officialUrl:h.officialUrl||"",platform:h.platform||"",discovery:h.discovery||"publisher",discoverySources:[h.discovery||"publisher"],sourceRecord:h.sourceRecord||null,updatedAt:h.updatedAt||null,dataProcessedAt:h.dataProcessedAt||null,metadataProcessedAt:h.metadataProcessedAt||null,catalogueModifiedAt:h.catalogueModifiedAt||null,
    recordCount:Number.isFinite(h.recordCount)?h.recordCount:null,recordCountKind:h.recordCountKind||null,previewRows:h.previewRows||[],tabularProfile:h.tabularProfile||null,extent:h.extent||{},themes:h.themes||[],license:h.license||"",
    probe:h.probe||null,tier:h.tier||"",seriesId:h.seriesId||"",dataKind:h.dataKind||"",topic:h.topic||"",licenseFamily:h.licenseFamily||"",geoScope:h.geoScope||"",euThemes:h.euThemes||[],schemaOrigin,sampleOrigin:h.sampleOrigin||"none",harvestedAt:h.harvestedAt||null,enrichment:h.enrichment||{level:"harvested",score:0,reasons:[]}
  };
};
const depthRank={modelled:3,structured:2,harvested:1};
const AUDITED=new Set(["statbel-pop-residence-2026","kbo-open-full-active","nbb-auth-refs","nbbstat-aa-sector","delijn-gtfs-static","infrabel-punct-monthly","elia-ods001","ircel-pm10-station","basis-address-v2","grb-adp","agri-flanders-2026-s1","agri-wallonia-all-years","brussels-urbis-contours","vkbo-ogc","rmi-aws","riziv-nomensoft-full","finance-cadastral-current","ngi-territorial-divisions","dov-groundwater-locations","onem-unemployment-municipality","bipt-mobile-coverage-2016","omgeving-dsi-public","fluvius-consumption-sector-nace","fluvius-consumption-street","fluvius-local-production-municipality","fluvius-private-ev-chargepoints","fluvius-storage-systems","federal-police-recorded-crime","elections-2024-municipality-results","opgroeien-childcare-capacity-2026","opgroeien-childcare-coverage-2026","waterinfo-vha-watercourses","waterinfo-monitoring-points","vmm-climate-high-impact-summer","ibz-election-list-results","ibz-election-candidate-results","brussels-bike-counts","brussels-traffic-counts","onderwijs-instellingen-v2","onderwijs-locations-v1","onderwijs-bao-offering-v2","opgroeien-school-childcare-capacity-2026","awv-bike-counts-monthly","awv-speed-regimes-archive","waterinfo-discharge-timeseries","waterinfo-water-quality-sites-2023","ovam-known-landfills"]);
const AUDIT_DATE="2026-09-30";
// Hand-curated assets carry no harvest-time topic; classify them with the same rules.
const withTopic=list=>list.map(a=>a.topic?a:{...a,topic:topicOf(a)});
let mergedCatalogue=withTopic(mergeDiscoveredAssets([...MODELED]));
const refreshCatalogue=()=>{mergedCatalogue=withTopic(mergeDiscoveredAssets([...MODELED,...state.harvested,...state.national]));joinCandidateCache.clear()};
const all=()=>mergedCatalogue;
const by=id=>all().find(a=>a.id===id);
const srcLabel=a=>a.depth==="modelled"?(sourceBy(a.sourceId)?.name||a.product):publisherDisplayName(a);
const publisherFilterLabel=a=>{const s=srcLabel(a);return /^Belgian organisation\s/i.test(s)?"Other Belgian organisations":s==="data.gov.be publisher"?"Other data.gov.be publishers":s};
const publisherFilterKey=a=>{const label=publisherFilterLabel(a),named=!/^Other /i.test(label)&&label!=="Other data.gov.be publishers";if(named)return"name:"+norm(label).replace(/[^a-z0-9]+/g,"-");const id=publisherReference(a);return id?"be:"+id:(sourceAlias(a)||norm(srcLabel(a)).replace(/[^a-z0-9]+/g,"-"))};
function publisherOptions(){
  const groups=new Map();
  for(const a of all()){
    const key=publisherFilterKey(a),label=publisherFilterLabel(a);
    if(!groups.has(key))groups.set(key,{key,labels:new Set(),count:0});
    const g=groups.get(key);g.labels.add(label);g.count++;
  }
  return [...groups.values()].map(g=>{
    const labels=[...g.labels],generic=s=>/^Other |^data\.gov\.be publisher$|^Publisher$/i.test(s);
    labels.sort((a,b)=>Number(generic(a))-Number(generic(b))||a.length-b.length||a.localeCompare(b));
    return{value:g.key,label:labels[0]||g.key,count:g.count};
  }).sort((a,b)=>a.label.localeCompare(b.label));
}
const normalizedFormats=a=>[...new Set([...(a.formats||[]).map(f=>canonicalFormatLabel(f)),...(a.distributions||[]).map(x=>canonicalFormatLabel(x[1],x[4]))].filter(x=>x&&x!=="Other"))];
const daysSince=value=>{const t=Date.parse(String(value||""));return Number.isFinite(t)?Math.max(0,Math.floor((Date.now()-t)/86400000)):null};
const recencyPoints=age=>age==null?0:age<=31?15:age<=183?13:age<=366?10:age<=731?7:4;
function freshnessSignal(a){
  if(a.dataProcessedAt){const age=daysSince(a.dataProcessedAt);return{points:recencyPoints(age),value:age==null?"dated":"data "+age.toLocaleString()+"d ago",note:"Publisher data-processing timestamp."}}
  if(a.depth==="modelled")return{points:a.cadence?8:5,value:a.cadence||"curated",note:"Cadence is curated; no universal observation timestamp is inferred."};
  const meta=a.metadataProcessedAt||a.catalogueModifiedAt||a.updatedAt;
  if(meta){const age=daysSince(meta),national=a.discovery==="data.gov.be";return{points:national?4:6,value:age==null?"metadata dated":"metadata "+age.toLocaleString()+"d ago",note:"Metadata/catalogue age only; this is not proof that the observations are equally recent."}}
  return{points:0,value:"unknown",note:"No trustworthy freshness timestamp was harvested."};
}
// Evidence is a pure function of the asset, and list sorting calls it O(n log n) times for ~22k records: compute once per asset object.
const evidenceCache=new WeakMap();
function datasetEvidence(a){
  let e=evidenceCache.get(a);if(!e){e=computeEvidence(a);evidenceCache.set(a,e)}
  return e;
}
function computeEvidence(a){
  const ds=a.distributions||[],inspectable=ds.some(x=>distributionCapability(x).group==="inspectable");
  const provenance=a.depth==="modelled"?30:a.depth==="structured"?24:14;
  const access=inspectable?20:ds.length?10:3;
  const fields=(a.schema||[]).length;
  const structure=Math.min(20,(fields>=10?14:fields?10:0)+(a.previewRows?.length?3:0)+(a.recordCount!=null?3:0));
  const fresh=freshnessSignal(a),license=a.license?8:0,extent=(a.extent?.spatial||a.extent?.temporal)?4:0,official=a.evidence?.[0]?3:0;
  return{score:Math.min(100,provenance+access+structure+fresh.points+license+extent+official),parts:{provenance,access,structure,freshness:fresh.points,license,extent,official},fresh};
}
function compactCount(n){n=Number(n);if(!Number.isFinite(n))return"";if(n>=1e9)return(n/1e9).toFixed(n>=1e10?0:1)+"B";if(n>=1e6)return(n/1e6).toFixed(n>=1e7?0:1)+"M";if(n>=1e3)return(n/1e3).toFixed(n>=1e4?0:1)+"K";return n.toLocaleString()}
function formatBytes(n){n=Number(n);if(!Number.isFinite(n)||n<=0)return"";const u=["B","KiB","MiB","GiB","TiB"];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return(n>=10||i===0?n.toFixed(0):n.toFixed(1))+" "+u[i]}
function datasetSignalPanel(a){
  const e=datasetEvidence(a),knownBytes=(a.distributions||[]).map(d=>Number(d[5])).filter(Number.isFinite),largestBytes=knownBytes.length?Math.max(...knownBytes):0;
  const size=a.recordCount!=null?((a.recordCountKind==="lower-bound"?"≥ ":"")+compactCount(a.recordCount)+" rows"):largestBytes?formatBytes(largestBytes):"not published";
  const sizeNote=largestBytes?(a.recordCount!=null?"Largest listed distribution "+formatBytes(largestBytes)+".":"Largest listed distribution; alternatives can differ."):"Rows/file bytes only when the publisher or profiler exposes them.";
  const indexed=isNationalIndexed(a)?"Publisher + data.gov.be":"Publisher source";
  const links=a.depth==="modelled"?datasetRelationsFor(a.id).length:0,reuse=links?links+" documented dataset link"+(links===1?"":"s"):"usage not published";
  const p=e.parts;
  return '<section class="dataset-signals" aria-label="Dataset evidence signals"><div class="signal-score"><strong>'+e.score+'</strong><span>/100 evidence</span><small>not a popularity score</small></div><div class="signal-card"><small>SIZE</small><b>'+esc(size)+'</b><span>'+esc(sizeNote)+'</span></div><div class="signal-card"><small>FRESHNESS</small><b>'+esc(e.fresh.value)+'</b><span>'+esc(e.fresh.note)+'</span></div><div class="signal-card"><small>DISCOVERY / REUSE</small><b>'+esc(indexed)+'</b><span>'+esc(reuse)+'</span></div></section><details class="score-explain"><summary>How the evidence score is calculated</summary><div class="score-parts"><span>provenance <b>'+p.provenance+'/30</b></span><span>access <b>'+p.access+'/20</b></span><span>structure <b>'+p.structure+'/20</b></span><span>freshness evidence <b>'+p.freshness+'/15</b></span><span>licence <b>'+p.license+'/8</b></span><span>extent <b>'+p.extent+'/4</b></span><span>official link <b>'+p.official+'/3</b></span></div><p>Higher means easier to inspect and better evidenced here. It does not claim the data is correct, popular, complete or fit for a specific decision.</p></details>';
}
const sqlSourceForDistribution=d=>{
  const cap=distributionCapability(d),fmt=canonicalFormatLabel(d?.[1],d?.[4]),format=({CSV:"csv",TSV:"tsv",JSON:"json",Parquet:"parquet"})[fmt],url=d?.[4]||"";
  const friendly=cap.kind==="tabular"||format==="parquet"||(format==="json"&&/\.(?:json|jsonl|ndjson)(?:$|[?#])/i.test(url));
  return format&&friendly&&url?{name:d?.[0]||fmt,url,format}:null;
};
const freshSqlAccess=url=>{
  const x=state.sqlAccess?.[url];if(!x)return null;
  if(!x.checkedAt||Date.now()-Number(x.checkedAt)>SQL_ACCESS_TTL)return null;
  return x;
};
function analysisReadiness(a){
  const sources=(a.distributions||[]).map(sqlSourceForDistribution).filter(Boolean);
  if(sources.length){
    const states=sources.map(s=>freshSqlAccess(s.url)),readyIndex=states.findIndex(x=>x?.kind==="ok");
    if(readyIndex>=0){
      const access=states[readyIndex],detail=access.transport==="relay"?"Complete CSV/TSV loaded through the approved catalogue relay.":"Direct browser SQL load verified.";
      return{kind:"ready",label:"SQL READY",detail,source:sources[readyIndex],sources};
    }
    const unchecked=states.findIndex(x=>!x),unknown=states.findIndex(x=>x?.kind==="unknown");
    if(unchecked>=0){
      const source=sources[unchecked],relayHint=["csv","tsv"].includes(source.format)?" Direct access is tried first; a complete catalogue relay fallback can rescue files up to 8 MiB.":"";
      return{kind:"possible",label:"SQL POSSIBLE",detail:"Compatible format; SQL access not yet verified."+relayHint,source,sources};
    }
    if(unknown>=0)return{kind:"possible",label:"SQL POSSIBLE",detail:states[unknown]?.detail||"Compatible format; browser access is inconclusive.",source:sources[unknown],sources};
    const failed=states.find(x=>x?.kind==="fail");
    return{kind:"download",label:"DOWNLOAD ONLY",detail:failed?.detail||"Compatible distributions could not be loaded completely in-browser; download/drop may still work.",source:sources[0],sources};
  }
  const formats=normalizedFormats(a),hasSpreadsheet=formats.some(f=>["XLS","XLSX","ODS"].includes(String(f).toUpperCase())),hasApi=(a.distributions||[]).some(apiDistribution);
  if(hasSpreadsheet||hasApi)return{kind:"download",label:"DOWNLOAD ONLY",detail:hasSpreadsheet?"Spreadsheet requires download/conversion before DuckDB SQL.":"API can be previewed but is not exposed as a direct row-shaped SQL distribution.",source:null,sources:[]};
  return{kind:"not-tabular",label:"NOT TABULAR",detail:"No directly queryable table-like distribution is advertised.",source:null,sources:[]};
}
function persistSqlAccess(){try{localStorage.setItem(sqlAccessKey,JSON.stringify(state.sqlAccess))}catch{}}
async function probeSqlAccess(a){
  const readiness=analysisReadiness(a),source=readiness.source,url=source?.url;
  if(!url||freshSqlAccess(url)||state.sqlProbing.has(url))return;
  state.sqlProbing.add(url);
  try{
    const res=await fetch(url,{method:"HEAD",mode:"cors",cache:"no-store",redirect:"follow"});
    if(res.ok)state.sqlAccess[url]={kind:"unknown",checkedAt:Date.now(),detail:"Publisher HEAD is reachable, but SQL READY is reserved for an actual DuckDB load."};
    else if([405,501].includes(res.status))state.sqlAccess[url]={kind:"unknown",checkedAt:Date.now(),detail:"Publisher does not support HEAD; actual SQL loading may still work."};
    else state.sqlAccess[url]={kind:"unknown",checkedAt:Date.now(),detail:"HEAD returned HTTP "+res.status+"; actual SQL loading may still work."};
  }catch(e){
    state.sqlAccess[url]={kind:"unknown",checkedAt:Date.now(),detail:"Direct HEAD check was blocked or inconclusive; actual SQL load will also try the approved complete-file relay fallback for catalogue CSV/TSV ≤8 MiB."};
  }finally{
    state.sqlProbing.delete(url);persistSqlAccess();scheduleSqlProbeRender();
  }
}
let sqlProbeRenderTimer=0;
function scheduleSqlProbeRender(){
  clearTimeout(sqlProbeRenderTimer);
  sqlProbeRenderTimer=setTimeout(()=>{sqlProbeRenderTimer=0;renderList();renderStack()},120);
}
function queueSqlProbes(assets,max=12){
  const slots=Math.max(0,Math.min(max,6-state.sqlProbing.size));if(!slots)return;
  const seen=new Set(),todo=[];
  for(const a of assets||[]){const s=analysisReadiness(a).source;if(!s?.url||seen.has(s.url)||freshSqlAccess(s.url)||state.sqlProbing.has(s.url))continue;seen.add(s.url);todo.push(a);if(todo.length>=slots)break}
  todo.forEach(a=>probeSqlAccess(a));
}
const pinDetails=a=>{const analysisStatus=analysisReadiness(a),ordered=analysisStatus.source?[analysisStatus.source,...analysisStatus.sources.filter(s=>s.url!==analysisStatus.source.url)]:analysisStatus.sources;return{id:a.id,title:a.title,datasetId:a.datasetId,publisher:srcLabel(a),depth:a.depth,kind:a.kind,sourceUrl:a.evidence?.[0]||a.distributions?.[0]?.[4]||"",formats:a.formats||[],sqlSources:ordered.slice(0,4),analysisStatus:{kind:analysisStatus.kind,label:analysisStatus.label,detail:analysisStatus.detail}}};
function selectedPinDetails(){
  const prior=savedPinMeta();
  return [...state.stack].map(id=>by(id)?pinDetails(by(id)):prior[id]||{id,title:id,publisher:"Unavailable in current catalogue",depth:"harvested",kind:"dataset",sourceUrl:"",formats:[],sqlSources:[]});
}
function toggleDatasetPin(id){
  if(!state.stack.has(id)&&!by(id))return;
  state.stack.has(id)?state.stack.delete(id):state.stack.add(id);
  saveStack();renderList();
}

function renderCatalogueMeta(){
  const el=$("#harvestMeta"),structured=state.harvested.filter(x=>x.depth==="structured").length,sampled=state.harvested.filter(x=>x.previewRows?.length).length,unique=all().length;
  const pools=[MODELED.length+" curated",state.harvested.length+" direct"];
  if(state.nationalLoaded)pools.push(state.national.length.toLocaleString()+" national");
  else if(state.nationalMetaLoaded&&state.nationalHealth?.datasetCount)pools.push(Number(state.nationalHealth.datasetCount).toLocaleString()+" national available");
  const details=[structured+" publisher schemas",sampled+" record samples"],ps=state.nationalProfileSummary;
  if(ps?.failed)details.push(Number(ps.failed).toLocaleString()+" profile attempts failed");
  if(state.harvestStatus?.failed)details.push(state.harvestStatus.failed+" direct refresh failed");
  el.textContent=pools.join(" · ")+" → "+unique.toLocaleString()+" loaded · "+details.join(" · ");
  const health=state.nationalHealth,loadedPublishers=new Set(all().map(srcLabel).filter(Boolean)).size,publishers=state.nationalLoaded?(Number(health?.publisherCount)||loadedPublishers):loadedPublishers;
  el.title="Pool counts overlap after browser-side deduplication. Direct harvest generated "+(state.harvestStatus?.generatedAt||"at an unknown time")+(health?"; data.gov.be generated "+(health.generatedAt||"unknown")+" with "+Number(health.datasetCount||state.national.length).toLocaleString()+" datasets / "+Number(health.publisherCount||0).toLocaleString()+" publishers. The national records load only after a search, filter, deep link or explicit National index action.":".");
  document.dispatchEvent(new CustomEvent("bdd:catalogue-stats",{detail:{datasets:scopeCounts(all()).datasets,records:unique,publishers,structured,sampled,nationalLoaded:state.nationalLoaded}}));
}
let catalogueManifestPromise,nationalIndexPromise;
async function catalogueRequest(name){
  if(!catalogueManifestPromise)catalogueManifestPromise=fetch("/catalogue-manifest.json",{cache:"no-cache"}).then(r=>r.ok?r.json():null).catch(()=>null);
  const manifest=await catalogueManifestPromise,v=manifest?.files?.[name]?.sha256,url="/"+name+(v?"?v="+encodeURIComponent(v):"");
  return fetch(url,{cache:v?"force-cache":"no-cache"});
}
async function catalogueJson(name){
  const r=await catalogueRequest(name);if(!r.ok)throw new Error(name+" "+r.status);return r.json();
}
async function nationalIndexJson(){
  if(!nationalIndexPromise)nationalIndexPromise=catalogueJson("national-catalog.json");
  return nationalIndexPromise;
}
async function nationalCatalogueJson(){
  const index=await nationalIndexJson();
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
    state.harvested=(j.items||[]).map(h=>harvestToAsset({...h,harvestedAt:j.generatedAt||null}));refreshCatalogue();
    state.harvestStatus={generatedAt:j.generatedAt||null,failed:Object.values(j.sources||{}).filter(x=>x?.ok===false).length};
  }catch{state.harvestStatus={failed:1};}
  renderCatalogueMeta();renderFilters();renderList();renderStack();
}
async function loadNationalMeta(){
  if(state.nationalMetaLoaded)return;
  const btn=$("#dsNational");
  try{
    const j=await nationalIndexJson();
    state.nationalMetaLoaded=true;
    state.nationalSeries=new Map((j.series||[]).map(s=>[s.id,s]));
    state.nationalHealth={...(j.health||{}),generatedAt:j.generatedAt||null,datasetCount:j.itemCount||0};
    state.nationalProfileSummary=j.profileSummary||null;
    if(j.itemCount){
      btn.textContent="National index · "+Number(j.itemCount).toLocaleString()+" available";
      btn.title="The data.gov.be catalogue is indexed but not downloaded yet. Search, filter, or click here to load it.";
    }
  }catch(e){
    state.nationalMetaLoaded=true;state.nationalHealth={ok:false,error:e.message};
    btn.textContent="National index unavailable";btn.title=e.message;
  }
  renderCatalogueMeta();
}
async function hydrateNational({focus=false}={}){
  const btn=$("#dsNational");
  if(state.nationalLoaded){
    if(focus){state.nationalOnly=!state.nationalOnly;btn.classList.toggle("active",state.nationalOnly);btn.setAttribute("aria-pressed",String(state.nationalOnly));renderList()}
    return;
  }
  btn.disabled=true;btn.textContent="National index loading…";
  try{
    const j=await nationalCatalogueJson();
    if(!Array.isArray(j.items)||!j.items.length)throw new Error("published national catalogue contains no datasets");
    state.national=j.items.map(h=>harvestToAsset({...h,discovery:"data.gov.be",harvestedAt:j.generatedAt||null}));refreshCatalogue();
    state.nationalSeries=new Map((j.series||[]).map(s=>[s.id,s]));state.nationalLoaded=true;state.nationalMetaLoaded=true;state.nationalHealth={...(j.health||{}),generatedAt:j.generatedAt||null,datasetCount:j.itemCount||j.items.length};state.nationalProfileSummary=j.profileSummary||null;
    btn.textContent="Indexed on data.gov.be · "+state.national.length.toLocaleString();
    btn.title="Filter to datasets also indexed by data.gov.be. The national catalogue is already loaded; this does not run a search.";
    if(focus){state.nationalOnly=true;btn.classList.add("active");btn.setAttribute("aria-pressed","true")}
    renderCatalogueMeta();renderFilters();renderList();renderStack();
  }catch(e){
    btn.textContent="National index unavailable";btn.title=e.message;
    state.nationalHealth={ok:false,error:e.message};
    renderCatalogueMeta();
  }finally{btn.disabled=false}
}
let nationalLoadPromise=null;
async function loadNational({focus=false}={}){
  if(state.nationalLoaded)return hydrateNational({focus});
  if(!nationalLoadPromise)nationalLoadPromise=hydrateNational({focus:false}).finally(()=>{nationalLoadPromise=null});
  await nationalLoadPromise;
  if(focus&&state.nationalLoaded)return hydrateNational({focus:true});
}

function vals(field){return[...new Set(all().flatMap(a=>field==="formats"?normalizedFormats(a):(Array.isArray(a[field])?a[field]:[a[field]]))).values()].filter(Boolean).sort()}
function searchText(a){
  return norm([a.title,a.datasetId,srcLabel(a),a.product,a.kind,a.shape,a.grain,a.time,a.space,a.cadence,a.description,...a.formats,...(a.themes||[]),...(a.schema||[]).flat(),...(a.distributions||[]).flat()].join(" "));
}
// Search text is a pure function of the asset: build it once, and only when a query actually needs it.
const hayCache=new WeakMap();
function expandedSearchText(a){let h=hayCache.get(a);if(h===undefined){h=expandSearchHay(searchText(a));hayCache.set(a,h)}return h}
function matchesBase(a){
  const terms=queryTerms(state.q);
  return(!state.pinnedOnly||state.stack.has(a.id))&&(!state.nationalOnly||isNationalIndexed(a))&&(!terms.length||terms.every(t=>expandedSearchText(a).includes(t)))&&(!state.depth||a.depth===state.depth)&&(!state.source||publisherFilterKey(a)===state.source)&&(!state.kind||a.kind===state.kind)&&(!state.format||normalizedFormats(a).includes(state.format))&&(!state.delivery||matchesDelivery(a,state.delivery))&&(!state.topic||a.topic===state.topic)&&(!state.licence||licenceGroup(a)===state.licence);
}
function matches(a){return matchesBase(a)&&(!state.analysis||analysisReadiness(a).kind===state.analysis)}
// Relevance depends only on the asset and the query; cache per asset object and reset when the query changes.
let relevanceQuery=null,relevanceCache=new WeakMap();
const titleCollator=new Intl.Collator(undefined,{sensitivity:"base"});
function relevance(a){
  if(relevanceQuery!==state.q){relevanceQuery=state.q;relevanceCache=new WeakMap()}
  let score=relevanceCache.get(a);
  if(score===undefined){score=computeRelevance(a);relevanceCache.set(a,score)}
  return score;
}
function computeRelevance(a){
  const q=searchNorm(state.q).trim(),title=searchNorm(a.title),id=searchNorm(a.datasetId),publisher=searchNorm(srcLabel(a)),terms=queryTerms(state.q);
  if(!q)return datasetEvidence(a).score*10+(depthRank[a.depth]||0);
  let score=(depthRank[a.depth]||0)*4;
  if(id===q)score+=120;if(title===q)score+=100;if(title.startsWith(q))score+=35;if(id.startsWith(q))score+=30;
  for(const t of terms){if(title.includes(t))score+=14;if(id.includes(t))score+=16;if(publisher.includes(t))score+=8;if(searchNorm(a.kind).includes(t))score+=5;if((a.schema||[]).some(f=>searchNorm(f[0]).includes(t)))score+=3}
  return score;
}
function familyGroups(items){
  const map=new Map();
  for(const a of items){
    const key=familyKey(a,srcLabel(a));
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(a);
  }
  return [...map.values()].map(members=>{
    members.sort((a,b)=>relevance(b)-relevance(a)||datasetEvidence(b).score-datasetEvidence(a).score||titleCollator.compare(a.title,b.title));
    return{representative:members[0],members,key:familyKey(members[0],srcLabel(members[0]))};
  }).sort((a,b)=>relevance(b.representative)-relevance(a.representative)||titleCollator.compare(a.representative.title,b.representative.title));
}
function familyMembers(a){const key=familyKey(a,srcLabel(a));return all().filter(x=>familyKey(x,srcLabel(x))===key)}
function briefMeta(a){
  const b=inferDatasetBrief(a),ids=b.identifiers.slice(0,2).map(x=>x.label);
  return{...b,identifierText:ids.join(" · ")};
}
function fill(sel,items,label){const el=$(sel),cur=el.value;el.innerHTML='<option value="">'+esc(label)+'</option>'+items.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");if(items.includes(cur))el.value=cur}
function fillPublisher(sel,items,label){const el=$(sel),cur=el.value;el.innerHTML='<option value="">'+esc(label)+'</option>'+items.map(x=>'<option value="'+esc(x.value)+'">'+esc(x.label)+' · '+x.count.toLocaleString()+'</option>').join("");if(items.some(x=>x.value===cur))el.value=cur}
function renderFilters(){
  const publishers=publisherOptions(),publisherKeys=publishers.map(x=>x.value),kinds=vals("kind"),formats=vals("formats");
  if(state.source&&!publisherKeys.includes(state.source))state.source="";
  if(state.kind&&!kinds.includes(state.kind))state.kind="";
  if(state.format&&!formats.includes(state.format))state.format="";
  fillPublisher("#dsSource",publishers,"All publishers");fill("#dsKind",kinds,"All kinds");fill("#dsFormat",formats,"All formats");
  $("#dsSource").value=state.source;$("#dsKind").value=state.kind;$("#dsFormat").value=state.format;$("#dsDepth").value=state.depth;$("#dsDelivery").value=state.delivery;$("#dsAnalysis").value=state.analysis;if($("#dsTopic"))$("#dsTopic").value=state.topic;if($("#dsLicence"))$("#dsLicence").value=state.licence;
}
// Licence families as readers care about them: can I reuse it, with what restriction, or is it unclear?
const LICENCE_GROUPS={open:"Open licence (reuse allowed)",restricted:"Restricted (non-commercial / no-derivatives)",custom:"Publisher-specific terms",unknown:"No licence stated"};
function licenceFamily(a){
  if(a.licenseFamily&&a.licenseFamily!=="unknown")return a.licenseFamily;
  return normalizeLicense(a.licenseUri||a.license).family;
}
function licenceGroup(a){
  const f=licenceFamily(a);
  return f==="open"||f==="open-sharealike"?"open":f==="non-commercial"||f==="no-derivatives"?"restricted":f==="custom"?"custom":"unknown";
}
function probeChip(a){
  const p=a.probe;if(!p||!p.n)return"";
  const label=p.ok===p.n?(p.mm?"LINK OK · FORMAT MISMATCH":"LINK CHECKED"):p.ok?"SOME LINKS BROKEN":"LINK BROKEN",cls=p.ok===p.n&&!p.mm?"lic-open":p.ok?"lic-restricted":"lic-unknown";
  return '<span class="licence-chip '+cls+'" title="Checked '+esc(p.at)+': '+p.ok+' of '+p.n+' file links answered'+(p.mm?'; '+p.mm+' did not look like their declared format':'')+'">'+label+'</span>';
}
function licenceChip(a){
  const g=licenceGroup(a),label={open:"OPEN LICENCE",restricted:"RESTRICTED LICENCE",custom:"CUSTOM TERMS",unknown:"NO LICENCE"}[g];
  return '<span class="licence-chip lic-'+g+'" title="'+esc(LICENSE_FAMILY_NOTE[licenceFamily(a)]||"")+'">'+label+'</span>';
}
function fillLicences(){
  const el=$("#dsLicence");if(!el)return;
  el.innerHTML='<option value="">All licences</option>'+Object.entries(LICENCE_GROUPS).map(([id,label])=>'<option value="'+id+'">'+esc(label)+'</option>').join("");el.value=state.licence;
}
function renderScopeBar(totals){
  const box=$("#dsScope");if(!box)return;
  box.innerHTML=SCOPES.map(s=>'<button type="button" data-scope="'+s.id+'" aria-pressed="'+(state.scope===s.id)+'" title="'+esc(s.hint)+'" class="'+(state.scope===s.id?"active":"")+'">'+esc(s.label)+' <b>'+(totals[s.id]||0).toLocaleString()+'</b></button>').join("");
}
function fillTopics(){
  const el=$("#dsTopic");if(!el)return;
  el.innerHTML='<option value="">All topics</option>'+Object.entries(TOPIC_LABELS).map(([id,label])=>'<option value="'+id+'">'+esc(label)+'</option>').join("");
  el.value=state.topic;
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
const statValue=v=>v===null||v===undefined||v===""?"—":typeof v==="number"?v.toLocaleString():String(v);
function browserProfileTable(p,selectedKey=[]){
  if(!p?.fields?.length)return"";
  return '<section class="browser-profile"><div class="profile-head"><div><b>Column profile</b><small>computed locally over '+Number(p.rowCount).toLocaleString()+' scanned rows'+(p.rowCountKind==="exact"?"":" (bounded)")+'</small></div><button id="keyProfileBtn">Test selected business key</button></div>'+
    '<div class="profile-table"><div class="profile-row head"><span>KEY</span><span>FIELD</span><span>TYPE</span><span>MISSING</span><span>UNIQUE</span><span>DUPLICATES</span><span>MIN</span><span>MAX</span></div>'+
    p.fields.map(f=>'<label class="profile-row"><span><input type="checkbox" data-key-field value="'+esc(f.name)+'" '+(selectedKey.includes(f.name)?"checked":"")+'></span><b>'+esc(f.name)+'</b><code>'+esc(f.type)+'</code><span>'+Number(f.missing||0).toLocaleString()+'</span><span>'+(f.uniqueKind==="lower-bound"?"≥ ":"")+Number(f.unique||0).toLocaleString()+'</span><span>'+(f.duplicateKind==="lower-bound"?"≥ ":"")+Number(f.duplicates||0).toLocaleString()+'</span><span title="'+esc(statValue(f.min))+'">'+esc(statValue(f.min))+'</span><span title="'+esc(statValue(f.max))+'">'+esc(statValue(f.max))+'</span></label>').join("")+
    '</div><div id="keyProfileResult" class="key-profile-result"><span>Select one or more fields above to test uniqueness as a business key.</span></div></section>';
}
function businessKeyResult(k){
  if(!k)return"";
  if(k.missingFields?.length)return'<div class="key-verdict bad"><b>Cannot test key</b><span>Missing fields: '+esc(k.missingFields.join(" · "))+'</span></div>';
  const candidate=k.exact&&k.nullRows===0&&k.duplicateRows===0,cls=candidate?"good":k.exact?"bad":"warn",title=candidate?"Candidate business key":k.exact?"Not unique":"Bounded / inconclusive";
  return '<div class="key-verdict '+cls+'"><b>'+title+'</b><span>'+esc(k.fields.join(" + "))+'</span></div><div class="key-facts"><span><b>'+Number(k.rows||0).toLocaleString()+'</b> rows tested</span><span><b>'+Number(k.uniqueKeys||0).toLocaleString()+'</b> unique keys</span><span><b>'+Number(k.nullRows||0).toLocaleString()+'</b> null/incomplete keys</span><span><b>'+Number(k.duplicateRows||0).toLocaleString()+'</b> duplicate rows</span><span><b>'+Number(k.duplicateGroups||0).toLocaleString()+'</b> duplicate key groups</span></div>';
}
function distributionGroups(a){
  const streams=(a.distributions||[]).filter(isLdesDistribution);
  const inspectable=(a.distributions||[]).filter(x=>!isLdesDistribution(x)&&distributionCapability(x).group==="inspectable");
  const other=(a.distributions||[]).filter(x=>!isLdesDistribution(x)&&distributionCapability(x).group!=="inspectable");
  const card=d=>{const c=distributionCapability(d),bytes=formatBytes(d[5]),fmt=canonicalFormatLabel(d[1],d[4]),sqlFmt=({CSV:"csv",TSV:"tsv",JSON:"json",Parquet:"parquet"})[fmt],sqlFriendly=c.kind==="tabular"||sqlFmt==="parquet"||(sqlFmt==="json"&&/\.(?:json|jsonl|ndjson)(?:$|[?#])/i.test(d[4]||"")),readiness=analysisReadiness(a),canSql=["ready","possible"].includes(readiness.kind),sqlAction=sqlFmt&&sqlFriendly&&d[4]&&canSql?'<button type="button" data-sql-dist-url="'+esc(d[4])+'" data-sql-dist-format="'+sqlFmt+'" data-sql-dist-name="'+esc(a.title)+'">'+(readiness.kind==="ready"?"Analyze SQL":"Try SQL")+'</button>':"";return'<article><div><b>'+esc(d[0])+'</b><small>'+esc(d[1])+' · '+esc(c.label)+(bytes?' · '+esc(bytes):"")+(a.tabularProfile?.sourceUrl===d[4]?' · profiled':"")+'</small></div><div class="distribution-actions">'+sqlAction+'<a href="'+esc(d[4])+'" target="_blank" rel="noopener">'+(c.kind==="tabular"?"download/open ↗":"open ↗")+'</a></div></article>'};
  return (streams.length?'<section class="compact-section distribution-group ldes-distributions"><div class="section-cap"><h3>Published event stream</h3><span>'+streams.length+'</span></div><div class="distribution-list compact">'+streams.map(card).join("")+'</div></section>':"")+
    '<section class="compact-section distribution-group inspectable"><div class="section-cap"><h3>Previewable files and APIs</h3><span>'+inspectable.length+'</span></div>'+(inspectable.length?'<div class="distribution-list compact">'+inspectable.map(card).join("")+'</div>':'<div class="dataset-empty">No directly previewable file or row API is advertised.</div>')+'</section>'+
    (other.length?'<details class="distribution-other"><summary>Other downloads and resources · '+other.length+'</summary><div class="distribution-list compact">'+other.map(card).join("")+'</div></details>':"");
}
const seriesOf=a=>a.seriesId?state.nationalSeries.get(a.seriesId):null;
function row(a,familyCount=1){
  const selectedAsset=by(state.selected),active=a.id===state.selected||(state.groupFamilies&&selectedAsset&&familyKey(a,srcLabel(a))===familyKey(selectedAsset,srcLabel(selectedAsset))),pinned=state.stack.has(a.id),id=esc(a.id);
  const label=a.depth==="modelled"?"CURATED":a.depth==="structured"?"PUBLISHER SCHEMA":a.discovery==="data.gov.be"?"NATIONAL DCAT":"HARVESTED";
  const publisherId=publisherReference(a),evidence=datasetEvidence(a),analysis=analysisReadiness(a),previewable=(a.distributions||[]).some(x=>distributionCapability(x).group==="inspectable"),brief=briefMeta(a),ldes=ldesCapability(a);
  const briefBits=[
    brief.grain&&!/not verified/i.test(brief.grain)?"ROW · "+brief.grain:"",
    brief.time!=="not clearly stated"?"TIME · "+brief.time:"",
    brief.geography!=="not clearly stated"?"GEO · "+brief.geography:"",
    brief.identifierText?"KEY · "+brief.identifierText:""
  ].filter(Boolean);
  return '<div class="asset-entry '+(active?"active":"")+'"><button type="button" class="asset-row '+(active?"active":"")+'" data-asset="'+id+'"><div class="asset-row-top"><span>'+esc(srcLabel(a))+'</span><em class="depth '+a.depth+'">'+label+'</em></div><b>'+esc(seriesOf(a)?.title||a.title)+'</b>'+
    (briefBits.length?'<div class="asset-brief-line">'+briefBits.slice(0,4).map(x=>'<span>'+esc(x)+'</span>').join("")+'</div>':"")+
    '<div class="asset-line"><code>'+esc(a.datasetId)+'</code>'+(familyCount>1?'<span class="family-chip">'+(seriesOf(a)?'COLLECTION · '+(familyCount<seriesOf(a).count?familyCount.toLocaleString()+' of '+seriesOf(a).count.toLocaleString()+' match':seriesOf(a).count.toLocaleString()+' datasets')+(seriesOf(a).yearMin?' · '+seriesOf(a).yearMin+'–'+seriesOf(a).yearMax:''):'FAMILY · '+familyCount+' records')+'</span>':"")+(publisherId?'<span>publisher '+esc(publisherId)+'</span>':"")+'<span class="analysis-badge '+analysis.kind+'" title="'+esc(analysis.detail)+'">'+analysis.label+'</span>'+(previewable?'<span class="data-capability">PREVIEWABLE</span>':"")+(ldes.status==="publisher_declared"?'<span class="ldes-label" title="LDES endpoint listed in publisher metadata; operational availability and history not verified">LDES STREAM</span>':"")+licenceChip(a)+probeChip(a)+'<span class="evidence-chip">evidence '+evidence.score+'/100</span>'+(a.recordCount!=null?'<span>'+esc(rowCountLabel(a))+'</span>':"")+'</div></button><button type="button" class="asset-pin '+(pinned?"active":"")+'" data-dataset-pin="'+id+'" aria-pressed="'+pinned+'" aria-label="'+(pinned?"Unpin ":"Pin ")+esc(a.title)+'">'+(pinned?"✓ PINNED":"+ PIN")+'</button></div>';
}

function renderList(){
  const unscoped=all().filter(matchesBase),scopeTotals=scopeCounts(unscoped);
  renderScopeBar(scopeTotals);
  const base=unscoped.filter(a=>inScope(a,state.scope)).sort((a,b)=>relevance(b)-relevance(a)||titleCollator.compare(a.title,b.title));
  const list=(state.analysis?base.filter(a=>analysisReadiness(a).kind===state.analysis):base),limit=240;
  const groups=state.groupFamilies?familyGroups(list):list.map(a=>({representative:a,members:[a],key:familyKey(a,srcLabel(a))})),shown=groups.slice(0,limit);
  // A deep link must show its record even when it ranks below the first page of results.
  const forced=state.forceVisible&&by(state.forceVisible);
  if(forced){const fk=familyKey(forced,srcLabel(forced));if(!shown.some(g=>g.key===fk)){const g=groups.find(x=>x.key===fk);if(g)shown.unshift(g)}}
  const total=all().length,filtered=!!(state.q||state.source||state.kind||state.format||state.depth||state.delivery||state.analysis||state.pinnedOnly||state.nationalOnly);
  $("#dsCount").textContent=state.groupFamilies
    ?groups.length.toLocaleString()+" families · "+list.length.toLocaleString()+" records"
    :(filtered?list.length.toLocaleString()+" of "+total.toLocaleString()+" datasets":total.toLocaleString()+" unique datasets");
  $("#assetList").innerHTML=(shown.map(g=>row(g.representative,g.members.length)).join("")+(groups.length>limit?'<div class="dataset-empty">Showing first '+limit+' families. Refine search to narrow '+groups.length.toLocaleString()+' matches.</div>':""))||'<div class="dataset-empty">No datasets match the selected filters'+(state.scope!=="all"&&scopeTotals.all>(scopeTotals[state.scope]||0)?'. '+(scopeTotals.all-(scopeTotals[state.scope]||0)).toLocaleString()+' matching records exist under the other views above (maps, publications, research, metadata only) — choose one or Everything.':'')+'</div>';
  const selected=by(state.selected),visible=selected&&(state.groupFamilies?shown.some(g=>g.key===familyKey(selected,srcLabel(selected))):shown.some(g=>g.representative.id===selected.id));
  if(!visible&&shown[0])state.selected=shown[0].representative.id;
  renderInspector();
  const current=by(state.selected),pinned=[...state.stack].map(by).filter(Boolean),probePool=[current,...pinned,...(state.analysis?base.slice(0,24):shown.slice(0,10).map(g=>g.representative))].filter(Boolean);
  queueSqlProbes(probePool,state.analysis?24:12);
}
function relations(id){return datasetRelationsFor(id)}
function apiDistribution(d){
  const u=String(d?.[4]||"");
  return /\/api\/explore\/v2\.1\/catalog\/datasets\/[^/]+\/records/.test(u)||/\/items(?:\?|$)/.test(u);
}
function distributionCapability(d){
  if(isLdesDistribution(d))return{group:"stream",label:"LDES event stream",kind:"stream"};
  if(isTabularDistribution(d))return{group:"inspectable",label:"browser tabular",kind:"tabular"};
  if(apiDistribution(d))return{group:"inspectable",label:"browser API",kind:"api"};
  const hay=norm([d?.[0],d?.[1],d?.[4]].join(" "));
  if(/\b(?:pdf|doc|docx|html|jpeg|jpg|png|tiff?)\b/.test(hay))return{group:"other",label:"document / image",kind:"document"};
  if(/\b(?:zip|gzip|gz|7z|tar)\b/.test(hay))return{group:"other",label:"archive",kind:"archive"};
  return{group:"other",label:"other download",kind:"other"};
}
function matchesDelivery(a,mode){
  const ds=a.distributions||[],inspectable=ds.some(x=>distributionCapability(x).group==="inspectable");
  if(mode==="inspectable")return inspectable;
  if(mode==="other")return ds.length>0&&!inspectable;
  if(mode==="metadata")return ds.length===0;
  return true;
}
function previewUrl(a){
  const urls=(a.distributions||[]).filter(apiDistribution).map(d=>d[4]).filter(Boolean);
  const ods=urls.find(u=>/\/api\/explore\/v2\.1\/catalog\/datasets\/[^/]+\/records/.test(u));
  if(ods)return /[?&]limit=\d+/.test(ods)?ods.replace(/([?&]limit=)\d+/,(_,prefix)=>prefix+"5"):ods+(ods.includes("?")?"&":"?")+"limit=5";
  const u=urls.find(u=>/\/items(?:\?|$)/.test(u));
  if(!u)return null;
  return /\/items$/.test(u)?u+"?limit=5":u.replace(/limit=20/,"limit=5");
}
function livePreviewKind(a){return tabularDistributionForAsset(a)?"tabular":previewUrl(a)?"api":null}
function cell(v){if(v==null)return"—";if(typeof v==="object")v=JSON.stringify(v);v=String(v);return v.length>120?v.slice(0,117)+"…":v}
const PREVIEW_BYTES=512*1024,PROFILE_BYTES=64*1024*1024;
const sizeLabel=n=>!n?"unknown size":n<1024*1024?Math.round(n/1024).toLocaleString()+" KiB":(n/1024/1024).toFixed(n<10*1024*1024?1:0)+" MiB";
async function runTabularProfile(a,box,businessKey=[]){
  const button=$("#fullProfileBtn",box);if(button){button.disabled=true;button.textContent="Profiling…"}
  try{
    const p=await inspectTabularInBrowser(a,{maxBytes:PROFILE_BYTES,proxyBytes:PROFILE_BYTES,maxRows:25,profileColumns:true,businessKey});
    liveProfiles.set(a.id,p);
    const host=(()=>{try{return new URL(p.url).hostname}catch{return"publisher"}})();
    const bounded=p.rowCountKind!=="exact",count=(bounded?"≥ ":"")+Number(p.rowCount).toLocaleString()+" rows scanned";
    const meta='<div class="harvest-facts"><span><b>'+esc(count)+'</b></span><span><b>'+p.fields.length+'</b> fields</span><span>'+esc(p.encoding)+' · '+esc(p.delimiter)+'</span><span>'+sizeLabel(p.bytesRead)+' read</span></div>';
    const grid=p.rows.length?previewGrid(p.rows,12):"";
    const route=p.transport==="proxy"?"publisher → bounded Cloudflare stream → your browser":"publisher → your browser";
    box.innerHTML='<div class="profile-scope '+(bounded?"bounded":"exact")+'"><b>'+(bounded?"Bounded profile":"Full-file profile")+'</b><span>'+(bounded?"Statistics cover the first "+sizeLabel(p.bytesRead)+" only; exact whole-file uniqueness is not claimed.":"The complete file fit inside the 64 MB profiling budget.")+'</span></div>'+meta+(businessKey.length?'<div class="profile-key-result">'+businessKeyResult(p.businessKey)+'</div>':"")+'<div class="profile-report-bar"><span>Unexpected result?</span><button type="button" data-report-asset="'+esc(a.id)+'">Report these findings</button></div>'+browserProfileTable(p,businessKey)+grid+'<small>'+esc(route)+' · '+esc(host)+' · all parsing and statistics computed in this browser</small>';
    const keyBtn=$("#keyProfileBtn",box);
    if(keyBtn){keyBtn.textContent="Re-profile selected key";keyBtn.title="This explicitly re-reads up to 64 MB directly; catalogue relay fallback is capped at 8 MB.";keyBtn.onclick=()=>{
      const fields=[...box.querySelectorAll("[data-key-field]:checked")].map(x=>x.value);
      if(!fields.length)return;runTabularProfile(a,box,fields);
    }};
  }catch(e){box.innerHTML='<div class="preview-error">'+esc(e.message)+' Direct download remains available above.</div>'}
}
async function loadPreview(a){
  const box=$("#livePreview"),api=previewUrl(a),tab=tabularDistributionForAsset(a);if(!box||(!api&&!tab))return;
  box.innerHTML='<div class="preview-loading">'+(tab?"loading a small browser preview…":"loading bounded live preview…")+'</div>';
  if(api&&!tab){
    try{
      const r=await fetch(api,{headers:{accept:"application/json"}});if(!r.ok)throw new Error(String(r.status));
      const j=await r.json();let rows=j.results||j.features?.map(x=>({...x.properties,_geometry:x.geometry?.type}))||[];
      rows=rows.slice(0,5);if(!rows.length){box.textContent="The API returned no records for this request.";return}
      box.innerHTML=previewGrid(rows,12)+'<small>live API sample · up to 5 rows · '+esc(new URL(api).hostname)+'</small>';
    }catch(e){box.innerHTML='<div class="preview-error">Preview unavailable ('+esc(e.message)+').</div>'}
    return;
  }
  try{
    const p=await inspectTabularInBrowser(a,{maxBytes:PREVIEW_BYTES,proxyBytes:PREVIEW_BYTES,maxRows:15,profileColumns:false}),host=(()=>{try{return new URL(p.url).hostname}catch{return"publisher"}})();
    const grid=p.rows.length?previewGrid(p.rows,12):'<div class="preview-error">No data rows were found in the preview window.</div>',sourceSize=p.reportedBytes||0;
    const keyChoices=p.fields.map(f=>'<label><input type="checkbox" data-preview-key value="'+esc(f.name)+'"> '+esc(f.name)+'</label>').join("");
    box.innerHTML='<div class="profile-scope preview"><b>Small preview</b><span>'+sizeLabel(p.bytesRead)+' transferred'+(sourceSize?" from a "+sizeLabel(sourceSize)+" source":"")+'. No column uniqueness profiling yet.</span></div>'+
      '<div class="harvest-facts"><span><b>'+Number(p.rowCount).toLocaleString()+'</b> rows parsed in preview window</span><span><b>'+p.fields.length+'</b> fields</span><span>'+esc(p.encoding)+' · '+esc(p.delimiter)+'</span></div>'+
      grid+'<div class="preview-key-picker"><b>Optional business key</b><small>Select fields now; the profile scan will test them in the same pass.</small><div>'+keyChoices+'</div></div>'+
      '<div class="profile-next"><button id="fullProfileBtn">Profile up to 64 MB in browser</button><small>Explicit opt-in. Direct publisher reads can scan up to 64 MB; the catalogue-backed Cloudflare fallback is capped at 8 MB.</small></div>'+
      '<small>'+(p.transport==="proxy"?"bounded Cloudflare pass-through":"direct publisher fetch")+' · '+esc(host)+'</small>';
    $("#fullProfileBtn",box).onclick=()=>runTabularProfile(a,box,[...box.querySelectorAll("[data-preview-key]:checked")].map(x=>x.value));
  }catch(e){box.innerHTML='<div class="preview-error">'+esc(e.message)+' Direct download remains available above.</div>'}
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
  const browserCode=tab?'<details class="tabular-code"><summary>Browser JavaScript example</summary><pre><code>'+esc('const { inspectTabularInBrowser } = await import("/dataset-tabular-preview-v5.mjs");\nconst asset = { distributions: [["CSV", "CSV", "", "", '+JSON.stringify(tab[4])+']] };\nconst result = await inspectTabularInBrowser(asset);\nconsole.log(result.rowCount, result.rowCountKind);\nconsole.table(result.rows);')+'</code></pre><small>The browser profiles the CSV locally. When a publisher blocks CORS, the allowlisted Cloudflare route only streams the bytes; it never parses the data.</small></details>':"";
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
function mergedIdentifierHints(a){
  const heuristic=inferIdentifierHints(a),curated=identifierBindings(a).map(b=>{
    const m=IDENTIFIER_REGISTRY.find(x=>x.id===b.identifier);
    return{id:b.identifier,label:m?.label||b.identifier,confidence:"curated",evidence:b.origin};
  });
  const map=new Map();
  [...heuristic,...curated].forEach(x=>{const prev=map.get(x.id);if(!prev||x.confidence==="curated")map.set(x.id,x)});
  return [...map.values()];
}
function trustAssessment(a){
  const fresh=freshnessSignal(a),analysis=analysisReadiness(a),fields=(a.schema||[]).length,official=!!a.evidence?.[0],license=!!a.license;
  const source=official?(a.depth==="modelled"?"Official source + manual curation":"Official publisher link captured"):"Canonical source link not captured";
  const structure=a.depth==="modelled"?"Curated grain/schema interpretation":a.depth==="structured"?fields+" publisher-declared fields":a.schemaOrigin==="observed-file-header"?fields+" observed file fields":a.previewRows?.length?"Record sample only":"Schema not verified";
  const freshness=fresh.value==="unknown"?"Freshness not established":fresh.value;
  const licence=license?String(a.license):"Licence not explicit in harvested metadata";
  const gaps=[];if(!official)gaps.push("source");if(fresh.points===0)gaps.push("freshness");if(!fields&&a.depth!=="modelled")gaps.push("structure");if(!license)gaps.push("licence");
  const verdict=!gaps.length?"Strong metadata evidence; still validate subject definitions and fitness for use.":gaps.length<=2?"Useful for exploration, with "+gaps.join(" and ")+" evidence still incomplete.":"Discovery-level record; several trust dimensions still need verification.";
  return{source,structure,freshness,licence,technical:analysis.label,technicalDetail:analysis.detail,verdict,gaps};
}
const CHECK_MARK={pass:"✓",warn:"!",fail:"✕",unknown:"?"};
function assetAsTrustItem(a){
  return{officialUrl:a.officialUrl||a.evidence?.[0]||"",provider:srcLabel(a),contactEmail:a.contactEmail,contactUrl:a.contactUrl,license:a.license,licenseFamily:a.licenseFamily,licenseUri:a.licenseUri,
    updatedAt:a.dataProcessedAt||a.updatedAt||a.metadataProcessedAt||"",frequency:/^[A-Z_0-9]+$/.test(a.cadence||"")?a.cadence:"",fields:a.schema||[],probe:a.probe||null,
    distributions:(a.distributions||[]).map(d=>({url:d[4],format:d[1]}))};
}
function renderTrustPanel(a){
  const t=trustAssessment(a),checks=trustChecks(assetAsTrustItem(a)),sum=summarizeChecks(checks);
  const rows=checks.map(c=>'<li class="trust-check '+c.status+'"><span class="trust-mark" aria-label="'+c.status+'">'+CHECK_MARK[c.status]+'</span><div><b>'+esc(c.label)+'</b><span>'+esc(c.detail)+'</span></div></li>').join("");
  return '<section class="trust-panel"><div class="section-cap"><h3>Trust checks</h3><span>'+sum.pass+' passed · '+sum.warn+' to review · '+sum.fail+' failed · '+sum.unknown+' not yet known — facts, not a correctness verdict</span></div>'+
    '<ul class="trust-checks">'+rows+'</ul>'+
    '<div class="trust-grid"><div><small>TECHNICAL ACCESS</small><b>'+esc(t.technical)+'</b><span>'+esc(t.technicalDetail)+'</span></div></div>'+
    '<p class="trust-verdict">'+esc(t.verdict)+'</p></section>';
}
function whyResult(a){
  if(!state.q)return[];
  const q=searchNorm(state.q),terms=queryTerms(state.q),title=searchNorm(a.title),publisher=searchNorm(srcLabel(a)),schema=(a.schema||[]).map(x=>searchNorm(x[0])),reasons=[];
  if(title===q)reasons.push("exact title match");else if(terms.some(t=>title.includes(t)))reasons.push("title match");
  if(terms.some(t=>publisher.includes(t)))reasons.push("publisher match");
  if(terms.some(t=>schema.some(f=>f.includes(t))))reasons.push("field/schema match");
  const expanded=expandedSearchText(a),raw=searchText(a);if(terms.some(t=>!raw.includes(t)&&expanded.includes(t)))reasons.push("NL / FR / EN synonym match");
  const ids=mergedIdentifierHints(a);if(ids.length)reasons.push(ids.slice(0,2).map(x=>x.label).join(" + "));
  if(analysisReadiness(a).kind==="ready")reasons.push("SQL-ready");
  return [...new Set(reasons)].slice(0,6);
}
function renderWhyResult(a){
  const reasons=whyResult(a);if(!reasons.length)return"";
  return '<details class="why-result"><summary>Why this result?</summary><div>'+reasons.map(x=>'<span>'+esc(x)+'</span>').join("")+'</div><p>Ranking also considers provenance/evidence and exact dataset-ID matches. This is discovery relevance, not a quality verdict.</p></details>';
}
function familyComparison(a,members){
  if(members.length<2)return"";
  const others=members.filter(x=>x.id!==a.id).sort((x,y)=>datasetEvidence(y).score-datasetEvidence(x).score),other=others[0];if(!other)return"";
  const af=new Set((a.schema||[]).map(x=>norm(x[0]))),bf=new Set((other.schema||[]).map(x=>norm(x[0])));
  const added=[...af].filter(x=>!bf.has(x)),removed=[...bf].filter(x=>!af.has(x)),at=inferDatasetBrief(a).time,bt=inferDatasetBrief(other).time;
  const pieces=[];
  if(af.size||bf.size)pieces.push("fields "+af.size+" vs "+bf.size+(added.length?" · +"+added.length:"")+(removed.length?" · −"+removed.length:""));
  if(at!==bt)pieces.push("time "+bt+" → "+at);
  const fa=normalizedFormats(a).join(" / "),fb=normalizedFormats(other).join(" / ");if(fa&&fb&&fa!==fb)pieces.push("formats changed");
  return '<div class="family-delta"><b>Family comparison</b><span>Selected vs '+esc(other.title)+'</span><p>'+esc(pieces.join(" · ")||"Metadata differs, but no field/time delta can be quantified from the available catalogue records.")+'</p>'+(added.length?'<small>Selected adds: '+esc(added.slice(0,8).join(", "))+(added.length>8?"…":"")+'</small>':"")+(removed.length?'<small>Selected lacks: '+esc(removed.slice(0,8).join(", "))+(removed.length>8?"…":"")+'</small>':"")+'</div>';
}
function renderDatasetBrief(a){
  const b=inferDatasetBrief(a),ids=mergedIdentifierHints(a);
  return '<section class="dataset-brief"><header><b>Dataset brief</b><span>'+(a.depth==="modelled"?"curated + inferred":"metadata-derived · verify before production")+'</span></header>'+
    '<div class="dataset-brief-grid"><div><small>ONE ROW</small><b>'+esc(b.oneRow.replace(/^Likely one row represents |^One row represents /,"").replace(/\.$/,""))+'</b></div><div><small>TIME COVERAGE</small><b>'+esc(b.time)+'</b></div><div><small>GEOGRAPHY</small><b>'+esc(b.geography)+'</b></div></div>'+
    (ids.length?'<div class="dataset-id-hints">'+ids.slice(0,6).map(x=>'<span>'+esc(x.label)+'<em>'+esc(x.confidence==="curated"?"curated":"heuristic")+'</em></span>').join("")+'</div>':"")+
    '<div class="dataset-brief-row"><b>Useful for</b>'+esc(b.useFor)+'</div><div class="dataset-brief-row"><b>Watch</b>'+esc(b.limitations)+'</div></section>';
}
function renderFamilySection(a){
  const members=familyMembers(a);if(members.length<2)return"";
  const sorted=members.slice().sort((x,y)=>{
    const ax=inferDatasetBrief(x).time,ay=inferDatasetBrief(y).time;
    return String(ay).localeCompare(String(ax))||datasetEvidence(y).score-datasetEvidence(x).score;
  });
  return '<section class="dataset-family-section"><div class="section-cap"><h3>Dataset family</h3><span>'+members.length+' related records · heuristic family · '+esc(familyTitle(a.title))+'</span></div>'+familyComparison(a,members)+'<div class="family-members">'+sorted.slice(0,20).map(x=>{
    const b=inferDatasetBrief(x),r=analysisReadiness(x);
    return '<button type="button" class="'+(x.id===a.id?"active":"")+'" data-family-member="'+esc(x.id)+'"><div><b>'+esc(x.title)+'</b><small>'+esc(srcLabel(x))+' · '+esc(x.datasetId)+'</small></div><span>'+esc(b.time)+' · '+esc(r.label)+'</span></button>';
  }).join("")+'</div>'+(members.length>20?'<p class="dk-note">Showing 20 of '+members.length+' family records.</p>':"")+'</section>';
}
function joinCandidateScore(a,b){
  const h=joinHint(a,b);if(!h.score)return 0;
  const stop=new Set(["data","dataset","belgium","belgie","belgique","open","public","the","and","for","van","de","des","les"]);
  const ta=new Set(norm(a.title).split(/[^a-z0-9]+/).filter(x=>x.length>3&&!stop.has(x))),tb=new Set(norm(b.title).split(/[^a-z0-9]+/).filter(x=>x.length>3&&!stop.has(x)));
  let overlap=0;ta.forEach(x=>{if(tb.has(x))overlap++});
  return h.score+Math.min(15,overlap*3)+(srcLabel(a)===srcLabel(b)?2:0);
}
function topJoinCandidates(a,query=""){
  const terms=queryTerms(query),cacheKey=!terms.length?a.id:"";
  if(cacheKey&&joinCandidateCache.has(cacheKey))return joinCandidateCache.get(cacheKey);
  const result=all().filter(x=>x.id!==a.id&&familyKey(x,srcLabel(x))!==familyKey(a,srcLabel(a)))
    .filter(x=>!terms.length||terms.every(t=>expandedSearchText(x).includes(t)))
    .map(x=>({asset:x,hint:joinHint(a,x),score:joinCandidateScore(a,x)}))
    .filter(x=>terms.length||x.score>0)
    .sort((x,y)=>y.score-x.score||relevance(y.asset)-relevance(x.asset))
    .slice(0,terms.length?12:6);
  if(cacheKey)joinCandidateCache.set(cacheKey,result);
  return result;
}
function renderJoinPlanLite(a,b){
  if(!b)return'<div class="dk-empty">Choose a candidate dataset to inspect the likely join path.</div>';
  let h=joinHint(a,b),label=h.label,detail=h.detail||"",key=h.shared?.map(x=>x.label).join(" · ")||"no recognised canonical key",cardinality="validate empirically",confidence="heuristic";
  if(a.depth==="modelled"&&b.depth==="modelled"){
    const p=planDatasetIntegration(a,b);
    if(p?.status&&p.status!=="none"){label=p.label||label;detail=(p.warnings||[])[0]||detail;key=p.key||key;cardinality=p.cardinality||cardinality;confidence=p.confidence||"curated inference"}
  }
  return '<article class="join-plan-lite"><header><h4>'+esc(label)+'</h4><code>'+esc(confidence)+'</code></header><p><b>Candidate key:</b> '+esc(key)+' · <b>cardinality:</b> '+esc(cardinality)+'</p><p>'+esc(detail||"Validate key meaning, uniqueness, version and row multiplication before joining.")+'</p>'+(h.shared?.length?'<div class="shared-ids">'+h.shared.map(x=>'<span>'+esc(x.label)+'</span>').join("")+'</div>':"")+'</article>';
}
function joinCandidateMarkup(candidates){
  return candidates.length?candidates.map(x=>'<button type="button" class="join-candidate" data-join-target="'+esc(x.asset.id)+'"><div><b>'+esc(x.asset.title)+'</b><small>'+esc(srcLabel(x.asset))+' · '+esc(inferDatasetBrief(x.asset).grain)+'</small></div><span>'+esc(x.hint.label)+'</span></button>').join(""):'<div class="dk-empty">No obvious candidate from the current metadata. Search by dataset title, publisher, field or topic.</div>';
}
function renderJoinCandidates(a,query=""){return joinCandidateMarkup(topJoinCandidates(a,query))}
function renderJoinFinder(a){
  const best=topJoinCandidates(a),initial=best[0]?.asset||null;
  state.joinTarget=state.joinTarget&&by(state.joinTarget)?state.joinTarget:(initial?.id||"");
  const target=by(state.joinTarget);
  return '<section class="join-finder"><div class="section-cap"><h3>Join Finder</h3><span>identifier-first · metadata-aware</span></div><div class="join-finder-search"><input id="joinFinderSearch" type="search" placeholder="Find another dataset to combine with…"><button id="joinFinderClear" type="button">Best matches</button></div><div id="joinFinderResults" class="join-candidates">'+joinCandidateMarkup(best)+'</div><div id="joinFinderPlan">'+renderJoinPlanLite(a,target)+'</div><p class="dk-note">Harvested-dataset suggestions are heuristic. The Join Finder never treats matching names alone as a safe key.</p></section>';
}
function renderLdesPanel(a){
  const stream=ldesCapability(a);
  if(stream.status==="none")return"";
  if(stream.status==="mentioned_only")
    return '<p class="ldes-mention">LDES is mentioned in this catalogue record, but no stream endpoint was captured. Follow the official source link; this is not yet classified as an accessible stream.</p>';
  return '<section class="ldes-panel" aria-label="Linked Data Event Stream"><header><div><small>DELIVERY · PUBLISHER-DECLARED</small><h3>Linked Data Event Stream (LDES)</h3></div><span>STREAM</span></header>'+
    '<p>The publisher lists a versioned data stream. An LDES consumer follows TREE links to synchronize members and can build its own queryable view.</p>'+
    '<div class="ldes-endpoints">'+stream.endpoints.map(ep=>'<div><small>Publisher endpoint · '+esc(ep.format||"LDES")+'</small><a href="'+esc(ep.url)+'" target="_blank" rel="noopener noreferrer">'+esc(ep.url)+' ↗</a></div>').join("")+'</div>'+
    (a.endpointDescription&&/^https:\/\//.test(a.endpointDescription)?'<a class="ldes-doc-link" href="'+esc(a.endpointDescription)+'" target="_blank" rel="noopener noreferrer">Publisher endpoint documentation ↗</a>':"")+
    '<p class="ldes-limit"><b>What is verified here:</b> a publisher-described endpoint. <b>What is not:</b> live health, history completeness, record freshness, or a synchronized SQL/MCP mirror. This is not a CSV download or a browser preview.</p></section>';
}
function renderInspector(){
  const a=by(state.selected);if(!a)return;
  const modelled=a.depth==="modelled",observedFile=a.schemaOrigin==="observed-file-header",fresh=publisherFreshness(a),liveKind=livePreviewKind(a);
  const analysis=analysisReadiness(a),previewable=(a.distributions||[]).some(x=>distributionCapability(x).group==="inspectable");
  $("#assetInspector").innerHTML=
    '<header class="asset-inspector-head"><div class="hierarchy"><span>'+esc(srcLabel(a))+'</span><i>›</i><strong>'+esc(a.datasetId)+'</strong></div><h2>'+esc(a.title)+'</h2><div class="dataset-actions"><button id="assetStackToggle" class="'+(state.stack.has(a.id)?"stacked":"")+'">'+(state.stack.has(a.id)?"✓ Pinned":"+ Pin")+'</button>'+(a.evidence?.[0]?'<a href="'+esc(a.evidence[0])+'" target="_blank" rel="noopener">Official ↗</a>':"")+'</div></header><div class="analysis-banner '+analysis.kind+'"><div><b>'+analysis.label+'</b><span>'+esc(analysis.detail)+'</span></div>'+(analysis.kind==="ready"||analysis.kind==="possible"?'<button type="button" data-analyze-asset="'+esc(a.id)+'">'+(analysis.kind==="ready"?"Analyze in SQL":"Try in SQL")+'</button>':"")+(previewable?'<span class="preview-flag">PREVIEWABLE</span>':"")+'</div>'+renderWhyResult(a)+renderLdesPanel(a)+renderDatasetBrief(a)+renderTrustPanel(a)+'<div data-card-slot="'+esc(a.id)+'"></div>'+renderFamilySection(a)+provenanceChips(a)+datasetSignalPanel(a)+
    '<p class="harvest-note"><b>Contains</b> '+esc(a.description||[a.kind,a.shape].filter(Boolean).join(" · "))+'</p><div class="compact-facts"><div><small>GRAIN</small><b>'+esc(a.grain)+'</b></div><div><small>'+(modelled?"TIME":a.depth==="structured"?"STRUCTURE":observedFile?"OBSERVED FILE":"METADATA")+'</small><b>'+esc(modelled?a.time:(a.depth==="structured"?(a.schema.length+" fields"+(a.recordCount!=null?" · "+Number(a.recordCount).toLocaleString()+" rows":"")):observedFile?(a.schema.length+" observed fields"+(a.recordCount!=null?" · "+rowCountLabel(a):"")):"catalogue only"))+'</b></div><div><small>DELIVERY</small><b>'+esc(a.formats.slice(0,3).join(" · ")||a.shape)+'</b></div><div title="'+esc(fresh.note||"")+'"><small>'+esc(fresh.label)+'</small><b>'+esc(fresh.value)+'</b></div></div>'+renderJoinFinder(a)+
    snapshotPreview(a)+distributionGroups(a)+ (liveKind?'<section class="live-preview-section"><div class="section-cap"><h3>'+ (liveKind==="tabular"?"Browser data profiler":"Live API preview") +'</h3><button id="previewBtn">'+(liveKind==="tabular"?"Preview sample":a.previewRows?.length?"Refresh live":"Preview 5 rows")+'</button></div><div id="livePreview"></div></section>':"")+feedbackCard(a,srcLabel(a))+
    '<div class="one-warning"><b>Watch</b> '+esc(a.caveat||"Check the publisher metadata and distribution conditions before use.")+'</div>'+
    (modelled?renderKnowledge(a):"")+(modelled?detailsModeled(a):detailsHarvested(a));
  $("#assetStackToggle").onclick=()=>toggleDatasetPin(a.id);
  const pb=$("#previewBtn");if(pb)pb.onclick=()=>loadPreview(a);
  const pt=$("#datasetPlanTarget");if(pt)pt.onchange=e=>{state.planTarget=e.target.value;const t=modeledBy(state.planTarget);$("#datasetPlanResult").innerHTML=t?renderPlanCard(a,t):""};
  const jf=$("#joinFinderSearch");if(jf)jf.oninput=e=>{$("#joinFinderResults").innerHTML=renderJoinCandidates(a,e.target.value)};
  const jc=$("#joinFinderClear");if(jc)jc.onclick=()=>{if(jf)jf.value="";const first=topJoinCandidates(a)[0]?.asset||null;state.joinTarget=first?.id||"";$("#joinFinderResults").innerHTML=renderJoinCandidates(a);$("#joinFinderPlan").innerHTML=renderJoinPlanLite(a,first)};
  fillCardSlots($("#assetInspector")).catch(()=>{});   // dataset card, fetched lazily from /cards/
}
function saveStack(){
  const ids=[...state.stack],meta=Object.fromEntries(selectedPinDetails().map(a=>[a.id,a]));
  localStorage.setItem(stackKey,JSON.stringify(ids));
  localStorage.setItem(pinMetaKey,JSON.stringify(meta));
  renderStack();
}
function renderStack(){
  const details=selectedPinDetails(),counts={ready:0,possible:0,download:0,"not-tabular":0};
  details.forEach(x=>{const k=x.analysisStatus?.kind||"not-tabular";counts[k]=(counts[k]||0)+1});
  const analyzable=details.filter(x=>["ready","possible"].includes(x.analysisStatus?.kind)),btn=$("#dsSqlPinned"),summary=$("#dsSelectionSummary");
  if(btn){
    btn.disabled=!analyzable.length;
    btn.textContent=counts.ready?"Analyze "+counts.ready+" ready"+(counts.possible?" · try "+counts.possible+" possible":""):counts.possible?"Try "+counts.possible+" SQL possible":"Analyze pinned";
  }
  if(summary){
    summary.hidden=!details.length;
    summary.innerHTML=details.length?'<b>'+details.length+' pinned</b><span>'+counts.ready+' SQL ready</span><span>'+counts.possible+' possible</span><span>'+counts.download+' download-only</span><span>'+counts["not-tabular"]+' not tabular</span>':"";
  }
  document.dispatchEvent(new CustomEvent("bdd:dataset-stack-change",{detail:{items:details,count:details.length,analysisCounts:counts}}));
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
  state.q=state.source=state.kind=state.format=state.depth=state.delivery=state.analysis=state.topic=state.licence="";state.scope="all";state.pinnedOnly=false;
  $("#datasetSearch").value="";renderFilters();$("#dsPinnedOnly").classList.remove("active");$("#dsPinnedOnly").setAttribute("aria-pressed","false");
  state.selected=id;state.forceVisible=id;renderList();
  $("#assetInspector").scrollIntoView({behavior:"smooth",block:"start"});
}

function setCollectionActive(query=""){document.querySelectorAll("[data-collection-query]").forEach(b=>b.classList.toggle("active",b.dataset.collectionQuery===query))}
function reset(){state.scope="datasets";state.q=state.source=state.kind=state.format=state.depth=state.delivery=state.analysis=state.topic=state.licence="";state.pinnedOnly=state.nationalOnly=false;$("#datasetSearch").value="";$("#dsPinnedOnly").classList.remove("active");$("#dsNational").classList.remove("active");$("#dsNational").setAttribute("aria-pressed","false");setCollectionActive("");renderFilters();renderList()}
function init(){
  fillTopics();fillLicences();renderFilters();renderList();renderStack();
  const initialLoads=Promise.all([loadHarvest(),loadNationalMeta()]);
  // Keep the 10k+ national catalogue off the landing-page critical path, even though Dataset Atlas is the default view.
  // A search/filter/national-index action hydrates it once; deep links hydrate immediately because they need an exact record.
  // Deep link: /?dataset=<id> still hydrates the full catalogue before opening its record.
  const wanted=(()=>{try{return new URLSearchParams(location.search).get("dataset")||""}catch{return ""}})();
  if(wanted)Promise.all([initialLoads,loadNational()]).then(()=>openPinnedDataset(wanted));
  $("#dsScope").onclick=e=>{const b=e.target.closest("[data-scope]");if(b){state.scope=b.dataset.scope;renderList();if(!state.nationalLoaded)loadNational()}};
  $("#dsTopic").onchange=e=>{state.topic=e.target.value;renderList();if(!state.nationalLoaded)loadNational()};
  $("#dsLicence").onchange=e=>{state.licence=e.target.value;renderList();if(!state.nationalLoaded)loadNational()};
  const applyDatasetSearch=()=>{state.q=$("#datasetSearch").value.trim();setCollectionActive("");renderList();if(state.q&&!state.nationalLoaded)loadNational()};
  $("#datasetSearch").oninput=applyDatasetSearch;
  $("#datasetSearch").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();applyDatasetSearch()}};
  $("#dsSearchBtn").onclick=applyDatasetSearch;
  [["#dsSource","source"],["#dsKind","kind"],["#dsFormat","format"],["#dsDepth","depth"],["#dsDelivery","delivery"],["#dsAnalysis","analysis"]].forEach(([s,k])=>$(s).onchange=e=>{state[k]=e.target.value;renderList();if(!state.nationalLoaded)loadNational()});
  $("#dsReset").onclick=reset;$("#dsNational").onclick=()=>loadNational({focus:true});
  $("#dsFamilies").onclick=()=>{state.groupFamilies=!state.groupFamilies;const b=$("#dsFamilies");b.classList.toggle("active",state.groupFamilies);b.setAttribute("aria-pressed",String(state.groupFamilies));b.textContent=state.groupFamilies?"Families grouped":"Individual records";renderList()};
  $("#dsSqlPinned").onclick=()=>document.dispatchEvent(new CustomEvent("bdd:sql-add-items",{detail:{items:selectedPinDetails()}}));
  $("#dsPinnedOnly").onclick=()=>{state.pinnedOnly=!state.pinnedOnly;$("#dsPinnedOnly").classList.toggle("active",state.pinnedOnly);$("#dsPinnedOnly").setAttribute("aria-pressed",String(state.pinnedOnly));renderList()};
  document.addEventListener("bdd:dataset-pin-toggle",e=>toggleDatasetPin(e.detail?.id));
  document.addEventListener("bdd:dataset-clear",()=>{state.stack.clear();saveStack();renderList()});
  document.addEventListener("bdd:dataset-export",exportDatasetManifest);
  document.addEventListener("bdd:dataset-open",e=>openPinnedDataset(e.detail?.id));
  document.addEventListener("bdd:sql-access-result",e=>{const d=e.detail||{};if(!d.url)return;state.sqlAccess[d.url]={kind:d.ok?"ok":"fail",transport:d.transport||"",code:d.code||"",checkedAt:Date.now(),detail:d.ok?(d.transport==="relay"?"Complete file loaded through the approved catalogue relay.":"Direct DuckDB browser load succeeded."):(d.detail||"SQL load failed; use download/drop instead.")};persistSqlAccess();renderList();renderStack()});
  document.addEventListener("click",e=>{const collection=e.target.closest("[data-collection-query]");if(collection){const q=collection.dataset.collectionQuery||"";state.q=q;state.source=state.kind=state.format=state.depth=state.delivery=state.analysis=state.topic=state.licence="";state.pinnedOnly=state.nationalOnly=false;$("#datasetSearch").value=q;$("#dsPinnedOnly").classList.remove("active");$("#dsNational").classList.remove("active");$("#dsNational").setAttribute("aria-pressed","false");setCollectionActive(q);renderFilters();renderList();if(!state.nationalLoaded)loadNational();return}const family=e.target.closest("[data-family-member]");if(family){state.selected=family.dataset.familyMember;state.joinTarget="";renderList();$("#assetInspector")?.scrollIntoView({behavior:"smooth",block:"start"});return}const join=e.target.closest("[data-join-target]");if(join){const a=by(state.selected),t=by(join.dataset.joinTarget);state.joinTarget=t?.id||"";const box=$("#joinFinderPlan");if(box&&a)box.innerHTML=renderJoinPlanLite(a,t);return}const analyze=e.target.closest("[data-analyze-asset]");if(analyze){const asset=by(analyze.dataset.analyzeAsset);if(asset)document.dispatchEvent(new CustomEvent("bdd:sql-add-items",{detail:{items:[pinDetails(asset)]}}));return}const sqlDist=e.target.closest("[data-sql-dist-url]");if(sqlDist){document.dispatchEvent(new CustomEvent("bdd:sql-add-url",{detail:{url:sqlDist.dataset.sqlDistUrl,format:sqlDist.dataset.sqlDistFormat,name:sqlDist.dataset.sqlDistName}}));return}const report=e.target.closest("[data-report-asset]");if(report){const asset=by(report.dataset.reportAsset);if(asset)openDatasetFeedback(asset,{publisherName:srcLabel(asset),profile:liveProfiles.get(asset.id)||asset.tabularProfile||null});return}const local=e.target.closest("[data-run-file-validation]");if(local){runLocalValidationUi(local);return}const run=e.target.closest("[data-run-validation]");if(run){runValidationUi(run);return}const pin=e.target.closest("[data-dataset-pin]");if(pin){toggleDatasetPin(pin.dataset.datasetPin);return}const a=e.target.closest("[data-asset]");if(a){state.selected=a.dataset.asset;state.forceVisible="";try{history.replaceState(null,"","?dataset="+encodeURIComponent(a.dataset.asset)+location.hash)}catch{}renderList()}const r=e.target.closest("[data-related]");if(r){state.selected=r.dataset.related;renderList();$("#assetInspector").scrollIntoView({behavior:"smooth",block:"start"})}});
}
init();