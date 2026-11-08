// Live check of the DOV subsurface tools against the real public services (DOV and the Flemish geolocation service).
// Manual only (npm run live:dov): it is not part of the build, so CI never calls external services.
//   node scripts/live-dov.mjs            all questions
//   node scripts/live-dov.mjs --mcp URL  the same questions through a deployed MCP endpoint, e.g. https://data.vecture.be/mcp
import assert from "node:assert/strict";
import { getSubsurfaceRecord, makeDovClient, subsurfaceAtLocation } from "../dov.mjs";
import { searchSubsurface } from "../dov-search.mjs";
import { belgianStatistics } from "../statbel.mjs";
import { airQuality } from "../air.mjs";
import { floodRisk } from "../flood.mjs";
import fs from "node:fs";
const assets={json:async p=>{try{return JSON.parse(fs.readFileSync(new URL("../public"+p,import.meta.url),"utf8"))}catch{return null}}};

const mcpUrl=process.argv[process.argv.indexOf("--mcp")+1]&&process.argv.includes("--mcp")?process.argv[process.argv.indexOf("--mcp")+1]:null;
async function run(tool,args){
  if(!mcpUrl){const c=makeDovClient();const out=await {subsurface_at_location:subsurfaceAtLocation,get_subsurface_record:getSubsurfaceRecord,search_subsurface:searchSubsurface,belgian_statistics:belgianStatistics,air_quality:airQuality,flood_risk:floodRisk}[tool](c,args,{assets});return{out,upstream:c.used}}
  const r=await fetch(mcpUrl,{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:tool,arguments:args}})});
  const j=await r.json();return{out:j.result?.structuredContent??j,upstream:"?"};
}

