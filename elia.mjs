// electricity_grid: Belgium's electricity system from Elia, the transmission system operator, as an answer for now, for a day in the past
// or for the coming days: consumption (total load), solar and wind production, cross-border flows, the imbalance price, the
// generation mix by fuel and the CO2 intensity.
//
// Source: Elia Open Data (opendata.elia.be, Opendatasoft Explore API v2.1), CC BY 4.0, attribution "Elia Transmission Belgium SA", no key.
//   ods002 total load, near real time (today from 00:00 Brussels time, forecasts up to 4 days)      ods001 the same, history since 2015
//   ods210 solar, near real time (forecasts up to 10 days)   ods209 history since 26 Oct 2026   ods032 history Oct 2020 - 25 Oct 2026
//   ods086 wind, near real time (forecasts up to 6 days)     ods031 history since 2015
//   ods160 physical flow per border, near real time          ods026 history since 2015
//   ods162 imbalance price per quarter-hour, near real time  ods134 history since 22 May 2024
//   ods201 generation by fuel type (to this morning), since 2020        ods192 CO2 intensity per hour (to yesterday), since Oct 2024
//
// What makes the answers true:
// - Every value is the average power (MW) over a quarter-hour that STARTS at `datetime` (UTC). A day's energy is the sum x 0.25 h.
//   Days are Brussels days (23 h, 24 h or 25 h around the clock change).
// - Solar and wind are Elia's estimates for ALL installations (rooftop panels included), upscaled from monitored parks; the total load
//   is "based on a combination of computation, measurements and extrapolation" and includes estimated losses. They are said to be so.
// - Wind has no Belgian total row: offshore (federal) and onshore Flanders and Wallonia, Elia- and DSO-connected, are summed here.
//   Solar has one (region Belgium, connection Total) and only that row is read, so regions are never counted twice.
// - Flows and net position: positive = Belgium exports, negative = imports (Elia's convention, kept and said).
// - The imbalance price settles balance-responsible parties' deviations. It is not what households pay and not the day-ahead market
//   price (EPEX SPOT, which Elia does not publish). A positive system imbalance is a surplus (the price then follows the downward
//   marginal price), a negative one a shortage.
import { getJson, clean, round } from "./lib/tool-kit.mjs";

const BASE="https://opendata.elia.be/api/explore/v2.1/catalog/datasets/";
export const ELIA_HOSTS=Object.freeze(["opendata.elia.be"]);
const TZ="Europe/Brussels",HOUR_MS=36e5,LIVE_TTL=300,PAST_TTL=6*3600;
const FIRST={load:"2015-01-01",wind:"2015-01-01",flows:"2015-01-01",solar:"2020-10-01",mix:"2015-01-01",imbalance:"2024-05-22",co2:"2024-10-01"};
const SOLAR_SPLIT="2026-10-26";   // ods032 up to 25 Oct 2026, ods209 from 26 Oct 2026
const HORIZON={load:7,wind:6,solar:10};   // forecast days ahead (ods001, ods086, ods210)
const BORDER={France:"France",Netherlands:"the Netherlands",Germany:"Germany",Luxembourg:"Luxembourg","United Kingdom":"the United Kingdom",UnitedKingdom:"the United Kingdom"};
const FUEL_EN={Nuclear:"nuclear","Natural Gas":"natural gas","Wind Offshore":"offshore wind","Wind Onshore":"onshore wind",Solar:"solar",Water:"hydro (incl. pumped storage)",
  Biofuels:"biofuels","Energy Storage":"energy storage","Other Fossil Fuels":"other fossil fuels",Other:"other"};

// ---------- time ----------
const partsOf=ms=>Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false})
  .formatToParts(new Date(ms)).map(p=>[p.type,p.value]));
