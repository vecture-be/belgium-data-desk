// search_subsurface: find DOV records by area and attributes ("boreholes deeper than 100 m in Merelbeke-Melle", "wells in the Brussel
// sand with quality data near this address", "the largest groundwater permits in Mol"), the query style pydov offers, answered here
// with server-side filtering and sorting so only the requested top N rows travel.
//
// Every filter is built from validated numbers, dates, enumerations and codes; no caller text reaches a CQL filter. A municipality is
// matched with its official 2025 boundary (Digitaal Vlaanderen VRBG2025, generalised to 100 m), sent to DOV as the spatial filter:
// DOV's own municipality labels are missing on many records and still use pre-merger names.
import { _dov, GEO_ORIGIN } from "./dov.mjs";
const {wfsQuery,getJson,resolveLocation,codeList,clean,num,round,provenance,byDistance,present,NEARBY,PERMIT_PROPS,permitView,SOIL_LOC_PROPS,soilLocView,fmtM3,DAY,HOUR,MAX_POINTS}=_dov;

export const SEARCH_LIMIT={default:10,max:25},SEARCH_RADIUS={default:1000,min:25,max:5000};
const MAX_WKT=6000;
const PURPOSES={geological:"Geologisch onderzoek",geotechnical:"Geotechnisch onderzoek",groundwater_abstraction:"Grondwaterwinning",dewatering:"Drainage en bemaling",
  hydrogeological:"Hydrogeologisch onderzoek",geothermal:"Geothermie",groundwater_monitoring:"Grondwatermonitoring",energy_exploration:"Exploratie energie bronnen",contaminated_site_monitoring:"Monitoring vervuilde sites"};
const nb=k=>NEARBY.find(n=>n.key===k);
export const TYPES={
  boreholes:{layer:"dov-pub:Boringen",props:nb("boreholes").props,map:nb("boreholes").map,depth:"diepte_tot_m",date:"datum_aanvang",dataset:"Boringen",
    sorts:{deepest:"diepte_tot_m DESC",newest:"datum_aanvang DESC",oldest:"datum_aanvang ASC"},defaultSort:"deepest"},
  cpts:{layer:"dov-pub:Sonderingen",props:nb("cone_penetration_tests").props,map:nb("cone_penetration_tests").map,depth:"diepte_tot_m",date:"datum_aanvang",dataset:"Sonderingen",
    sorts:{deepest:"diepte_tot_m DESC",newest:"datum_aanvang DESC",oldest:"datum_aanvang ASC"},defaultSort:"deepest"},
  groundwater_wells:{layer:"gw_meetnetten:grondwaterlocaties",props:nb("groundwater_wells").props,map:nb("groundwater_wells").map,depth:"onderkant_filter_m",date:"peilmetingen_tot",dataset:"Grondwatermeetnetten",
    sorts:{deepest:"onderkant_filter_m DESC",newest:"peilmetingen_tot DESC",oldest:"peilmetingen_van ASC"},defaultSort:"newest"},
  groundwater_permits:{layer:"gw_vergunningen:huidige_verg",props:PERMIT_PROPS,map:p=>permitView(p,null),depth:"vergunde_diepte_m",date:"van_datum_termijn",dataset:"Grondwatervergunningen (huidige)",
    xy:["installatie_X_mL72","installatie_Y_mL72"],sorts:{largest:"vergund_jaardebiet DESC",deepest:"vergunde_diepte_m DESC",newest:"van_datum_termijn DESC"},defaultSort:"largest"},
  soil_profiles:{layer:"bodem:bodemlocaties",props:SOIL_LOC_PROPS,map:p=>soilLocView(p,null),date:"Datum",dataset:"Bodemlocaties",
    sorts:{most_described:"Aantal_observaties DESC",newest:"Datum DESC",oldest:"Datum ASC"},defaultSort:"most_described"}
};
const SORT_FIELD=s=>s.split(" ")[0];
const isDate=s=>typeof s==="string"&&/^\d{4}(-\d{2}(-\d{2})?)?$/.test(s);
const fullDate=(s,end)=>s.length===4?s+(end?"-12-31":"-01-01"):s.length===7?s+(end?"-31":"-01"):s;

