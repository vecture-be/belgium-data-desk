// river_levels: how high the water is at river and canal gauges in Belgium, as an answer: the level now, how it moved over the last
// 24 hours, how it compares with the gauge's official watch and alarm levels and with its usual range, and the official alarm status.
//
// Sources (all KISTERS KiWIS web services, public, no key), read live and edge-cached for a few minutes:
// - VMM (Flanders Environment Agency), waterinfo.be: non-navigable rivers in Flanders.   datasource 1
// - HIC (Hydrologisch Informatiecentrum, Flemish waterways), waterinfo.be: navigable rivers, canals and the tidal Scheldt.   datasource 4
// - SPW (Service public de Wallonie), hydrometrie.wallonie.be: rivers in Wallonia.   datasource 0. NOT ENABLED: SPW's legal notice
//   (hydrometrie.wallonie.be/mentions-legales.html, read 2026-11-15) forbids passing its data on through a website or web service
//   without prior written permission. The code path is kept so it can be switched on (ENABLED) once SPW agrees; it was checked by hand against the live service.
// The station layers are the ones the official map portals draw (WEBLayer_Stage_15m.Cmd, WEB_L_Waterlevel_All, WEBPortal_ESurf-Hauteur).
//
// What the older clients (pywaterinfo, wateRinfo, kiwis_pie) leave to the user, and this module handles:
// - VMM values are relative to the gauge zero; watch/alarm levels are in metres TAW. The absolute level is value + GAUGE_DATUM
//   (checked against KiWIS's own "Absolute Value" column: identical). Comparing the raw value with the thresholds is wrong by metres.
// - VMM's long-term percentiles are EXCEEDANCE levels (P10 is the high one: exceeded 10 % of the time), SPW's are ordinary percentiles.
//   The usual range is therefore taken as [lower, higher] of the two, whatever the convention.
// - Station layers contain retired stations (last value in 2014) and duplicate series; only values from the last 3 hours count as "now".
// - SPW publishes levels relative to the gauge zero (with the zero in m DNG = TAW); Wallonia publishes no watch/alarm levels per gauge,
//   but its flood-warning service InfoCrue gives a status per river basin.
import { _dov } from "./dov.mjs";
import { placeContext } from "./place.mjs";
const {getJson,resolveLocation,clean,round,num}=_dov;

const KIWIS={
  vmm:{base:"https://download.waterinfo.be/tsmdownload/KiWIS/KiWIS",ds:"1",name:"VMM (Vlaamse Milieumaatschappij), waterinfo.be",short:"VMM",
    level:"118730",levelCa:"river_name,Level_Alarm,Level_Waak,Level_PreAlarm,GAUGE_DATUM,dataowner",status:"111236,111237"},
  hic:{base:"https://hicws.vlaanderen.be/KiWIS/KiWIS",ds:"4",name:"Hydrologisch Informatiecentrum (HIC, Flemish waterways), waterinfo.be",short:"HIC",
    level:"156154",levelCa:"Portal_Rivier,GAUGE_DATUM,dataowner",status:"156152,156153,156155,156156,156157"},
  spw:{base:"https://hydrometrie.wallonie.be/services/KiWIS/KiWIS",ds:"0",name:"Service public de Wallonie (SPW), hydrometrie.wallonie.be",short:"SPW",
    level:"1962373",levelCa:"BASSIN_INFOCRUE_NO,GAUGE_DATUM,ISIN_COMMUNE,ADMINISTRATEUR",status:"1962448"}
};
const ENABLED=["vmm","hic"];
export const RIVER_HOSTS=Object.freeze(ENABLED.map(k=>new URL(KIWIS[k].base).hostname));
const LIVE_TTL=600,FRESH_H=3,STAT_TTL=86400;
export const RIVER_LIMITS=Object.freeze({radiusKm:{default:10,max:30},stations:{default:3,max:6}});

