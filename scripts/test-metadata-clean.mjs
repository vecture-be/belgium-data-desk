// Value cleaning (scripts/metadata-clean.mjs): each case is a defect seen on the live catalogue.
import assert from "node:assert/strict";
import { canonicalPublisher, cityGeography, cleanFrequency, cleanPeriod, cutText, htmlToText, httpsLink, isOpaqueId, landingPage, unifyPublisherNames, validUpdated } from "./metadata-clean.mjs";
import { formatLabel, toDocs } from "./build-mcp-index.mjs";
import { backfillDocs } from "./build-cards.mjs";

const Y=new Date().getUTCFullYear();
// dates
assert.equal(validUpdated("Invalid Date"),"");assert.equal(validUpdated("1571-01-01"),"");assert.equal(validUpdated("9999-12-31"),"");
assert.equal(validUpdated("2024-03-01T10:00:00Z"),"2024-03-01");assert.equal(validUpdated("2024-13-01"),"");
assert.deepEqual(cleanPeriod({start:"1974-02-15",end:"9999-01-01"}),{start:"1974-02-15",end:null,plannedEnd:"9999-01-01"},"a far-future end is a validity date");
assert.deepEqual(cleanPeriod({start:"1771-01-01",end:"1778-12-31"}),{start:"1771-01-01",end:"1778-12-31"},"historic maps keep their period");
assert.equal(cleanPeriod({start:(Y+5)+"-01-01",end:null}),null);assert.equal(cleanPeriod(null),null);
// frequency and leaked ids
assert.equal(cleanFrequency("b6d53d524c494e5a9b37bec45c748bf71535-3958c17a2fc054a6"),"");
assert.equal(cleanFrequency("CONTINUOUS"),"CONT");assert.equal(cleanFrequency("IRREG"),"IRREG");assert.equal(cleanFrequency("1MIN"),"1MIN");
assert.ok(isOpaqueId("b6d53d524c494e5a9b37bec45c748bf7908-3958c17a2fbe973f"));assert.ok(!isOpaqueId("Statbel"));
// publishers
for(const [raw,want] of [
  ["Gestion et valorisation de la donnée (SPW - Secrétariat général - SPW Digital - Département Données transversales - Gestion et valorisation de la donnée)","SPW-SG Secrétariat général"],
  ["Direction des Cours d'eau non navigables (SPW - Agriculture, Ressources naturelles et Environnement - Département …)","SPW ARNE"],
  ["Agence wallonne du Patrimoine (SPW - Territoire, Logement, Patrimoine, Énergie - Agence wallonne du Patrimoine)","SPW TLPE Territoire, Logement, Patrimoine, Énergie"],
  ["Service Public de Wallonie - Ecomie, Emploi, Recherche","SPW EER Économie, Emploi, Recherche"],["SPW DGO3 DEMNA","SPW ARNE"],
  ["Service public de Wallonie (SPW)","Service public de Wallonie (SPW)"],["SPW Wallonia: Buildings HVD","Service public de Wallonie (SPW)"],
  ["geo.be / National Geographic Institute","National Geographic Institute (NGI)"],["NGI","National Geographic Institute (NGI)"],["Institut géographique national (IGN)","National Geographic Institute (NGI)"],
  ["Royal Belgian Institute of Natural Sciences (RBINS), Directorate Natural Environment (OD Nature), Belgian Marine Data Centre (BMDC)","Royal Belgian Institute of Natural Sciences"],
  ["Royal Belgian Institute for Natural Sciences, Directorate Natural Environment, GeoCell","Royal Belgian Institute of Natural Sciences"],
  ["FPS Finance - General Administration of Patrimonial Documentation (GAPD)","FPS Finance"],["FOREM","Le Forem"],["BEBAT","Bebat"],
  ["Agence Wallonne de l'Air et du Climat (AwAC)","Agence Wallonne de l'Air et du Climat (AwAC)"],["Statbel","Statbel"]
])assert.equal(canonicalPublisher(raw),want,raw);
const items=[{provider:"Université libre de Bruxelles"},{provider:"Université libre de Bruxelles"},{provider:"Université Libre de Bruxelles"}];
assert.equal(unifyPublisherNames(items),1);assert.ok(items.every(x=>x.provider==="Université libre de Bruxelles"));
// geography
assert.equal(cityGeography("City of Namur","Wallonia"),"Namur");assert.equal(cityGeography("Ville de Namur - Cohésion sociale","Wallonia"),"Namur");
assert.equal(cityGeography("City of Ghent","Ghent"),"Ghent");assert.equal(cityGeography("Statbel","Belgium"),"Belgium");
// text
assert.equal(cutText("one two three four five",14),"one two three…");assert.equal(cutText("short",10),"short");
assert.equal(htmlToText('domaines de l\'article 83. - § 1er. du <a href="https://www.gall'),"domaines de l'article 83. - § 1er. du");
assert.equal(htmlToText("<p>Caf&eacute; &amp; bar&nbsp;</p>"),"Café & bar");
// links
assert.equal(httpsLink("http://walstat.iweps.be/x?a=1"),"https://walstat.iweps.be/x?a=1");assert.equal(httpsLink("http://unknown.example/x"),"http://unknown.example/x");
assert.equal(landingPage({subject:"http://data.gov.be/.well-known/genid/dataset/ucl/doi-10-14428/DVN/1BKFA6",identifier:"doi:10.14428/DVN/1BKFA6"}),"https://doi.org/10.14428/DVN/1BKFA6");
assert.equal(landingPage({subject:"http://data.gov.be/.well-known/genid/29dcb21a",distributions:[{url:"https://gisel.naturalsciences.be/ows"}]}),"https://gisel.naturalsciences.be/ows","never a blank-node IRI");
assert.equal(landingPage({landingPage:"https://statbel.fgov.be/x",subject:"https://ex/ds"}),"https://statbel.fgov.be/x");
// formats
for(const [raw,want] of [["ESRI Shapefile (.shp)","Shapefile"],["Esri Shapefile Esri Shapefile","Shapefile"],["OGC GeoPackage (.gpkg)","GeoPackage"],["TIFF (.tif, .tiff)","GEOTIFF"],
  ["TIFF TIFF","GEOTIFF"],["CSV CSV","CSV"],["Comma Separated Value (.csv)","CSV"],["application/xml","XML"],["x c","Source code"],["octet stream","BIN"],["ESRI File Geodatabase (.fgdb)","File Geodatabase"],
  ["GML (.gml)","GML"],["REST/JSON","REST/JSON"],["Explore API 2.1","Explore API 2.1"],["WMS","WMS"],["download/service","download/service"]])assert.equal(formatLabel(raw),want,raw);
