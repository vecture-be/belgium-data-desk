// weather: the weather at a place in Belgium from the Royal Meteorological Institute (KMI/IRM) open data, as an answer: what is measured
// now at the nearest station, what the last 24 hours and the last week brought, and what KMI's ALARO model forecasts for the next 48 hours
// at that point.
//
// Sources (KMI/IRM, CC BY 4.0, opendata.meteo.be, GeoServer WFS/WMS), read live and edge-cached:
// - synop:synop_data       hourly observations of about 30 synoptic stations (temperature, wind, humidity, pressure, cloud cover,
//                          precipitation in 6- or 12-hour totals)
// - aws:aws_1day           daily totals of the automatic weather stations (rain, max/min temperature, sunshine, gusts)
// - alaro:* (WMS)          the ALARO forecast model, hourly fields for about 60 hours from each run, read at the point
//
// Pitfalls handled here, which a plain client gets wrong:
// - ALARO's Total_precipitation is ACCUMULATED since the start of the run, in METRES of water: 0.0086 means 8.6 mm so far. Rain in an
//   interval is the difference of two steps x 1000 (checked against an independent model at the same point: 3.0 vs 2.9 mm).
//   Interpolation can make the accumulation dip by a hair; negative differences are 0.
// - ALARO temperatures are in kelvin; winds are u/v components (towards east/north), turned here into a speed and the compass
//   direction the wind comes FROM.
// - A WMS GetFeatureInfo answers one time per request, so the forecast is sampled: 3-hourly for 24 hours, then 6- and 12-hourly.
//   Temperature extremes come from those samples plus the model's own max/min over the hour before each sample, so a short peak
//   between samples can be missed; rain totals are exact (accumulation differences).
// - Synop precipitation is reported only at 00/06/12/18 UTC with a period code (1 = 6 h, 2 = 12 h, ...); a "last 24 hours" total is
//   assembled from non-overlapping periods, or not given.
// - KMI's weather warnings are not part of its open data; this tool says so instead of implying "no warning".
import { _dov } from "./dov.mjs";
import { placeContext } from "./place.mjs";
const {getJson,resolveLocation,clean,round,num,DAY}=_dov;

const K="https://opendata.meteo.be/service";
export const WEATHER_HOSTS=Object.freeze(["opendata.meteo.be"]);
const FC_STEPS=[0,3,6,9,12,15,18,21,24,36,48];
const LAYERS=["2_m_temperature","2_m_Max_temp_since_ppp","2_m_Min_temp_since_ppp","Total_precipitation","10_m_u__wind_component","10_m_v__wind_component",
  "SBL_Zonal_gust","SBL_Meridian_gust","Inst_flx_Tot_Cld_cover","2m_Relative_humidity","Large_scale_snow","Convective_snow"].map(l=>"alaro:"+l);

const hav=(a,b,c,d)=>{const R=6371,t=Math.PI/180,s=Math.sin((c-a)*t/2)**2+Math.cos(a*t)*Math.cos(c*t)*Math.sin((d-b)*t/2)**2;return 2*R*Math.asin(Math.sqrt(s))};
const HOUR_MS=3.6e6;
const local=(t,opts={})=>new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Brussels",weekday:opts.day?"short":undefined,day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(t));
const iso=t=>new Date(t).toISOString().slice(0,16)+"Z";
const COMPASS=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const compass=deg=>deg==null?null:COMPASS[Math.round(((deg%360)+360)%360/22.5)%16];
const kmh=ms=>ms==null?null:Math.round(ms*3.6);
const OKTAS=o=>o==null?null:o===0?"clear sky":o<=2?"mostly clear":o<=5?"partly cloudy":o<=7?"mostly cloudy":o===8?"overcast":"sky obscured (fog)";
const RANGE_H={1:6,2:12,3:18,4:24,5:1,6:2,7:3,8:9,9:15};   // SYNOP period code tR -> hours

