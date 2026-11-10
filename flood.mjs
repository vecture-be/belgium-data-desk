// flood_risk: is a place in Flanders flood-prone, by the maps the law uses. VMM's 'overstromingsgevoelige gebieden' (fluvial, pluvial
// and from the sea) are the maps behind the flood information that must be given when a property in Flanders is sold or let, and
// behind the water test for permits. Each map classes a location A-D; the class is read here with one ArcGIS 'identify' per map.
// Licence: Flemish free-reuse model licence; source VMM (Vlaamse Milieumaatschappij), via waterinfo.be.
import { _dov } from "./dov.mjs";
import { placeContext } from "./place.mjs";
const {getJson,resolveLocation,clean,DAY}=_dov;

const BASE="https://inspirepub.waterinfo.be/arcgis/rest/services/informatieplicht/";
const MAPS=[["river","overstromingsgevoelige_gebieden_fluviaal","from rivers and watercourses (fluvial)"],
  ["rain","overstromingsgevoelige_gebieden_pluviaal","from heavy rain (pluvial)"],
  ["sea","overstromingsgevoelige_gebieden_vanuit_de_zee","from the sea"]];
// the classes and their Dutch labels exactly as in the services' legend (gridcode 0-3)
const CLASS=[["A","Geen overstroming gemodelleerd","no flooding modelled"],["B","Kleine kans op overstromingen onder klimaatverandering","small chance of flooding under climate change"],
  ["C","Kleine kans op overstromingen","small chance of flooding"],["D","Middelgrote kans op overstromingen","medium chance of flooding"]];

async function identify(client,service,x,y){
  const q=new URLSearchParams({geometry:x+","+y,geometryType:"esriGeometryPoint",sr:"31370",layers:"all",tolerance:"0",
    mapExtent:[x-50,y-50,x+50,y+50].join(","),imageDisplay:"100,100,96",returnGeometry:"false",f:"json"});
  const r=await getJson(client,BASE+service+"/MapServer/identify?"+q,{maxBytes:64*1024,ttl:7*DAY});
  if(r.error)return{error:r.error};
  if(r.json?.error)return{error:"VMM's map service answered: "+String(r.json.error.message||"error").slice(0,80)};
  // no feature at the point means class A (the maps only contain flood-prone areas); the highest class wins if polygons overlap
  const codes=(r.json?.results||[]).map(x=>Number(x.attributes?.gridcode)).filter(n=>n>=0&&n<=3);
  return{code:codes.length?Math.max(...codes):0};
}

export async function floodRisk(client,args,{assets}={}){
  const w=await resolveLocation(client,args);if(w.error)return{error:w.error.replace("which is the area DOV covers","which these maps cover"),...(w.location?{location:w.location}:{})};
  const loc=w.loc;
  const [res,place]=await Promise.all([Promise.all(MAPS.map(([,s])=>identify(client,s,Math.round(loc.x),Math.round(loc.y)))),placeContext(client,assets,loc).catch(()=>null)]);
  if(res.every(r=>r.error))return{error:"VMM's flood maps did not answer; try again in a minute.",location:loc};
  const maps=Object.fromEntries(MAPS.map(([k,,desc],i)=>{const r=res[i];if(r.error)return[k,{error:r.error}];const c=CLASS[r.code];return[k,{class:c[0],label_nl:c[1],meaning:c[2],flooding:desc}]}));
  const worst=Object.values(maps).filter(m=>m.class).sort((a,b)=>b.class.localeCompare(a.class))[0];
  const facts=[];
  const prone=Object.entries(maps).filter(([,m])=>m.class&&m.class!=="A");
  // Only claim what was checked: a map whose service did not answer rules nothing out.
  const failed=MAPS.filter(([k])=>maps[k].error),checked=MAPS.filter(([k])=>!maps[k].error);
  facts.push(prone.length?"Flood-prone by the official VMM maps: "+prone.map(([,m])=>"class "+m.class+" ("+m.meaning+") "+m.flooding).join("; ")+"."
    :!failed.length?"Not flood-prone on any of the three official VMM maps (class A: no flooding modelled from rivers, rain or the sea)."
    :"Not flood-prone on the VMM map"+(checked.length>1?"s":"")+" that answered (class A, no flooding modelled "+checked.map(([,,d])=>d).join(" or ")+").");
  if(failed.length)facts.push("Not checked: flooding "+failed.map(([,,d])=>d).join(" and ")+", because that map service did not answer; it is not ruled out. Try again later.");
  facts.push("These are the maps used for the legally required flood information when property in Flanders is sold or let, and for the water test; the official per-parcel (P) and per-building (G) scores are derived from them on waterinfo.vlaanderen.be.");
  return clean({key_facts:facts,location:clean({...loc,x_lambert72:loc.x,y_lambert72:loc.y,x:undefined,y:undefined,geocoded:undefined}),place,
    // the highest class is only known when every map answered, or when one that answered already shows a flood-prone class
    maps,highest_class:!failed.length||prone.length?worst?.class:undefined,...(failed.length?{complete:false}:{}),
    note:"Classes A-D as published by VMM: A no flooding modelled, B small chance under climate change, C small chance, D medium chance. The maps are modelled on a grid and describe the location, not a building's floor level, defences or insurance. A point on the edge of a zone can differ from the parcel score.",
    provenance:{source:"Vlaamse Milieumaatschappij (VMM), overstromingsgevoelige gebieden (informatieplicht)",licence:"Modellicentie Gratis Hergebruik (Flemish free-reuse model licence)",
      services:MAPS.map(([,s])=>BASE+s+"/MapServer"),citation:"VMM, overstromingsgevoelige gebieden fluviaal, pluviaal en vanuit de zee (informatieplicht), geraadpleegd op "+new Date().toISOString().slice(0,10)+", via waterinfo.be."}});
}
