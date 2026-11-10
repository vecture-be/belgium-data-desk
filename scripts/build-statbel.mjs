// Builds the Statbel municipal figures behind the belgian_statistics MCP tool: population (total, sex, age bands, nationality) on
// 1 January for each year from FIRST_YEAR, and fiscal income per municipality, all on the 2025 municipality boundaries (565 NIS codes).
// Run by hand when Statbel publishes a new year (population in spring, income in autumn), then commit public/statbel/:
//   node scripts/build-statbel.mjs
// Source files are Statbel open data (CC BY 4.0), downloaded once into .cache/statbel. Older years use pre-2025 NIS codes; they are
// mapped onto the merged 2025 municipalities with a mapping derived from the 2024 and 2025 files and checked against both totals.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { MERGERS_2025 } from "../public/nis-mergers-2025-v1.mjs";

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.join(here,"..");
const CACHE=path.join(root,".cache","statbel"),OUT=path.join(root,"public","statbel");
const FIRST_YEAR=2019,LAST_POP_YEAR=Number(process.env.STATBEL_POP_YEAR||2026);
const POP_URL=y=>`https://statbel.fgov.be/sites/default/files/files/opendata/bevolking%20naar%20woonplaats%2C%20nationaliteit%20burgelijke%20staat%20%2C%20leeftijd%20en%20geslacht/TF_SOC_POP_STRUCT_${y}.zip`;
const INC_URL="https://statbel.fgov.be/sites/default/files/files/opendata/arbeid/TF_PSNL_INC_TAX_MUNTY.zip";
const UA="Belgium-Data-Desk/1.0 (+https://data.vecture.be)";

async function download(url,file){
  const f=path.join(CACHE,file);if(fs.existsSync(f))return fs.readFileSync(f);
  const r=await fetch(url,{headers:{"user-agent":UA}});if(!r.ok)throw new Error(url+" -> HTTP "+r.status);
  const b=Buffer.from(await r.arrayBuffer());fs.mkdirSync(CACHE,{recursive:true});fs.writeFileSync(f,b);return b;
}
// The one file in a Statbel zip, read from the central directory (sizes in local headers can be zero) and inflated with zlib.
function unzipSingle(buf){
  const eocd=buf.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));if(eocd<0)throw new Error("not a zip");
  const cd=buf.readUInt32LE(eocd+16);
  const method=buf.readUInt16LE(cd+10),csize=buf.readUInt32LE(cd+20),local=buf.readUInt32LE(cd+42);
  const start=local+30+buf.readUInt16LE(local+26)+buf.readUInt16LE(local+28),data=buf.subarray(start,start+csize);
  return(method===8?zlib.inflateRawSync(data):data).toString("utf8").replace(/^﻿/,"");
}
function* rows(text){
  const lines=text.split(/\r?\n/),head=lines[0].split("|");
  for(let i=1;i<lines.length;i++){if(!lines[i])continue;const c=lines[i].split("|"),o={};for(let j=0;j<head.length;j++)o[head[j]]=c[j];yield o}
}

// ---------- population ----------
const pop={},places={},oldNames={};
for(let y=FIRST_YEAR;y<=LAST_POP_YEAR;y++){
  const text=unzipSingle(await download(POP_URL(y),"pop"+y+".zip")),agg={};
  for(const r of rows(text)){
    const nis=r.CD_REFNIS,n=Number(r.MS_POPULATION),age=Number(r.CD_AGE);
    const a=agg[nis]||(agg[nis]={total:0,men:0,women:0,a0_17:0,a18_64:0,a65:0,a80:0,non_belgian:0});
    a.total+=n;a[r.CD_SEX==="M"?"men":"women"]+=n;a[age<18?"a0_17":age<65?"a18_64":"a65"]+=n;if(age>=80)a.a80+=n;if(r.CD_NATLTY!=="BEL")a.non_belgian+=n;
    oldNames[nis]??=[r.TX_DESCR_NL,r.TX_DESCR_FR];
    if(y===LAST_POP_YEAR&&!places[nis])places[nis]={nl:r.TX_DESCR_NL,fr:r.TX_DESCR_FR,arr:r.CD_DSTR_REFNIS,prov:r.CD_PROV_REFNIS||null,prov_nl:r.TX_PROV_DESCR_NL||null,prov_fr:r.TX_PROV_DESCR_FR||null,region:r.CD_RGN_REFNIS,region_nl:r.TX_RGN_DESCR_NL,region_fr:r.TX_RGN_DESCR_FR};
  }
  pop[y]=agg;console.error("population",y,Object.keys(agg).length,"municipalities");
}