export const localDay=ms=>{const p=partsOf(ms);return p.year+"-"+p.month+"-"+p.day};
export const localHM=ms=>{const p=partsOf(ms);return(p.hour==="24"?"00":p.hour)+":"+p.minute};
export const addDays=(d,n)=>new Date(Date.parse(d+"T12:00:00Z")+n*864e5).toISOString().slice(0,10);
/** The UTC instant of 00:00 Brussels time on local date d (UTC+1 in winter, UTC+2 in summer). */
export function dayStartUtc(d){
  for(const h of [1,2]){const ms=Date.parse(d+"T00:00:00Z")-h*HOUR_MS;if(localDay(ms)===d&&localHM(ms)==="00:00")return ms}
  return Date.parse(d+"T00:00:00Z")-HOUR_MS;
}
const iso=ms=>new Date(ms).toISOString().replace(".000Z","Z");
const windowWhere=(from,to)=>'datetime >= "'+iso(from)+'" and datetime < "'+iso(to)+'"';
const dayLabel=d=>new Intl.DateTimeFormat("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(d+"T12:00:00Z"));
const shortDay=d=>new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",timeZone:"UTC"}).format(new Date(d+"T12:00:00Z"));

// ---------- numbers ----------
const nf=n=>n==null?null:Math.round(n).toLocaleString("en-US");
const gwh=mwSum=>round(mwSum*0.25/1000,1);   // sum of quarter-hour MW -> GWh
const pctOf=(a,b)=>a==null||!b?null:round(100*a/b,0);
const sumOf=(rows,f)=>rows.reduce((s,r)=>s+(Number.isFinite(r[f])?r[f]:0),0);

// ---------- Elia Explore API ----------
async function ods(client,ds,params,{ttl=LIVE_TTL,records=false}={}){
  const q=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null&&v!=="").map(([k,v])=>[k,String(v)]));
  const r=await getJson(client,BASE+ds+(records?"/records?":"/exports/json?")+q,{maxBytes:1<<20,ttl});
  if(r.error)return{error:r.error};
  const rows=records?r.json?.results:r.json;
  if(!Array.isArray(rows))return{error:"Elia Open Data answered without records"+(r.json?.message?": "+String(r.json.message).slice(0,140):"")};
  return{rows};
}
const byTime=rows=>new Map(rows.map(r=>[r.t,r]));

/** Load per quarter-hour: measured where there is a measurement, else the most recent forecast (with its 80 % band). */
async function loadSeries(client,from,to,{history}){
  const r=await ods(client,history?"ods001":"ods002",{select:"datetime,"+(history?"totalload":"measured")+",mostrecentforecast,mostrecentconfidence10,mostrecentconfidence90",
    where:windowWhere(from,to),order_by:"datetime"},{ttl:history&&to<=Date.now()?PAST_TTL:LIVE_TTL});
  if(r.error)return r;
  return{rows:r.rows.map(x=>({t:Date.parse(x.datetime),measured:x[history?"totalload":"measured"]??null,forecast:x.mostrecentforecast??null,lo:x.mostrecentconfidence10??null,hi:x.mostrecentconfidence90??null}))};
}
/** Solar for Belgium as a whole (one row per quarter-hour, never the regions). */
async function solarSeries(client,from,to,day){
  // the near-real-time set starts at 00:00 today (Brussels), so only a window that reaches into today or later reads it
  const live=day>=SOLAR_SPLIT&&to>dayStartUtc(localDay(Date.now())),ds=day<SOLAR_SPLIT?"ods032":live?"ods210":"ods209";
  const field=ds==="ods209"?"measured_upscaled":"measured";
  const where='region = "Belgium"'+(ds==="ods032"?"":' and gridconnectiontype = "Total"')+" and "+windowWhere(from,to);
  let r=await ods(client,ds,{select:"datetime,"+field+",mostrecentforecast,monitoredcapacity",where,order_by:"datetime"},{ttl:live?LIVE_TTL:PAST_TTL});
  // yesterday sits in the history set once the near-real-time window has moved on
  if(!r.error&&!r.rows.length&&ds==="ods210"){r=await ods(client,"ods209",{select:"datetime,measured_upscaled as measured,mostrecentforecast,monitoredcapacity",where,order_by:"datetime"},{ttl:PAST_TTL})}
  if(r.error)return r;
  return{dataset:ds,rows:r.rows.map(x=>({t:Date.parse(x.datetime),measured:x[field]??x.measured??null,forecast:x.mostrecentforecast??null,capacity:x.monitoredcapacity??null}))};
}
/** Wind summed over offshore and the onshore regions and grid connections, per quarter-hour, with the offshore part. */
async function windSeries(client,from,to,{history}){
  const m=history?"measured":"realtime";
  const r=await ods(client,history?"ods031":"ods086",{select:"datetime,offshoreonshore,sum("+m+") as mw,count("+m+") as n,sum(mostrecentforecast) as f,sum(monitoredcapacity) as cap",
    group_by:"datetime,offshoreonshore",where:windowWhere(from,to),order_by:"datetime"},{ttl:history&&to<=Date.now()?PAST_TTL:LIVE_TTL});
  if(r.error)return r;
  const q=new Map();
  for(const x of r.rows){const t=Date.parse(x.datetime),e=q.get(t)||{t,measured:0,mcount:0,forecast:0,offshore:0,offshoreForecast:0,capacity:0};
    const off=/off/i.test(x.offshoreonshore||"");
    if(x.n>0){e.measured+=x.mw||0;e.mcount+=x.n;if(off)e.offshore+=x.mw||0}
    e.forecast+=x.f||0;if(off)e.offshoreForecast+=x.f||0;e.capacity+=x.cap||0;q.set(t,e)}
  return{rows:[...q.values()].sort((a,b)=>a.t-b.t).map(e=>({t:e.t,measured:e.mcount?e.measured:null,offshore:e.mcount?e.offshore:null,forecast:e.forecast,offshoreForecast:e.offshoreForecast,capacity:e.capacity||null}))};
}
const best=x=>x.measured??x.forecast;

