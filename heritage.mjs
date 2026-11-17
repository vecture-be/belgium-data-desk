// heritage_at_location: which heritage designations apply at an address or point in Flanders, and what each one means for works and
// permits, from the Flemish heritage agency (Agentschap Onroerend Erfgoed), read through Mercator, the public map service of the
// Flemish Department of Environment. The agency's own geoserver says "not for public purposes, use Mercator".
//
// Sources, no key: www.mercator.vlaanderen.be/raadpleegdienstenmercatorpubliek/wfs (WFS 2.0, Gratis Open Data Licentie Vlaanderen v1.2)
//   legal designations (aanduidingsobjecten): protected monuments, town and village views, cultural-historical landscapes and
//   archaeological sites, their transition zones, UNESCO core and buffer zones, the fixed inventories (built heritage, landscape
//   heritage, landscape-atlas relics, archaeological zones), heritage landscapes and areas where no archaeology is expected;
//   the scientific inventory of built heritage (no legal effect) and ratified archaeology notes.
//
// What makes these answers true (and what the click-on-a-map portal leaves to the reader):
// - Protected (beschermd) and fixed (vastgesteld) are different legal statuses with different consequences; inventoried only
//   (wetenschappelijke inventaris) has no legal effect. Each designation is returned with what it means, not just its name.
// - Layers are stored partly in Lambert 72 and partly in Lambert 2008: the point is sent with its SRID, so GeoServer reprojects it
//   (a bare coordinate is read in the layer's own system and lands about 500 km off).
// - An address point is one point: a designation that covers only the neighbouring building or the far end of a large parcel is not
//   found, so protected monuments within 30 m are listed separately as nearby.
import { _dov } from "./dov.mjs";
import { placeContext } from "./place.mjs";
const {getJson,resolveLocation,clean,cut,DAY}=_dov;

export const MERCATOR="https://www.mercator.vlaanderen.be/raadpleegdienstenmercatorpubliek/wfs";
export const HERITAGE_HOSTS=Object.freeze(["www.mercator.vlaanderen.be"]);
const NEARBY_M=30,INVENTORY_M=15;

// [layer, kind, label, what it means]. Ordered from the strongest legal status down.
export const DESIGNATIONS=[
  ["ps:ps_bes_monument","protected_monument","Protected monument (beschermd monument)",
    "Legally protected. Works that change it need a permit or the heritage agency's permission, and the agency advises on them; the owner must keep it in good condition and may not damage or disfigure it. Heritage premiums can apply."],
  ["ps:ps_bes_arch_site","protected_archaeological_site","Protected archaeological site (beschermde archeologische site)",
    "Legally protected. Soil works and other works that can disturb the archaeology need the heritage agency's permission."],
  ["ps:ps_bes_sd_gezicht","protected_townscape","Protected town or village view (beschermd stads- of dorpsgezicht)",
    "Legally protected as an ensemble: works in it must respect the heritage values named in the protection decision, and the heritage agency advises on permit applications."],
  ["ps:ps_bes_land","protected_landscape","Protected cultural-historical landscape (beschermd cultuurhistorisch landschap)",
    "Legally protected as a landscape: works must respect the heritage values in the protection decision, and the heritage agency advises on permit applications."],
  ["ps:ps_bes_ovgzone","transition_zone","Transition zone around protected heritage (overgangszone)",
    "Some rules of the protection decision of the nearby protected heritage also apply here."],
  ["ps:ps_unesco_kern","unesco_core","UNESCO World Heritage core zone",
    "International recognition. The legal protection comes from the Flemish designations listed here; works are assessed with the World Heritage values in mind."],
  ["ps:ps_unesco_buffer","unesco_buffer","UNESCO World Heritage buffer zone",
    "Zone around a World Heritage site where developments are assessed for their effect on it; no protection of its own."],
  ["ps:ps_vast_be","fixed_built_heritage","Fixed inventory of built heritage (vastgesteld bouwkundig erfgoed)",
    "Not protected, but it has legal effects: the permit authority must take the heritage value into account, in particular before allowing demolition, and some energy and accessibility rules allow exceptions."],
  ["ps:ps_vast_le","fixed_landscape_heritage","Fixed inventory of landscape heritage (vastgesteld landschappelijk erfgoed)",
    "Not protected, but permit authorities must take its heritage value into account."],
  ["ps:ps_vast_la_rel","fixed_landscape_atlas_relic","Fixed landscape-atlas relic (vastgesteld landschapsatlasrelict)",
    "Not protected, but permit authorities must take its heritage value into account."],
  ["am:am_erfgls","heritage_landscape","Heritage landscape (erfgoedlandschap)",
    "Set in a spatial implementation plan: the plan's rules protect its heritage values."],
  ["ps:ps_vast_az","fixed_archaeological_zone","Fixed archaeological zone (vastgestelde archeologische zone)",
    "Archaeology is expected: a permit application with soil works needs an archaeology note (archeologienota) from a much smaller parcel and works size than elsewhere in Flanders."],
  ["am:am_gga_gew_pub","no_archaeology_expected","Area where no archaeology is expected (gebied waar geen archeologie te verwachten valt, regional)",
    "No archaeology note is needed for permit applications here."]
];
const BY_LAYER=new Map(DESIGNATIONS.map(d=>[d[0].split(":")[1],d]));
const PROTECTED=new Set(["protected_monument","protected_archaeological_site","protected_townscape","protected_landscape"]);
const DESIGNATION_PROPS="aanduid_id,naam,type_naam,locatie,geld_start,url";

