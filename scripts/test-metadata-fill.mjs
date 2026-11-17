// Metadata the sources publish must reach the records: ISO 19139 harvest, ODS metas, extra DCAT fields, licences, measured periods.
import assert from "node:assert/strict";
import { asList, bboxRegion, odsTemporal, parseIsoRecord, protocolFormat } from "./harvest-iso.mjs";
import { catalogueFromNodes, ingestNtLine, inferPublishers } from "./national-dcat.mjs";
import { LICENSE_RULES, normalizeLicense } from "../public/dataset-licence-v1.mjs";
import { facetsOf, periodYears, toDocs } from "./build-mcp-index.mjs";
import { backfillDocs } from "./build-cards.mjs";
import { coversYear, inLanguage } from "../mcp-server.mjs";

/* ---------- ISO 19139 ---------- */
const iso=`<gmd:MD_Metadata><gmd:fileIdentifier><gco:CharacterString>abc-123</gco:CharacterString></gmd:fileIdentifier>
<gmd:hierarchyLevel><gmd:MD_ScopeCode codeListValue="dataset"/></gmd:hierarchyLevel>
<gmd:contact><gmd:CI_ResponsibleParty><gmd:organisationName><gco:CharacterString>Meta contact</gco:CharacterString></gmd:organisationName>
<gmd:electronicMailAddress><gco:CharacterString>meta@example.be</gco:CharacterString></gmd:electronicMailAddress></gmd:CI_ResponsibleParty></gmd:contact>
<gmd:dateStamp><gco:DateTime>2026-10-24T10:00:00</gco:DateTime></gmd:dateStamp>
<gmd:referenceSystemInfo><gmd:MD_ReferenceSystem><gmd:referenceSystemIdentifier><gmd:RS_Identifier><gmd:code><gmx:Anchor xlink:href="http://www.opengis.net/def/crs/EPSG/0/31370">EPSG:31370</gmx:Anchor></gmd:code></gmd:RS_Identifier></gmd:referenceSystemIdentifier></gmd:MD_ReferenceSystem></gmd:referenceSystemInfo>
<gmd:identificationInfo><gmd:MD_DataIdentification>
<gmd:citation><gmd:CI_Citation><gmd:title xsi:type="gmd:PT_FreeText_PropertyType"><gco:CharacterString>Cours d'eau</gco:CharacterString><gmd:PT_FreeText><gmd:textGroup><gmd:LocalisedCharacterString locale="#NL">Waterlopen</gmd:LocalisedCharacterString></gmd:textGroup></gmd:PT_FreeText></gmd:title>
<gmd:date><gmd:CI_Date><gmd:date><gco:Date>2024-03-01</gco:Date></gmd:date><gmd:dateType><gmd:CI_DateTypeCode codeListValue="revision"/></gmd:dateType></gmd:CI_Date></gmd:date></gmd:CI_Citation></gmd:citation>
<gmd:abstract><gco:CharacterString>Réseau hydrographique wallon.</gco:CharacterString></gmd:abstract>
<gmd:pointOfContact><gmd:CI_ResponsibleParty><gmd:organisationName><gco:CharacterString>SPW</gco:CharacterString></gmd:organisationName>
<gmd:electronicMailAddress><gco:CharacterString>helpdesk@spw.example</gco:CharacterString></gmd:electronicMailAddress></gmd:CI_ResponsibleParty></gmd:pointOfContact>
<gmd:resourceMaintenance><gmd:MD_MaintenanceInformation><gmd:maintenanceAndUpdateFrequency><gmd:MD_MaintenanceFrequencyCode codeListValue="annually"/></gmd:maintenanceAndUpdateFrequency></gmd:MD_MaintenanceInformation></gmd:resourceMaintenance>
<gmd:descriptiveKeywords><gmd:MD_Keywords><gmd:keyword><gco:CharacterString>eau</gco:CharacterString></gmd:keyword></gmd:MD_Keywords></gmd:descriptiveKeywords>
<gmd:resourceConstraints><gmd:MD_LegalConstraints><gmd:otherConstraints><gmx:Anchor xlink:href="http://inspire.ec.europa.eu/metadata-codelist/LimitationsOnPublicAccess/noLimitations">No limitations</gmx:Anchor></gmd:otherConstraints>
<gmd:otherConstraints><gco:CharacterString>Licence: https://creativecommons.org/licenses/by/4.0/</gco:CharacterString></gmd:otherConstraints></gmd:MD_LegalConstraints></gmd:resourceConstraints>
<gmd:language><gmd:LanguageCode codeListValue="fre"/></gmd:language>
<gmd:extent><gmd:EX_Extent><gmd:geographicElement><gmd:EX_GeographicBoundingBox><gmd:westBoundLongitude><gco:Decimal>2.75</gco:Decimal></gmd:westBoundLongitude><gmd:eastBoundLongitude><gco:Decimal>6.5</gco:Decimal></gmd:eastBoundLongitude><gmd:southBoundLatitude><gco:Decimal>49.45</gco:Decimal></gmd:southBoundLatitude><gmd:northBoundLatitude><gco:Decimal>50.85</gco:Decimal></gmd:northBoundLatitude></gmd:EX_GeographicBoundingBox></gmd:geographicElement>
<gmd:temporalElement><gmd:EX_TemporalExtent><gmd:extent><gml:TimePeriod><gml:beginPosition>2010-01-01</gml:beginPosition><gml:endPosition>2020-12-31</gml:endPosition></gml:TimePeriod></gmd:extent></gmd:EX_TemporalExtent></gmd:temporalElement></gmd:EX_Extent></gmd:extent>
</gmd:MD_DataIdentification></gmd:identificationInfo>
<gmd:distributionInfo><gmd:MD_Distribution><gmd:transferOptions><gmd:MD_DigitalTransferOptions>
<gmd:onLine><gmd:CI_OnlineResource><gmd:linkage><gmd:URL>https://geoservices.example.be/wms?service=WMS</gmd:URL></gmd:linkage><gmd:protocol><gco:CharacterString>OGC:WMS</gco:CharacterString></gmd:protocol></gmd:CI_OnlineResource></gmd:onLine>
<gmd:onLine><gmd:CI_OnlineResource><gmd:linkage><gmd:URL>https://data.example.be/cours.zip</gmd:URL></gmd:linkage><gmd:protocol><gco:CharacterString>WWW:DOWNLOAD-1.0-http--download</gco:CharacterString></gmd:protocol></gmd:CI_OnlineResource></gmd:onLine>
</gmd:MD_DigitalTransferOptions></gmd:transferOptions></gmd:MD_Distribution></gmd:distributionInfo></gmd:MD_Metadata>`;
const r=parseIsoRecord(iso,{slug:"wallonia",provider:"SPW",recordPage:id=>"https://cat.example/#/metadata/"+id});
assert.equal(r.id,"harvest:wallonia:abc-123");
assert.equal(r.title,"Cours d'eau","main-language title, not every translation glued together");
assert.equal(r.description,"Réseau hydrographique wallon.");
assert.equal(r.contactEmail,"helpdesk@spw.example","the resource's point of contact before the metadata contact");
assert.equal(r.contactName,"SPW");
assert.equal(r.license,"https://creativecommons.org/licenses/by/4.0/","licence URL from the text; the INSPIRE access code is not a licence");
assert.equal(normalizeLicense(r.license).label,"CC BY");
assert.deepEqual(r.extent.spatial,[2.75,49.45,6.5,50.85]);
assert.equal(r.geoCoverage,"Wallonia");
assert.deepEqual(r.temporal,{start:"2010-01-01",end:"2020-12-31"});
assert.equal(r.frequency,"ANNUAL");
assert.deepEqual(r.languages,["fr"]);
assert.deepEqual(r.crs,["EPSG:31370"]);
assert.equal(r.updatedAt,"2024-03-01","resource revision date, not the metadata date stamp");
assert.equal(r.catalogueModifiedAt,"2026-10-24");
assert.deepEqual(r.distributions.map(d=>d.format),["WMS","ZIP"]);
assert.equal(r.officialUrl,"https://cat.example/#/metadata/abc-123","no web page among the links: the catalogue record page");
assert.equal(protocolFormat("ESRI:REST","https://x/arcgis/rest/services/a/MapServer"),"Esri REST");
assert.equal(bboxRegion([4.3,50.8,4.4,50.9]),"Brussels-Capital");
assert.equal(bboxRegion([-10,40,20,60]),"");

