import { canonicalPublisher, cleanFrequency, cleanPeriod, isOpaqueId, landingPage, unifyPublisherNames, validUpdated } from "./metadata-clean.mjs";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { detectSeries, kindOf, normalizeLicense, resolveSpatial, topicOf } from "./curate.mjs";
import { isLdesEndpoint } from "../public/dataset-ldes-v1.mjs";

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
  type:NS.rdf+"type",dataset:NS.dcat+"Dataset",dataService:NS.dcat+"DataService",
  title:NS.dct+"title",description:NS.dct+"description",
  publisher:NS.dct+"publisher",distribution:NS.dcat+"distribution",modified:NS.dct+"modified",issued:NS.dct+"issued",
  endpointURL:NS.dcat+"endpointURL",endpointDescription:NS.dcat+"endpointDescription",
  accessService:NS.dcat+"accessService",servesDataset:NS.dcat+"servesDataset",
  conformsTo:NS.dct+"conformsTo",accessRights:NS.dct+"accessRights",
  identifier:NS.dct+"identifier",keyword:NS.dcat+"keyword",theme:NS.dcat+"theme",landingPage:NS.dcat+"landingPage",
  accessURL:NS.dcat+"accessURL",downloadURL:NS.dcat+"downloadURL",format:NS.dct+"format",mediaType:NS.dcat+"mediaType",byteSize:NS.dcat+"byteSize",
  license:NS.dct+"license",frequency:NS.dct+"accrualPeriodicity",spatial:NS.dct+"spatial",contactPoint:NS.dcat+"contactPoint",
  foafName:NS.foaf+"name",prefLabel:NS.skos+"prefLabel",schemaName:NS.schema+"name",schemaNameHttps:NS.schemaHttps+"name",rdfsLabel:NS.rdfs+"label",
  vcardFn:NS.vcard+"fn",vcardHasEmail:NS.vcard+"hasEmail",vcardHasURL:NS.vcard+"hasURL",
  // fields that make a record usable beyond search: period covered, language, access, lineage, CRS, resolution, EU high-value category
  temporal:NS.dct+"temporal",startDate:NS.dcat+"startDate",endDate:NS.dcat+"endDate",schemaStart:NS.schema+"startDate",schemaEnd:NS.schema+"endDate",
  language:NS.dct+"language",provenance:NS.dct+"provenance",spatialResolution:NS.dcat+"spatialResolutionInMeters",
  hvdCategory:"http://data.europa.eu/r5r/hvdCategory",creator:NS.dct+"creator",rightsHolder:NS.dct+"rightsHolder",created:NS.dct+"created"
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
    const isDataset=vals(n,P.type).some(x=>x.v===P.dataset);
    const isService=vals(n,P.type).some(x=>x.v===P.dataService);
    if(!isDataset&&!isService)continue;
    const title=pick(n,P.title);if(!title)continue;
    const publisherRef=firstResource(n,P.publisher);
    const publisherNode=publisherRef?nodes.get(publisherRef):null;
    const rawPublisher=publisherRef?(publisherName(publisherNode)||uriTail(publisherRef)):pick(n,P.publisher);
    // a blank-node id is not a name (8 publishers were "b6d53d…-3958c…"); inferPublishers may still find the real one
    const publisher=rawPublisher&&!isOpaqueId(rawPublisher)?canonicalPublisher(rawPublisher):"data.gov.be source";
    const contactRef=firstResource(n,P.contactPoint),contactNode=contactRef?nodes.get(contactRef):null;
    const contactEmail=normalEmail(firstResource(contactNode,P.vcardHasEmail)||pick(contactNode,P.vcardHasEmail));
    const contactUrl=firstResource(contactNode,P.vcardHasURL)||pick(contactNode,P.vcardHasURL)||"";
    const contactName=pick(contactNode,P.vcardFn)||publisherName(contactNode)||"";
    const distRefs=vals(n,P.distribution).filter(x=>x.resource).map(x=>x.v);
    const distributions=distRefs.slice(0,20).flatMap(ref=>{
      const d=nodes.get(ref)||{};
      const access=firstResource(d,P.downloadURL)||firstResource(d,P.accessURL);
      const f=vals(d,P.format).find(Boolean)||vals(d,P.mediaType).find(Boolean);
      const license=vals(d,P.license).find(Boolean),rawSize=pick(d,P.byteSize),byteSize=rawSize===""?NaN:Number(rawSize);
      const direct=access?[{
        name:pick(d,P.title)||"distribution",
        format:canonicalFormat(f?readableResource(f):"",access),
        url:access,
        license:license?(normalizeLicense(license.v).label||readableResource(license)):"",
        licenseUri:license?.resource?license.v:"",
        byteSize:Number.isFinite(byteSize)&&byteSize>0?byteSize:null
      }]:[];
      // A DCAT Distribution can point to its providing DataService instead of a
      // downloadable file. Keep that endpoint, including published LDES streams.
      const linked=vals(d,P.accessService).filter(x=>x.resource).flatMap(x=>
        vals(nodes.get(x.v),P.endpointURL).map(v=>v.v).filter(url=>/^https:\/\//i.test(url)).map(url=>({
          name:pick(nodes.get(x.v),P.title)||"Access service",
          format:isLdesEndpoint(url)?"LDES":"Data service",url,byteSize:null
        })));
      return [...direct,...linked];
    });
    if(isService){
      const conforms=vals(n,P.conformsTo).map(x=>x.v);
      for(const endpoint of vals(n,P.endpointURL).map(x=>x.v).filter(x=>/^https:\/\//i.test(x))){
        distributions.push({name:"Service endpoint",format:isLdesEndpoint(endpoint)||conforms.some(x=>/\bldes\b/i.test(x))?"LDES":"Data service",
          url:endpoint,byteSize:null});
      }
    }
    // Never duplicate the same URL when both a Distribution and a DataService reference it.
    const uniqueDistributions=[...new Map(distributions.filter(x=>x.url).map(x=>[x.url,x])).values()];
    const declaredId=pick(n,P.identifier)||subject;
    // Two catalogue records can declare the same identifier (reused DOIs); the record id must stay unique for the UI, relay and search.
    const id=usedIds.has(declaredId)?declaredId+"~"+createHash("sha1").update(subject).digest("hex").slice(0,6):declaredId;
    usedIds.add(id);
    const datasetLicense=vals(n,P.license).find(Boolean);
    const frequency=vals(n,P.frequency).find(Boolean);
    const spatial=vals(n,P.spatial).find(Boolean);
    const formats=uniq(uniqueDistributions.map(x=>x.format));
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
      kind:isService?"DCAT data service":"DCAT dataset",
      serviceType:isService?"DCAT DataService":null,
      endpointDescription:isService?firstResource(n,P.endpointDescription)||pick(n,P.endpointDescription):"",
      servesDataset:isService?vals(n,P.servesDataset).filter(x=>x.resource).map(x=>x.v).slice(0,12):[],
      conformsTo:isService?vals(n,P.conformsTo).map(x=>x.v).slice(0,12):[],
      formats:formats.slice(0,12),
      updatedAt:validUpdated(pick(n,P.modified))||validUpdated(pick(n,P.issued))||null,
      frequency:cleanFrequency(frequency?readableResource(frequency):""),
      geoCoverage:spatial?resolveSpatial(spatial.v).label:"",geoScope:spatial?resolveSpatial(spatial.v).scope:"",
      recordCount:null,fields:[],previewRows:[],schemaOrigin:"none",sampleOrigin:"none",
      extent:{spatial:spatial?readableResource(spatial):null},
      themes:uniq(vals(n,P.keyword).map(x=>x.v).concat(vals(n,P.theme).map(readableResource))).slice(0,12),
      license:datasetLicense?(normalizeLicense(datasetLicense.v).label||readableResource(datasetLicense)):(distributions.find(x=>x.license)?.license||""),
      licenseUri:datasetLicense?.resource?datasetLicense.v:(distributions.find(x=>x.licenseUri)?.licenseUri||""),
      licenseFamily:normalizeLicense(datasetLicense?.v||distributions.find(x=>x.licenseUri)?.licenseUri||"").family,
      euThemes:uniq(vals(n,P.theme).map(x=>String(x.v).match(/data-theme\/([A-Z]+)$/)?.[1])),
      officialUrl:landingPage({landingPage:firstResource(n,P.landingPage),subject,identifier:declaredId,distributions:uniqueDistributions}),
      sourceRecord:subject,
      distributions:uniqueDistributions.slice(0,8),
      enrichment:{score:20,level:"harvested",reasons:["national DCAT index"],schemaOrigin:"none",sampled:false},
      ...extraFields(nodes,n)
    });
  }
  inferPublishers(items);
  unifyPublisherNames(items);
  const series=detectSeries(items),seriesOf=new Map();
  for(const s of series)for(const id of s.memberIds)seriesOf.set(id,s.id);
  for(const x of items){x.dataKind=kindOf(x);x.topic=topicOf(x);if(seriesOf.has(x.id))x.seriesId=seriesOf.get(x.id)}
  return{generatedAt,source,itemCount:items.length,items,series:series.map(({memberIds,key,...s})=>({...s,members:memberIds.length}))};
}
/* ---------- publishers the record does not name ---------- */
export const UNKNOWN_PUBLISHER="data.gov.be source";
// Contact domains that belong to exactly one organisation (never a shared parent domain such as vlaanderen.be or fgov.be).
const DOMAIN_PUBLISHERS={"meteo.be":"Royal Meteorological Institute of Belgium","arch.be":"State Archives of Belgium","adn.be":"Agence du Numérique (Wallonia)",
  "ngi.be":"National Geographic Institute (NGI)","naturalsciences.be":"Royal Belgian Institute of Natural Sciences","sciensano.be":"Sciensano","statbel.fgov.be":"Statbel"};
