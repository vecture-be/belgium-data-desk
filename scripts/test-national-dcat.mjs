import assert from "node:assert/strict";
import { canonicalFormat, catalogueFromNodes, ingestNtLine, parseNtLine, thinNationalCatalogue, validateNationalCatalogue, NATIONAL_MIN_DATASETS } from "./national-dcat.mjs";
import { isLdesEndpoint, ldesCapability } from "../public/dataset-ldes-v1.mjs";

const RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#type",DCAT="http://www.w3.org/ns/dcat#",DCT="http://purl.org/dc/terms/",FOAF="http://xmlns.com/foaf/0.1/",VCARD="http://www.w3.org/2006/vcard/ns#";
const nodes=new Map(),add=line=>assert.equal(ingestNtLine(nodes,line),true);
assert.equal(parseNtLine('_:x <http://purl.org/dc/terms/title> "Hello"@en .').subject,"_:x");

function dataset(i,{id="dataset-"+i,title="Dataset "+i,publisher="Publisher "+(i%25),description="",favv=false}={}){
  const s="<https://example.test/d/"+i+">",pub=favv?"_:pub-favv":"_:pub"+(i%25),dist="_:dist"+i;
  add(s+" <"+RDF+"> <"+DCAT+"Dataset> .");
  add(s+' <'+DCT+'title> "'+title.replace(/"/g,'\\"')+'"@en .');
  add(s+' <'+DCT+'identifier> "'+id+'" .');
  if(description)add(s+' <'+DCT+'description> "'+description+'"@en .');
  add(s+" <"+DCT+"publisher> "+pub+" .");
  add(pub+' <'+DCT+'title> "'+(favv?"FAVV":publisher)+'"@en .');
  add(s+" <"+DCAT+"distribution> "+dist+" .");
  add(dist+" <"+DCAT+"downloadURL> <https://example.test/file/"+i+".csv> .");
  add(dist+' <'+DCT+'format> "CSV" .');
  add(dist+' <'+DCAT+'byteSize> "12345" .');
  add(s+' <'+DCT+'modified> "2026-09-30" .');
}
for(let i=0;i<NATIONAL_MIN_DATASETS;i++)dataset(i);
dataset(NATIONAL_MIN_DATASETS,{id:"favv-afsca-operators",title:"List of operators",favv:true,description:"Registered FAVV operators"});
const contactDataset="<https://example.test/d/"+NATIONAL_MIN_DATASETS+">";
add(contactDataset+" <"+DCAT+"contactPoint> _:favv-contact .");
add('_:favv-contact <'+VCARD+'fn> "FAVV Open Data" .');
add("_:favv-contact <"+VCARD+"hasEmail> <mailto:open-data@example.test> .");
add("_:favv-contact <"+VCARD+"hasURL> <https://example.test/contact> .");
dataset(NATIONAL_MIN_DATASETS+1,{id:"fasfc-activity-codes",title:"List of FASFC activity codes",favv:true});

const payload=catalogueFromNodes(nodes,{generatedAt:"2026-10-01T00:00:00Z",source:"fixture"});
payload.health=validateNationalCatalogue(payload);
assert.equal(payload.health.ok,true,payload.health.errors.join("; "));
assert.equal(payload.health.missingSentinels.length,0);
assert.ok(payload.health.publisherCount>=20);
assert.ok(payload.health.distributionCount>=500);

const favv=payload.items.find(x=>x.datasetId==="favv-afsca-operators");
assert.ok(favv);
assert.equal(favv.provider,"FAVV");
assert.equal(favv.discovery,"data.gov.be");
assert.equal(favv.formats[0],"CSV");
assert.equal(favv.distributions[0].url,"https://example.test/file/"+NATIONAL_MIN_DATASETS+".csv");
assert.equal(favv.distributions[0].byteSize,12345);
assert.equal(favv.description,"Registered FAVV operators");
assert.equal(favv.contactName,"FAVV Open Data");
assert.equal(favv.contactEmail,"open-data@example.test");
assert.equal(favv.contactUrl,"https://example.test/contact");
assert.equal(canonicalFormat("http://publications.europa.eu/resource/authority/file-type/CSV"),"CSV");
assert.equal(canonicalFormat("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),"XLSX");
assert.equal(canonicalFormat("","https://example.test/export.geojson"),"GeoJSON");

const altNodes=new Map(),altAdd=line=>assert.equal(ingestNtLine(altNodes,line),true);
altAdd("<https://example.test/alt> <"+RDF+"> <"+DCAT+"Dataset> .");
altAdd('<https://example.test/alt> <'+DCT+'title> "Alt dataset"@en .');
altAdd('<https://example.test/alt> <'+DCT+'identifier> "alt" .');
altAdd("<https://example.test/alt> <"+DCT+"publisher> _:altpub .");
altAdd('_:altpub <'+FOAF+'name> "Readable Publisher"@en .');
const alt=catalogueFromNodes(altNodes,{generatedAt:"2026-10-01T00:00:00Z",source:"fixture"}).items[0];
assert.equal(alt.provider,"Readable Publisher");

const thin=thinNationalCatalogue(payload);
assert.equal(thin.health.ok,true);
assert.equal(thin.items.find(x=>x.datasetId==="favv-afsca-operators").discovery,"data.gov.be");
assert.equal(thin.items.find(x=>x.datasetId==="favv-afsca-operators").contactEmail,"open-data@example.test");

const unhealthy={items:payload.items.filter(x=>!String(x.datasetId).includes("favv-afsca-operators"))};
const bad=validateNationalCatalogue(unhealthy);
assert.equal(bad.ok,false);
assert.ok(bad.missingSentinels.includes("favv-afsca-operators"));

// curation: licence / place / theme URIs are interpreted at harvest time, never shown as bare IDs
// two catalogue records declaring the same identifier must not collapse into one record id
const dupNodes=new Map(),dupAdd=line=>assert.equal(ingestNtLine(dupNodes,line),true);
for(const k of ["a","b"]){
  const S="<https://example.test/dup/"+k+">";
  dupAdd(S+" <"+RDF+"> <"+DCAT+"Dataset> .");dupAdd(S+' <'+DCT+'title> "Dup '+k+'"@en .');dupAdd(S+' <'+DCT+'identifier> "doi:10.1/shared" .');
}
const dupIds=catalogueFromNodes(dupNodes,{generatedAt:"2026-10-01T00:00:00Z",source:"fixture"}).items.map(x=>x.id);
assert.equal(new Set(dupIds).size,2,"duplicate identifiers get distinct record ids");
assert.equal(dupIds[0],"national:doi:10.1/shared");
const curNodes=new Map(),curAdd=line=>assert.equal(ingestNtLine(curNodes,line),true);
const CUR="<https://example.test/cur>";
curAdd(CUR+" <"+RDF+"> <"+DCAT+"Dataset> .");
curAdd(CUR+' <'+DCT+'title> "Cur dataset"@en .');
curAdd(CUR+' <'+DCT+'identifier> "cur" .');
curAdd(CUR+" <"+DCT+"publisher> _:curpub .");
curAdd('_:curpub <'+FOAF+'name> "Cur publisher"@en .');
curAdd(CUR+" <"+DCT+"license> <http://data.vlaanderen.be/id/licentie/modellicentie-gratis-hergebruik/v1.0> .");
curAdd(CUR+" <"+DCT+"spatial> <https://sws.geonames.org/3337388/> .");
curAdd(CUR+" <"+DCAT+"theme> <http://publications.europa.eu/resource/authority/data-theme/TRAN> .");
curAdd(CUR+" <"+DCAT+"distribution> _:curdist .");
curAdd("_:curdist <"+DCAT+"downloadURL> <https://example.test/cur.csv> .");
curAdd('_:curdist <'+DCT+'format> "CSV" .');
const cur=catalogueFromNodes(curNodes,{generatedAt:"2026-10-01T00:00:00Z",source:"fixture"}).items[0];
assert.equal(cur.license,"Flemish free-reuse model licence v1.0");   // used to surface as the bare string "v1.0"
assert.equal(cur.licenseFamily,"open");
assert.equal(cur.geoCoverage,"Flanders");                           // used to surface as GeoNames ID 3337388
assert.equal(cur.geoScope,"flanders");
assert.deepEqual(cur.euThemes,["TRAN"]);
assert.equal(cur.topic,"transport");
assert.equal(cur.dataKind,"dataset");
assert.equal(cur.distributions[0].byteSize,null);                   // absent size must stay unknown, never "0 bytes"
const curThin=thinNationalCatalogue({generatedAt:"x",source:"x",items:[cur],series:[],health:{}}).items[0];
assert.equal(curThin.licenseFamily,"open");assert.equal(curThin.topic,"transport");assert.equal(curThin.geoScope,"flanders");


// Minimal DataService regression: DCAT services are not Dataset records and their
// endpointURL must survive through the catalogue and thin snapshot.
const serviceNodes=new Map(),addService=line=>assert.equal(ingestNtLine(serviceNodes,line),true);
const S="<https://example.test/services/gipod>",D="<https://example.test/datasets/gipod>";
addService(S+" <"+RDF+"> <"+DCAT+"DataService> .");
addService(S+' <'+DCT+'title> "GIPOD public LDES"@en .');
addService(S+' <'+DCT+'description> "Public versioned planned mobility hindrance stream"@en .');
addService(S+" <"+DCAT+"endpointURL> <https://gipod.api.vlaanderen.be/api/v1/ldes/mobility-hindrances> .");
addService(S+" <"+DCAT+"endpointDescription> <https://example.test/ldes/docs> .");
addService(S+" <"+DCAT+"servesDataset> "+D+" .");
addService(S+" <"+DCT+"conformsTo> <https://example.test/standards/ldes> .");
addService(D+" <"+RDF+"> <"+DCAT+"Dataset> .");
addService(D+' <'+DCT+'title> "GIPOD event dataset"@en .');
addService(D+" <"+DCAT+"distribution> _:gipod-dist .");
addService("_:gipod-dist <"+DCAT+"accessService> "+S+" .");
const serviceCatalogue=catalogueFromNodes(serviceNodes,{source:"fixture",generatedAt:"2026-11-10T00:00:00Z"});
const record=serviceCatalogue.items.find(x=>x.serviceType==="DCAT DataService");
assert.ok(record,"DataService must not disappear during import");
assert.equal(record.dataKind,"data-service");
assert.equal(record.distributions.length,1);
assert.equal(record.distributions[0].format,"LDES");
assert.equal(record.endpointDescription,"https://example.test/ldes/docs");
assert.deepEqual(record.servesDataset,["https://example.test/datasets/gipod"]);
assert.equal(ldesCapability(record).status,"publisher_declared");
const linked=serviceCatalogue.items.find(x=>x.kind==="DCAT dataset");
assert.equal(linked.distributions[0].format,"LDES","dcat:accessService must expose the provider endpoint");
assert.equal(ldesCapability(linked).endpoints[0].url,record.distributions[0].url);
const thinService=thinNationalCatalogue({...serviceCatalogue,health:{ok:true}}).items.find(x=>x.serviceType);
assert.equal(thinService.endpointDescription,record.endpointDescription);
assert.equal(thinService.distributions[0].url,record.distributions[0].url);
assert.equal(isLdesEndpoint("https://publisher.example/api/ldes/items"),true);
assert.equal(isLdesEndpoint("https://publisher.example/api/ldes-info"),false);
assert.equal(ldesCapability({title:"An LDES-inspired research paper",distributions:[]}).status,"mentioned_only");
assert.equal(ldesCapability({title:"Plain RDF",distributions:[{url:"https://publisher.example/records.jsonld",format:"JSON-LD"}]}).status,"none");

console.log(JSON.stringify({ok:true,datasets:payload.itemCount,publishers:payload.health.publisherCount,distributions:payload.health.distributionCount,sentinels:payload.health.sentinelMatches}));
