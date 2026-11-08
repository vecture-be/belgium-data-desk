// Location-based access to Databank Ondergrond Vlaanderen (DOV): soil, geology and groundwater at a place in Flanders, and the
// details of one borehole, cone penetration test, groundwater screen or interpretation. Used by the MCP tools subsurface_at_location
// and get_subsurface_record.
//
// Design: answers are read live from DOV's own public services (GeoServer WFS with JSON output, the xdov record export and the
// published XSD code lists) instead of harvesting them, so they are as current as DOV and nothing large is stored here.
// Every upstream URL is built in this file from validated numbers and record keys; no tool accepts a URL. Requests go to two fixed
// hosts only, ask for the few properties that are used (no polygon geometry), are capped in count, bytes and time, and are edge-cached
// so repeat questions do not reach DOV again. Data: (c) Flemish Government, Databank Ondergrond Vlaanderen, Modellicentie Gratis
// Hergebruik; the provenance block of every answer carries the citation DOV asks for.

import { G3D_UNITS } from "./dov-model-units.mjs";

export const DOV_ORIGIN="https://www.dov.vlaanderen.be",GEO_ORIGIN="https://geo.api.vlaanderen.be";
// DOV's record export answers HTTP 500 to a specific Accept header, so every request sends */*.
// Official public services the live tools may read (DOV; Digitaal Vlaanderen; IRCEL-CELINE; Statbel be.STAT and open-data files;
// VMM flood maps). Anything else is refused before a request is made.
const HOSTS=new Set(["www.dov.vlaanderen.be","geo.api.vlaanderen.be","geo.irceline.be","bestat.statbel.fgov.be","statbel.fgov.be","inspirepub.waterinfo.be","best.pr.fedservices.be"]);
// statbel.fgov.be also serves web pages behind a bot check; only its open-data file folder is allowed
const PATH_ONLY={"statbel.fgov.be":"/sites/default/files/files/opendata/"};
const WFS=DOV_ORIGIN+"/geoserver/wfs",WMS=DOV_ORIGIN+"/geoserver/wms",EXPORT=DOV_ORIGIN+"/xdov/proxy/export",XSD=DOV_ORIGIN+"/xdov/schema/latest/xsd/kern/interpretatie/";
const TIMEOUT_MS=12000,MAX_UPSTREAM=20,MAX_POINTS=500,NEAREST=5,DEEPEST=3,MAX_LAYERS=80,MAX_TEXT=240;
const DAY=86400,HOUR=3600;
// max 500 m: a 1 km radius in central Antwerp returns ~360 KiB from DOV and ~10 ms CPU, the whole free-plan budget; 500 m costs ~4 ms.
export const RADIUS={default:250,min:25,max:500};
// Lambert 72 box that holds the Flemish Region (with margin); DOV has no data outside Flanders.
const L72={minX:15000,maxX:265000,minY:150000,maxY:250000};

// ---------- coordinates: WGS84 latitude/longitude -> Belgian Lambert 72 (EPSG:31370) ----------
// Helmert BD72 <-> WGS 84 (EPSG:15929, coordinate frame) then Lambert conformal conic 2SP on the International 1924 ellipsoid.
// Checked against the Flemish geolocation service, which returns both: agreement within a few centimetres.
const RAD=Math.PI/180,ARCSEC=RAD/3600;
function toEcef(lat,lon,a,f){const e2=f*(2-f),s=Math.sin(lat),n=a/Math.sqrt(1-e2*s*s);return[n*Math.cos(lat)*Math.cos(lon),n*Math.cos(lat)*Math.sin(lon),n*(1-e2)*s]}
function fromEcef([x,y,z],a,f){const e2=f*(2-f),p=Math.hypot(x,y);let lat=Math.atan2(z,p*(1-e2));for(let i=0;i<6;i++){const s=Math.sin(lat),n=a/Math.sqrt(1-e2*s*s);lat=Math.atan2(z+e2*n*s,p)}return[lat,Math.atan2(y,x)]}
const HT=[106.8686,-52.2978,103.7239],HR=[0.3366,-0.457,1.8422].map(v=>v*ARCSEC),HS=1+1.2747e-6;
const toBd72=([x,y,z])=>{const [rx,ry,rz]=HR;return[HT[0]+HS*(x+rz*y-ry*z),HT[1]+HS*(-rz*x+y+rx*z),HT[2]+HS*(ry*x-rx*y+z)]};
const LA=6378388,LF=1/297,LE=Math.sqrt(LF*(2-LF));
const P1=(51+10/60+0.00204/3600)*RAD,P2=(49+50/60+0.00204/3600)*RAD,L0=(4+22/60+2.952/3600)*RAD,FE=150000.013,FN=5400088.438;
const lm=p=>Math.cos(p)/Math.sqrt(1-LE*LE*Math.sin(p)**2),lt=p=>Math.tan(Math.PI/4-p/2)/((1-LE*Math.sin(p))/(1+LE*Math.sin(p)))**(LE/2);
const LN=(Math.log(lm(P1))-Math.log(lm(P2)))/(Math.log(lt(P1))-Math.log(lt(P2))),LFF=lm(P1)/(LN*lt(P1)**LN);
/** Lambert 72 -> WGS84: inverse projection, then the Helmert transformation with negated parameters (round trip within a few mm). */
export function lambert72ToWgs84(x,y){
  const dx=x-FE,dy=FN-y,r=Math.sign(LN)*Math.hypot(dx,dy),t=(r/(LA*LFF))**(1/LN),th=Math.atan2(dx,dy),lon=th/LN+L0;
  let lat=Math.PI/2-2*Math.atan(t);
  for(let i=0;i<8;i++)lat=Math.PI/2-2*Math.atan(t*((1-LE*Math.sin(lat))/(1+LE*Math.sin(lat)))**(LE/2));
  const [ex,ey,ez]=toEcef(lat,lon,LA,LF),[rx,ry,rz]=HR.map(v=>-v),T=HT.map(v=>-v),S=1-1.2747e-6;
  const w=[T[0]+S*(ex+rz*ey-ry*ez),T[1]+S*(-rz*ex+ey+rx*ez),T[2]+S*(ry*ex-rx*ey+ez)];
  const [la,lo]=fromEcef(w,6378137,1/298.257223563);
  return[Math.round(la/RAD*1e7)/1e7,Math.round(lo/RAD*1e7)/1e7];
}
export function wgs84ToLambert72(lat,lon){
  const [la,lo]=fromEcef(toBd72(toEcef(lat*RAD,lon*RAD,6378137,1/298.257223563)),LA,LF);
  const r=LA*LFF*lt(la)**LN,th=LN*(lo-L0);
  return[Math.round((FE+r*Math.sin(th))*100)/100,Math.round((FN-r*Math.cos(th))*100)/100];
}

// ---------- bounded upstream access ----------
/** One client per tool call: fixed hosts, a request budget, a timeout, a byte cap, manual redirects and edge caching. */
export function makeDovClient({fetchImpl=fetch}={}){
  let used=0;
  return{
    get used(){return used},
    async get(url,{maxBytes=1<<20,ttl=HOUR,binary=false}={}){
      let u;try{u=new URL(url)}catch{return{error:"bad upstream address"}}
      if(u.protocol!=="https:"||!HOSTS.has(u.hostname)||u.username||u.password||(PATH_ONLY[u.hostname]&&!u.pathname.startsWith(PATH_ONLY[u.hostname])))return{error:"upstream host not allowed"};
      if(used>=MAX_UPSTREAM)return{error:"request budget for this answer is used up"};
      used++;
      let r;
      try{
        r=await fetchImpl(u.href,{headers:{accept:"*/*","user-agent":"Belgium-Data-Desk/1.0 (+https://data.vecture.be)"},redirect:"manual",
          signal:AbortSignal.timeout(TIMEOUT_MS),cf:{cacheEverything:true,cacheTtl:ttl}});
      }catch(e){return{error:e?.name==="TimeoutError"||e?.name==="AbortError"?"DOV did not answer within "+TIMEOUT_MS/1000+" s":"DOV could not be reached"}}
      if(r.status!==200){r.body?.cancel?.().catch(()=>{});return{error:"DOV answered HTTP "+r.status,status:r.status}}
      const reader=r.body?.getReader(),parts=[];let size=0;
      if(reader)for(;;){
        const {done,value}=await reader.read();if(done)break;
        size+=value.length;if(size>maxBytes){await reader.cancel().catch(()=>{});return{error:"the DOV record is larger than "+Math.round(maxBytes/1024)+" KiB, too large to summarise here",tooLarge:true}}
        parts.push(value);
      }
      const bytes=new Uint8Array(size);let o=0;for(const p of parts){bytes.set(p,o);o+=p.length}
      if(binary)return{bytes,contentType:r.headers.get("content-type")||""};
      return{text:new TextDecoder().decode(bytes),contentType:r.headers.get("content-type")||""};
    }
  };
}

async function getJson(client,url,opts){
  const r=await client.get(url,opts);if(r.error)return r;
  try{return{json:JSON.parse(r.text)}}catch{return{error:/^\s*</.test(r.text)?"DOV answered with an error page instead of data":"DOV answered with unreadable data"}}
}

/** WFS GetFeature as JSON with only the named properties; returns {rows, matched} or {error}. */
export async function wfsQuery(client,typeName,{props,cql,count=50,ttl=HOUR,sortBy=null}){
  const q=new URLSearchParams({service:"WFS",version:"2.0.0",request:"GetFeature",typeNames:typeName,outputFormat:"application/json",srsName:"EPSG:31370",count:String(count),propertyName:props.join(","),cql_filter:cql});
  if(sortBy)q.set("sortBy",sortBy);
  const r=await getJson(client,WFS+"?"+q,{maxBytes:2<<20,ttl});
  if(r.error)return r;
  if(!Array.isArray(r.json?.features))return{error:"DOV answered without features"};
  const matched=Number(r.json.numberMatched??r.json.totalFeatures);   // GeoServer may say "unknown"
  return{rows:r.json.features.map(f=>f.properties||{}),matched:Number.isFinite(matched)?matched:r.json.features.length};
}

