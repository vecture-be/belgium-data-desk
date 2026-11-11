// belgian_statistics: official Statbel figures as answers, not dataset links.
//
// - Municipalities, provinces, regions and Belgium: population on 1 January (total, sex, age bands, nationality) and fiscal income,
//   from the generated tables in public/statbel/ (scripts/build-statbel.mjs; 2025 boundaries, earlier years summed onto them, totals
//   checked against be.STAT). Read from static assets: no upstream request, a few milliseconds.
// - Prices (CPI, inflation, health index): Statbel's open-data CPI file, read live (93 KB zip, updated monthly). be.STAT's CPI
//   views stopped at December 2025, so they are not used.
// - Labour market (employment, unemployment, activity rates by region): be.STAT's quarterly view, read live.
import { _dov } from "./dov.mjs";
const {getJson,clean,num,round,DAY,HOUR}=_dov;

const SOURCES={
  population:{title:"Population by place of residence, nationality, marital status, age and sex",page:"https://statbel.fgov.be/en/open-data/population-place-residence-nationality-marital-status-age-and-sex-14"},
  income:{title:"Fiscal statistics on income",page:"https://statbel.fgov.be/en/open-data/fiscal-statistics-income"},
  prices:{title:"Consumer price index and health index",page:"https://statbel.fgov.be/en/open-data/consumer-price-index-and-health-index",
    file:"https://statbel.fgov.be/sites/default/files/files/opendata/Consumptieprijsindex%20en%20gezondheidsindex/CPI%20All%20base%20years.zip"},
  labour:{title:"Employment rate, unemployment rate and activity rate by gender for Belgium and the regions, quarterly (Labour Force Survey)",
    view:"7d30d7ff-ab74-4047-b2af-2a0bff250647",page:"https://bestat.statbel.fgov.be/bestat/crosstable.xhtml?view=7d30d7ff-ab74-4047-b2af-2a0bff250647"}
};
const today=()=>new Date().toISOString().slice(0,10);
const provenance=(keys,extra={})=>clean({source:"Statbel (Directorate-General Statistics – Statistics Belgium)",licence:"CC BY 4.0",
  datasets:keys.map(k=>clean({title:SOURCES[k].title,page:SOURCES[k].page})),
  citation:"Statbel (DG Statistics – Statistics Belgium), "+keys.map(k=>SOURCES[k].title).join("; ")+", CC BY 4.0, retrieved "+today()+".",retrieved:today(),...extra});

