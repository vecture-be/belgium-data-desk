// zoning_at_location: what the spatial plans say about an address or point in Flanders: the land-use zone that applies (regional
// zoning map, general and special plans of development, municipal, provincial and regional spatial implementation plans), overlays,
// building-line and expropriation plans, the urban-development regulations, plans still in procedure (with their public inquiry), and
// the permit applications filed for this spot through the Omgevingsloket since 2017.
//
// Sources, no key: Mercator (Departement Omgeving), WFS 2.0, Gratis Open Data Licentie Vlaanderen v1.2:
//   lu:lu_si_gv / lu_si_ov / lu_si_ct   DSI "stedenbouwkundige informatie": zones, overlays and plan/regulation contours, all plan types
//   lu:lu_si_participatie_ct             plans and regulations in participation or public inquiry
//   lu:lu_omv_gd_v2 / lu_omv_vk_v2       Omgevingsloket projects (building projects, subdivisions) since 2017
//
// What makes these answers true (and what a list of map layers leaves to the reader):
// - Several plans overlap at one point; the most detailed plan in force decides (a RUP over a BPA over the regional zoning map),
//   so the zones are ranked and the one that applies is named, with the others kept as context.
// - "In force" is read from the plan phase: approved (BG) or definitively adopted (DV). Provisionally adopted (VV), start and scoping
//   notes and other stages are drafts and are listed apart, with their participation dates when given.
// - Repealed regulations (named OPGEHEVEN) are left out; regional regulations that apply everywhere in Flanders are counted, the
//   municipal and provincial ones named.
// - Permit applicants are not named (many are private persons).
import { _dov } from "./dov.mjs";
import { placeContext } from "./place.mjs";
import { outsideFlanders } from "./heritage.mjs";
const {getJson,resolveLocation,clean,cut,DAY,HOUR}=_dov;

export const MERCATOR="https://www.mercator.vlaanderen.be/raadpleegdienstenmercatorpubliek/wfs";
export const ZONING_HOSTS=Object.freeze(["www.mercator.vlaanderen.be"]);

export const PLAN_TYPES={GWP:"regional zoning plan (gewestplan)",APA:"general plan of development (APA)",BPA:"special plan of development (BPA)",
  gemRUP:"municipal spatial implementation plan (RUP)",proRUP:"provincial spatial implementation plan (RUP)",gewRUP:"regional spatial implementation plan (RUP)",
  gemSVO:"municipal urban-development regulation",proSVO:"provincial urban-development regulation",gewSVO:"regional urban-development regulation",
  gemBVO:"municipal building regulation",gewBVO:"regional building regulation",gemROO:"building-line plan (rooilijnplan)",gemONT:"expropriation plan (onteigeningsplan)",
  WRG:"release of a residential reserve area (woonreservegebied)",HOV:"revision or repeal of outdated plan rules (HOV)"};
const RANK={gewRUP:3,proRUP:3,gemRUP:3,BPA:2,APA:1,GWP:0};
export const PHASES={BG:["in_force","approved, in force"],DV:["in_force","definitively adopted, in force once published in the Belgian Official Gazette"],
  VV:["draft","provisionally adopted: draft plan in or after its public inquiry, not in force yet"],ST:["draft","start note: plan in early preparation, not in force"],
  SP:["draft","scoping note: plan in preparation, not in force"],PV:["draft","in preparation, not in force"],ADV:["draft","draft regulation in consultation, not in force"],
  // NA ("natraject"): a published plan with a later procedure step (e.g. a suspension or annulment case); its effect is in the plan file
  NA:["unclear","published, with a later procedure step recorded (natraject): check the plan file for its current effect"]};
const phase=f=>PHASES[f]||["unclear","phase code "+(f||"not given")+": check the plan file"];
export const CATEGORIES={WON:"housing",LDB:"agriculture",BED:"business and services",NAT:"nature",BOS:"forest",REC:"recreation",
  GNV:"community facilities and public utilities",LNI:"transport infrastructure",OVG:"green and buffer areas",OWA:"extraction (quarrying)"};
const PERMIT_STATUS={"Vergunning":"permit granted","Weigering":"refused","Stopgezet":"stopped","In behandeling":"being processed","Ingediend":"submitted",
  "Onvolledig":"incomplete","Onontvankelijk":"inadmissible","Vernietigd":"annulled","Geschorst":"suspended","Verzaking":"withdrawn"};