// ---------- small helpers ----------
const num=v=>{if(v===null||v===undefined||typeof v==="boolean"||String(v).trim()==="")return null;const n=typeof v==="number"?v:Number(String(v).replace(",","."));return Number.isFinite(n)?n:null};
const round=(v,d=2)=>v==null?null:Math.round(v*10**d)/10**d;
const cut=(s,n=MAX_TEXT)=>{const t=String(s??"").replace(/\s+/g," ").trim();return t.length>n?t.slice(0,n-1)+"…":t};
const clean=o=>Object.fromEntries(Object.entries(o).filter(([,v])=>v!==null&&v!==undefined&&v!==""&&!(Array.isArray(v)&&!v.length)));
const permkeyOf=uri=>String(uri||"").match(/(\d{4}-\d{6})$/)?.[1]||null;
const today=()=>new Date().toISOString().slice(0,10);
const ddmmyyyy=iso=>iso.slice(8,10)+"/"+iso.slice(5,7)+"/"+iso.slice(0,4);
function provenance(datasets,{geocoded=false}={}){
  const d=today();
  return clean({
    source:"Databank Ondergrond Vlaanderen (DOV), Flemish Government",
    licence:"Modellicentie Gratis Hergebruik (free reuse for any purpose, attribution required)",
    terms:DOV_ORIGIN+"/page/gebruiksvoorwaarden-dov-services",
    citation:"Databank Ondergrond Vlaanderen – "+datasets.join(", ")+" – geraadpleegd op "+ddmmyyyy(d)+", op https://www.dov.vlaanderen.be",
    retrieved:d,
    geocoding:geocoded?"Address located with the Geolocation service of Digitaal Vlaanderen (Flemish address register).":null
  });
}

// ---------- location input ----------
// BeSt Address (BOSA): the federal register of all Belgian addresses with their NIS code; structured search only, so the address is split
// as 'street number, postcode municipality'. Used where the Flemish geolocation service has no match (Wallonia).
const BEST="https://best.pr.fedservices.be/api/opendata/best/v1/belgianAddress/v2/addresses";
export function splitAddress(s){
  const m=String(s).match(/^\s*(.+?)\s+(\d+[A-Za-z]?(?:[\/-]\w+)?)\s*,\s*(?:(\d{4})\s+)?([^,]+?)\s*$/);
  return m?{street:m[1],number:m[2],postcode:m[3]||null,municipality:m[4]}:null;
}
async function bestGeocode(client,address){
  const p=splitAddress(address);if(!p)return null;
  const q=new URLSearchParams({streetName:p.street,houseNumber:p.number});if(p.postcode)q.set("postCode",p.postcode);else q.set("municipalityName",p.municipality);
  const r=await getJson(client,BEST+"?"+q,{maxBytes:256*1024,ttl:7*DAY});
  const it=r.json?.items?.find(i=>i.status==="current")||r.json?.items?.[0];
  const pos=it?.addressPosition;if(!pos?.lambert72)return null;
  const m=it.hasMunicipality||{};
  return{x:round(pos.lambert72.x),y:round(pos.lambert72.y),latitude:round(pos.wgs84?.lat,6),longitude:round(pos.wgs84?.long,6),input:"address",
    matched_address:[it.hasStreetName?.name?.fr||it.hasStreetName?.name?.nl||it.hasStreetName?.name?.de||p.street,it.houseNumber].join(" ")+", "+(it.hasPostalInfo?.postCode||"")+" "+(m.name?.fr||m.name?.nl||m.name?.de||""),
    match_type:"BeSt Address (federal address register)",municipality:m.name?.nl||m.name?.fr||null,nis_code:m.nisCode||null,geocoded:"best"};
}
const BE_L72={minX:15000,maxX:300000,minY:15000,maxY:250000};
async function resolveLocation(client,args,{area="flanders"}={}){
  const address=typeof args?.address==="string"?args.address.trim().slice(0,200):"";
  const lat=num(args?.latitude),lon=num(args?.longitude),x=num(args?.x_lambert72),y=num(args?.y_lambert72);
  const box=area==="belgium"?BE_L72:L72,where=area==="belgium"?"Belgium":"the Flemish Region, which is the area DOV covers";
  let loc;
  if(lat!==null&&lon!==null){
    if(lat<49.4||lat>51.6||lon<2.4||lon>6.5)return{error:"latitude/longitude are outside Belgium."};
    const [lx,ly]=wgs84ToLambert72(lat,lon);loc={x:lx,y:ly,latitude:round(lat,6),longitude:round(lon,6),input:"coordinates (WGS84)"};
  }else if(x!==null&&y!==null){
    const [la2,lo2]=lambert72ToWgs84(x,y);loc={x:round(x),y:round(y),latitude:round(la2,6),longitude:round(lo2,6),input:"coordinates (Lambert 72)"};
  }else if(address){
    const r=await getJson(client,GEO_ORIGIN+"/geolocation/v4/Location?"+new URLSearchParams({q:address,c:"1"}),{maxBytes:64*1024,ttl:7*DAY});
    const hit=r.json?.LocationResult?.[0];
    if(hit?.Location){
      loc={x:round(num(hit.Location.X_Lambert72)),y:round(num(hit.Location.Y_Lambert72)),latitude:round(num(hit.Location.Lat_WGS84),6),longitude:round(num(hit.Location.Lon_WGS84),6),
        input:"address",matched_address:hit.FormattedAddress||null,match_type:hit.LocationType||null,municipality:hit.Municipality||null,geocoded:true};
      if(hit.Housenumber==null)loc.note="The address matched a street or municipality, not a building: the point is approximate.";
    }else if(area==="belgium"){
      loc=await bestGeocode(client,address);
      if(!loc)return{error:"Address not found. Write it as 'street number, postcode municipality' (e.g. 'Place Saint-Lambert 1, 4000 Liège') or pass latitude and longitude."};
    }else return{error:r.error?"The address could not be looked up: "+r.error+". Pass latitude and longitude instead."
      :"Address not found in the Flemish address register. Write it as 'street number, postcode municipality' (e.g. 'Grote Markt 1, 3000 Leuven') or pass latitude and longitude. Only addresses in Flanders can be looked up."};
  }else return{error:"Give an address, or latitude and longitude (WGS84), or x_lambert72 and y_lambert72."};
  if(loc.x===null||loc.y===null)return{error:"The location has no usable coordinates."};
  if(loc.x<box.minX||loc.x>box.maxX||loc.y<box.minY||loc.y>box.maxY)return{error:"The location is outside "+where+".",location:{x_lambert72:loc.x,y_lambert72:loc.y}};
  return{loc};
}

// ---------- subsurface_at_location ----------
const POINT_LAYERS=[
  {key:"soil",layer:"bodemkaart:bodemtypes",geom:"geom",dataset:"Bodemkaart (digitale bodemkaart van Vlaanderen)",
    props:["Bodemtype","Beknopte_omschrijving_bodemserie","Textuurklasse","Drainageklasse","Profielontwikkelingsgroep","Eenduidige_legende"],
    map:p=>clean({soil_type:p.Bodemtype,series:p.Beknopte_omschrijving_bodemserie,texture:p.Textuurklasse,drainage:p.Drainageklasse,profile:p.Profielontwikkelingsgroep,legend:cut(p.Eenduidige_legende,360)})},
  {key:"tertiary_geology",layer:"neo_paleo:tertiair_50k",geom:"shape",dataset:"Tertiair geologische kaart 1:50.000",
    props:["code","formatie","lid","beschrijving"],map:p=>clean({code:p.code,formation:p.formatie,member:p.lid,description:cut(p.beschrijving)})},
  {key:"quaternary_geology",layer:"quartair:quartair_200k",geom:"geom",dataset:"Quartairgeologische kaart 1:200.000",
    props:["type","profiel"],map:p=>clean({profile_type:p.type,description:cut(p.profiel)})},
  {key:"groundwater_bodies",layer:"gw_beleid:gwlv2_grondwaterlichamen",geom:"geom",dataset:"Grondwaterlichamen",many:true,
    props:["Grondwaterlichaam_code","Grondwaterlichaam_naam","horizonten"],map:p=>clean({code:p.Grondwaterlichaam_code,name:p.Grondwaterlichaam_naam,horizons:p.horizonten})},
  {key:"drinking_water_protection_zone",layer:"gw_bescherming:beschermingszones",geom:"geom",dataset:"Grondwaterwingebieden en beschermingszones",many:true,
    props:["winning","zone_","fgemeente","besluit_to"],map:p=>clean({abstraction:p.winning,zone:p.zone_,municipality:p.fgemeente,operator:p.besluit_to})}
];
const BOREHOLE_FLAGS=["formele_stratigrafie","lithologische_beschrijving","gecodeerde_lithologie","hydrogeologische_stratigrafie","quartaire_stratigrafie","informele_stratigrafie","geotechnische_codering","informele_hydrostratigrafie"];
const NEARBY=[
  {key:"boreholes",layer:"dov-pub:Boringen",dataset:"Boringen",kind:"boring",
    props:["boornummer","fiche","diepte_tot_m","datum_aanvang","doel","X_mL72","Y_mL72","Z_mTAW",...BOREHOLE_FLAGS],
    map:p=>clean({id:"boring/"+permkeyOf(p.fiche),name:p.boornummer,depth_m:num(p.diepte_tot_m),date:p.datum_aanvang,purpose:p.doel,ground_level_m_taw:num(p.Z_mTAW),
      interpretations:BOREHOLE_FLAGS.filter(f=>p[f]===true)})},
  {key:"cone_penetration_tests",layer:"dov-pub:Sonderingen",dataset:"Sonderingen",kind:"sondering",
    props:["sondeernummer","fiche","diepte_tot_m","datum_aanvang","sondeermethode","X_mL72","Y_mL72","Z_mTAW"],
    map:p=>clean({id:"sondering/"+permkeyOf(p.fiche),name:p.sondeernummer,depth_m:num(p.diepte_tot_m),date:p.datum_aanvang,method:p.sondeermethode,ground_level_m_taw:num(p.Z_mTAW)})},
  {key:"groundwater_wells",layer:"gw_meetnetten:grondwaterlocaties",dataset:"Grondwatermeetnetten (grondwaterlocaties en filters)",kind:"filter",
    props:["GW_ID","filternummer","filterfiche","X_mL72","Y_mL72","Z_mTAW","onderkant_filter_m","lengte_filter_m","Aquifer_HCOVv2","filtertype","meetnet","beheerder","peilmetingen_van","peilmetingen_tot","kwaliteitsmetingen_van","kwaliteitsmetingen_tot"],
    map:p=>clean({id:"filter/"+permkeyOf(p.filterfiche),well:p.GW_ID,screen:p.filternummer,screen_bottom_m:num(p.onderkant_filter_m),screen_length_m:num(p.lengte_filter_m),
      aquifer:p.Aquifer_HCOVv2,screen_type:p.filtertype,network:p.meetnet,manager:p.beheerder,levels:p.peilmetingen_van?p.peilmetingen_van+" to "+(p.peilmetingen_tot||"?"):null,
      quality_samples:p.kwaliteitsmetingen_van?p.kwaliteitsmetingen_van+" to "+(p.kwaliteitsmetingen_tot||"?"):null})}
];
const PERCENTILE={"<P10":"very low (below the 10th percentile)","P10-P30":"low (10th-30th percentile)","P30-P70":"normal (30th-70th percentile)","P70-P90":"high (70th-90th percentile)",">P90":"very high (above the 90th percentile)"};
const TREND={gedaald:"falling",gelijk:"stable",gestegen:"rising"};
const STATUS_SEARCH_M=15000;

