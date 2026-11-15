// real_estate_prices: what homes sell for in a Belgian municipality, province, region or Belgium, from Statbel's real-estate sales
// statistics (deeds of sale; CC BY 4.0). Read from committed tables built by scripts/build-statbel-immo.mjs: no upstream request.
// A median of few sales swings from year to year, so answers say how many sales a figure rests on and rankings skip small samples.
import { _statbelPlaces } from "./statbel.mjs";
import { clean, today } from "./lib/tool-kit.mjs";

const {places,resolvePlace,label}=_statbelPlaces;
export const TYPE_LABEL={house:"houses (all)",h23:"terraced and semi-detached houses (2-3 facades)",h4:"detached houses (4+ facades)",apartment:"apartments"};
const AREA_NIS={country:()=>"01000",region:r=>r.key,province:r=>r.key};
export const MIN_SALES=20;
const eur=n=>n==null?"not published":"€"+Math.round(n).toLocaleString("en-GB");
const salesWord=n=>n==null?"number of sales not published":Number(n).toLocaleString("en-GB")+" sale"+(n===1?"":"s");

async function areaFor(P,assets,r){
  if(r.type==="municipality"){const p=P.data.places[r.key],s=await assets.json("/statbel/immo-m-"+(p.prov||p.region)+"-v1.json");return s?.[r.key]||null}
  const a=await assets.json("/statbel/immo-areas-v1.json");return a?.areas?.[AREA_NIS[r.type](r)]||null;
}
function figures(a,type,year){
  const rows=a?.annual?.[type]||[],row=year?rows.find(x=>x[0]===year):rows.at(-1);if(!row)return null;
  const [y,sales,p25,median,p75]=row,base=rows.find(x=>x[0]===y-5);
  return clean({year:y,sales,median_eur:median,p25_eur:p25,p75_eur:p75,
    median_change_5y_pct:base?.[3]&&median?Math.round((median/base[3]-1)*1000)/10:null,
    ...(sales!=null&&sales<MIN_SALES?{small_sample:"median of "+sales+" sales: it can swing strongly from year to year"}:{})});
}
function latestHalf(a,type){const h=a?.half?.[type]?.at(-1);return h?clean({period:h[0].replace("-S1"," first half").replace("-S2"," second half"),sales:h[1],median_eur:h[3]}):null}

async function rank(P,assets,{within="Belgium",type="house",order="highest",limit=10,year,min_sales=MIN_SALES}){
  const area=resolvePlace(P,within,{preferArea:true});if(area.error)return{error:area.error};
  const nis=Object.entries(P.data.places).filter(([,p])=>area.type==="country"||(area.type==="region"?p.region===area.key:p.prov===area.key)).map(([k])=>k);
  const shards=new Set(nis.map(k=>P.data.places[k].prov||P.data.places[k].region)),data={};
  for(const s of shards)Object.assign(data,await assets.json("/statbel/immo-m-"+s+"-v1.json")||{});
  const rows=nis.map(k=>({k,f:figures(data[k],type,year)})).filter(x=>x.f?.median_eur&&x.f.sales>=min_sales);
  rows.sort((a,b)=>order==="lowest"?a.f.median_eur-b.f.median_eur:b.f.median_eur-a.f.median_eur);
  const skipped=nis.length-rows.length,y=rows[0]?.f.year;
  const top=rows.slice(0,Math.min(25,Math.max(1,limit))).map((x,i)=>clean({rank:i+1,municipality:label(P,{type:"municipality",key:x.k}),nis_code:x.k,median_eur:x.f.median_eur,sales:x.f.sales,median_change_5y_pct:x.f.median_change_5y_pct}));
  return{within:label(P,area),type:TYPE_LABEL[type],year:y,order:order==="lowest"?"lowest first":"highest first",municipalities_compared:rows.length,
    ...(skipped?{left_out:skipped+" municipalities with fewer than "+min_sales+" "+TYPE_LABEL[type]+" sold in "+y+" (a median of so few sales is not comparable)"}:{}),ranking:top};
}

