// Offline tests for belgian_statistics, air_quality and flood_risk (statbel.mjs, air.mjs, flood.mjs, place.mjs). Statistics run on the
// committed Statbel tables; upstream services are faked with answers shaped like the real ones (scripts/live-dov.mjs checks the real ones).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { lambert72ToWgs84, makeDovClient, splitAddress, wgs84ToLambert72 } from "../dov.mjs";
import { belgianStatistics, municipalitySummary, unzipFirst } from "../statbel.mjs";
import { airQuality } from "../air.mjs";
import { floodRisk } from "../flood.mjs";

const pub=path.join(path.dirname(fileURLToPath(import.meta.url)),"..","public");
const assets={json:async p=>{try{return JSON.parse(fs.readFileSync(path.join(pub,p),"utf8"))}catch{return null}}};

// ---------- coordinates and addresses ----------
const [x,y]=wgs84ToLambert72(50.6448139,5.5743764),[la,lo]=lambert72ToWgs84(x,y);
// within 1.5 m of BeSt's own Lambert 72 position (BeSt's transformation differs from the 7-parameter Helmert by under a metre in
// Wallonia; the Flemish geolocation service agrees with ours to the centimetre, see test-dov.mjs)
assert.ok(Math.abs(x-235267.50)<1.5&&Math.abs(y-148934.59)<1.5,"Liège matches BeSt's Lambert 72 position");
assert.ok(Math.abs(la-50.6448139)<1e-6&&Math.abs(lo-5.5743764)<1e-6,"round trip");
assert.deepEqual(splitAddress("Place Saint-Lambert 1, 4000 Liège"),{street:"Place Saint-Lambert",number:"1",postcode:"4000",municipality:"Liège"});
assert.deepEqual(splitAddress("Rue de Fer 12b, Namur"),{street:"Rue de Fer",number:"12b",postcode:null,municipality:"Namur"});
assert.equal(splitAddress("Leuven"),null);

// ---------- the Statbel tables themselves ----------
const T=await assets.json("/statbel/totals-v1.json"),P=await assets.json("/statbel/places-v1.json");
assert.equal(Object.keys(P.places).length,565,"565 municipalities since 1 January 2025");
for(const yr of T.BE.pop.map(r=>r[0]))assert.equal(["02000","03000","04000"].reduce((s,k)=>s+T[k].pop.find(r=>r[0]===yr)[1],0),T.BE.pop.find(r=>r[0]===yr)[1],"regions add up in "+yr);
assert.equal(T.BE.pop.find(r=>r[0]===2026)[1],11867634,"Belgium on 1 January 2026, as on be.STAT");
assert.equal(T.BE.income.find(r=>r[0]===2023)[1],6846186,"declarations 2023, as on be.STAT");

// ---------- belgian_statistics ----------
const S=a=>belgianStatistics(makeDovClient({fetchImpl:async()=>new Response("",{status:599})}),a,{assets});
const leuven=await S({places:["Leuven"]});
assert.deepEqual(leuven.places.map(p=>p.place.split(" / ")[0]),["Leuven","Provincie Vlaams-Brabant","Vlaams Gewest","Belgium"],"a municipality comes with its context");
assert.equal(leuven.places[0].nis_code,"24062");assert.equal(leuven.places[0].pop.reference_date,"2026-01-01");
assert.match(leuven.key_facts[0],/^Leuven \/ Louvain: 105,357 inhabitants on 2026-01-01/);
assert.match(leuven.provenance.citation,/^Statbel \(DG Statistics – Statistics Belgium\), .* CC BY 4\.0, retrieved \d{4}-\d{2}-\d{2}\.$/);
// pre-merger names, both languages, NIS codes, dedup, the City vs the Region of Brussels, province vs namesake municipality
const m=await S({places:["Melle"],topic:"population",with_context:false});assert.equal(m.places[0].nis_code,"44088");assert.match(m.places[0].note,/Melle merged into this municipality on 1 January 2025/);
assert.equal((await S({places:["Liège","Luik","62063"],topic:"population",with_context:false})).places.length,1);
assert.equal((await S({places:["Brussels"],topic:"population",with_context:false})).places[0].type,"region");
assert.equal((await S({places:["City of Brussels"],topic:"population",with_context:false})).places[0].nis_code,"21004");
const lim=await S({places:["Limburg"],topic:"population",with_context:false});assert.equal(lim.places[0].type,"province");assert.match(lim.places[0].note,/NIS 63046/);
assert.equal((await S({places:["gemeente Limburg"],topic:"population",with_context:false})).places[0].nis_code,"63046");
assert.equal((await S({places:["Antwerpen"],topic:"population",with_context:false})).places[0].type,"municipality");
// a merged municipality's history is the sum of its parts (Merelbeke 25,229 + Melle 11,981 on 1 January 2024)
assert.deepEqual(m.places[0].pop.series.find(r=>r[0]===2024),[2024,37210]);
// rankings: income per inhabitant in the province of Limburg (Hasselt includes Kortessem, merged in 2025)
const rk=await S({rank_by:"income_per_inhabitant",within:"Limburg",limit:3});
assert.equal(rk.within,"Provincie Limburg / Province de Limbourg");assert.equal(rk.municipalities_compared,Object.values(P.places).filter(p=>p.prov==="70000").length);
assert.ok(rk.results[0].value>=rk.results[1].value);
const has=(await S({places:["Hasselt"],topic:"income",with_context:false})).places[0].income;
assert.equal(has.average_net_taxable_income_per_inhabitant_eur,26226,"(2,127,572,222 + 221,885,020) / (80,828 + 8,757)");
for(const [bad,re] of [[{places:["Leuvn"]},/Did you mean: Leuven/],[{places:["Leuven"],year:2010},/available for 2019/],[{rank_by:"wealth"},/rank_by must be/],[{rank_by:"population",within:"Leuven"},/within must be/],[{topic:"weather"},/topic must be/]])
  assert.match((await S(bad)).error,re,JSON.stringify(bad));