/** One Brussels day from a series: energy, peak, and how much of it is measured rather than forecast. */
function daySummary(rows,from,to){
  const d=rows.filter(x=>x.t>=from&&x.t<to&&best(x)!=null);
  if(!d.length)return null;
  const peak=d.reduce((a,b)=>best(b)>best(a)?b:a);
  const measured=d.filter(x=>x.measured!=null);
  return{gwh:gwh(sumOf(d.map(x=>({v:best(x)})),"v")),peak_mw:round(best(peak),0),peak_time:localHM(peak.t),peak_range_mw:peak.measured==null&&peak.lo!=null?[round(peak.lo,0),round(peak.hi,0)]:null,
    quarter_hours:d.length,measured_quarter_hours:measured.length,measured_until:measured.length?localHM(measured.at(-1).t+15*60e3):null,complete:d.length>=92};
}

// ---------- the answer ----------
const DATE_WORDS={today:0,vandaag:0,"aujourd'hui":0,aujourdhui:0,heute:0,tomorrow:1,morgen:1,demain:1,yesterday:-1,gisteren:-1,hier:-1,gestern:-1};
function parseDate(raw,today){
  if(raw==null||String(raw).trim()==="")return{date:today};
  const s=String(raw).trim().toLowerCase();
  if(s in DATE_WORDS)return{date:addDays(today,DATE_WORDS[s])};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s+"T12:00:00Z"))||new Date(s+"T12:00:00Z").toISOString().slice(0,10)!==s)
    return{error:"date: give a day as YYYY-MM-DD (e.g. '2026-11-15'), or 'today', 'tomorrow' or 'yesterday'."};
  if(s<FIRST.load)return{error:"date: Elia's open data starts on 1 January 2015; "+s+" is earlier."};
  if(s>addDays(today,HORIZON.solar))return{error:"date: Elia forecasts at most "+HORIZON.solar+" days ahead (solar; load "+HORIZON.load+", wind "+HORIZON.wind+"), so up to "+addDays(today,HORIZON.solar)+"."};
  return{date:s};
}

export async function electricityGrid(client,args){
  const now=Date.now(),today=localDay(now),p=parseDate(args?.date,today);
  if(p.error)return{error:p.error};
  const day=p.date;
  if(day===today)return todayAnswer(client,today,now);
  if(day<today)return pastAnswer(client,day,today);
  return futureAnswer(client,day,today);
}

const PROV_BASE={source:"Elia Transmission Belgium SA, Elia Open Data",licence:"CC BY 4.0",url:"https://opendata.elia.be",
  terms:"https://opendata.elia.be/pages/licence/"};
const provenance=(datasets,on)=>({...PROV_BASE,datasets,citation:"Elia Transmission Belgium SA, Elia Open Data ("+datasets.join(", ")+"), CC BY 4.0, consulted on "+on+"."});
const DEFINITIONS={
  load:"Total load: all electricity taken from the Elia grid and the distribution grids connected to it, including estimated losses; Elia computes it from measurements and extrapolation.",
  solar_wind:"Solar and wind are Elia's estimates for all installations in Belgium (rooftop panels and small turbines included), upscaled from monitored parks.",
  flows:"Physical flow at each border: positive means Belgium exports, negative means it imports.",
  imbalance_price:"The imbalance price (EUR/MWh, per quarter-hour) settles the deviations of balance-responsible parties. It is not a household tariff and not the day-ahead market price (EPEX SPOT), which Elia does not publish.",
  system_imbalance:"System imbalance: positive is a surplus in the Belgian control area, negative a shortage.",
  co2_intensity:"CO2 intensity in g CO2-equivalent per kWh: production-based for electricity generated in Belgium, consumption-based for electricity used in Belgium (imports counted)."
};