const hostOf=u=>{try{return new URL(u).hostname.replace(/^www\./,"")}catch{return""}};
/**
 * A record without dct:publisher gets the publisher that other records with the same owner (KBO number), contact address,
 * contact domain or landing-page host carry, when one publisher clearly dominates (>= 80 % and >= 3 records). The record says
 * how it was inferred (publisherInferredFrom), so the UI can show it as inferred rather than declared.
 */
export function inferPublishers(items){
  // A portal dataset slug ("1_21-aangemelde-oplaadpunten-voor-ev") identifies the same dataset copied into another catalogue under
  // another host (fluvius.opendatasoft.com vs opendata.fluvius.be): one record suffices when every record with that slug agrees.
  const slugOf=u=>{const m=String(u||"").match(/\/(?:explore\/dataset|catalog\/datasets)\/([^/?#]+)/i);return m&&m[1].length>=12&&/[-_]/.test(m[1])?m[1].toLowerCase():""};
  const keysOf=x=>[...new Set([x.officialUrl,...(x.distributions||[]).map(d=>d.url)].map(slugOf).filter(Boolean))].map(s=>"slug:"+s).concat([...(x.ownerKbo||[]).map(k=>"kbo:"+k),x.contactEmail?"mail:"+x.contactEmail.toLowerCase():"",
    x.contactEmail?"domain:"+x.contactEmail.split("@")[1].toLowerCase():"",x.officialUrl?"host:"+hostOf(x.officialUrl):"",
    ...(x.distributions||[]).slice(0,2).map(d=>d.url?"host:"+hostOf(d.url):"")]).filter(k=>k&&k!=="host:data.gov.be"&&k!=="host:");
  const votes=new Map();
  for(const x of items){if(x.provider===UNKNOWN_PUBLISHER)continue;for(const k of keysOf(x)){const m=votes.get(k)||votes.set(k,new Map()).get(k);m.set(x.provider,(m.get(x.provider)||0)+1)}}
  const winner=k=>{const m=votes.get(k);if(!m)return null;let total=0,best=null,n=0;for(const [p,c] of m){total+=c;if(c>n){n=c;best=p}}
    return k.startsWith("slug:")?(m.size===1?best:null):n>=3&&n/total>=0.8?best:null};
  let fixed=0;
  for(const x of items){
    if(x.provider!==UNKNOWN_PUBLISHER)continue;
    for(const k of keysOf(x)){const p=winner(k)||(k.startsWith("domain:")?DOMAIN_PUBLISHERS[k.slice(7)]:null);if(p){x.provider=p;x.publisherInferredFrom=k.replace(/:.*/,"");fixed++;break}}
  }
  return fixed;
}

/* ---------- extra DCAT fields ---------- */
const LANG={NLD:"nl",DUT:"nl",FRA:"fr",FRE:"fr",ENG:"en",DEU:"de",GER:"de"};
const HVD={c_164e0bf5:"Meteorological",c_a9135398:"Companies and company ownership",c_ac64a52d:"Geospatial",c_b79e35eb:"Mobility",c_dd313021:"Earth observation and environment",c_e1da4e07:"Statistics"};
const isoDay=v=>{const m=String(v||"").match(/^(\d{4})(?:-(\d\d)(?:-(\d\d))?)?/);return m?m[0]:""};
/** dct:temporal: a PeriodOfTime node with dcat:/schema: start and end. Placeholder periods (1900-01-01, end before start) are dropped. */
export function temporalOf(nodes,n){
  for(const ref of vals(n,P.temporal)){
    const t=nodes.get(ref.v)||{};
    let start=isoDay(pick(t,P.startDate)||pick(t,P.schemaStart)),end=isoDay(pick(t,P.endDate)||pick(t,P.schemaEnd));
    // data.gov.be also encodes the period in the node IRI (…/genid/temporal/2013-01-01-2020-05-31)
    const m=!start&&!end&&String(ref.v).match(/temporal\/(\d{4}-\d\d-\d\d)-(\d{4}-\d\d-\d\d)$/);if(m){start=m[1];end=m[2]}
    if(/^1900-01-01/.test(start))start="";if(/^1900-01-01/.test(end))end="";
    if(start&&end&&end<start)continue;
    if(start||end)return{start:start||null,end:end||null};
  }
  return null;
}
const kboOf=u=>(String(u||"").match(/CbeRegisteredEntity\/(\d{10})/)||[])[1]||"";
export function extraFields(nodes,n){
  const languages=uniq(vals(n,P.language).map(x=>LANG[uriTail(x.v).toUpperCase()]||(/^(dutch|nederlands)$/i.test(x.v)?"nl":/^(french|fran[cç]ais)$/i.test(x.v)?"fr":/^english$/i.test(x.v)?"en":/^(german|deutsch)$/i.test(x.v)?"de":"")));
  const access=uriTail(firstResource(n,P.accessRights)).toUpperCase();
  const prov=vals(n,P.provenance).map(x=>x.resource?pick(nodes.get(x.v),P.title)||pick(nodes.get(x.v),P.rdfsLabel)||pick(nodes.get(x.v),P.description):clean(x.v)).find(Boolean)||"";
  const conforms=vals(n,P.conformsTo).map(x=>x.v);
  const crs=uniq(conforms.map(u=>{const m=String(u).match(/EPSG\/0\/(\d{4,5})/i);return m?"EPSG:"+m[1]:""})).slice(0,4);
  const standards=uniq(conforms.filter(u=>!/EPSG/i.test(u)&&!/isotc211\.org\/2005\/(gmd|gfc)/i.test(u))).slice(0,6);
  const res=Number(pick(n,P.spatialResolution));
  const hvd=uniq(vals(n,P.hvdCategory).map(x=>HVD[uriTail(x.v)]||"High-value dataset"));
  const kbo=uniq([...vals(n,P.creator),...vals(n,P.rightsHolder)].map(x=>kboOf(x.v)));
  return{
    temporal:cleanPeriod(temporalOf(nodes,n)),languages,accessRights:["PUBLIC","NON_PUBLIC","RESTRICTED"].includes(access)?access:"",
    provenance:prov.slice(0,600),crs,standards,...(res>0?{spatialResolutionM:res}:{}),hvdCategories:hvd,ownerKbo:kbo.slice(0,3),
    issuedAt:isoDay(pick(n,P.issued)||pick(n,P.created))||null
  };
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
      title:x.title,description:String(x.description||"").slice(0,maxDescription),
      kind:x.kind,serviceType:x.serviceType||null,endpointDescription:x.endpointDescription||"",
      conformsTo:(x.conformsTo||[]).slice(0,8),servesDataset:(x.servesDataset||[]).slice(0,8),
      formats:(x.formats||[]).slice(0,4),
      updatedAt:x.updatedAt,frequency:x.frequency,geoCoverage:x.geoCoverage,recordCount:x.recordCount??null,recordCountKind:x.recordCountKind||null,
      fields:(x.fields||[]).slice(0,80),previewRows:(x.previewRows||[]).slice(0,8),schemaOrigin:x.schemaOrigin||"none",sampleOrigin:x.sampleOrigin||"none",
      tabularProfile:x.tabularProfile||null,extent:x.extent||{},themes:(x.themes||[]).slice(0,6),license:x.license||"",licenseFamily:x.licenseFamily||"unknown",euThemes:x.euThemes||[],geoScope:x.geoScope||"",dataKind:x.dataKind||"",topic:x.topic||"",seriesId:x.seriesId||"",
      officialUrl:x.officialUrl,sourceRecord:x.sourceRecord,distributions:(x.distributions||[]).slice(0,3),enrichment:x.enrichment,
      temporal:x.temporal||null,languages:x.languages||[],accessRights:x.accessRights||"",crs:x.crs||[],hvdCategories:x.hvdCategories||[],ownerKbo:x.ownerKbo||[],issuedAt:x.issuedAt||null,
      provenance:String(x.provenance||"").slice(0,300),standards:(x.standards||[]).slice(0,4),...(x.spatialResolutionM?{spatialResolutionM:x.spatialResolutionM}:{}),...(x.publisherInferredFrom?{publisherInferredFrom:x.publisherInferredFrom}:{})
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