const pt=(loc)=>"SRID=31370;POINT("+loc.x.toFixed(2)+" "+loc.y.toFixed(2)+")";
/** One WFS GetFeature with one query per layer (WFS 2.0 KVP: typeNames (a)(b), propertyName (..)(..), cql_filter a;b). */
async function features(client,queries,{count=60}={}){
  const q=new URLSearchParams({service:"WFS",version:"2.0.0",request:"GetFeature",outputFormat:"application/json",count:String(count),
    typeNames:queries.map(x=>"("+x.layer+")").join(""),propertyName:queries.map(x=>"("+x.props+")").join(""),cql_filter:queries.map(x=>x.cql).join(";")});
  const r=await getJson(client,MERCATOR+"?"+q,{maxBytes:512*1024,ttl:DAY});
  if(r.error)return r;
  if(!Array.isArray(r.json?.features))return{error:"Mercator answered without features"};
  return{rows:r.json.features.map(f=>({layer:String(f.id||"").replace(/\.[^.]*$/,""),p:f.properties||{}}))};
}

const placeText=s=>s?cut(s,240):null;
export function designationView(row){
  const d=BY_LAYER.get(row.layer);if(!d)return null;
  const p=row.p;
  return clean({kind:d[1],status:d[2],name:p.naam||null,id:p.aanduid_id??null,since:p.geld_start?String(p.geld_start).slice(0,10):null,
    address:placeText(p.locatie),means:d[3],url:/^https:\/\//.test(p.url||"")?p.url:null});
}
const NOTE_OUTCOME=[["opgraving","excavation"],["bh_in_situ","preserve in situ"],["uitg_vo","deferred preliminary research"],["mtrgl_geen","no further measures"]];
function archNoteView(p){
  return clean({name:p.naam?cut(p.naam,200):null,type:p.type_naam||null,date:p.datum_ind?String(p.datum_ind).slice(0,10):null,
    outcome:NOTE_OUTCOME.filter(([k])=>p[k]===true).map(([,v])=>v).join(", ")||null,url:/^https:\/\//.test(p.uri||"")?p.uri:null});
}

/** A municipality outside Flanders (NIS 21 Brussels; 25, 5x, 6x, 8x, 9x Wallonia) -> the sentence to answer instead, else null. */
export function outsideFlanders(place){
  const nis=String(place?.nis_code||"");
  if(!/^(21|25|5|6|8|9)/.test(nis))return null;
  return "This place is in "+(place.region||"another region")+" ("+(place.municipality||nis)+"), outside the Flemish heritage register. "+
    (/^21/.test(nis)?"Brussels heritage is listed by urban.brussels (monument.heritage.brussels).":"Walloon heritage is listed by the AWaP (Agence wallonne du Patrimoine).");
}

export async function heritageAtLocation(client,args,{assets}={}){
  const w=await resolveLocation(client,args);
  if(w.error)return{error:w.error.replace("which is the area DOV covers","which the Flemish heritage register covers"),...(w.location?{location:w.location}:{})};
  const loc=w.loc,at="INTERSECTS(geom,"+pt(loc)+")",near=m=>"DWITHIN(geom,"+pt(loc)+","+m+",meters)";
  const [legal,extra,place]=await Promise.all([
    features(client,DESIGNATIONS.map(([layer])=>({layer,props:DESIGNATION_PROPS,cql:at}))),
    features(client,[
      {layer:"lu:lu_wet_bk_el_pub",props:"erfgoed_id,naam,url,locatie,b_toestand",cql:near(INVENTORY_M)},
      {layer:"am:am_archnts",props:"naam,type_naam,datum_ind,mtrgl_geen,uitg_vo,bh_in_situ,opgraving,uri",cql:at},
      {layer:"ps:ps_bes_monument",props:"aanduid_id,naam,locatie,url",cql:near(NEARBY_M)}],{count:40}),
    placeContext(client,assets,loc).catch(()=>null)
  ]);
  // Brussels and Wallonia keep their own heritage registers; an empty answer there would wrongly read as "not heritage".
  const outside=outsideFlanders(place);if(outside)return{error:outside,place};
  if(legal.error)return{error:"Mercator (the Flemish heritage designations) did not answer: "+legal.error+"; try again in a minute.",retry_after_seconds:60};
  const designations=[],seen=new Set();
  for(const row of legal.rows){const v=designationView(row);if(!v)continue;const k=v.kind+"|"+(v.id??v.name);if(seen.has(k))continue;seen.add(k);designations.push(v)}
  designations.sort((a,b)=>DESIGNATIONS.findIndex(d=>d[1]===a.kind)-DESIGNATIONS.findIndex(d=>d[1]===b.kind));
  let inventory=[],notes=[],nearby=[];
  if(!extra.error){
    const atIds=new Set(designations.filter(d=>d.kind==="protected_monument").map(d=>d.id));
    inventory=extra.rows.filter(r=>r.layer==="lu_wet_bk_el_pub").map(r=>clean({name:r.p.naam||null,id:r.p.erfgoed_id??null,address:placeText(r.p.locatie),
      condition:r.p.b_toestand||null,url:/^https:\/\//.test(r.p.url||"")?r.p.url:null})).slice(0,8);
    notes=extra.rows.filter(r=>r.layer==="am_archnts").map(r=>archNoteView(r.p)).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))).slice(0,6);
    const nm=new Map();
    for(const r of extra.rows)if(r.layer==="ps_bes_monument"&&!atIds.has(r.p.aanduid_id)&&!nm.has(r.p.aanduid_id))
      nm.set(r.p.aanduid_id,clean({name:r.p.naam||null,id:r.p.aanduid_id??null,address:placeText(r.p.locatie),url:/^https:\/\//.test(r.p.url||"")?r.p.url:null}));
    nearby=[...nm.values()].slice(0,8);
  }
  const prot=designations.filter(d=>PROTECTED.has(d.kind));
  const legalEffect=designations.filter(d=>d.kind!=="no_archaeology_expected"&&d.kind!=="unesco_buffer");
  const where=loc.matched_address||loc.address||("The point "+(loc.latitude!=null?loc.latitude.toFixed(5)+", "+loc.longitude.toFixed(5):"given"));
  const facts=[];
  if(prot.length)facts.push(where+" lies in "+prot.map(d=>d.status.replace(/ \(.*$/,"").toLowerCase()+" '"+d.name+"'"+(d.since?" (since "+d.since+")":"")).join(" and ")+": legally protected heritage, so works need the heritage agency's permission or advice.");
  else if(legalEffect.length)facts.push(where+" is not in protected heritage, but in "+legalEffect.map(d=>d.status.replace(/ \(.*$/,"").toLowerCase()+" '"+d.name+"'").join(" and ")+", which has legal effects for permits.");
  else facts.push(where+" is not in any protected or fixed heritage designation of the Flemish heritage agency.");
  const fixedBe=designations.find(d=>d.kind==="fixed_built_heritage");
  if(fixedBe&&prot.length)facts.push("It is also on the fixed inventory of built heritage ('"+fixedBe.name+"').");
  const az=designations.find(d=>d.kind==="fixed_archaeological_zone"),gga=designations.find(d=>d.kind==="no_archaeology_expected");
  if(az)facts.push("Archaeology: inside the fixed archaeological zone '"+az.name+"', so a permit with soil works needs an archaeology note even for fairly small parcels and works.");
  else if(gga)facts.push("Archaeology: in an area where no archaeology is expected, so no archaeology note is needed.");
  const unesco=designations.find(d=>d.kind==="unesco_core")||designations.find(d=>d.kind==="unesco_buffer");
  if(unesco)facts.push("UNESCO World Heritage: "+unesco.status.replace("UNESCO World Heritage ","")+" of '"+unesco.name+"'.");
  if(inventory.length&&!legalEffect.length)facts.push("On the scientific inventory of built heritage ('"+inventory[0].name+"'): recorded for its heritage value, without legal effect.");
  if(nearby.length)facts.push(nearby.length+" protected monument"+(nearby.length>1?"s":"")+" within "+NEARBY_M+" m but not at this point: "+nearby.slice(0,3).map(n=>"'"+n.name+"'").join(", ")+(nearby.length>3?" and more":"")+"; check whether the designation reaches your building or parcel.");
  if(extra.error)facts.push("Not checked: the scientific inventory, archaeology notes and nearby monuments, because that request did not answer; call again in a minute.");
  return clean({
    key_facts:facts,
    location:clean({...loc,x_lambert72:loc.x,y_lambert72:loc.y,x:undefined,y:undefined,geocoded:undefined}),
    place,
    protected:prot.length>0,
    legal_effects:legalEffect.length>0,
    designations,
    scientific_inventory:inventory,
    archaeology_notes:notes,
    nearby_protected_monuments:nearby,
    ...(extra.error?{complete:false,retry:{after_seconds:60,missing:["scientific_inventory","archaeology_notes","nearby_protected_monuments"]}}:{}),
    note:"Checked at one point (the address point or the coordinates given). Designations follow parcels and buildings, so one covering only part of a large parcel or the building next door is not found here: see nearby_protected_monuments and the inventory links. Municipal areas where no archaeology is expected are not in the public service. What a designation means for a specific project is decided in the permit procedure; the protection decision itself (url) is the legal text.",
    provenance:{source:"Agentschap Onroerend Erfgoed (Flemish heritage agency): designations, scientific inventory and archaeology notes, via Mercator (Departement Omgeving)",
      licence:"Gratis Open Data Licentie Vlaanderen v1.2 (free reuse, attribution required)",
      terms:"https://assets.vlaanderen.be/image/upload/v1679331485/GratisopendatalicentieVlaanderenv12_bqxu2t.pdf",
      url:"https://www.onroerenderfgoed.be",service:MERCATOR,
      citation:"Agentschap Onroerend Erfgoed, aanduidingsobjecten en inventaris onroerend erfgoed, geraadpleegd op "+new Date().toISOString().slice(0,10)+" via Mercator (Departement Omgeving).",
      geocoding:loc.geocoded?"Address located with the Geolocation service of Digitaal Vlaanderen (Flemish address register).":undefined}
  });
}
