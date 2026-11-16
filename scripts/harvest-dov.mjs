// DOV (Databank Ondergrond Vlaanderen) publishes ~4,300 OGC API Features collections. About 3,900 of them are the layers of a
// handful of 3D subsurface models (one per geological unit x layer type x model version) and of one map series. Listed one by
// one they would bury every other dataset in search, so each model version or series becomes ONE catalogue record that names
// its layers; the remaining ~400 collections (PFAS, erosion, extraction permits, groundwater policy zones, soil, ...) stay
// individual records.

export const DOV_LICENSE="modellicentie-gratis-hergebruik/v1.0";
const DOV_BASE="https://www.dov.vlaanderen.be/geoserver/ogc/features/v1";

// namespace (the part of the collection id before ":") -> series; `by` splits one namespace into several series by title
export const DOV_SERIES={
  g3dv3_1:{title:"G3Dv3.1 – Geologisch 3D-model van de Vlaamse ondergrond, versie 3.1",model:"geologisch"},
  g3dv3:{title:"G3Dv3 – Geologisch 3D-model van de Vlaamse ondergrond, versie 3",model:"geologisch",successor:"G3Dv3.1"},
  g3dv2:{title:"G3Dv2 – Geologisch 3D-model van de Vlaamse ondergrond, versie 2",model:"geologisch",successor:"G3Dv3.1"},
  h3dv2_1:{title:"H3Dv2.1 – Hydrogeologisch 3D-model van de Vlaamse ondergrond, versie 2.1",model:"hydrogeologisch"},
  h3d:{title:"H3Dv2 – Hydrogeologisch 3D-model van de Vlaamse ondergrond, versie 2",model:"hydrogeologisch",successor:"H3Dv2.1"},
  h3o:{by:t=>String(t).split(" - ")[0].trim(),titles:{
    "H3O-De Kempen":"H3O-De Kempen – geologisch en hydrogeologisch 3D-model van de Kempen",
    "H3O-Roerdalslenk":"H3O-Roerdalslenk – geologisch en hydrogeologisch 3D-model van de Roerdalslenk"},model:"H3O",blurb:false},
  h3o_vk:{title:"H3O-De Voorkempen – geologisch en hydrogeologisch 3D-model van de Voorkempen",model:"H3O",blurb:false},
  ondiepvoxelmodel:{title:"OAv1.1 – Ondiep geologisch 3D lagen- en voxelmodel van regio Antwerpen",model:"ondiep"},
  gmk:{title:"Grondmechanische kaarten van Vlaanderen (UGent, per kaartblad en plaat)",model:"kaartreeks"}
};

const clean=s=>String(s??"").replace(/\s+/g," ").trim();
const slugOf=s=>clean(s).normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");

// The part of a layer title after the model prefix: "G3Dv3 0305, isohypsen van top Fm van Borgloon" -> "isohypsen van top Fm van Borgloon",
// "H3O-De Kempen - Hydrogeologie- Breuken X" -> "Breuken X", "Grondmechanische kaart 15.3.5 Zwijndrecht-Zuid, Plaat VIII: Zonering" -> "Zonering".
const layerPart=title=>clean(String(title)
  .replace(/^H3O-[^-]+(-[^-\s][^-]*)?\s-\s(Geologie|Hydrogeologie|Algemene lagen)\s*-\s*/i,"")
  .replace(/^Grondmechanische kaart [^,]*,\s*Plaat [IVXL]+:\s*/i,"")
  .replace(/^(G3D|H3D|OA)v\d+(\.\d+)*(?:[ _]+[A-Z]?\d+[A-Z]?)*,?\s*/i,"")   // "G3Dv3.1 010101,", "G3Dv2_ 0101,", "G3Dv2_1000_1100_1200,"
  .replace(/\s*\((vector|raster)\)\s*$/i,""));
/** What a model layer shows, from its title. */
export function layerKind(title){
  const t=layerPart(title).toLowerCase();
  if(/^breuk/.test(t))return"breuken";
  if(/^(isohyps\w* van (de )?top|top van)/.test(t))return"top";
  if(/^(isohyps\w* van (de )?basis|basis van)/.test(t))return"basis";
  if(/^(isopach|dikte)/.test(t))return"dikte";
  if(/^boring/.test(t))return"boringen";
  if(/^sondering/.test(t))return"sonderingen";
  if(/^steunpunt/.test(t))return"steunpunten";
  if(/^voorkomen/.test(t))return"voorkomen";
  if(/^zonering/.test(t))return"zonering";
  return"overig";
}
/** The geological or hydrogeological unit a layer is about ("Fm van Borgloon", "Kiezeloöliet klei 1"), or null for general layers. */
export function layerUnit(title){
  const u=layerPart(title).replace(/^(breuken( in( de)? (top|basis))?( van( de)?)?|isohypsen van (de )?(top|basis)( van( de)?)?|(top|basis) van( de| het)?|isopachen( van( de)?)?|dikte( van( de| het)?)?|boringen( doorheen| met( basis| top)?( van)?)?( de)?|sonderingen( met)?|steunpunten|voorkomen( van)?( (de )?(basis|top))?|zonering)\s*/i,"").trim();
  return u&&u.length<=90&&/^[A-Z0-9À-Ý]/.test(u)&&!/^(aandachtspunten|modelgebied|inventarisatiegebied|overzicht|indexkaart|seismi|topografie|dem_|informele)/i.test(u)?u:null;
}
// Only plausible WGS84 boxes around Belgium: some collections declare CRS84 but give Lambert 72 metres.
const plausible=x=>Array.isArray(x)&&x.length>=4&&x.every(Number.isFinite)&&x[0]>=1&&x[2]<=8&&x[1]>=48&&x[3]<=54&&x[0]<x[2]&&x[1]<x[3];
export function unionBbox(cs){
  let b=null;
  for(const c of cs){const x=c.extent?.spatial?.bbox?.[0];if(!plausible(x))continue;
    b=b?[Math.min(b[0],x[0]),Math.min(b[1],x[1]),Math.max(b[2],x[2]),Math.max(b[3],x[3])]:x.slice(0,4)}
  return b&&b.map(v=>Math.round(v*1e4)/1e4);
}
// The shared model blurb: a layer's description minus its first sentence ("Deze laag geeft ... weer, zoals gedefinieerd in ...").
// A sentence ends at a full stop followed by a space and a capital, so "versie 3.1" and "(OA v1.1, 2023)" do not cut it.
export function blurb(cs){
  for(const c of cs){
    const d=clean(c.description),m=/^Deze (laag|puntenkaart|polygoon)\b.*?[.)]\s+(?=[A-Z])/.exec(d);
    const rest=m?d.slice(m[0].length):"";
    if(rest.length>60&&!/^Deze (laag|puntenkaart|polygoon)/.test(rest))return rest;
  }
  return"";
}
const KIND_NL={top:"top",basis:"basis",dikte:"dikte (isopachen)",boringen:"boringen",sonderingen:"sonderingen",steunpunten:"steunpunten",
  breuken:"breuken",voorkomen:"voorkomen",zonering:"zonering",overig:"overige lagen"};
