// air_quality: air quality at a place in Belgium from IRCEL-CELINE (the interregional environment cell of the three regions), as an
// answer: what the air is like now, what is forecast, how polluted the place is over a year, and how that compares with the standards.
//
// Sources (all IRCEL, CC BY 4.0), read live and edge-cached:
// - RIO interpolation (4 x 4 km, all of Belgium): this hour's NO2, PM2.5, PM10, O3 and black carbon, the 24-hour mean of PM, and the
//   annual means of the last complete year; one WMS GetFeatureInfo answers several layers at once.
// - BelAQI forecast for today and the next three days (IRCEL's daily forecast run).
// - ATMO-Street (Flanders, about 10 m: street level, including the effect of the street itself) annual means.
// - The nearest measuring stations (SOS API) with their latest measured values: the stations are sorted by distance here, because
//   the API's 'near' search returns them unsorted.
// Hourly values are never compared with annual standards: annual means are compared with annual standards, 24-hour means with the WHO
// 24-hour guideline values.
import { _dov } from "./dov.mjs";
import { placeContext } from "./place.mjs";
const {getJson,resolveLocation,clean,round,HOUR,DAY}=_dov;

const WMS="https://geo.irceline.be/wms",SOS="https://geo.irceline.be/sos/api/v1";
const POLL={no2:"nitrogen dioxide (NO2)",pm25:"fine particulate matter (PM2.5)",pm10:"particulate matter (PM10)",o3:"ozone (O3)",bc:"black carbon"};
// WHO global air quality guidelines 2021; EU limit values of Directive 2008/50/EC (in force) and Directive (EU) 2024/2881 (from 2030)
const ANNUAL={no2:{who_2021:10,eu_now:40,eu_2030:20},pm25:{who_2021:5,eu_now:25,eu_2030:10},pm10:{who_2021:15,eu_now:40,eu_2030:20}};
const DAILY_WHO={pm25:15,pm10:45};
const BELAQI=["","excellent","very good","good","fairly good","moderate","poor","very poor","bad","very bad","horrible"];
const ATMO_YEAR=2025;   // latest ATMO-Street year published for Flanders (layer rioifdm:*_anmean_<year>_atmostreet_vl)

async function gfi(client,layers,x,y,ttl){
  const q=new URLSearchParams({service:"WMS",version:"1.3.0",request:"GetFeatureInfo",layers:layers.join(","),query_layers:layers.join(","),styles:"",crs:"EPSG:31370",
    bbox:[x-5,y-5,x+5,y+5].map(v=>Math.round(v)).join(","),width:"1",height:"1",i:"0",j:"0",info_format:"application/json",feature_count:String(layers.length)});
  const r=await getJson(client,WMS+"?"+q,{maxBytes:128*1024,ttl});
  if(r.error)return{error:r.error};
  const f=r.json?.features||[];
  // raster answers carry no layer name: they are trusted only when one feature came back per layer, in order
  if(f.length!==layers.length)return{error:"IRCEL answered "+f.length+" values for "+layers.length+" layers"};
  return{values:f.map(x=>x.properties||{})};
}
const haversine=(a,b,c,d)=>{const R=6371000,t=Math.PI/180,dl=(c-a)*t,dn=(d-b)*t,s=Math.sin(dl/2)**2+Math.cos(a*t)*Math.cos(c*t)*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(s))};
const PHEN=[[/^Nitrogen dioxide$/i,"no2"],[/Particulate Matter < 2\.5/i,"pm25"],[/Particulate Matter < 10/i,"pm10"],[/^Ozone$/i,"o3"],[/^Black Carbon$/i,"bc"]];
async function nearestStations(client,lat,lon){
  const near=JSON.stringify({center:{type:"Point",coordinates:[lon,lat]},radius:30});
  const r=await getJson(client,SOS+"/stations?"+new URLSearchParams({near}),{maxBytes:256*1024,ttl:DAY});
  if(r.error)return{error:r.error};
  const st=(r.json||[]).map(s=>({id:s.properties?.id,label:s.properties?.label,d:haversine(lat,lon,s.geometry?.coordinates?.[1],s.geometry?.coordinates?.[0])}))
    .filter(s=>s.id&&Number.isFinite(s.d)).sort((a,b)=>a.d-b.d).slice(0,3);
  const out=await Promise.all(st.map(async s=>{
    const t=await getJson(client,SOS+"/timeseries?"+new URLSearchParams({station:String(s.id),expanded:"true"}),{maxBytes:256*1024,ttl:15*60});
    const now=Date.now(),vals={};
    for(const ts of t.json||[]){
      const k=PHEN.find(([re])=>re.test(ts.parameters?.phenomenon?.label||""))?.[1];if(!k||vals[k])continue;
      const lv=ts.lastValue;if(!lv||typeof lv.value!=="number")continue;
      const age=(now-lv.timestamp)/HOUR/1000;
      vals[k]=clean({value:round(lv.value,1),unit:ts.uom,measured:new Date(lv.timestamp).toISOString().slice(0,16)+"Z",stale:age>3?"last value is "+Math.round(age)+" h old":null});
    }
    return clean({station:s.label,distance_km:round(s.d/1000,1),latest:Object.keys(vals).length?vals:null,error:t.error||null});
  }));
  return{stations:out};
}