// ---------- places ----------
const fold=s=>String(s??"").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g,"").replace(/[’'`]/g,"'").replace(/[^a-z0-9']+/g," ").trim();
const REGION_ALIASES={"02000":["flanders","vlaanderen","flemish region","vlaams gewest","region flamande","flandre"],"03000":["wallonia","wallonie","walloon region","waals gewest","region wallonne","wallonien"],
  "04000":["brussels","brussels capital","brussels capital region","brussels region","brussels hoofdstedelijk gewest","region de bruxelles capitale","bruxelles capitale","brussel hoofdstad","brussels gewest"]};
const PROVINCE_EN={"10000":"antwerp province","20001":"flemish brabant","20002":"walloon brabant","30000":"west flanders","40000":"east flanders","50000":"hainaut","60000":"liege province","70000":"limburg","80000":"luxembourg province","90000":"namur province"};
const BELGIUM=["belgium","belgie","belgique","belgien","be","national","country"];
// the City of Brussels by explicit name; a bare "Brussels"/"Brussel"/"Bruxelles" means the region, which is what most questions want
const CITY_OF_BRUSSELS=["city of brussels","stad brussel","ville de bruxelles","brussel stad","bruxelles ville","brussels city"];
let PLACES=null;
async function places(assets){
  if(PLACES)return PLACES;
  const data=await assets.json("/statbel/places-v1.json");if(!data)return null;
  const idx=new Map(),area=new Map(),add=(k,v)=>{k=fold(k);if(k&&!idx.has(k))idx.set(k,v)},addArea=(k,v)=>{k=fold(k);if(k&&!area.has(k))area.set(k,v)};
  for(const k of BELGIUM)add(k,{type:"country",key:"BE"});
  for(const [code,al] of Object.entries(REGION_ALIASES))for(const a of al)add(a,{type:"region",key:code});
  for(const a of CITY_OF_BRUSSELS)add(a,{type:"municipality",key:"21004"});
  for(const a of ["brussel","bruxelles"])add(a,{type:"region",key:"04000",note:"Read as the Brussels-Capital Region; for the municipality ask for 'City of Brussels' (NIS 21004)."});
  // municipalities first: where a city and its province share a name (Antwerpen, Luik/Liège, Namen/Namur) the name means the city
  for(const [nis,p] of Object.entries(data.places)){add(nis,{type:"municipality",key:nis});add(p.nl,{type:"municipality",key:nis});add(p.fr,{type:"municipality",key:nis})}
  for(const [old,m] of Object.entries(data.meta.mergers_2025||{})){const v={type:"municipality",key:m.to,merged_from:m.nl};add(old,v);add(m.nl,v);add(m.fr,v)}
  for(const p of Object.values(data.places)){
    if(p.prov&&p.prov!==p.region){
      const v={type:"province",key:p.prov},bare=fold(p.prov_nl).replace(/^provincie /,""),bareFr=fold(p.prov_fr).replace(/^province (de |du |d'|de la )?/,"");
      for(const n of [p.prov_nl,p.prov_fr,PROVINCE_EN[p.prov],p.prov,bare,bareFr,bare+" province","province "+bare,"provincie "+bare]){add(n,v);addArea(n,v)}
    }
    for(const n of [p.region_nl,p.region_fr,p.region]){add(n,{type:"region",key:p.region});addArea(n,{type:"region",key:p.region})}
  }
  for(const [code,al] of Object.entries(REGION_ALIASES))for(const a of al)addArea(a,{type:"region",key:code});
  for(const k of BELGIUM)addArea(k,{type:"country",key:"BE"});
  // latest population per municipality (in the places file), to tell a city from a small namesake of a province
  const pop=Object.fromEntries(Object.entries(data.places).map(([k,p])=>[k,p.pop??0]));
  PLACES={data,idx,area,pop};return PLACES;
}
// A name that is both a municipality and a province (Limburg is also the Dutch name of Limbourg; Antwerpen, Luik, Namen) resolves to
// the province when an area is asked for (within) or the municipality is small, else to the city; the note names the other reading.
const MUNI_PREFIX=/^(gemeente|commune de|commune d'|commune|stad|ville de|city of|municipality of)\s+/;
function resolvePlace(P,raw,{preferArea=false}={}){
  const q=fold(raw);if(!q)return{error:"empty place name"};
  const explicit=MUNI_PREFIX.test(q),hit=P.idx.get(q)||P.idx.get(q.replace(MUNI_PREFIX,"")),ar=explicit?null:P.area.get(q);
  if(hit&&ar&&hit.type==="municipality"){
    const p=P.data.places[hit.key];
    if(preferArea||(P.pop[hit.key]??0)<50000)return{...ar,note:"Read as the "+ar.type+"; the municipality "+p.nl+(p.fr!==p.nl?" / "+p.fr:"")+" (NIS "+hit.key+") has the same name: ask for 'gemeente "+p.nl+"' to get it."};
    return{...hit,note:"Read as the municipality; ask for 'provincie "+String(raw).trim()+"' for the province."};
  }
  if(preferArea&&ar)return{...ar};
  if(hit)return{...hit};
  // a near miss: names that start the same way, to suggest rather than guess
  const pre=q.slice(0,4),sug=[...new Set([...P.idx.keys()].filter(k=>k.startsWith(pre)&&!/^\d/.test(k)).map(k=>label(P,P.idx.get(k))))].slice(0,6);
  return{error:"Unknown place '"+String(raw).slice(0,60)+"'."+(sug.length?" Did you mean: "+sug.join(", ")+"?":"")};
}
function label(P,r){
  if(r.type==="country")return"Belgium";
  if(r.type==="municipality"){const p=P.data.places[r.key];return p.nl===p.fr?p.nl:p.nl+" / "+p.fr}
  const any=Object.values(P.data.places).find(p=>(r.type==="region"?p.region:p.prov)===r.key);
  return r.type==="region"?any.region_nl+" / "+any.region_fr:any.prov_nl+" / "+any.prov_fr;
}
async function series(P,assets,r){
  if(r.type==="municipality"){const p=P.data.places[r.key],sh=await assets.json("/statbel/m-"+(p.prov||p.region)+"-v1.json");return sh?.[r.key]||null}
  const t=await assets.json("/statbel/totals-v1.json");return t?.[r.key]||null;
}

// ---------- indicators ----------
const POP=["year","total","men","women","a0_17","a18_64","a65","a80","non_belgian"],INC=["year","declarations","residents","net_taxable","taxes"];
const obj=(fields,row)=>row?Object.fromEntries(fields.map((f,i)=>[f,row[i]])):null;
const pct=(a,b)=>b?round(100*a/b,1):null;
function popFacts(rows,year){
  const all=(rows||[]).map(r=>obj(POP,r)).sort((a,b)=>a.year-b.year);if(!all.length)return null;
  const cur=year?all.find(r=>r.year===year):all.at(-1);if(!cur)return{error:"population is available for "+all[0].year+"–"+all.at(-1).year};
  const first=all[0];
  return clean({reference_date:cur.year+"-01-01",population:cur.total,men:cur.men,women:cur.women,
    share_0_17_pct:pct(cur.a0_17,cur.total),share_18_64_pct:pct(cur.a18_64,cur.total),share_65_plus_pct:pct(cur.a65,cur.total),share_80_plus_pct:pct(cur.a80,cur.total),
    non_belgian_nationality_pct:pct(cur.non_belgian,cur.total),
    change_since:cur.year>first.year?{year:first.year,population:first.total,change:cur.total-first.total,change_pct:pct(cur.total-first.total,first.total)}:null,
    series:all.map(r=>[r.year,r.total])});
}
function incFacts(rows,year){
  const all=(rows||[]).map(r=>obj(INC,r)).filter(r=>r.residents).sort((a,b)=>a.year-b.year);if(!all.length)return null;
  const cur=year?all.find(r=>r.year===year):all.at(-1);if(!cur)return{error:"income is available for "+all[0].year+"–"+all.at(-1).year};
  const per=r=>Math.round(r.net_taxable/r.residents),prev=all.find(r=>r.year===cur.year-5);
  return clean({income_year:cur.year,average_net_taxable_income_per_inhabitant_eur:per(cur),average_net_taxable_income_per_declaration_eur:cur.declarations?Math.round(cur.net_taxable/cur.declarations):null,
    declarations:cur.declarations,total_net_taxable_income_eur:cur.net_taxable,taxes_per_inhabitant_eur:Math.round(cur.taxes/cur.residents),
    change_5y:prev?{year:prev.year,per_inhabitant_eur:per(prev),change_pct:pct(per(cur)-per(prev),per(prev))}:null,
    series:all.slice(-10).map(r=>[r.year,per(r)])});
}
const DEF={
  population:"Registered population on 1 January (National Register, incl. the foreigners' register; excludes the waiting register of asylum seekers). Non-Belgian = nationality, not country of birth. Earlier years are summed onto the 2025 municipalities.",
  income:"Net taxable income from personal income tax returns, by place of residence, for the income year (assessed the following year). Per inhabitant = total over fiscal residents; per declaration = over declarations with a non-zero income (be.STAT's definition). Not disposable income, not inflation-adjusted; the median is not in this source."
};
const RANK={population:["population",p=>p.pop?.population],population_growth_pct:["population change since the first year (%)",p=>p.pop?.change_since?.change_pct],
  share_65_plus_pct:["share aged 65+ (%)",p=>p.pop?.share_65_plus_pct],share_0_17_pct:["share aged 0–17 (%)",p=>p.pop?.share_0_17_pct],
  non_belgian_nationality_pct:["share with a non-Belgian nationality (%)",p=>p.pop?.non_belgian_nationality_pct],
  income_per_inhabitant:["average net taxable income per inhabitant (€)",p=>p.income?.average_net_taxable_income_per_inhabitant_eur],
  income_per_declaration:["average net taxable income per declaration (€)",p=>p.income?.average_net_taxable_income_per_declaration_eur]};

async function placeFigures(P,assets,r,year,incomeYear){
  const s=await series(P,assets,r);if(!s)return{error:"no figures"};
  const out={place:label(P,r),type:r.type,...(r.type==="municipality"?{nis_code:r.key,province:P.data.places[r.key].prov_nl,region:P.data.places[r.key].region_nl}:r.type==="country"?{}:{nis_code:r.key}),
    ...(r.merged_from?{note:r.merged_from+" merged into this municipality on 1 January 2025; figures are for the merged municipality."}:{}),...(r.note?{note:r.note}:{}),
    pop:popFacts(s.pop,year),income:incFacts(s.income,incomeYear)};
  return out;
}
async function ranking(P,assets,args){
  const by=RANK[args.rank_by];if(!by)return{error:"rank_by must be one of: "+Object.keys(RANK).join(", ")+"."};
  const within=args.within?resolvePlace(P,args.within,{preferArea:true}):{type:"country",key:"BE"};
  if(within.error)return{error:within.error};if(within.type==="municipality")return{error:"within must be Belgium, a region or a province."};
  const inArea=new Set(Object.entries(P.data.places).filter(([,p])=>within.type==="country"||(within.type==="region"?p.region:p.prov)===within.key).map(([k])=>k));
  const income=/income/.test(args.rank_by);
  const asc=args.order==="lowest",limit=Math.min(25,Math.max(1,Math.round(num(args.limit)??10)));
  let rows,reference;
  const R=await assets.json("/statbel/rank-v1.json");
  // the latest year comes from the small precomputed file; another year reads the per-province tables
  if(R&&(args.year==null||args.year===R.pop_year)&&(args.income_year==null||args.income_year===R.income_year)){
    const col=R.fields.indexOf(args.rank_by),pc=R.fields.indexOf("population");
    rows=R.rows.filter(r=>inArea.has(r[0])&&typeof r[col]==="number").map(r=>({k:r[0],v:r[col],population:r[pc]}));
    reference=income?"income year "+R.income_year:args.rank_by==="population_growth_pct"?"change from 1 January "+R.first_year+" to 1 January "+R.pop_year:"population on 1 January "+R.pop_year;
  }else{
    const shards=new Set([...inArea].map(k=>P.data.places[k].prov||P.data.places[k].region));
    const data={};for(const sh of shards)Object.assign(data,await assets.json("/statbel/m-"+sh+"-v1.json")||{});
    rows=[...inArea].map(k=>{const pop=popFacts(data[k]?.pop,args.year),inc=incFacts(data[k]?.income,args.income_year);return{k,v:by[1]({pop,income:inc}),population:pop?.population,pop,inc}}).filter(x=>typeof x.v==="number");
    reference=income?"income year "+(rows[0]?.inc?.income_year??"?"):"population on 1 January "+(rows[0]?.pop?.reference_date?.slice(0,4)??"?");
  }
  rows.sort((a,b)=>asc?a.v-b.v:b.v-a.v);
  return{indicator:by[0],within:label(P,within),order:asc?"lowest first":"highest first",municipalities_compared:rows.length,
    results:rows.slice(0,limit).map((x,i)=>({rank:i+1,municipality:P.data.places[x.k].nl,nis_code:x.k,value:x.v,population:x.population})),reference};
}

// ---------- live: prices ----------
async function inflate(bytes){
  if(typeof DecompressionStream==="function"){const s=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));return new Uint8Array(await new Response(s).arrayBuffer())}
  const z=await import("node:zlib");return z.inflateRawSync(bytes);
}
export async function unzipFirst(bytes){
  const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let e=-1;
  for(let i=bytes.length-22;i>=0&&i>bytes.length-70000;i--)if(dv.getUint32(i,true)===0x06054b50){e=i;break}
  if(e<0)throw new Error("not a zip file");
  const cd=dv.getUint32(e+16,true),method=dv.getUint16(cd+10,true),csize=dv.getUint32(cd+20,true),local=dv.getUint32(cd+42,true);
  const start=local+30+dv.getUint16(local+26,true)+dv.getUint16(local+28,true),data=bytes.subarray(start,start+csize);
  return new TextDecoder().decode(method===8?await inflate(data):data).replace(/^﻿/,"");
}
// The file holds every month since 1920 in every base year (~650 KB): only its last two years are parsed, and the result is kept in
// the isolate for 30 minutes (the file changes once a month).
let PRICES=null;
async function prices(client){
  if(PRICES&&Date.now()-PRICES.at<30*60*1000)return PRICES.value;
  const r=await client.get(SOURCES.prices.file,{maxBytes:512*1024,ttl:6*HOUR,binary:true});if(r.error)return{error:"Statbel's CPI file could not be read: "+r.error};
  const text=await unzipFirst(r.bytes),head=text.slice(0,text.indexOf("\n")).trim().split("|"),ix=Object.fromEntries(head.map((h,i)=>[h,i]));
  // rows are in date order: walk back from the end and stop two years before the latest year
  const raw=[];let end=text.length,maxY=0;
  while(end>0){const start=text.lastIndexOf("\n",end-1);const line=text.slice(start+1,end).trim();end=start;if(start<0)break;if(!line)continue;
    const c=line.split("|");if(c.length<head.length)continue;const yv=Number(c[ix.NM_YR]);if(yv>maxY)maxY=yv;if(maxY&&yv<maxY-1)break;raw.push(c)}
  const rows=raw.map(c=>({y:Number(c[ix.NM_YR]),m:Number(c[ix.NM_MTH]),base:c[ix.NM_BASE_YR],cpi:num(c[ix.MS_CPI_IDX]),
    infl:c[ix.MS_CPI_INFL]&&c[ix.MS_CPI_INFL]!=="."?num(c[ix.MS_CPI_INFL].replace("%","")):null,health:num(c[ix.MS_HLTH_IDX]),smooth:num(c[ix.MS_SMOOTH_IDX]),noEnergy:num(c[ix.MS_WTHOUT_ENE_IDX]),noPetrol:num(c[ix.MS_WITHOUT_PTRL_IDX])}));
  const value=pricesFrom(rows);if(!value.error)PRICES={at:Date.now(),value};return value;
}
function pricesFrom(rows){
  // the current reference base is the one that carries the published inflation rate for the latest month
  const latestKey=Math.max(...rows.map(r=>r.y*100+r.m)),cur=rows.filter(r=>r.y*100+r.m===latestKey&&r.infl!==null).sort((a,b)=>b.base-a.base)[0];
  if(!cur)return{error:"Statbel's CPI file has no inflation figure for its latest month."};
  const base=cur.base,mon=r=>r.y+"-"+String(r.m).padStart(2,"0");
  const hist=rows.filter(r=>r.base===base&&r.y*100+r.m<=latestKey).sort((a,b)=>a.y*100+a.m-(b.y*100+b.m)).slice(-13);
  return clean({latest_month:mon(cur),inflation_pct:cur.infl,cpi:{value:cur.cpi,base:base+"=100"},health_index:cur.health,smoothed_health_index:cur.smooth,
    index_without_energy:cur.noEnergy,index_without_petroleum_products:cur.noPetrol,
    last_13_months:hist.map(r=>clean({month:mon(r),inflation_pct:r.infl,cpi:r.cpi,health_index:r.health,smoothed_health_index:r.smooth})),
    definition:"Inflation = year-on-year change of the national consumer price index (CPI), as published by Statbel. The health index excludes alcohol, tobacco and motor fuels; its smoothed value (4-month average) drives the indexation of wages and benefits. Rents are indexed on the (non-smoothed) health index.",
  });
}
// ---------- live: labour market ----------
async function labour(client){
  const r=await getJson(client,"https://bestat.statbel.fgov.be/bestat/api/views/"+SOURCES.labour.view+"/result/JSON",{maxBytes:512*1024,ttl:6*HOUR});
  if(r.error)return{error:"be.STAT could not be read: "+r.error};
  const facts=(r.json?.facts||[]).filter(f=>f.Gender==null);
  const qkey=q=>{const m=String(q).match(/^(\d)\w* quarter (\d{4})/);return m?Number(m[2])*10+Number(m[1]):0};
  const quarters=[...new Set(facts.map(f=>f.Quarter))].sort((a,b)=>qkey(a)-qkey(b));
  const name=f=>f.Region||"Belgium";
  const latest=quarters.at(-1);
  const rows=facts.filter(f=>f.Quarter===latest).map(f=>({area:name(f),employment_rate_pct:round(100*f["Employment rate"],1),unemployment_rate_pct:round(100*f["Unemployment rate"],1),activity_rate_pct:round(100*f["Activity rate"],1)}));
  const trend=facts.map(f=>({area:name(f),quarter:f.Quarter,unemployment_rate_pct:round(100*f["Unemployment rate"],1)})).sort((a,b)=>a.area.localeCompare(b.area)||qkey(a.quarter)-qkey(b.quarter));
  return{latest_quarter:latest,by_area:rows.sort((a,b)=>a.area.localeCompare(b.area)),unemployment_trend:trend,
    definition:"Labour Force Survey (ILO definitions), as published by Statbel: employment rate of people aged 20–64, unemployment rate of the labour force aged 15–74, activity rate of people aged 15–64 (Statbel's standard indicators). These differ from registered jobseekers (VDAB, Le Forem, Actiris) and RVA/ONEM benefit counts."};
}

/** NIS code or municipality name -> identifiers and headline figures, for other tools' answers. Null when unknown. */
export async function municipalitySummary(assets,nisOrName){
  if(!nisOrName)return null;
  const P=await places(assets);if(!P)return null;
  // a geocoder's municipality name is a municipality, even where the bare name would mean a region or province ("Brussel")
  const q=fold(nisOrName),direct=Object.entries(P.data.places).find(([k,p])=>k===q||fold(p.nl)===q||fold(p.fr)===q)?.[0];
  const r=direct?{type:"municipality",key:direct}:resolvePlace(P,String(nisOrName));if(r.error||r.type!=="municipality")return null;
  const p=P.data.places[r.key],s=await series(P,assets,r),pop=popFacts(s?.pop),inc=incFacts(s?.income);
  return clean({municipality:p.nl===p.fr?p.nl:p.nl+" / "+p.fr,nis_code:r.key,province:p.prov&&p.prov!==p.region?p.prov_nl:null,region:p.region_nl,
    population:pop?.population,population_date:pop?.reference_date,share_65_plus_pct:pop?.share_65_plus_pct,
    income_per_inhabitant_eur:inc?.average_net_taxable_income_per_inhabitant_eur,income_year:inc?.income_year,
    statistics:"Call belgian_statistics with places ['"+r.key+"'] for the full figures and comparisons."});
}

// ---------- the tool ----------
export async function belgianStatistics(client,args,{assets}={}){
  const a={...(args||{})},topic=a.topic||"profile";
  if(!["profile","population","income","prices","labour"].includes(topic))return{error:"topic must be profile, population, income, prices or labour."};
  if(topic==="prices"){const p=await prices(client);return p.error?p:clean({key_facts:["Inflation "+p.inflation_pct+" % in "+p.latest_month+" (CPI "+p.cpi.value+", base "+p.cpi.base+"); health index "+p.health_index+", smoothed health index "+p.smoothed_health_index+"."],topic,...p,provenance:provenance(["prices"],{file:SOURCES.prices.file})})}
  if(topic==="labour"){const l=await labour(client);if(l.error)return l;const be=l.by_area.find(x=>x.area==="Belgium");
    return clean({key_facts:[(be?"Belgium: unemployment "+be.unemployment_rate_pct+" %, employment rate "+be.employment_rate_pct+" % in the "+l.latest_quarter+"; ":"")+l.by_area.filter(x=>x.area!=="Belgium").map(x=>x.area+" "+x.unemployment_rate_pct+" %").join(", ")+" unemployment."],topic,...l,provenance:provenance(["labour"])})}
  if(!assets)return{error:"Statistics tables are not available on this server."};
  const P=await places(assets);if(!P)return{error:"Statistics tables could not be read; try again shortly."};
  const year=a.year!=null?Math.round(num(a.year)):undefined,incomeYear=a.income_year!=null?Math.round(num(a.income_year)):undefined;
  // No places and no ranking: 'population' or 'income' alone means the national picture, so rank the municipalities of Belgium by it
  // (largest population / highest income per inhabitant) instead of refusing; 'profile' alone means Belgium's profile.
  const noPlaces=!a.rank_by&&!(Array.isArray(a.places)?a.places.length:a.places);
  const defaulted=noPlaces&&topic!=="profile"?{rank_by:topic==="income"?"income_per_inhabitant":"population",within:a.within||"Belgium"}:null;
  if(noPlaces&&topic==="profile")a.places=["Belgium"];
  if(a.rank_by||defaulted){
    const rk=await ranking(P,assets,{...a,...defaulted,year,income_year:incomeYear});if(rk.error)return rk;
    const rankBy=defaulted?.rank_by||a.rank_by;
    return clean({key_facts:[rk.results.slice(0,3).map(x=>x.rank+". "+x.municipality+" ("+x.value+")").join("; ")+" — "+rk.indicator+", "+rk.within+", "+rk.reference+"."],topic:"ranking",
      ...(defaulted?{defaulted_to:"No places were given, so this ranks municipalities in "+defaulted.within+" by "+defaulted.rank_by.replace(/_/g," ")+". Pass places for specific municipalities, provinces or regions, or rank_by for another indicator."}:{}),...rk,
      definitions:/income/.test(rankBy)?DEF.income:DEF.population,provenance:provenance(/income/.test(rankBy)?["income"]:["population"])});
  }
  const names=(Array.isArray(a.places)?a.places:a.places?[a.places]:[]).slice(0,6);
  if(!names.length)return{error:"Give places (municipalities, provinces, regions or 'Belgium'; up to 6), or rank_by to rank municipalities, or topic 'prices' or 'labour'."};
  const resolved=[];
  for(const n of names){const r=resolvePlace(P,n);if(r.error)return{error:r.error};if(!resolved.some(x=>x.type===r.type&&x.key===r.key))resolved.push(r)}   // "Liège" and "Luik" are one place
  // a single municipality is shown with its province, region and Belgium for context
  const list=[...resolved];
  if(a.with_context!==false&&list.length===1&&list[0].type==="municipality"){const p=P.data.places[list[0].key];if(p.prov&&p.prov!==p.region)list.push({type:"province",key:p.prov});list.push({type:"region",key:p.region},{type:"country",key:"BE"})}
  const figs=await Promise.all(list.map(r=>placeFigures(P,assets,r,year,incomeYear)));
  // a year outside the tables is an error, not a silently different year
  const yearErr=figs.map(f=>(topic!=="income"&&year!==undefined&&f.pop?.error)||(topic!=="population"&&incomeYear!==undefined&&f.income?.error)).find(Boolean);
  if(yearErr)return{error:"That year is not in the tables: "+yearErr+"."};
  const show=f=>clean({...f,pop:topic==="income"?undefined:f.pop,income:topic==="population"?undefined:f.income});
  const facts=figs.slice(0,resolved.length).map(f=>{
    const s=[];
    if(topic!=="income"&&f.pop&&!f.pop.error)s.push(f.place+": "+f.pop.population.toLocaleString("en")+" inhabitants on "+f.pop.reference_date+(f.pop.change_since?" ("+(f.pop.change_since.change_pct>=0?"+":"")+f.pop.change_since.change_pct+" % since "+f.pop.change_since.year+")":"")+"; "+f.pop.share_65_plus_pct+" % aged 65+, "+f.pop.non_belgian_nationality_pct+" % non-Belgian nationality.");
    if(topic!=="population"&&f.income&&!f.income.error)s.push(f.place+": average net taxable income "+f.income.average_net_taxable_income_per_inhabitant_eur.toLocaleString("en")+" € per inhabitant in income year "+f.income.income_year+(f.income.change_5y?" ("+(f.income.change_5y.change_pct>=0?"+":"")+f.income.change_5y.change_pct+" % in 5 years, nominal)":"")+".");
    return s.join(" ");
  });
  if(figs.length>resolved.length){const ctx=figs.slice(resolved.length).map(f=>f.place.split(" / ")[0]+" "+(topic==="income"?(f.income?.average_net_taxable_income_per_inhabitant_eur?.toLocaleString("en")+" €"):(f.pop?.share_65_plus_pct+" % 65+")));facts.push("Context: "+ctx.join("; ")+".")}
  return clean({key_facts:facts.filter(Boolean),topic,places:figs.map(show),
    definitions:clean({population:topic==="income"?null:DEF.population,income:topic==="population"?null:DEF.income}),
    boundaries:P.data.meta.boundaries,
    provenance:provenance(topic==="population"?["population"]:topic==="income"?["income"]:["population","income"],{tables_built:P.data.meta.built})});
}
