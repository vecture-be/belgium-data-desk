export const VALIDATION_MODEL_VERSION="2026-10-01.3";
const PACK=[
{id:"statbel-sector-pop-geometry",left:"statbel-pop-sector-2025-new",right:"statbel-sector-geom-2025",tier:"file-assisted",runner:"none",label:"Population ↔ 2025 sector geometry",expected:"1:1 on the same 2025 REDEGEO statistical-sector code",sampleLimit:5000,parameters:[],notes:["Compare the actual downloaded 2025 files; catalogue pages are not data endpoints."],leftUrl:"https://statbel.fgov.be/en/open-data/population-statistical-sector-12",rightUrl:"https://statbel.fgov.be/en/open-data/statistical-sectors-2025"},
{id:"nbb-reference-document",left:"nbb-auth-refs",right:"nbb-auth-doc",tier:"credentials",runner:"none",label:"NBB filing reference ↔ document",expected:"1:1 deposit-reference lookup when the requested representation exists",sampleLimit:25,parameters:[],notes:["NBB professional web services require approved subscription/request headers. Keep credentials in environment variables, never in the manifest."],leftUrl:"https://www.nbb.be/en/central-balance-sheet-office/consultation/web-services/test-environment-developer-portal",rightUrl:"https://www.nbb.be/en/central-balance-sheet-office/consultation/web-services/test-environment-developer-portal"},
{id:"delijn-static-realtime",left:"delijn-gtfs-static",right:"delijn-gtfs-rt",tier:"credentials",runner:"none",label:"De Lijn GTFS static ↔ realtime",expected:"feed-scoped trip_id / route_id / stop_id linkage",sampleLimit:100,parameters:[],notes:["Realtime access is provider-controlled/rate-limited. Validate against the compatible static feed version; GTFS IDs are not national identifiers."],leftUrl:"https://transportdata.be/dataset/de-lijn-gtfs-static",rightUrl:"https://transportdata.be/en/dataset/gtfs-realtime-v2"},
{id:"onderwijs-institution-location",left:"onderwijs-instellingen-v2",right:"onderwijs-locations-v1",tier:"live",runner:"onderwijs",label:"Education institution ↔ locations",expected:"1:n parent-child relationship on institution identity",sampleLimit:100,parameters:[],notes:["vestigingsnummer is only unique within its parent institution.","The two endpoints are bounded independently; observed overlap describes the sampled windows, not full-catalogue join coverage."],leftUrl:"https://onderwijs.api.vlaanderen.be/instellingsgegevens/instelling/v2",rightUrl:"https://onderwijs.api.vlaanderen.be/instellingsgegevens/instellingslocatie/v1"},
{id:"waterinfo-station-series",left:"waterinfo-monitoring-points",right:"waterinfo-discharge-timeseries",tier:"live",runner:"waterinfo",label:"Waterinfo station ↔ discharge series",expected:"1:n station-to-series relationship",sampleLimit:100,parameters:[],notes:["Keep station ID, time-series ID, parameter and unit together; station name alone is not a key.","Station and series responses are bounded independently; observed overlap is sample evidence, not a population coverage estimate."],leftUrl:"https://inspirepub.waterinfo.be/arcgis/rest/services/meetpunten/MapServer",rightUrl:"https://download.waterinfo.be/tsmdownload/KiWIS/KiWIS?service=kisters&type=queryServices&request=getTimeseriesValueLayer&datasource=1&format=json&timeseriesgroup_id=192786&metadata=true&custattr_returnfields=dataprovider&orderDir=asc&orderBy=value&invalidValue=-2&invalidPeriod=P1D&md_returnfields=custom_attributes,station_id,station_no,station_name,ts_id,ts_unitsymbol,parametertype_name"},
{id:"basis-address-parcel",left:"basis-address-v2",right:"basis-parcel-v2",tier:"parameterized-live",runner:"basis",label:"Basisregister address ↔ parcel",expected:"explicit registry relation; cardinality can be n:m",sampleLimit:25,parameters:[{id:"parcelObjectId",label:"Parcel object ID / CaPaKey endpoint form",placeholder:"e.g. 11001B0001-00S000"}],notes:["Reads the parcel response and discovers linked address references; address text is never used as identity."],leftUrl:"https://api.basisregisters.vlaanderen.be/v2/adressen/{objectId}",rightUrl:"https://api.basisregisters.vlaanderen.be/v2/percelen/{objectId}"},
{id:"fluvius-sector-statbel-geometry",left:"fluvius-consumption-sector-nace",right:"statbel-sector-geom-2025",tier:"hybrid",runner:"fluvius",label:"Fluvius sector consumption ↔ Statbel sector geometry",expected:"n:1 after statistical-sector vintage validation",sampleLimit:100,parameters:[],notes:["Live validation probes Fluvius sector-key quality only. Cross-source match coverage requires the selected Statbel geometry file."],leftUrl:"https://opendata.fluvius.be/api/explore/v2.1/catalog/datasets/1_06a-verbruiksgegevens-per-statistische-sector-met-nace-sector-en-nace-subsecto/records?limit=100",rightUrl:"https://statbel.fgov.be/en/open-data/statistical-sectors-2025"},
{id:"opgroeien-capacity-coverage",left:"opgroeien-childcare-capacity-2026",right:"opgroeien-childcare-coverage-2026",tier:"file-assisted",runner:"none",label:"Childcare capacity ↔ coverage indicator",expected:"same-geography derivation with publisher denominator methodology",sampleLimit:1000,parameters:[],notes:["Recompute 100 × places / children and reconcile with the published ratio; this is not a simple key join."],leftUrl:"https://www.opgroeien.be/sites/default/files/documenten/b-p-aantal-plaatsen-en-locaties-naar-vergunningstype-en-inkomenstarief_8.xlsx",rightUrl:"https://www.opgroeien.be/sites/default/files/documenten/aantal-plaatsen-per-100-kinderen_12.xlsx"}
];

