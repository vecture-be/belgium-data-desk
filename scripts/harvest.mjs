import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fetchNationalCatalogue, thinNationalCatalogue, validateNationalCatalogue } from "./national-dcat.mjs";
import { kindOf, normalizeLicense, topicOf } from "./curate.mjs";
import { RELAY_INDEX_PATH, writeRelayIndex } from "./relay-index-lib.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const outPath=path.resolve(__dirname,"../public/harvested-catalog.json");
const nationalPath=path.resolve(__dirname,"../public/national-catalog.json");
const manifestPath=path.resolve(__dirname,"../public/catalogue-manifest.json");
const now=new Date().toISOString(),timeoutMs=14000,ua="Belgium-Data-Desk/2.0 (+https://data.vecture.be)";

async function getJson(url){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);
  try{const r=await fetch(url,{headers:{"user-agent":ua,accept:"application/json"},signal:c.signal});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.json()}
  finally{clearTimeout(t)}
}
async function getText(url,ms=timeoutMs){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  try{
    const r=await fetch(url,{headers:{"user-agent":ua,accept:"application/json,application/ld+json,application/xml,text/xml,text/html"},signal:c.signal});
    if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
    return await r.text();
  }finally{clearTimeout(t)}
}
const clean=s=>String(s??"").replace(/\s+/g," ").trim();
const metaText=v=>Array.isArray(v)?metaText(v[0]):typeof v==="string"?clean(v):"";
const uniq=a=>[...new Set((a||[]).filter(Boolean).map(clean))];
const formats=r=>uniq((r||[]).flatMap(x=>[x.format,x.mimetype])).slice(0,12);
const extras=p=>Object.fromEntries((p.extras||[]).map(x=>[String(x.key||"").toLowerCase(),x.value]));
const compactValue=v=>{
  if(v==null||typeof v==="number"||typeof v==="boolean")return v;
  if(typeof v==="object"){
    if(v.type&&v.coordinates)return {geometryType:v.type};
    v=JSON.stringify(v);
  }
  const s=String(v);return s.length>140?s.slice(0,137)+"…":s;
};
const compactRow=row=>{
  const out={};for(const [k,v] of Object.entries(row||{}).slice(0,10))out[k]=compactValue(v);return out;
};
const compactPreview=rows=>(rows||[]).slice(0,2).map(compactRow);
const quality=x=>{
  let score=15,reasons=[];
  if(x.fields?.length){score+=30;reasons.push(`${x.fields.length} published fields`)}
  if(Number.isFinite(x.recordCount)){score+=15;reasons.push("record count")}
  if(x.extent?.spatial||x.extent?.temporal){score+=15;reasons.push("extent")}
  if(x.updatedAt){score+=10;reasons.push("update timestamp")}
  if(x.license){score+=5;reasons.push("licence")}
  if(x.distributions?.length>1){score+=5;reasons.push(`${x.distributions.length} distributions`)}
  if(x.description?.length>80)score+=5;
  const schemaBacked=x.schemaOrigin==="publisher-schema"&&!!x.fields?.length;
  if(x.previewRows?.length)reasons.push("actual sampled records");
  return{score:Math.min(100,score),level:schemaBacked?"structured":"harvested",reasons,schemaOrigin:x.schemaOrigin||"none",sampled:!!x.previewRows?.length};
}

function readNationalItems(index){
  try{
    const dir=path.dirname(nationalPath);
    return (index?.chunks||[]).flatMap(x=>JSON.parse(fs.readFileSync(path.join(dir,x.file),"utf8")).items||[]);
  }catch{return[]}
}
async function mapLimit(xs,n,fn){
  const out=new Array(xs.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=xs.length)return;try{out[i]=await fn(xs[i],i)}catch(e){out[i]={error:e.message}}}}
  await Promise.all(Array.from({length:Math.min(n,xs.length)},worker));return out;
}