/** Yesterday's (or a past day's) mix by fuel, CO2, imbalance and flows: the parts shared by "today" and "a past day". */
async function mixOf(client,from,to){
  const r=await ods(client,"ods201",{select:"fueltypepublication,sum(generatedpower) as mw",group_by:"fueltypepublication",where:windowWhere(from,to)},{ttl:PAST_TTL,records:true});
  if(r.error)return r;
  const rows=r.rows.filter(x=>Number.isFinite(x.mw)&&x.mw>0),total=sumOf(rows,"mw");
  if(!total)return{none:true};
  return{total_gwh:gwh(total),by_fuel:rows.sort((a,b)=>b.mw-a.mw).map(x=>({fuel:FUEL_EN[x.fueltypepublication]||String(x.fueltypepublication).toLowerCase(),elia_fuel_type:x.fueltypepublication,gwh:gwh(x.mw),share_pct:round(100*x.mw/total,1)}))};
}
/**
 * The first day Elia's generation-by-fuel dataset (ods201) holds now. Elia changes what it keeps: on 2026-11-18 it held only data from
 * 2026-10-05, though it once went back to 2020. Asked rather than assumed, so a missing mix is explained with the real start date.
 */
async function mixStart(client){
  const r=await ods(client,"ods201",{select:"min(datetime) as first"},{ttl:PAST_TTL,records:true});
  const v=r.rows?.[0]?.first;
  return v?String(v).slice(0,10):null;
}
async function co2Of(client,from,to){
  const r=await ods(client,"ods192",{select:"datetime,production,consumption",where:windowWhere(from,to),order_by:"datetime"},{ttl:PAST_TTL});
  if(r.error)return r;
  const rows=r.rows.filter(x=>Number.isFinite(x.production)||Number.isFinite(x.consumption));
  if(!rows.length)return{none:true};
  const avg=f=>{const v=rows.map(x=>x[f]).filter(Number.isFinite);return v.length?round(v.reduce((a,b)=>a+b,0)/v.length,0):null};
  const lo=rows.reduce((a,b)=>(b.consumption??Infinity)<(a.consumption??Infinity)?b:a),hi=rows.reduce((a,b)=>(b.consumption??-Infinity)>(a.consumption??-Infinity)?b:a);
  return{hours:rows.length,hours_in_day:Math.round((to-from)/HOUR_MS),production_based_g_per_kwh:avg("production"),consumption_based_g_per_kwh:avg("consumption"),
    cleanest_hour:{start:localHM(Date.parse(lo.datetime)),consumption_based_g_per_kwh:round(lo.consumption,0)},dirtiest_hour:{start:localHM(Date.parse(hi.datetime)),consumption_based_g_per_kwh:round(hi.consumption,0)},
    note:"Average of Elia's hourly values (not weighted by consumption)."};
}
function imbalanceStats(rows){
  const v=rows.filter(x=>Number.isFinite(x.imbalanceprice));
  if(!v.length)return null;
  const prices=v.map(x=>x.imbalanceprice),lo=v.reduce((a,b)=>b.imbalanceprice<a.imbalanceprice?b:a),hi=v.reduce((a,b)=>b.imbalanceprice>a.imbalanceprice?b:a);
  return{quarter_hours:v.length,average_eur_mwh:round(prices.reduce((a,b)=>a+b,0)/v.length,1),lowest:{eur_mwh:round(lo.imbalanceprice,1),start:localHM(Date.parse(lo.datetime))},
    highest:{eur_mwh:round(hi.imbalanceprice,1),start:localHM(Date.parse(hi.datetime))},negative_quarter_hours:v.filter(x=>x.imbalanceprice<0).length};
}
const eur=v=>(v<0?"-€":"€")+nf(Math.abs(v));
function mixFact(label,mix){
  const top=mix.by_fuel.slice(0,5).map(f=>f.fuel+" "+f.gwh+" GWh ("+Math.round(f.share_pct)+" %)").join(", ");
  return"Electricity generated in Belgium "+label+": "+mix.total_gwh+" GWh, of which "+top+" (Elia, by fuel type; solar and wind are estimates).";
}
function co2Fact(label,co2){
  return"CO2 intensity "+label+" (Elia, average of "+(co2.hours<co2.hours_in_day?"the "+co2.hours+" of "+co2.hours_in_day+" hourly values published so far":co2.hours+" hourly values")+"): "+co2.production_based_g_per_kwh+" g CO2eq/kWh for electricity produced in Belgium, "+
    co2.consumption_based_g_per_kwh+" g for electricity consumed in Belgium (imports counted); cleanest hour from "+co2.cleanest_hour.start+" ("+co2.cleanest_hour.consumption_based_g_per_kwh+" g).";
}
function flowsFact(prefix,borders,net,unit,past=false){
  const is=past?"was":"is";
  const parts=borders.filter(b=>Math.abs(b.v)>=(unit==="MW"?1:0.05)).sort((a,b)=>Math.abs(b.v)-Math.abs(a.v))
    .map(b=>(b.v>0?"exporting to ":"importing from ")+b.name+" "+(unit==="MW"?nf(Math.abs(b.v))+" MW":round(Math.abs(b.v),1)+" GWh"));
  const n=unit==="MW"?nf(Math.abs(net))+" MW":round(Math.abs(net),1)+" GWh";
  return prefix+(net>0?"Belgium "+is+" a net exporter, "+n:net<0?"Belgium "+is+" a net importer, "+n:"Belgium's imports and exports "+(past?"were":"are")+" balanced")+(parts.length?" ("+parts.join(", ")+")":"")+".";
}
const CAVEAT="Elia's figures for solar and wind cover all installations (rooftop panels included) and are estimates upscaled from monitored parks; the total load includes estimated grid losses.";
const NO_DAY_AHEAD="Elia's open data has no day-ahead electricity market price (EPEX SPOT); the imbalance price is a settlement price for balance-responsible parties, not what households pay.";