const https=u=>/^https:\/\//.test(u||"")?u:null;
const day=d=>d&&!/^1900-01-01/.test(String(d))?String(d).slice(0,10):null;   // 1900-01-01 is the register's "date not known"
const plural=(n,one,many)=>n+" "+(n===1?one:many);
const pt=loc=>"SRID=31370;POINT("+loc.x.toFixed(2)+" "+loc.y.toFixed(2)+")";

async function features(client,queries,{count=80,ttl=DAY}={}){
  const q=new URLSearchParams({service:"WFS",version:"2.0.0",request:"GetFeature",outputFormat:"application/json",count:String(count),
    typeNames:queries.map(x=>"("+x.layer+")").join(""),propertyName:queries.map(x=>"("+x.props+")").join(""),cql_filter:queries.map(x=>x.cql).join(";")});
  const r=await getJson(client,MERCATOR+"?"+q,{maxBytes:768*1024,ttl});
  if(r.error)return r;
  if(!Array.isArray(r.json?.features))return{error:"Mercator answered without features"};
  return{rows:r.json.features.map(f=>({layer:String(f.id||"").replace(/\.[^.]*$/,""),p:f.properties||{}}))};
}

export function zoneView(p){
  const [state,meaning]=phase(p.fase);
  return clean({zone:p.svnaam||p.legende||null,code:p.label||null,category:CATEGORIES[p.categorie]||null,category_code:p.categorie||null,
    plan:p.naam||null,plan_type:PLAN_TYPES[p.dossiertype]||p.dossiertype||null,plan_id:p.algplanid||null,sub_area:p.dgnr||null,
    published:day(p.d_bs),status:meaning,in_force:state==="in_force",rules:https(p.svidlink),plan_file:https(p.fichelink)});
}
/** The zone that applies: the most detailed plan in force, then the most recently published. */
export function rankZones(rows){
  return rows.map(p=>({p,v:zoneView(p)})).sort((a,b)=>(b.v.in_force-a.v.in_force)||((RANK[b.p.dossiertype]??-1)-(RANK[a.p.dossiertype]??-1))||String(b.p.d_bs||"").localeCompare(String(a.p.d_bs||""))).map(x=>x.v);
}
const planView=p=>{const [state,meaning]=phase(p.fase);return clean({name:p.naam?cut(p.naam,200):null,type:PLAN_TYPES[p.dossiertype]||p.dossiertype||null,id:p.algplanid||null,
  published:day(p.d_bs),status:meaning,in_force:state==="in_force",plan_file:https(p.fichelink)})};
const permitView=p=>clean({project:p.projectnummer||null,type:p.omschrijving_projecttype||null,works:p.handeling_omschrijving?cut(p.handeling_omschrijving,200):null,
  submitted:day(p.datum_indiening),status:p.huidige_toestand?(PERMIT_STATUS[p.huidige_toestand]?PERMIT_STATUS[p.huidige_toestand]+" ("+p.huidige_toestand+")":p.huidige_toestand):null,
  status_date:day(p.datum_huidige_toestand),stage:p.fase_huidige_toestand||null,authority:p.vvo_huidige_toestand||null,subdivision:/_VK_/.test(p.project_type_code||"")||null,link:https(p.project_link)});

