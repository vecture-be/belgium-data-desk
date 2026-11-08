import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { detectSeries, kindOf, normalizeLicense, resolveSpatial, topicOf } from "./curate.mjs";

export const NATIONAL_DCAT_URL="https://raw.githubusercontent.com/Fedict/dcat/master/all/datagovbe.nt.gz";
export const NATIONAL_MIN_DATASETS=1000;
export const NATIONAL_SENTINELS=[
  {id:"favv-afsca-operators",label:"FAVV operators"},
  {id:"fasfc-activity-codes",label:"FAVV activity codes"}
];

const NS={
  rdf:"http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  dct:"http://purl.org/dc/terms/",
  dcat:"http://www.w3.org/ns/dcat#",foaf:"http://xmlns.com/foaf/0.1/",skos:"http://www.w3.org/2004/02/skos/core#",schema:"http://schema.org/",schemaHttps:"https://schema.org/",rdfs:"http://www.w3.org/2000/01/rdf-schema#",vcard:"http://www.w3.org/2006/vcard/ns#"
};
const P={
  type:NS.rdf+"type",dataset:NS.dcat+"Dataset",title:NS.dct+"title",description:NS.dct+"description",
  publisher:NS.dct+"publisher",distribution:NS.dcat+"distribution",modified:NS.dct+"modified",issued:NS.dct+"issued",
  identifier:NS.dct+"identifier",keyword:NS.dcat+"keyword",theme:NS.dcat+"theme",landingPage:NS.dcat+"landingPage",
  accessURL:NS.dcat+"accessURL",downloadURL:NS.dcat+"downloadURL",format:NS.dct+"format",mediaType:NS.dcat+"mediaType",byteSize:NS.dcat+"byteSize",
  license:NS.dct+"license",frequency:NS.dct+"accrualPeriodicity",spatial:NS.dct+"spatial",contactPoint:NS.dcat+"contactPoint",
  foafName:NS.foaf+"name",prefLabel:NS.skos+"prefLabel",schemaName:NS.schema+"name",schemaNameHttps:NS.schemaHttps+"name",rdfsLabel:NS.rdfs+"label",
  vcardFn:NS.vcard+"fn",vcardHasEmail:NS.vcard+"hasEmail",vcardHasURL:NS.vcard+"hasURL"
};
const KEEP=new Set(Object.values(P).filter(x=>x!==P.dataset));
const clean=s=>String(s??"").replace(/\s+/g," ").trim();
const uniq=a=>[...new Set((a||[]).filter(Boolean).map(clean))];