export async function realEstatePrices(client,args={},{assets}={}){
  const P=await places(assets);if(!P)return{error:"The Statbel tables could not be read; try again shortly."};
  const meta=(await assets.json("/statbel/immo-areas-v1.json"))?.meta;
  const types=args.type&&args.type!=="all"?[args.type]:["house","apartment"];
  if(args.type&&!["all",...Object.keys(TYPE_LABEL)].includes(args.type))return{error:"type must be all, house, h23, h4 or apartment."};
  const year=args.year!=null?Number(args.year):undefined;
  if(year!==undefined&&(year<meta.years[0]||year>meta.years[1]))return{error:"year must be between "+meta.years[0]+" and "+meta.years[1]+"."};
  const prov=provenance(meta);
  if(args.rank_by==="median_price"){
    const r=await rank(P,assets,{within:args.within||"Belgium",type:types[0],order:args.order,limit:args.limit??10,year,min_sales:args.min_sales??MIN_SALES});if(r.error)return r;
    const first=r.ranking[0];
    return clean({key_facts:[first?(r.order==="lowest first"?"Lowest":"Highest")+" median price for "+r.type+" in "+r.within+" in "+r.year+": "+first.municipality+", "+eur(first.median_eur)+" ("+salesWord(first.sales)+").":"No municipality in "+r.within+" had enough sales to rank.",
      ...(r.left_out?["Left out: "+r.left_out+"."]:[])],...r,definitions:DEF,provenance:prov});
  }
  const names=(Array.isArray(args.places)?args.places:args.places?[args.places]:["Belgium"]).slice(0,6);
  const out=[],facts=[];
  for(const n of names){
    const r=resolvePlace(P,n);if(r.error){out.push({place:String(n),error:r.error});continue}
    const a=await areaFor(P,assets,r),name=label(P,r);
    if(!a){out.push({place:name,error:"no real-estate figures for this place"});continue}
    const by=Object.fromEntries(types.map(t=>[t,figures(a,t,year)]).filter(([,f])=>f));
    const half=Object.fromEntries(types.map(t=>[t,latestHalf(a,t)]).filter(([,h])=>h));
    out.push(clean({place:name,type:r.type,...(r.type==="municipality"?{nis_code:r.key}:{}),...(r.note?{note:r.note}:{}),...(r.merged_from?{merged_from:r.merged_from}:{}),
      by_type:Object.fromEntries(Object.entries(by).map(([t,f])=>[TYPE_LABEL[t],f])),
      ...(Object.keys(half).length&&half[types[0]]?.period?.slice(0,4)>String(Object.values(by)[0]?.year)?{latest_half_year:Object.fromEntries(Object.entries(half).map(([t,h])=>[TYPE_LABEL[t],h]))}:{})}));
    const priced=Object.entries(by).filter(([,f])=>f.median_eur!=null),unpriced=Object.entries(by).filter(([,f])=>f.median_eur==null);
    const parts=priced.map(([t,f])=>TYPE_LABEL[t]+" "+eur(f.median_eur)+" ("+salesWord(f.sales)+(f.median_change_5y_pct!=null?", "+(f.median_change_5y_pct>=0?"+":"")+f.median_change_5y_pct+" % in 5 years":"")+")");
    if(parts.length)facts.push(name+", median sale price in "+priced[0][1].year+": "+parts.join("; ")+".");
    if(unpriced.length)facts.push(name+": Statbel publishes no price for "+unpriced.map(([t,f])=>TYPE_LABEL[t]+(f.sales!=null?" ("+salesWord(f.sales)+")":"")).join(" or ")+" in "+unpriced[0][1].year+": too few sales to publish one.");
    if(r.merged_from)facts.push(String(n)+" merged into "+name+" on 1 January 2025; the figures are for the merged municipality.");
    const small=priced.filter(([,f])=>f.small_sample).map(([t])=>TYPE_LABEL[t]);
    if(small.length)facts.push(name+": the "+small.join(" and ")+" figure rests on fewer than "+MIN_SALES+" sales, so treat it as indicative.");
  }
  if(!facts.length)return{error:out.map(o=>o.error).filter(Boolean).join(" ")||"No figures found."};
  facts.push("Half of the sales were priced between the 25th and 75th percentile shown; prices are nominal and the mix of homes sold differs between places.");
  return clean({key_facts:facts,places:out,definitions:DEF,boundaries:meta.boundaries,provenance:prov});
}
const DEF={median_eur:"The middle sale price: half of the sales of that type in the period were cheaper, half more expensive.",
  p25_eur:"A quarter of the sales were cheaper than this.",p75_eur:"A quarter of the sales were more expensive than this.",
  sales:"Number of sales of that type registered in the period (deeds of sale).",
  median_change_5y_pct:"Change of the median against five years earlier, nominal (not adjusted for inflation) and also reflecting which homes happened to be sold."};
function provenance(meta){
  return{source:"Statbel, the Belgian statistical office: real estate sales according to the nature of the property in the deed of sale",licence:"CC BY 4.0",
    url:"https://statbel.fgov.be/en/open-data/real-estate-sales-according-nature-property-deed-sale-belgium",file:meta.source,period:meta.years.join("-")+(meta.latest_half_year?" (+ "+meta.latest_half_year+")":""),
    tables_built:meta.built,citation:"Statbel, real estate sales statistics, consulted on "+today()};
}