const url=(p,params)=>p.base+"?"+new URLSearchParams({service:"kisters",type:"queryServices",format:"json",datasource:p.ds,...params});
const hav=(a,b,c,d)=>{const R=6371,t=Math.PI/180,s=Math.sin((c-a)*t/2)**2+Math.cos(a*t)*Math.cos(c*t)*Math.sin((d-b)*t/2)**2;return 2*R*Math.asin(Math.sqrt(s))};
const fold=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
const ageH=iso=>(Date.now()-Date.parse(iso))/3.6e6;
const utc=iso=>{const t=Date.parse(iso);return Number.isFinite(t)?new Date(t).toISOString().slice(0,16)+"Z":null};
const local=iso=>{const t=Date.parse(iso);if(!Number.isFinite(t))return null;
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Brussels",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(t))};
/** "5.3 m", "19,50", "" -> number or null */
const level=s=>{const m=String(s??"").replace(",",".").match(/-?\d+(\.\d+)?/);return m?Number(m[0]):null};
const cm=d=>d==null?null:Math.round(d*100);
const fmtM=v=>v==null?null:v.toFixed(2)+" m";

/** One provider's station layer -> stations with their latest level (one row per station: the newest, preferring Pv series). */
async function stationLayer(client,key){
  const p=KIWIS[key];
  const r=await getJson(client,url(p,{request:"getTimeseriesValueLayer",timeseriesgroup_id:p.level,metadata:"true",
    md_returnfields:"ts_id,ts_name,station_no,station_name,ts_unitsymbol,ca_sta",ca_sta_returnfields:p.levelCa}),{maxBytes:1<<20,ttl:LIVE_TTL});
  if(r.error)return{error:r.error};
  if(!Array.isArray(r.json))return{error:p.short+" answered without a station list"};
  const by=new Map();
  for(const row of r.json){
    if(!row.station_no||/fout/i.test(row.ts_name||"")||row.ts_unitsymbol!=="m")continue;
    const lat=num(row.station_latitude),lon=num(row.station_longitude);if(!lat||!lon)continue;
    const s={provider:key,ts_id:String(row.ts_id),ts_name:row.ts_name,station_no:row.station_no,name:row.station_name,lat,lon,
      value:typeof row.ts_value==="number"?row.ts_value:null,time:row.timestamp||null,datum:num(row.GAUGE_DATUM),
      river:row.river_name||row.Portal_Rivier||null,owner:row.dataowner||row.ADMINISTRATEUR||null,municipality:row.ISIN_COMMUNE||null,
      basin:row.BASSIN_INFOCRUE_NO||null,
      thresholds:key==="vmm"?{watch:level(row.Level_Waak),pre_alarm:level(row.Level_PreAlarm),alarm:level(row.Level_Alarm)}:null};
    if(key==="spw"&&!(s.datum>0)&&s.value>15)s.absoluteOnly=true;
    const old=by.get(s.station_no);
    const newer=!old||(Date.parse(s.time)||0)>(Date.parse(old.time)||0)||((Date.parse(s.time)||0)===(Date.parse(old.time)||0)&&/^Pv/.test(s.ts_name)&&!/^Pv/.test(old.ts_name));
    if(newer)by.set(s.station_no,s);
  }
  return{stations:[...by.values()]};
}

/** Absolute level (m TAW/DNG) and the level above the gauge zero, per provider convention. */
function levels(s,value){
  if(value==null)return{abs:null,rel:null};
  if(s.provider==="hic")return{abs:value,rel:null};                         // HIC publishes m TAW (gauge datum 0)
  const d=s.datum;
  // gauge zero 0 or missing: VMM values are then absolute; at SPW the value is absolute when it is far above any plausible depth
  // (LIEGE on the Meuse publishes 60 m with gauge zero 0.0); otherwise it stays "above the gauge zero"
  if(d==null||d===0)return s.provider==="vmm"||value>15?{abs:value,rel:null}:{abs:null,rel:value};
  return{abs:value+d,rel:value};
}

/** 26 h of values for the chosen series of one provider (one request): the newest reading is up to ~20 min old, so a
 *  24-hour window would not reach back to the reading 24 hours before it. */
async function history(client,key,ids){
  const r=await getJson(client,url(KIWIS[key],{request:"getTimeseriesValues",ts_id:ids.join(","),period:"PT26H",returnfields:"Timestamp,Value",
    metadata:"true",md_returnfields:"ts_id"}),{maxBytes:1<<20,ttl:LIVE_TTL});
  if(r.error||!Array.isArray(r.json))return{};
  return Object.fromEntries(r.json.map(t=>[String(t.ts_id),(t.data||[]).filter(d=>typeof d[1]==="number").map(([t2,v])=>[Date.parse(t2),v])]));
}
/** Status, forecast status and (HIC) threshold layers of one provider, keyed by station number (one request). */
async function statusLayer(client,key){
  const r=await getJson(client,url(KIWIS[key],{request:"getTimeseriesValueLayer",timeseriesgroup_id:KIWIS[key].status,metadata:"true",
    md_returnfields:"ts_id,ts_name,station_no"}),{maxBytes:1<<20,ttl:LIVE_TTL});
  if(r.error||!Array.isArray(r.json))return{error:r.error||"no status layer"};
  const by={};
  for(const row of r.json){const k=row.station_no;if(!k)continue;(by[k]||(by[k]={}))[row.ts_name]={value:row.ts_value,time:row.timestamp}}
  return{by};
}
/** Long-term statistics. VMM: analysis-period exceedance levels (m TAW). SPW: inter-annual percentiles for today's calendar day
 *  (relative to the gauge zero) and the highest level recorded. Two or three requests; null when the provider has none. */
async function longTerm(client,key,stations){
  const p=KIWIS[key],nos=stations.map(s=>s.station_no).join(",");
  const names=key==="vmm"?["AnalysePeriodeP10","AnalysePeriodeP25","AnalysePeriodeP75","AnalysePeriodeP90"]
    :key==="spw"?["75-Hauteur.InterAn.Jour.P10","73-Hauteur.InterAn.Jour.Median","78-Hauteur.InterAn.Jour.P90"]:null;
  if(!names)return{};
  const list=await getJson(client,url(p,{request:"getTimeseriesList",station_no:nos,stationparameter_name:key==="vmm"?"H":"Hauteur",ts_name:names.join(","),
    returnfields:"station_no,ts_id,ts_name"}),{maxBytes:256*1024,ttl:STAT_TTL});
  if(list.error||!Array.isArray(list.json)||list.json.length<2)return{};
  const rows=list.json.slice(1).map(([station_no,ts_id,ts_name])=>({station_no,ts_id:String(ts_id),ts_name}));
  // SPW's daily percentiles answer today's value without a period. VMM's yearly statistics end in an empty placeholder row for next year,
  // so they are read from three years back and the last real value is used.
  const extra=key==="vmm"?{from:(new Date().getUTCFullYear()-3)+"-01-01"}:{};
  const a=await getJson(client,url(p,{request:"getTimeseriesValues",ts_id:rows.map(r=>r.ts_id).join(","),returnfields:"Timestamp,Value",metadata:"true",md_returnfields:"ts_id",...extra}),{maxBytes:256*1024,ttl:STAT_TTL});
  const last={};for(const t of a.json||[]){const d=(t.data||[]).filter(x=>typeof x[1]==="number").at(-1);if(d)last[String(t.ts_id)]={time:d[0],value:d[1]}}
  const out={};
  for(const r of rows){const v=last[r.ts_id];if(!v)continue;(out[r.station_no]||(out[r.station_no]={}))[r.ts_name]=v}
  return out;
}

const STATUS_LABEL=c=>c===0?"normal":c>=1&&c<=3?"alarm level "+c+" of 3 (1 = lowest)":c===-1?"not determined":null;
function trendOf(series,now){
  if(!series?.length)return null;
  const [tN,vN]=series.at(-1);
  const at=h=>{const target=tN-h*3.6e6;let best=null;for(const [t,v] of series){if(Math.abs(t-target)<=20*60e3&&(!best||Math.abs(t-target)<Math.abs(best[0]-target)))best=[t,v]}return best?vN-best[1]:null};
  const d1=at(1),d3=at(3),d24=at(24),day=series.filter(([t])=>t>=tN-24*3.6e6),vals=day.map(x=>x[1]);
  const range=Math.max(...vals)-Math.min(...vals);
  // reversals of the hourly change (ignoring wiggles under 2 cm): a tide turns about four times a day, a river once at most
  let reversals=0,dir=0;
  for(let i=0,last=series[0];i<series.length;i++){const [t,v]=series[i];if(t-last[0]<36e5)continue;const d=v-last[1];last=series[i];
    if(Math.abs(d)<0.02)continue;const sgn=Math.sign(d);if(dir&&sgn!==dir)reversals++;dir=sgn}
  const trend=d3==null?null:d3>0.03?"rising":d3<-0.03?"falling":"steady";
  return{latest:[tN,vN],change_1h:d1,change_3h:d3,change_24h:d24,min:Math.min(...vals),max:Math.max(...vals),range,reversals,points:day.length,trend,stale:(now-tN)/3.6e6>FRESH_H};
}

function view(s,dist,hist,st,lt,crue){
  const h=hist?.[s.ts_id],tr=trendOf(h,Date.now());
  // tidal gauges (Zeeschelde, Durme, Rupel...): the level swings metres twice a day, so "rising" or "falling" says only where the tide is
  const tidal=!!tr&&((/\btij\b|getij|maree|marée/i.test(s.name+" "+(s.river||""))||tr.reversals>=3))&&tr.range>0.3;
  if(tidal&&tr)tr.trend=(tr.change_1h??0)>0?"tide rising":"tide falling";
  const value=tr?tr.latest[1]:s.value,time=tr?new Date(tr.latest[0]).toISOString():s.time;
  const L=levels(s,value),toAbs=v=>{const x=levels(s,v);return x.abs??x.rel};
  // thresholds: VMM from the station attributes, HIC from its threshold series; both in m TAW
  let thr=s.thresholds;
  if(s.provider==="hic"&&st)thr={pre_watch:num(st["DrempelPrewaak.O"]?.value),watch:num(st["DrempelWaak.O"]?.value),alarm:num(st["DrempelAlarm.O"]?.value)};
  let thresholds=null,above=null;
  if(thr&&(thr.watch!=null||thr.alarm!=null)&&L.abs!=null){
    // VMM: watch (waakpeil) < pre-alarm < alarm; HIC: pre-watch (prewaakpeil) < watch < alarm. Shown in the publisher's order and names.
    const named=Object.entries(thr).filter(([,v])=>v!=null);
    const plausible=named.every(([,v])=>Math.abs(v-L.abs)<15);
    const ordered=!(thr.watch!=null&&thr.alarm!=null&&thr.watch>thr.alarm);
    thresholds=clean({...Object.fromEntries(named.map(([k,v])=>[k+"_m_taw",v])),
      below_watch_cm:plausible&&thr.watch!=null?cm(thr.watch-L.abs):null,below_alarm_cm:plausible&&thr.alarm!=null?cm(thr.alarm-L.abs):null,
      note:!plausible?"The published thresholds are far from this gauge's level (different reference?); not compared.":!ordered?"The publisher lists the watch level above the alarm level; both are shown as published.":null});
    if(plausible){const hit=named.filter(([,v])=>L.abs>=v).sort((a,b)=>b[1]-a[1])[0];above=hit?hit[0]:"none"}
  }
  // official alarm status now and forecast (VMM/HIC), InfoCrue basin status (SPW)
  const cur=st?.["AlarmStatus"]||st?.["AlarmStatus.O"],fc=st?.["KT-AlarmStatus.O"]||st?.["KT-AlarmStatus-Max.O"];
  const curCode=num(cur?.value),fcCode=num(fc?.value);
  const official=cur&&curCode!=null?clean({code:curCode,label:STATUS_LABEL(curCode),time_utc:utc(cur.time),stale:ageH(cur.time)>FRESH_H?true:null}):null;
  // VMM stamps the forecast status at the end of its horizon, HIC at the forecast run; both stand for the highest status over that forecast
  const forecast=fc&&fcCode!=null&&fcCode>=0&&Date.parse(fc.time)>Date.now()-12*3.6e6?clean({highest_code_expected:fcCode,label:STATUS_LABEL(fcCode),
    valid_until_utc:s.provider==="vmm"?utc(fc.time):null,issued_utc:s.provider==="hic"?utc(fc.time):null,
    model:s.provider==="vmm"?"VMM short-term flood forecast (KT)":"HIC short-term forecast (KT), highest status over the coming days"}):null;
  const infocrue=s.provider==="spw"&&crue?clean({basin_no:s.basin,code:num(crue.value),label:num(crue.value)===0?"no flood warning for this basin":num(crue.value)>0?"flood warning level "+num(crue.value)+" for this basin":"not determined",time_utc:utc(crue.time)}):null;
  // usual range: whichever convention the provider uses, the 10th and 90th percentile bound the level of 80 % of the time
  let usual=null;
  if(lt){
    if(s.provider==="vmm"){
      const p10=lt.AnalysePeriodeP10?.value,p90=lt.AnalysePeriodeP90?.value,p25=lt.AnalysePeriodeP25?.value,p75=lt.AnalysePeriodeP75?.value;
      if(p10!=null&&p90!=null){const lo=Math.min(p10,p90),hi=Math.max(p10,p90),v=L.abs;
        usual=clean({range_80pct_m_taw:[round(lo,2),round(hi,2)],range_50pct_m_taw:p25!=null&&p75!=null?[round(Math.min(p25,p75),2),round(Math.max(p25,p75),2)]:null,
          position:v==null?null:v>hi?"above the usual range (higher than 90 % of the time)":v<lo?"below the usual range (lower than 90 % of the time)":"within the usual range",
          basis:"VMM long-term statistics over its analysis period ("+String(lt.AnalysePeriodeP10?.time||"").slice(0,4)+" update); VMM states them as exceedance levels"})}
    }else if(s.provider==="spw"){
      const p10=lt["75-Hauteur.InterAn.Jour.P10"]?.value,p50=lt["73-Hauteur.InterAn.Jour.Median"]?.value,p90=lt["78-Hauteur.InterAn.Jour.P90"]?.value;
      if(p10!=null&&p90!=null){const lo=Math.min(p10,p90),hi=Math.max(p10,p90),v=L.rel??L.abs;
        usual=clean({range_80pct_as_published_m:[round(lo,2),round(hi,2)],median_as_published_m:round(p50,2),
          position:v==null?null:v>hi?"above the usual range for this time of year":v<lo?"below the usual range for this time of year":"within the usual range for this time of year",
          basis:"SPW inter-annual percentiles for this calendar day ("+(s.absoluteOnly?"m TAW/DNG, as this gauge publishes":"m above the gauge zero")+")"})}
    }
  }
  return clean({provider:KIWIS[s.provider].short,station_no:s.station_no,name:s.name,river:s.river,municipality:s.municipality,distance_km:dist!=null?round(dist,1):null,
    latitude:round(s.lat,5),longitude:round(s.lon,5),data_owner:s.owner,
    latest:clean({time_utc:utc(time),time_local:local(time),level_m_taw:round(L.abs,2),level_above_gauge_zero_m:round(L.rel,2),
      gauge_zero_m_taw:s.datum&&s.provider!=="hic"?round(s.datum,3):null,age_hours:time?round(ageH(time),1):null}),
    tidal:tidal||null,
    change_cm:tr?clean({last_1h:cm(tr.change_1h),last_3h:cm(tr.change_3h),last_24h:tidal?null:cm(tr.change_24h)}):null,trend:tr?.trend,
    last_24h:tr?clean({min_m:round(toAbs(tr.min),2),max_m:round(toAbs(tr.max),2),values:tr.points,
      note:tidal?"Tidal gauge: the 24-hour minimum and maximum are low and high water.":null}):null,
    thresholds,above_threshold:above,official_status:official,forecast_status:forecast,infocrue,usual_range:usual,
    series:{ts_id:s.ts_id,ts_name:s.ts_name}});
}

function fact(v){
  const where=(v.river?v.river+" at ":"")+v.name+" ("+v.provider+" "+v.station_no+(v.distance_km!=null?", "+v.distance_km+" km":"")+")";
  const lvl=v.latest.level_m_taw!=null?v.latest.level_m_taw.toFixed(2)+" m TAW":v.latest.level_above_gauge_zero_m!=null?v.latest.level_above_gauge_zero_m.toFixed(2)+" m above the gauge zero":"no value";
  const parts=[where+": "+lvl+" at "+v.latest.time_local+" (Brussels time)"];
  if(v.tidal&&v.last_24h)parts.push(v.trend+"; tidal gauge, low and high water in the last 24 h "+v.last_24h.min_m.toFixed(2)+" and "+v.last_24h.max_m.toFixed(2)+" m");
  else if(v.change_cm?.last_3h!=null)parts.push(v.trend+" ("+(v.change_cm.last_3h>=0?"+":"")+v.change_cm.last_3h+" cm in 3 h"+(v.change_cm.last_24h!=null?", "+(v.change_cm.last_24h>=0?"+":"")+v.change_cm.last_24h+" cm in 24 h":"")+")");
  const t=v.thresholds;
  if(t?.below_watch_cm!=null||t?.below_alarm_cm!=null){
    const rel=(d,n,lv)=>d==null?null:d>0?d+" cm below the "+n+" level ("+lv.toFixed(2)+" m)":Math.abs(d)+" cm ABOVE the "+n+" level ("+lv.toFixed(2)+" m)";
    parts.push([rel(t.below_watch_cm,"watch",t.watch_m_taw),rel(t.below_alarm_cm,"alarm",t.alarm_m_taw)].filter(Boolean).join(" and "));
  }else if(v.provider!=="SPW")parts.push("no watch or alarm level published for this gauge");
  if(v.usual_range?.position)parts.push(v.usual_range.position);
  if(v.official_status)parts.push("official alarm status "+v.official_status.label);
  if(v.forecast_status&&v.forecast_status.highest_code_expected>0)parts.push("FORECAST: the publisher's short-term forecast"+(v.forecast_status.issued_utc?" (issued "+v.forecast_status.issued_utc+")":"")+" reaches "+v.forecast_status.label+(v.forecast_status.valid_until_utc?" before "+v.forecast_status.valid_until_utc:""));
  if(v.infocrue)parts.push("InfoCrue: "+v.infocrue.label);
  return parts.join("; ")+".";
}

export async function riverLevels(client,args,{assets}={}){
  const radius=Math.min(RIVER_LIMITS.radiusKm.max,Math.max(1,num(args?.radius_km)??RIVER_LIMITS.radiusKm.default));
  const limit=Math.min(RIVER_LIMITS.stations.max,Math.max(1,Math.round(num(args?.max_stations)??RIVER_LIMITS.stations.default)));
  const station=typeof args?.station==="string"?args.station.trim().slice(0,80):"",river=typeof args?.river==="string"?args.river.trim().slice(0,60):"";
  const hasPlace=!!(args?.address||args?.latitude!=null||args?.x_lambert72!=null);
  if(!station&&!hasPlace&&!river)return{error:"Give an address or coordinates (for the nearest gauges), a station (name or number, e.g. 'Korbeek-Dijle', 'L08_097', 'Huy') or a river (e.g. 'Dijle', with an address to pick the stretch)."};
  // location first (the station layers do not depend on it, so they are read in parallel)
  const [where,...layers]=await Promise.all([hasPlace?resolveLocation(client,args,{area:"belgium"}):Promise.resolve(null),...ENABLED.map(k=>stationLayer(client,k))]);
  if(where?.error)return{error:where.error,...(where.location?{location:where.location}:{})};
  const loc=where?.loc||null;
  const failed=ENABLED.filter((k,i)=>layers[i].error).map(k=>KIWIS[k].short);
  const all=layers.flatMap(l=>l.stations||[]);
  if(!all.length)return{error:"The gauge services of waterinfo.be did not answer; try again in a minute."};
  let pool=all.filter(s=>s.value!=null&&s.time&&ageH(s.time)<=FRESH_H);
  const retired=all.length-pool.length;
  if(river){const r=fold(river);pool=pool.filter(s=>fold(s.river).includes(r)||fold(s.name).includes(r));if(!pool.length)return{error:"No gauge reporting now has '"+river+"' in its river or station name. Try another spelling (Dutch or French), or an address."}}
  let picked,mode;
  if(station){
    const q=fold(station),exact=pool.filter(s=>fold(s.station_no)===q);
    const byName=exact.length?exact:pool.filter(s=>fold(s.name).includes(q)||fold(s.municipality).includes(q));
    if(!byName.length){const any=all.find(s=>fold(s.station_no)===q||fold(s.name).includes(q));
      return{error:any?"Gauge "+any.name+" ("+any.station_no+") has not reported in the last "+FRESH_H+" hours (last value "+(utc(any.time)||"unknown")+")."
        :"No gauge matches '"+station+"'. Give the station name as the portals write it (e.g. 'Korbeek-Dijle', 'Werchter', 'Lier'), its number, or an address."}}
    picked=byName.map(s=>({s,d:loc?hav(loc.latitude,loc.longitude,s.lat,s.lon):null})).sort((a,b)=>(a.d??0)-(b.d??0)).slice(0,limit);mode="station";
  }else if(loc){
    const near=pool.map(s=>({s,d:hav(loc.latitude,loc.longitude,s.lat,s.lon)})).sort((a,b)=>a.d-b.d);
    picked=near.filter(x=>x.d<=radius).slice(0,limit);mode="nearest";
    if(!picked.length){
      if(!near.length||near[0].d>RIVER_LIMITS.radiusKm.max)return{error:"No gauge reporting now lies within "+RIVER_LIMITS.radiusKm.max+" km. This tool covers the gauges of Flanders and the Flemish waterways (VMM, HIC on waterinfo.be); Wallonia's gauges (SPW, hydrometrie.wallonie.be) may not be passed on without SPW's written permission, so they are not included.",location:clean({latitude:loc.latitude,longitude:loc.longitude,municipality:loc.municipality})};
      picked=near.slice(0,1);mode="nearest_outside_radius";
    }
  }else{picked=pool.slice(0,limit).map(s=>({s,d:null}));mode="river"}
  // details per provider of the chosen gauges: history, status layers, long-term statistics
  const provs=[...new Set(picked.map(x=>x.s.provider))];
  const details=await Promise.all(provs.map(async k=>{
    const ss=picked.filter(x=>x.s.provider===k).map(x=>x.s);
    const [hist,status,lt]=await Promise.all([history(client,k,ss.map(s=>s.ts_id)),statusLayer(client,k),longTerm(client,k,ss)]);
    return[k,{hist,status,lt}];
  }));
  const D=Object.fromEntries(details);
  const views=picked.map(({s,d})=>{const x=D[s.provider];return view(s,d,x.hist,x.status?.by?.[s.provider==="spw"?null:s.station_no],x.lt?.[s.station_no],
    s.provider==="spw"&&s.basin?x.status?.by?.[s.basin]?.["00-Statut.InfoCrue.O"]:null)});
  const facts=views.map(fact);
  if(mode==="nearest_outside_radius")facts.unshift("No gauge reporting now lies within "+radius+" km; the nearest one is "+views[0].distance_km+" km away.");
  const watch=views.filter(v=>v.above_threshold&&v.above_threshold!=="none"),fcw=views.filter(v=>v.forecast_status?.highest_code_expected>0);
  const noThr=views.filter(v=>!v.thresholds||v.thresholds.below_watch_cm==null&&v.thresholds.below_alarm_cm==null).length;
  if(views.length>1)facts.push((watch.length?watch.length+" of these "+views.length+" gauges are at or above a published threshold":"None of these "+views.length+" gauges is at or above a published watch or alarm level")+
    (noThr?" ("+(noThr===views.length?"none of them publishes one":noThr+" of them "+(noThr===1?"publishes":"publish")+" none")+")":"")+(fcw.length?"; a forecast raises the status at "+fcw.map(v=>v.name).join(", "):"")+".");
  const place=loc?await placeContext(client,assets,loc).catch(()=>null):null;
  if(/Waals|Wallon/i.test(place?.region||""))facts.push("This place is in Wallonia: its own river gauges (SPW, hydrometrie.wallonie.be) are not included, because SPW's terms forbid passing that data on; the gauges above are Flemish ones nearby.");
  else if(/Brussel|Bruxelles/i.test(place?.region||""))facts.push("Brussels' own gauges (Flowbru) are not included; the gauges above are on the canal and around the region.");
  const d=new Date().toISOString().slice(0,10);
  return clean({key_facts:facts.slice(0,10),
    location:loc?clean({...loc,x_lambert72:loc.x,y_lambert72:loc.y,x:undefined,y:undefined,geocoded:undefined}):null,place,
    search:clean({mode,radius_km:mode==="station"?null:radius,river:river||null,gauges_reporting_now:pool.length,gauges_not_reporting:retired,services_not_answering:failed.length?failed:null}),
    gauges:views,
    definitions:{level_m_taw:"Water level in metres above the Belgian reference level TAW/DNG (Tweede Algemene Waterpassing = Deuxième Nivellement Général). Levels at different gauges are not comparable as depths: each river bed has its own height.",
      level_above_gauge_zero_m:"The gauge's own reading above its zero; level_m_taw = reading + gauge_zero_m_taw.",
      watch_alarm:"Watch (waakpeil) and alarm (alarmpeil) levels are the publisher's operational thresholds for that gauge; they are not flood maps for a building.",
      alarm_status:"The publisher's own status: 0 normal, 1-3 alarm levels (1 lowest), -1 not determined. Forecast statuses come from the publisher's short-term flood forecasts.",
      usual_range:"The band holding the level 80 % of the time over the publisher's long-term statistics."},
    note:"Measured values are provisional (not yet validated). This tool reports gauges, not whether a specific address will flood: use flood_risk for the official flood-prone maps in Flanders. Not included: Wallonia's gauges (SPW's terms forbid passing them on without permission; see hydrometrie.wallonie.be) and Brussels' own gauges (Flowbru).",
    provenance:{source:"VMM and HIC via waterinfo.be (Flanders)",licence:"Modellicentie Gratis Hergebruik (free reuse, attribution required)",
      services:views.map(v=>v.provider).filter((x,i,a)=>a.indexOf(x)===i).map(k=>KIWIS[k.toLowerCase()].name),
      citation:"Water levels from "+[...new Set(views.map(v=>v.provider))].join(", ")+" (KiWIS web services), provisional measurements, retrieved "+d+"."}});
}