// no places: 'population' ranks Belgium's municipalities by population, 'income' by income per inhabitant, the default profile is Belgium's
const natPop=await S({topic:"population"});assert.equal(natPop.topic,"ranking");assert.match(natPop.defaulted_to,/by population/);assert.equal(natPop.results[0].municipality.split(" / ")[0],"Antwerpen");
assert.ok(natPop.results[0].value>=natPop.results[1].value);
assert.match((await S({topic:"income"})).defaulted_to,/income per inhabitant/);
const prof=await S({});assert.equal(prof.places[0].type,"country");assert.ok(!prof.defaulted_to);
const sum=await municipalitySummary(assets,"Brussel");assert.equal(sum.nis_code,"21004","a geocoder's municipality name is the municipality");

// prices: Statbel's CPI file (a zip), current base = the one with the published inflation rate for the latest month
function zip(name,text){
  const data=zlib.deflateRawSync(Buffer.from(text)),n=Buffer.from(name);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(8,8);local.writeUInt32LE(data.length,18);local.writeUInt16LE(n.length,26);
  const cd=Buffer.alloc(46);cd.writeUInt32LE(0x02014b50,0);cd.writeUInt16LE(8,10);cd.writeUInt32LE(data.length,20);cd.writeUInt16LE(n.length,28);cd.writeUInt32LE(0,42);
  const cdOff=30+n.length+data.length,eocd=Buffer.alloc(22);eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt32LE(46+n.length,12);eocd.writeUInt32LE(cdOff,16);
  return Buffer.concat([local,n,data,cd,n,eocd]);
}
const CPI="﻿NM_YR|NM_MTH|MS_CPI_IDX|MS_CPI_INFL|MS_WT_CPI|MS_HLTH_IDX|_FREQ_|NM_BASE_YR|MS_WTHOUT_ENE_IDX|MS_WITHOUT_PTRL_IDX|MS_SMOOTH_IDX\n"+
  "2026|9|142.10000000|.|1000|141.50000000|.|2013|140.00000000|143.00000000|137.50000000\n2026|9|105.00000000|5.10%|1000|104.30000000|.|2025|103.00000000|104.00000000|101.50000000\n"+
  "2026|10|174.50000000|.|1000|171.39000000|.|2004|.|.|.\n2026|10|142.57000000|.|1000|141.91000000|.|2013|140.31000000|143.28000000|137.90000000\n2026|10|105.37000000|5.26%|1000|104.68000000|.|2025|103.17000000|104.36000000|101.72000000\n";
