// electricity_grid against a synthetic Elia Open Data: Brussels days around the clock change, the "now" quarter-hour that load, solar
// and wind all have, wind summed over regions while solar reads only the Belgian total, the complete border quarter-hour, imbalance
// state and range, mix shares, partial CO2 days, the forecast horizons, past-tense days and a service that does not answer.
import assert from "node:assert/strict";
import { makeDovClient } from "../dov.mjs";
import { ELIA_HOSTS, electricityGrid, dayStartUtc, localDay, localHM, addDays } from "../elia.mjs";
import { atTime } from "../lib/fixtures.mjs";
import { checkAnswer } from "../lib/tool-contract.mjs";

// ---- Brussels days
assert.equal(new Date(dayStartUtc("2026-11-16")).toISOString(),"2026-11-15T23:00:00.000Z","winter: UTC+1");
assert.equal(new Date(dayStartUtc("2026-06-21")).toISOString(),"2026-06-20T22:00:00.000Z","summer: UTC+2");
assert.equal((dayStartUtc("2026-03-30")-dayStartUtc("2026-03-29"))/36e5,23,"spring forward: a 23-hour day");
assert.equal((dayStartUtc("2026-10-26")-dayStartUtc("2026-10-25"))/36e5,25,"fall back: a 25-hour day");
assert.equal(localDay(Date.parse("2026-11-15T23:30:00Z")),"2026-11-16");assert.equal(localHM(Date.parse("2026-11-16T14:00:00Z")),"15:00");
assert.equal(addDays("2026-12-31",1),"2027-01-01");

// ---- a synthetic Elia
const NOW="2026-11-16T14:20:00Z";   // 15:20 in Brussels
const json=o=>new Response(JSON.stringify(o),{headers:{"content-type":"application/json"}});
const Q=15*60e3,at=s=>Date.parse(s);
const quarters=(from,to)=>{const o=[];for(let t=from;t<to;t+=Q)o.push(t);return o};
const isoZ=t=>new Date(t).toISOString().replace(".000Z","+00:00");
const hourUtc=t=>new Date(t).getUTCHours()+new Date(t).getUTCMinutes()/60;