const norm=v=>String(v??"").trim();
const fieldNorm=v=>norm(v).toLowerCase().replace(/[^a-z0-9]+/g,"");
const pair=(a,b)=>[a,b].sort().join("|");
const specMap=new Map(PACK.map(x=>[pair(x.left,x.right),x]));
export const VALIDATION_PACK=PACK;
export function validationSpecFor(a,b){return specMap.get(pair(typeof a==="string"?a:a?.id,typeof b==="string"?b:b?.id))||null}

function flattenRows(value,depth=0){
  if(depth>5||value==null)return[];
  if(Array.isArray(value)){
    const objects=value.filter(x=>x&&typeof x==="object"&&!Array.isArray(x));
    if(objects.length)return objects.map(x=>x.attributes&&typeof x.attributes==="object"?x.attributes:x.properties&&typeof x.properties==="object"?x.properties:x);
    for(const x of value){const r=flattenRows(x,depth+1);if(r.length)return r}
  }
  if(typeof value==="object"){
    for(const key of ["results","features","data","items","records","timeseries","series"]){if(key in value){const r=flattenRows(value[key],depth+1);if(r.length)return r}}
    for(const x of Object.values(value)){const r=flattenRows(x,depth+1);if(r.length)return r}
  }
  return[];
}
function field(rows,candidates){
  if(!rows.length)return null;
  const keys=[...new Set(rows.flatMap(x=>Object.keys(x||{})))],lookup=new Map(keys.map(k=>[fieldNorm(k),k]));
  for(const c of candidates){const n=fieldNorm(c);if(lookup.has(n))return lookup.get(n)}
  for(const c of candidates){const n=fieldNorm(c),k=keys.find(x=>fieldNorm(x).includes(n)||n.includes(fieldNorm(x)));if(k)return k}
  return null;
}
function counts(values){const m=new Map;for(const v of values)m.set(v,(m.get(v)||0)+1);return m}
function observedCardinality(lc,rc,matched){
  if(!matched.length)return"no matches";
  let lMany=false,rMany=false;
  for(const k of matched){if((lc.get(k)||0)>1)lMany=true;if((rc.get(k)||0)>1)rMany=true}
  return lMany&&rMany?"n:m":lMany?"n:1":rMany?"1:n":"1:1";
}
function keyMetrics(leftRows,rightRows,leftField,rightField){
  const lAll=leftRows.map(x=>norm(x?.[leftField])),rAll=rightRows.map(x=>norm(x?.[rightField]));
  const lk=lAll.filter(Boolean),rk=rAll.filter(Boolean),lc=counts(lk),rc=counts(rk),ls=new Set(lk),rs=new Set(rk);
  const matched=[...ls].filter(k=>rs.has(k)),matchedSet=new Set(matched);
  const matchedLeft=lk.filter(k=>matchedSet.has(k)).length,matchedRight=rk.filter(k=>matchedSet.has(k)).length;
  const leftNull=lAll.length-lk.length,rightNull=rAll.length-rk.length;
  return{
    leftRows:leftRows.length,rightRows:rightRows.length,leftField,rightField,leftNull,rightNull,
    leftNullRate:leftRows.length?leftNull/leftRows.length:null,rightNullRate:rightRows.length?rightNull/rightRows.length:null,
    leftUnique:ls.size,rightUnique:rs.size,leftDuplicateRecords:lk.length-ls.size,rightDuplicateRecords:rk.length-rs.size,
    matchedUnique:matched.length,matchedLeft,matchedRight,
    leftUniqueMatchRate:ls.size?matched.length/ls.size:null,rightUniqueMatchRate:rs.size?matched.length/rs.size:null,
    leftRecordMatchRate:lk.length?matchedLeft/lk.length:null,rightRecordMatchRate:rk.length?matchedRight/rk.length:null,
    leftMatchRate:lk.length?matchedLeft/lk.length:null,rightMatchRate:rk.length?matchedRight/rk.length:null,
    cardinality:observedCardinality(lc,rc,matched)
  };
}
async function fetchJson(url,signal){
  const r=await fetch(url,{signal,headers:{accept:"application/json"}});
  if(!r.ok)throw new Error("HTTP "+r.status);
  const type=r.headers.get("content-type")||"";
  if(!type.includes("json")){const t=await r.text();try{return JSON.parse(t)}catch{throw new Error("Endpoint did not return JSON")}}
  return r.json();
}
function observed(spec,kind,data,notes=[]){return{modelVersion:VALIDATION_MODEL_VERSION,specId:spec.id,kind,observedAt:new Date().toISOString(),data,notes}}

