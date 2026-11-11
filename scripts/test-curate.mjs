import assert from "node:assert/strict";
import { sniff } from "./probe-links.mjs";
import { SCOPES, TOPIC_LABELS as SHARED_TOPIC_LABELS, inScope, scopeCounts, scopeOf } from "../public/dataset-taxonomy-v1.mjs";
import { accessTier, detectSeries, freshness, interpretProbe, kindOf, normalizeLicense, resolveSpatial, seriesTemplate, summarizeChecks, topicOf, trustChecks } from "./curate.mjs";

// licences: the Flemish model licence URI used to surface as the bare string "v1.0"
const flemish=normalizeLicense("http://data.vlaanderen.be/id/licentie/modellicentie-gratis-hergebruik/v1.0");
assert.equal(flemish.family,"open");assert.match(flemish.label,/Flemish free-reuse/);
assert.equal(normalizeLicense("http://publications.europa.eu/resource/authority/licence/CC_BY_4_0").label,"CC BY");
assert.equal(normalizeLicense("http://publications.europa.eu/resource/authority/licence/CC0").family,"open");
assert.equal(normalizeLicense("http://publications.europa.eu/resource/authority/licence/CC_BYNC_4_0").family,"non-commercial");
assert.equal(normalizeLicense("http://publications.europa.eu/resource/authority/licence/CC_BYNCSA_4_0").family,"non-commercial");
assert.equal(normalizeLicense("http://publications.europa.eu/resource/authority/licence/CC_BYSA_4_0").family,"open-sharealike");
assert.equal(normalizeLicense("http://publications.europa.eu/resource/authority/licence/CC_BYND_4_0").family,"no-derivatives");
assert.equal(normalizeLicense("https://www.elia.be/en/grid-data/elia-open-data-license").family,"custom");
assert.equal(normalizeLicense("").family,"unknown");
// labels produced by this very module must normalise back to the same id (the browser and SEO pages re-read them)
for(const [label,id] of [["CC BY","cc-by"],["CC BY-SA","cc-by-sa"],["CC BY-NC","cc-by-nc"],["CC BY-NC-SA","cc-by-nc-sa"],["CC BY-NC-ND","cc-by-nc-nd"],["CC BY-ND","cc-by-nd"],["CC0 (public domain)","cc0"],["ODC-BY","odc-by"]])assert.equal(normalizeLicense(label).id,id,label);
assert.equal(normalizeLicense("Modellicentie Gratis Hergebruik").family,"open");   // ODS portals write it with spaces
assert.equal(normalizeLicense("Some publisher terms").family,"custom");

// places: GeoNames / MarineRegions IDs must resolve instead of leaking as numbers
assert.deepEqual(resolveSpatial("https://sws.geonames.org/3337388/"),{label:"Flanders",scope:"flanders"});
assert.equal(resolveSpatial("https://sws.geonames.org/2802361/").label,"Belgium");
assert.equal(resolveSpatial("http://marineregions.org/mrgid/3293").scope,"sea");
assert.equal(resolveSpatial("http://data.gov.be/.well-known/genid/spatial/abc").label,"");

// kinds: only claims that the record's own distributions support
const d=(format,url="https://x.example/"+format)=>({format,url});
assert.equal(kindOf({id:"national:a",title:"Population",distributions:[d("CSV"),d("PDF")]}),"dataset");
assert.equal(kindOf({id:"national:b",title:"Layer",distributions:[d("WMS"),d("WFS"),d("KML")]}),"map-service");
assert.equal(kindOf({id:"national:c",title:"Weekbericht 12",distributions:[d("PDF")]}),"publication");
assert.equal(kindOf({id:"national:d",title:"Replication Data for: A paper",distributions:[d("CSV")]}),"research");
assert.equal(kindOf({id:"national:doi:10.48804/ABC",title:"Trajectory files",distributions:[d("ZIP")]}),"research");
assert.equal(kindOf({id:"national:e",title:"Nothing",distributions:[]}),"metadata-only");

// tiers: only a successful probe earns READY; a failed probe must not hide a still-possible download
const tabular={id:"x",distributions:[d("CSV","https://a.example/x.csv")]};
assert.equal(accessTier(tabular,{}),"download");
assert.equal(accessTier(tabular,{"https://a.example/x.csv":{ok:true,formatMatch:true}}),"ready");
assert.equal(accessTier(tabular,{"https://a.example/x.csv":{ok:true,formatMatch:false}}),"download");
assert.equal(accessTier(tabular,{"https://a.example/x.csv":{ok:false}}),"broken");
assert.equal(accessTier({distributions:[d("WMS")]},{}),"service");
assert.equal(accessTier({distributions:[d("PDF")]},{}),"document");
assert.equal(accessTier({distributions:[]},{}),"metadata");