function elia({down=[]}={}){
  const calls=[];
  const fetchImpl=async url=>{
    const u=new URL(url),parts=u.pathname.split("/").filter(Boolean),ds=parts[parts.indexOf("datasets")+1],p=Object.fromEntries(u.searchParams),records=u.pathname.endsWith("/records");
    calls.push({ds,p});
    if(down.includes(ds))return new Response("busy",{status:503});
    const w=/datetime >= "([^"]+)" and datetime < "([^"]+)"/.exec(p.where||""),from=w?at(w[1]):null,to=w?at(w[2]):null;
    const out=rows=>records?json({total_count:rows.length,results:rows}):json(rows);
    const nowT=at(NOW);
    switch(ds){
      case"ods002":   // load today and tomorrow: measured up to the 14:00Z quarter-hour; tomorrow's peak at 10:30Z
        return out(quarters(from,to).map(t=>({datetime:isoZ(t),measured:t<=at("2026-11-16T14:00:00Z")?(t===at("2026-11-16T11:00:00Z")?11000:10000):null,
          mostrecentforecast:t===at("2026-11-17T10:30:00Z")?12500:9000,mostrecentconfidence10:t===at("2026-11-17T10:30:00Z")?12000:8500,mostrecentconfidence90:t===at("2026-11-17T10:30:00Z")?13000:9500})));
      case"ods001":   // a past summer day: 8,000 MW, 9,000 at 10:00Z
        return out(quarters(from,to).map(t=>({datetime:isoZ(t),totalload:t===at("2026-06-21T10:00:00Z")?9000:8000,mostrecentforecast:8000})));
      case"ods210":case"ods209":case"ods032":{   // solar: the Belgian total, and regional rows that must never be summed in
        const belgiumOnly=/region = "Belgium"/.test(p.where)&&(ds==="ods032"||/gridconnectiontype = "Total"/.test(p.where));
        const rows=[];
        for(const t of quarters(from,to)){
          const day=hourUtc(t)>=8&&hourUtc(t)<15,meas=ds==="ods210"?(t<=at("2026-11-16T14:15:00Z")&&t>=at("2026-11-15T23:00:00Z")?(day?2000:0):null):(hourUtc(t)>=6&&hourUtc(t)<16?4000:0);
          rows.push({datetime:isoZ(t),region:"Belgium",measured:meas,mostrecentforecast:day?1000:(ds==="ods210"&&t>at("2026-11-23T00:00:00Z")&&hourUtc(t)>=8&&hourUtc(t)<15?500:0),monitoredcapacity:12625});
          if(!belgiumOnly)rows.push({datetime:isoZ(t),region:"Antwerpen",measured:meas,mostrecentforecast:500,monitoredcapacity:1500});
        }
        return out(rows);
      }
      case"ods086":case"ods031":{   // wind, grouped by quarter-hour and offshore/onshore as the API does it
        const hist=ds==="ods031",rows=[];
        for(const t of quarters(from,to)){
          const m=hist||t<=at("2026-11-16T14:15:00Z");
          rows.push({datetime:isoZ(t),offshoreonshore:"Offshore",mw:m?(hist?200:1000):null,n:m?1:0,f:1100,cap:2262});
          rows.push({datetime:isoZ(t),offshoreonshore:"Onshore",mw:m?(hist?100:800):null,n:m?4:0,f:900,cap:3729});
        }
        return out(rows);
      }
      case"ods160":   // the newest quarter-hour has only France so far; the one before is complete
        return out([{datetime:"2026-11-16T14:15:00+00:00",controlarea:"France",physicalflowatborder:450},
          ...[["France",500],["Netherlands",-2000],["Germany",-300],["United Kingdom",1000],["Luxembourg",100]].map(([c,v])=>({datetime:"2026-11-16T14:00:00+00:00",controlarea:c,physicalflowatborder:v}))]);
      case"ods026":   // a past day's flows per border, summed (MW per quarter-hour)
        return out([{controlarea:"France",mw:-4000,n:96},{controlarea:"Netherlands",mw:8000,n:96}]);
      case"ods162":
        return out(quarters(from,Math.min(to,at("2026-11-16T14:15:00Z"))).map(t=>({datetime:isoZ(t),qualitystatus:"NotValidated",systemimbalance:t===at("2026-11-16T14:00:00Z")?-150:20,
          imbalanceprice:t===at("2026-11-16T03:15:00Z")?-40:t===at("2026-11-16T12:30:00Z")?300:t===at("2026-11-16T14:00:00Z")?250:100})));
      case"ods134":
        return out(quarters(from,to).map((t,i)=>({datetime:isoZ(t),systemimbalance:10,imbalanceprice:i>=40&&i<45?-10:50})));
      case"ods201":
        return out(from<at("2026-07-01T00:00:00Z")
          ?[{fueltypepublication:"Solar",mw:160000},{fueltypepublication:"Natural Gas",mw:40000}]
          :[{fueltypepublication:"Nuclear",mw:200000},{fueltypepublication:"Natural Gas",mw:40000},{fueltypepublication:"Wind Offshore",mw:80000},{fueltypepublication:"Solar",mw:0},{fueltypepublication:"Other",mw:20000}]);
      case"ods192":{   // hourly; yesterday published only to 18:00 UTC (20 of 24 hours), as Elia does
        const end=from<at("2026-07-01T00:00:00Z")?to:at("2026-11-15T19:00:00Z"),rows=[];
        for(let t=from;t<end;t+=36e5)rows.push({datetime:isoZ(t),production:100,consumption:t===at("2026-11-15T17:00:00Z")?80:120});
        return out(rows);
      }
    }
    return new Response("not mocked: "+ds,{status:404});
  };
  return{fetchImpl,calls};
}
const run=(args,opts)=>{const e=elia(opts);return atTime(NOW,async()=>({out:await electricityGrid(makeDovClient({fetchImpl:e.fetchImpl,hosts:ELIA_HOSTS,maxRequests:10}),args),calls:e.calls}))};