const sheetOf=t=>(/^Grondmechanische kaart ([^,]+),/.exec(String(t))||[])[1]||null;

/** One catalogue record for a model version or map series. */
export function seriesRecord(key,title,cs,{base=DOV_BASE,timeStamp=null,successor=null,withBlurb=true}={}){
  const kinds={};for(const c of cs){const k=layerKind(c.title);kinds[k]=(kinds[k]||0)+1}
  const sheets=[...new Set(cs.map(c=>sheetOf(c.title)).filter(Boolean))];
  const units=sheets.length?[]:[...new Set(cs.map(c=>layerUnit(c.title)).filter(Boolean))];
  const counts=Object.entries(kinds).sort((a,b)=>(a[0]==="overig")-(b[0]==="overig")||b[1]-a[1]).map(([k,n])=>KIND_NL[k]+" "+n).join(", ");
  const head=cs.length+" kaartlagen (OGC API Features: GeoJSON, CSV): "+counts+"."
    +(sheets.length?" "+sheets.length+" kaartbladen, o.a. "+sheets.slice(0,6).join("; ")+".":"")
    +(units.length?" "+units.length+" eenheden, o.a. "+units.slice(0,6).join("; ")+".":"");
  const desc=clean((successor?"Vorige versie; opgevolgd door "+successor+". ":"")+head+" "+(withBlurb?blurb(cs):""));
  const layers=[...cs].sort((a,b)=>String(a.id).localeCompare(String(b.id))).map(c=>({id:c.id,title:clean(c.title)}));
  return{id:"harvest:dov:series:"+key,provider:"DOV — Databank Ondergrond Vlaanderen",platform:"OGC API Features",datasetId:key,title,
    description:desc.length>900?desc.slice(0,897).replace(/\s+\S*$/,"")+" …":desc,
    kind:"OGC feature collection series",formats:["OGC API Features","GeoJSON","CSV"],updatedAt:timeStamp,recordCount:null,
    fields:[],previewRows:[],schemaOrigin:"none",sampleOrigin:"none",
    extent:{spatial:unionBbox(cs),spatialCrs:"http://www.opengis.net/def/crs/OGC/1.3/CRS84",temporal:null},
    themes:["Ondergrond","Geologie",...(/hydro/i.test(title)?["Grondwater"]:[]),"3D-model"].filter((t,i,a)=>a.indexOf(t)===i&&!(t==="3D-model"&&/kaarten/i.test(title))),
    license:DOV_LICENSE,layerCount:cs.length,layers,successor:successor||undefined,
    officialUrl:"https://www.dov.vlaanderen.be/",
    // each layer's features as GeoJSON and CSV (DOV serves both per collection); the first few layers stand for the series
    distributions:layers.slice(0,4).flatMap(l=>{const u=base+"/collections/"+encodeURIComponent(l.id)+"/items?limit=20&f=";
      return[{name:l.title.slice(0,110)+" (GeoJSON)",format:"GeoJSON",url:u+"application%2Fgeo%2Bjson"},{name:l.title.slice(0,110)+" (CSV)",format:"CSV",url:u+"text%2Fcsv"}]})};
}

/** Split DOV's collections into series records and the collections that stay individual. */
export function groupDov(collections,{base=DOV_BASE,timeStamp=null}={}){
  const groups=new Map(),individual=[];
  for(const c of collections||[]){
    const ns=String(c.id||"").split(":")[0],s=DOV_SERIES[ns];
    if(!s){individual.push(c);continue}
    const sub=s.by?s.by(c.title):null,key=sub?ns+"-"+slugOf(sub):ns;
    const title=sub?(s.titles?.[sub]||sub):s.title;
    (groups.get(key)||groups.set(key,{title,successor:s.successor,withBlurb:s.blurb!==false,cs:[]}).get(key)).cs.push(c);
  }
  // a superseded version carries `successor`; the index ranks it just below its peers (build-mcp-index rankOf)
  const series=[...groups].map(([key,g])=>seriesRecord(key,g.title,g.cs,{base,timeStamp,successor:g.successor,withBlurb:g.withBlurb}));
  return{series,individual};
}