// series: numbered periodicals and model-code layers collapse; unrelated titles never do
const statbel=Array.from({length:12},(_,i)=>({id:"s"+i,provider:"Statbel",title:"Weekbericht "+(3000+i)}));
const dov=["G3Dv3.1 010201, isohypsen van top Ld","G3Dv3 0309, isohypsen van basis Fm","G3Dv3.1 020401, voorkomen van Lid","G3Dv3 030803, breuken","G3Dv3.1 0402, dikte"].map((title,i)=>({id:"d"+i,provider:"DOV",title}));
const lone=[{id:"l1",provider:"Statbel",title:"House price index"},{id:"l2",provider:"Statbel",title:"Cinemas"}];
const series=detectSeries([...statbel,...dov,...lone]);
assert.equal(series.length,2);
assert.ok(series.find(s=>s.title==="G3D model layers"&&s.count===5));
assert.ok(series.find(s=>/^Weekbericht/.test(s.title)&&s.count===12));
assert.ok(!series.some(s=>s.memberIds.includes("l1")));
assert.equal(seriesTemplate("G3Dv3.1 010201, x"),"code g3d");
// two different series whose truncated slugs would collide must still get distinct ids
const long="Overstromingsrisico gebiedsbeheer ".repeat(3);
const twoSeries=detectSeries([...Array.from({length:5},(_,i)=>({id:"a"+i,provider:"Flanders Environment Agency",title:long+"alpha beta "+i})),...Array.from({length:5},(_,i)=>({id:"b"+i,provider:"Flanders Environment Agency",title:long+"gamma delta "+i}))]);
assert.equal(new Set(twoSeries.map(s=>s.id)).size,twoSeries.length,"series ids are unique");

// topics: publisher-declared EU theme wins; publisher name never leaks into keyword matching
assert.equal(topicOf({title:"Teleworking days",provider:"Infrabel",euThemes:["TRAN"]}),"transport");
assert.equal(topicOf({title:"Aantal erfloze nalatenschappen",provider:"FPS Finance",euThemes:["ECON","GOVE"]}),"economy");
assert.equal(topicOf({title:"Weekbericht 5",provider:"Statbel",euThemes:["TECH"]}),"other");
// ENVI is a catch-all: a title that is clearly about energy, water or soil wins; emissions and climate stay environment
assert.equal(topicOf({title:"Renewable energies in the Brussels-Capital Region",provider:"Brugel",euThemes:["ENVI"]}),"energy");
assert.equal(topicOf({title:"INSPIRE - Hydrographie en Wallonie (BE)",provider:"SPW",euThemes:["ENVI"]}),"water");
assert.equal(topicOf({title:"Greenhouse gas emissions (i65)",provider:"Brussels Environment",euThemes:["ENVI"]}),"environment");
assert.equal(topicOf({title:"Wind speed - 2085",provider:"Belgian Climate Centre",euThemes:["ENVI"]}),"environment");
assert.equal(topicOf({title:"Natura 2000 sites",provider:"ANB",euThemes:["ENVI"]}),"environment");
assert.equal(topicOf({title:"T02Kd Formatie van Kattendijk",provider:"Databank Ondergrond Vlaanderen (DOV)",euThemes:["TECH","REGI"]}),"geology");
assert.equal(topicOf({title:"Gemeentegrenzen",provider:"NGI",euThemes:["GOVE","REGI"]}),"places");
assert.equal(topicOf({title:"Zonne-energie installaties",provider:"X",euThemes:[]}),"energy");
// publisher defaults match whole words only ("Protec" is not TEC, "Belia" is not Elia)
assert.equal(topicOf({title:"Dienstverlening",provider:"Protec Services",euThemes:[]}),"other");
assert.equal(topicOf({title:"Layer",provider:"Belia Foundation",euThemes:[]}),"other");
assert.equal(topicOf({title:"Layer",provider:"Elia",euThemes:[]}),"energy");

// freshness is judged against the publisher's own declared cycle, and says it is metadata-only
const NOW=Date.parse("2026-10-01");
assert.equal(freshness({updatedAt:"2026-09-28",frequency:"DAILY"},NOW).state,"current");
assert.equal(freshness({updatedAt:"2025-01-01",frequency:"DAILY"},NOW).state,"stale");
assert.equal(freshness({updatedAt:"2020-01-01",frequency:"NEVER"},NOW).state,"static");
assert.equal(freshness({updatedAt:"2020-01-01",frequency:"IRREG"},NOW).state,"old");
assert.equal(freshness({frequency:"ANNUAL"},NOW).state,"unknown");
assert.match(freshness({updatedAt:"2026-09-28",frequency:"DAILY"},NOW).note,/metadata date/);