/* ---------- ODS metas ---------- */
assert.deepEqual(asList("Mobiliteit"),["Mobiliteit"],"a string is one value, not its letters");
assert.deepEqual(asList(["a",["b"]]),["a","b"]);
assert.deepEqual(asList(null),[]);
assert.deepEqual(odsTemporal("De 2015 à 2023"),{start:"2015",end:"2023",text:"De 2015 à 2023"});
assert.equal(odsTemporal("toutes les années"),null);

/* ---------- national DCAT extra fields ---------- */
const D="http://purl.org/dc/terms/",C="http://www.w3.org/ns/dcat#",T="<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>";
const lines=[
  `<https://ex/ds1> ${T} <${C}Dataset> .`,
  `<https://ex/ds1> <${D}title> "Population 2024"@en .`,
  `<https://ex/ds1> <${D}publisher> <https://ex/org/statbel> .`,
  `<https://ex/org/statbel> <http://xmlns.com/foaf/0.1/name> "Statbel" .`,
  `<https://ex/ds1> <${D}temporal> <https://data.gov.be/.well-known/genid/temporal/2024-01-01-2024-12-31> .`,
  `<https://ex/ds1> <${D}language> <http://publications.europa.eu/resource/authority/language/NLD> .`,
  `<https://ex/ds1> <${D}language> <http://publications.europa.eu/resource/authority/language/FRE> .`,
  `<https://ex/ds1> <${D}accessRights> <http://publications.europa.eu/resource/authority/access-right/NON_PUBLIC> .`,
  `<https://ex/ds1> <${D}provenance> <https://ex/prov1> .`,
  `<https://ex/prov1> <${D}title> "Compiled from the national register." .`,
  `<https://ex/ds1> <${D}conformsTo> <http://www.opengis.net/def/crs/EPSG/0/31370> .`,
  `<https://ex/ds1> <http://data.europa.eu/r5r/hvdCategory> <http://data.europa.eu/bna/c_e1da4e07> .`,
  `<https://ex/ds1> <${C}contactPoint> <https://ex/c1> .`,
  `<https://ex/c1> <http://www.w3.org/2006/vcard/ns#hasEmail> <mailto:info@stat.example> .`,
  `<https://ex/ds2> ${T} <${C}Dataset> .`,
  `<https://ex/ds2> <${D}title> "Temporal schema dates" .`,
  `<https://ex/ds2> <${D}temporal> _:t2 .`,
  `_:t2 <http://schema.org/startDate> "1900-01-01"^^<http://www.w3.org/2001/XMLSchema#date> .`,
  `_:t2 <http://schema.org/endDate> "2019-06-30"^^<http://www.w3.org/2001/XMLSchema#date> .`
];
const nodes=new Map();for(const l of lines)ingestNtLine(nodes,l);
const cat=catalogueFromNodes(nodes),ds1=cat.items.find(x=>x.title==="Population 2024"),ds2=cat.items.find(x=>x.title==="Temporal schema dates");
assert.deepEqual(ds1.temporal,{start:"2024-01-01",end:"2024-12-31"},"period read from the PeriodOfTime IRI");
assert.deepEqual(ds1.languages,["nl","fr"],"EU language codes, old ones (FRE) included");
assert.equal(ds1.accessRights,"NON_PUBLIC");
assert.equal(ds1.provenance,"Compiled from the national register.");
assert.deepEqual(ds1.crs,["EPSG:31370"]);
assert.deepEqual(ds1.hvdCategories,["Statistics"]);
assert.deepEqual(ds2.temporal,{start:null,end:"2019-06-30"},"1900-01-01 is a placeholder, not a start date");