// index document
const doc=toDocs({id:"national:x",title:"T",provider:"City of Namur",geoCoverage:"Wallonia",frequency:"b6d53d524c494e5a9b37bec45c748bf7242-3958c17a2fbce11e",updatedAt:"Invalid Da",
  temporal:{start:"2012-03-21",end:"9999-01-01"},officialUrl:"http://walstat.iweps.be/a",description:"word ".repeat(200),
  license:"•The custodian of the resource holds the rights of property (including the rights of reproduction) of the data, and grants a licence."},null);
assert.equal(doc.light.l,"Publisher's own terms (see source)");assert.match(doc.detail.lt,/^•The custodian/);
assert.equal(doc.detail.g,"Namur");assert.equal(doc.detail.fq,"");assert.equal(doc.light.u,"");assert.equal(doc.light.w,"https://walstat.iweps.be/a");
assert.deepEqual(doc.detail.tc,{s:"2012-03-21",e:null,pe:"9999-01-01"});assert.deepEqual(doc.light.y,[2012,Y]);
assert.ok(doc.detail.d.endsWith("…")&&doc.detail.d.length<=600);assert.ok(doc.light.s.endsWith("…"));
// measured period only from a whole-file read
const docs=[{id:"p"}];assert.equal(backfillDocs(docs,new Map([["p",{file:{rows_exact:false},coverage:{time:{from:"2026",to:"2026"}}}]])),0);
console.log("metadata clean tests passed");