// trust checks never convert "unknown" into a pass
const item={id:"national:t",provider:"Statbel",title:"T",officialUrl:"https://statbel.fgov.be/x",contactEmail:"a@b.be",licenseUri:"http://publications.europa.eu/resource/authority/licence/CC_BY_4_0",updatedAt:"2026-09-20",frequency:"MONTHLY",distributions:[d("CSV","https://a.example/t.csv")]};
const unprobed=trustChecks(item,{health:{},now:NOW}),byId=Object.fromEntries(unprobed.map(c=>[c.id,c]));
assert.equal(byId.access.status,"unknown");assert.equal(byId.structure.status,"unknown");assert.equal(byId.licence.status,"pass");assert.equal(byId.freshness.status,"pass");
assert.ok(!unprobed.some(c=>c.id==="format"));
const probed=trustChecks(item,{health:{"https://a.example/t.csv":{ok:true,formatMatch:false}},now:NOW});
assert.equal(probed.find(c=>c.id==="access").status,"pass");assert.equal(probed.find(c=>c.id==="format").status,"warn");
const missing=trustChecks({id:"m",title:"M",distributions:[]},{now:NOW});
assert.equal(missing.find(c=>c.id==="licence").status,"fail");
assert.equal(summarizeChecks(unprobed).total,unprobed.length);

// probe interpretation: HTML or a spreadsheet served as .csv is a format mismatch, not a success
assert.equal(interpretProbe({fmt:"CSV",status:206,sniff:"delimited"}).formatMatch,true);
assert.equal(interpretProbe({fmt:"CSV",status:200,sniff:"html"}).formatMatch,false);
assert.equal(interpretProbe({fmt:"CSV",status:200,sniff:"zip/xlsx"}).formatMatch,false);
assert.equal(interpretProbe({fmt:"XLSX",status:200,sniff:"zip/xlsx"}).formatMatch,true);
assert.equal(interpretProbe({fmt:"CSV",status:404}).ok,false);
assert.equal(interpretProbe({fmt:"CSV",error:"ECONNRESET"}).ok,false);

// byte sniffing behind the probe: what the file really is, regardless of what the catalogue claims
assert.equal(sniff(Buffer.from("id,name\n1,a\n")),"delimited");
assert.equal(sniff(Buffer.from("<!DOCTYPE html><html><body>Login</body></html>")),"html");
assert.equal(sniff(Buffer.from([0x50,0x4b,3,4,0,0])),"zip/xlsx");
assert.equal(sniff(Buffer.from("PAR1xxxx")),"parquet");
assert.equal(sniff(Buffer.from('{"a":1}')),"json");
assert.equal(sniff(Buffer.from('<?xml version="1.0"?><r/>')),"xml");

// shared taxonomy: every topic the classifier can emit has a label; scopes partition the catalogue
for(const id of ["geology","water","energy","transport","health","population","economy","environment","agriculture","education","government","places","other"])assert.ok(SHARED_TOPIC_LABELS[id],"missing label "+id);
const sample=[{dataKind:"dataset"},{},{dataKind:"map-service"},{dataKind:"publication"},{dataKind:"research"},{dataKind:"metadata-only"},{dataKind:"dataset"}];
const counts=scopeCounts(sample);
assert.equal(counts.datasets,3);assert.equal(counts.maps,1);assert.equal(counts.all,7);
assert.equal(SCOPES.filter(s=>s.id!=="all").reduce((n,s)=>n+counts[s.id],0),counts.all,"scopes must partition the catalogue");
assert.equal(scopeOf({}),"datasets");assert.equal(inScope({dataKind:"publication"},"datasets"),false);assert.equal(inScope({dataKind:"publication"},"all"),true);

// compact per-record probe summary (as shipped in the catalogue) feeds the same checks
const withProbe=trustChecks({...item,probe:{at:"2026-10-02",n:2,ok:1,mm:1,cors:1}},{now:NOW});
assert.equal(withProbe.find(c=>c.id==="access").status,"warn");assert.match(withProbe.find(c=>c.id==="access").detail,/1 of 2.*2026-10-02/);
assert.equal(withProbe.find(c=>c.id==="format").status,"warn");
assert.equal(trustChecks({...item,licenseFamily:"non-commercial",license:"CC BY-NC"},{now:NOW}).find(c=>c.id==="licence").status,"warn");

console.log("curate tests passed");