/* ---------- publisher inference ---------- */
const pubs=[...Array(4)].map((_,i)=>({provider:"Royal Meteorological Institute",contactEmail:"a"+i+"@kmi.example",officialUrl:"https://kmi.example/"+i}));
const orphan={provider:"data.gov.be source",contactEmail:"x@kmi.example",officialUrl:"https://data.gov.be/x"};
const shared=[...Array(3)].map((_,i)=>({provider:"Agency "+i,contactEmail:"a@vlaanderen.example",officialUrl:""}));
const orphan2={provider:"data.gov.be source",contactEmail:"b@vlaanderen.example",officialUrl:""};
assert.equal(inferPublishers([...pubs,orphan,...shared,orphan2]),1);
assert.equal(orphan.provider,"Royal Meteorological Institute");assert.equal(orphan.publisherInferredFrom,"domain");
assert.equal(orphan2.provider,"data.gov.be source","a domain several publishers share names none of them");

/* ---------- licences: one label per licence ---------- */
for(const [raw,label,family] of [
  ["Modellicentie Gratis Hergebruik","Flemish free-reuse model licence v1.0","open"],
  ["modellicentie-gratis-hergebruik/v1.0","Flemish free-reuse model licence v1.0","open"],
  ["Creative Commons CCZero","CC0 (public domain)","open"],["Open licentie CC0 - Universeel","CC0 (public domain)","open"],["CC0 1.0","CC0 (public domain)","open"],
  ["Creative Commons Attribution","CC BY","open"],["CC-BY","CC BY","open"],["CC BY 4.0","CC BY","open"],
  ["https://creativecommons.org/licenses/by-nc-sa/4.0/","CC BY-NC-SA","non-commercial"],
  ["Open Data Commons Attribution License","ODC-BY","open"],
  ["Not specified","","unknown"],["Licence non spécifiée","","unknown"],
  ["Les Conditions d’accès et d’utilisation des services web géographiques de visualisation du Service public de Wallonie sont d'applications.","SPW Wallonia conditions of use","custom"],
  ["http://data.gov.be/.well-known/genid/63236b7128d642e2a86d","Licence stated without a name (see source)","custom"],
  ["CC 0","CC0 (public domain)","open"],["CC-0","CC0 (public domain)","open"],["CC_PDM_1_0","CC0 (public domain)","open"],
  ["UK Open Government Licence (OGL)","Open Government Licence 3.0","open"],["Other (Open)","Open licence (unnamed)","open"],
  ["Creative Commons Non-Commercial (Any)","CC BY-NC","non-commercial"],
  ["Attribution - Partage dans les Mêmes Conditions 2.0 Belgique","CC BY-SA","open-sharealike"]
]){const n=normalizeLicense(raw);assert.equal(n.label,label,raw);assert.equal(n.family,family,raw)}
assert.equal(normalizeLicense("https://data.vlaanderen.be/id/licentie/gebruiksrecht-webdiensten/v1.0").label,"gebruiksrecht-webdiensten","a version segment is not a licence name");
assert.equal(normalizeLicense("https://example.be/2024/").label,"example.be","a host when nothing else names it");
// a stored canonical label normalises to itself, with the same family
for(const [,id,label,family] of LICENSE_RULES)if(label){const n=normalizeLicense(label);assert.equal(n.label,label,"idempotent: "+label);assert.equal(n.family,family,"family kept: "+label)}
const doc=toDocs({id:"harvest:x:1",title:"t",provider:"p",license:"Modellicentie Gratis Hergebruik",licenseFamily:"open",temporal:{start:"2015-01-01",end:null},languages:["nl"],accessRights:"RESTRICTED",contactName:"Mobiliteitsbedrijf"},null);
assert.equal(doc.light.l,"Flemish free-reuse model licence v1.0","index shows the canonical label, not the publisher's spelling");
assert.deepEqual(doc.light.y,[2015,new Date().getUTCFullYear()],"an open-ended period runs to now");
assert.deepEqual(doc.light.lg,["nl"]);assert.equal(doc.light.ar,"RESTRICTED");
assert.equal(doc.detail.cn,"Mobiliteitsbedrijf");
assert.equal(periodYears(null),null);