{ // now: the latest quarter-hour that load, solar and wind all have; wind summed, solar from the Belgian row only
  const {out,calls}=await run({});
  assert.deepEqual(checkAnswer(out),[]);
  assert.equal(calls.length,7);
  assert.equal(out.mode,"today");assert.equal(out.date,"2026-11-16");
  assert.deepEqual(out.now,{quarter_hour_start:"15:00",quarter_hour_start_utc:"2026-11-16T14:00:00Z",load_mw:10000,solar_mw:2000,wind_mw:1800,offshore_wind_mw:1000,onshore_wind_mw:800,
    solar_and_wind_share_of_load_pct:38,solar_capacity_mw:12625,wind_capacity_mw:5991});
  assert.match(out.key_facts[0],/^Belgian electricity system at 15:00 Brussels time today \(16 Nov, quarter-hour average\): consumption \(total load\) 10,000 MW; solar 2,000 MW and wind 1,800 MW \(1,000 offshore\), together 38 % of the load\.$/);
  // the border quarter-hour that is complete, not the newest one that only has France
  assert.equal(out.cross_border.quarter_hour_start,"15:00");assert.equal(out.cross_border.net_export_mw,-700);assert.equal(out.cross_border.borders.length,5);
  assert.match(out.key_facts[1],/^Cross-border flows at 15:00: Belgium is a net importer, 700 MW \(importing from the Netherlands 2,000 MW, exporting to the United Kingdom 1,000 MW, exporting to France 500 MW, importing from Germany 300 MW, exporting to Luxembourg 100 MW\)\.$/);
  // today: measured where measured, forecast after; tomorrow's peak with its 80 % band
  assert.equal(out.today.load.peak_mw,11000);assert.equal(out.today.load.peak_time,"12:00");assert.equal(out.today.load.measured_until,"15:15");
  assert.deepEqual(out.tomorrow.load.peak_range_mw,[12000,13000]);assert.equal(out.tomorrow.load.peak_time,"11:30");
  assert.match(out.key_facts.find(f=>f.startsWith("Tomorrow")),/^Tomorrow \(Tuesday, 17 November, Elia's forecast\): peak load 12,500 MW around 11:30 \(80 % range 12,000–13,000 MW\), solar 7 GWh, wind 48 GWh\.$/);
  // imbalance: last quarter-hour, shortage, today's range and negative quarter-hours
  assert.deepEqual(out.imbalance.last_quarter_hour,{start:"15:00",start_utc:"2026-11-16T14:00:00Z",price_eur_mwh:250,system_imbalance_mw:-150,state:"shortage",quality:"NotValidated"});
  assert.equal(out.imbalance.today_so_far.negative_quarter_hours,1);assert.equal(out.imbalance.today_so_far.lowest.start,"04:15");assert.equal(out.imbalance.today_so_far.highest.eur_mwh,300);
  assert.match(out.key_facts.find(f=>f.startsWith("Imbalance")),/^Imbalance price for 15:00–15:15: €250\/MWh \(system short by 150 MW, Elia's quality flag: not validated\); today so far average €\d+, lowest -€40 at 04:15, highest €300 at 13:30, 1 quarter-hour below zero\.$/);
  // yesterday's mix: shares of the total, zero rows left out; CO2 says it covers 20 of 24 hours
  assert.equal(out.generation_mix_yesterday.total_gwh,85);
  assert.deepEqual(out.generation_mix_yesterday.by_fuel.map(f=>[f.fuel,f.gwh,f.share_pct]),[["nuclear",50,58.8],["offshore wind",20,23.5],["natural gas",10,11.8],["other",5,5.9]]);
  assert.match(out.key_facts.find(f=>f.startsWith("CO2")),/average of the 20 of 24 hourly values published so far\): 100 g CO2eq\/kWh for electricity produced in Belgium, 118 g for electricity consumed in Belgium \(imports counted\); cleanest hour from 18:00 \(80 g\)\./);
  assert.ok(out.key_facts.some(f=>/no day-ahead electricity market price \(EPEX SPOT\)/.test(f)),"what Elia does not publish is said");
  assert.equal(out.complete,undefined);assert.equal(out.provenance.licence,"CC BY 4.0");assert.match(out.provenance.citation,/^Elia Transmission Belgium SA, Elia Open Data \(ods002, /);
}
{ // a service that does not answer is named, and the answer is marked partial
  const {out}=await run({},{down:["ods160"]});
  assert.equal(out.complete,false);assert.equal(out.cross_border,undefined);
  assert.match(out.key_facts.find(f=>f.startsWith("Incomplete")),/^Incomplete: Elia did not answer for cross-border flows just now; ask again in a minute for those\.$/);
  assert.match((await run({},{down:["ods002","ods210","ods086"]})).out.error,/^Elia Open Data did not answer .*try again in a minute\.$/);
}
{ // a past summer day: measurements only, energies in GWh, past tense, negative prices counted
  const {out,calls}=await run({date:"2026-06-21"});
  assert.deepEqual(checkAnswer(out),[]);
  assert.ok(calls.some(c=>c.ds==="ods032")&&!calls.some(c=>c.ds==="ods209"),"before 26 Oct 2026 solar history is ods032");
  assert.equal(out.load.gwh,192.3);assert.equal(out.load.peak_time,"12:00");assert.equal(out.solar.gwh,40);assert.equal(out.wind.gwh,7.2);assert.equal(out.wind.offshore_gwh,4.8);
  assert.match(out.key_facts[0],/^Sunday, 21 June 2026 \(Brussels time, Elia's measurements\): consumption \(total load\) 192\.3 GWh, peak 9,000 MW at 12:00; solar 40 GWh \(peak 4,000 MW at 08:00\), wind 7\.2 GWh \(4\.8 offshore\), together 25 % of consumption\.$/);
  assert.match(out.key_facts[1],/^Over the day, Belgium was a net exporter, 1 GWh \(exporting to the Netherlands 2 GWh, importing from France 1 GWh\)\.$/);
  assert.match(out.key_facts[2],/; 5 of 96 quarter-hours below zero\.$/);
  assert.equal(out.generation_mix.by_fuel[0].fuel,"solar");
}
{ // before the series start: said, not invented
  const {out}=await run({date:"2016-01-10"});
  assert.ok(out.key_facts.some(f=>/^Solar estimates in Elia's open data start in October 2020/.test(f)));
  assert.ok(out.key_facts.some(f=>/current imbalance-price series starts on 22 May 2024/.test(f)));
  assert.ok(out.key_facts.some(f=>/CO2 intensity series starts in October 2024/.test(f)));
  assert.equal(out.solar,undefined);
}
{ // 8 days ahead: only solar is forecast that far; load and wind are named as beyond the horizon, and not asked
  const {out,calls}=await run({date:"2026-11-24"});
  assert.deepEqual(calls.map(c=>c.ds),["ods210"]);
  assert.equal(out.mode,"forecast");assert.equal(out.days_ahead,8);
  assert.match(out.key_facts.find(f=>f.startsWith("Elia does not forecast")),/^Elia does not forecast load \(up to 7 days ahead\), wind \(up to 6 days\) for 2026-11-24\.$/);
}
{ // dates people write, and dates out of range
  assert.equal((await run({date:"gisteren"})).out.date,"2026-11-15");
  assert.equal((await run({date:"Tomorrow"})).out.date,"2026-11-17");
  assert.match((await run({date:"next week"})).out.error,/^date: give a day as YYYY-MM-DD/);
  assert.match((await run({date:"2026-02-30"})).out.error,/^date: give a day as YYYY-MM-DD/);
  assert.match((await run({date:"2014-12-31"})).out.error,/starts on 1 January 2015/);
  assert.match((await run({date:"2026-11-27"})).out.error,/at most 10 days ahead/);
}
console.log(JSON.stringify({ok:true,tests:"electricity_grid: Brussels days, now, flows, imbalance, mix, CO2, past, forecast horizons, partial answers"}));