async function todayAnswer(client,today,now){
  const t0=dayStartUtc(today),t1=dayStartUtc(addDays(today,1)),t2=dayStartUtc(addDays(today,2)),yesterday=addDays(today,-1),y0=dayStartUtc(yesterday);
  const [load,solar,wind,flows,imb,mix,co2]=await Promise.all([
    loadSeries(client,t0,t2,{history:false}),solarSeries(client,t0,t2,today),windSeries(client,t0,t2,{history:false}),
    ods(client,"ods160",{select:"datetime,controlarea,physicalflowatborder",order_by:"datetime desc",limit:"12"},{records:true}),
    ods(client,"ods162",{select:"datetime,qualitystatus,systemimbalance,imbalanceprice",where:windowWhere(t0,t1),order_by:"datetime"}),
    mixOf(client,y0,t0),co2Of(client,y0,t0)]);
  if(load.error&&solar.error&&wind.error)return{error:"Elia Open Data did not answer ("+load.error+"); try again in a minute."};
  const facts=[],out={mode:"today",date:today,timezone:TZ};
  const failed=[load.error&&"load",solar.error&&"solar",wind.error&&"wind",flows.error&&"cross-border flows",imb.error&&"imbalance prices",mix.error&&"generation mix",co2.error&&"CO2 intensity"].filter(Boolean);
  // now: the latest quarter-hour that has load, solar and wind measured, so the shares compare like with like
  const L=load.rows||[],S=solar.rows||[],W=wind.rows||[];
  const lastM=rows=>{const m=rows.filter(x=>x.measured!=null);return m.length?m.at(-1).t:null};
  const tl=lastM(L),ts=lastM(S),tw=lastM(W);
  if(tl!=null){
    const t=Math.min(tl,ts??tl,tw??tl),lr=byTime(L).get(t),sr=byTime(S).get(t),wr=byTime(W).get(t);
    const lm=lr?.measured,sm=sr?.measured??null,wm=wr?.measured??null;
    out.now=clean({quarter_hour_start:localHM(t),quarter_hour_start_utc:iso(t),load_mw:round(lm,0),solar_mw:round(sm,0),wind_mw:round(wm,0),offshore_wind_mw:round(wr?.offshore,0),
      onshore_wind_mw:wm!=null&&wr?.offshore!=null?round(wm-wr.offshore,0):null,solar_and_wind_share_of_load_pct:lm&&sm!=null&&wm!=null?pctOf(sm+wm,lm):null,
      solar_capacity_mw:round(sr?.capacity,0),wind_capacity_mw:round(wr?.capacity,0)});
    let f="Belgian electricity system at "+localHM(t)+" Brussels time today ("+shortDay(today)+", quarter-hour average): consumption (total load) "+nf(lm)+" MW";
    if(sm!=null&&wm!=null)f+="; solar "+nf(sm)+" MW and wind "+nf(wm)+" MW"+(wr?.offshore!=null?" ("+nf(wr.offshore)+" offshore)":"")+", together "+pctOf(sm+wm,lm)+" % of the load";
    facts.push(f+".");
  }else facts.push("Elia has not published a measurement for today yet (the first quarter-hours after midnight); the figures below are forecasts.");
  // flows: the latest quarter-hour that has every border
  if(flows.rows?.length){
    // the latest quarter-hour for which every border is published (the newest one may still be filling in)
    const per=new Map();for(const x of flows.rows)if(Number.isFinite(x.physicalflowatborder)){const k=Date.parse(x.datetime);per.set(k,(per.get(k)||0)+1)}
    const most=Math.max(...per.values()),tmax=Math.max(...[...per].filter(([,n])=>n===most).map(([k])=>k));
    const cur=flows.rows.filter(x=>Date.parse(x.datetime)===tmax&&Number.isFinite(x.physicalflowatborder));
    const borders=cur.map(x=>({name:BORDER[x.controlarea]||x.controlarea,v:x.physicalflowatborder})),net=sumOf(borders,"v");
    out.cross_border=clean({quarter_hour_start:localHM(tmax),net_export_mw:round(net,0),borders:borders.map(b=>({border:b.name.replace(/^the /,""),flow_mw:round(b.v,0),direction:b.v>0?"export":"import"}))});
    facts.push(flowsFact("Cross-border flows at "+localHM(tmax)+": ",borders,net,"MW"));
  }
  // today and tomorrow
  const td=clean({load:daySummary(L,t0,t1),solar:daySummary(S,t0,t1),wind:daySummary(W,t0,t1)}),tm=clean({load:daySummary(L,t1,t2),solar:daySummary(S,t1,t2),wind:daySummary(W,t1,t2)});
  out.today=td;out.tomorrow=tm;
  if(td.load){
    const share=td.solar&&td.wind?pctOf(td.solar.gwh+td.wind.gwh,td.load.gwh):null;
    facts.push("Today as a whole (measured until "+(td.load.measured_until||"now")+", then Elia's forecast): peak load about "+nf(td.load.peak_mw)+" MW at "+td.load.peak_time+", consumption about "+
      td.load.gwh+" GWh"+(td.solar&&td.wind?"; solar about "+td.solar.gwh+" GWh and wind "+td.wind.gwh+" GWh, together "+share+" % of it":"")+".");
  }
  if(tm.load||tm.solar||tm.wind){
    const L2=tm.load;
    facts.push("Tomorrow ("+dayLabel(addDays(today,1)).replace(/ \d{4}$/,"")+", Elia's forecast): "+[L2&&"peak load "+nf(L2.peak_mw)+" MW around "+L2.peak_time+(L2.peak_range_mw?" (80 % range "+nf(L2.peak_range_mw[0])+"–"+nf(L2.peak_range_mw[1])+" MW)":""),
      tm.solar&&"solar "+tm.solar.gwh+" GWh",tm.wind&&"wind "+tm.wind.gwh+" GWh"].filter(Boolean).join(", ")+".");
  }
  // imbalance price
  if(imb.rows?.length){
    const v=imb.rows.filter(x=>Number.isFinite(x.imbalanceprice)),last=v.at(-1),st=imbalanceStats(v);
    if(last){
      const s=last.systemimbalance,t=Date.parse(last.datetime);
      out.imbalance=clean({last_quarter_hour:clean({start:localHM(t),start_utc:iso(t),price_eur_mwh:round(last.imbalanceprice,2),system_imbalance_mw:round(s,0),
        state:s>0?"surplus":s<0?"shortage":"balanced",quality:last.qualitystatus}),today_so_far:st});
      facts.push("Imbalance price for "+localHM(t)+"–"+localHM(t+15*60e3)+": "+eur(last.imbalanceprice)+"/MWh (system "+(s>0?"in surplus by "+nf(s):s<0?"short by "+nf(-s):"balanced")+" MW, "+
        "Elia's quality flag: "+String(last.qualitystatus||"none").replace(/([a-z])([A-Z])/g,"$1 $2").toLowerCase()+"); today so far average "+eur(st.average_eur_mwh)+", lowest "+eur(st.lowest.eur_mwh)+" at "+st.lowest.start+", highest "+
        eur(st.highest.eur_mwh)+" at "+st.highest.start+(st.negative_quarter_hours?", "+st.negative_quarter_hours+(st.negative_quarter_hours===1?" quarter-hour":" quarter-hours")+" below zero":"")+".");
    }
  }
  if(mix.by_fuel){out.generation_mix_yesterday={date:yesterday,...mix};facts.push(mixFact("yesterday ("+shortDay(yesterday)+")",mix))}
  if(co2.hours){out.co2_intensity_yesterday={date:yesterday,...co2};facts.push(co2Fact("yesterday",co2))}
  if(failed.length)facts.push("Incomplete: Elia did not answer for "+failed.join(", ")+" just now; ask again in a minute for those.");
  facts.push(NO_DAY_AHEAD);
  facts.push(CAVEAT);
  const ds=["ods002","ods210","ods086","ods160","ods162","ods201","ods192"];
  return clean({key_facts:facts.slice(0,10),...out,complete:failed.length?false:null,definitions:DEFINITIONS,provenance:provenance(ds,today)});
}

