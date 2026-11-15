// Offline tests for river_levels and weather: the conversions and judgements that make their answers true, on synthetic upstream
// answers shaped like the real KiWIS and KMI GeoServer responses (recorded fixtures cover the real shapes; these cover the edge cases).
import assert from "node:assert/strict";
import { makeDovClient } from "../dov.mjs";
import { riverLevels, RIVER_HOSTS } from "../rivers.mjs";
import { weather, WEATHER_HOSTS } from "../weather.mjs";
import { atTime } from "../lib/fixtures.mjs";
import { checkAnswer } from "../lib/tool-contract.mjs";

const NOW="2026-11-15T13:40:00Z",T=Date.parse(NOW);
const at=(minAgo)=>new Date(T-minAgo*60000).toISOString().replace(".000Z","+00:00");
const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{"content-type":"application/json"}});
const P=u=>Object.fromEntries(new URL(u).searchParams);

// ---------------- river_levels ----------------
// VMM gauge A: reading 0.15 above a gauge zero of 24.03 m TAW, watch 26.15 / alarm 26.50 (TAW); exceedance statistics P10 high, P90 low.
// VMM gauge B: reading 6.6 with zero 11.5 -> 18.1 m TAW, ABOVE its watch level 18.0.  VMM gauge C: last value in 2014 (retired).
// VMM gauge D: thresholds 20 m away from its level (other reference): must not be compared.
// HIC tidal gauge: swings 5 m in 24 h.
const vmmLayer=[
  {ts_id:1,timestamp:at(10),ts_value:0.15,station_latitude:50.838,station_longitude:4.643,ts_name:"Pv.15",station_no:"L08_097",station_name:"Korbeek-Dijle/Dijle",ts_unitsymbol:"m",river_name:"Dijle",Level_Alarm:"26.5 m",Level_Waak:"26.15 m",Level_PreAlarm:"26.4 m",GAUGE_DATUM:"24.032",dataowner:"VMM"},
  {ts_id:11,timestamp:at(10),ts_value:0.15,station_latitude:50.838,station_longitude:4.643,ts_name:"Pv.15-fout",station_no:"L08_097",station_name:"Korbeek-Dijle/Dijle",ts_unitsymbol:"m",river_name:"Dijle",GAUGE_DATUM:"24.032"},
  {ts_id:2,timestamp:at(10),ts_value:6.6,station_latitude:50.85,station_longitude:4.65,ts_name:"Pv.15",station_no:"S01_42A8",station_name:"Ichtegem/Trogbeek",ts_unitsymbol:"m",river_name:"",Level_Alarm:"19.2 m",Level_Waak:"18,0",GAUGE_DATUM:"11.5",dataowner:"Provincie"},
  {ts_id:3,timestamp:"2014-01-30T08:30:00.000+01:00",ts_value:19.2,station_latitude:50.839,station_longitude:4.644,ts_name:"Pv.15",station_no:"K08_016",station_name:"Leuven/Dijle/Dijlemolens",ts_unitsymbol:"m",river_name:"Dijle",GAUGE_DATUM:""},
  {ts_id:4,timestamp:at(10),ts_value:2.0,station_latitude:50.86,station_longitude:4.66,ts_name:"P.15",station_no:"K04_999",station_name:"Elsewhere/Beek",ts_unitsymbol:"m",river_name:"Beek",Level_Alarm:"25 m",Level_Waak:"24 m",GAUGE_DATUM:"0.0"}
];
const hicLayer=[{ts_id:9,timestamp:at(5),ts_value:0.7,station_latitude:51.2213,station_longitude:4.3977,ts_name:"Pv",station_no:"zes21a-1066",station_name:"Antwerpen tij/Zeeschelde",ts_unitsymbol:"m",Portal_Rivier:"Zeeschelde",GAUGE_DATUM:"0.0",dataowner:"HIC"}];
const series=(f,n=105,stepMin=15)=>Array.from({length:n},(_,i)=>{const m=(n-1-i)*stepMin;return[at(m),f(m/60)]});
function kiwis({hicDown=false}={}){
  return async url=>{
    const u=new URL(url),p=P(url),host=u.hostname;
    if(host==="hicws.vlaanderen.be"&&hicDown)throw Object.assign(new Error("t"),{name:"TimeoutError"});
    if(p.request==="getTimeseriesValueLayer"&&p.timeseriesgroup_id==="118730")return json(vmmLayer);
    if(p.request==="getTimeseriesValueLayer"&&p.timeseriesgroup_id==="156154")return json(hicLayer);
    if(p.request==="getTimeseriesValueLayer"&&p.timeseriesgroup_id==="111236,111237")return json([
      {ts_name:"AlarmStatus",station_no:"L08_097",ts_value:0,timestamp:at(40)},{ts_name:"KT-AlarmStatus.O",station_no:"L08_097",ts_value:2,timestamp:new Date(T+36e5*30).toISOString()},
      {ts_name:"AlarmStatus",station_no:"S01_42A8",ts_value:1,timestamp:at(40)}]);
    if(p.request==="getTimeseriesValueLayer"&&p.timeseriesgroup_id.startsWith("156152"))return json([{ts_name:"AlarmStatus.O",station_no:"zes21a-1066",ts_value:0,timestamp:at(10)},
      {ts_name:"DrempelWaak.O",station_no:"zes21a-1066",ts_value:6.6,timestamp:"2022-12-14T00:00:00+01:00"},{ts_name:"DrempelAlarm.O",station_no:"zes21a-1066",ts_value:7.3,timestamp:"2022-12-14T00:00:00+01:00"}]);
    if(p.request==="getTimeseriesValues"&&p.period==="PT26H"){
      const ids=p.ts_id.split(",");
      return json(ids.map(id=>({ts_id:id,data:id==="9"?series(h=>2.6+2.5*Math.cos(h/12.42*2*Math.PI),313,5)   // tide: 5 m swing
        :id==="2"?series(h=>6.6+0.02*h):series(()=>0.15)})));
    }
    if(p.request==="getTimeseriesList")return json([["station_no","ts_id","ts_name"],["L08_097","101","AnalysePeriodeP90"],["L08_097","102","AnalysePeriodeP10"],["L08_097","103","AnalysePeriodeP25"],["L08_097","104","AnalysePeriodeP75"]]);
    if(p.request==="getTimeseriesValues"&&p.ts_id==="101,102,103,104"){
      assert.match(p.from||"",/^\d{4}-01-01$/,"VMM statistics are read from a few years back (the newest row is an empty placeholder)");
      const v={101:24.199,102:24.40,103:24.35,104:24.22};
      return json(Object.entries(v).map(([id,x])=>({ts_id:id,data:[["2025-01-01T00:00:00.000+01:00",x+0.01],["2026-01-01T00:00:00.000+01:00",x],["2027-01-01T00:00:00.000+01:00",null]]})));
    }
    throw new Error("unexpected request "+url);
  };
}
const river=(args,opts)=>atTime(NOW,()=>{const client=makeDovClient({fetchImpl:kiwis(opts),hosts:[...RIVER_HOSTS,"geo.api.vlaanderen.be","best.pr.fedservices.be"],maxRequests:18});return riverLevels(client,args,{})});