function unescapeLiteral(s){
  return String(s)
    .replace(/\\u([0-9a-fA-F]{4})/g,(_,h)=>String.fromCodePoint(parseInt(h,16)))
    .replace(/\\U([0-9a-fA-F]{8})/g,(_,h)=>String.fromCodePoint(parseInt(h,16)))
    .replace(/\\n/g,"\n").replace(/\\r/g,"\r").replace(/\\t/g,"\t")
    .replace(/\\"/g,'"').replace(/\\\\/g,"\\");
}
function resourceId(raw){
  if(raw.startsWith("<"))return raw.slice(1,raw.indexOf(">"));
  if(raw.startsWith("_:"))return raw;
  return "";
}
function objectValue(raw){
  if(raw.startsWith("<")||raw.startsWith("_:"))return{v:resourceId(raw),resource:true,uri:raw.startsWith("<"),lang:""};
  const m=raw.match(/^"((?:\\.|[^"\\])*)"(?:@([A-Za-z-]+)|\^\^<([^>]+)>)?/);
  return m?{v:unescapeLiteral(m[1]),resource:false,uri:false,lang:(m[2]||"").toLowerCase(),datatype:m[3]||""}:{v:raw,resource:false,uri:false,lang:""};
}
export function parseNtLine(line){
  const m=String(line).match(/^((?:<[^>]+>)|(?:_:[^\s]+))\s+<([^>]+)>\s+(.+)\s+\.$/);
  if(!m)return null;
  return{subject:resourceId(m[1]),predicate:m[2],object:objectValue(m[3])};
}
export function ingestNtLine(nodes,line){
  const t=parseNtLine(line);if(!t)return false;
  if(t.predicate!==P.type&&!KEEP.has(t.predicate))return false;
  let n=nodes.get(t.subject);if(!n){n={};nodes.set(t.subject,n)}
  (n[t.predicate]||(n[t.predicate]=[])).push(t.object);return true;
}
const vals=(n,p)=>n?.[p]||[];
function pick(n,p){
  const xs=vals(n,p);
  for(const lang of ["en","nl","fr","de",""]){const x=xs.find(v=>v.lang===lang);if(x?.v)return clean(x.v)}
  return clean(xs[0]?.v);
}
const uriTail=u=>{try{return clean(decodeURIComponent(String(u).split(/[\/#]/).filter(Boolean).pop()||u))}catch{return clean(u)}};
const firstResource=(n,p)=>vals(n,p).find(x=>x.resource)?.v||"";
const readableResource=x=>x?.resource?uriTail(x.v):clean(x?.v);
const publisherName=n=>pick(n,P.title)||pick(n,P.foafName)||pick(n,P.prefLabel)||pick(n,P.rdfsLabel)||pick(n,P.schemaName)||pick(n,P.schemaNameHttps);
const normalEmail=v=>{const s=clean(v).replace(/^mailto:/i,"");return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)?s:""};
export function canonicalFormat(value,url=""){
  const raw=clean(value),hay=(raw+" "+url).toLowerCase();
  const pairs=[
    ["CSV",/(?:\bcsv\b|text\/csv|file-type\/csv|\.csv(?:$|[?#]))/],
    ["TSV",/(?:\btsv\b|tab[- ]separated|\.tsv(?:$|[?#]))/],
    ["GeoJSON",/(?:geojson|\.geojson(?:$|[?#]))/],["JSON-LD",/(?:json-ld|ld\+json)/],
    ["JSON",/(?:\bjson\b|application\/json|file-type\/json|\.json(?:$|[?#]))/],
    ["XML",/(?:\bxml\b|application\/xml|text\/xml|file-type\/xml|\.xml(?:$|[?#]))/],
    ["XLSX",/(?:xlsx|openxmlformats-officedocument\.spreadsheetml|\.xlsx(?:$|[?#]))/],
    ["XLS",/(?:\bxls\b|vnd\.ms-excel|\.xls(?:$|[?#]))/],["PDF",/(?:\bpdf\b|application\/pdf|\.pdf(?:$|[?#]))/],
    ["ZIP",/(?:\bzip\b|application\/zip|\.zip(?:$|[?#]))/],["GZIP",/(?:gzip|\.gz(?:$|[?#]))/],
    ["GeoPackage",/(?:geopackage|\bgpkg\b|\.gpkg(?:$|[?#]))/],["Shapefile",/(?:shapefile|\bshp\b|\.shp(?:$|[?#]))/],
    ["GML",/(?:\bgml\b|\.gml(?:$|[?#]))/],["KML",/(?:\bkml\b|\.kml(?:$|[?#]))/],
    ["WFS",/(?:\bwfs\b|wfs_srvc)/],["WMS",/(?:\bwms\b|wms_srvc)/],["WCS",/(?:\bwcs\b|wcs_srvc)/],
    ["OGC API Features",/(?:ogc api features|\/collections(?:\/|$))/],["GTFS",/(?:\bgtfs\b)/],
    ["RDF",/(?:\brdf\b|rdf_xml|rdf\/xml)/],["Turtle RDF",/(?:turtle|text\/turtle)/],
    ["Parquet",/(?:parquet|\.parquet(?:$|[?#]))/],["NetCDF",/(?:netcdf|\.nc(?:$|[?#]))/]
  ];
  for(const [label,re] of pairs)if(re.test(hay))return label;
  if(!raw)return"Other";
  const tail=uriTail(raw).replace(/[_-]+/g," ").trim();
  return tail&&tail.length<=40?tail:"Other";
}

export function catalogueFromNodes(nodes,{generatedAt=new Date().toISOString(),source=NATIONAL_DCAT_URL}={}){
  const items=[],usedIds=new Set();
  for(const [subject,n] of nodes){
    if(!vals(n,P.type).some(x=>x.v===P.dataset))continue;
    const title=pick(n,P.title);if(!title)continue;
    const publisherRef=firstResource(n,P.publisher);
    const publisherNode=publisherRef?nodes.get(publisherRef):null;
    const publisher=publisherRef?(publisherName(publisherNode)||uriTail(publisherRef)):(pick(n,P.publisher)||"data.gov.be source");
    const contactRef=firstResource(n,P.contactPoint),contactNode=contactRef?nodes.get(contactRef):null;
    const contactEmail=normalEmail(firstResource(contactNode,P.vcardHasEmail)||pick(contactNode,P.vcardHasEmail));
    const contactUrl=firstResource(contactNode,P.vcardHasURL)||pick(contactNode,P.vcardHasURL)||"";
    const contactName=pick(contactNode,P.vcardFn)||publisherName(contactNode)||"";
    const distRefs=vals(n,P.distribution).filter(x=>x.resource).map(x=>x.v);
    const distributions=distRefs.slice(0,20).map(ref=>{
      const d=nodes.get(ref)||{};
      const access=firstResource(d,P.downloadURL)||firstResource(d,P.accessURL);
      const f=vals(d,P.format).find(Boolean)||vals(d,P.mediaType).find(Boolean);
      const license=vals(d,P.license).find(Boolean),rawSize=pick(d,P.byteSize),byteSize=rawSize===""?NaN:Number(rawSize);
      return{
        name:pick(d,P.title)||"distribution",
        format:canonicalFormat(f?readableResource(f):"",access),
        url:access,
        license:license?(normalizeLicense(license.v).label||readableResource(license)):"",
        licenseUri:license?.resource?license.v:"",
        byteSize:Number.isFinite(byteSize)&&byteSize>0?byteSize:null
      };
    }).filter(x=>x.url);
    const declaredId=pick(n,P.identifier)||subject;
    // Two catalogue records can declare the same identifier (reused DOIs); the record id must stay unique for the UI, relay and search.
    const id=usedIds.has(declaredId)?declaredId+"~"+createHash("sha1").update(subject).digest("hex").slice(0,6):declaredId;
    usedIds.add(id);
    const datasetLicense=vals(n,P.license).find(Boolean);
    const frequency=vals(n,P.frequency).find(Boolean);
    const spatial=vals(n,P.spatial).find(Boolean);
    const formats=uniq(distributions.map(x=>x.format));
    items.push({
      id:"national:"+id,
      provider:publisher,
      publisherUri:publisherRef||null,
      contactName,contactEmail,contactUrl,
      platform:"data.gov.be DCAT-AP",
      discovery:"data.gov.be",
      datasetId:id,
      title,
      description:pick(n,P.description).slice(0,1200),
      kind:"DCAT dataset",
      formats:formats.slice(0,12),
      updatedAt:pick(n,P.modified)||pick(n,P.issued)||null,
      frequency:frequency?readableResource(frequency):"",
      geoCoverage:spatial?resolveSpatial(spatial.v).label:"",geoScope:spatial?resolveSpatial(spatial.v).scope:"",
      recordCount:null,fields:[],previewRows:[],schemaOrigin:"none",sampleOrigin:"none",
      extent:{spatial:spatial?readableResource(spatial):null},
      themes:uniq(vals(n,P.keyword).map(x=>x.v).concat(vals(n,P.theme).map(readableResource))).slice(0,12),
      license:datasetLicense?(normalizeLicense(datasetLicense.v).label||readableResource(datasetLicense)):(distributions.find(x=>x.license)?.license||""),
      licenseUri:datasetLicense?.resource?datasetLicense.v:(distributions.find(x=>x.licenseUri)?.licenseUri||""),
      licenseFamily:normalizeLicense(datasetLicense?.v||distributions.find(x=>x.licenseUri)?.licenseUri||"").family,
      euThemes:uniq(vals(n,P.theme).map(x=>String(x.v).match(/data-theme\/([A-Z]+)$/)?.[1])),
      officialUrl:firstResource(n,P.landingPage)||(subject.startsWith("http")?subject:distributions[0]?.url||""),
      sourceRecord:subject,
      distributions:distributions.slice(0,8),
      enrichment:{score:20,level:"harvested",reasons:["national DCAT index"],schemaOrigin:"none",sampled:false}
    });
  }
  const series=detectSeries(items),seriesOf=new Map();
  for(const s of series)for(const id of s.memberIds)seriesOf.set(id,s.id);
  for(const x of items){x.dataKind=kindOf(x);x.topic=topicOf(x);if(seriesOf.has(x.id))x.seriesId=seriesOf.get(x.id)}
  return{generatedAt,source,itemCount:items.length,items,series:series.map(({memberIds,key,...s})=>({...s,members:memberIds.length}))};
}
function searchable(x){return clean([x.datasetId,x.title,x.provider,x.officialUrl].join(" ")).toLowerCase()}
export function validateNationalCatalogue(payload){
  const items=Array.isArray(payload?.items)?payload.items:[],publishers=new Set(items.map(x=>x.provider).filter(Boolean));
  const sentinelMatches={};
  for(const s of NATIONAL_SENTINELS)sentinelMatches[s.id]=items.some(x=>searchable(x).includes(s.id.toLowerCase()));
  const missingSentinels=NATIONAL_SENTINELS.filter(s=>!sentinelMatches[s.id]).map(s=>s.id);
  const distributionCount=items.reduce((n,x)=>n+(x.distributions?.length||0),0);
  const errors=[];
  if(items.length<NATIONAL_MIN_DATASETS)errors.push("dataset count "+items.length+" < "+NATIONAL_MIN_DATASETS);
  if(missingSentinels.length)errors.push("missing sentinels: "+missingSentinels.join(", "));
  if(publishers.size<20)errors.push("publisher count "+publishers.size+" < 20");
  if(distributionCount<500)errors.push("distribution count "+distributionCount+" < 500");
  return{ok:errors.length===0,datasetCount:items.length,publisherCount:publishers.size,distributionCount,sentinelMatches,missingSentinels,errors};
}
export function thinNationalCatalogue(payload,maxDescription=320){
  return{
    generatedAt:payload.generatedAt,source:payload.source,itemCount:payload.items.length,thin:true,health:payload.health,profileSummary:payload.profileSummary||null,series:payload.series||[],
    items:payload.items.map(x=>({
      id:x.id,provider:x.provider,publisherUri:x.publisherUri,contactName:x.contactName||"",contactEmail:x.contactEmail||"",contactUrl:x.contactUrl||"",platform:x.platform,discovery:x.discovery,datasetId:x.datasetId,
      title:x.title,description:String(x.description||"").slice(0,maxDescription),kind:x.kind,formats:(x.formats||[]).slice(0,4),
      updatedAt:x.updatedAt,frequency:x.frequency,geoCoverage:x.geoCoverage,recordCount:x.recordCount??null,recordCountKind:x.recordCountKind||null,
      fields:(x.fields||[]).slice(0,80),previewRows:(x.previewRows||[]).slice(0,8),schemaOrigin:x.schemaOrigin||"none",sampleOrigin:x.sampleOrigin||"none",
      tabularProfile:x.tabularProfile||null,extent:x.extent||{},themes:(x.themes||[]).slice(0,6),license:x.license||"",licenseFamily:x.licenseFamily||"unknown",euThemes:x.euThemes||[],geoScope:x.geoScope||"",dataKind:x.dataKind||"",topic:x.topic||"",seriesId:x.seriesId||"",
      officialUrl:x.officialUrl,sourceRecord:x.sourceRecord,distributions:(x.distributions||[]).slice(0,3),enrichment:x.enrichment
    }))
  };
}
export async function fetchNationalCatalogue({fetchImpl=fetch,url=NATIONAL_DCAT_URL,generatedAt=new Date().toISOString(),userAgent="Belgium-Data-Desk/3.0"}={}){
  const r=await fetchImpl(url,{headers:{"user-agent":userAgent,accept:"application/gzip"}});
  if(!r.ok)throw new Error("data.gov.be DCAT "+r.status+" "+(r.statusText||""));
  if(!r.body)throw new Error("data.gov.be DCAT response has no body");
  const nodes=new Map(),input=Readable.fromWeb(r.body).pipe(createGunzip()),rl=createInterface({input,crlfDelay:Infinity});
  for await(const line of rl)ingestNtLine(nodes,line);
  const payload=catalogueFromNodes(nodes,{generatedAt,source:url});
  payload.health=validateNationalCatalogue(payload);
  if(!payload.health.ok)throw new Error("unhealthy national catalogue: "+payload.health.errors.join("; "));
  return payload;
}