export async function airQuality(client,args,{assets}={}){
  const w=await resolveLocation(client,args,{area:"belgium"});if(w.error)return{error:w.error,...(w.location?{location:w.location}:{})};
  const loc=w.loc,{x,y}=loc;
  const hourly=["no2","pm25","pm10","o3","bc"],annual=["no2","pm25","pm10"];
  const [now,day,year,fc,street,stations,place]=await Promise.all([
    gfi(client,hourly.map(p=>"rio:"+p+"_hmean"),x,y,15*60),
    gfi(client,["rio:pm25_24hmean","rio:pm10_24hmean"],x,y,15*60),
    gfi(client,annual.map(p=>"rio:"+p+"_anmean_be"),x,y,7*DAY),
    gfi(client,[0,1,2,3].map(d=>"forecast:belaqi_d"+d),x,y,HOUR),
    gfi(client,annual.map(p=>"rioifdm:"+p+"_anmean_"+ATMO_YEAR+"_atmostreet_vl"),x,y,7*DAY),
    loc.latitude!=null?nearestStations(client,loc.latitude,loc.longitude):Promise.resolve(null),
    placeContext(client,assets,loc).catch(()=>null)
  ]);
  if(now.error&&year.error&&fc.error)return{error:"IRCEL's services did not answer; try again in a minute.",location:loc};
  const fmt=v=>typeof v==="number"&&v>=0&&v<5000?round(v,1):null;
  const current=now.values?clean({hour_utc:now.values[0]?.timestamp?.slice(0,16)+"Z",model:"RIO interpolation of the measuring network, 4 x 4 km cell, µg/m³",
    ...Object.fromEntries(hourly.map((p,i)=>[p+"_ugm3",fmt(now.values[i]?.value)]))}):{error:now.error};
  const last24=day.values?clean({pm25_ugm3:fmt(day.values[0]?.value),pm10_ugm3:fmt(day.values[1]?.value),
    who_2021_24h_guideline:DAILY_WHO,above_who_24h:[["pm25",day.values[0]?.value],["pm10",day.values[1]?.value]].filter(([p,v])=>v>DAILY_WHO[p]).map(([p])=>POLL[p])}):null;
  const yr=year.values?.[0]?.year?.slice(0,4);
  const cmp=(vals)=>Object.fromEntries(annual.map((p,i)=>{const v=fmt(vals[i]);if(v===null)return[p,null];const s=ANNUAL[p];
    return[p,clean({ugm3:v,times_who_2021:round(v/s.who_2021,1),above_eu_limit_now:v>s.eu_now,above_eu_limit_2030:v>s.eu_2030})]}));
  const annualOut=year.values?clean({year:yr,model:"RIO 4 x 4 km (background, all of Belgium)",...cmp(year.values.map(v=>v.value))}):{error:year.error};
  // ATMO-Street exists for Flanders only; elsewhere the raster answers no-data (a negative or absent value)
  const streetVals=street.values?.map(v=>v.GRAY_INDEX);
  const streetOut=streetVals&&streetVals.some(v=>fmt(v)!==null)?clean({year:String(ATMO_YEAR),model:"ATMO-Street, about 10 m, including the effect of the street (Flanders)",...cmp(streetVals)}):null;
  // forecast days as Belgian calendar dates (the d0 layer is today's forecast in Belgium)
  const bxl=d=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Brussels"}).format(new Date(Date.now()+d*86400000));
  const forecast=fc.values?fc.values.map((v,d)=>{const i=Math.round(v.GRAY_INDEX);return clean({date:bxl(d),day:d===0?"today":d===1?"tomorrow":null,belaqi:i>=1&&i<=10?i:null,label:BELAQI[i]||null})}):null;
  const standards={annual_ugm3:ANNUAL,who_24h_ugm3:DAILY_WHO,sources:"WHO global air quality guidelines (2021); EU limit values: Directive 2008/50/EC (current) and Directive (EU) 2024/2881 (from 2030)."};
  const facts=[];
  if(current.no2_ugm3!=null)facts.push("This hour ("+current.hour_utc+"), modelled for the 4 km cell: NO2 "+current.no2_ugm3+", PM2.5 "+current.pm25_ugm3+", PM10 "+current.pm10_ugm3+", O3 "+current.o3_ugm3+" µg/m³.");
  if(forecast?.[0]?.belaqi)facts.push("BelAQI forecast: today ("+forecast[0].date+") "+forecast[0].belaqi+" ("+forecast[0].label+")"+forecast.slice(1).filter(f=>f.belaqi).map(f=>", "+f.date+" "+f.belaqi+" ("+f.label+")").join("")+" on IRCEL's 1 (excellent) to 10 (horrible) scale.");
  const an=streetOut||annualOut;
  if(an?.no2)facts.push("Annual mean "+an.year+" ("+(streetOut?"street level":"4 km background")+"): NO2 "+an.no2.ugm3+", PM2.5 "+an.pm25?.ugm3+", PM10 "+an.pm10?.ugm3+" µg/m³ – "+
    ["no2","pm25","pm10"].map(p=>an[p]&&(p==="no2"?"NO2":p==="pm25"?"PM2.5":"PM10")+" "+an[p].times_who_2021+"× the WHO guideline"+(an[p].above_eu_limit_2030?", above the EU 2030 limit":"")).filter(Boolean).join("; ")+".");
  if(last24?.above_who_24h?.length)facts.push("The last 24 hours are above the WHO 24-hour guideline for "+last24.above_who_24h.join(" and ")+".");
  // the nearest station with a current measurement (a nearer one may have been out of service for months)
  const fresh=(stations?.stations||[]).map(s=>({...s,now:Object.entries(s.latest||{}).filter(([,v])=>!v.stale)})).find(s=>s.now.length);
  if(fresh)facts.push("Nearest station measuring now: "+fresh.station+" ("+fresh.distance_km+" km): "+fresh.now.map(([k,v])=>k.toUpperCase().replace("PM25","PM2.5")+" "+v.value).join(", ")+" µg/m³ at "+fresh.now[0][1].measured+"."+
    (stations.stations[0].station!==fresh.station?" The nearer station "+stations.stations[0].station+" has no current values.":""));
  return clean({key_facts:facts,location:clean({...loc,x_lambert72:loc.x,y_lambert72:loc.y,x:undefined,y:undefined,geocoded:undefined}),place,
    now:current,last_24h:last24,forecast_belaqi:forecast,annual_street_level:streetOut,annual_background:annualOut,nearest_stations:stations?.stations||(stations?.error?{error:stations.error}:null),
    standards,
    note:"Modelled values (RIO, ATMO-Street) are interpolations of the measuring network; station values are measurements at that station. Hourly values are not comparable with annual standards. Times are UTC.",
    provenance:{source:"IRCEL-CELINE (Belgian Interregional Environment Agency)",licence:"CC BY 4.0",datasets:["RIO interpolated hourly, 24-hour and annual means","BelAQI forecast","ATMO-Street annual means (Flanders)","SOS measurements"],
      citation:"IRCEL-CELINE, air quality data (RIO, ATMO-Street, BelAQI forecast, measurements), CC BY 4.0, retrieved "+new Date().toISOString().slice(0,10)+".",services:"https://geo.irceline.be/"}});
}