export async function zoningAtLocation(client,args,{assets}={}){
  const w=await resolveLocation(client,args);
  if(w.error)return{error:w.error.replace("which is the area DOV covers","which the Flemish spatial plans cover"),...(w.location?{location:w.location}:{})};
  const loc=w.loc,at="INTERSECTS(geometrie,"+pt(loc)+")",atGeom="DWITHIN(geom,"+pt(loc)+",2,meters)";
  const ZP="dossiertype,algplanid,naam,fase,svnaam,categorie,legende,label,dgnr,svidlink,fichelink,d_bs";
  const [plans,permits,place]=await Promise.all([
    features(client,[{layer:"lu:lu_si_gv",props:ZP,cql:at},{layer:"lu:lu_si_ov",props:"dossiertype,algplanid,naam,fase,svnaam,legende,fichelink,d_bs",cql:at},
      {layer:"lu:lu_si_ct",props:"dossiertype,algplanid,naam,fase,fichelink,d_bs",cql:at},
      {layer:"lu:lu_si_participatie_ct",props:"dossiertype,algplanid,naam,fase,d_participatie,termijn,fichelink",cql:at}]),
    features(client,[{layer:"lu:lu_omv_gd_v2",props:"projectnummer,project_type_code,omschrijving_projecttype,handeling_omschrijving,datum_indiening,huidige_toestand,datum_huidige_toestand,fase_huidige_toestand,vvo_huidige_toestand,project_link",cql:atGeom},
      {layer:"lu:lu_omv_vk_v2",props:"projectnummer,project_type_code,omschrijving_projecttype,handeling_omschrijving,datum_indiening,huidige_toestand,datum_huidige_toestand,fase_huidige_toestand,vvo_huidige_toestand,project_link",cql:atGeom}],{count:60,ttl:6*HOUR}),
    placeContext(client,assets,loc).catch(()=>null)
  ]);
  const outside=outsideFlanders(place);if(outside)return{error:outside.replace("heritage register","spatial plans").replace(/Brussels heritage is listed by urban\.brussels \(monument\.heritage\.brussels\)\./,"Brussels plans are on urban.brussels (BruGIS).").replace(/Walloon heritage is listed by the AWaP \(Agence wallonne du Patrimoine\)\./,"Walloon plans are on WalOnMap (SPW)."),place};
  if(plans.error)return{error:"Mercator (the Flemish spatial plans) did not answer: "+plans.error+"; try again in a minute.",retry_after_seconds:60};
  const by=l=>plans.rows.filter(r=>r.layer===l).map(r=>r.p);
  const zones=rankZones(by("lu_si_gv"));
  const applies=zones.find(z=>z.in_force)||null;
  const overlays=by("lu_si_ov").map(p=>clean({overlay:p.svnaam||p.legende||null,plan:p.naam||null,plan_type:PLAN_TYPES[p.dossiertype]||p.dossiertype||null,published:day(p.d_bs),status:phase(p.fase)[1],plan_file:https(p.fichelink)}));
  const contours=by("lu_si_ct").filter(p=>!/^\s*OPGEHEVEN/i.test(p.naam||""));
  const repealed=by("lu_si_ct").length-contours.length;
  const regs=contours.filter(p=>/(SVO|BVO)$/.test(p.dossiertype||""));
  const localRegs=regs.filter(p=>!/^gew/.test(p.dossiertype)).map(planView),regionalRegs=regs.filter(p=>/^gew/.test(p.dossiertype));
  const special=contours.filter(p=>/^(gemROO|gemONT|WRG|HOV|WOR)$/.test(p.dossiertype||"")||/ONT$/.test(p.dossiertype||"")).map(planView);
  const zonedIds=new Set(by("lu_si_gv").map(p=>p.algplanid));
  const inForceIds=new Set([...contours,...by("lu_si_gv")].filter(p=>p.algplanid&&phase(p.fase)[0]==="in_force").map(p=>p.algplanid));
  const otherPlans=contours.filter(p=>/RUP$/.test(p.dossiertype||"")&&phase(p.fase)[0]==="unclear"&&!zonedIds.has(p.algplanid)).map(planView);
  const drafts=[...contours.filter(p=>/RUP$/.test(p.dossiertype||"")&&phase(p.fase)[0]==="draft"&&!zonedIds.has(p.algplanid)).map(planView),
    // the participation layer keeps a plan's earlier stage after it is adopted: a plan in force elsewhere in the answer is not a draft
    ...by("lu_si_participatie_ct").filter(p=>!inForceIds.has(p.algplanid)).map(p=>clean({...planView(p),participation_from:day(p.d_participatie),participation_period:p.termijn||null}))];
  // a draft in both layers is one plan: merged, so the participation dates of the participation layer are kept
  const draftMap=new Map();for(const d of drafts){const k=d.id||d.name;draftMap.set(k,{...draftMap.get(k),...d})}
  const draftList=[...draftMap.values()].slice(0,10);
  let permitList=[],permitCount=0;
  if(!permits.error){
    const m=new Map();for(const r of permits.rows){const v=permitView(r.p);if(v.project&&!m.has(v.project))m.set(v.project,v)}
    const all=[...m.values()].sort((a,b)=>String(b.submitted||"").localeCompare(String(a.submitted||"")));
    permitCount=all.length;permitList=all.slice(0,8);
  }
  const where=loc.matched_address||("The point "+(loc.latitude!=null?loc.latitude.toFixed(5)+", "+loc.longitude.toFixed(5):"given"));
  const facts=[];
  if(applies)facts.push(where+" lies in '"+applies.zone+"'"+(applies.code?" ("+applies.code+")":"")+(applies.category?", a "+applies.category+" zone,":"")+" of the "+applies.plan_type+" '"+applies.plan+"'"+(applies.published?" (published "+applies.published+")":"")+": this is the most detailed plan in force here, so its rules decide what may be built.");
  else facts.push(where+": no land-use zone in force was found at this point in the Flemish spatial plans.");
  const under=zones.filter(z=>z!==applies&&z.in_force);
  if(applies&&under.length)facts.push("Underneath: "+under.map(z=>"'"+z.zone+"' in the "+z.plan_type+(z.plan&&z.plan!=="Algemeen"?" '"+z.plan+"'":"")).join("; ")+"; where the detailed plan covers this spot, its rules replace or refine these.");
  if(overlays.length)facts.push("Overlay"+(overlays.length>1?"s":"")+": "+overlays.map(o=>"'"+o.overlay+"'").join(", ")+".");
  if(special.some(s=>/expropriation/.test(s.type||"")&&s.in_force))facts.push("An expropriation plan covers this point: check it before buying or building.");
  if(special.some(s=>/building-line/.test(s.type||"")))facts.push("A building-line plan (rooilijnplan) covers this point: the street line may differ from the current plot boundary.");
  if(draftList.length)facts.push(plural(draftList.length,"plan or regulation","plans or regulations")+" still in procedure "+(draftList.length===1?"covers":"cover")+" this point, e.g. '"+draftList[0].name+"' ("+draftList[0].status+")"+(draftList[0].participation_from?", participation from "+draftList[0].participation_from:"")+"; not in force, but it can change what will be allowed.");
  if(otherPlans.length)facts.push("Also covering this point: "+otherPlans.map(p=>"'"+p.name+"'"+(p.published?" (published "+p.published+")":"")).join(", ")+", with a later procedure step recorded; check the plan file for its current effect.");
  if(localRegs.length)facts.push(plural(localRegs.length,"municipal or provincial regulation applies","municipal or provincial regulations apply")+" here (e.g. '"+cut(localRegs[0].name,120)+"'), besides "+regionalRegs.length+" regional regulations that apply across Flanders.");
  if(permits.error)facts.push("Not checked: permit applications, because that request did not answer; call again in a minute.");
  else facts.push(permitCount?plural(permitCount,"permit application","permit applications")+" filed through the Omgevingsloket since 2017 "+(permitCount===1?"covers":"cover")+" this point; the newest: "+permitList[0].submitted+", "+(permitList[0].works||permitList[0].type)+" ("+(permitList[0].status||"status not given")+").":"No permit application filed through the Omgevingsloket since 2017 covers this exact point (older permits are in the municipality's register).");
  return clean({
    key_facts:facts,
    location:clean({...loc,x_lambert72:loc.x,y_lambert72:loc.y,x:undefined,y:undefined,geocoded:undefined}),
    place,
    applies,
    other_zones:zones.filter(z=>z!==applies),
    overlays,
    special_plans:special,
    plans_in_procedure:draftList,
    other_plans:otherPlans,
    regulations:clean({municipal_and_provincial:localRegs,regional_count:regionalRegs.length,regional:regionalRegs.map(p=>cut(p.naam,120)).slice(0,12),repealed_left_out:repealed||null}),
    permit_applications:permits.error?null:clean({count:permitCount,newest:permitList,note:"Applications filed through the Omgevingsloket since 2017 whose project area covers this point; older permits are in the municipality's register. Applicants are not named."}),
    ...(permits.error?{complete:false,retry:{after_seconds:60,missing:["permit_applications"]}}:{}),
    note:"Checked at one point. The zone's rules are in the plan's urban-development regulations ('rules' link); which plan replaced which is stated in the plans themselves, and the municipality's planning information (stedenbouwkundig uittreksel) is the official statement for a parcel. A plan in procedure can still change and is not in force.",
    provenance:{source:"Departement Omgeving (Flemish Department of Environment): Digitaal Stedenbouwkundige Informatie (spatial plans and regulations) and Omgevingsloket projects, via Mercator",
      licence:"Gratis Open Data Licentie Vlaanderen v1.2 (free reuse, attribution required)",
      terms:"https://assets.vlaanderen.be/image/upload/v1679331485/GratisopendatalicentieVlaanderenv12_bqxu2t.pdf",
      url:"https://dsi.omgeving.vlaanderen.be",service:MERCATOR,
      citation:"Departement Omgeving, Digitaal Stedenbouwkundige Informatie en Omgevingsloket, geraadpleegd op "+new Date().toISOString().slice(0,10)+" via Mercator.",
      geocoding:loc.geocoded?"Address located with the Geolocation service of Digitaal Vlaanderen (Flemish address register).":undefined}
  });
}