async function harvestCkan(){
  const base="https://transportdata.be",j=await getJson(base+"/api/3/action/package_search?rows=1000"),rows=j?.result?.results||[];
  const packages=await mapLimit(rows,8,async p=>{
    const ex=extras(p),dsResources=(p.resources||[]).filter(r=>r.datastore_active).slice(0,3);
    let fields=[],previewRows=[];
    for(const r of dsResources){try{const d=await getJson(base+"/api/3/action/datastore_search?limit=2&resource_id="+encodeURIComponent(r.id));for(const f of d?.result?.fields||[])fields.push({name:f.id,type:f.type,label:f.info?.label||f.id,resource:r.name||r.id});if(!previewRows.length)previewRows=compactPreview(d?.result?.records||[])}catch{}}
    const spatial=ex.spatial||ex["spatial_uri"]||ex["geographic_coverage"]||null,temporal=ex.temporal||ex["temporal_coverage"]||null;
    const x={id:"harvest:transport:"+p.id,provider:"transportdata.be",platform:"CKAN",datasetId:p.name||p.id,title:clean(p.title||p.name),description:clean(p.notes).slice(0,700),kind:"catalogue dataset/service",formats:formats(p.resources),updatedAt:p.metadata_modified||p.metadata_created||null,recordCount:null,fields:fields.slice(0,40),extent:{spatial,temporal},themes:uniq([...(p.tags||[]).map(t=>t.display_name||t.name),...(p.groups||[]).map(g=>g.display_name||g.name)]).slice(0,15),license:clean(p.license_title||p.license_id),organization:clean(p.organization?.title||p.organization?.name),contactName:clean(p.maintainer||p.author||""),contactEmail:clean(p.maintainer_email||p.author_email||""),contactUrl:metaText(ex.contact_url||ex["contact website"]||ex.website||""),previewRows,schemaOrigin:fields.length?"publisher-schema":"none",sampleOrigin:previewRows.length?"live-api-records":"none",officialUrl:base+"/dataset/"+(p.name||p.id),distributions:(p.resources||[]).slice(0,15).map(r=>({name:clean(r.name||r.description||r.format||"resource"),format:clean(r.format||r.mimetype),url:r.url||null,updatedAt:r.last_modified||r.created||null,byteSize:Number(r.size)>0?Number(r.size):null,datastore:!!r.datastore_active}))};
    return Object.assign(x,{enrichment:quality(x)});
  });
  return packages.filter(x=>!x.error);
}

