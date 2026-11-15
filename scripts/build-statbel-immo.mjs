// Builds the real-estate tables behind the real_estate_prices MCP tool from Statbel's open data "Real estate sales according to the
// nature of the property in the deed of sale" (vastgoed_2010_9999, CC BY 4.0): number of sales and the 25th, 50th (median) and 75th
// percentile price per property type, for Belgium, the regions, provinces, districts and the 565 municipalities on 2025 boundaries.
// Run by hand when Statbel publishes a new half-year or year (the file says which), then commit public/statbel/immo-*:
//   node scripts/build-statbel-immo.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),OUT=path.join(root,"public","statbel"),CACHE=path.join(root,".cache","statbel");
export const IMMO_URL="https://statbel.fgov.be/sites/default/files/files/opendata/immo/vastgoed_2010_9999.zip";
const UA="Belgium-Data-Desk/1.0 (+https://data.vecture.be)";
// property types as Statbel publishes them -> short keys used in the tables and by the tool
export const TYPES={"Huizen met 2 of 3 gevels (gesloten + halfopen bebouwing)":"h23","Huizen met 4 of meer gevels (open bebouwing)":"h4",
  "Alle huizen met 2, 3, 4 of meer gevels (excl. appartementen)":"house","Appartementen":"apartment"};

function unzipSingle(buf){
  const eocd=buf.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));if(eocd<0)throw new Error("not a zip");
  const cd=buf.readUInt32LE(eocd+16),method=buf.readUInt16LE(cd+10),csize=buf.readUInt32LE(cd+20),local=buf.readUInt32LE(cd+42);
  const start=local+30+buf.readUInt16LE(local+26)+buf.readUInt16LE(local+28),data=buf.subarray(start,start+csize);
  return method===8?zlib.inflateRawSync(data):data;
}
const num=v=>{const n=Number(String(v??"").trim());return Number.isFinite(n)&&String(v).trim()!==""?n:null};

/** Pure: parse the Statbel text file (pipe-separated, latin-1) into {areas, years, latestPeriod}. */
export function parseImmo(text){
  const lines=text.split(/\r?\n/),H=lines[0].split("|"),c=n=>{const i=H.indexOf(n);if(i<0)throw new Error("column "+n+" missing");return i};
  const iY=c("CD_YEAR"),iT=c("CD_TYPE_NL"),iR=c("CD_REFNIS"),iNl=c("CD_REFNIS_NL"),iFr=c("CD_REFNIS_FR"),iP=c("CD_PERIOD"),iN=c("MS_TOTAL_TRANSACTIONS"),
    i25=c("MS_P_25"),i50=c("MS_P_50_median"),i75=c("MS_P_75"),iL=c("CD_niveau_refnis");
  const areas={},years=new Set();let latest="";
  for(const l of lines.slice(1)){
    if(!l)continue;const v=l.split("|"),type=TYPES[v[iT]];if(!type)continue;
    const nis=v[iR].padStart(5,"0"),period=v[iP],year=Number(v[iY]);
    const a=areas[nis]||(areas[nis]={nl:v[iNl],fr:v[iFr],level:Number(v[iL]),annual:{},half:{}});
    const row=[year,num(v[iN]),num(v[i25]),num(v[i50]),num(v[i75])];
    if(period==="Y"){(a.annual[type]||(a.annual[type]=[])).push(row);years.add(year)}
    else if(/^S[12]$/.test(period)){(a.half[type]||(a.half[type]=[])).push([year+"-"+period,...row.slice(1)]);const p=year+"-"+period;if(p>latest)latest=p}
  }
  for(const a of Object.values(areas)){for(const k in a.annual)a.annual[k].sort((x,y)=>x[0]-y[0]);for(const k in a.half)a.half[k].sort((x,y)=>x[0].localeCompare(y[0]))}
  return{areas,years:[...years].sort(),latestPeriod:latest};
}

async function main(){
  fs.mkdirSync(CACHE,{recursive:true});
  const zipFile=path.join(CACHE,"vastgoed_2010_9999.zip");
  if(!fs.existsSync(zipFile)){const r=await fetch(IMMO_URL,{headers:{"user-agent":UA}});if(!r.ok)throw new Error(IMMO_URL+" -> HTTP "+r.status);fs.writeFileSync(zipFile,Buffer.from(await r.arrayBuffer()))}
  const {areas,years,latestPeriod}=parseImmo(new TextDecoder("latin1").decode(unzipSingle(fs.readFileSync(zipFile))));
  const places=JSON.parse(fs.readFileSync(path.join(OUT,"places-v1.json"),"utf8")).places;
  // checks: every 2025 municipality is there, and the municipal sales add up to Belgium's in the latest year (a wrong file or code
  // mapping shows up here rather than in an answer)
  const missing=Object.keys(places).filter(k=>!areas[k]);
  if(missing.length)throw new Error(missing.length+" municipalities missing, e.g. "+missing.slice(0,5).join(","));
  const last=years.at(-1),sumMuni=Object.entries(areas).filter(([,a])=>a.level===5).reduce((s,[,a])=>s+(a.annual.house?.find(r=>r[0]===last)?.[1]||0),0);
  const be=areas["01000"]?.annual.house?.find(r=>r[0]===last)?.[1];
  if(!be||Math.abs(sumMuni-be)/be>0.02)throw new Error("municipal house sales "+sumMuni+" do not add up to Belgium's "+be+" in "+last);
  const meta={built:new Date().toISOString().slice(0,10),source:IMMO_URL,years:[years[0],last],latest_half_year:latestPeriod,
    boundaries:"municipalities as on 1 January 2025 (Statbel republishes the whole series on these boundaries)"};
  // municipalities sharded by province (Brussels: region), like the population tables; higher levels in one file
  // keep the yearly series and only the two latest half-years (enough for "the latest figures"); municipal names come from places-v1
  for(const a of Object.values(areas))for(const k in a.half)a.half[k]=a.half[k].slice(-2);
  const shards={};
  for(const [nis,a] of Object.entries(areas)){
    if(a.level!==5)continue;const p=places[nis];const k=p.prov||p.region;(shards[k]||(shards[k]={}))[nis]={annual:a.annual,half:a.half};
  }
  for(const [k,s] of Object.entries(shards))fs.writeFileSync(path.join(OUT,"immo-m-"+k+"-v1.json"),JSON.stringify(s));
  fs.writeFileSync(path.join(OUT,"immo-areas-v1.json"),JSON.stringify({meta,areas:Object.fromEntries(Object.entries(areas).filter(([,a])=>a.level<5))}));
  console.log("[immo] "+Object.keys(areas).length+" areas, "+years[0]+"-"+last+" (+ "+latestPeriod+"), "+Object.keys(shards).length+" municipal shards; house sales "+last+": municipalities "+sumMuni+" = Belgium "+be);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exit(1)});
