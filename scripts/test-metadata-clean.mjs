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

/* ---------- round 3: what browsing the site showed ---------- */
import { catalogueNameFor, curatedPeriod, inheritCuratedLicences } from "./build-mcp-index.mjs";
import { detectSeries } from "./curate.mjs";
const P=a=>{const p=curatedPeriod(a);return p?(p.start||"").slice(0,4)+".."+(p.end?p.end.slice(0,4):"open"):"-"};
assert.equal(P({time:"reference year 2026"}),"2026..2026");
assert.equal(P({time:"CPI since 1920; health index since 1994; monthly series"}),"1920..open","'since' is open-ended, not 1920-1994");
assert.equal(P({time:"dataset revision metadata; page shows last revision 2013-05-14"}),"-","a revision date is not coverage");
assert.equal(P({time:"scenario horizons around 2050 and 2100"}),"-");
assert.equal(P({time:"monthly statistics; current series published through 2026"}),"-","an end without a start");
assert.equal(P({time:"realtime",title:"Geolocation of road traffic accidents — 2017–2024"}),"2017..2024","title year when the time field has none");
assert.equal(P({time:"current register state",title:"Address by objectId, v2"}),"-");
assert.equal(catalogueNameFor("Statbel, Belgian statistical office",new Set(["Statbel","Statbel Open Data X"])),"Statbel");
assert.equal(catalogueNameFor("Digitaal Vlaanderen",new Set(["Digitaal Vlaanderen: Perceelblokken"])),"","a longer product name is not the publisher");
const recs=[...Array(24)].map((_,i)=>({id:"national:s"+i,provider:"Statbel",license:"CC BY",licenseFamily:"open",officialUrl:"https://statbel.example/"+i}));
const geo={id:"harvest:geo-be:x",provider:"National Geographic Institute (NGI)",license:"https://statbel.example/open-data",licenseFamily:"custom",officialUrl:"https://statbel.example/pop"};
const cur={id:"curated:pop",curated:true,provider:"Statbel, Belgian statistical office",license:"",officialUrl:"https://statbel.example/pop"};
const out=inheritCuratedLicences([...recs,geo,cur]).find(x=>x.id==="curated:pop");
assert.equal(out.license,"CC BY","the publisher's own licence, not another catalogue's record of the same page");
assert.equal(out.licenseFrom,"publisher:Statbel");assert.equal(out.licenseShare,100);
// series: editions differ only in numbers or months; different tables are not editions
const mk=(t,i)=>({id:"x"+i,provider:"Statbel",title:t});
const s1=detectSeries([2015,2016,2017,2018,2019,2020].map((y,i)=>mk("First names of the total population by municipality, "+y,i)));
assert.equal(s1.length,1);assert.equal(s1[0].title,"First names of the total population by municipality");
const s2=detectSeries(["Geslacht en Leeftijd (M)","Geslacht en Burgerlijke staat (L)","Geslacht en Positie in het huishouden (M)","Geslacht en Geboorteplaats (L)","Geslacht en Land van staatsburgerschap (L)"].map((t,i)=>mk("Census 2021 - Bevolking naar: Verblijfplaats (Gemeente), "+t,i)));
assert.equal(s2.length,0,"five different census tables are not one series");
const s3=detectSeries(["januari","februari","maart","april","mei"].map((m,i)=>mk("Vlaamse Hydrografische Atlas - Waterlopen, "+m+" 2023",i)));
assert.equal(s3.length,1);assert.equal(s3[0].title,"Vlaamse Hydrografische Atlas - Waterlopen");
console.log("round 3 tests passed");
// a finished period is complete, not stale; a city's portal covers the city; "2013-now" runs to today
import { finishedPeriod, freshness } from "../public/dataset-trust-v1.mjs";
import { inferDatasetBrief } from "../public/dataset-discovery-intelligence-v1.mjs";
assert.equal(finishedPeriod({title:"Fietstelpaal Groendreef 2020 Gent"}),"2020");
assert.equal(finishedPeriod({title:"Air quality 2013-now"}),null);assert.equal(finishedPeriod({title:"Monthly data"}),null);
assert.equal(finishedPeriod({period:{start:"2015-01-01",end:"2019-12-31"}}),"2015–2019");assert.equal(finishedPeriod({period:{start:"2015-01-01",end:null}}),null);
assert.equal(freshness({title:"Census 2021 - Bevolking",updatedAt:"2022-01-01"}).state,"static");
assert.equal(freshness({title:"Census 2021",frequency:"ANNUAL",updatedAt:"2022-01-01"}).state,"stale","a declared cycle still counts");
assert.equal(inferDatasetBrief({title:"Fietstelpaal Groendreef",provider:"City of Ghent"}).geography,"Ghent");
assert.equal(inferDatasetBrief({title:"Air Quality download service, 2013-now"}).time,"2013–"+Y);
assert.equal(inferDatasetBrief({title:"Consumer price index",description:"CPI base 1920, health index 1994"}).time,"not clearly stated","description years are not coverage");
console.log("round 3b tests passed");
// round 4: harvested names as the site shows them
assert.equal(canonicalPublisher("Administration Générale de la Documentation Patrimoniale (SPF Finances - AGDP)"),"FPS Finance");
assert.equal(canonicalPublisher("Brussels Mobility: Active mobility"),"Brussels Mobility");
{const xs=[{provider:"BeWaPP"},{provider:"BeWaPP"},{provider:"Be WaPP asbl"},{provider:"Agence du Numérique"},{provider:"Agence du Numérique"},{provider:"Agence du Numérique (AdN)"}];
 unifyPublisherNames(xs);assert.deepEqual([...new Set(xs.map(x=>x.provider))],["BeWaPP","Agence du Numérique"])}