// Rank raw rows by distance and map only the few that are returned: a 1 km radius in Antwerp holds ~400 boreholes, and mapping all
// of them cost more CPU than parsing them.
const byDistance=(rows,x,y,radius)=>{
  const out=[];for(const p of rows){const d=Math.hypot(p.X_mL72-x,p.Y_mL72-y);if(d<=radius+1)out.push({p,d})}
  return out.sort((a,b)=>a.d-b.d);
};
const present=(r,map)=>({distance_m:Math.round(r.d),...map(r.p)});

// ---------- modelled column: DOV's 3D layer models at one point ----------
// Each model is published as one multiband coverage (one band per unit surface, 100 m grid). A WMS GetFeatureInfo for one pixel
// returns every band in a single small JSON answer, so the whole column costs one request per model and nothing is harvested.
// Bands hold the base height (m TAW) of each unit; G3D's "_t" band is the top of the Palaeozoic basement, which has no base.
const MODELS=[
  {key:"geology",layer:"g3dv3_1:g3dv3_1_multiband",model:"G3Dv3.1, Geological 3D model of Flanders",dataset:"Geologisch 3D model (G3Dv3.1)"},
  {key:"hydrogeology",layer:"h3dv2_1:h3dv2_1_multiband",model:"H3Dv2.1, Hydrogeological 3D model of Flanders (HCOV v2 units)",dataset:"Hydrogeologisch 3D model (H3Dv2.1)"}
];
const ERA={Q:"Quaternary",NE:"Neogene",PA:"Paleogene",KR:"Cretaceous",JU:"Jurassic",TR:"Triassic",PE:"Permian",CA:"Carboniferous",DE:"Devonian",SI:"Silurian to Cambrian"};
const present_=v=>typeof v==="number"&&Number.isFinite(v)&&Math.abs(v)<5000;   // the coverages mark absent units with null or -9999
/** Turn one pixel's band values into units from the top down, with depths below the model's ground level. */
export function columnFromBands(props,{prefix="",names=null}={}){
  const ground=props?.[prefix+"Topografie"];if(!present_(ground))return null;
  const bands=Object.entries(props).filter(([k,v])=>k!==prefix+"Topografie"&&present_(v)).map(([k,v])=>({code:k.slice(prefix.length).replace(/_[bt]$/,""),top:/_t$/.test(k),v}))
    .sort((a,b)=>b.v-a.v||a.top-b.top);
  const depth=v=>Math.round((ground-v)*10)/10,units=[];let above=ground;
  bands.forEach((b,i)=>{
    const era=ERA[b.code.match(/^\d+([A-Z]{1,2})(?:_|$)/)?.[1]]||(b.code==="A"?"Anthropogenic":null);
    const name=names?.(b.code)||null;
    // a top surface, or a last band at the level of the unit above it, starts a unit whose base the model does not give
    if(b.top||(i===bands.length-1&&above-b.v<0.005)){units.push(clean({from_m:depth(b.v),to_m:null,unit:b.code,name,era}));return}
    if(above-b.v<0.005)return;   // unit absent here (zero thickness)
    units.push(clean({from_m:depth(above),to_m:depth(b.v),unit:b.code,name,era}));above=b.v;
  });
  return{ground_level_m_taw:Math.round(ground*100)/100,units};
}
async function modelPixel(client,layer,x,y){
  const q=new URLSearchParams({service:"WMS",version:"1.3.0",request:"GetFeatureInfo",layers:layer,query_layers:layer,styles:"",crs:"EPSG:31370",
    bbox:[x-1,y-1,x+1,y+1].map(v=>Math.round(v*100)/100).join(","),width:"1",height:"1",i:"0",j:"0",info_format:"application/json"});
  const r=await getJson(client,WMS+"?"+q,{maxBytes:64*1024,ttl:30*DAY});
  if(r.error)return r;
  return{props:r.json?.features?.[0]?.properties||null};
}
// Units starting deeper than max_depth_m are summarised, not listed: under Antwerp the models hold 40 units down to deep Palaeozoic
// rock, which would double the answer for the usual questions (foundations, wells, closed-loop geothermal reach a few hundred metres).
export const MODEL_DEPTH={default:300,min:10,max:5000};
function cutColumn(units,maxDepth){
  if(!units)return{};
  const shown=units.filter(u=>u.from_m<maxDepth),deeper=units.length-shown.length;
  return{units:shown,deeper:deeper?{units:deeper,deepest_from_m:units.at(-1).from_m}:null};
}
async function modelledColumn(client,x,y,used,maxDepth){
  const [g,h,hcov]=await Promise.all([modelPixel(client,MODELS[0].layer,x,y),modelPixel(client,MODELS[1].layer,x,y),codeList(client,"HydrogeologischeStratigrafieDataCodes","AquiferHCOVv2EnumType")]);
  const geology=g.props?columnFromBands(g.props,{prefix:"g_",names:c=>G3D_UNITS[c]}):null;
  const hydrogeology=h.props?columnFromBands(h.props,{names:c=>hcov?.get(c)}):null;
  if(!geology&&!hydrogeology)return g.error||h.error?{error:g.error||h.error}:null;
  if(geology)used.add(MODELS[0].dataset);if(hydrogeology)used.add(MODELS[1].dataset);
  const gc=cutColumn(geology?.units,maxDepth),hc=cutColumn(hydrogeology?.units,maxDepth);
  return clean({ground_level_m_taw:geology?.ground_level_m_taw??hydrogeology?.ground_level_m_taw,max_depth_m:maxDepth,
    geology:gc.units,hydrogeology:hc.units,
    deeper_units:gc.deeper||hc.deeper?clean({geology:gc.deeper,hydrogeology:hc.deeper,how:"Pass a larger max_depth_m to list them."}):null,
    models:MODELS.map(m=>m.model).join("; ")+"; 100 m grid",
    note:"Modelled, not observed: unit boundaries are interpolated from boreholes and seismics over 100 m cells and become less certain with depth. from_m/to_m are metres below the model's ground level; a unit without to_m continues below (the model gives no base). Check against nearby boreholes."});
}

export async function subsurfaceAtLocation(client,args){
  const where=await resolveLocation(client,args);if(where.error)return{error:where.error,...(where.location?{location:where.location}:{})};
  const {loc}=where,{x,y}=loc;
  const radius=Math.min(RADIUS.max,Math.max(RADIUS.min,Math.round(num(args?.radius_m)??RADIUS.default)));
  const pt=`POINT(${x} ${y})`;
  const used=new Set();
  const [points,near,status,column,permits,soilProfiles]=await Promise.all([
    Promise.all(POINT_LAYERS.map(async L=>{
      const r=await wfsQuery(client,L.layer,{props:L.props,cql:`INTERSECTS(${L.geom},${pt})`,count:L.many?10:1,ttl:DAY});
      if(r.error)return[L.key,{error:r.error}];
      used.add(L.dataset);
      const rows=r.rows.map(L.map);return[L.key,L.many?rows:(rows[0]||null)];
    })),
    Promise.all(NEARBY.map(async N=>{
      const r=await wfsQuery(client,N.layer,{props:N.props,cql:`DWITHIN(geom,${pt},${radius},meters)`,count:MAX_POINTS,ttl:6*HOUR});
      if(r.error)return[N.key,{error:r.error}];
      used.add(N.dataset);
      const all=byDistance(r.rows,x,y,radius);
      const out={count:r.matched,nearest:all.slice(0,NEAREST).map(o=>present(o,N.map))};
      if(N.kind==="boring"){
        const deep=all.slice(NEAREST).filter(o=>o.p.diepte_tot_m>0).sort((a,b)=>b.p.diepte_tot_m-a.p.diepte_tot_m).slice(0,DEEPEST).map(o=>present(o,N.map));
        if(deep.length)out.deepest_others=deep;
        out.with_stratigraphy=all.filter(o=>o.p.formele_stratigrafie===true||o.p.hydrogeologische_stratigrafie===true||o.p.quartaire_stratigrafie===true||o.p.informele_stratigrafie===true).length;
      }
      if(r.matched>r.rows.length)out.note="Only the "+r.rows.length+" first of "+r.matched+" were ranked by distance; use a smaller radius_m for the true nearest.";
      return[N.key,out];
    })),
    (async()=>{
      const b=[x-STATUS_SEARCH_M,y-STATUS_SEARCH_M,x+STATUS_SEARCH_M,y+STATUS_SEARCH_M].map(Math.round).join(",");
      const r=await wfsQuery(client,"gw_varia:stand_freatisch",{props:["Putnummer","Filternummer","Filterfiche","Datum","Relatief_percentiel","Trend","Grafiek","X","Y"],cql:`BBOX(geom,${b})`,count:200,ttl:6*HOUR});
      if(r.error)return{error:r.error};
      const best=r.rows.map(p=>({p,d:Math.hypot(num(p.X)-x,num(p.Y)-y)})).filter(o=>Number.isFinite(o.d)&&o.d<=STATUS_SEARCH_M).sort((a,b)=>a.d-b.d)[0];
      used.add("Grondwaterstandindicator freatisch grondwater");
      if(!best)return null;
      const p=best.p;
      return clean({well:p.Putnummer,screen:p.Filternummer,id:"filter/"+permkeyOf(p.Filterfiche),distance_m:Math.round(best.d),date:p.Datum,
        level_class:PERCENTILE[p.Relatief_percentiel]||p.Relatief_percentiel,percentile_class:p.Relatief_percentiel,trend:TREND[p.Trend]||p.Trend,graph:p.Grafiek,
        meaning:"Latest shallow (phreatic) groundwater level at the nearest status well, classed against that well's own measurement history."});
    })(),
    modelledColumn(client,x,y,used,Math.min(MODEL_DEPTH.max,Math.max(MODEL_DEPTH.min,Math.round(num(args?.max_depth_m)??MODEL_DEPTH.default)))),
    permitsNear(client,x,y,Math.max(radius,WIDE_RADIUS),used),
    soilProfilesNear(client,x,y,Math.max(radius,WIDE_RADIUS),used)
  ]);
  const at=Object.fromEntries(points),nearby=Object.fromEntries(near);
  if(permits)nearby.groundwater_permits=permits;
  if(soilProfiles)nearby.soil_profiles=soilProfiles;
  const mapped=at.soil||at.tertiary_geology||at.quaternary_geology;
  const failed=[...points,...near].filter(([,v])=>v?.error).length;
  if(failed===points.length+near.length)return{error:"DOV's services did not answer; try again in a minute.",location:loc};
  const location=clean({...loc,x_lambert72:loc.x,y_lambert72:loc.y,x:undefined,y:undefined,geocoded:undefined});
  const out={
    location,radius_m:radius,
    at_point:at,
    modelled_column:column,
    nearby,
    groundwater_status_nearest:status,
    coverage_note:!mapped?"No DOV map unit at this point: DOV covers the Flemish Region, and the soil map has gaps in some built-up and water areas."
      :Array.isArray(at.groundwater_bodies)&&!at.groundwater_bodies.length?"No Flemish groundwater body here: the point is probably in the Brussels-Capital Region, where the Flemish groundwater-body and protection-zone maps do not apply; DOV still holds some boreholes and older map units there.":null,
    next_step:"Call get_subsurface_record with an id from nearby: 'boring/…' for a borehole's layers, 'filter/…' for groundwater levels and quality, 'sondering/…' for a CPT, 'bodemlocatie/…' for a soil profile. search_subsurface finds records by municipality, depth, purpose, aquifer or date.",
    note:"Map units are from published maps at the stated scale and can be wrong at a single parcel; modelled_column is DOV's 3D model at this point, not an observation; boreholes and wells are point observations. 'count' is everything DOV holds within the radius; ranking uses straight-line distance. The DOV page of any id is https://www.dov.vlaanderen.be/data/<id>. Groundwater permits and soil profiles are searched within at least "+WIDE_RADIUS+" m.",
    provenance:provenance([...used].sort(),{geocoded:!!loc.geocoded})
  };
  return clean({key_facts:keyFacts(out),...out});
}