/* ---------- measured period back into the search documents ---------- */
const docs=[{id:"a"},{id:"b",y:[2001,2002]},{id:"c"},{id:"e"}];
const cards=new Map([["a",{file:{rows_exact:true},coverage:{time:{from:"2019-01",to:"2023-12",column:"month"}}}],["b",{file:{rows_exact:true},coverage:{time:{from:"2010",to:"2011"}}}],["c",{coverage:{time:null}}],["e",{file:{rows_exact:false},coverage:{time:{from:"2026-01",to:"2026-02"}}}]]);
assert.equal(backfillDocs(docs,cards),1);
assert.deepEqual(docs[0],{id:"a",y:[2019,2023],ym:1});
assert.deepEqual(docs[1].y,[2001,2002],"a declared period is never overwritten");
assert.ok(coversYear({y:[2019,2023]},2020));assert.ok(!coversYear({y:[2019,2023]},2024));assert.ok(!coversYear({},2020));assert.ok(coversYear({},null));
assert.ok(inLanguage({lg:["nl","fr"]},"fr"));assert.ok(!inLanguage({},"fr"));
assert.deepEqual(facetsOf([{y:[2019,2023],lg:["nl","fr"]},{},{lg:["de"]}]),{y:[[2019,2023],0,0],lg:[3,0,8]});
console.log("metadata fill tests passed");