async function pastAnswer(client,day,today){
  const f=dayStartUtc(day),t=dayStartUtc(addDays(day,1)),has=k=>day>=FIRST[k];
  const none={rows:[]};
  const [load,solar,wind,mix,co2,imb,flows]=await Promise.all([
    loadSeries(client,f,t,{history:true}),has("solar")?solarSeries(client,f,t,day):none,windSeries(client,f,t,{history:true}),
    has("mix")?mixOf(client,f,t):{none:true},has("co2")?co2Of(client,f,t):{none:true},
    has("imbalance")?ods(client,"ods134",{select:"datetime,systemimbalance,imbalanceprice",where:windowWhere(f,t),order_by:"datetime"},{ttl:PAST_TTL}):none,
    ods(client,"ods026",{select:"controlarea,sum(physicalflowatborder) as mw,count(physicalflowatborder) as n",group_by:"controlarea",where:windowWhere(f,t)},{ttl:PAST_TTL,records:true})]);
  if(load.error&&wind.error)return{error:"Elia Open Data did not answer ("+load.error+"); try again in a minute."};
  const facts=[],out={mode:"past_day",date:day,timezone:TZ};
  const failed=[load.error&&"load",solar.error&&"solar",wind.error&&"wind",flows.error&&"cross-border flows",imb.error&&"imbalance prices",mix.error&&"generation mix",co2.error&&"CO2 intensity"].filter(Boolean);
  const Ld=daySummary((load.rows||[]).map(x=>({...x,forecast:null})),f,t),Sd=daySummary((solar.rows||[]).map(x=>({...x,forecast:null})),f,t),Wd=daySummary((wind.rows||[]).map(x=>({...x,forecast:null})),f,t);
  const strip=s=>s&&clean({gwh:s.gwh,peak_mw:s.peak_mw,peak_time:s.peak_time,quarter_hours:s.quarter_hours,complete:s.complete});
  out.load=strip(Ld);out.solar=strip(Sd);out.wind=strip(Wd);
  if(Wd){const off=(wind.rows||[]).filter(x=>x.t>=f&&x.t<t&&x.offshore!=null);out.wind.offshore_gwh=gwh(sumOf(off,"offshore"))}
  if(Ld){
    const share=Sd&&Wd?pctOf(Sd.gwh+Wd.gwh,Ld.gwh):null;
    facts.push(dayLabel(day)+" (Brussels time, Elia's measurements): consumption (total load) "+Ld.gwh+" GWh, peak "+nf(Ld.peak_mw)+" MW at "+Ld.peak_time+
      (Sd||Wd?"; "+[Sd&&"solar "+Sd.gwh+" GWh (peak "+nf(Sd.peak_mw)+" MW at "+Sd.peak_time+")",Wd&&"wind "+Wd.gwh+" GWh ("+out.wind.offshore_gwh+" offshore)"].filter(Boolean).join(", ")+(share!=null?", together "+share+" % of consumption":""):"")+
      (Ld.complete?"":" (the day is incomplete in Elia's data: "+Ld.quarter_hours+" quarter-hours)")+".");
  }
  if(!has("solar"))facts.push("Solar estimates in Elia's open data start in October 2020, so there is none for "+day+".");
  if(flows.rows?.length){
    const borders=flows.rows.filter(x=>Number.isFinite(x.mw)).map(x=>({name:BORDER[x.controlarea]||x.controlarea,v:x.mw*0.25/1000})),net=sumOf(borders,"v");
    out.cross_border=clean({net_export_gwh:round(net,1),borders:borders.map(b=>({border:b.name.replace(/^the /,""),net_flow_gwh:round(b.v,1),direction:b.v>0?"export":"import"}))});
    facts.push(flowsFact("Over the day, ",borders,net,"GWh",true));
  }
  const st=imb.rows?imbalanceStats(imb.rows):null;
  if(st){out.imbalance=st;facts.push("Imbalance price that day: average "+eur(st.average_eur_mwh)+"/MWh, lowest "+eur(st.lowest.eur_mwh)+" at "+st.lowest.start+", highest "+eur(st.highest.eur_mwh)+" at "+st.highest.start+
    (st.negative_quarter_hours?"; "+st.negative_quarter_hours+" of "+st.quarter_hours+" quarter-hours below zero":"; no quarter-hour below zero")+".")}
  else if(!has("imbalance"))facts.push("Elia's current imbalance-price series starts on 22 May 2024; older prices sit in a separate archive this tool does not read, so none for "+day+".");
  if(mix.by_fuel){out.generation_mix={...mix};facts.push(mixFact("that day",mix))}
  else if(!mix.error){
    // no mix for that day: say why, with the date Elia's dataset starts today, instead of leaving it out silently
    const first=await mixStart(client);
    out.generation_mix_unavailable={reason:"Elia's generation-by-fuel dataset (ods201) has no records for "+day+(first?"; it currently starts on "+first:"")+".",...(first?{dataset_starts:first}:{})};
    facts.push("Generation by fuel: none for "+day+". Elia's dataset (ods201) "+(first?"currently starts on "+first+"; Elia keeps only recent data there.":"has no records for that day."));
  }
  if(co2.hours){out.co2_intensity={...co2};facts.push(co2Fact("that day",co2))}else if(!has("co2"))facts.push("Elia's CO2 intensity series starts in October 2024.");
  if(failed.length)facts.push("Incomplete: Elia did not answer for "+failed.join(", ")+" just now; ask again in a minute for those.");
  facts.push(CAVEAT);
  const ds=["ods001",day<SOLAR_SPLIT?"ods032":"ods209","ods031","ods026","ods134","ods201","ods192"];
  return clean({key_facts:facts.slice(0,10),...out,complete:failed.length?false:null,definitions:DEFINITIONS,provenance:provenance(ds,today)});
}

