// ISO 19139 (gmd) records from a GeoNetwork CSW, read with elementSetName=full.
// The Dublin Core "summary" element set carries no links, licence, contact, extent or update frequency, so Metawal and geo.be records
// harvested that way were all "metadata only". The full ISO record has them.
const decode=s=>String(s||"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'");
import { canonicalPublisher, cleanPeriod, validUpdated } from "./metadata-clean.mjs";
import { canonicalFormat } from "./national-dcat.mjs";
const clean=s=>String(s??"").replace(/\s+/g," ").trim();
const text=s=>clean(decode(String(s||"").replace(/<[^>]+>/g," ")));
const uniq=a=>[...new Set((a||[]).filter(Boolean).map(clean))];

/** All elements named `name` (any namespace prefix), as their inner XML. Not nested-safe for the same name, which ISO does not use here. */
export function blocks(xml,name){
  return [...String(xml||"").matchAll(new RegExp("<(?:[\\w-]+:)?"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?"+name+">","gi"))].map(m=>m[1]);
}
const first=(xml,name)=>blocks(xml,name)[0]||"";
const firstText=(xml,name)=>text(first(xml,name));
/** A free-text element in its main language: the direct CharacterString/Anchor, not the PT_FreeText translations after it. */
const mainText=(xml,name)=>{const b=first(xml,name);return text(first(b,"CharacterString")||first(b,"Anchor")||b)};
const attr=(xml,name,att)=>{const m=String(xml||"").match(new RegExp("<(?:[\\w-]+:)?"+name+"\\b[^>]*\\s"+att+"=\"([^\"]*)\"","i"));return m?decode(m[1]):""};
const attrs=(xml,name,att)=>[...String(xml||"").matchAll(new RegExp("<(?:[\\w-]+:)?"+name+"\\b[^>]*\\s"+att+"=\"([^\"]*)\"","gi"))].map(m=>decode(m[1]));

/** ISO MD_MaintenanceFrequencyCode -> EU frequency authority code (the vocabulary data.gov.be uses). */
export const ISO_FREQUENCY={
  continual:"CONT",daily:"DAILY",weekly:"WEEKLY",fortnightly:"BIWEEKLY",monthly:"MONTHLY",quarterly:"QUARTERLY",biannually:"ANNUAL_2",
  annually:"ANNUAL",asneeded:"AS_NEEDED",irregular:"IRREG",notplanned:"NOT_PLANNED",unknown:"UNKNOWN"
};
const ISO_LANG={dut:"nl",nld:"nl",fre:"fr",fra:"fr",eng:"en",ger:"de",deu:"de"};
/** OGC/INSPIRE protocol -> the format label used across the catalogue (scripts/curate.mjs formatClass). */
export function protocolFormat(protocol,url,name=""){
  const p=String(protocol||"").toLowerCase(),u=String(url||"").toLowerCase(),hay=p+" "+u+" "+String(name).toLowerCase();
  if(/wmts/.test(hay))return"WMTS";
  if(/\bwms\b|ogc:wms|service=wms/.test(hay))return"WMS";
  if(/\bwfs\b|ogc:wfs|service=wfs/.test(hay))return"WFS";
  if(/\bwcs\b|ogc:wcs|service=wcs/.test(hay))return"WCS";
  if(/ogc api|ogcapi|\/ogc\/features/.test(hay))return"OGC API Features";
  if(/arcgis\/rest|esri:rest/.test(hay))return"Esri REST";
  const ext=u.split(/[?#]/)[0].match(/\.(csv|tsv|json|geojson|xlsx|xls|zip|pdf|gpkg|shp|gml|kml|tif|tiff|xml)$/);
  if(ext)return{csv:"CSV",tsv:"TSV",json:"JSON",geojson:"GeoJSON",xlsx:"XLSX",xls:"XLS",zip:"ZIP",pdf:"PDF",gpkg:"GeoPackage",shp:"Shapefile",gml:"GML",kml:"KML",tif:"GEOTIFF",tiff:"GEOTIFF",xml:"XML"}[ext[1]];
  if(/download/.test(p))return"download";
  if(/link|www:link|http/.test(p))return"HTML";
  // a link with no data protocol or file extension is a web page (it made WMS-only records look like downloadable datasets)
  return"HTML";
}

/** The smallest Belgian region whose extent holds the bounding box [w,s,e,n] (0.15° slack for rounded publisher boxes), else "". */
const REGIONS=[["Brussels-Capital",[4.24,50.76,4.49,50.92]],["Flanders",[2.5,50.67,5.95,51.51]],["Wallonia",[2.8,49.49,6.41,50.82]],["Belgium",[2.5,49.49,6.41,51.51]]];
export function bboxRegion(b){
  if(!Array.isArray(b)||b.some(v=>!Number.isFinite(v)))return"";
  const tol=0.15;
  for(const [name,[w,s,e,n]] of REGIONS)if(b[0]>=w-tol&&b[1]>=s-tol&&b[2]<=e+tol&&b[3]<=n+tol)return name;
  return"";
}

/** The resource's date of the given ISO CI_DateTypeCode (revision, publication, creation). */
function citationDate(ident,type){
  for(const d of blocks(ident,"CI_Date")){
    if(attr(d,"CI_DateTypeCode","codeListValue").toLowerCase()===type){const v=firstText(d,"Date")||firstText(d,"DateTime");if(v)return v.slice(0,10)}
  }
  return"";
}

/** Licence: the MD_LegalConstraints text (or the Anchor it links to) that reads as a licence or conditions of use. */
function licenceOf(ident){
  const cands=[];
  for(const c of blocks(ident,"MD_LegalConstraints")){
    for(const o of blocks(c,"otherConstraints")){const href=attr(o,"Anchor","xlink:href");cands.push({href,t:text(o)})}
    for(const o of blocks(c,"useLimitation"))cands.push({href:attr(o,"Anchor","xlink:href"),t:text(o)});
  }
  // INSPIRE "no limitations on public access" is an access statement, not a licence
  const useful=cands.filter(c=>(c.href||c.t)&&!/inspire\.ec\.europa\.eu\/metadata-codelist\/LimitationsOnPublicAccess/i.test(c.href));
  // A licence link (in the Anchor or written in the text) is the most precise statement; a sentence is the fallback.
  const urlOf=c=>c.href&&!/metadata-codelist/i.test(c.href)?c.href:(c.t.match(/https?:\/\/[^\s"'<>)]+/)||[])[0]||"";
  const LICENCE=/creativecommons|opendatacommons|licen[cs]|licentie|modellicentie|ConditionsSPW|DataSPW|LicServicesSPW/i;
  const linked=useful.map(c=>({...c,url:urlOf(c)})).find(c=>LICENCE.test(c.url));
  if(linked)return{label:linked.url,text:linked.t};
  const code=useful.find(c=>/ConditionsApplyingToAccessAndUse\/(\w+)/i.test(c.href));
  if(code){const k=code.href.match(/ConditionsApplyingToAccessAndUse\/(\w+)/i)[1];
    if(/noConditionsApply/i.test(k))return{label:"No conditions apply (INSPIRE)",text:code.t};
    if(/conditionsUnknown/i.test(k)&&useful.length===1)return{label:"",text:code.t}}
  const lic=useful.find(c=>!/metadata-codelist/i.test(c.href)&&(LICENCE.test(c.t)||/conditions|voorwaarden|copyright/i.test(c.t)))||useful.find(c=>!/metadata-codelist/i.test(c.href));
  return lic?{label:urlOf(lic)||lic.t,text:lic.t}:{label:"",text:""};
}

export function parseIsoRecord(r,{slug,provider,recordPage=null}){
  const id=firstText(first(r,"fileIdentifier"),"CharacterString")||firstText(r,"fileIdentifier");
  const ident=first(r,"MD_DataIdentification")||first(r,"SV_ServiceIdentification")||first(r,"identificationInfo");
  const title=mainText(first(ident,"citation"),"title");
  if(!id||!title)return null;
  const level=attr(first(r,"hierarchyLevel"),"MD_ScopeCode","codeListValue")||"dataset";
  // Contact: the resource's point of contact first, then the metadata contact.
  const parties=[...blocks(ident,"pointOfContact"),...blocks(r,"contact")];
  const emails=uniq(parties.flatMap(p=>blocks(p,"electronicMailAddress").map(text))).filter(e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const org=parties.map(p=>mainText(p,"organisationName")).find(Boolean)||"";
  // Who publishes it: the owner, then the custodian…, never the catalogue that lists it or its helpdesk (1,954 records said "Metawal").
  const roleOf=p=>attr(p,"CI_RoleCode","codeListValue").toLowerCase();
  const orgName=p=>mainText(p,"organisationName");
  const allParties=[...blocks(ident,"CI_ResponsibleParty"),...blocks(r,"CI_ResponsibleParty")];
  const publisherParty=["owner","custodian","publisher","originator","resourceprovider","pointofcontact","author","distributor"]
    .map(role=>allParties.find(p=>roleOf(p)===role&&orgName(p)&&!/helpdesk|help desk/i.test(orgName(p)))).find(Boolean);
  let publisher=publisherParty?canonicalPublisher(orgName(publisherParty)):"";
  // "Service public de Wallonie" as owner says less than the directorate-general a custodian names
  if(publisher==="Service public de Wallonie (SPW)"){
    const dg=allParties.map(p=>canonicalPublisher(orgName(p))).find(n=>/^SPW[ -]/.test(n));if(dg)publisher=dg;
  }
  const online=blocks(r,"CI_OnlineResource").map(o=>{
    const url=firstText(o,"URL"),protocol=firstText(o,"protocol")||attr(o,"Anchor","xlink:href"),name=firstText(o,"name");
    return url&&/^https?:\/\//i.test(url)?{url,protocol,name}:null;
  }).filter(Boolean);
  const links=[...new Map(online.map(o=>[o.url,o])).values()];
  const distributions=links.slice(0,10).map(o=>({name:o.name||o.protocol||"link",format:protocolFormat(o.protocol,o.url,o.name),url:o.url}));
  const formats=uniq([...blocks(r,"MD_Format").map(f=>canonicalFormat(firstText(f,"name"))).filter(f=>f&&f!=="Other"),...distributions.map(d=>d.format).filter(f=>!["URL","download","HTML"].includes(f))]).slice(0,12);
  const num=n=>{const v=Number(firstText(r,n));return Number.isFinite(v)?v:null};
  const bbox=[num("westBoundLongitude"),num("southBoundLatitude"),num("eastBoundLongitude"),num("northBoundLatitude")];
  const begin=firstText(r,"beginPosition").slice(0,10),end=firstText(r,"endPosition").slice(0,10);
  const freqCode=attr(r,"MD_MaintenanceFrequencyCode","codeListValue").toLowerCase();
  const langs=uniq([...attrs(ident,"LanguageCode","codeListValue"),...blocks(ident,"language").map(l=>text(first(l,"CharacterString")))].map(l=>ISO_LANG[String(l).toLowerCase().slice(0,3)]||""));
  const lic=licenceOf(ident);
  const keywords=uniq(blocks(ident,"keyword").map(text)).slice(0,15);
  const crs=uniq(blocks(first(r,"referenceSystemInfo"),"code").map(text).map(c=>{const m=c.match(/EPSG\/?[^0-9]*(\d{4,5})|^(\d{4,5})$/i);return m?"EPSG:"+(m[1]||m[2]):""})).slice(0,4);
  const resM=Number(firstText(first(ident,"spatialResolution"),"Distance"));
  const dateStamp=(firstText(first(r,"dateStamp"),"DateTime")||firstText(first(r,"dateStamp"),"Date")||firstText(r,"dateStamp")).slice(0,10);
  const updatedAt=validUpdated(citationDate(ident,"revision"))||validUpdated(citationDate(ident,"publication"))||validUpdated(citationDate(ident,"creation"))||validUpdated(dateStamp)||null;
  const period=cleanPeriod(begin||end?{start:begin||null,end:end||null}:null);
  return{
    id:"harvest:"+slug+":"+id,provider:publisher||provider,...(publisher&&publisher!==provider?{aggregator:provider}:{}),platform:"OGC CSW / GeoNetwork (ISO 19139)",datasetId:id,title:clean(title),
    description:mainText(ident,"abstract").slice(0,1200),kind:level,formats,updatedAt,catalogueModifiedAt:validUpdated(dateStamp)||null,
    recordCount:null,fields:[],previewRows:[],schemaOrigin:"none",sampleOrigin:"none",
    extent:{spatial:bbox.every(v=>v!=null)?bbox:null,temporal:period},
    temporal:period,
    geoCoverage:bboxRegion(bbox),
    frequency:ISO_FREQUENCY[freqCode.replace(/[^a-z]/g,"")]||"",
    languages:langs,crs,...(resM>0?{spatialResolutionM:resM}:{}),
    themes:keywords,license:lic.label,licenseText:lic.text!==lic.label?lic.text.slice(0,300):"",
    contactName:org,contactEmail:emails[0]||"",contactUrl:"",
    // a publisher web page linked from the record, else the catalogue's own record page
    officialUrl:links.find(o=>/www:link|^https?:/i.test(o.protocol)&&!/wms|wfs|wcs|wmts|download|\.(zip|csv|pdf|json|xml)(\?|$)/i.test(o.protocol+" "+o.url))?.url||(recordPage?recordPage(id):null),
    sourceRecord:null,distributions
  };
}

/* ---------- OpenDataSoft metas (kept here so they are testable; harvest.mjs runs on import) ---------- */
// ODS metas are a string on one portal and a list on the next; spreading a string gives single letters ("M","o","b",...)
export const asList=v=>v==null||v===""?[]:Array.isArray(v)?v.flatMap(asList):typeof v==="string"?[v]:[];
/** ODS temporal_coverage is free text: keep it when it holds dates or years. */
export function odsTemporal(v){
  const s=clean(asList(v)[0]);if(!s)return null;
  const ds=[...s.matchAll(/\b((?:1[89]|20)\d\d)(?:-(\d\d)(?:-(\d\d))?)?\b/g)].map(m=>m[0]).sort();
  return ds.length?{start:ds[0],end:ds.length>1?ds[ds.length-1]:null,text:s.slice(0,80)}:null;
}

/** Split a CSW GetRecords response into its ISO records. */
export const isoRecords=xml=>[...String(xml||"").matchAll(/<(?:gmd:)?MD_Metadata\b[\s\S]*?<\/(?:gmd:)?MD_Metadata>/gi)].map(m=>m[0]);