async function validateOnderwijs(spec,signal){
  const [a,b]=await Promise.all([fetchJson(spec.leftUrl,signal),fetchJson(spec.rightUrl,signal)]);
  const left=flattenRows(a).slice(0,spec.sampleLimit),right=flattenRows(b).slice(0,spec.sampleLimit);
  if(!left.length||!right.length)throw new Error("Public endpoints returned no inspectable records");
  const lf=field(left,["instellingsnummer","instellingnummer","instellingId","instelling_id","institutionId"]);
  const rf=field(right,["instellingsnummer","instellingnummer","instellingId","instelling_id","institutionId"]);
  if(!lf||!rf)throw new Error("Could not resolve institution identifier fields from live responses");
  return observed(spec,"join",keyMetrics(left,right,lf,rf),["Sample-bounded observation; vestigingsnummer is not used as the parent key."]);
}
async function validateWaterinfo(spec,signal){
  const meta=await fetchJson(spec.leftUrl+"?f=pjson",signal),layers=Array.isArray(meta.layers)?meta.layers:[];
  if(!layers.length)throw new Error("MapServer published no queryable layers");
  const layer=layers.find(x=>/debiet|afvoer|discharge/i.test(x.name||""))||layers[0];
  const q=spec.leftUrl+"/"+layer.id+"/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount="+spec.sampleLimit+"&f=json";
  const [a,b]=await Promise.all([fetchJson(q,signal),fetchJson(spec.rightUrl,signal)]);
  const left=flattenRows(a).slice(0,spec.sampleLimit),right=flattenRows(b).slice(0,spec.sampleLimit);
  if(!left.length||!right.length)throw new Error("Waterinfo services returned no inspectable records");
  const cand=["station_id","station_no","stationno","stationid","meetpunt_id","meetpuntid"],lf=field(left,cand),rf=field(right,cand);
  if(!lf||!rf)throw new Error("Could not resolve a shared station identifier from Waterinfo responses");
  return observed(spec,"join",keyMetrics(left,right,lf,rf),["Layer sampled: "+(layer.name||layer.id),"Series metadata is sampled; observations remain series/timestamp grain."]);
}
async function validateFluvius(spec,signal){
  const j=await fetchJson(spec.leftUrl,signal),rows=flattenRows(j).slice(0,spec.sampleLimit);
  if(!rows.length)throw new Error("Fluvius API returned no inspectable records");
  const f=field(rows,["statistische_sector","statistische sector","statistischesector","statistische_sector_code","statistisch_sector","nis9"]);
  if(!f)throw new Error("Could not resolve statistical-sector field");
  const all=rows.map(x=>norm(x?.[f])),keys=all.filter(Boolean),unique=new Set(keys),valid=keys.filter(x=>x.length===9).length;
  return observed(spec,"key-probe",{rows:rows.length,field:f,nullKeys:all.length-keys.length,uniqueKeys:unique.size,duplicateRecords:keys.length-unique.size,nineCharacterKeys:valid,nineCharacterRate:keys.length?valid/keys.length:0},["Source-side key-quality probe only; no Statbel geometry match rate is claimed."]);
}
function collectAddressRefs(value,out=new Set,key=""){
  if(value==null)return out;
  if(typeof value==="string"){
    const m=value.match(/\/adressen\/([^/?#]+)/i);if(m)out.add(decodeURIComponent(m[1]));
    if(/adres/i.test(key)&&value.length<200&&!/^https?:/i.test(value))out.add(value);
  }else if(Array.isArray(value))value.forEach(x=>collectAddressRefs(x,out,key));
  else if(typeof value==="object")Object.entries(value).forEach(([k,v])=>collectAddressRefs(v,out,k));
  return out;
}
async function validateBasis(spec,params,signal){
  const id=norm(params?.parcelObjectId);if(!id)throw new Error("Parcel object ID is required");
  const parcel=await fetchJson(spec.rightUrl.replace("{objectId}",encodeURIComponent(id)),signal),refs=[...collectAddressRefs(parcel)].filter(Boolean);
  let resolvable=0,firstStatus="not tested";
  if(refs[0]){
    try{await fetchJson(spec.leftUrl.replace("{objectId}",encodeURIComponent(refs[0])),signal);resolvable=1;firstStatus="resolved"}catch(e){firstStatus="address lookup failed: "+e.message}
  }
  return observed(spec,"registry-link",{parcelObjectId:id,addressReferences:refs.length,firstAddressId:refs[0]||null,firstAddressResolvable:resolvable,firstStatus},["Observed from one user-supplied parcel object; not a population-level match-rate estimate."]);
}
export async function runValidation(spec,params={},signal){
  if(!spec)throw new Error("No validation specification for this pair");
  if(spec.runner==="onderwijs")return validateOnderwijs(spec,signal);
  if(spec.runner==="waterinfo")return validateWaterinfo(spec,signal);
  if(spec.runner==="fluvius")return validateFluvius(spec,signal);
  if(spec.runner==="basis")return validateBasis(spec,params,signal);
  throw new Error("This relationship is "+spec.tier+" and has no anonymous live runner");
}