async function odsPages(host){
  let rows=[];for(let offset=0;;offset+=100){const j=await getJson(host+"/api/explore/v2.1/catalog/datasets?limit=100&offset="+offset),batch=j?.results||[];rows.push(...batch);if(batch.length<100||offset>=1900)break}return rows;
}
const normTitle=t=>String(t||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
// Aggregator portals (ODWB) federate datasets that portals we harvest directly already publish; the dedicated-portal record wins.
async function harvestOds(host,provider,{publisherFromMeta=false,skipPublishers=null,skipTitles=null,fieldCap=80}={}){
  const rows=await odsPages(host);
  const basics=rows.map(x=>{
    const d=x.dataset||x,m=d.metas?.default||d.metas?.en||d.metas?.nl||d.metas?.fr||{},id=d.dataset_id||x.dataset_id;
    const fields=(d.fields||x.fields||[]).map(f=>({name:f.name||f.id,label:f.label||f.name||f.id,type:f.type||f.annotations?.type||"",description:clean(f.description||f.annotations?.description)})).slice(0,fieldCap);
    const dm=d.metas||{};
    const dataProcessedAt=d.data_processed_at||dm.data_processed||dm.data_processed_at||m.data_processed||m.data_processed_at||null;
    const metadataProcessedAt=d.metadata_processed_at||dm.metadata_processed||dm.metadata_processed_at||m.metadata_processed||m.metadata_processed_at||null;
    const catalogueModifiedAt=d.modified||dm.modified||m.modified||null;
    const ext={spatial:m.bbox||m.geographic_reference||m.geographic_area||null,temporal:m.temporal_coverage||null};
    const count=Number(m.records_count??d.records_count??x.records_count);
    const publisher=publisherFromMeta?(metaText(m.publisher)||provider):provider;
    return{id:"harvest:"+provider.toLowerCase().replace(/\W+/g,"-")+":"+id,provider:publisher,aggregator:publisherFromMeta?provider:undefined,platform:"OpenDataSoft",datasetId:id,title:clean(m.title||id),description:clean(m.description).slice(0,420),kind:"OpenDataSoft dataset",formats:["Explore API 2.1","CSV","JSON"],updatedAt:dataProcessedAt||metadataProcessedAt||catalogueModifiedAt||null,dataProcessedAt,metadataProcessedAt,catalogueModifiedAt,recordCount:Number.isFinite(count)?count:null,fields,extent:ext,themes:uniq([...(m.theme||[]),...(m.keyword||[]),...(m.publisher||[])]).slice(0,15),license:clean(m.license||m.license_url),contactName:metaText(m.contact_name||m.contact||m.publisher||""),contactEmail:metaText(m.contact_email||m.email||dm.contact_email||""),contactUrl:metaText(m.contact_url||m.publisher_url||m.website||""),schemaOrigin:fields.length?"publisher-schema":"none",sampleOrigin:"none",officialUrl:host+"/explore/dataset/"+id+"/",distributions:[{name:"Records API",format:"REST/JSON",url:host+"/api/explore/v2.1/catalog/datasets/"+id+"/records?limit=20"},{name:"CSV export",format:"CSV",url:host+"/explore/dataset/"+id+"/download/?format=csv"}]};
  });
  const titlesToSkip=typeof skipTitles==="function"?skipTitles():skipTitles;
  const kept=basics.filter(x=>!(skipPublishers&&skipPublishers.test(x.provider))&&!(titlesToSkip&&titlesToSkip.has(normTitle(x.title))));
  if(kept.length!==basics.length)console.log("[harvest] "+provider+": skipped "+(basics.length-kept.length)+" datasets already published by a dedicated portal");
  const enriched=await mapLimit(kept,12,async (x,i)=>{
    let previewRows=[];
    if(i<48&&x.fields.length){try{const j=await getJson(host+"/api/explore/v2.1/catalog/datasets/"+encodeURIComponent(x.datasetId)+"/records?limit=2");previewRows=compactPreview(j?.results||[])}catch{}}
    const out={...x,previewRows,sampleOrigin:previewRows.length?"live-api-records":"none"};return Object.assign(out,{enrichment:quality(out)});
  });
  return enriched.filter(x=>!x.error);
}

const ogcServices=[
  ["grb","Digitaal Vlaanderen — GRB","https://geo.api.vlaanderen.be/GRB/ogc/features/v1",999],
  ["adpf","Digitaal Vlaanderen — Adpf","https://geo.api.vlaanderen.be/Adpf/ogc/features/v1",999],
  ["vkbo","Digitaal Vlaanderen — VKBO","https://geo.api.vlaanderen.be/VKBO/ogc/features/v1",999],
  ["gipod","Digitaal Vlaanderen — GIPOD","https://geo.api.vlaanderen.be/GIPOD/ogc/features/v1",999],
  ["wegenregister","Digitaal Vlaanderen — Wegenregister","https://geo.api.vlaanderen.be/Wegenregister/ogc/features/v1",999],
  ["buildings","Digitaal Vlaanderen — Buildings","https://geo.api.vlaanderen.be/bu-core2d/ogc/features/v1",999],
  ["perceelblokken","Digitaal Vlaanderen — Perceelblokken","https://geo.api.vlaanderen.be/Perceelblokken/ogc/features/v1",999],
  ["brussels-active","Brussels Mobility — Active mobility","https://data.mobility.brussels/datasets/v1/active_mobility",999],
  ["brussels-parking","Brussels Mobility — Parking","https://data.mobility.brussels/datasets/v1/parking",999],
  ["brussels-traffic","Brussels Mobility — Traffic","https://data.mobility.brussels/datasets/v1/traffic",999],
  ["dov","DOV — Databank Ondergrond Vlaanderen","https://www.dov.vlaanderen.be/geoserver/ogc/features/v1",80],
  ["wallonia-buildings","SPW Wallonia — Buildings HVD","https://geoservices.wallonie.be/geoserver/inspire_bu/ogc/features/v1",999],
  ["wallonia-transport","SPW Wallonia — Transport Networks HVD","https://geoservices.wallonie.be/geoserver/inspire_tn/ogc/features/v1",999],
  ["wallonia-names","SPW Wallonia — Geographical Names HVD","https://geoservices.wallonie.be/geoserver/inspire_gn/ogc/features/v1",999],
  ["wallonia-management","SPW Wallonia — Management Zones HVD","https://geoservices.wallonie.be/geoserver/inspire_am/ogc/features/v1",999]
];
async function harvestOgcService([slug,provider,base,sampleLimit=999]){
  const j=await getJson(base+"/collections?f=json"),cs=j?.collections||[];
  const enriched=await mapLimit(cs,8,async (c,i)=>{
    let q={};if(i<sampleLimit){try{q=await getJson(base+"/collections/"+encodeURIComponent(c.id)+"/queryables?f=json")}catch{}}
    const publisherSchema=!!Object.keys(q.properties||{}).length;
    let fields=Object.entries(q.properties||{}).map(([name,v])=>({name,label:v.title||name,type:v.type||v.format||"",description:clean(v.description)})).slice(0,80),sample={},recordCount=null;
    if(i<sampleLimit&&(!fields.length||recordCount==null)){
      try{
        sample=await getJson(base+"/collections/"+encodeURIComponent(c.id)+"/items?limit=1");
        recordCount=Number.isFinite(Number(sample.numberMatched))?Number(sample.numberMatched):null;
        if(!fields.length){
          const props=sample.features?.[0]?.properties||{};
          fields=Object.entries(props).map(([name,v])=>({name,label:name,type:Array.isArray(v)?"array":v===null?"unknown":typeof v,description:"sampled published property"})).slice(0,80);
        }
      }catch{}
    }
    const previewRows=sample.features?.length?compactPreview(sample.features.map(f=>({...f.properties,_geometry:f.geometry?.type}))):[];
    const e=c.extent||{},x={id:"harvest:"+slug+":"+c.id,provider,platform:"OGC API Features",datasetId:c.id,title:clean(c.title||c.id),description:clean(c.description).slice(0,700),kind:"OGC feature collection",formats:["OGC API Features","GeoJSON"],updatedAt:j.timeStamp||null,recordCount,fields,previewRows,schemaOrigin:publisherSchema?"publisher-schema":fields.length?"sample-observed":"none",sampleOrigin:previewRows.length?"live-api-records":"none",extent:{spatial:e.spatial?.bbox?.[0]||null,spatialCrs:e.spatial?.crs||c.storageCrs||null,temporal:e.temporal?.interval?.[0]||null},themes:[],license:"",crs:(c.crs||[]).slice(0,8),officialUrl:base+"/collections/"+encodeURIComponent(c.id)+"?f=text%2Fhtml",distributions:[{name:"Features",format:"OGC API Features",url:base+"/collections/"+encodeURIComponent(c.id)+"/items?limit=20"},{name:"Queryables",format:"JSON Schema",url:base+"/collections/"+encodeURIComponent(c.id)+"/queryables?f=json"}]};
    return Object.assign(x,{enrichment:quality(x)});
  });return enriched.filter(x=>!x.error);
}
async function harvestOgc(){
  const groups=await Promise.all(ogcServices.map(async s=>{
    try{return await harvestOgcService(s)}
    catch(e){console.warn("[harvest-ogc] "+s[0]+" failed: "+e.message);return[]}
  }));
  return groups.flat();
}


function jsonLdText(v){
  if(v==null)return"";
  if(typeof v==="string"||typeof v==="number")return String(v);
  if(Array.isArray(v))return v.map(jsonLdText).find(Boolean)||"";
  return jsonLdText(v["@value"]??v["@id"]??v.value??v.name??v.label);
}
function jsonLdFind(o,name){
  if(!o||typeof o!=="object")return[];
  const want=name.toLowerCase(),out=[];
  for(const [k,v] of Object.entries(o)){
    const tail=k.toLowerCase().split(/[\/#:]/).pop();
    if(tail===want){
      const xs=Array.isArray(v)?v:[v];
      for(const x of xs){const s=jsonLdText(x);if(s)out.push(s)}
    }
  }
  return out;
}
async function harvestBrusselsMobility(){
  const catalogUrl="https://api.mobility.brussels/metadata/v3.0/catalogs/9108f856-4504-40ad-905e-a436c4fa6320/?output=json";
  const raw=JSON.parse(await getText(catalogUrl,30000));
  const candidates=[],seenObjects=new Set();
  const walk=o=>{
    if(!o||typeof o!=="object"||seenObjects.has(o))return;seenObjects.add(o);
    const type=[...(jsonLdFind(o,"type")),...(Array.isArray(o["@type"])?o["@type"]:[o["@type"]]).filter(Boolean)].join(" ");
    if(/dataset/i.test(type)||Object.keys(o).some(k=>/distribution$/i.test(k)))candidates.push(o);
    for(const v of Object.values(o))if(v&&typeof v==="object"){if(Array.isArray(v))v.forEach(walk);else walk(v)}
  };
  walk(raw);
  const out=[],seen=new Set();
  for(const d of candidates){
    const rawId=d["@id"]||jsonLdFind(d,"identifier")[0]||"dataset-"+out.length;
    const uuid=(String(rawId).match(/[0-9a-f]{8}-[0-9a-f-]{27,36}/i)||[])[0];
    const id=uuid||String(rawId);if(seen.has(id))continue;seen.add(id);
    const title=jsonLdFind(d,"title")[0]||jsonLdFind(d,"name")[0]||id;
    const desc=jsonLdFind(d,"description")[0]||"";
    const modified=jsonLdFind(d,"modified")[0]||null;
    const distRaw=Object.entries(d).filter(([k])=>/distribution$/i.test(k)).flatMap(([,v])=>Array.isArray(v)?v:[v]).filter(Boolean);
    const distributions=distRaw.map((z,i)=>{
      const url=jsonLdFind(z,"accessURL")[0]||jsonLdFind(z,"downloadURL")[0]||(typeof z==="object"?z["@id"]:null);
      return{name:jsonLdFind(z,"title")[0]||"distribution "+(i+1),format:jsonLdFind(z,"format")[0]||jsonLdFind(z,"mediaType")[0]||"",url};
    }).filter(x=>x.url);
    const formats=uniq(distributions.map(x=>x.format));
    const officialUrl=uuid?"https://data.mobility.brussels/en/info/"+uuid+"/":(jsonLdFind(d,"landingPage")[0]||String(rawId));
    const x={id:"harvest:brussels-mobility:"+id,provider:"Brussels Mobility",platform:"DCAT-AP 3",datasetId:id,title:clean(title),description:clean(desc).slice(0,700),kind:"DCAT dataset",formats,updatedAt:modified,recordCount:null,fields:[],previewRows:[],schemaOrigin:"none",sampleOrigin:"none",extent:{},themes:uniq(jsonLdFind(d,"theme").concat(jsonLdFind(d,"keyword"))).slice(0,15),license:jsonLdFind(d,"license")[0]||"",officialUrl,distributions};
    out.push(Object.assign(x,{enrichment:quality(x)}));
  }
  return out;
}


const xmlDecode=s=>String(s||"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'");
const xmlOne=(x,name)=>{
  const m=x.match(new RegExp("<(?:\\w+:)?"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?"+name+">","i"));
  return xmlDecode(m?.[1]||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
};
const xmlMany=(x,name)=>[...x.matchAll(new RegExp("<(?:\\w+:)?"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?"+name+">","gi"))].map(m=>xmlDecode(m[1]).replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()).filter(Boolean);

// One unreadable record fails a whole GeoNetwork page (Metawal record 52806); bisect so only that record is skipped.
async function cswPage(endpoint,params,start,count){
  const p=new URLSearchParams(params);p.set("maxRecords",String(count));p.set("startPosition",String(start));
  const xml=await getText(endpoint+"?"+p.toString(),30000);
  if(!/<ows:ExceptionReport/i.test(xml))return xml;
  if(count<=1){console.warn("[harvest-csw] skipping unreadable record at position "+start);return"";}
  const half=Math.ceil(count/2);
  return (await cswPage(endpoint,params,start,half))+(await cswPage(endpoint,params,start+half,count-half));
}
async function harvestCsw(slug,provider,endpoint,maxPages){
  const out=[];let matched=Infinity;
  for(let page=0;page<maxPages;page++){
    const start=page*100+1;if(start>matched)break;
    const params=new URLSearchParams({service:"CSW",version:"2.0.2",request:"GetRecords",resultType:"results",typeNames:"csw:Record",elementSetName:"summary",outputFormat:"application/xml",maxRecords:"100",startPosition:String(start)});
    const xml=await cswPage(endpoint,params,start,100),total=xml.match(/numberOfRecordsMatched="(\d+)"/);
    if(total)matched=Number(total[1]);
    const records=[...xml.matchAll(/<(?:csw:)?(?:Record|SummaryRecord)\b[\s\S]*?<\/(?:csw:)?(?:Record|SummaryRecord)>|<(?:gmd:)?MD_Metadata\b[\s\S]*?<\/(?:gmd:)?MD_Metadata>/gi)].map(m=>m[0]);
    for(const r of records){
      const id=xmlOne(r,"identifier")||xmlOne(r,"fileIdentifier")||slug+"-"+out.length,title=xmlOne(r,"title");if(!title)continue;
      const refs=xmlMany(r,"references").filter(u=>/^https?:/i.test(u)),fmts=uniq(xmlMany(r,"format")),themes=uniq(xmlMany(r,"subject")).slice(0,8);
      const x={id:"harvest:"+slug+":"+id,provider,platform:"OGC CSW / GeoNetwork",datasetId:id,title:clean(title),description:clean(xmlOne(r,"abstract")).slice(0,320),kind:xmlOne(r,"type")||"catalogue record",formats:fmts,updatedAt:xmlOne(r,"modified")||null,recordCount:null,fields:[],previewRows:[],schemaOrigin:"none",sampleOrigin:"none",extent:{},themes,license:"",officialUrl:refs[0]||null,distributions:refs.slice(0,10).map((u,i)=>({name:"reference "+(i+1),format:"URL",url:u}))};
      out.push(Object.assign(x,{enrichment:quality(x)}));
    }
    if(!records.length)break;
  }
  return [...new Map(out.map(x=>[x.id,x])).values()];
}


const nationalChunkTarget=4*1024*1024;
function splitNationalItems(items,maxBytes=nationalChunkTarget){
  const groups=[];let group=[],bytes=64;
  for(const item of items||[]){
    const size=Buffer.byteLength(JSON.stringify(item))+1;
    if(group.length&&bytes+size>maxBytes){groups.push(group);group=[];bytes=64}
    group.push(item);bytes+=size;
  }
  if(group.length)groups.push(group);
  return groups;
}
function writeNationalSnapshot(payload){
  const out=thinNationalCatalogue(payload),dir=path.dirname(nationalPath);
  for(const name of fs.readdirSync(dir))if(/^national-catalog-\d{3}\.json$/.test(name))fs.unlinkSync(path.join(dir,name));
  const chunks=splitNationalItems(out.items).map((items,i)=>{
    const file="national-catalog-"+String(i+1).padStart(3,"0")+".json",body=JSON.stringify({generatedAt:out.generatedAt,items})+"\n",bytes=Buffer.byteLength(body);
    if(bytes>=25*1024*1024)throw new Error(file+" exceeds Cloudflare 25 MiB asset limit");
    fs.writeFileSync(path.join(dir,file),body);
    return{file,count:items.length,bytes,sha256:createHash("sha256").update(body).digest("hex").slice(0,16)};
  });
  const index={generatedAt:out.generatedAt,source:out.source,itemCount:out.itemCount,thin:true,health:out.health,profileSummary:out.profileSummary||null,series:out.series||[],chunks};
  fs.writeFileSync(nationalPath,JSON.stringify(index)+"\n");
  return{index,items:out.items};
}
async function harvestNationalDcat(){
  const payload=await fetchNationalCatalogue({generatedAt:now,userAgent:ua}),snapshot=writeNationalSnapshot(payload),out=snapshot.index;
  const total=out.chunks.reduce((n,x)=>n+x.bytes,0);
  console.log("[harvest-national] data.gov.be: "+out.itemCount+" datasets, "+out.health.publisherCount+" publishers, "+out.health.distributionCount+" distributions; "+out.chunks.length+" browser-loaded chunks, "+(total/1048576).toFixed(1)+" MiB total");
  return snapshot;
}
function readHealthyNationalSnapshot(){
  try{
    const payload=JSON.parse(fs.readFileSync(nationalPath,"utf8"));
    if(payload?.health?.ok&&Array.isArray(payload.chunks)&&payload.chunks.length)return payload;
    const health=validateNationalCatalogue(payload);
    return health.ok?{...payload,health}:null;
  }catch{return null}
}

const harvestedTitles=()=>new Set(items.filter(x=>x.platform==="OpenDataSoft").map(x=>normTitle(x.title)));
const jobs=[
  ["transportdata",harvestCkan],
  ["infrabel",()=>harvestOds("https://opendata.infrabel.be","Infrabel")],
  ["elia",()=>harvestOds("https://opendata.elia.be","Elia")],
  ["fluvius",()=>harvestOds("https://opendata.fluvius.be","Fluvius")],
  ["city-of-ghent",()=>harvestOds("https://data.stad.gent","City of Ghent")],
  ["city-of-namur",()=>harvestOds("https://data.namur.be","City of Namur")],
  ["city-of-li-ge",()=>harvestOds("https://opendata.liege.be","City of Liège")],
  ["brussels-open-data",()=>harvestOds("https://bruxellesdata.opendatasoft.com","Brussels Open Data",{fieldCap:40})],
  ["open-data-wallonie-bruxelles",()=>harvestOds("https://www.odwb.be","Open Data Wallonie-Bruxelles",{publisherFromMeta:true,skipPublishers:/^(infrabel|elia)$/i,skipTitles:harvestedTitles,fieldCap:40})],
  ["digitaal-vlaanderen",harvestOgc],
  ["wallonia-metawal",()=>harvestCsw("wallonia","SPW Wallonia — Metawal","https://metawal.wallonie.be/geonetwork/srv/fre/csw",20)],
  ["geo-be",()=>harvestCsw("geo-be","geo.be / National Geographic Institute","https://publish.geo.be/geonetwork/srv/eng/csw",10)]
];
let previous={items:[],sources:{}};try{previous=JSON.parse(fs.readFileSync(outPath,"utf8"))}catch{}
const items=[],sources={};
for(const [name,fn] of jobs){
  try{const rows=await fn();if(!rows.length)throw new Error("source returned 0 rows");items.push(...rows);sources[name]={ok:true,count:rows.length,structured:rows.filter(x=>x.enrichment?.level==="structured").length,previews:rows.filter(x=>x.previewRows?.length).length,harvestedAt:now,attemptedAt:now};console.log(`[harvest] ${name}: ${rows.length} (${sources[name].structured} structured, ${sources[name].previews} previews)`)}
  catch(e){const fallback=(previous.items||[]).filter(x=>name==="digitaal-vlaanderen"?/Digitaal Vlaanderen|DOV|SPW Wallonia|Brussels Mobility/.test(x.provider||""):String(x.id).includes(name)||x.provider?.toLowerCase().includes(name));items.push(...fallback);sources[name]={ok:false,count:fallback.length,structured:fallback.filter(x=>x.enrichment?.level==="structured").length,previews:fallback.filter(x=>x.previewRows?.length).length,harvestedAt:previous.sources?.[name]?.harvestedAt||previous.generatedAt||null,attemptedAt:now,error:e.message,fallback:true};console.warn(`[harvest] ${name}: failed (${e.message}); fallback ${fallback.length}`)}
}
const dedup=[...new Map(items.filter(x=>x?.id&&x?.title).map(x=>[x.id,x])).values()];
for(const x of dedup){x.dataKind=kindOf(x);x.topic=topicOf(x);x.licenseFamily=normalizeLicense(x.license).family}
const payload={generatedAt:now,itemCount:dedup.length,structuredCount:dedup.filter(x=>x.enrichment?.level==="structured").length,previewCount:dedup.filter(x=>x.previewRows?.length).length,sources,items:dedup};
fs.writeFileSync(outPath,JSON.stringify(payload)+"\n");
console.log(`[harvest] wrote ${payload.itemCount} catalogue items (${payload.structuredCount} structured, ${payload.previewCount} previews) -> ${outPath}`);
let nationalRelayItems=[];
try{
  const snapshot=await harvestNationalDcat();
  nationalRelayItems=snapshot.items;
}catch(e){
  const fallback=readHealthyNationalSnapshot();
  if(fallback){
    nationalRelayItems=readNationalItems(fallback);
    console.warn("[harvest-national] refresh failed: "+e.message+"; using healthy snapshot with "+fallback.health.datasetCount+" datasets");
  }else throw new Error("[harvest-national] refresh failed and no healthy snapshot exists: "+e.message);
}
writeRelayIndex([...dedup,...nationalRelayItems]);
const manifest={generatedAt:now,files:{}};
for(const [name,file] of [["harvested-catalog.json",outPath],["national-catalog.json",nationalPath],["relay-index.mjs",RELAY_INDEX_PATH]]){
  const body=fs.readFileSync(file);
  manifest.files[name]={sha256:createHash("sha256").update(body).digest("hex").slice(0,16),bytes:body.byteLength};
}
fs.writeFileSync(manifestPath,JSON.stringify(manifest)+"\n");
console.log("[harvest] wrote catalogue manifest for versioned browser caching");