async function wfs(client,ws,type,{cql,props,count=200,ttl}){
  const q=new URLSearchParams({service:"WFS",version:"2.0.0",request:"GetFeature",typenames:ws+":"+type,outputFormat:"application/json",count:String(count)});
  if(cql)q.set("CQL_FILTER",cql);if(props)q.set("propertyName",props.join(","));
  const r=await getJson(client,K+"/"+ws+"/ows?"+q,{maxBytes:1<<20,ttl});
  if(r.error)return{error:r.error};
  if(!Array.isArray(r.json?.features))return{error:"KMI answered without features"};
  return{rows:r.json.features.map(f=>({...f.properties,lon:f.geometry?.coordinates?.[0],lat:f.geometry?.coordinates?.[1]}))};
}
const stations=async(client,ws)=>{const r=await wfs(client,ws,ws+"_station",{ttl:7*DAY});return r.error?r:{rows:r.rows.filter(s=>!s.date_end&&s.lat&&s.lon)}};

/** The ALARO run on offer: start (the run time) and end of the hourly time dimension. */
async function alaroRun(client){
  const r=await client.get(K+"/alaro/2_m_temperature/wms?service=WMS&version=1.3.0&request=GetCapabilities",{maxBytes:1<<20,ttl:1800});
  if(r.error)return{error:r.error};
  const m=r.text.match(/<Dimension name="time"[^>]*>\s*([0-9T:.\-Z]+)\/([0-9T:.\-Z]+)\/PT1H/);
  if(!m)return{error:"KMI's forecast service did not state its forecast times"};
  return{start:Date.parse(m[1]),end:Date.parse(m[2])};
}
async function alaroAt(client,lat,lon,t){
  const la=round(lat,3),lo=round(lon,3);   // ~100 m: nearby questions share the edge cache; the model cell is far larger
  const q=new URLSearchParams({service:"WMS",version:"1.3.0",request:"GetFeatureInfo",layers:LAYERS.join(","),query_layers:LAYERS.join(","),styles:"",crs:"EPSG:4326",
    bbox:[la-0.001,lo-0.001,la+0.001,lo+0.001].map(v=>v.toFixed(4)).join(","),width:"1",height:"1",i:"0",j:"0",info_format:"application/json",feature_count:"20",time:new Date(t).toISOString()});
  const r=await getJson(client,K+"/alaro/wms?"+q,{maxBytes:64*1024,ttl:1800});
  if(r.error)return{error:r.error};
  const f=r.json?.features||[];
  // values come back without layer names, one feature per layer in request order: trusted only when the count matches
  if(f.length!==LAYERS.length)return{error:"KMI answered "+f.length+" values for "+LAYERS.length+" forecast fields"};
  const v=f.map(x=>num(Object.values(x.properties||{})[0]));
  return{t,tK:v[0],tmaxK:v[1],tminK:v[2],acc:v[3],u:v[4],w:v[5],gu:v[6],gv:v[7],cloud:v[8],rh:v[9],snow:(v[10]??0)+(v[11]??0)};
}
/** At most n requests at a time: KMI's server refuses connections from a client that opens many at once. */
async function inBatches(items,n,fn){const out=[];for(let i=0;i<items.length;i+=n)out.push(...await Promise.all(items.slice(i,i+n).map(fn)));return out}
const C=k=>k==null||k<150||k>350?null:k-273.15;
const speed=(u,v)=>u==null||v==null?null:Math.hypot(u,v);
const fromDeg=(u,v)=>u==null||v==null||(u===0&&v===0)?null:(270-Math.atan2(v,u)*180/Math.PI+360)%360;

function summarise(steps,from,to){
  const s=steps.filter(x=>x.t>from&&x.t<=to);if(!s.length)return null;
  const temps=s.flatMap(x=>[x.temp_c,x.hour_max_c,x.hour_min_c]).filter(v=>v!=null);
  const rain=s.reduce((n,x)=>n+(x.precip_mm??0),0),snow=s.reduce((n,x)=>n+(x.snow_mm??0),0),gust=Math.max(...s.map(x=>x.gust_kmh??0));
  return clean({from_utc:iso(from),to_utc:iso(to),temp_min_c:temps.length?round(Math.min(...temps),1):null,temp_max_c:temps.length?round(Math.max(...temps),1):null,
    precip_mm:round(rain,1),snow_water_mm:snow>=0.1?round(snow,1):null,max_gust_kmh:gust||null,complete:s.at(-1).t>=to?null:false});
}