async function futureAnswer(client,day,today){
  const f=dayStartUtc(day),t=dayStartUtc(addDays(day,1)),ahead=Math.round((Date.parse(day)-Date.parse(today))/864e5);
  const none={rows:[]};
  const [load,solar,wind]=await Promise.all([ahead<=HORIZON.load?loadSeries(client,f,t,{history:true}):none,ahead<=HORIZON.solar?solarSeries(client,f,t,day):none,
    ahead<=HORIZON.wind?windSeries(client,f,t,{history:false}):none]);
  if(load.error&&solar.error&&wind.error)return{error:"Elia Open Data did not answer ("+load.error+"); try again in a minute."};
  const out={mode:"forecast",date:day,days_ahead:ahead,timezone:TZ},facts=[];
  const failed=[load.error&&"load",solar.error&&"solar",wind.error&&"wind"].filter(Boolean);
  const Ld=daySummary(load.rows||[],f,t),Sd=daySummary(solar.rows||[],f,t),Wd=daySummary(wind.rows||[],f,t);
  out.load=Ld;out.solar=Sd;out.wind=Wd;
  const parts=[Ld&&"peak load "+nf(Ld.peak_mw)+" MW around "+Ld.peak_time+(Ld.peak_range_mw?" (80 % range "+nf(Ld.peak_range_mw[0])+"–"+nf(Ld.peak_range_mw[1])+" MW)":"")+", consumption about "+Ld.gwh+" GWh",
    Sd&&"solar about "+Sd.gwh+" GWh (peak "+nf(Sd.peak_mw)+" MW at "+Sd.peak_time+")",Wd&&"wind about "+Wd.gwh+" GWh"].filter(Boolean);
  if(parts.length)facts.push(dayLabel(day)+", Elia's forecast ("+ahead+" day"+(ahead>1?"s":"")+" ahead): "+parts.join("; ")+(Ld&&Sd&&Wd?"; solar and wind together about "+pctOf(Sd.gwh+Wd.gwh,Ld.gwh)+" % of consumption":"")+".");
  const missing=[!Ld&&!load.error&&"load (up to "+HORIZON.load+" days ahead)",!Sd&&!solar.error&&"solar (up to "+HORIZON.solar+" days)",!Wd&&!wind.error&&"wind (up to "+HORIZON.wind+" days)"].filter(Boolean);
  if(missing.length)facts.push("Elia does not forecast "+missing.join(", ")+" for "+day+".");
  facts.push("Forecasts change: Elia updates them several times a day, and the further ahead, the wider the range.");
  if(failed.length)facts.push("Incomplete: Elia did not answer for "+failed.join(", ")+" just now; ask again in a minute for those.");
  facts.push(NO_DAY_AHEAD);
  return clean({key_facts:facts,...out,complete:failed.length?false:null,definitions:DEFINITIONS,provenance:provenance(["ods001","ods210","ods086"],today)});
}
