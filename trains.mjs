// train_punctuality: how punctual Belgian trains are, from Infrabel (the rail infrastructure manager), as an answer for a station, a train
// number, an IC line or the whole network: the official monthly figures with their trend and context, what happened yesterday train by
// train, and how today is going so far.
//
// Sources: Infrabel open data (opendata.infrabel.be, Opendatasoft Explore API v2.1), all CC0, no key. Read live, edge-cached:
//   maandelijkse-stiptheid-per-stopplaats   monthly share of trains arriving < 6 min late at each of ~555 passenger stops
//   ruwe-gegevens-van-stiptheid-d-1         every passenger train at every point it passed YESTERDAY (planned/actual, delay in seconds)
//   data_punctualite_trainic (+ per moment) monthly punctuality per IC relation and direction
//   nationale-stiptheid-per-maand (+ with cancelled trains), data_punctualite_typedetrain, oorzaken-vertraging-per-maand,
//   maandelijks-afgeschafte-treinen-per-operator, realtime-stiptheid, stiptheid-van-vandaag-per-uur
//
// What makes the answers true (and what older one-table clients get wrong):
// - "On time" means arriving less than 6 minutes late (5 min 59 s). Cancelled trains are NOT in the punctuality percentage; Infrabel
//   publishes a separate national figure that counts them, given next to it.
// - The national and IC figures are measured at the destination (or the first Brussels North-South junction station), the station
//   figures at every stop. They are different measurements: a station is compared with the average over all stops in the same month,
//   computed from the same table, never with the national figure.
// - The "neutralised" national figure leaves out delays the management contract excuses (external causes, planned works); Infrabel
//   says the plain figure reflects what passengers see, so that one leads and the neutralised one is labelled.
// - Yesterday's raw data is aggregated by Infrabel's API (counts per delay band, averages, the worst trains), never downloaded whole
//   (45,000 rows a day). It holds only trains that ran: a cancelled train leaves no trace there.
// - Today's hourly table comes unsorted; it is sorted here. Realtime timestamps are UTC.
import { _dov } from "./dov.mjs";
const {getJson,resolveLocation,clean,round,num,DAY,HOUR}=_dov;

const ODS="https://opendata.infrabel.be/api/explore/v2.1/catalog/datasets/";
export const TRAIN_HOSTS=Object.freeze(["opendata.infrabel.be"]);
const ON_TIME_S=360;
const BXL_JUNCTION=new Set(["BRUSSEL-ZUID","BRUSSEL-KAPELLEKERK","BRUSSEL-CENTRAAL","BRUSSEL-CONGRES","BRUSSEL-NOORD"]);
const TECHNICAL=/WIJKSPO|GOEDEREN|BUNDEL|FAISCEAU|GARAGE|MARCHANDISE|WERKPLAATS|RELAIS|ANNEXE|ROOSTER|GRIL|-SAS$/;
// names people use that differ from Infrabel's (Dutch exonyms of Walloon towns, English and French names of Flemish ones)
const ALIAS={luik:"liege",bergen:"mons",namen:"namur",doornik:"tournai",hoei:"huy",nijvel:"nivelles",waver:"wavre",aarlen:"arlon",moeskroen:"mouscron",
  edingen:"enghien",aat:"ath",zinnik:"soignies",borgworm:"waremme",geldenaken:"jodoigne",louvain:"leuven",malines:"mechelen",anvers:"antwerpen",antwerp:"antwerpen",
  gand:"gent",ghent:"gent",bruges:"brugge",courtrai:"kortrijk",ostende:"oostende",ostend:"oostende",alost:"aalst",termonde:"dendermonde",hal:"halle",
  vilvorde:"vilvoorde",tirlemont:"tienen","saint-trond":"sint-truiden",tongres:"tongeren",renaix:"ronse",ypres:"ieper",grammont:"geraardsbergen",
  "brussels-south":"brussel-zuid","brussels-midi":"brussel-zuid","bruxelles-midi":"brussel-zuid","brussels south":"brussel-zuid","brussels central":"brussel-centraal",
  "brussels north":"brussel-noord","brussels airport":"brussels airport - zaventem",zaventem:"brussels airport - zaventem"};
// for a bare city name with several stations, the main one (Brussels is left ambiguous on purpose: three main stations)
const MAIN_SUFFIX=["CENTRAAL","CENTRAL","SINT-PIETERS","GUILLEMINS"];