assert.equal(await unzipFirst(new Uint8Array(zip("CPI.txt",CPI))),CPI.slice(1),"zip reader, BOM removed");
const fake=routes=>async(url)=>{const u=new URL(url);for(const [test,body] of routes)if(test(u))return typeof body==="function"?body(u):new Response(body,{status:200});return new Response("nf",{status:404})};
const pr=await belgianStatistics(makeDovClient({fetchImpl:fake([[u=>u.hostname==="statbel.fgov.be",zip("CPI All base years.txt",CPI)]])}),{topic:"prices"},{assets});
assert.equal(pr.latest_month,"2026-10");assert.equal(pr.inflation_pct,5.26);assert.deepEqual(pr.cpi,{value:105.37,base:"2025=100"});assert.equal(pr.smoothed_health_index,101.72);
assert.deepEqual(pr.last_13_months.map(r=>r.month),["2026-09","2026-10"]);
// only Statbel's open-data folder may be read on statbel.fgov.be (its web pages sit behind a bot check)
assert.match((await makeDovClient({fetchImpl:fake([])}).get("https://statbel.fgov.be/en/open-data")).error,/not allowed/);
// labour: be.STAT quarterly view, both-sexes rows, latest quarter, Belgium total
const LAB={facts:[{Region:"Flanders region",Quarter:"1st quarter 2026",Gender:null,"Employment rate":0.75,"Unemployment rate":0.041,"Activity rate":0.78},
  {Region:"Flanders region",Quarter:"2nd quarter 2026",Gender:null,"Employment rate":0.752,"Unemployment rate":0.04,"Activity rate":0.781},
  {Region:null,Quarter:"2nd quarter 2026",Gender:null,"Employment rate":0.672,"Unemployment rate":0.061,"Activity rate":0.72},
  {Region:"Flanders region",Quarter:"2nd quarter 2026",Gender:"Males","Employment rate":0.79,"Unemployment rate":0.039,"Activity rate":0.8}]};
const lb=await belgianStatistics(makeDovClient({fetchImpl:fake([[u=>u.hostname==="bestat.statbel.fgov.be",JSON.stringify(LAB)]])}),{topic:"labour"},{assets});
assert.equal(lb.latest_quarter,"2nd quarter 2026");assert.deepEqual(lb.by_area.map(a=>[a.area,a.unemployment_rate_pct]),[["Belgium",6.1],["Flanders region",4]]);
assert.match(lb.key_facts[0],/^Belgium: unemployment 6.1 %/);

// ---------- air_quality ----------
const geo=JSON.stringify({LocationResult:[{Municipality:"Leuven",Housenumber:"1",FormattedAddress:"Grote Markt 1, 3000 Leuven",Location:{Lat_WGS84:50.879379,Lon_WGS84:4.700655,X_Lambert72:173358.14,Y_Lambert72:174387.29}}]});
const now=Date.now();
const wms=u=>{const L=u.searchParams.get("query_layers").split(",");
  const props=l=>/_hmean$/.test(l)?{timestamp:"2026-11-06T18:00:00Z",value:{"rio:no2_hmean":29.6,"rio:pm25_hmean":27.5,"rio:pm10_hmean":40.7,"rio:o3_hmean":7.6,"rio:bc_hmean":0.4}[l]}
    :/_24hmean$/.test(l)?{value:/pm25/.test(l)?21.7:30}:/anmean_be$/.test(l)?{year:"2025-12-31Z",value:{"rio:no2_anmean_be":12.4,"rio:pm25_anmean_be":9.2,"rio:pm10_anmean_be":16.7}[l]}
    :/atmostreet/.test(l)?{GRAY_INDEX:/no2/.test(l)?21.3:/pm25/.test(l)?10.3:19.6}:/belaqi_d(\d)/.test(l)?{GRAY_INDEX:[6,5,4,5][Number(l.match(/d(\d)/)[1])]}:{};
  return new Response(JSON.stringify({features:L.map(l=>({properties:props(l)}))}),{status:200})};
const SOS_ST=JSON.stringify([{properties:{id:1,label:"FAR - station"},geometry:{coordinates:[4.515,50.916]}},{properties:{id:2,label:"NEAR - stale station"},geometry:{coordinates:[4.701,50.881]}}]);
const sos=u=>new Response(JSON.stringify(u.searchParams.get("station")==="2"?[{parameters:{phenomenon:{label:"Nitrogen dioxide"}},uom:"µg/m³",lastValue:{timestamp:now-200*24*3600e3,value:7.5}}]
  :[{parameters:{phenomenon:{label:"Nitrogen dioxide"}},uom:"µg/m³",lastValue:{timestamp:now-3600e3,value:24}},{parameters:{phenomenon:{label:"Particulate Matter < 2.5 µm"}},uom:"µg/m³",lastValue:{timestamp:now-3600e3,value:22.9}}]),{status:200});