// ---------- old (pre-2025) codes -> 2025 municipalities ----------
// MERGERS_2025 (public/nis-mergers-2025-v1.mjs). The build checks every entry: each 2025 municipality must equal the 2024 sum of its
// parts within 1.5 %, every code that disappears between the 2024 and 2025 files must be listed, and nothing else may be.
const p24=pop[2024],p25=pop[2025];
if(!p24||!p25)throw new Error("the merger check needs the 2024 and 2025 population files");
const vanished=Object.keys(p24).filter(k=>!p25[k]).sort(),listed=Object.keys(MERGERS_2025).filter(k=>!p25[k]).sort();
if(JSON.stringify(vanished)!==JSON.stringify(listed))throw new Error("MERGERS_2025 does not match the codes that disappeared: "+vanished.join(",")+" vs "+listed.join(","));
const map=MERGERS_2025;
const receivers={};for(const [v,n] of Object.entries(map))(receivers[n]??=[]).push(v);
for(const [n,parts] of Object.entries(receivers)){
  if(!places[n])throw new Error("MERGERS_2025 target "+n+" is not a 2025 municipality");
  const before=(p24[n]?.total||0)+parts.filter(v=>v!==n).reduce((s,v)=>s+p24[v].total,0),after=p25[n].total,dev=Math.abs(after-before)/before;
  console.error("merge",n,places[n].nl,"<=",[...(p24[n]?[n]:[]),...parts].join("+"),"2024 sum",before,"2025",after,(dev*100).toFixed(2)+"%");
  if(dev>0.015)throw new Error("merger check failed for "+n);
}
const to2025=k=>map[k]||k;
const series={};
for(let y=FIRST_YEAR;y<=LAST_POP_YEAR;y++)for(const [k,a] of Object.entries(pop[y])){
  const nis=to2025(k);if(!places[nis])throw new Error("unknown municipality "+k+" in "+y);
  const s=(series[nis]??={}),t=(s[y]??={total:0,men:0,women:0,a0_17:0,a18_64:0,a65:0,a80:0,non_belgian:0});
  for(const f in t)t[f]+=a[f];
}

// ---------- fiscal income ----------
const inc={};let incYears=new Set();
for(const r of rows(unzipSingle(await download(INC_URL,"income.zip")))){
  const y=Number(r.CD_YEAR);if(y<2014)continue;incYears.add(y);
  const nis=to2025(r.CD_MUNTY_REFNIS);if(!places[nis])continue;   // codes merged before 2019 are left out of years before then
  const t=((inc[nis]??={})[y]??={declarations:0,residents:0,net_taxable:0,taxes:0});
  const n=v=>Number(v)||0;   // empty cells in the file are zero
  t.declarations+=n(r.MS_NBR_NON_ZERO_INC);   // declarations with a non-zero income, as be.STAT counts them
  t.residents+=n(r.MS_TOT_RESIDENTS);t.net_taxable+=n(r.MS_TOT_NET_TAXABLE_INC);t.taxes+=n(r.MS_TOT_TAXES);
}
incYears=[...incYears].sort();
// a year in which a merged municipality lacks one of its parts would understate it: keep only complete years per municipality
for(const [nis,ys] of Object.entries(inc))for(const y of Object.keys(ys)){if(!ys[y].residents)delete ys[y]}

// ---------- write: one small file of places, one data file per province (Brussels is its own), totals for comparison ----------
const POP_FIELDS=["total","men","women","a0_17","a18_64","a65","a80","non_belgian"],INC_FIELDS=["declarations","residents","net_taxable","taxes"];
const shardOf=nis=>places[nis].prov||places[nis].region;
const shards={};
for(const nis of Object.keys(places).sort()){
  const sh=(shards[shardOf(nis)]??={});
  sh[nis]={pop:Object.entries(series[nis]||{}).map(([y,t])=>[Number(y),...POP_FIELDS.map(f=>t[f])]),
    income:Object.entries(inc[nis]||{}).map(([y,t])=>[Number(y),t.declarations,t.residents,Math.round(t.net_taxable),Math.round(t.taxes)])};
}
// regions, provinces and Belgium as sums, so a municipality can be compared with its context in one read
const totals={};
const add=(key,label,nis)=>{const T=(totals[key]??={label,pop:{},income:{}});
  for(const [y,t] of Object.entries(series[nis]||{})){const a=(T.pop[y]??=Object.fromEntries(POP_FIELDS.map(f=>[f,0])));for(const f of POP_FIELDS)a[f]+=t[f]}
  for(const [y,t] of Object.entries(inc[nis]||{})){const a=(T.income[y]??=Object.fromEntries(INC_FIELDS.map(f=>[f,0])));for(const f of INC_FIELDS)a[f]+=t[f]}};