const fold=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/['’]/g,"").replace(/\s*-\s*/g,"-").replace(/\s+/g," ").trim();
const pct=v=>v==null?null:round(v,1);
const mins=s=>s==null?null:round(s/60,1);
const monthOf=iso=>String(iso||"").slice(0,7);
const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
const monthName=m=>m?MONTHS[Number(m.slice(5,7))-1]+" "+m.slice(0,4):null;
const nf=n=>n==null?null:Math.round(n).toLocaleString("en-US");
const hav=(a,b,c,d)=>{const R=6371,t=Math.PI/180,s=Math.sin((c-a)*t/2)**2+Math.cos(a*t)*Math.cos(c*t)*Math.sin((d-b)*t/2)**2;return 2*R*Math.asin(Math.sqrt(s))};
const weekday=d=>new Intl.DateTimeFormat("en-GB",{weekday:"long",day:"numeric",month:"long",timeZone:"UTC"}).format(new Date(d+"T12:00:00Z"));
const localTime=iso=>new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Brussels",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(iso));
const titleCase=s=>String(s||"").toLowerCase().replace(/(^|[\s\-\/(])([a-zà-ÿ])/g,(m,a,b)=>a+b.toUpperCase());

/** One Explore API call; rows or {error}. Records answer at most 100 rows; exports answer all matching rows. */
// Infrabel writes a time of exactly midnight as a spreadsheet zero date ("1899-12-30 00:00:00"); the date lives in the matching *_date_* field.
const TIME_FIELDS=["planned_time_arr","planned_time_dep","real_time_arr","real_time_dep"];
export function clockTime(v){const m=/(\d{2}:\d{2}(?::\d{2})?)\s*$/.exec(String(v));return m?m[1]:String(v)}
async function ods(client,ds,params,{ttl=6*HOUR,exportAll=false,maxBytes=512*1024}={}){
  const r=await getJson(client,ODS+ds+(exportAll?"/exports/json?":"/records?")+new URLSearchParams(params),{maxBytes,ttl});
  if(r.error)return{error:r.error};
  const rows=exportAll?r.json:r.json?.results;
  if(!Array.isArray(rows))return{error:"Infrabel answered without records"+(r.json?.message?": "+String(r.json.message).slice(0,120):"")};
  for(const row of rows)if(row&&typeof row==="object")for(const f of TIME_FIELDS)if(row[f]!=null)row[f]=clockTime(row[f]);
  return{rows};
}

// ---------- stations ----------
/** The latest month of the per-stop table: every passenger stop with names, coordinates and that month's punctuality. Two requests. */
async function stopsLatest(client,month){
  let m=month;
  if(!m){const x=await ods(client,"maandelijkse-stiptheid-per-stopplaats",{select:"max(datum) as last",limit:"1"});if(x.error)return x;m=monthOf(x.rows[0]?.last)}
  if(!/^\d{4}-\d{2}$/.test(m||""))return{error:"Infrabel did not say which month is the latest"};
  const r=await ods(client,"maandelijkse-stiptheid-per-stopplaats",{select:"ptcar_no,installatienaam_nederlands,installatienaam_frans,installatienaam_engels,stiptheid,sumoftel,sumofreg,geo_point_2d",
    where:"datum = date'"+m+"-01'"},{exportAll:true,ttl:6*HOUR});
  if(r.error)return r;
  return{month:m,stops:r.rows.map(s=>({id:s.ptcar_no,nl:s.installatienaam_nederlands,fr:s.installatienaam_frans,en:s.installatienaam_engels,pct:num(s.stiptheid),tel:num(s.sumoftel),reg:num(s.sumofreg),
    lat:s.geo_point_2d?.lat,lon:s.geo_point_2d?.lon}))};
}
export function matchStation(stops,input){
  const q0=fold(input);if(!q0)return{error:"empty station name"};
  // the name as given first; then translated whole ("Antwerp"), then by its first part ("Luik-Guillemins" -> "liege-guillemins").
  // Translating first would break real names that start with an exonym ("Louvain-la-Neuve" is not "Leuven-la-Neuve").
  const tries=[q0,ALIAS[q0],q0.includes("-")&&ALIAS[q0.split("-")[0]]?ALIAS[q0.split("-")[0]]+q0.slice(q0.indexOf("-")):null].filter((x,i,a)=>x&&a.indexOf(x)===i);
  // exact names for every spelling before any partial match: "Louvain" must reach Leuven (exonym) before it prefixes Louvain-la-Neuve
  for(const q of tries){const ex=stops.filter(s=>[s.nl,s.fr,s.en].map(fold).includes(q));if(ex.length)return{stop:ex.sort((a,b)=>(b.tel||0)-(a.tel||0))[0]}}
  let ambiguous=null;
  for(const q of tries){const m=matchOne(stops,q,input);if(m.stop)return m;if(m.error&&!ambiguous&&m.ambiguous)ambiguous=m}
  return ambiguous||{error:"No passenger station called '"+input+"' in Infrabel's list. Use the name on the station (Dutch or French), e.g. 'Leuven', 'Bruxelles-Midi', 'Gent-Sint-Pieters', or give an address."};
}
function matchOne(stops,q,input){
  const names=s=>[s.nl,s.fr,s.en].map(fold);
  const exact=stops.filter(s=>names(s).includes(q));
  if(exact.length)return{stop:exact.sort((a,b)=>(b.tel||0)-(a.tel||0))[0]};
  const pre=stops.filter(s=>names(s).some(n=>n.startsWith(q+"-")||n.startsWith(q+" ")));
  const brussels=["brussel","bruxelles","brussels"].includes(q);
  const main=brussels?null:pre.find(s=>MAIN_SUFFIX.some(x=>fold(s.nl).endsWith("-"+fold(x))));
  if(main)return{stop:main,note:"'"+input+"' has several stations; the main one, "+titleCase(main.nl)+", is used."};
  const any=pre.length?pre:stops.filter(s=>names(s).some(n=>n.includes(q)));
  if(any.length===1)return{stop:any[0]};
  if(any.length>1)return{ambiguous:true,error:"'"+input+"' matches several stations: "+any.sort((a,b)=>(b.tel||0)-(a.tel||0)).slice(0,10).map(s=>titleCase(s.nl)).join(", ")+". Give one of these."};
  return{};
}

const pctOf=(reg,tel)=>tel?reg/tel*100:null;
async function stationAnswer(client,args,loc){
  const latest=await stopsLatest(client,args.month);if(latest.error)return{error:latest.error};
  let st,note;
  if(args.station){const m=matchStation(latest.stops,args.station);if(m.error)return{error:m.error};st=m.stop;note=m.note}
  else{const all=latest.stops.filter(s=>s.lat&&s.lon).map(s=>({s,d:hav(loc.latitude,loc.longitude,s.lat,s.lon)})).sort((a,b)=>a.d-b.d),near=all[0];
    if(!near||near.d>15)return{error:"No passenger station within 15 km of this place."};st={...near.s,distance_km:round(near.d,1)};
    const others=all.slice(1).filter(x=>x.d<=2);
    note="Nearest station to the address ("+st.distance_km+" km)."+(others.length?" Also within 2 km: "+others.map(x=>titleCase(x.s.nl)+" ("+round(x.d,1)+" km)").join(", ")+"; ask for it by name for its figures.":"")}
  const nl=st.nl;
  // the station's last 13 months; the average over all stops per month (same measurement); yesterday's arrivals there
  const since=(()=>{const [y,mo]=latest.month.split("-").map(Number);const d=new Date(Date.UTC(y,mo-13,1));return d.toISOString().slice(0,10)})();
  const D1="ruwe-gegevens-van-stiptheid-d-1",at='ptcar_lg_nm_nl = "'+nl.replace(/"/g,"")+'"';
  const [hist,avg,sum,bands,worst,inc]=await Promise.all([
    ods(client,"maandelijkse-stiptheid-per-stopplaats",{select:"datum,stiptheid,sumoftel,sumofreg",where:"ptcar_no = "+Number(st.id)+" and datum >= date'"+since+"' and datum <= date'"+latest.month+"-01'",order_by:"datum desc",limit:"13"}),
    ods(client,"maandelijkse-stiptheid-per-stopplaats",{select:"datum,sum(sumofreg) as reg,sum(sumoftel) as tel",where:"datum >= date'"+since+"' and datum <= date'"+latest.month+"-01'",group_by:"datum",order_by:"datum desc",limit:"13"}),
    ods(client,D1,{select:"max(datdep) as day,count(*) as passes,count(delay_arr) as arrivals,avg(delay_arr) as avg_arr,count(delay_dep) as departures",where:at,limit:"1"},{ttl:HOUR}),
    ods(client,D1,{select:"train_serv,count(*) as n",where:at+" and delay_arr is not null",group_by:"train_serv,range(delay_arr, *, 60, 360, 900, *) as band",limit:"100"},{ttl:HOUR}),
    ods(client,D1,{select:"train_no,relation_direction,train_serv,planned_time_arr,delay_arr",where:at+" and delay_arr >= 360",order_by:"delay_arr desc",limit:"5"},{ttl:HOUR}),
    incidentsAt(client,[...new Set([st.nl,st.fr].filter(Boolean))])
  ]);
  const avgBy=Object.fromEntries((avg.rows||[]).map(r=>[monthOf(r.datum),pctOf(r.reg,r.tel)]));
  const months=(hist.rows||[]).map(r=>clean({month:monthOf(r.datum),on_time_pct:pct(num(r.stiptheid)),trains:num(r.sumoftel),all_stops_pct:pct(avgBy[monthOf(r.datum)])})).sort((a,b)=>a.month<b.month?-1:1);
  // rank within the month among stops with enough trains for a stable share (at least 500 arrivals)
  const peers=latest.stops.filter(s=>s.tel>=500&&s.pct!=null);
  const rank=st.tel>=500?1+peers.filter(s=>s.pct>st.pct).length:null;
  const allStops=pctOf(latest.stops.reduce((n,s)=>n+(s.reg||0),0),latest.stops.reduce((n,s)=>n+(s.tel||0),0));
  const last12=months.slice(-12),tel12=last12.reduce((n,m)=>n+(m.trains||0),0),reg12=last12.reduce((n,m)=>n+(m.trains||0)*(m.on_time_pct||0)/100,0);
  const best=[...last12].sort((a,b)=>b.on_time_pct-a.on_time_pct)[0],worstM=[...last12].sort((a,b)=>a.on_time_pct-b.on_time_pct)[0];
  // yesterday
  const s0=sum.rows?.[0]||{},day=String(s0.day||"").slice(0,10);
  const band={on_time_under_1:0,late_1_to_6:0,late_6_to_15:0,late_15_plus:0},byOp={};
  for(const r of bands.rows||[]){const k=r.band==="[*, 59]"?"on_time_under_1":r.band==="[60, 359]"?"late_1_to_6":r.band==="[360, 899]"?"late_6_to_15":r.band==="[900, *]"?"late_15_plus":null;if(!k)continue;
    band[k]+=r.n;const o=r.train_serv||"other";(byOp[o]||(byOp[o]={arrivals:0,on_time:0})).arrivals+=r.n;if(k==="on_time_under_1"||k==="late_1_to_6")byOp[o].on_time+=r.n}
  const arr=Object.values(band).reduce((a,b)=>a+b,0),ontime=band.on_time_under_1+band.late_1_to_6;
  const yesterday=arr?clean({date:day,arrivals_measured:arr,on_time:ontime,on_time_pct:pct(pctOf(ontime,arr)),average_delay_min:mins(num(s0.avg_arr)),bands:band,
    by_operator:Object.fromEntries(Object.entries(byOp).map(([k,v])=>[k,{arrivals:v.arrivals,on_time_pct:pct(pctOf(v.on_time,v.arrivals))}])),
    trains_starting_here:num(s0.passes)-num(s0.arrivals)||null,
    late_trains:(worst.rows||[]).map(r=>clean({train_no:r.train_no,relation:r.relation_direction,operator:r.train_serv,planned_arrival:String(r.planned_time_arr||"").slice(0,5),delay_min:mins(r.delay_arr)}))}):null;
  const name=titleCase(st.nl)+(fold(st.fr)!==fold(st.nl)?" ("+titleCase(st.fr)+")":"");
  const facts=[];
  facts.push(name+": in "+monthName(latest.month)+", "+pct(st.pct)+" % of the "+nf(st.tel)+" trains that stopped there arrived less than 6 minutes late (Infrabel), against "+pct(allStops)+" % over all "+latest.stops.length+" Belgian stops"+
    (rank?"; rank "+rank+" of "+peers.length+" stops with at least 500 trains (1 = most punctual)":"")+".");
  if(last12.length>=6)facts.push("Over the last "+last12.length+" months: "+pct(pctOf(reg12,tel12))+" % on time; best month "+monthName(best.month)+" ("+best.on_time_pct+" %), worst "+monthName(worstM.month)+" ("+worstM.on_time_pct+" %).");
  // international trains (Eurostar, ICE, TGV...) can dominate a bad day at a few stations: give the SNCB share beside the total
  const sncb=yesterday?.by_operator?.["SNCB/NMBS"],intl=yesterday&&sncb&&sncb.arrivals<arr;
  if(yesterday)facts.push("Yesterday ("+weekday(day)+"): "+nf(ontime)+" of "+nf(arr)+" measured arrivals on time ("+yesterday.on_time_pct+" %"+(intl?"; SNCB trains only: "+sncb.on_time_pct+" % of "+nf(sncb.arrivals):"")+"); "+band.late_6_to_15+" arrived 6 to 15 minutes late and "+band.late_15_plus+" at least 15 minutes late; average delay "+yesterday.average_delay_min+" min.");
  if(yesterday?.late_trains?.length)facts.push("Most delayed arrivals there yesterday: "+yesterday.late_trains.slice(0,3).map(t=>"train "+t.train_no+" ("+fmtRel(t.relation)+", due "+t.planned_arrival+") "+t.delay_min+" min late").join("; ")+".");
  if(inc.rows?.length)facts.push("Major incidents Infrabel recorded at "+titleCase(st.nl)+" in the last 13 months: "+inc.rows.slice(0,3).map(fmtIncident).join("; ")+".");
  if(note)facts.push(note);
  facts.push("On time = less than 6 minutes late on arrival. Cancelled trains are not in these figures (Infrabel publishes cancellations only nationally), and a station's figure is measured at every stop, so it is not comparable with the national figure (measured at destinations).");
  return{facts,body:{station:clean({name_nl:titleCase(st.nl),name_fr:titleCase(st.fr),name_en:titleCase(st.en),ptcar_no:st.id,latitude:st.lat,longitude:st.lon,distance_km:st.distance_km}),
    month:clean({month:latest.month,on_time_pct:pct(st.pct),trains:st.tel,on_time_trains:st.reg,all_stops_pct:pct(allStops),stops:latest.stops.length,rank,ranked_stops:rank?peers.length:null}),
    last_13_months:months,yesterday,major_incidents:inc.rows?.length?inc.rows.map(incidentView):null,errors:[hist,avg,sum,bands,worst,inc].filter(x=>x.error).map(x=>x.error)}};
}

// ---------- one train yesterday ----------
async function trainAnswer(client,no){
  const r=await ods(client,"ruwe-gegevens-van-stiptheid-d-1",{select:"datdep,relation,relation_direction,train_serv,ptcar_lg_nm_nl,planned_date_arr,planned_time_arr,real_time_arr,delay_arr,planned_date_dep,planned_time_dep,real_time_dep,delay_dep",
    where:'train_no = "'+no+'"',limit:"100"},{ttl:HOUR});
  if(r.error)return{error:r.error};
  if(!r.rows.length)return{error:"Train "+no+" does not appear in Infrabel's data for yesterday: it did not run yesterday, was cancelled, or the number is not a Belgian passenger train. Only yesterday's trains are published train by train."};
  const t=x=>x.planned_date_dep&&x.planned_time_dep?x.planned_date_dep+"T"+x.planned_time_dep:x.planned_date_arr+"T"+x.planned_time_arr;
  const stops=r.rows.map(x=>({...x,key:t(x)})).sort((a,b)=>a.key<b.key?-1:1);
  const first=stops[0],last=stops.at(-1);
  const dep=x=>x.delay_dep??x.delay_arr,arr=x=>x.delay_arr??x.delay_dep;
  // official measuring points: the destination and, for trains through Brussels, the first North-South junction station it arrives at
  const junction=stops.find(x=>BXL_JUNCTION.has(x.ptcar_lg_nm_nl)&&x.delay_arr!=null&&x!==last);
  let grow=null;
  // time lost on the way: departure delay at one point to arrival delay at the next (a scheduled dwell after an early arrival is not a loss)
  for(let i=1;i<stops.length;i++){const a=dep(stops[i-1]),b=arr(stops[i]);if(a==null||b==null)continue;const d=b-a;if(!grow||d>grow.d)grow={d,from:stops[i-1].ptcar_lg_nm_nl,to:stops[i].ptcar_lg_nm_nl}}
  const peak=stops.reduce((m,x)=>{const d=Math.max(x.delay_arr??-1e9,x.delay_dep??-1e9);return d>-1e9&&(!m||d>m.d)?{d,at:x.ptcar_lg_nm_nl}:m},null);
  // trains to or from abroad: Infrabel's data covers the Belgian network only, so the last point is not the destination
  const destName=String(first.relation_direction||"").split("->")[1]?.trim()||"";
  const abroad=destName&&fold(destName)!==fold(last.ptcar_lg_nm_nl);
  const view=stops.map(x=>clean({point:titleCase(x.ptcar_lg_nm_nl),technical:TECHNICAL.test(x.ptcar_lg_nm_nl)?true:null,planned_arrival:String(x.planned_time_arr||"").slice(0,5),arrival_delay_min:mins(x.delay_arr),
    planned_departure:String(x.planned_time_dep||"").slice(0,5),departure_delay_min:mins(x.delay_dep)}));
  const finalDelay=last.delay_arr??last.delay_dep,onTime=finalDelay!=null&&!abroad?finalDelay<ON_TIME_S:null,day=String(first.datdep).slice(0,10);
  const facts=["Train "+no+" ("+fmtRel(first.relation_direction)+", "+first.train_serv+") on "+weekday(day)+": left "+titleCase(first.ptcar_lg_nm_nl)+" at "+String(first.planned_time_dep).slice(0,5)+(first.delay_dep!=null?" "+fmtDelay(first.delay_dep):"")+
    (abroad?" and passed "+titleCase(last.ptcar_lg_nm_nl)+", its last point on the Belgian network (it continues to "+titleCase(destName)+", outside Infrabel's data), "+(finalDelay!=null?fmtDelay(finalDelay):"without a recorded time")+"."
      :" and reached "+titleCase(last.ptcar_lg_nm_nl)+" "+(finalDelay!=null?fmtDelay(finalDelay):"(no arrival time recorded)")+(onTime===null?".":onTime?", on time by Infrabel's 6-minute rule.":", late by Infrabel's 6-minute rule."))];
  if(junction)facts.push("At "+titleCase(junction.ptcar_lg_nm_nl)+", its first Brussels North-South junction stop (also an official measuring point): "+fmtDelay(junction.delay_arr)+".");
  if(peak&&peak.d>=60)facts.push("Its delay peaked at "+mins(peak.d)+" min at "+titleCase(peak.at)+(grow&&grow.d>=60?"; it lost the most time between "+titleCase(grow.from)+" and "+titleCase(grow.to)+" (+"+mins(grow.d)+" min)":"")+".");
  return{facts,body:{train:clean({train_no:no,date:day,relation:first.relation,direction:first.relation_direction,operator:first.train_serv,points:stops.length,
    final_arrival_delay_min:abroad?null:mins(finalDelay),last_belgian_point_delay_min:abroad?mins(finalDelay):null,continues_abroad_to:abroad?titleCase(destName):null,on_time_at_destination:onTime,junction_stop:junction?clean({point:titleCase(junction.ptcar_lg_nm_nl),arrival_delay_min:mins(junction.delay_arr)}):null,
    peak_delay:peak?{min:mins(peak.d),at:titleCase(peak.at)}:null,largest_loss:grow&&grow.d>0?{min:mins(grow.d),between:titleCase(grow.from)+" and "+titleCase(grow.to)}:null}),
    stops:view},ic:/^IC\b/.test(first.relation||"")?first.relation:null};
}
/** "IC 03: GENK -> BLANKENBERGE" -> "IC 03 Genk → Blankenberge" */
export const fmtRel=r=>{const m=String(r||"").match(/^([^:]+):\s*(.+?)\s*->\s*(.+)$/);return m?m[1].trim()+" "+titleCase(m[2])+" → "+titleCase(m[3]):String(r||"")};
const fmtDelay=s=>s==null?"":s<=-60?mins(-s)+" min early":s<60?"on time ("+(s>=0?"+":"")+s+" s)":mins(s)+" min late";

// ---------- between two stations, yesterday ----------
// Yesterday's raw data lists every point each train passed. A train STOPS at a point when its planned arrival and departure differ, or
// when it starts (no arrival) or ends (no departure) there; a train that only passes through has the same planned arrival and departure
// (Eurostar and ICE through Leuven, for instance) and must not count as a connection. Both directions come from the same rows.
const hm=t=>String(t||"").slice(0,5);
const stopsAt=r=>!(r.planned_time_arr&&r.planned_time_dep&&r.planned_time_arr===r.planned_time_dep);
const stamp=(d,t)=>d&&t?Date.parse(d+"T"+t+"Z"):null;   // planned local wall-clock times compared as if UTC: only differences are used
const median=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
/** Trains that stopped at A and later at B, from yesterday's rows at both points. */
export function connections(rows,A,B){
  const by=new Map();
  for(const r of rows){const k=r.train_no+"|"+String(r.datdep||"").slice(0,10);(by.get(k)||by.set(k,[]).get(k)).push(r)}
  const out=[];
  for(const list of by.values()){
    const a=list.find(r=>r.ptcar_lg_nm_nl===A&&r.planned_time_dep&&stopsAt(r)),b=list.find(r=>r.ptcar_lg_nm_nl===B&&r.planned_time_arr&&stopsAt(r));
    if(!a||!b)continue;
    const dep=stamp(a.planned_date_dep,a.planned_time_dep),arr=stamp(b.planned_date_arr,b.planned_time_arr);
    if(dep==null||arr==null||arr<=dep)continue;
    const planned=(arr-dep)/60e3,dd=a.delay_dep??null,da=b.delay_arr??null;
    const nextDay=String(a.planned_date_dep||"").slice(0,10)>String(a.datdep||"").slice(0,10);   // left after midnight on a train of the previous service day
    out.push({train_no:a.train_no,relation:a.relation,direction:a.relation_direction,operator:a.train_serv,dep:hm(a.planned_time_dep)+(nextDay?" (after midnight)":""),arr:hm(b.planned_time_arr),
      dep_delay_s:dd,arr_delay_s:da,planned_min:planned,actual_min:dd!=null&&da!=null?planned+(da-dd)/60:null,t:dep});
  }
  return out.sort((x,y)=>x.t-y.t);
}
const PERIODS=[["morning peak (departing 06:00-08:59)",6,9],["evening peak (departing 16:00-18:59)",16,19]];
function summariseLeg(list){
  const m=list.filter(x=>x.arr_delay_s!=null),on=m.filter(x=>x.arr_delay_s<ON_TIME_S).length;
  const periods=PERIODS.map(([name,a,b])=>{const p=m.filter(x=>{const h=Number(x.dep.slice(0,2));return h>=a&&h<b}),o=p.filter(x=>x.arr_delay_s<ON_TIME_S).length;
    return p.length?{period:name,trains:p.length,on_time_pct:pct(pctOf(o,p.length))}:null}).filter(Boolean);
  return clean({trains:list.length,measured:m.length,on_time:on,on_time_pct:m.length?pct(pctOf(on,m.length)):null,
    late_6_to_15:m.filter(x=>x.arr_delay_s>=ON_TIME_S&&x.arr_delay_s<900).length,late_15_plus:m.filter(x=>x.arr_delay_s>=900).length,
    average_arrival_delay_min:m.length?mins(m.reduce((n,x)=>n+x.arr_delay_s,0)/m.length):null,median_arrival_delay_min:m.length?mins(median(m.map(x=>x.arr_delay_s))):null,
    scheduled_minutes_median:list.length?round(median(list.map(x=>x.planned_min)),0):null,scheduled_minutes_fastest:list.length?round(Math.min(...list.map(x=>x.planned_min)),0):null,
    actual_minutes_median:list.some(x=>x.actual_min!=null)?round(median(list.filter(x=>x.actual_min!=null).map(x=>x.actual_min)),0):null,
    by_period:periods.length?periods:null,
    first_departure:list[0]?.dep,last_departure:list.at(-1)?.dep,
    lines:[...new Set(list.map(x=>x.relation).filter(Boolean))].slice(0,8)});
}
async function journeyAnswer(client,from,to){
  const latest=await stopsLatest(client);if(latest.error)return{error:latest.error};
  const a=matchStation(latest.stops,from);if(a.error)return{error:"from_station: "+a.error};
  const b=matchStation(latest.stops,to);if(b.error)return{error:"to_station: "+b.error};
  if(a.stop.id===b.stop.id)return{error:"from_station and to_station are the same station ("+titleCase(a.stop.nl)+")."};
  const A=a.stop.nl,B=b.stop.nl,q=s=>'"'+s.replace(/"/g,"")+'"';
  const [r,inc]=await Promise.all([
    ods(client,"ruwe-gegevens-van-stiptheid-d-1",{select:"datdep,train_no,relation,relation_direction,train_serv,ptcar_lg_nm_nl,planned_date_arr,planned_time_arr,planned_date_dep,planned_time_dep,delay_arr,delay_dep",
      where:"ptcar_lg_nm_nl in ("+q(A)+","+q(B)+")"},{exportAll:true,ttl:HOUR,maxBytes:4<<20}),
    incidentsAt(client,[...new Set([A,B,a.stop.fr,b.stop.fr].filter(Boolean))])]);
  if(r.error)return{error:r.error};
  const day=String(r.rows.map(x=>x.datdep).filter(Boolean).sort().at(-1)||"").slice(0,10);
  const go=connections(r.rows,A,B),back=connections(r.rows,B,A);
  const nA=titleCase(A),nB=titleCase(B);
  if(!go.length&&!back.length)return{error:"No train stopped at both "+nA+" and "+nB+" yesterday in Infrabel's data. They may need a change of train (this tool follows one train at a time), or no train ran between them yesterday."};
  const S=summariseLeg(go),R=summariseLeg(back);
  const facts=[];
  if(go.length){
    facts.push(nA+" → "+nB+" yesterday ("+weekday(day)+"): "+go.length+" direct train"+(go.length>1?"s":"")+" stopped at both; "+(S.measured?S.on_time+" of "+S.measured+" ("+S.on_time_pct+" %) arrived at "+nB+" less than 6 minutes late, average arrival delay "+S.average_arrival_delay_min+" min"+(S.late_15_plus?", "+S.late_15_plus+" at least 15 minutes late":""):"no arrival times recorded")+".");
    facts.push("Journey time "+nA+" → "+nB+": "+S.scheduled_minutes_median+" min scheduled (median; fastest "+S.scheduled_minutes_fastest+" min)"+(S.actual_minutes_median!=null?", "+S.actual_minutes_median+" min as actually run (median)":"")+"; first departure "+S.first_departure+", last "+S.last_departure+".");
    const worst=go.filter(x=>x.arr_delay_s>=ON_TIME_S).sort((x,y)=>y.arr_delay_s-x.arr_delay_s).slice(0,3);
    if(worst.length)facts.push("Most delayed on arrival at "+nB+": "+worst.map(x=>"train "+x.train_no+" ("+fmtRel(x.direction)+", "+x.dep+" from "+nA+") "+mins(x.arr_delay_s)+" min late").join("; ")+".");
    if(S.by_period)facts.push("By time of day: "+S.by_period.map(p=>p.period+" "+p.on_time_pct+" % of "+p.trains).join(", ")+".");
  }else facts.push("No direct train stopped at "+nA+" and then "+nB+" yesterday ("+weekday(day)+") in Infrabel's data.");
  if(back.length)facts.push("Return direction "+nB+" → "+nA+": "+back.length+" direct train"+(back.length>1?"s":"")+(R.measured?", "+R.on_time_pct+" % arrived less than 6 minutes late, average delay "+R.average_arrival_delay_min+" min":"")+".");
  const mo=s=>pct(s.pct)+" % at "+titleCase(s.nl);
  facts.push("For comparison, in "+monthName(latest.month)+" Infrabel measured "+mo(a.stop)+" and "+mo(b.stop)+" (all trains stopping there, every stop counted).");
  if(inc.rows?.length)facts.push("Major incidents recorded by Infrabel at these stations in the last 13 months: "+inc.rows.slice(0,3).map(fmtIncident).join("; ")+".");
  if(a.note||b.note)facts.push([a.note,b.note].filter(Boolean).join(" "));
  facts.push("Only trains that ran are in Infrabel's data: a cancelled train leaves no trace there, so these shares are of trains that ran. Direct trains only (no changes); on time = arriving less than 6 minutes late.");
  const list=x=>x.slice(0,40).map(j=>clean({train_no:j.train_no,line:j.relation,direction:fmtRel(j.direction),operator:j.operator,departs:j.dep,arrives:j.arr,
    departure_delay_min:mins(j.dep_delay_s),arrival_delay_min:mins(j.arr_delay_s),on_time:j.arr_delay_s!=null?j.arr_delay_s<ON_TIME_S:null,scheduled_min:round(j.planned_min,0),actual_min:j.actual_min!=null?round(j.actual_min,0):null}));
  return{facts,body:{journey:clean({from:titleCase(A),to:titleCase(B),date:day,from_ptcar_no:a.stop.id,to_ptcar_no:b.stop.id}),
    outbound:go.length?{...S,trains_list:list(go),list_truncated:go.length>40?true:undefined}:null,return:back.length?{...R,trains_list:list(back),list_truncated:back.length>40?true:undefined}:null,
    stations_month:{month:latest.month,[titleCase(A)]:pct(a.stop.pct),[titleCase(B)]:pct(b.stop.pct)},
    major_incidents:inc.rows?.length?inc.rows.map(incidentView):null}};
}

// ---------- Infrabel's list of major incidents (monthly, with delay minutes and cancelled trains) ----------
const fmtIncident=r=>r.date+" "+(r.incident_desciption||"incident")+(r.plaats&&r.plaats!=="-"?" at "+titleCase(r.plaats):"")+(r.lijn&&r.lijn!=="-"?" (line "+r.lijn+")":"")+": "+nf(num(r.min_delay))+" delay minutes, "+nf(num(r.sup))+" trains cancelled";
const incidentView=r=>clean({date:r.date,place:r.plaats&&r.plaats!=="-"?titleCase(r.plaats):null,line:r.lijn&&r.lijn!=="-"?r.lijn:null,incident:r.incident_desciption,
  incident_nl:r.aard_van_incident,delay_minutes:num(r.min_delay),trains_cancelled:num(r.sup)});
async function incidentsAt(client,places){
  const since=new Date(Date.now()-400*DAY*1000).toISOString().slice(0,7)+"-01";
  return ods(client,"belangrijkste-incidenten",{select:"date,lijn,plaats,aard_van_incident,incident_desciption,min_delay,sup",
    where:"plaats in ("+places.map(p=>'"'+p.replace(/"/g,"")+'"').join(",")+") and month >= date'"+since+"'",order_by:"min_delay desc",limit:"10"},{ttl:6*HOUR});
}

// ---------- IC relation ----------
export function normIc(s){const m=String(s||"").toUpperCase().replace(/\s+/g,"").match(/^IC(\d{1,2})(?:-(\d))?$/);return m?"IC "+m[1].padStart(2,"0")+(m[2]?"-"+m[2]:""):null}
async function icAnswer(client,ic,month){
  const base=ic.replace(/-\d$/,"");
  const where=(ic!==base?'relatie = "'+ic+'"':'(relatie = "'+base+'" or startswith(relatie, "'+base+'-"))')+(month?" and maand <= date'"+month+"-01'":"");
  const [rel,mom,nat]=await Promise.all([
    ods(client,"data_punctualite_trainic",{select:"maand,relatie,op_stat,regelmaat,tel,reg,min_rt",where,order_by:"maand desc",limit:"100"}),
    ods(client,"stiptheid-van-ic-relatie-per-moment",{select:"maand,relatie,op_stat,moment_of_day,regelmaat,tel",where,order_by:"maand desc",limit:"60"}),
    ods(client,"nationale-stiptheid-per-maand",{select:"maand,regelmaat,tel",order_by:"maand desc",limit:"13",...(month?{where:"maand <= date'"+month+"-01'"}:{})})
  ]);
  if(rel.error)return{error:rel.error};
  if(!rel.rows.length)return{error:"Infrabel publishes no punctuality for "+ic+". IC relations run from IC 01 to IC 35; give it as 'IC 01' or 'IC 16-1'."};
  const latest=monthOf(rel.rows[0].maand),cur=rel.rows.filter(r=>monthOf(r.maand)===latest);
  const nat0=(nat.rows||[]).find(r=>monthOf(r.maand)===latest);
  const dirs=cur.map(r=>clean({relation:r.relatie,towards:titleCase(r.op_stat),on_time_pct:pct(num(r.regelmaat)),trains:num(r.tel),delay_minutes_total:num(r.min_rt)}));
  const tel=cur.reduce((n,r)=>n+num(r.tel),0),reg=cur.reduce((n,r)=>n+num(r.reg),0);
  const byMonth={};for(const r of rel.rows){const m=monthOf(r.maand);const x=byMonth[m]||(byMonth[m]={tel:0,reg:0});x.tel+=num(r.tel)||0;x.reg+=num(r.reg)||0}
  const series=Object.entries(byMonth).sort().slice(-13).map(([m,x])=>clean({month:m,on_time_pct:pct(pctOf(x.reg,x.tel)),trains:x.tel,national_pct:pct(num((nat.rows||[]).find(r=>monthOf(r.maand)===m)?.regelmaat))}));
  const peaks=(mom.rows||[]).filter(r=>monthOf(r.maand)===latest);
  const pk={};for(const r of peaks){const k=r.moment_of_day;const x=pk[k]||(pk[k]={tel:0,reg:0});x.tel+=num(r.tel)||0;x.reg+=(num(r.tel)||0)*(num(r.regelmaat)||0)/100}
  const moments=Object.fromEntries(Object.entries(pk).map(([k,x])=>[k,{on_time_pct:pct(pctOf(x.reg,x.tel)),trains:x.tel}]));
  const facts=[ic+" in "+monthName(latest)+": "+pct(pctOf(reg,tel))+" % of "+nf(tel)+" trains arrived less than 6 minutes late"+(nat0?" (national figure "+pct(num(nat0.regelmaat))+" %)":"")+"; "+
    dirs.map(d=>"towards "+d.towards+(d.relation!==ic?" ("+d.relation+")":"")+" "+d.on_time_pct+" %").join(", ")+"."];
  const ORDER=["Morning peak hour","Evening peak hour","Off-peak hours","Weekends"];
  const mk=Object.entries(moments).sort((a,b)=>(ORDER.indexOf(a[0])+99)%99-(ORDER.indexOf(b[0])+99)%99);if(mk.length)facts.push("By time of day: "+mk.map(([k,v])=>k.toLowerCase()+" "+v.on_time_pct+" %").join(", ")+".");
  if(series.length>=6){const s=series.slice(-12),t=s.reduce((n,x)=>n+x.trains,0),g=s.reduce((n,x)=>n+x.trains*x.on_time_pct/100,0);facts.push("Over the last "+s.length+" months: "+pct(pctOf(g,t))+" % on time.")}
  facts.push("Measured at the destination or, for trains through Brussels, at the first North-South junction station (the same method as the national figure); cancelled trains are not counted.");
  return{facts,body:{ic_line:ic,month:latest,directions:dirs,by_moment:mk.length?moments:null,last_13_months:series}};
}

// ---------- national ----------
async function nationalAnswer(client,month){
  const w=month?{where:"maand <= date'"+month+"-01'"}:{};
  const [nat,canc,types,causes,ops,rt,hourly,inc]=await Promise.all([
    ods(client,"nationale-stiptheid-per-maand",{select:"maand,regelmaat,regelmaatneutralisatie,tel,reg,min_rt,regelmaat_ytd",order_by:"maand desc",limit:"13",...w}),
    ods(client,"nationale-stiptheid-met-afgeschafte-treinen",{select:"maand2,id,tel",order_by:"maand2 desc",limit:"13",...(month?{where:"maand2 <= '"+month+"'"}:{})}),
    ods(client,"data_punctualite_typedetrain",{select:"maand,rel,regelmaat,tel",order_by:"maand desc",limit:"6",...w}),
    ods(client,"oorzaken-vertraging-per-maand",{select:"jaar_maand,responsible,stiptheidsverlies,aandeel",order_by:"jaar_maand desc",limit:"10",...(month?{where:"jaar_maand <= '"+month+"'"}:{})}),
    ods(client,"maandelijks-afgeschafte-treinen-per-operator",{select:"maand,operator_en,enigetreinen,sups,totaal,partieel,sup0",order_by:"maand desc",limit:"20",...(month?{where:"maand <= '"+month+"'"}:{})}),
    month?Promise.resolve(null):ods(client,"realtime-stiptheid",{order_by:"uur desc",limit:"1"},{ttl:300}),
    month?Promise.resolve(null):ods(client,"stiptheid-van-vandaag-per-uur",{limit:"30"},{ttl:300}),
    ods(client,"belangrijkste-incidenten",{select:"month,date,lijn,plaats,aard_van_incident,incident_desciption,min_delay,sup",order_by:"month desc,min_delay desc",limit:"40",
      ...(month?{where:"month <= date'"+month+"-01'"}:{})},{ttl:6*HOUR})
  ]);
  if(nat.error||!nat.rows.length)return{error:nat.error||"Infrabel published no national punctuality"+(month?" for "+month:"")};
  const n0=nat.rows[0],m=monthOf(n0.maand);
  const c0=(canc.rows||[]).find(r=>String(r.maand2).slice(0,7)===m);
  const ty=(types.rows||[]).filter(r=>monthOf(r.maand)===m);
  const ca=(causes.rows||[]).filter(r=>String(r.jaar_maand).slice(0,7)===m).sort((a,b)=>b.stiptheidsverlies-a.stiptheidsverlies);
  const opLast=(ops.rows||[]).length?String(ops.rows[0].maand).slice(0,7):null,op=(ops.rows||[]).filter(r=>String(r.maand).slice(0,7)===opLast);
  const series=[...nat.rows].reverse().map(r=>clean({month:monthOf(r.maand),on_time_pct:pct(num(r.regelmaat)),neutralised_pct:pct(num(r.regelmaatneutralisatie)),trains:num(r.tel),
    with_cancellations_pct:pct(num((canc.rows||[]).find(x=>String(x.maand2).slice(0,7)===monthOf(r.maand))?.id))}));
  const TYPE={IC:"InterCity",L:"local (L)",P:"peak-hour (P)"};
  const today=rt?.rows?.[0]?clean({as_of_utc:rt.rows[0].uur,as_of_local:localTime(rt.rows[0].uur),sightings:rt.rows[0].tot_aantalmetingen,on_time:rt.rows[0].tot_aantal_6,on_time_pct:pct(num(rt.rows[0].stiptheid)),
    by_hour:(hourly?.rows||[]).map(h=>({hour:h.intervallehoraire,sightings:h.aantalmetingen,on_time_pct:pct(num(h.uur_stiptheid))})).sort((a,b)=>a.hour<b.hour?-1:1)}):null;
  const facts=["Belgian rail punctuality in "+monthName(m)+": "+pct(num(n0.regelmaat))+" % of "+nf(n0.tel)+" trains arrived less than 6 minutes late (Infrabel"+
    (c0?"; "+pct(num(c0.id))+" % when cancelled trains count as late":"")+"). Year to date: "+pct(num(n0.regelmaat_ytd))+" %."];
  if(nat.rows[12])facts.push("A year earlier ("+monthName(monthOf(nat.rows[12].maand))+"): "+pct(num(nat.rows[12].regelmaat))+" %.");
  if(ty.length)facts.push("By train type: "+ty.map(r=>(TYPE[r.rel]||r.rel)+" "+pct(num(r.regelmaat))+" %").join(", ")+".");
  if(ca.length)facts.push("Punctuality lost by cause: "+ca.map(r=>r.responsible+" "+r.stiptheidsverlies+" points").join(", ")+" (of "+pct(100-num(n0.regelmaat))+" points lost in total).");
  const incM=(inc.rows||[]).filter(r=>String(r.month).slice(0,7)===m);
  if(incM.length)facts.push("Major incidents in "+monthName(m)+" (Infrabel's list, "+incM.length+"): "+incM.slice(0,3).map(fmtIncident).join("; ")+".");
  if(today)facts.push("Today so far (to "+today.as_of_local+" Brussels time): "+today.on_time_pct+" % of "+nf(today.sightings)+" train sightings on time."+(today.sightings<300?" Early in the day, so few trains count yet.":""));
  facts.push("The leading figure counts trains at their destination (or the first Brussels North-South junction station) without neutralisation, as Infrabel advises for the passenger's view; the neutralised figure ("+pct(num(n0.regelmaatneutralisatie))+" %) leaves out delays the management contract excuses.");
  return{facts,body:{month:m,national:clean({on_time_pct:pct(num(n0.regelmaat)),neutralised_pct:pct(num(n0.regelmaatneutralisatie)),with_cancellations_pct:c0?pct(num(c0.id)):null,trains:num(n0.tel),on_time_trains:num(n0.reg),
      delay_minutes_total:num(n0.min_rt),year_to_date_pct:pct(num(n0.regelmaat_ytd))}),by_train_type:ty.map(r=>({type:TYPE[r.rel]||r.rel,on_time_pct:pct(num(r.regelmaat)),trains:num(r.tel)})),
    lost_points_by_cause:ca.map(r=>({responsible:r.responsible,points:r.stiptheidsverlies,share_pct:r.aandeel})),
    cancellations:op.length?{month:opLast,by_operator:op.map(r=>clean({operator:r.operator_en,trains:num(r.enigetreinen),cancelled:num(r.sups),fully:num(r.totaal),partly:num(r.partieel),cancelled_pct:pct(num(r.sup0))}))}:null,
    major_incidents:incM.length?{month:m,count:incM.length,delay_minutes:incM.reduce((n,r)=>n+(num(r.min_delay)||0),0),trains_cancelled:incM.reduce((n,r)=>n+(num(r.sup)||0),0),incidents:incM.map(incidentView)}:null,
    today,last_13_months:series}};
}

export async function trainPunctuality(client,args){
  const month=typeof args?.month==="string"?args.month.trim():"";
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return{error:"month must look like 2026-10."};
  const tn=args?.train_number!=null?String(args.train_number).trim():"";
  if(tn&&!/^\d{1,6}$/.test(tn))return{error:"train_number is the number on the departure board, e.g. 2112 (digits only)."};
  const ic=args?.ic_line?normIc(args.ic_line):null;
  if(args?.ic_line&&!ic)return{error:"ic_line looks like 'IC 01' or 'IC 16-1'."};
  const station=typeof args?.station==="string"?args.station.trim().slice(0,80):"";
  const from=typeof args?.from_station==="string"?args.from_station.trim().slice(0,80):"",to=typeof args?.to_station==="string"?args.to_station.trim().slice(0,80):"";
  if(!!from!==!!to)return{error:"Give both from_station and to_station for trains between two stations (e.g. 'Leuven' and 'Brussel-Centraal')."};
  const hasPlace=!!(args?.address||args?.latitude!=null||args?.x_lambert72!=null);
  let out,mode,loc=null;
  if(from&&to){mode="journey";out=await journeyAnswer(client,from,to)}
  else if(tn){mode="train";out=await trainAnswer(client,tn);
    if(!out.error&&out.ic){const icx=await icAnswer(client,out.ic,null);if(!icx.error){out.facts.push("Its line, "+icx.body.ic_line+", in "+monthName(icx.body.month)+": "+icx.facts[0].split(": ")[1].split(";")[0]+".");out.body.ic_line_context=icx.body}}}
  else if(ic){mode="ic_line";out=await icAnswer(client,ic,month)}
  else if(station||hasPlace){
    if(!station){const w=await resolveLocation(client,args,{area:"belgium"});if(w.error)return{error:w.error};loc=w.loc}
    mode="station";out=await stationAnswer(client,{...args,station,month},loc);
  }else{mode="national";out=await nationalAnswer(client,month)}
  if(out.error)return{error:out.error};
  const d=new Date().toISOString().slice(0,10);
  return clean({key_facts:out.facts.slice(0,10),mode,...out.body,
    location:loc?clean({latitude:loc.latitude,longitude:loc.longitude,matched_address:loc.matched_address}):null,
    definitions:{on_time:"Arriving less than 6 minutes late (5 min 59 s), Infrabel's definition.",cancelled_trains:"Not in punctuality percentages; the national figure 'with cancellations' counts them as late.",
      where_measured:"National and IC figures: at the destination, and at the first Brussels North-South junction station for trains through Brussels. Station figures: at that stop. Yesterday's data: every point a train passed.",
      yesterday:"Infrabel publishes yesterday's trains train by train, overwritten every morning; earlier days only as monthly files.",
      journey:"Between two stations: every train that stopped at the first and later at the second yesterday (passing without a stop does not count); on time is judged on arrival at the second.",
      major_incidents:"Infrabel's monthly list of the incidents that cost the most punctuality, with the delay minutes and cancelled trains each caused."},
    provenance:{source:"Infrabel open data (Belgian rail infrastructure manager)",licence:"CC0 1.0",url:"https://opendata.infrabel.be",
      citation:"Infrabel, punctuality open data (opendata.infrabel.be), CC0, retrieved "+d+"."}});
}