// ---------- area: municipality boundary as WKT ----------
function ringsToWkt(geom){
  const polys=geom?.type==="Polygon"?[geom.coordinates]:geom?.type==="MultiPolygon"?geom.coordinates:null;if(!polys)return null;
  const fmt=(rings,step)=>"MULTIPOLYGON("+polys.map(rs=>"("+rs.map(r=>{
    const pts=step>1?r.filter((_,i)=>i%step===0||i===r.length-1):r;   // keep the ring closed
    return"("+pts.map(([a,b])=>Math.round(a)+" "+Math.round(b)).join(",")+")"}).join(",")+")").join(",")+")";
  // GeoServer reads the filter from the URL: thin out vertices until it fits (a 100 m generalised boundary rarely needs it)
  for(let step=1;step<=16;step*=2){const w=fmt(polys,step);if(w.length<=MAX_WKT)return w}
  return null;
}
async function municipalityArea(client,name){
  const q=String(name||"").trim().slice(0,80);if(!q)return{error:"municipality is empty."};
  // the geolocation service resolves Dutch names, old (pre-merger) names and typos to the current municipality
  const g=await getJson(client,GEO_ORIGIN+"/geolocation/v4/Location?"+new URLSearchParams({q,c:"1"}),{maxBytes:64*1024,ttl:7*DAY});
  const hit=g.json?.LocationResult?.[0];
  if(g.error||!hit?.Municipality)return{error:"Municipality '"+q+"' not found in Flanders."+(g.error?" ("+g.error+")":"")};
  const current=hit.Municipality;
  const r=await getJson(client,GEO_ORIGIN+"/VRBG2025/wfs?"+new URLSearchParams({service:"WFS",version:"2.0.0",request:"GetFeature",typeNames:"VRBG2025:RefgemG100",outputFormat:"application/json",
    srsName:"EPSG:31370",count:"1",cql_filter:"NAAM='"+current.replace(/'/g,"''")+"'"}),{maxBytes:512*1024,ttl:30*DAY});
  const f=r.json?.features?.[0];
  const wkt=f?ringsToWkt(f.geometry):null;
  if(!wkt)return{error:"The boundary of "+current+" could not be read"+(r.error?": "+r.error:"")+"."};
  return{cql:`INTERSECTS(geom,${wkt})`,area:clean({municipality:current,nis_code:f.properties?.NISCODE,asked:q!==current?q:null,boundary:"official 2025 boundary (VRBG2025), generalised to 100 m"})};
}

// ---------- filters ----------
async function filtersFor(client,type,T,a,applied){
  const c=[];
  const minD=num(a.min_depth_m),maxD=num(a.max_depth_m);
  if((minD!==null||maxD!==null)&&!T.depth)return{error:"min_depth_m/max_depth_m do not apply to "+type+"."};
  if(minD!==null){c.push(`${T.depth}>=${Math.max(0,minD)}`);applied.min_depth_m=minD}
  if(maxD!==null){c.push(`${T.depth}<=${Math.max(0,maxD)}`);applied.max_depth_m=maxD}
  for(const [k,end] of [["date_from",false],["date_to",true]]){
    if(a[k]===undefined||a[k]===null||a[k]==="")continue;
    if(!isDate(a[k]))return{error:k+" must be YYYY, YYYY-MM or YYYY-MM-DD."};
    c.push(`${T.date}${end?"<=":">="}'${fullDate(a[k],end)}'`);applied[k]=a[k];
  }
  if(a.purpose!==undefined){
    if(type!=="boreholes")return{error:"purpose applies to boreholes only."};
    const d=PURPOSES[a.purpose];if(!d)return{error:"purpose must be one of: "+Object.keys(PURPOSES).join(", ")+"."};
    c.push(`doel='${d}'`);applied.purpose=a.purpose;
  }
  if(a.with_stratigraphy===true){if(type!=="boreholes")return{error:"with_stratigraphy applies to boreholes only."};c.push("(formele_stratigrafie=true OR hydrogeologische_stratigrafie=true OR quartaire_stratigrafie=true)");applied.with_stratigraphy=true}
  if(a.cpt_method!==undefined){
    if(type!=="cpts")return{error:"cpt_method applies to cpts only."};
    if(a.cpt_method==="electric")c.push("sondeermethode='continu elektrisch'");else if(a.cpt_method==="mechanical")c.push("sondeermethode LIKE '%mechanisch%'");else return{error:"cpt_method must be electric or mechanical."};
    applied.cpt_method=a.cpt_method;
  }
  if(a.with_quality_data===true){if(type!=="groundwater_wells")return{error:"with_quality_data applies to groundwater_wells only."};c.push("kwaliteitsmetingen_van IS NOT NULL");applied.with_quality_data=true}
  if(a.with_lab_data===true){if(type!=="soil_profiles")return{error:"with_lab_data applies to soil_profiles only."};c.push("Aantal_monsters>0");applied.with_lab_data=true}
  const minV=num(a.min_annual_m3);
  if(minV!==null){if(type!=="groundwater_permits")return{error:"min_annual_m3 applies to groundwater_permits only."};c.push(`vergund_jaardebiet>=${Math.max(0,minV)}`);applied.min_annual_m3=minV}
  if(a.aquifer!==undefined&&a.aquifer!==""){
    const field=type==="groundwater_wells"?"Aquifer_HCOVv2":type==="groundwater_permits"?"aquifer_HCOVv2_vergunning":null;
    if(!field)return{error:"aquifer applies to groundwater_wells and groundwater_permits."};
    // an HCOV code (A0620; A06 for the whole system) or words from the unit name ("Brussel", "Krijt"), resolved with DOV's code list
    const s=String(a.aquifer).trim();let codes;
    if(/^A\d{2,4}$/i.test(s))codes=[s.toUpperCase().replace(/0+$/,"")||"A"];
    else{
      const words=s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g,"").split(/[^a-z0-9]+/).filter(w=>w.length>=3).slice(0,4);
      const list=await codeList(client,"HydrogeologischeStratigrafieDataCodes","AquiferHCOVv2EnumType");
      if(!list)return{error:"DOV's aquifer code list could not be read; pass an HCOV code such as A0620."};
      codes=[...list].filter(([,n])=>{const t=n.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g,"");return words.length&&words.every(w=>t.includes(w))}).map(([k])=>k).slice(0,12);
      if(!codes.length)return{error:"No HCOV aquifer unit matches '"+s.slice(0,40)+"'. Use a code such as A0620 (Zand van Brussel) from subsurface_at_location."};
    }
    c.push("("+codes.map(k=>`${field} LIKE '${k}%'`).join(" OR ")+")");applied.aquifer=codes.join(", ");
  }
  return{cql:c};
}

export async function searchSubsurface(client,args){
  const a=args||{},type=a.record_type,T=TYPES[type];
  if(!T)return{error:"record_type must be one of: "+Object.keys(TYPES).join(", ")+"."};
  const limit=Math.min(SEARCH_LIMIT.max,Math.max(1,Math.round(num(a.limit)??SEARCH_LIMIT.default)));
  const hasPoint=!!(a.address||(a.latitude!=null&&a.longitude!=null)||(a.x_lambert72!=null&&a.y_lambert72!=null));
  if(hasPoint&&a.municipality)return{error:"Give either a municipality or a location (address or coordinates), not both."};
  const applied={};
  const f=await filtersFor(client,type,T,a,applied);if(f.error)return{error:f.error};
  let areaCql=null,area,pt=null,radius=null;
  if(a.municipality){const m=await municipalityArea(client,a.municipality);if(m.error)return{error:m.error};areaCql=m.cql;area=m.area}
  else if(hasPoint){
    const w=await resolveLocation(client,a);if(w.error)return{error:w.error};
    pt=w.loc;radius=Math.min(SEARCH_RADIUS.max,Math.max(SEARCH_RADIUS.min,Math.round(num(a.radius_m)??SEARCH_RADIUS.default)));
    areaCql=`DWITHIN(geom,POINT(${pt.x} ${pt.y}),${radius},meters)`;
    area=clean({location:clean({matched_address:pt.matched_address,latitude:pt.latitude,longitude:pt.longitude,x_lambert72:pt.x,y_lambert72:pt.y}),radius_m:radius});
  }else area={region:"Flemish Region (no area given)"};
  const sort=a.sort??(pt?"nearest":T.defaultSort);
  if(sort!=="nearest"&&!T.sorts[sort])return{error:"sort for "+type+" must be one of: "+["nearest",...Object.keys(T.sorts)].join(", ")+"."};
  if(sort==="nearest"&&!pt)return{error:"sort 'nearest' needs an address or coordinates."};
  const parts=[...(areaCql?[areaCql]:[]),...f.cql];
  if(sort!=="nearest")parts.push(SORT_FIELD(T.sorts[sort])+" IS NOT NULL");   // DOV sorts empty values first
  const cql=parts.join(" AND ")||"INCLUDE";
  const [xf,yf]=T.xy||["X_mL72","Y_mL72"];
  let rows,matched;
  if(sort==="nearest"){
    const r=await wfsQuery(client,T.layer,{props:T.props,cql,count:MAX_POINTS,ttl:6*HOUR});if(r.error)return{error:r.error};
    matched=r.matched;
    rows=r.rows.map(p=>({p,d:Math.hypot(p[xf]-pt.x,p[yf]-pt.y)})).sort((x,y)=>x.d-y.d).slice(0,limit).map(o=>({distance_m:Math.round(o.d),...T.map(o.p)}));
  }else{
    const r=await wfsQuery(client,T.layer,{props:T.props,cql,count:limit,ttl:6*HOUR,sortBy:T.sorts[sort]});if(r.error)return{error:r.error};
    matched=r.matched;
    rows=r.rows.map(p=>pt?{distance_m:Math.round(Math.hypot(p[xf]-pt.x,p[yf]-pt.y)),...T.map(p)}:T.map(p));
  }
  // Permits: the licensed total and its split by aquifer are the useful summary (fetched when the set is small enough to add up).
  let summary=null;
  if(type==="groundwater_permits"&&matched>0&&matched<=MAX_POINTS){
    const all=await wfsQuery(client,T.layer,{props:["vergund_jaardebiet","aquifer_HCOVv2_vergunning"],cql:parts.filter(p=>!/ IS NOT NULL$/.test(p)).join(" AND ")||"INCLUDE",count:MAX_POINTS,ttl:6*HOUR});
    if(!all.error){
      const agg=new Map();let total=0;
      for(const p of all.rows){const v=num(p.vergund_jaardebiet)||0;total+=v;const k=p.aquifer_HCOVv2_vergunning||"unknown";const x=agg.get(k)||{aquifer:k,permits:0,licensed_m3_per_year:0};x.permits++;x.licensed_m3_per_year+=v;agg.set(k,x)}
      summary={licensed_m3_per_year:Math.round(total),by_aquifer:[...agg.values()].sort((x,y)=>y.licensed_m3_per_year-x.licensed_m3_per_year).slice(0,8).map(x=>({...x,licensed_m3_per_year:Math.round(x.licensed_m3_per_year)}))};
    }
  }
  const where=area.municipality?"in "+area.municipality:area.radius_m?"within "+area.radius_m+" m":"in Flanders";
  const facts=[matched+" "+type.replace(/_/g," ")+" "+where+(Object.keys(applied).length?" matching "+Object.entries(applied).map(([k,v])=>k+"="+v).join(", "):"")+"; showing "+rows.length+" by "+sort.replace(/_/g," ")+"."];
  if(summary)facts.push("Licensed abstraction "+where+": "+fmtM3(summary.licensed_m3_per_year)+" a year"+(summary.by_aquifer[0]?", mostly from "+summary.by_aquifer[0].aquifer:"")+".");
  return clean({key_facts:facts,record_type:type,area,filters:applied,sort,count:matched,results:rows,summary,
    note:(sort==="nearest"&&matched>MAX_POINTS?"Nearest among the first "+MAX_POINTS+" of "+matched+"; use a smaller radius_m. ":"")+
      "count is every matching DOV record in the area. Use get_subsurface_record with a result id for details; the DOV page of any id is https://www.dov.vlaanderen.be/data/<id>."+
      (type==="groundwater_permits"?" Permits give licensed maxima, not measured abstraction; names of private persons are withheld.":""),
    provenance:provenance([T.dataset,...(area.municipality?["Voorlopig referentiebestand gemeentegrenzen 2025 (Digitaal Vlaanderen)"]:[])].sort(),{geocoded:!!pt?.geocoded})});
}