// Questions people actually ask, each with what a correct answer must contain.
const CASES=[
  ["What is under Grote Markt 1 in Leuven?","subsurface_at_location",{address:"Grote Markt 1, 3000 Leuven"},o=>{
    assert.equal(o.at_point.tertiary_geology.code,"Br");assert.ok(o.nearby.boreholes.count>0);assert.ok(o.groundwater_status_nearest?.level_class)}],
  ["Boreholes and groundwater wells near Ghent (lat/lon)","subsurface_at_location",{latitude:51.0453,longitude:3.7275,radius_m:500},o=>{
    assert.ok(o.nearby.boreholes.nearest.length>0);assert.ok(o.nearby.boreholes.nearest.every((b,i,a)=>!i||a[i-1].distance_m<=b.distance_m))}],
  ["Dense city centre, 500 m (Antwerp)","subsurface_at_location",{address:"Groenplaats 1, 2000 Antwerpen",radius_m:500},o=>{assert.ok(o.nearby.boreholes.count>50);assert.equal(o.nearby.boreholes.note,undefined)}],
  ["Campine sands (Kempen)","subsurface_at_location",{latitude:51.2194,longitude:5.0858},o=>{assert.match(o.at_point.tertiary_geology.formation,/Mol/)}],
  ["Brussels-Capital: Flemish policy layers do not apply","subsurface_at_location",{latitude:50.8467,longitude:4.3525},o=>{assert.match(o.coverage_note,/Brussels/)}],
  ["Wallonia is refused before any request","subsurface_at_location",{latitude:50.6326,longitude:5.5797},o=>{assert.match(o.error,/outside the Flemish Region/)}],
  ["Unknown address","subsurface_at_location",{address:"Nergensstraat 999, 9999 Nergens"},o=>{assert.match(o.error,/not found/)}],
  ["Deep 1875 borehole in Leuven, layer by layer","get_subsurface_record",{id:"boring/1875-040352"},o=>{
    const fs=o.interpretations.find(i=>i.type==="formal stratigraphy");assert.ok(fs.layers.length>=5);assert.equal(fs.layers[0].lid1_meaning,"Formatie van Brussel")}],
  ["Recent geothermal borehole log","get_subsurface_record",{id:"boring/2022-202019"},o=>{assert.ok(o.interpretations[0].layers.length>10)}],
  ["Groundwater levels in a primary-network well since 1978","get_subsurface_record",{id:"filter/1978-006372"},o=>{
    assert.ok(o.water_levels.measurements>500);assert.ok(o.water_levels.yearly_means.length>=10);assert.match(o.aquifer,/Mol/)}],
  ["CPT profile","get_subsurface_record",{id:"sondering/1984-065526"},o=>{assert.ok(o.profile_per_metre.length>=10)}],
  ["Modelled column under Leuven reaches the Brabant Massif","subsurface_at_location",{address:"Grote Markt 1, 3000 Leuven"},o=>{
    const g=o.modelled_column.geology;assert.equal(g.find(u=>u.unit==="0310PA_Br").name,"Formatie van Brussel");assert.match(g.at(-1).name,/Siluur/);
    assert.equal(o.modelled_column.hydrogeology.find(u=>u.unit==="A0620").name,"Zand van Brussel")}],
  ["Groundwater quality: nitrate trend in a primary-network well","get_subsurface_record",{id:"filter/1978-006372"},o=>{
    const q=o.groundwater_quality;assert.ok(q.trends["Nitraat (NO3)"].values.length>=10);assert.ok(q.latest_sample.results.Anionen.some(r=>r.parameter==="Nitraat (NO3)"))}],
  ["Electric CPT with soil behaviour types (Antwerp)","get_subsurface_record",{id:"sondering/2015-050373"},o=>{
    assert.ok(o.profile_per_metre.filter(r=>r.soil_behaviour).length>20);assert.ok(o.profile_per_metre.every(r=>r.fs_mean_kpa===undefined||r.fs_mean_kpa>1))}],
  ["Permits near Leuven centre: total and largest operator named","subsurface_at_location",{address:"Grote Markt 1, 3000 Leuven"},o=>{
    const p=o.nearby.groundwater_permits;assert.ok(p.count>5&&p.licensed_m3_per_year>1e6);assert.ok(o.key_facts.some(f=>/abstraction permit/.test(f)))}],
  ["Soil survey profile summarised per horizon","get_subsurface_record",{id:"bodemlocatie/1964-007478"},o=>{
    assert.equal(o.classification[0].code,"Zcg");assert.ok(o.horizons.length>=5);assert.ok(o.horizons[0].munsell_colour&&o.horizons[0].organic_carbon_pct>0)}],
  ["Search: deepest boreholes in Leuven (municipality boundary)","search_subsurface",{record_type:"boreholes",municipality:"Leuven",limit:3},o=>{
    assert.ok(o.count>1000);assert.ok(o.results[0].depth_m>=o.results[1].depth_m)}],
  ["Search: old name Melle resolves to Merelbeke-Melle","search_subsurface",{record_type:"boreholes",municipality:"Melle",purpose:"geothermal",date_from:"2020"},o=>{
    assert.equal(o.area.municipality,"Merelbeke-Melle");assert.ok(o.count>50)}],
  ["Search: largest permits in Mol with total per aquifer","search_subsurface",{record_type:"groundwater_permits",municipality:"Mol",limit:3},o=>{
    assert.ok(o.summary.licensed_m3_per_year>1e6);assert.ok(o.results[0].licensed_m3_per_year>=o.results[1].licensed_m3_per_year)}],
  ["Search: wells in the Brussel sand with quality data near Leuven","search_subsurface",{record_type:"groundwater_wells",address:"Grote Markt 1, 3000 Leuven",radius_m:3000,aquifer:"Brussel",with_quality_data:true},o=>{
    assert.ok(o.count>0);assert.ok(o.results.every(w=>/^A06/.test(w.aquifer)))}],
  ["Statistics: Leuven profile with province, region and Belgium","belgian_statistics",{places:["Leuven"]},o=>{assert.equal(o.places.length,4);assert.ok(o.places[0].pop.population>100000)}],
  ["Statistics: inflation from Statbel's CPI file","belgian_statistics",{topic:"prices"},o=>{assert.match(o.latest_month,/^\d{4}-\d{2}$/);assert.ok(typeof o.inflation_pct==="number")}],
  ["Statistics: unemployment by region (be.STAT)","belgian_statistics",{topic:"labour"},o=>{assert.ok(o.by_area.length>=3)}],
  ["Statistics: oldest municipalities in West Flanders","belgian_statistics",{rank_by:"share_65_plus_pct",within:"West-Vlaanderen",limit:3},o=>{assert.equal(o.results.length,3)}],
  ["Air quality in Liège (BeSt address, Wallonia)","air_quality",{address:"Place Saint-Lambert 1, 4000 Liège"},o=>{assert.equal(o.place.nis_code,"62063");assert.ok(o.now.no2_ugm3!=null);assert.equal(o.forecast_belaqi.length,4)}],
  ["Air quality in Antwerp: street level vs WHO and EU","air_quality",{address:"Groenplaats 1, 2000 Antwerpen"},o=>{assert.ok(o.annual_street_level.no2.ugm3>0);assert.ok(o.nearest_stations.length)}],
  ["Flood risk beside the Dijle in Leuven (VMM maps)","flood_risk",{latitude:50.8705,longitude:4.6946},o=>{assert.equal(o.maps.river.class,"D")}],
  ["Flood risk at the coast (Ostend)","flood_risk",{latitude:51.2289,longitude:2.9214},o=>{assert.equal(o.maps.sea.class,"B")}],
  ["Hydrogeological interpretation decoded","get_subsurface_record",{id:"interpretatie/2001-191219"},o=>{assert.equal(o.layers[0].aquifer_meaning,"Zand van Brussel")}]
];
let failed=0;
for(const [q,tool,args,check] of CASES){
  const t=Date.now();let line;
  try{const {out,upstream}=await run(tool,args);check(out);line="ok   "+String(Date.now()-t).padStart(5)+" ms  upstream "+upstream+"  "+String(JSON.stringify(out).length).padStart(5)+" chars  "+q}
  catch(e){failed++;line="FAIL "+String(Date.now()-t).padStart(5)+" ms  "+q+"\n     "+String(e.message).split("\n")[0]}
  console.log(line);
}
process.exit(failed?1:0);