console.log("round 4 tests passed");
// hand-reviewed links in the weekly link check
import { curatedFormat, curatedProbeUrl, loadCuratedWork } from "./probe-links.mjs";
assert.equal(curatedFormat("CSV","https://opendata.apps.mow.vlaanderen.be/fietstellingen/index.html"),"PAGE","a landing page listed as CSV is a page");
assert.equal(curatedFormat("CSV","https://opendata.apps.mow.vlaanderen.be/fietstellingen/sites.csv"),"CSV");
assert.equal(curatedFormat("CSV","https://data.stad.gent/explore/dataset/x/download/?format=csv"),"CSV");
assert.equal(curatedProbeUrl("https://api.basisregisters.vlaanderen.be/v2/percelen/{objectId}"),null,"an API template is not a link to check");
assert.equal(curatedProbeUrl("https://geo.api.vlaanderen.be/MeetplOppervlwaterkwal/wfs"),"https://geo.api.vlaanderen.be/MeetplOppervlwaterkwal/wfs?service=WFS&request=GetCapabilities");
assert.equal(curatedProbeUrl("https://statbel.fgov.be/en/open-data/x"),"https://statbel.fgov.be/en/open-data/x");
assert.ok((await loadCuratedWork()).length>=100,"the atlas links are in the weekly check");
console.log("curated link check tests passed");
// measured columns, searchable column names, portal slug as publisher evidence
import { annotateItems as annotate, loadColumns } from "./apply-link-health.mjs";
import { columnTokens } from "./build-mcp-index.mjs";
import { inferPublishers as infer } from "./national-dcat.mjs";
import os from "node:os";import fsx from "node:fs";import pathx from "node:path";
{const f=pathx.join(fsx.mkdtempSync(pathx.join(os.tmpdir(),"cols-")),"probe.jsonl");
 fsx.writeFileSync(f,JSON.stringify({url:"https://p.example/a.csv",profile:{rows:5,columns:[{name:"code_postal",type:"postcode"},{name:"nb",type:"integer"}]}})+"\n");
 const cols=loadColumns([f]),it={distributions:[{url:"https://p.example/a.csv",format:"CSV"}]},declared={fields:[{name:"x"}],distributions:[{url:"https://p.example/a.csv"}]};
 annotate([it,declared],new Map(),cols);
 assert.deepEqual(it.fields.map(c=>c.name),["code_postal","nb"]);assert.equal(it.schemaOrigin,"observed-file-header");
 assert.deepEqual(declared.fields.map(c=>c.name),["x"],"declared columns are never replaced")}
assert.deepEqual(columnTokens(["geo_point_2d","code_postal","id","NACE_code"]).filter(t=>!t.startsWith("~")),["code","postal","nace"]);
{const xs=[{provider:"Fluvius",officialUrl:"https://opendata.fluvius.be/explore/dataset/1_21-aangemelde-oplaadpunten-voor-ev/"},
  {provider:"data.gov.be source",officialUrl:"https://www.vlaanderen.be/x",distributions:[{url:"https://fluvius.opendatasoft.com/api/v2/catalog/datasets/1_21-aangemelde-oplaadpunten-voor-ev/exports/csv"}]},
  {provider:"A",officialUrl:"https://a.example/explore/dataset/communes-belges-2024/"},{provider:"B",officialUrl:"https://b.example/explore/dataset/communes-belges-2024/"},
  {provider:"data.gov.be source",officialUrl:"https://c.example/explore/dataset/communes-belges-2024/"}];
 infer(xs);assert.equal(xs[1].provider,"Fluvius");assert.equal(xs[1].publisherInferredFrom,"slug");
 assert.equal(xs[4].provider,"data.gov.be source","a slug two publishers use names neither")}