const vrbg=JSON.stringify({features:[{properties:{NISCODE:"24062",NAAM:"Leuven"}}]});
const airFetch=fake([[u=>u.pathname.startsWith("/geolocation"),geo],[u=>u.hostname==="geo.irceline.be"&&u.pathname==="/wms",wms],[u=>u.pathname.endsWith("/stations"),SOS_ST],[u=>u.pathname.endsWith("/timeseries"),sos],[u=>u.pathname==="/VRBG2025/wfs",vrbg]]);
const aq=await airQuality(makeDovClient({fetchImpl:airFetch}),{address:"Grote Markt 1, 3000 Leuven"},{assets});
assert.equal(aq.now.no2_ugm3,29.6);assert.equal(aq.forecast_belaqi[0].label,"poor");assert.equal(aq.forecast_belaqi.length,4);
assert.deepEqual(aq.annual_street_level.no2,{ugm3:21.3,times_who_2021:2.1,above_eu_limit_now:false,above_eu_limit_2030:true});
assert.equal(aq.place.nis_code,"24062");
// stations sorted by real distance; a stale nearest station is named but the key fact uses the nearest one measuring now
assert.equal(aq.nearest_stations[0].station,"NEAR - stale station");assert.match(aq.nearest_stations[0].latest.no2.stale,/h old/);
assert.ok(aq.key_facts.some(f=>/^Nearest station measuring now: FAR - station .* The nearer station NEAR - stale station has no current values\.$/.test(f)));
assert.ok(aq.last_24h.above_who_24h.includes("fine particulate matter (PM2.5)"),"21.7 > 15");
assert.ok(!aq.key_facts.some(f=>/^This hour.*WHO/.test(f)),"hourly values are never compared with annual standards");
// a mismatched multi-layer answer (fewer values than layers) is refused, not misread
const short=fake([[u=>u.pathname.startsWith("/geolocation"),geo],[u=>u.hostname==="geo.irceline.be"&&u.pathname==="/wms",new Response(JSON.stringify({features:[{properties:{GRAY_INDEX:5}}]}),{status:200})]]);
const aq2=await airQuality(makeDovClient({fetchImpl:short}),{address:"Grote Markt 1, 3000 Leuven"},{assets});
assert.match(aq2.error,/did not answer/,"every multi-layer answer was short: refused, nothing misread");

// ---------- flood_risk ----------
const ident=u=>{const svc=u.pathname.split("/")[5];const code={overstromingsgevoelige_gebieden_fluviaal:3,overstromingsgevoelige_gebieden_pluviaal:null,overstromingsgevoelige_gebieden_vanuit_de_zee:1}[svc];
  return new Response(JSON.stringify({results:code==null?[]:[{attributes:{gridcode:String(code)}},{attributes:{gridcode:"2"}}]}),{status:200})};
const fl=await floodRisk(makeDovClient({fetchImpl:fake([[u=>u.pathname.startsWith("/geolocation"),geo],[u=>u.hostname==="inspirepub.waterinfo.be",ident],[u=>u.pathname==="/VRBG2025/wfs",vrbg]])}),{address:"Grote Markt 1, 3000 Leuven"},{assets});
assert.deepEqual(Object.fromEntries(Object.entries(fl.maps).map(([k,v])=>[k,v.class])),{river:"D",rain:"A",sea:"C"},"no feature = A; overlapping polygons: the highest class");
assert.equal(fl.highest_class,"D");assert.match(fl.key_facts[0],/class D \(medium chance of flooding\) from rivers/);
assert.match((await floodRisk(makeDovClient({fetchImpl:fake([])}),{latitude:50.6326,longitude:5.5797},{assets})).error,/outside the Flemish Region, which these maps cover/);
// a map that times out is asked once more; the error names VMM (not DOV) and the answer says how to retry
const timeout=()=>{const e=new Error("timed out");e.name="TimeoutError";throw e};
let riverCalls=0;const flaky=u=>{if(u.pathname.includes("fluviaal")&&++riverCalls===1)timeout();return ident(u)};
const fr=await floodRisk(makeDovClient({fetchImpl:fake([[u=>u.pathname.startsWith("/geolocation"),geo],[u=>u.hostname==="inspirepub.waterinfo.be",flaky],[u=>u.pathname==="/VRBG2025/wfs",vrbg]])}),{latitude:50.879,longitude:4.701},{assets});
assert.equal(riverCalls,2);assert.equal(fr.maps.river.class,"D");assert.equal(fr.complete,undefined);
const down=u=>{if(u.pathname.includes("fluviaal"))timeout();return ident(u)};
const fd=await floodRisk(makeDovClient({fetchImpl:fake([[u=>u.pathname.startsWith("/geolocation"),geo],[u=>u.hostname==="inspirepub.waterinfo.be",down],[u=>u.pathname==="/VRBG2025/wfs",vrbg]])}),{latitude:50.879,longitude:4.701},{assets});
assert.equal(fd.complete,false);assert.match(fd.maps.river.error,/^VMM's map service \(waterinfo\.be\) did not answer within 7 s \(asked twice\)$/);
assert.deepEqual(fd.retry.maps,["river"]);assert.equal(fd.highest_class,"C","a class C answer from the sea map is already flood-prone");

console.log(JSON.stringify({ok:true,live:"coordinates/addresses/statbel-tables/statistics/prices/labour/air/flood"}));