// ---------- key facts: the answer in a few sentences, built only from the fields below it ----------
const fmtM3=v=>v>=1e6?round(v/1e6,2)+" million m³":v>=1e3?Math.round(v/1e3)+" thousand m³":Math.round(v)+" m³";
export function keyFacts(r){
  const f=[],at=r.at_point||{},mc=r.modelled_column,nb=r.nearby||{};
  if(at.soil?.soil_type)f.push("Soil map: "+at.soil.soil_type+(at.soil.series?" ("+at.soil.series+(at.soil.texture?", "+at.soil.texture.toLowerCase():"")+(at.soil.drainage?", "+at.soil.drainage.toLowerCase():"")+")":"")+".");
  if(at.tertiary_geology?.formation)f.push("First Tertiary unit below the cover (geological map): "+at.tertiary_geology.formation+(at.tertiary_geology.member?", "+at.tertiary_geology.member:"")+".");
  if(mc?.geology?.length){
    const top=mc.geology.slice(0,4).map(u=>(u.name||u.unit)+" "+u.from_m+"–"+(u.to_m??"…")+" m");
    f.push("Modelled column (3D model, not observed): "+top.join("; ")+(mc.geology.length>4?"; then "+(mc.geology.length-4)+" more units":"")+".");
    const base=mc.geology.find(u=>u.to_m==null);if(base)f.push("Model: "+(base.name||base.unit)+" from about "+base.from_m+" m.");
  }
  if(Array.isArray(at.drinking_water_protection_zone))f.push(at.drinking_water_protection_zone.length?"Inside drinking-water protection zone "+at.drinking_water_protection_zone.map(z=>z.zone+" ("+z.abstraction+")").join(", ")+": extra rules apply to wells, drilling and storage.":"Not in a drinking-water protection zone.");
  const b=nb.boreholes;if(b?.count)f.push(b.count+" borehole(s) within "+r.radius_m+" m; nearest "+b.nearest[0].distance_m+" m away, "+(b.nearest[0].depth_m??"?")+" m deep"+(b.deepest_others?.[0]?"; deepest nearby "+b.deepest_others[0].depth_m+" m":"")+".");
  else if(b&&!b.error)f.push("No borehole within "+r.radius_m+" m; the modelled column is the best estimate.");
  const w=nb.groundwater_wells;if(w?.count)f.push(w.count+" groundwater monitoring screen(s) within "+r.radius_m+" m (nearest "+w.nearest[0].distance_m+" m, "+(w.nearest[0].aquifer||"aquifer unknown")+").");
  const s=r.groundwater_status_nearest;if(s?.level_class)f.push("Shallow groundwater now: "+s.level_class+", "+s.trend+" (status well "+s.well+", "+Math.round(s.distance_m/100)/10+" km away, "+s.date+").");
  const p=nb.groundwater_permits;if(p?.count)f.push(p.count+" groundwater abstraction permit(s) within "+p.radius_m+" m, licensed for "+fmtM3(p.licensed_m3_per_year)+" a year"+(p.by_aquifer?.[0]?", mostly from "+p.by_aquifer[0].aquifer:"")+".");
  const sp=nb.soil_profiles;if(sp?.count)f.push(sp.count+" described soil profile(s) within "+sp.radius_m+" m (nearest "+sp.nearest[0].distance_m+" m).");
  return f;
}