export async function weather(client,args,{assets}={}){
  const w=await resolveLocation(client,args,{area:"belgium"});if(w.error)return{error:w.error,...(w.location?{location:w.location}:{})};
  const loc=w.loc,now=Date.now(),h0=Math.floor(now/HOUR_MS)*HOUR_MS;
  const [syn,aws,run]=await Promise.all([stations(client,"synop"),stations(client,"aws"),alaroRun(client)]);
  const near=list=>(list.rows||[]).map(s=>({...s,d:hav(loc.latitude,loc.longitude,s.lat,s.lon)})).sort((a,b)=>a.d-b.d);
  // the 7-day summary comes from the nearest automatic station, but not from one so far away that it describes another region
  const synNear=near(syn).slice(0,2),awsNear=near(aws).find(s=>s.d<=40);
  const since=iso(h0-27*HOUR_MS).replace("Z",":00Z"),day0=new Date(h0-8*24*HOUR_MS).toISOString().slice(0,10)+"T00:00:00Z";
  const steps=run.error?[]:FC_STEPS.map(h=>h0+h*HOUR_MS).filter(t=>t>=run.start&&t<=run.end);
  const [obs,daily,fc,place]=await Promise.all([
    synNear.length?wfs(client,"synop","synop_data",{cql:"code IN ("+synNear.map(s=>s.code).join(",")+") AND timestamp >= '"+since+"'",count:120,ttl:900,
      props:["code","timestamp","temp","temp_min","temp_max","precip_quantity","precip_range","wind_speed","wind_speed_unit","wind_direction","wind_peak_speed","humidity_relative","pressure","cloudiness"]}):Promise.resolve({error:"no synoptic station list"}),
    awsNear?wfs(client,"aws","aws_1day",{cql:"code = "+awsNear.code+" AND timestamp >= '"+day0+"'",count:20,ttl:3*3600,
      props:["code","timestamp","precip_quantity","temp_max","temp_min","temp_avg","sun_duration","wind_gusts_speed"]}):Promise.resolve(null),
    inBatches(steps,4,t=>alaroAt(client,loc.latitude,loc.longitude,t)),
    placeContext(client,assets,loc).catch(()=>null)
  ]);
  if((obs.error||!obs.rows?.length)&&!fc.some(x=>!x.error))return{error:"KMI's open-data services did not answer"+(obs.error?" ("+obs.error+")":"")+"; try again in a minute.",location:loc};

  // ---- observed now and last 24 h at the nearest synoptic station that reports
  let station=null,now_=null,last24=null;
  for(const s of synNear){
    const rows=(obs.rows||[]).filter(r=>r.code===s.code).map(r=>({...r,t:Date.parse(r.timestamp)})).sort((a,b)=>a.t-b.t);
    const latest=[...rows].reverse().find(r=>r.temp!=null);
    if(!latest||now-latest.t>3*HOUR_MS)continue;
    station=s;
    const ms=r=>r.wind_speed==null?null:r.wind_speed_unit===3||r.wind_speed_unit===4?r.wind_speed*0.514444:r.wind_speed;  // knots -> m/s
    now_=clean({time_utc:iso(latest.t),time_local:local(latest.t),temp_c:round(latest.temp,1),humidity_pct:round(latest.humidity_relative,0),
      wind_kmh:kmh(ms(latest)),wind_from:compass(latest.wind_direction),wind_direction_deg:round(latest.wind_direction,0),gust_kmh:latest.wind_peak_speed!=null?kmh(latest.wind_peak_speed):null,
      pressure_hpa_sea_level:round(latest.pressure,1),cloud_cover_oktas:latest.cloudiness,sky:OKTAS(latest.cloudiness),age_minutes:Math.round((now-latest.t)/60000)});
    const day=rows.filter(r=>r.t>latest.t-24*HOUR_MS&&r.temp!=null);
    // precipitation: non-overlapping reported periods ending at the latest report, adding up to exactly 24 h
    // (Belgian stations send 12-hour totals at 06 and 18 UTC and 6-hour totals at 00 and 12 UTC, so a 24-hour window usually ends at
    // 06 or 18 UTC: the newest end point that adds up is used)
    const rep=rows.filter(r=>r.precip_quantity!=null&&RANGE_H[r.precip_range]);let total=null,end=null;
    for(const last of [...rep].reverse()){
      let t=last.t,cover=0,sum=0,ok=true;
      while(cover<24){const r=rep.find(x=>x.t===t&&RANGE_H[x.precip_range]<=24-cover);if(!r){ok=false;break}
        sum+=r.precip_quantity;cover+=RANGE_H[r.precip_range];t-=RANGE_H[r.precip_range]*HOUR_MS}
      if(ok){total=round(sum,1);end=last.t;break}
    }
    last24=clean({temp_min_c:day.length?round(Math.min(...day.map(r=>r.temp)),1):null,temp_max_c:day.length?round(Math.max(...day.map(r=>r.temp)),1):null,
      basis:"hourly readings",precip_mm:total,precip_period:end?"24 h to "+local(end)+" Brussels time":null,max_gust_kmh:Math.max(0,...day.map(r=>r.wind_peak_speed??0))?kmh(Math.max(...day.map(r=>r.wind_peak_speed??0))):null});
    break;
  }
  // ---- last 7 days at the nearest automatic weather station (daily rows dated by their day; values summed/extremes of 10-min data)
  const days=(daily?.rows||[]).map(r=>({...r,date:String(r.timestamp).slice(0,10)})).filter(r=>r.date<new Date(now).toISOString().slice(0,10)).sort((a,b)=>a.date<b.date?-1:1).slice(-7);
  const week=awsNear&&days.length?clean({station:awsNear.name,station_code:awsNear.code,distance_km:round(awsNear.d,1),
    days:days.map(r=>clean({date:r.date,precip_mm:round(r.precip_quantity,1),temp_max_c:round(r.temp_max,1),temp_min_c:round(r.temp_min,1),sunshine_h:r.sun_duration!=null?round(r.sun_duration/60,1):null,max_gust_kmh:r.wind_gusts_speed!=null?kmh(r.wind_gusts_speed):null})),
    total_precip_mm:round(days.reduce((n,r)=>n+(r.precip_quantity??0),0),1),days_with_rain:days.filter(r=>(r.precip_quantity??0)>=1).length,
    warmest:days.reduce((a,r)=>r.temp_max!=null&&(a==null||r.temp_max>a.temp_max)?r:a,null)?.date,coldest:days.reduce((a,r)=>r.temp_min!=null&&(a==null||r.temp_min<a.temp_min)?r:a,null)?.date}):null;

  // ---- forecast at the point
  const ok=fc.filter(x=>!x.error);
  const fsteps=ok.map((x,i)=>{const prev=i?ok[i-1]:null;
    return clean({t:x.t,time_utc:iso(x.t),time_local:local(x.t,{day:true}),temp_c:C(x.tK)!=null?round(C(x.tK),1):null,hour_max_c:C(x.tmaxK)!=null?round(C(x.tmaxK),1):null,hour_min_c:C(x.tminK)!=null?round(C(x.tminK),1):null,
      precip_mm:prev&&x.acc!=null&&prev.acc!=null?round(Math.max(0,(x.acc-prev.acc)*1000),1):null,precip_since_utc:prev?iso(prev.t):null,
      snow_mm:prev?round(Math.max(0,(x.snow-prev.snow)*1000),1):null,
      wind_kmh:kmh(speed(x.u,x.w)),wind_from:compass(fromDeg(x.u,x.w)),gust_kmh:kmh(speed(x.gu,x.gv)),cloud_cover_pct:x.cloud!=null?Math.round(x.cloud*100):null,humidity_pct:x.rh!=null?Math.round(x.rh):null})});
  const next24=fsteps.length?summarise(fsteps,h0,h0+24*HOUR_MS):null,after=fsteps.length?summarise(fsteps,h0+24*HOUR_MS,h0+48*HOUR_MS):null;
  const firstRain=fsteps.find(x=>(x.precip_mm??0)>=0.5);
  const fcErr=fc.find(x=>x.error)?.error||run.error;

  const facts=[];
  if(now_)facts.push("NOW (measured at KMI station "+station.name+", "+round(station.d,1)+" km away, "+now_.time_local+" Brussels time): "+[now_.temp_c+" °C",now_.sky,
    now_.wind_kmh!=null?"wind "+(now_.wind_from?now_.wind_from+" ":"")+now_.wind_kmh+" km/h"+(now_.gust_kmh!=null?" with gusts to "+now_.gust_kmh+" km/h":""):null,
    now_.humidity_pct!=null?"humidity "+now_.humidity_pct+" %":null].filter(Boolean).join(", ")+".");
  if(last24)facts.push("LAST 24 HOURS at "+station.name+": "+last24.temp_min_c+" to "+last24.temp_max_c+" °C"+(last24.precip_mm!=null?", "+last24.precip_mm+" mm of precipitation in the "+last24.precip_period:"")+".");
  if(next24)facts.push("FORECAST next 24 hours at this point (KMI ALARO model, run "+iso(run.start)+"): "+next24.temp_min_c+" to "+next24.temp_max_c+" °C, "+next24.precip_mm+" mm of precipitation"+(next24.snow_water_mm?" (of which "+next24.snow_water_mm+" mm as snow, water equivalent)":"")+(next24.max_gust_kmh?", gusts up to "+next24.max_gust_kmh+" km/h":"")+".");
  if(after)facts.push("FORECAST the 24 hours after (to "+local(Date.parse(after.to_utc),{day:true})+"): "+after.temp_min_c+" to "+after.temp_max_c+" °C, "+after.precip_mm+" mm"+(after.max_gust_kmh?", gusts up to "+after.max_gust_kmh+" km/h":"")+(after.complete===false?" (the model run ends earlier)":"")+".");
  // "no rain expected" only when the forecast really covers the next 24 hours; a forecast with gaps must not read as dry weather
  const covered=fsteps.length>=2&&fsteps.at(-1).t>=h0+24*HOUR_MS&&ok.length===fc.length;
  if(!fsteps.length||fsteps.length<2)facts.push("The KMI forecast could not be read just now"+(fcErr?" ("+fcErr+")":"")+"; only observations are given.");
  else if(firstRain||covered)facts.push(firstRain?"First rain of 0.5 mm or more expected in the 3-hour period ending "+firstRain.time_local+" (Brussels time) ("+firstRain.precip_mm+" mm).":"No period with 0.5 mm of rain or more in the forecast (to "+fsteps.at(-1).time_local+").");
  if(week)facts.push("LAST 7 DAYS at KMI station "+week.station+" ("+week.distance_km+" km): "+week.total_precip_mm+" mm of rain on "+week.days_with_rain+" days with 1 mm or more; warmest day "+week.warmest+", coldest night "+week.coldest+".");
  facts.push("Official weather warnings are not part of KMI's open data and are not included: check meteo.be for warnings.");

  const d=new Date().toISOString().slice(0,10);
  return clean({key_facts:facts,
    location:clean({...loc,x_lambert72:loc.x,y_lambert72:loc.y,x:undefined,y:undefined,geocoded:undefined}),place,
    observed:now_?clean({station:station.name,station_code:station.code,distance_km:round(station.d,1),station_altitude_m:station.altitude,now:now_,last_24h:last24}):{error:obs.error||"no synoptic station within reach reported in the last 3 hours"},
    last_7_days:week,
    forecast:fsteps.length?clean({model:"ALARO (KMI's limited-area model), deterministic single run: no probabilities",run_utc:iso(run.start),run_ends_utc:iso(run.end),
      next_24h:next24,following_24h:after,steps:fsteps.map(({t,...x})=>x),
      sampling:"Values at the listed times; precipitation is the total since the previous listed time (exact); temperature extremes come from the samples and the model's max/min over the hour before each, so short peaks between samples can be missed."}):{error:fcErr||"no forecast steps"},
    note:"Observations are from the nearest station that reported, not from the address itself; elevation and coast or city effects can make the address differ. Times are given in UTC and Brussels time.",
    provenance:{source:"Royal Meteorological Institute of Belgium (KMI/IRM), open data",licence:"CC BY 4.0",
      datasets:["synoptic observations (synop)","automatic weather stations, daily (aws_1day)","ALARO forecast model"],
      citation:"KMI/IRM open data (synop, AWS, ALARO), CC BY 4.0, retrieved "+d+" from https://opendata.meteo.be."}});
}
