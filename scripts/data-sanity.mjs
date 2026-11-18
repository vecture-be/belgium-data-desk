// Data sanity: checks on the figures this service publishes itself (public/statbel/*), not on the catalogue's metadata.
//   node scripts/data-sanity.mjs [--json]
// The Statbel tables are built by hand (build-statbel.mjs, build-statbel-immo.mjs) and answer belgian_statistics and
// real_estate_prices. A rebuild that mis-maps a merger code, drops a column or shifts a field must fail here, before it ships.
//   errors    break an identity that must hold (parts add up to the whole, ordered quartiles, one figure in two files agrees)
//   warnings  implausible but possible (a jump of more than 15 % in a year); listed with examples so a person can look
// Exit code 1 when there is any error. Run by npm test.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url)),DIR=path.join(here,"..","public","statbel");
const read=f=>JSON.parse(fs.readFileSync(path.join(DIR,f),"utf8"));

export function checkStatbel(files){
  const errors=[],warnings=[],stats={};
  const err=(check,msg)=>errors.push({check,msg}),warn=(check,msg)=>warnings.push({check,msg});
  const POP=["year","total","men","women","a0_17","a18_64","a65","a80","non_belgian"],INC=["year","declarations","residents","net_taxable","taxes"];
  const {totals,places,rank,muni,immoAreas,immoMuni}=files;
  const placeRows=places.places,codes=Object.keys(placeRows);
  stats.municipalities=codes.length;
  if(codes.length!==565)err("municipality_count",`places has ${codes.length} municipalities, the 2025 boundaries have 565`);
  const isInt=v=>Number.isInteger(v)&&v>=0;

  // ---- one municipality's population and income rows ----
  const popRow=(where,r)=>{
    const o=Object.fromEntries(POP.map((k,i)=>[k,r[i]]));
    for(const k of POP)if(!isInt(o[k]))return err("pop_value",`${where} ${o.year}: ${k}=${o[k]} is not a non-negative integer`),o;
    if(o.men+o.women!==o.total)err("pop_sex_sum",`${where} ${o.year}: men ${o.men} + women ${o.women} ≠ total ${o.total}`);
    if(o.a0_17+o.a18_64+o.a65!==o.total)err("pop_age_sum",`${where} ${o.year}: age bands add up to ${o.a0_17+o.a18_64+o.a65}, total ${o.total}`);
    if(o.a80>o.a65)err("pop_a80",`${where} ${o.year}: 80+ (${o.a80}) exceeds 65+ (${o.a65})`);
    if(o.non_belgian>o.total)err("pop_non_belgian",`${where} ${o.year}: non-Belgian ${o.non_belgian} exceeds total ${o.total}`);
    return o;
  };
  const incRow=(where,r)=>{
    const o=Object.fromEntries(INC.map((k,i)=>[k,r[i]]));
    for(const k of INC)if(!isInt(o[k]))return err("income_value",`${where} ${o.year}: ${k}=${o[k]} is not a non-negative integer`),o;
    if(o.taxes>o.net_taxable)err("income_taxes",`${where} ${o.year}: taxes ${o.taxes} exceed net taxable income ${o.net_taxable}`);
    if(o.declarations>o.residents)err("income_declarations",`${where} ${o.year}: ${o.declarations} declarations for ${o.residents} residents`);
    return o;
  };
  const series=(where,rows,from,to,kind)=>{
    const years=rows.map(r=>r[0]),want=[];for(let y=from;y<=to;y++)want.push(y);
    if(years.join()!==want.join())err(kind+"_years",`${where}: ${kind} years ${years[0]}…${years.at(-1)} (${years.length}) instead of ${from}…${to}`);
  };
  const [p0,p1]=places.meta.population.years,[i0,i1]=places.meta.income.years;
  const sums={};
  const add=(key,year,o,fields)=>{const s=((sums[key]??={})[year]??={});s.n=(s.n||0)+1;for(const k of fields)if(k!=="year")s[k]=(s[k]||0)+o[k]};
  const latest={};
  for(const [nis,p] of Object.entries(placeRows)){
    const m=muni[nis];
    if(!m){err("muni_missing",`${nis} ${p.nl} is in places but in no m-<province> file`);continue}
    if(nis.slice(0,1)!==(p.prov||"21000").slice(0,1)&&p.region!=="04000")err("nis_province",`${nis} ${p.nl}: code does not start with its province's digit (${p.prov})`);
    series(nis,m.pop,p0,p1,"pop");series(nis,m.income,i0,i1,"income");
    const popBy={};
    for(const r of m.pop){
      const o=popRow(nis,r);popBy[o.year]=o;
      for(const key of new Set([p.prov||p.region,p.region,"BE"]))add(key,o.year,o,POP);
    }
    for(const r of m.income){
      const o=incRow(nis,r);
      for(const key of new Set([p.prov||p.region,p.region,"BE"]))add("inc:"+key,o.year,o,INC);
      // The income year y counts the residents of 1 January y+1 (tax assessment year): the same people as the population file.
      const next=popBy[o.year+1];
      if(next&&Math.abs(o.residents-next.total)>Math.max(5,next.total*0.002))err("income_residents",`${nis} ${p.nl} income ${o.year}: ${o.residents} residents, population 1 Jan ${o.year+1} = ${next.total}`);
    }
    const ys=Object.keys(popBy).map(Number).sort();
    for(let i=1;i<ys.length;i++){
      const a=popBy[ys[i-1]].total,b=popBy[ys[i]].total;
      if(a>=1000&&Math.abs(b/a-1)>0.15)warn("pop_jump",`${nis} ${p.nl}: population ${ys[i-1]} ${a} → ${ys[i]} ${b}`);
    }
    latest[nis]=popBy[p1];
    if(latest[nis]&&p.pop!==latest[nis].total)err("places_pop",`${nis} ${p.nl}: places says ${p.pop}, m-file ${p1} says ${latest[nis].total}`);
  }
  for(const nis of Object.keys(muni))if(!placeRows[nis])err("muni_extra",`${nis} is in an m-<province> file but not in places`);

  // ---- provinces, regions and Belgium are the sum of their municipalities ----
  for(const [key,t] of Object.entries(totals)){
    for(const r of t.pop){
      const o=popRow("totals "+key,r),s=sums[key]?.[o.year];
      if(!s){err("totals_unmatched",`totals ${key} ${o.year}: no municipality belongs to it`);continue}
      for(const k of POP.slice(1))if(s[k]!==o[k])err("totals_pop_sum",`totals ${key} (${t.label}) ${o.year}: ${k} ${o[k]}, municipalities add up to ${s[k]}`);
    }
    for(const r of t.income||[]){
      const o=incRow("totals "+key,r),s=sums["inc:"+key]?.[o.year];
      if(!s)continue;
      // Statbel's own area rows round the euro amounts per municipality, so a few euros per municipality may differ.
      const slack=k=>k==="net_taxable"||k==="taxes"?(s.n||0):0;
      for(const k of INC.slice(1))if(Math.abs(s[k]-o[k])>slack(k))err("totals_income_sum",`totals ${key} (${t.label}) income ${o.year}: ${k} ${o[k]}, municipalities add up to ${s[k]}`);
    }
  }
  for(const key of Object.keys(sums))if(!key.startsWith("inc:")&&!totals[key])err("totals_missing",`municipalities belong to ${key}, which has no totals entry`);

  // ---- rank-v1 is derived from the same rows ----
  const F=rank.fields,ix=Object.fromEntries(F.map((f,i)=>[f,i]));
  if(rank.rows.length!==codes.length)err("rank_count",`rank has ${rank.rows.length} rows for ${codes.length} municipalities`);
  const pct=(a,b)=>Math.round(a/b*1000)/10;
  for(const r of rank.rows){
    const nis=r[ix.nis],m=muni[nis],now=latest[nis];
    if(!m||!now){err("rank_unknown",`rank row ${nis} is not a municipality`);continue}
    const first=m.pop.find(x=>x[0]===rank.first_year),inc=m.income.find(x=>x[0]===rank.income_year);
    const expect={population:now.total,population_growth_pct:first?pct(now.total-first[1],first[1]):null,share_65_plus_pct:pct(now.a65,now.total),
      share_0_17_pct:pct(now.a0_17,now.total),non_belgian_nationality_pct:pct(now.non_belgian,now.total),
      income_per_inhabitant:inc?Math.round(inc[3]/inc[2]):null,income_per_declaration:inc?Math.round(inc[3]/inc[1]):null};
    for(const [k,v] of Object.entries(expect)){
      const got=r[ix[k]];
      if(v==null||got==null){if(v!==got)err("rank_value",`rank ${nis} ${k}: ${got}, rows give ${v}`);continue}
      if(Math.abs(got-v)>(Number.isInteger(v)&&v>100?1:0.11))err("rank_value",`rank ${nis} ${k}: ${got}, rows give ${v}`);
    }
  }

  // ---- property prices: counts and ordered quartiles; municipalities never sell more than their province ----
  const quart=(where,rows)=>{
    for(const r of rows){
      const [t,n,q1,q2,q3]=r;
      // Statbel leaves out cells without sales; a row with no count carries no prices either.
      if(n==null){if(q1!=null||q2!=null||q3!=null)err("immo_count",`${where} ${t}: prices without a count`);continue}
      if(!isInt(n))err("immo_count",`${where} ${t}: count ${n}`);
      if(q1==null&&q2==null&&q3==null)continue;
      if(n<10)warn("immo_small_n",`${where} ${t}: quartiles from only ${n} sales`);
      if([q1,q2,q3].some(v=>typeof v!=="number"||v<=0))err("immo_value",`${where} ${t}: quartiles ${q1}/${q2}/${q3}`);
      else if(!(q1<=q2&&q2<=q3))err("immo_order",`${where} ${t}: quartiles not ordered ${q1} ≤ ${q2} ≤ ${q3}`);
      else if(q2<10000||q2>10000000)warn("immo_range",`${where} ${t}: median ${q2} € is outside 10 k€–10 M€`);
    }
    for(let i=1;i<rows.length;i++){
      const a=rows[i-1],b=rows[i];
      if(a[3]&&b[3]&&a[1]>=30&&b[1]>=30&&Math.abs(b[3]/a[3]-1)>0.5)warn("immo_jump",`${where}: median ${a[0]} ${a[3]} → ${b[0]} ${b[3]} (n ${a[1]}, ${b[1]})`);
    }
  };
  const immoSum={};
  let immoMunis=0;
  for(const [nis,m] of Object.entries(immoMuni)){
    immoMunis++;
    if(!placeRows[nis])err("immo_unknown",`immo municipality ${nis} is not one of the 565`);
    const prov=placeRows[nis]?.prov||placeRows[nis]?.region;
    for(const [type,rows] of Object.entries(m.annual)){quart(`immo ${nis} ${type}`,rows);for(const [y,n] of rows)if(n!=null)((immoSum[prov]??={})[type+y]=(immoSum[prov]?.[type+y]||0)+n)}
    for(const [type,rows] of Object.entries(m.half||{}))quart(`immo ${nis} ${type} half`,rows);
  }
  stats.immo_municipalities=immoMunis;
  for(const [code,a] of Object.entries(immoAreas.areas)){
    for(const [type,rows] of Object.entries(a.annual)){
      quart(`immo area ${code} ${type}`,rows);
      if(immoSum[code])for(const [y,n] of rows){if(n==null)continue;const s=immoSum[code][type+y]||0;if(s>n)err("immo_area_sum",`immo ${code} ${type} ${y}: municipalities sold ${s}, the area ${n}`)}
    }
    for(const [type,rows] of Object.entries(a.half||{}))quart(`immo area ${code} ${type} half`,rows);
  }
  return {errors,warnings,stats};
}

export function loadStatbel(){
  const muni={},immoMuni={};
  for(const f of fs.readdirSync(DIR)){
    if(/^m-\d+-v1\.json$/.test(f))Object.assign(muni,read(f));
    if(/^immo-m-\d+-v1\.json$/.test(f))Object.assign(immoMuni,read(f));
  }
  return {totals:read("totals-v1.json"),places:read("places-v1.json"),rank:read("rank-v1.json"),muni,immoAreas:read("immo-areas-v1.json"),immoMuni};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const r=checkStatbel(loadStatbel());
  if(process.argv.includes("--json"))console.log(JSON.stringify(r,null,1));
  else{
    const group=list=>Object.entries(list.reduce((g,x)=>((g[x.check]??=[]).push(x.msg),g),{}));
    for(const [c,m] of group(r.errors))console.log(`ERROR ${c} (${m.length})\n  `+m.slice(0,8).join("\n  "));
    for(const [c,m] of group(r.warnings))console.log(`warn  ${c} (${m.length})\n  `+m.slice(0,8).join("\n  "));
    console.log(`data sanity: ${r.errors.length} errors, ${r.warnings.length} warnings`,JSON.stringify(r.stats));
  }
  process.exit(r.errors.length?1:0);
}