// ---------- groundwater abstraction permits ----------
// DOV publishes the operator name of every permit, including private persons (mostly farmers). An answer about a place should not hand
// out the names of private individuals near an address, so a name is shown only for registered enterprises and public bodies.
export const WIDE_RADIUS=1000;
const PUBLIC_BODY=/\b(gemeente|stad|provincie|ocmw|politiezone|intercommunale|vlaamse|vlaams|federale|belgische|nationale|universiteit|hogeschool|school|kerkfabriek|polder|watering|ziekenhuis|agentschap|maatschappij|departement|ministerie|zorg|vzw|nv|bv|bvba|cvba|cv|sa|srl|sprl|comm\.?v|vof)\b/i;
export function operatorName(p){
  const n=String(p?.exploitant_naam||"").trim();
  if(!n)return null;
  if(p.exploitant_KBOnr||PUBLIC_BODY.test(n)||/^[A-Z0-9 &.'\-]{4,}$/.test(n))return cut(n,80);   // KBO-registered, a public body or legal form, or an all-capitals company name
  return null;
}
const PERMIT_PROPS=["vergunning","exploitant_naam","exploitant_KBOnr","vlaremrubriek","vergund_jaardebiet","vergund_dagdebiet","van_datum_termijn","tot_datum_termijn","aquifer_HCOVv2_vergunning","vergunde_diepte_m","vergund_aantal_putten","inrichtingsklasse","IIOA_nacebelcode","installatie_X_mL72","installatie_Y_mL72"];
export const permitView=(p,d,compact=false)=>clean({distance_m:d==null?null:Math.round(d),operator:operatorName(p)||"not named (private person or unregistered operator)",sector:p.IIOA_nacebelcode&&!/^0000/.test(p.IIOA_nacebelcode)?p.IIOA_nacebelcode.replace(/^\d+:\s*/,""):null,
  licensed_m3_per_year:num(p.vergund_jaardebiet),licensed_m3_per_day:num(p.vergund_dagdebiet),aquifer:p.aquifer_HCOVv2_vergunning,depth_m:num(p.vergunde_diepte_m),wells:num(p.vergund_aantal_putten),
  ...(compact?{}:{class:p.inrichtingsklasse,valid:p.van_datum_termijn?p.van_datum_termijn+" to "+(p.tot_datum_termijn||"open-ended"):null,vlarem_heading:p.vlaremrubriek}),url:p.vergunning});
async function permitsNear(client,x,y,radius,used){
  const r=await wfsQuery(client,"gw_vergunningen:huidige_verg",{props:PERMIT_PROPS,cql:`DWITHIN(geom,POINT(${x} ${y}),${radius},meters)`,count:MAX_POINTS,ttl:DAY});
  if(r.error)return{error:r.error};
  used.add("Grondwatervergunningen (huidige)");
  const rows=r.rows.map(p=>({p,d:Math.hypot(p.installatie_X_mL72-x,p.installatie_Y_mL72-y)})).sort((a,b)=>a.d-b.d);
  const agg=new Map();let total=0;
  for(const {p} of rows){const v=num(p.vergund_jaardebiet)||0;total+=v;const k=p.aquifer_HCOVv2_vergunning||"unknown";const a=agg.get(k)||{aquifer:k,permits:0,licensed_m3_per_year:0};a.permits++;a.licensed_m3_per_year+=v;agg.set(k,a)}
  const nearest=rows.slice(0,3),shown=new Set(nearest.map(o=>o.p.vergunning));
  const largest=rows.filter(o=>!shown.has(o.p.vergunning)&&num(o.p.vergund_jaardebiet)).sort((a,b)=>b.p.vergund_jaardebiet-a.p.vergund_jaardebiet).slice(0,DEEPEST);
  return clean({radius_m:radius,count:r.matched,licensed_m3_per_year:Math.round(total),
    by_aquifer:[...agg.values()].sort((a,b)=>b.licensed_m3_per_year-a.licensed_m3_per_year).slice(0,6).map(a=>({...a,licensed_m3_per_year:Math.round(a.licensed_m3_per_year)})),
    nearest:nearest.map(o=>permitView(o.p,o.d,true)),largest_others:largest.map(o=>permitView(o.p,o.d,true)),
    note:"Current permits for pumping groundwater (licensed maxima, not measured abstraction). Names of private persons are withheld."+(r.matched>r.rows.length?" Totals cover the first "+r.rows.length+" of "+r.matched+" permits.":"")});
}

// ---------- soil profiles (bodemlocaties) ----------
const SOIL_LOC_PROPS=["Naam","Bodemlocatiefiche","Type","Datum","Doel","X_mL72","Y_mL72","mv_mTAW","Aantal_classificaties","Aantal_observaties","Aantal_monsters","Bodemstreek","Bodemsite","profielbeschrijving"];
export const soilLocView=(p,d)=>clean({distance_m:d==null?null:Math.round(d),id:"bodemlocatie/"+permkeyOf(p.Bodemlocatiefiche),name:p.Naam,type:p.Type,date:p.Datum,purpose:p.Doel,
  region:p.Bodemstreek,observations:num(p.Aantal_observaties),lab_samples:num(p.Aantal_monsters)});
async function soilProfilesNear(client,x,y,radius,used){
  const r=await wfsQuery(client,"bodem:bodemlocaties",{props:SOIL_LOC_PROPS,cql:`DWITHIN(geom,POINT(${x} ${y}),${radius},meters)`,count:MAX_POINTS,ttl:DAY});
  if(r.error)return{error:r.error};
  used.add("Bodemlocaties en bodemobservaties");
  if(!r.matched)return{radius_m:radius,count:0};
  const all=byDistance(r.rows,x,y,radius);
  // the richest profile (most observations, usually a soil-survey pit with lab data) is often more useful than the nearest
  const nearest=all.slice(0,2),shown=new Set(nearest.map(o=>o.p.Bodemlocatiefiche));
  const richest=all.filter(o=>!shown.has(o.p.Bodemlocatiefiche)).sort((a,b)=>(b.p.Aantal_observaties||0)-(a.p.Aantal_observaties||0)).slice(0,1);
  return clean({radius_m:radius,count:r.matched,nearest:nearest.map(o=>soilLocView(o.p,o.d)),most_described_others:richest.map(o=>soilLocView(o.p,o.d))});
}

// One soil profile, summarised the way a soil scientist reads it: site (water table, drainage, land use, parent material), classification,
// then per horizon the field description and the lab values that matter, instead of a flat list of 100-250 observations.
const SITE_PARAMS=[[/^Diepte \(grond\)watertafel/,"groundwater_table_cm"],[/^Drainage Aardewerk - klasse/,"drainage_class"],[/^Bodemgebruik/,"land_use"],[/^Vegetatie/,"vegetation"],
  [/^Beworteling diepte/,"rooting_depth_cm"],[/^Reliëf - landvorm/,"landform"],[/^Reliëf - helling/,"slope"],[/^Geologische aard - lithologie laag 1/,"parent_material"],
  [/^Geologische aard - afzettingswijze laag 1/,"deposit"],[/^Geologische aard - tijdperk laag 1/,"age"],[/^Drainage Aardewerk-doorlaatbaarheid/,"permeability"]];
const HORIZON_PARAMS=[[/^Textuur - handmatig/,"texture_field"],[/^Mediaan van de textuurfracties/,"median_grain_um"],[/^Organische C - percentage/,"organic_carbon_pct"],[/^pH KCl/,"ph_kcl"],[/^pH H2O/,"ph_h2o"],
  [/^Calciumcarbonaatgehalte/,"caco3_pct"],[/^C\/N ratio/,"c_n_ratio"],[/^Sorptie totaal/,"cec_meq_100g"],[/^Kalkgehalte_beschrijvend/,"lime"],[/^Gley roest - aantal/,"mottling"],
  [/^Reductie in horizont/,"reduced"],[/^Horizontstructuur - type/,"structure"],[/^Consistentie$/,"consistence"],[/^Kleur omschrijving$/,"colour"],[/^Textuur - grove fractie/,"coarse_fraction_pct"]];
const label=v=>{const s=String(v??"").trim();const m=s.match(/^[A-Za-z0-9.]{1,6} - (.+)$/);return cut(m?m[1]:s,90)};
const valueOf=(o,key)=>/_cm$|_um$|_pct$|^ph_|_ratio$|_meq/.test(key)?(num(o.Waarde)===null?null:round(num(o.Waarde),2)):label(o.Waarde);
const munsell=g=>{const h=g["HUE_getal"],l=g["HUE_letters"],v=g["VALUE"],c=g["CHROMA"];return h!=null&&l&&v!=null&&c!=null?`${round(num(h),1)}${l} ${round(num(v),1)}/${round(num(c),1)}`:null};
export function summariseSoilProfile(intervals,observations){
  const site={},horizons=intervals.map(i=>({i,from:num(i.Bovengrens1),to:num(i.Ondergrens1),vals:{},mun:{}})).sort((a,b)=>(num(a.i.Nr)??0)-(num(b.i.Nr)??0));
  const byFiche=new Map(horizons.map(h=>[h.i.Diepteintervalfiche,h]));
  const forDepth=(dv,dt)=>{const a=num(dv),b=num(dt);if(a===null)return null;return horizons.find(h=>h.from!==null&&h.to!==null&&a>=h.from-0.5&&(b??a)<=h.to+0.5)||null};
  let other=0;
  for(const o of observations){
    const p=String(o.Parameter||"");
    if(o.Aan==="bodemlocatie"){const m=SITE_PARAMS.find(([re])=>re.test(p));if(m){const v=valueOf(o,m[1]);if(v!==null&&site[m[1]]===undefined)site[m[1]]=v}else other++;continue}
    const h=byFiche.get(o.Parentfiche)||forDepth(o.Diepte_van,o.Diepte_tot);if(!h){other++;continue}
    const mm=p.match(/^Kleur volgens Munsell - (HUE_getal|HUE_letters|VALUE|CHROMA) \(kleur1\)$/);if(mm){h.mun[mm[1]]=o.Waarde;continue}
    const m=HORIZON_PARAMS.find(([re])=>re.test(p));if(!m){other++;continue}
    const v=valueOf(o,m[1]);if(v!==null&&h.vals[m[1]]===undefined)h.vals[m[1]]=v;
  }
  return{site:clean(site),horizons:horizons.map(h=>clean({horizon:h.i.Naam&&h.i.Naam!=="-"?h.i.Naam:null,from_cm:h.from,to_cm:h.to,
    description:/^De beschrijving is/.test(h.i.Beschrijving||"")?null:cut(h.i.Beschrijving,200),munsell_colour:munsell(h.mun),...h.vals})),other_observations:other};
}
async function soilProfileRecord(client,key){
  const uri=DOV_ORIGIN+"/data/bodemlocatie/"+key;
  const meta=await wfsQuery(client,"bodem:bodemlocaties",{props:[...SOIL_LOC_PROPS,"Auteurs","rapport_bodemlocatie"],cql:`Bodemlocatiefiche='${uri}'`,count:1,ttl:DAY});
  if(meta.error)return{error:meta.error};
  const p=meta.rows[0];if(!p)return{error:"No public DOV soil profile bodemlocatie/"+key+"."};
  const [iv,cl,ob]=await Promise.all([
    wfsQuery(client,"bodem:bodemdiepteintervallen",{props:["Nr","Type","Naam","Diepteintervalfiche","Bovengrens1","Ondergrens1","Ondergrens_bereikt","Beschrijving"],cql:`Bodemlocatiefiche='${uri}'`,count:40,ttl:DAY}),
    wfsQuery(client,"bodem:bodemclassificaties",{props:["Classificatietype","Bodemtype"],cql:`Bodemlocatiefiche='${uri}'`,count:10,ttl:DAY}),
    // by point, then filtered on the profile: a filter on the profile id alone takes DOV several seconds, the point query a fraction of that
    wfsQuery(client,"bodem:bodemobservaties",{props:["Aan","Parentfiche","Parameter","Waarde","Eenheid","Diepte_van","Diepte_tot","Bodemlocatiefiche"],cql:`DWITHIN(geom,POINT(${p.X_mL72} ${p.Y_mL72}),1,meters)`,count:600,ttl:DAY})
  ]);
  const classifications=(cl.rows||[]).map(c=>clean({system:c.Classificatietype,code:c.Bodemtype}));
  // a Belgian soil-classification code (e.g. Zcg) is decoded with the soil map's own legend for that code
  const belgian=classifications.find(c=>/Belgische/.test(c.system||"")&&/^[A-Za-z(]/.test(c.code||""));
  if(belgian){
    const lg=await wfsQuery(client,"bodemkaart:bodemtypes",{props:["Bodemtype","Textuurklasse","Drainageklasse","Profielontwikkelingsgroep","Beknopte_omschrijving_bodemserie"],cql:`Bodemtype='${belgian.code.replace(/'/g,"''")}'`,count:1,ttl:7*DAY});
    const m=lg.rows?.[0];if(m)Object.assign(belgian,clean({texture:m.Textuurklasse,drainage:m.Drainageklasse,profile:m.Profielontwikkelingsgroep,series:m.Beknopte_omschrijving_bodemserie}));
  }
  const s=summariseSoilProfile(iv.rows||[],(ob.rows||[]).filter(o=>o.Bodemlocatiefiche===uri));
  return clean({id:"bodemlocatie/"+key,kind:"soil profile",name:p.Naam,type:p.Type,date:p.Datum,purpose:p.Doel,authors:p.Auteurs,region:p.Bodemstreek,site_group:p.Bodemsite,
    x_lambert72:num(p.X_mL72),y_lambert72:num(p.Y_mL72),ground_level_m_taw:num(p.mv_mTAW),
    classification:classifications,site:s.site,horizons:s.horizons,other_observations:s.other_observations||null,
    errors:[iv.error,cl.error,ob.error].filter(Boolean),
    report:p.rapport_bodemlocatie,profile_sheet:p.profielbeschrijving,url:uri,
    note:"Soil depths are centimetres below the surface. Field descriptions are as recorded at the survey date (many profiles are from the 1950s-1970s national soil survey); land use may have changed since. Lab values come from samples of the horizon at that depth.",
    provenance:provenance(["Bodemlocaties, bodemdiepteintervallen en bodemobservaties","Bodemkaart (legende)"])});
}

// ---------- get_subsurface_record ----------
/** Parse a record id: 'boring/2021-183767', a DOV URI for it, or the same for sondering, filter and interpretatie. */
export function parseRecordId(raw){
  const s=String(raw||"").trim().slice(0,200).replace(/\.(xml|json|html)$/i,"").replace(/\/+$/,"");
  const m=s.match(/^(?:https?:\/\/(?:www\.)?dov\.vlaanderen\.be\/data\/)?(boring|sondering|filter|interpretatie|bodemlocatie)\/(\d{4}-\d{6})$/i);
  return m?{kind:m[1].toLowerCase(),key:m[2]}:null;
}

// Minimal XML reader for DOV's flat interpretation export: leaf values under each repeated <laag>, with dotted paths for nesting.
const ENT={amp:"&",lt:"<",gt:">",quot:'"',apos:"'"};
const unent=s=>s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi,(m,e)=>e[0]==="#"?String.fromCodePoint(e[1]==="x"||e[1]==="X"?parseInt(e.slice(2),16):Number(e.slice(1))):ENT[e]??m);
export function xmlLayers(xml){
  const out=[];
  for(const m of String(xml).matchAll(/<laag>([\s\S]*?)<\/laag>/g)){
    const row={},stack=[];let last=null;
    for(const t of m[1].matchAll(/<(\/?)([A-Za-z_][\w.-]*)[^>]*?(\/?)>|([^<]+)/g)){
      if(t[4]!==undefined){if(last&&t[4].trim())last.text+=t[4];continue}
      if(t[3])continue;
      if(!t[1]){stack.push(t[2]);last={path:stack.join("."),text:""};continue}
      if(last&&stack.join(".")===last.path){const k=last.path,v=unent(last.text.trim());if(v)row[k]=row[k]?row[k]+"; "+v:v}
      stack.pop();last=null;
    }
    out.push(row);
  }
  return out;
}
const XSD_CACHE=new Map();
async function codeList(client,file,type){
  const ck=file+"#"+type;if(XSD_CACHE.has(ck))return XSD_CACHE.get(ck);
  const r=await client.get(XSD+file+".xsd",{maxBytes:256*1024,ttl:7*DAY});
  if(r.error)return null;
  const block=r.text.match(new RegExp('<xs:simpleType name="'+type+'"[\\s\\S]*?</xs:simpleType>'))?.[0]||"";
  const map=new Map();for(const e of block.matchAll(/<xs:enumeration value="([^"]*)">[\s\S]*?<xs:documentation>([^<]*)<\/xs:documentation>/g))map.set(e[1],unent(e[2]).trim());
  XSD_CACHE.set(ck,map);return map;
}
const INTERPRETATIONS={
  formelestratigrafie:{flag:"formele_stratigrafie",layer:"interpretaties:formele_stratigrafie",label:"formal stratigraphy",xsd:["FormeleStratigrafieDataCodes","FormeleStratigrafieLedenEnumType"],coded:["lid1","lid2"]},
  hydrogeologischeinterpretatie:{flag:"hydrogeologische_stratigrafie",layer:"interpretaties:hydrogeologische_stratigrafie",label:"hydrogeological stratigraphy (HCOV)",xsd:["HydrogeologischeStratigrafieDataCodes","AquiferHCOVv1EnumType"],coded:["aquifer"]},
  lithologischebeschrijving:{flag:"lithologische_beschrijving",layer:"interpretaties:lithologische_beschrijvingen",label:"lithological description (as logged)"},
  gecodeerdelithologie:{flag:"gecodeerde_lithologie",layer:"interpretaties:gecodeerde_lithologie",label:"coded lithology",xsd:["GecodeerdeLithologieDataCodes","GecodeerdHoofdnaamCodesEnumType"],coded:["hoofdnaam.grondsoort","bijmenging.grondsoort"]},
  quartairstratigrafie:{flag:"quartaire_stratigrafie",layer:"interpretaties:quartaire_stratigrafie",label:"Quaternary stratigraphy",xsd:["QuartairStratigrafieDataCodes","QuartairStratigrafieLedenEnumType"],coded:["lid1","lid2"]},
  informelestratigrafie:{flag:"informele_stratigrafie",layer:"interpretaties:informele_stratigrafie",label:"informal stratigraphy"},
  geotechnischecodering:{flag:"geotechnische_codering",layer:"interpretaties:geotechnische_coderingen",label:"geotechnical coding",xsd:["GecodeerdeLithologieDataCodes","GecodeerdHoofdnaamCodesEnumType"],coded:["hoofdnaam.grondsoort","bijmenging.grondsoort"]},
  informelehydrogeologischestratigrafie:{flag:"informele_hydrostratigrafie",layer:"interpretaties:informele_hydrogeologische_stratigrafie",label:"informal hydrogeological stratigraphy"}
};
// Detailed first: formal stratigraphy and the logged description answer "what is under here"; the rest are listed by id.
const DETAIL_ORDER=["formelestratigrafie","lithologischebeschrijving","hydrogeologischeinterpretatie","gecodeerdelithologie","quartairstratigrafie","informelestratigrafie","geotechnischecodering","informelehydrogeologischestratigrafie"];
const DETAILED=2;

async function readInterpretation(client,key){
  const r=await client.get(EXPORT+"/interpretatie/"+key,{maxBytes:1<<20,ttl:DAY});
  if(r.error)return{error:r.error};
  const typeTag=r.text.match(/<interpretaties>\s*<([a-z]+)>/)?.[1]||null,cfg=INTERPRETATIONS[typeTag]||{label:typeTag||"interpretation"};
  const head=r.text.slice(0,r.text.search(/<laag>|$/));
  const pick=tag=>unent(head.match(new RegExp("<"+tag+">([^<]*)</"+tag+">"))?.[1]||"").trim()||null;
  let layers=xmlLayers(r.text);
  const total=layers.length;layers=layers.slice(0,MAX_LAYERS);
  const codes=cfg.xsd?await codeList(client,...cfg.xsd):null;
  const rows=layers.map(l=>{
    const row={from_m:num(l.van),to_m:num(l.tot)};
    for(const [k,v] of Object.entries(l)){
      if(k==="van"||k==="tot")continue;
      const name=k.replace(/^hoofdnaam\.grondsoort$/,"main_soil").replace(/^bijmenging\./,"admixture_").replace(/^beschrijving$/,"description");
      row[name]=cut(v);
      if(codes&&cfg.coded?.includes(k)){const label=v.split("; ").map(c=>codes.get(c)).filter(Boolean).join("; ");if(label)row[name+"_meaning"]=label}
    }
    return row;
  });
  return clean({id:"interpretatie/"+key,type:cfg.label,borehole:pick("boring")||pick("sondering"),date:pick("datum"),reliability:pick("betrouwbaarheid"),
    layers:rows,layers_omitted:total>rows.length?total-rows.length:null,url:DOV_ORIGIN+"/data/interpretatie/"+key,
    codes_note:cfg.xsd?(codes?"Codes are decoded with DOV's published code list.":"DOV's code list could not be read; codes are shown raw."):null});
}

async function boreholeRecord(client,key){
  const uri=DOV_ORIGIN+"/data/boring/"+key;
  const meta=await wfsQuery(client,"dov-pub:Boringen",{props:["boornummer","fiche","rapport","diepte_tot_m","datum_aanvang","uitvoerder","doel","methode","X_mL72","Y_mL72","Z_mTAW",...BOREHOLE_FLAGS],cql:`fiche='${uri}'`,count:1,ttl:DAY});
  if(meta.error)return{error:meta.error};
  const p=meta.rows[0];if(!p)return{error:"No public DOV borehole boring/"+key+"."};
  const kinds=DETAIL_ORDER.filter(t=>p[INTERPRETATIONS[t].flag]===true);
  const lists=await Promise.all(kinds.map(async t=>{
    const r=await wfsQuery(client,INTERPRETATIONS[t].layer,{props:["Interpretatiefiche","Datum","Betrouwbaarheid"],cql:`Proeffiche='${uri}'`,count:10,ttl:DAY});
    return(r.rows||[]).map(x=>({type:t,id:"interpretatie/"+permkeyOf(x.Interpretatiefiche),date:x.Datum||null,reliability:x.Betrouwbaarheid||null}))
      .sort((a,b)=>(b.reliability==="goed")-(a.reliability==="goed")||String(b.date||"").localeCompare(String(a.date||"")));
  }));
  // The first DETAILED types in full, one interpretation each. A type often has several (a full 1993 log and a 2004 revision of only
  // the bottom 10 m): of the two most reliable and recent, keep the one that describes the most depth.
  const covered=r=>(r.layers||[]).reduce((s,l)=>s+Math.max(0,(l.to_m??0)-(l.from_m??0)),0);
  const detailed=await Promise.all(lists.filter(l=>l.length).slice(0,DETAILED).map(async l=>{
    const first=await readInterpretation(client,l[0].id.split("/")[1]);
    if(l.length<2)return first;
    const second=await readInterpretation(client,l[1].id.split("/")[1]);
    return second.error||covered(second)<=covered(first)?first:second;
  }));
  const others=lists.flat().filter(i=>!detailed.some(d=>d.id===i.id)).map(i=>clean({id:i.id,type:INTERPRETATIONS[i.type].label,date:i.date,reliability:i.reliability}));
  return clean({id:"boring/"+key,kind:"borehole",name:p.boornummer,depth_m:num(p.diepte_tot_m),date:p.datum_aanvang,driller:p.uitvoerder,purpose:p.doel,method:p.methode,
    x_lambert72:num(p.X_mL72),y_lambert72:num(p.Y_mL72),ground_level_m_taw:num(p.Z_mTAW),
    interpretations:detailed,other_interpretations:others,
    no_interpretation:kinds.length?null:"DOV holds no layer description for this borehole; the borehole report may have one.",
    url:uri,report:p.rapport,
    note:"Depths are metres below ground level at the borehole (from_m/to_m). m TAW is height above Belgian ordnance datum. Old descriptions are as logged at the time.",
    provenance:provenance(["Boringen","Interpretaties"])});
}

const MONTHS=12;
export function summariseLevels(entries){
  const all=(entries||[]).map(e=>({date:String(e?.datum||"").slice(0,10),level:num(e?.peilMtaw),depth:num(e?.diepteTovReferentiepunt),ok:!/SLECHT|ONBETROUWBAAR/i.test(String(e?.betrouwbaarheid||""))}))
    .filter(e=>/^\d{4}-\d{2}-\d{2}$/.test(e.date)&&e.level!==null);
  // DOV sometimes lists the same reading twice (same day, same level): count it once.
  const seen=new Set();
  const good=all.filter(e=>e.ok).sort((a,b)=>a.date.localeCompare(b.date)).filter(e=>{const k=e.date+"|"+e.level;if(seen.has(k))return false;seen.add(k);return true});
  if(!good.length)return null;
  const lo=good.reduce((m,e)=>e.level<m.level?e:m),hi=good.reduce((m,e)=>e.level>m.level?e:m);
  const years=new Map();for(const e of good){const yv=e.date.slice(0,4);const a=years.get(yv)||{sum:0,n:0};a.sum+=e.level;a.n++;years.set(yv,a)}
  const yearly=[...years].sort((a,b)=>a[0].localeCompare(b[0])).slice(-15).map(([year,a])=>({year:Number(year),mean_m_taw:round(a.sum/a.n),measurements:a.n}));
  const last=good[good.length-1];
  return clean({measurements:good.length,excluded_unreliable:all.filter(e=>!e.ok).length||null,first_date:good[0].date,last_date:last.date,
    latest:{date:last.date,level_m_taw:round(last.level),depth_below_reference_m:round(last.depth)},
    lowest:{date:lo.date,level_m_taw:round(lo.level)},highest:{date:hi.date,level_m_taw:round(hi.level)},
    recent:good.slice(-MONTHS).map(e=>clean({date:e.date,level_m_taw:round(e.level),depth_below_reference_m:round(e.depth)})),
    yearly_means:yearly});
}

// ---------- groundwater quality of one screen ----------
// Samples are linked to their screen as '|filter:<permkey>|'; observations to their sample by its URI. Two rounds: the sample list,
// then (in parallel) every result of the latest sample and a trend of a few indicator parameters over the last TREND_SAMPLES samples.
const TREND_PARAMS=["Nitraat (NO3)","Chloriden (Cl)","Sulfaat (SO4)","Ammonium (NH4)","Elektrische geleidbaarheid (EC)","Zuurtegraad (pH)"];
const TREND_SAMPLES=20,MAX_RESULTS=120;
const result=o=>{const v=num(o.resultaat);return clean({value:v??cut(o.resultaat,40),unit:o.eenheid,below_detection_limit:o.detectieconditie==="<"?true:null,qualifier:o.detectieconditie&&o.detectieconditie!=="<"?o.detectieconditie:null})};
export async function groundwaterQuality(client,key){
  const s=await wfsQuery(client,"gw_meetnetten:grondwatermonsters",{props:["monster","monster_link","permkey_monster","bemonsteringsdatum","diepte_van_m","diepte_tot_m","aantal_observaties","bemonstering_door"],
    cql:`gekoppeld_aan='|filter:${key}|'`,count:TREND_SAMPLES,ttl:DAY,sortBy:"bemonsteringsdatum DESC"});
  if(s.error)return{error:s.error};
  if(!s.rows.length)return null;
  const samples=s.rows.filter(r=>r.monster_link).sort((a,b)=>String(b.bemonsteringsdatum).localeCompare(String(a.bemonsteringsdatum)));
  const latest=samples[0];
  const links=samples.map(r=>"'"+r.monster_link+"'").join(",");
  const [obs,trend]=await Promise.all([
    wfsQuery(client,"gw_meetnetten:grondwaterobservaties",{props:["parameter","parametergroep","resultaat","eenheid","detectieconditie"],cql:`gekoppeld_aan_link='${latest.monster_link}'`,count:MAX_RESULTS,ttl:DAY}),
    wfsQuery(client,"gw_meetnetten:grondwaterobservaties",{props:["gekoppeld_aan_link","parameter","resultaat","eenheid","detectieconditie","fenomeentijd"],
      cql:`gekoppeld_aan_link IN (${links}) AND parameter IN (${TREND_PARAMS.map(p=>"'"+p+"'").join(",")})`,count:TREND_SAMPLES*TREND_PARAMS.length,ttl:DAY})
  ]);
  const dateOf=new Map(samples.map(r=>[r.monster_link,r.bemonsteringsdatum]));
  const trends={};
  for(const o of trend.rows||[]){const t=trends[o.parameter]||(trends[o.parameter]={unit:o.eenheid,values:[]});t.values.push(clean({date:String(o.fenomeentijd||dateOf.get(o.gekoppeld_aan_link)||"").slice(0,10),...result(o),unit:undefined}))}
  for(const t of Object.values(trends))t.values.sort((a,b)=>a.date.localeCompare(b.date));
  const groups=new Map();
  for(const o of (obs.rows||[]).sort((a,b)=>String(a.parametergroep).localeCompare(String(b.parametergroep))||String(a.parameter).localeCompare(String(b.parameter)))){
    const g=String(o.parametergroep||"Overig").replace(/\s+/g," ").trim();if(!groups.has(g))groups.set(g,[]);groups.get(g).push({parameter:o.parameter,...result(o)});
  }
  return clean({samples_shown:samples.length,
    latest_sample:clean({id:"monster/"+(latest.permkey_monster||permkeyOf(latest.monster_link)),name:latest.monster,date:latest.bemonsteringsdatum,sampled_by:latest.bemonstering_door,
      results:groups.size?Object.fromEntries(groups):null,results_error:obs.error||null,url:latest.monster_link}),
    trends:Object.keys(trends).length?trends:null,trends_error:trend.error||null,
    context:"For comparison: 50 mg/l nitrate is both the EU drinking-water limit and the EU groundwater quality standard. Values are as reported by the lab; below_detection_limit means the value is the detection limit, not a measurement."});
}

async function filterRecord(client,key){
  const uri=DOV_ORIGIN+"/data/filter/"+key;
  const [meta,data,quality]=await Promise.all([
    wfsQuery(client,"gw_meetnetten:grondwaterlocaties",{props:["GW_ID","filternummer","putfiche","X_mL72","Y_mL72","Z_mTAW","onderkant_filter_m","lengte_filter_m","Aquifer_HCOVv2","grondwaterlichaam","filtertype","meetnet","beheerder","datum_in_filter","datum_uit_filter","filtergrafiek","kwaliteitsmetingen_van","kwaliteitsmetingen_tot"],cql:`filterfiche='${uri}'`,count:1,ttl:DAY}),
    getJson(client,EXPORT+"/json/filter/"+key,{maxBytes:3<<20,ttl:6*HOUR}),
    groundwaterQuality(client,key)
  ]);
  const p=meta.rows?.[0];
  if(!p&&data.error)return{error:data.status===404?"No public DOV groundwater screen filter/"+key+".":"DOV could not return filter/"+key+": "+(meta.error||data.error)};
  const fm=data.json?.filtermeting?.[0];
  const levels=fm?summariseLevels(fm.peilmetingOrWaarnemingOrOnderkantPeilbuis):null;
  const ref=(fm?.referentiepunt||[]).filter(r=>r?.datum).sort((a,b)=>String(b.datum).localeCompare(String(a.datum)))[0];
  const f=data.json?.filter?.[0];
  return clean({id:"filter/"+key,kind:"groundwater screen",well:p?.GW_ID||f?.grondwaterlocatie,screen:p?.filternummer||f?.identificatie,
    x_lambert72:num(p?.X_mL72),y_lambert72:num(p?.Y_mL72),ground_level_m_taw:num(p?.Z_mTAW),
    screen_bottom_m:num(p?.onderkant_filter_m),screen_length_m:num(p?.lengte_filter_m),aquifer:p?.Aquifer_HCOVv2,groundwater_body:p?.grondwaterlichaam,
    regime:f?.ligging?.regime?.toLowerCase?.(),screen_type:p?.filtertype,network:p?.meetnet,manager:p?.beheerder,in_use:p?.datum_in_filter?(p.datum_in_filter+" to "+(p.datum_uit_filter||"now")):null,
    reference_point:ref?clean({type:ref.referentie,height_m_taw:num(ref.meetpunt),since:ref.datum}):null,
    water_levels:levels||(data.error?{error:data.error}:{note:"No water-level measurements are published for this screen."}),
    quality_samples:p?.kwaliteitsmetingen_van?p.kwaliteitsmetingen_van+" to "+(p.kwaliteitsmetingen_tot||"?"):null,
    groundwater_quality:quality,
    graph:p?.filtergrafiek,url:uri,
    note:"Levels are in m TAW (height above Belgian ordnance datum); depth_below_reference_m is measured from the reference point (usually ground level or the top of the tube). Values are as published by DOV; unreliable readings are excluded.",
    provenance:provenance(quality&&!quality.error?["Grondwatermeetnetten","Grondwatermonsters en -observaties"]:["Grondwatermeetnetten"])});
}

// ---------- CPT profile and soil behaviour type ----------
// Robertson (2010) non-normalised soil behaviour type index: Isbt = sqrt((3.47 - log10(qc/pa))^2 + (log10(Rf) + 1.22)^2), with pa = 0.1 MPa
// and Rf = fs/qc in %. DOV publishes qc in MPa and fs in kPa. Zones 1, 8 and 9 of the chart are not identified by the index.
const SBT=[[1.31,"gravelly sand to dense sand"],[2.05,"sand: clean sand to silty sand"],[2.6,"sand mixture: silty sand to sandy silt"],[2.95,"silt mixture: clayey silt to silty clay"],[3.6,"clay: silty clay to clay"],[Infinity,"organic soil: peat"]];
export function isbt(qcMpa,fsKpa){
  if(!(qcMpa>0)||!(fsKpa>0))return null;
  const rf=fsKpa/(qcMpa*1000)*100;
  return Math.sqrt((3.47-Math.log10(qcMpa/0.1))**2+(Math.log10(rf)+1.22)**2);
}
export const sbtClass=i=>i==null?null:SBT.find(([max])=>i<max)[1];
const median=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
/** Per metre: mean and maximum cone resistance, mean sleeve friction and friction ratio, and the soil behaviour type when fs is measured. */
export function cptProfile(meetdata){
  const bins=new Map();
  for(const m of meetdata||[]){
    const z=num(m?.diepte??m?.lengte),qc=num(m?.qc);if(z===null||qc===null||qc<0)continue;
    const k=Math.floor(z),b=bins.get(k)||{qc:[],fs:[],ic:[]};
    b.qc.push(qc);const fs=num(m?.fs);if(fs!==null&&fs>=0){b.fs.push(fs);const i=isbt(qc,fs);if(i!==null)b.ic.push(i)}
    bins.set(k,b);
  }
  return[...bins].sort((a,b)=>a[0]-b[0]).slice(0,MAX_LAYERS).map(([k,b])=>{
    const qcMean=b.qc.reduce((s,v)=>s+v,0)/b.qc.length,fsMean=b.fs.length?b.fs.reduce((s,v)=>s+v,0)/b.fs.length:null,ic=median(b.ic);
    return clean({from_m:k,to_m:k+1,qc_mean_mpa:round(qcMean),qc_max_mpa:round(Math.max(...b.qc)),fs_mean_kpa:fsMean===null?null:round(fsMean,1),
      friction_ratio_pct:fsMean!==null&&qcMean>0?round(fsMean/(qcMean*1000)*100,2):null,isbt:round(ic),soil_behaviour:sbtClass(ic)});
  });
}

async function cptRecord(client,key){
  const uri=DOV_ORIGIN+"/data/sondering/"+key;
  const [meta,data]=await Promise.all([
    wfsQuery(client,"dov-pub:Sonderingen",{props:["sondeernummer","fiche","weerstandsdiagram","diepte_tot_m","datum_aanvang","uitvoerder","sondeermethode","apparaat_type","conus","X_mL72","Y_mL72","Z_mTAW"],cql:`fiche='${uri}'`,count:1,ttl:DAY}),
    getJson(client,EXPORT+"/json/sondering/"+key,{maxBytes:3<<20,ttl:DAY})
  ]);
  const p=meta.rows?.[0];
  if(!p&&data.error)return{error:data.status===404?"No public DOV cone penetration test sondering/"+key+".":"DOV could not return sondering/"+key+": "+(meta.error||data.error)};
  const s=data.json?.sondering?.[0],md=s?.sondeonderzoek?.penetratietest?.meetdata||[];
  // Per metre: maximum and mean cone resistance qc (MPa) and, when measured, mean sleeve friction fs; a compact profile instead of every reading.
  const profile=cptProfile(md);
  const sbt=profile.some(r=>r.soil_behaviour);
  return clean({id:"sondering/"+key,kind:"cone penetration test",name:p?.sondeernummer||s?.sondeernummer,depth_m:num(p?.diepte_tot_m),date:p?.datum_aanvang||s?.datumAanvang,contractor:p?.uitvoerder,method:p?.sondeermethode,
    device:p?.apparaat_type,cone:p?.conus,x_lambert72:num(p?.X_mL72),y_lambert72:num(p?.Y_mL72),ground_level_m_taw:num(p?.Z_mTAW),
    readings:md.length||null,profile_per_metre:profile,soil_at_cone:s?.visueelonderzoek?.grondsoortConus,
    profile_error:data.error||null,diagram:p?.weerstandsdiagram,url:uri,
    note:"qc is cone resistance in MPa and fs sleeve friction in kPa (DOV's units), depth in metres below ground. "+(sbt
      ?"soil_behaviour is the Robertson (2010) soil behaviour type from the median index Isbt per metre (qc used for qt, no pore-pressure correction): it describes how the soil behaves under the cone, not a laboratory soil classification."
      :"This CPT has no sleeve friction, so no soil behaviour type can be derived; read it with nearby boreholes."),
    provenance:provenance(["Sonderingen"])});
}

export async function getSubsurfaceRecord(client,args){
  const id=parseRecordId(args?.id);
  if(!id)return{error:"Pass an id from subsurface_at_location, e.g. 'boring/2021-183767', 'filter/2019-108888', 'sondering/1965-037975', 'interpretatie/2016-252393' or 'bodemlocatie/1964-007478' (a DOV URL for one of these also works)."};
  let r;
  if(id.kind==="boring")r=await boreholeRecord(client,id.key);
  else if(id.kind==="filter")r=await filterRecord(client,id.key);
  else if(id.kind==="sondering")r=await cptRecord(client,id.key);
  else if(id.kind==="bodemlocatie")r=await soilProfileRecord(client,id.key);
  else{
    r=await readInterpretation(client,id.key);
    if(r.error)return{error:r.error.includes("404")?"No public DOV interpretation interpretatie/"+id.key+".":r.error};
    r={...r,provenance:provenance(["Interpretaties"])};
  }
  if(r.error)return r;
  const facts=recordFacts(r);
  return facts.length?{key_facts:facts,...r}:r;
}

// ---------- key facts for one record: the conclusion first, built only from fields in the same answer ----------
const layerName=l=>l.lid1_meaning||l.aquifer_meaning||l.main_soil_meaning||l.description||l.lid1||l.aquifer||l.main_soil||"?";
function layerLine(interp,max=6){
  // merge consecutive layers with the same name (a 0-3 / 3-6 / 6-9 log of the same sand is one unit)
  const out=[];for(const l of interp.layers||[]){const n=cut(layerName(l),60),last=out.at(-1);if(last&&last.n===n&&last.to===l.from_m)last.to=l.to_m;else out.push({n,from:l.from_m,to:l.to_m})}
  return out.slice(0,max).map(u=>u.from+"–"+u.to+" m "+u.n).join("; ")+(out.length>max?"; then "+(out.length-max)+" more":"");
}
export function recordFacts(r){
  const f=[];
  if(r.kind==="borehole"){
    f.push("Borehole "+(r.name||r.id)+(r.depth_m!=null?", "+r.depth_m+" m deep":"")+(r.date?", drilled "+r.date:"")+(r.purpose?" ("+r.purpose.toLowerCase()+")":"")+".");
    for(const i of r.interpretations||[])if(i.layers?.length)f.push(i.type[0].toUpperCase()+i.type.slice(1)+(i.date?" ("+i.date+")":"")+": "+layerLine(i)+".");
    if(r.no_interpretation)f.push(r.no_interpretation);
  }else if(r.kind==="groundwater screen"){
    const w=r.water_levels;
    if(w?.latest){
      const g=r.ground_level_m_taw,ref=r.reference_point;
      const below=ref?.type==="MAAIVELD"?w.latest.depth_below_reference_m:(g!=null?round(g-w.latest.level_m_taw,2):null);
      f.push("Latest water level "+w.latest.level_m_taw+" m TAW on "+w.latest.date+(below!=null?", about "+below+" m below ground":"")+" (screen bottom "+(r.screen_bottom_m??"?")+" m, "+(r.aquifer||"aquifer unknown")+").");
      const ys=(w.yearly_means||[]).map(y=>y.mean_m_taw);
      // a plain difference from the long-term average, not a "low/high" verdict: levels move with the seasons, and a spring reading
      // compared with yearly means would mislead
      if(ys.length>=5){const avg=ys.reduce((s,v)=>s+v,0)/ys.length,d=round(w.latest.level_m_taw-avg,2);
        f.push("The latest reading is "+Math.abs(d)+" m "+(d<0?"below":"above")+" the average of the yearly means since "+w.yearly_means[0].year+" ("+round(avg,2)+" m TAW; yearly means ranged "+Math.min(...ys)+"–"+Math.max(...ys)+"); record low "+w.lowest.level_m_taw+" ("+w.lowest.date+"), record high "+w.highest.level_m_taw+" ("+w.highest.date+"). Levels vary with the season.")}
    }
    const q=r.groundwater_quality,no3=q?.trends?.["Nitraat (NO3)"]?.values;
    if(no3?.length){const last=no3.at(-1),max=no3.reduce((m,v)=>v.value>m.value?v:m);
      f.push("Nitrate "+last.value+" mg/l on "+last.date+" ("+(last.below_detection_limit?"below the detection limit":last.value>50?"above":"below")+" the 50 mg/l standard); highest "+max.value+" mg/l in "+max.date.slice(0,4)+" over "+no3.length+" samples.")}
    else if(q?.latest_sample)f.push("Latest groundwater sample "+q.latest_sample.date+".");
  }else if(r.kind==="cone penetration test"){
    f.push("CPT "+(r.name||r.id)+(r.depth_m!=null?" to "+r.depth_m+" m":"")+(r.date?", "+r.date:"")+(r.method?" ("+r.method+")":"")+".");
    const rows=r.profile_per_metre||[];
    if(rows.some(x=>x.soil_behaviour)){
      const iv=[];for(const x of rows){const c=x.soil_behaviour?.split(":")[0]||"no class",l=iv.at(-1);if(l&&l.c===c&&l.to===x.from_m){l.to=x.to_m;l.q.push(x.qc_mean_mpa)}else iv.push({c,from:x.from_m,to:x.to_m,q:[x.qc_mean_mpa]})}
      f.push("Soil behaviour (Robertson): "+iv.slice(0,8).map(v=>v.from+"–"+v.to+" m "+v.c+" (qc ~"+round(v.q.reduce((s,a)=>s+a,0)/v.q.length,1)+" MPa)").join("; ")+(iv.length>8?"; …":"")+".");
    }else if(rows.length){const strong=rows.find(x=>x.qc_mean_mpa>=10);f.push(strong?"Cone resistance first reaches 10 MPa (typically dense sand) at about "+strong.from_m+" m.":"Cone resistance stays below 10 MPa over the whole test.")}
  }else if(r.kind==="soil profile"){
    const c=r.classification||[],be=c.find(x=>/Belgische/.test(x.system||"")),wrb=c.find(x=>/WRB/.test(x.system||""));
    f.push("Soil profile "+(r.name||r.id)+(r.date?" ("+r.date+")":"")+(be?": Belgian type "+be.code+(be.series?" – "+be.series:""):"")+(wrb?"; WRB "+wrb.code:"")+".");
    const s=r.site||{};const site=[s.groundwater_table_cm!=null?"groundwater table "+s.groundwater_table_cm+" cm":null,s.drainage_class?"drainage "+s.drainage_class:null,s.land_use?"land use then: "+s.land_use:null,s.parent_material?"parent material "+s.parent_material+(s.deposit?" ("+s.deposit+")":""):null].filter(Boolean);
    if(site.length)f.push(site.join("; ")+".");
    const top=(r.horizons||[])[0];
    if(top)f.push("Topsoil "+(top.horizon||"")+" "+top.from_cm+"–"+top.to_cm+" cm"+(top.texture_field?", "+top.texture_field.toLowerCase():"")+(top.organic_carbon_pct!=null?", organic C "+top.organic_carbon_pct+" %":"")+(top.ph_kcl!=null?", pH-KCl "+top.ph_kcl:"")+(top.munsell_colour?", colour "+top.munsell_colour:"")+".");
  }else if(r.layers){f.push((r.type||"Interpretation")+(r.borehole?" of "+r.borehole:"")+": "+layerLine(r,10)+".")}
  return f;
}

// Internals shared with dov-search.mjs (one module per tool family; the request guards stay in this file).
export const _dov={wfsQuery,getJson,resolveLocation,codeList,clean,num,round,cut,permkeyOf,provenance,byDistance,present,NEARBY,PERMIT_PROPS,permitView,SOIL_LOC_PROPS,soilLocView,fmtM3,DAY,HOUR,MAX_POINTS};