{ // absolute level = reading + gauge zero; thresholds compared in TAW; exceedance percentiles read the right way round; forecast status
  const out=await river({station:"L08_097"});
  assert.deepEqual(checkAnswer(out),[]);
  const g=out.gauges[0];
  assert.equal(g.latest.level_m_taw,24.18);assert.equal(g.latest.level_above_gauge_zero_m,0.15);
  assert.equal(g.thresholds.below_watch_cm,197);assert.equal(g.thresholds.below_alarm_cm,232);assert.equal(g.above_threshold,"none");
  assert.deepEqual(g.usual_range.range_80pct_m_taw,[24.2,24.4],"P90 (low) and P10 (high) give the band, whatever the order");
  assert.match(g.usual_range.position,/below the usual range/);
  assert.equal(g.forecast_status.highest_code_expected,2);assert.match(out.key_facts[0],/FORECAST/);
  assert.match(out.key_facts[0],/197 cm below the watch level \(26\.15 m\)/);
  assert.equal(g.change_cm.last_24h,0,"the 24-hour change is present (history reaches back 26 h)");assert.equal(g.last_24h.values,97,"min/max and counts cover 24 h only");
  assert.equal(g.series.ts_name,"Pv.15","the -fout series is never used");
}
{ // above the watch level: said plainly, with a negative margin
  const out=await river({station:"Ichtegem"});
  const g=out.gauges[0];
  assert.equal(g.latest.level_m_taw,18.1);assert.equal(g.above_threshold,"watch");assert.equal(g.thresholds.below_watch_cm,-10);
  assert.match(out.key_facts[0],/10 cm ABOVE the watch level/);assert.equal(g.trend,"falling");
  assert.equal(g.official_status.label,"alarm level 1 of 3 (1 = lowest)");
}
{ // a gauge silent since 2014 is not "now"; named, it gets a clear error
  const out=await river({station:"Dijlemolens"});
  assert.match(out.error,/has not reported in the last 3 hours \(last value 2014-01-30/);
}
{ // thresholds 20 m from the level are not compared (different reference)
  const out=await river({station:"K04_999"});
  assert.equal(out.gauges[0].thresholds.below_watch_cm,undefined);assert.match(out.gauges[0].thresholds.note,/not compared/);
  assert.equal(out.gauges[0].above_threshold,undefined);
}
{ // tidal gauge: no "rising/falling" trend claims, low and high water instead
  const out=await river({station:"Antwerpen tij"});
  const g=out.gauges[0];
  assert.equal(g.tidal,true);assert.match(g.trend,/^tide (rising|falling)$/);assert.equal(g.change_cm.last_24h,undefined);
  assert.match(out.key_facts[0],/tidal gauge, low and high water in the last 24 h 0\.1\d and 5\.\d\d m/);
  assert.equal(g.latest.level_m_taw,5.1);assert.equal(g.thresholds.below_watch_cm,150,"the newest reading (series) is compared, not the older layer value");
}
{ // nearest gauges by coordinates; the retired gauge is counted but not listed; one service down is reported, not hidden
  const out=await river({latitude:50.838,longitude:4.643,max_stations:5},{hicDown:true});
  assert.ok(out.gauges.every(g=>g.station_no!=="K08_016"));
  assert.equal(out.search.gauges_not_reporting,1);
  assert.deepEqual(out.search.services_not_answering,["HIC"]);
  assert.equal(out.gauges[0].station_no,"L08_097");
}
{ // a river filter with no match, and no arguments
  assert.match((await river({river:"Maas"})).error,/No gauge reporting now has 'Maas'/);
  assert.match((await river({})).error,/Give an address/);
}
{ // a place far from every Flemish gauge: an explanation, not a gauge 80 km away
  const out=await river({latitude:50.1,longitude:5.5});
  assert.match(out.error,/Wallonia's gauges \(SPW/);
}

// ---------------- weather ----------------
// Synop station 6447 reports; ALARO steps give accumulated precipitation in METRES, temperature in kelvin, wind as u/v.
const synRows=(code,{knots=false}={})=>{
  const rows=[];
  for(let h=26;h>=0;h--){
    const t=new Date(Math.floor(T/36e5)*36e5-h*36e5),hh=t.getUTCHours();
    rows.push({code,timestamp:t.toISOString().replace(".000",""),temp:5+h%7,humidity_relative:h===0?null:80,wind_speed:knots?10:5,wind_speed_unit:knots?4:1,wind_direction:225,wind_peak_speed:12,pressure:1005,cloudiness:8,
      precip_quantity:hh===6||hh===18?1.2:hh===0||hh===12?0.3:null,precip_range:hh===6||hh===18?2:hh===0||hh===12?1:null});
  }
  return rows;
};
const feat=rows=>({type:"FeatureCollection",features:rows.map(r=>({type:"Feature",geometry:{type:"Point",coordinates:[r.lon??4.358,r.lat??50.797]},properties:r}))});
function kmi({failSteps=new Set(),knots=false}={}){
  const run0=Date.parse("2026-11-15T06:00:00Z"),acc=h=>h<=6?0:(h-6)*0.0005;   // 0.5 mm per hour after 6 h, in metres
  return async url=>{
    const u=new URL(url),p=Object.fromEntries([...u.searchParams].map(([k,v])=>[k.toLowerCase(),v]));
    if(u.pathname.endsWith("/alaro/2_m_temperature/wms"))return new Response('<Layer><Dimension name="time" default="2026-11-15T06:00:00Z" units="ISO8601">2026-11-15T06:00:00.000Z/2026-11-17T18:00:00.000Z/PT1H</Dimension></Layer>',{headers:{"content-type":"text/xml"}});
    if(p.typenames==="synop:synop_station")return json(feat([{code:6447,name:"UCCLE",altitude:100,lon:4.358,lat:50.797},{code:6451,name:"ZAVENTEM",lon:4.47,lat:50.9}]));
    if(p.typenames==="aws:aws_station")return json(feat([{code:6447,name:"UCCLE",lon:4.358,lat:50.797}]));
    if(p.typenames==="synop:synop_data"){assert.match(p.cql_filter,/^code IN \(6447,6451\) AND timestamp >= '\d{4}-\d\d-\d\dT\d\d:00:00Z'$/);return json(feat([...synRows(6447,{knots}),...synRows(6451)]))}
    if(p.typenames==="aws:aws_1day")return json(feat([1,2,3,4,5,6,7,8].map(d=>({code:6447,timestamp:new Date(T-d*864e5).toISOString().slice(0,10)+"T00:00:00Z",precip_quantity:d===2?6.5:0,temp_max:10+d,temp_min:d-3,sun_duration:120,wind_gusts_speed:10}))));
    if(u.pathname.endsWith("/alaro/wms")&&p.request==="GetFeatureInfo"){
      const t=Date.parse(p.time),h=(t-run0)/36e5;
      if(failSteps.has(h))return new Response("",{status:503});
      // the accumulation dips by a hair at one step (interpolation): must not become negative rain
      const a=h===13?acc(9.99):acc(h);
      const vals=[275.15+h/10,275.25+h/10,275.05+h/10,a,-5,0,-12,-5,0.75,88,0,0];
      return json({type:"FeatureCollection",features:vals.map(v=>({type:"Feature",properties:{x:v}}))});
    }
    if(u.hostname==="geo.api.vlaanderen.be")return json({LocationResult:[]});
    throw new Error("unexpected request "+url);
  };
}
const wx=(args,opts)=>atTime(NOW,()=>weather(makeDovClient({fetchImpl:kmi(opts),hosts:[...WEATHER_HOSTS,"geo.api.vlaanderen.be","best.pr.fedservices.be"],maxRequests:20}),args,{}));
{
  const out=await wx({latitude:50.80,longitude:4.36});
  assert.deepEqual(checkAnswer(out),[]);
  const now=out.observed.now;
  assert.equal(out.observed.station,"UCCLE");assert.equal(now.wind_kmh,18);assert.equal(now.wind_from,"SW");assert.equal(now.gust_kmh,43);
  assert.match(out.key_facts[0],/^NOW \(measured at KMI station UCCLE, .*: \d+ °C, overcast, wind SW 18 km\/h with gusts to 43 km\/h\.$/,"no 'humidity undefined' when humidity is missing");
  // 24 h precipitation = the 12 h report at 06 UTC + the 12 h report at 18 UTC the day before (not the 6 h ones in between)
  assert.equal(out.observed.last_24h.precip_mm,2.4);
  const s=out.forecast.steps;
  assert.equal(s[0].temp_c,2.7,"kelvin to °C (step 0 is 13 UTC, 7 h into the 06 UTC run)");
  assert.equal(s[1].precip_mm,1.5,"3 h x 0.5 mm: metres x 1000");
  assert.ok(s.every(x=>x.precip_mm==null||x.precip_mm>=0),"no negative rain");
  assert.equal(s[1].wind_from,"E","u = -5 m/s (towards west) is wind from the east");assert.equal(s[1].wind_kmh,18);assert.equal(s[1].gust_kmh,47);
  assert.equal(s[1].cloud_cover_pct,75);
  assert.equal(s[2].precip_mm,0,"an accumulation that dips (interpolation) is 0 mm, not negative");
  assert.equal(out.forecast.next_24h.precip_mm,12,"24 h of 0.5 mm/h");
  assert.match(out.key_facts.join(" "),/First rain of 0\.5 mm or more expected/);
  assert.equal(out.last_7_days.total_precip_mm,6.5);assert.equal(out.last_7_days.days.length,7);
  assert.match(out.key_facts.at(-1),/weather warnings are not part of KMI's open data/);
}
{ // knots are converted
  const out=await wx({latitude:50.80,longitude:4.36},{knots:true});
  assert.equal(out.observed.now.wind_kmh,19);
}
{ // a forecast with failed steps never claims "no rain"
  const out=await wx({latitude:50.80,longitude:4.36},{failSteps:new Set([7.5+0.5,10,13,16,19,22,25,28,31,43,55].map(x=>x))});
  assert.doesNotMatch(out.key_facts.join(" "),/No period with 0\.5 mm/);
}
console.log(JSON.stringify({ok:true,tests:"river_levels and weather edge cases"}));