// Brussels has no province: its "province" code is the region code, which must not be added twice
for(const nis of Object.keys(places)){const p=places[nis];add("BE","België / Belgique",nis);add(p.region,p.region_nl,nis);if(p.prov&&p.prov!==p.region)add(p.prov,p.prov_nl,nis)}
const compactTotals=Object.fromEntries(Object.entries(totals).map(([k,T])=>[k,{label:T.label,
  pop:Object.entries(T.pop).map(([y,t])=>[Number(y),...POP_FIELDS.map(f=>t[f])]),income:Object.entries(T.income).map(([y,t])=>[Number(y),...INC_FIELDS.map(f=>Math.round(t[f]))])}]));
// the three regions must add up to Belgium in every year (a double count once made Brussels 2.5 million)
for(const y of Object.keys(totals.BE.pop)){const r=["02000","03000","04000"].reduce((s,k)=>s+totals[k].pop[y].total,0);if(r!==totals.BE.pop[y].total)throw new Error("regions do not add up to Belgium in "+y)}
fs.mkdirSync(OUT,{recursive:true});
const meta={version:1,built:new Date().toISOString().slice(0,10),boundaries:"municipalities as on 1 January 2025 (565 NIS codes); earlier years summed onto them",
  population:{years:[FIRST_YEAR,LAST_POP_YEAR],reference:"1 January of the year",fields:POP_FIELDS,source:"Statbel, Population by place of residence, nationality, marital status, age and sex",files:[POP_URL(LAST_POP_YEAR)]},
  income:{years:[Math.min(...Object.values(inc).flatMap(o=>Object.keys(o).map(Number))),Math.max(...incYears)],reference:"income year (tax assessment year minus one)",fields:INC_FIELDS,source:"Statbel, Fiscal statistics on income (personal income tax)",files:[INC_URL]},
  licence:"CC BY 4.0, Statbel (Directorate-General Statistics – Statistics Belgium)",
  mergers_2025:Object.fromEntries(Object.entries(map).map(([o,n])=>[o,{to:n,nl:oldNames[o]?.[0],fr:oldNames[o]?.[1]}]))};
for(const nis of Object.keys(places))places[nis].pop=series[nis]?.[LAST_POP_YEAR]?.total??null;   // latest population, to tell a city from a namesake
fs.writeFileSync(path.join(OUT,"places-v1.json"),JSON.stringify({meta,places}));
for(const [k,sh] of Object.entries(shards))fs.writeFileSync(path.join(OUT,"m-"+k+"-v1.json"),JSON.stringify(sh));
fs.writeFileSync(path.join(OUT,"totals-v1.json"),JSON.stringify(compactTotals));
// latest indicators per municipality in one small file, so a ranking across Belgium reads 40 KB instead of every shard
const latestInc=Math.max(...incYears),pct=(a,b)=>b?Math.round(1000*a/b)/10:null;
const rank={pop_year:LAST_POP_YEAR,first_year:FIRST_YEAR,income_year:latestInc,
  fields:["nis","population","population_growth_pct","share_65_plus_pct","share_0_17_pct","non_belgian_nationality_pct","income_per_inhabitant","income_per_declaration"],
  rows:Object.keys(places).sort().map(nis=>{const s=series[nis]||{},c=s[LAST_POP_YEAR],f=s[FIRST_YEAR],i=inc[nis]?.[latestInc];
    return[nis,c?.total??null,c&&f?pct(c.total-f.total,f.total):null,c?pct(c.a65,c.total):null,c?pct(c.a0_17,c.total):null,c?pct(c.non_belgian,c.total):null,
      i?.residents?Math.round(i.net_taxable/i.residents):null,i?.declarations?Math.round(i.net_taxable/i.declarations):null]})};
fs.writeFileSync(path.join(OUT,"rank-v1.json"),JSON.stringify(rank));
console.error("wrote",Object.keys(places).length,"municipalities in",Object.keys(shards).length,"shards; mergers mapped:",Object.keys(map).length);