console.log("measured columns tests passed");
// copies of one portal dataset share a collection id; an unnamed copy takes its publisher; a real series is kept
import { groupPortalCopies, portalSlug } from "./metadata-clean.mjs";
{const u="https://opendata.fluvius.be/explore/dataset/1_35-aantal-klachten-fluvius/";
 const xs=[{id:"a",provider:"Fluvius",officialUrl:u},{id:"b",provider:"data.gov.be source",distributions:[{url:"https://fluvius.opendatasoft.com/api/v2/catalog/datasets/1_35-aantal-klachten-fluvius/exports/csv"}]},
  {id:"c",provider:"Fluvius",officialUrl:u,seriesId:"series:x"},{id:"d",provider:"Other",officialUrl:"https://x.example/explore/dataset/another-dataset-slug/"}];
 assert.equal(portalSlug(u),"1_35-aantal-klachten-fluvius");
 groupPortalCopies(xs);
 assert.ok(xs[0].seriesId?.startsWith("copy:"));assert.equal(xs[0].seriesId,xs[1].seriesId);assert.equal(xs[1].provider,"Fluvius");assert.equal(xs[2].seriesId,"series:x");assert.equal(xs[3].seriesId,undefined);
 const two=[{provider:"A",officialUrl:"https://a.example/explore/dataset/communes-belges-2024/"},{provider:"B",officialUrl:"https://b.example/explore/dataset/communes-belges-2024/"}];
 groupPortalCopies(two);assert.ok(two.every(x=>!x.seriesId),"two publishers with one slug are not copies")}
console.log("portal copies tests passed");
// the publisher's metadata vs the file: disagreements, trust summary, licences of copies
import { buildCard } from "./dataset-card.mjs";
import { profileColumns } from "./dataset-card.mjs";
import { trustSummary } from "../mcp-server.mjs";
import { copyLicences } from "./build-mcp-index.mjs";
{const csv="periode;commune;valeur\n"+[2021,2022,2023].flatMap(y=>["Namur","Liège"].map((c,i)=>y+";"+c+";"+(i+1))).join("\n")+"\n";
 const p=profileColumns(csv,{bytesRead:csv.length,totalBytes:csv.length});
 const c=buildCard({id:"w",title:"Indicateur 2019",updatedAt:"2026-11-17"},p,{now:"2026-11-17T00:00:00Z",file:{}});
 const kinds=c.disagreements.map(d=>d.kind);
 assert.ok(!kinds.includes("catalogue_date_newer_than_data"),"catalogue modification does not imply a new reporting period");
 assert.ok(c.facts.some(f=>f.text==="Catalogue last updated: 2026-11-17."));
 assert.ok(kinds.includes("title_year_not_in_file"),"title 2019, file 2021-2023");
 const c2=buildCard({id:"w2",title:"Indicateur",updatedAt:"2024-01-10",declaredPeriod:{s:"2010-01-01",e:"2015-12-31"}},p,{now:"2026-11-17T00:00:00Z",file:{}});
 assert.deepEqual(c2.disagreements.map(d=>d.kind),["declared_period_not_in_file"]);
 const partial=profileColumns(csv,{bytesRead:csv.length,totalBytes:csv.length*10});
 assert.equal(buildCard({id:"w3",title:"Indicateur 2019",updatedAt:"2026-11-17"},partial,{now:"2026-11-17T00:00:00Z",file:{}}).disagreements.length,0,"a partial read never claims a disagreement");
 const t=trustSummary({l:"CC BY",u:"2026-11-17"},{pr:{ok:1,n:1,at:"2026-11-15",mm:0}},{profiled_at:"2026-11-17",file:{rows:6,rows_exact:true},columns:[1,2,3],coverage:{time:{from:"2021",to:"2023",column:"periode"}},disagreements:c.disagreements,freshness:{}},{from:"2021",to:"2023",column:"periode"});
 assert.ok(t.checked_by_this_service.some(s=>/Whole file read/.test(s)));assert.ok(t.stated_by_publisher_only.some(s=>/^Licence: CC BY/.test(s)));assert.equal(t.disagreements.length,1);
 assert.match(trustSummary({},{},null,null).checked_by_this_service[0],/^Nothing/)}
{const xs=[{id:"a",seriesId:"copy:1",license:"CC BY"},{id:"b",seriesId:"copy:1",license:""},{id:"c",seriesId:"copy:2",license:"CC0"},{id:"d",seriesId:"copy:2",license:"CC BY-NC"}];
 copyLicences(xs);assert.equal(xs[1].license,"CC BY");assert.equal(xs[1].licenseFrom,"a");
 assert.ok(xs[2].licenceConflict&&xs[3].licenceConflict,"open vs non-commercial copies are both flagged");assert.equal(xs[3].license,"CC BY-NC","a conflict is shown, not resolved")}
console.log("trust tests passed");
// trust polish: a description comparing regions is not about one of them; public domain needs no attribution
{const b=inferDatasetBrief({title:"Taux de chômage BIT de WalStat",description:"fiables au niveau des régions (Wallonie, Flandre, Bruxelles)"});assert.equal(b.geography,"Wallonia");
 assert.equal(inferDatasetBrief({title:"X",description:"Wallonie, Flandre et Bruxelles"}).geography,"not clearly stated")}
{const {trustChecks}=await import("../public/dataset-trust-v1.mjs");assert.match(trustChecks({license:"CC0 1.0"}).find(c=>c.id==="licence").detail,/no attribution required/)}
console.log("trust polish tests passed");
