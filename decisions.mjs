// local_decisions: what Flemish municipalities decided, from Lokaal Beslist, the Flemish Government's collection of the agenda items and
// decisions that local authorities must publish as linked open data (LBLOD, Decreet over het Lokaal Bestuur).
//
// Sources, no key:
//   lokaalbeslist.vlaanderen.be   the Lokaal Beslist app: JSON:API resources (/agenda-items, /sessions) and its search index (/search)
//   data.lblod.info/sparql        the LBLOD organisation graph: which councils and boards belong to which municipality, per legislature
//
// What makes these answers more complete than the Lokaal Beslist website:
// - The site filters a municipality through its search index, where only about 0.7 % of the 3.3 million agenda items carry a
//   municipality (22,605 on 16 Nov 2026; Leuven and Gent: none). Its own database links sessions to governing bodies, but the
//   bodies of the current legislature (from December 2024) are often not linked to their municipality there.
// - Here a municipality is first resolved in the organisation graph to every governing body that decides for it (municipal council,
//   college, mayor; OCMW council, its bureau and social committee), both the bodies themselves and their time-bound versions per
//   legislature, and the agenda items are then asked for by those bodies. Leuven: 49,389 agenda items instead of 0 in the search index
//   and 5,590 through the site's location links; Tielt-Winge 24,011 instead of 0.
// - 2019 and 2025 mergers: a municipality is asked together with the municipalities it was formed from (and a former one together
//   with its successor), so "Melle" also finds Merelbeke-Melle's decisions.
// - Publication lags: the answer says when the municipality's latest published session was, so "nothing found" is not read as
//   "nothing decided".
import { _dov } from "./dov.mjs";
const {getJson,clean,cut,DAY,HOUR}=_dov;

const LB="https://lokaalbeslist.vlaanderen.be";
const SPARQL="https://data.lblod.info/sparql";
export const DECISION_HOSTS=Object.freeze(["lokaalbeslist.vlaanderen.be","data.lblod.info"]);
const PAGE=id=>LB+"/agendapunten/"+id;

// The governing bodies that decide for a municipality, grouped as people ask for them.
const BODY_GROUPS={
  council:["Gemeenteraad","Raad voor Maatschappelijk Welzijn"],
  college:["College van Burgemeester en Schepenen","Vast Bureau","Burgemeester"],
  social:["Bijzonder Comité voor de Sociale Dienst"]
};
const ALL_BODIES=Object.values(BODY_GROUPS).flat();
const BODY_EN={"Gemeenteraad":"municipal council","Raad voor Maatschappelijk Welzijn":"OCMW council (social welfare)",
  "College van Burgemeester en Schepenen":"college of mayor and aldermen","Vast Bureau":"OCMW standing bureau","Burgemeester":"mayor",
  "Bijzonder Comité voor de Sociale Dienst":"special committee for social services"};

// Mergers of 1 January 2019 and 1 January 2025: successor -> the municipalities it was formed from (as named in the LBLOD graph).
export const MERGERS={
  "Aalter":["Knesselare","Aalter (voor fusie)"],"Deinze":["Nevele","Deinze (voor fusie)"],"Kruisem":["Kruishoutem","Zingem"],
  "Lievegem":["Lovendegem","Waarschoot","Zomergem"],"Oudsbergen":["Meeuwen-Gruitrode","Opglabbeek"],"Pelt":["Neerpelt","Overpelt"],
  "Puurs-Sint-Amands":["Puurs","Sint-Amands"],
  "Antwerpen":["Borsbeek"],"Beveren-Kruibeke-Zwijndrecht":["Beveren","Kruibeke","Zwijndrecht"],"Pajottegem":["Galmaarden","Gooik","Herne"],
  "Wingene":["Ruiselede"],"Tielt":["Meulebeke"],"Nazareth-De Pinte":["Nazareth","De Pinte"],"Lochristi":["Wachtebeke"],
  "Merelbeke-Melle":["Merelbeke","Melle"],"Lokeren":["Moerbeke"],"Tessenderlo-Ham":["Tessenderlo","Ham"],"Hasselt":["Kortessem"],
  "Bilzen-Hoeselt":["Bilzen","Hoeselt"],"Tongeren-Borgloon":["Tongeren","Borgloon"]
};
export const MERGED_2019=new Set(["Aalter","Deinze","Kruisem","Lievegem","Oudsbergen","Pelt","Puurs-Sint-Amands"]);
// French and English names people use for Flemish municipalities
const ALIAS={gand:"gent",ghent:"gent",anvers:"antwerpen",antwerp:"antwerpen",louvain:"leuven",bruges:"brugge",malines:"mechelen",
  courtrai:"kortrijk",ostende:"oostende",ostend:"oostende",ypres:"ieper",alost:"aalst",termonde:"dendermonde","saint-nicolas":"sint-niklaas",
  tongres:"tongeren",renaix:"ronse",furnes:"veurne",roulers:"roeselare",menin:"menen",tirlemont:"tienen",vilvorde:"vilvoorde",hal:"halle",
  grammont:"geraardsbergen",audenarde:"oudenaarde",lierre:"lier","saint-trond":"sint-truiden",looz:"borgloon",diest:"diest",bilsen:"bilzen",
  "la panne":"de panne",knokke:"knokke-heist",fourons:"voeren",rhode:"sint-genesius-rode","rhode-saint-genese":"sint-genesius-rode"};

export const fold=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/['’]/g,"").replace(/\s*-\s*/g,"-").replace(/\s+/g," ").trim();
const day=iso=>iso?String(iso).slice(0,10):null;
const ISO_DAY=/^\d{4}-\d{2}-\d{2}$/;
const nf=n=>n==null?null:Math.round(n).toLocaleString("en-US");
const lit=s=>JSON.stringify(String(s));                       // a SPARQL string literal (JSON escaping is valid SPARQL)
const UUID=/^[A-Za-z0-9-]{1,80}$/;   // ids go into SPARQL literals and URLs: letters, digits and hyphens only

const PFX="PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#> PREFIX skos: <http://www.w3.org/2004/02/skos/core#> "+
  "PREFIX mu: <http://mu.semte.ch/vocabularies/core/> PREFIX generiek: <https://data.vlaanderen.be/ns/generiek#> "+
  "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> ";

async function sparql(client,query,{ttl=DAY,maxBytes=1<<20}={}){
  // the endpoint chooses by Accept header: with */* it serves its web page instead of results
  const r=await getJson(client,SPARQL+"?"+new URLSearchParams({query}),{maxBytes,ttl,accept:"application/sparql-results+json"});
  if(r.error)return{error:r.error};
  const rows=r.json?.results?.bindings;
  if(!Array.isArray(rows))return{error:"The LBLOD organisation register answered without results"};
  return{rows:rows.map(b=>Object.fromEntries(Object.entries(b).map(([k,v])=>[k,v.value])))};
}
async function lb(client,path,{ttl=6*HOUR,maxBytes=1<<20}={}){
  const r=await getJson(client,LB+path,{maxBytes,ttl});
  if(r.error)return{error:r.error};
  return{json:r.json};
}

/** Every municipality name in the LBLOD graph (current and former). */
async function municipalityNames(client){
  const r=await sparql(client,PFX+'SELECT DISTINCT ?label WHERE { ?e besluit:classificatie/skos:prefLabel "Gemeente" ; besluit:werkingsgebied/rdfs:label ?label }',{ttl:7*DAY});
  return r.error?r:{names:r.rows.map(x=>x.label)};
}

/** A municipality name -> {name, members (names asked together), merged note} or {error}. */
export function matchMunicipality(names,q){
  const f0=fold(q).replace(/^(gemeente|stad|city of|commune de|ville de)\s+/,"");
  const f=ALIAS[f0]||f0;
  if(!f)return{error:"Name a Flemish municipality, e.g. 'Leuven'."};
  const byFold=new Map(names.map(n=>[fold(n),n]));
  let name=byFold.get(f);
  if(!name){
    const starts=names.filter(n=>fold(n).startsWith(f)&&!/\(voor fusie\)/.test(n));
    if(starts.length===1)name=starts[0];
    else if(starts.length>1)return{error:"'"+q+"' matches several municipalities: "+starts.slice(0,8).join(", ")+". Which one?"};
    else return{error:"No Flemish municipality called '"+q+"' publishes in Lokaal Beslist. Use the Dutch name, e.g. 'Leuven', 'Gent', 'Antwerpen'. Lokaal Beslist covers Flanders only (not Brussels or Wallonia)."};
  }
  const base=name.replace(/ \(voor fusie\)$/,"");
  let successor=MERGERS[base]?base:Object.keys(MERGERS).find(k=>MERGERS[k].includes(base)||MERGERS[k].includes(name))||null;
  const members=successor?[successor,...MERGERS[successor]]:[base];
  const known=new Set(names);
  const out={name:successor||base,asked:name,members:members.filter(n=>known.has(n))};
  if(successor&&successor!==base)out.note=base+" merged into "+successor+(MERGED_2019.has(successor)?" on 1 January 2019":" on 1 January 2025")+"; decisions of both are searched.";
  else if(successor)out.note=successor+" was formed from "+MERGERS[successor].filter(n=>!/voor fusie/.test(n)).join(", ")+" (and itself); their earlier decisions are searched too.";
  return out;
}

/** Governing bodies (and their per-legislature versions) of the municipalities and their OCMW: uuid -> {body, unit}. */
async function bodiesOf(client,members){
  const q=PFX+"SELECT DISTINCT ?u ?cls ?unit WHERE { VALUES ?name { "+members.map(lit).join(" ")+" } "+
    "?e besluit:werkingsgebied/rdfs:label ?name ; skos:prefLabel ?unit ; besluit:classificatie/skos:prefLabel ?ecls . FILTER(?ecls IN (\"Gemeente\",\"OCMW\")) "+
    "?org besluit:bestuurt ?e ; besluit:classificatie/skos:prefLabel ?cls . FILTER(?cls IN ("+ALL_BODIES.map(lit).join(",")+")) "+
    "{ ?org mu:uuid ?u } UNION { ?ts generiek:isTijdspecialisatieVan ?org ; mu:uuid ?u } }";
  const r=await sparql(client,q);
  if(r.error)return r;
  const map=new Map();
  for(const x of r.rows)if(UUID.test(x.u))map.set(x.u,{body:x.cls,unit:x.unit});
  return{map};
}

/** For governing-body uuids found on sessions: which body of which authority, in which municipality. */
async function describeBodies(client,uuids){
  const ids=[...new Set(uuids)].filter(u=>UUID.test(u)).slice(0,60);
  if(!ids.length)return{map:new Map()};
  const q=PFX+"SELECT DISTINCT ?u ?cls ?unit ?ecls ?place WHERE { VALUES ?u { "+ids.map(lit).join(" ")+" } ?b mu:uuid ?u . "+
    "OPTIONAL { ?b generiek:isTijdspecialisatieVan ?abs } BIND(COALESCE(?abs,?b) AS ?org) "+
    "?org besluit:bestuurt ?e . OPTIONAL { ?org besluit:classificatie/skos:prefLabel ?cls } "+
    "?e skos:prefLabel ?unit . OPTIONAL { ?e besluit:classificatie/skos:prefLabel ?ecls } OPTIONAL { ?e besluit:werkingsgebied/rdfs:label ?place } }";
  const r=await sparql(client,q,{ttl:7*DAY});
  if(r.error)return r;
  const map=new Map();
  for(const x of r.rows)if(!map.has(x.u))map.set(x.u,clean({body:x.cls,unit:x.unit,unit_type:x.ecls,place:x.place}));
  return{map};
}

// The largest Flemish council (Antwerp's municipal council) has 55 members; a vote with more is a publishing error.
export const MAX_COUNCIL=55;
const bodyName=b=>b?BODY_EN[b]?b+" ("+BODY_EN[b]+")":b:null;

// JSON:API helpers
const incl=(j,type)=>new Map((j.included||[]).filter(i=>i.type===type).map(i=>[i.id,i]));
const relIds=(o,rel)=>{const d=o?.relationships?.[rel]?.data;return d?(Array.isArray(d)?d:[d]).map(x=>x.id):[]};
const tidy=s=>cut(String(s??"").replace(/\s+/g," ").trim(),400);
/** The meeting of an agenda item: the session (of several published views of one meeting) whose body we know, earliest date. */
function meetingOf(item,sessions,bodyMap){
  const ss=relIds(item,"sessions").map(id=>sessions.get(id)).filter(Boolean);
  let best=null;
  for(const s of ss){
    const gb=relIds(s,"governing-body")[0]||null,d=s.attributes?.["planned-start"]||s.attributes?.["started-at"]||null;
    const known=gb&&bodyMap?.has(gb);
    const cand={date:d,started:!!s.attributes?.["started-at"],gb,known};
    if(!best||(known&&!best.known)||(known===best.known&&d&&(!best.date||d<best.date)))best=cand;
  }
  return best||{};
}
function itemView(item,meeting,info){
  const a=item.attributes||{};
  const links=(a["alternate-link"]||[]).filter(u=>/^https:\/\//.test(u));
  return clean({
    id:item.id,
    date:day(meeting.date),
    body:info?.body?bodyName(info.body):null,
    authority:info?.unit&&info.place&&info.unit!==info.place?info.unit+" ("+info.place+")":info?.unit||null,
    title:a.title?tidy(a.title):a.description?tidy(a.description):"(no title published)",
    status:meeting.date&&!meeting.started&&meeting.date>new Date().toISOString()?"on the agenda of a meeting still to come":null,
    official_page:links.find(u=>/agendapunt/i.test(u))||links[0]||null,
    lokaal_beslist:PAGE(item.id)
  });
}

/** One agenda item is often published as several records (agenda, decision list, minutes): keep one per meeting date, body and title,
 *  preferring the record that links to the item's own page. */
export function dedupe(views){
  const out=new Map();
  for(const v of views){
    const k=[v.date,v.body,fold(v.title)].join("|"),prev=out.get(k);
    if(!prev)out.set(k,v);
    else if(!/agendapunt/i.test(prev.official_page||"")&&/agendapunt/i.test(v.official_page||""))out.set(k,{...v,also_published_as:[prev.id]});
  }
  return [...out.values()];
}

const ITEM_FIELDS="fields[agenda-items]=title,description,alternate-link,sessions&fields[sessions]=planned-start,started-at,governing-body&fields[governing-bodies]=uri";

function words(q){
  return [...new Set(String(q||"").split(/[\s,;]+/).map(w=>w.replace(/^["'(]+|["')?.!]+$/g,"")).filter(w=>w.length>=2))].slice(0,6);
}
function dateRange(args){
  for(const k of ["from","to"])if(args[k]!=null&&!ISO_DAY.test(String(args[k])))return{error:k+" must be a date as YYYY-MM-DD, e.g. '2025-01-01'."};
  if(args.from&&args.to&&args.from>args.to)return{error:"from is after to."};
  return{from:args.from||null,to:args.to||null};
}

// ---------- municipality: its decisions, newest first ----------
async function byMunicipality(client,args,range){
  const n=await municipalityNames(client);
  if(n.error)return{error:"The LBLOD organisation register did not answer: "+n.error+". Try again in a minute."};
  const m=matchMunicipality(n.names,args.municipality);
  if(m.error)return{error:m.error};
  const b=await bodiesOf(client,m.members);
  if(b.error)return{error:"The LBLOD organisation register did not answer: "+b.error+". Try again in a minute."};
  const group=args.body&&args.body!=="all"?BODY_GROUPS[args.body]:null;
  if(args.body&&args.body!=="all"&&!group)return{error:"body must be one of council, college, social or all."};
  const ids=[...b.map].filter(([,v])=>!group||group.includes(v.body)).map(([k])=>k);
  if(!ids.length)return{error:"The organisation register lists no "+(group?args.body+" ":"")+"governing bodies for "+m.name+"."};
  const limit=Math.min(Math.max(Number(args.limit)||10,1),25);
  const ws=words(args.query);
  // the server matches one word in the title (case-insensitive substring); with more words, the newest 100 are checked for the others
  const lead=[...ws].sort((x,y)=>y.length-x.length)[0]||null;
  const p=["filter[sessions][governing-body][:id:]="+ids.join(","),"sort=-sessions.planned-start","page[size]="+(ws.length>1?100:Math.min(100,limit*3)),"include=sessions.governing-body",ITEM_FIELDS];
  if(lead)p.push("filter[title]="+encodeURIComponent(lead));
  if(range.from)p.push("filter[sessions][:gte:planned-start]="+range.from);
  if(range.to)p.push("filter[sessions][:lte:planned-start]="+range.to+"T23:59:59");
  const [r,last]=await Promise.all([
    lb(client,"/agenda-items?"+p.join("&")),
    lb(client,"/sessions?filter[governing-body][:id:]="+ids.join(",")+"&filter[:lte:planned-start]="+new Date(Date.now()+86400e3).toISOString().slice(0,10)+"&sort=-planned-start&page[size]=1&fields[sessions]=planned-start,started-at",{ttl:6*HOUR,maxBytes:256*1024})
  ]);
  if(r.error)return{error:"Lokaal Beslist did not answer: "+r.error+". Try again in a minute."};
  const sessions=incl(r.json,"sessions");
  let items=r.json.data||[];
  const serverCount=Number(r.json.meta?.count)||items.length;
  if(ws.length>1){const rest=ws.filter(w=>w!==lead).map(fold);items=items.filter(it=>{const t=fold(it.attributes?.title);return rest.every(w=>t.includes(w))})}
  const decisions=dedupe(items.map(it=>{const mt=meetingOf(it,sessions,b.map);return itemView(it,mt,b.map.get(mt.gb))})).slice(0,limit);
  const lastSession=day(last.json?.data?.[0]?.attributes?.["planned-start"]);
  const what=ws.length?"with "+ws.map(w=>"'"+w+"'").join(" and ")+" in the title":"";
  const when=range.from||range.to?(range.from&&range.to?"between "+range.from+" and "+range.to:range.from?"since "+range.from:"up to "+range.to):"";
  const who=group?args.body+" ":"";
  const facts=[];
  if(ws.length>1)facts.push(nf(serverCount)+" agenda items of "+m.name+"'s "+who+"bodies have '"+lead+"' in the title"+(when?" "+when:"")+"; of the newest "+Math.min(100,serverCount)+", "+items.length+" also contain "+ws.filter(w=>w!==lead).map(w=>"'"+w+"'").join(" and ")+".");
  else facts.push(nf(serverCount)+" agenda-item records of "+m.name+"'s "+(group?args.body+" bodies ":"council, college and OCMW ")+(what?what+" ":"")+(when?when+" ":"")+"are published in Lokaal Beslist (one item can be published more than once: on the agenda, the decision list and the minutes)"+(decisions.length?"; the newest "+decisions.length+" distinct items are listed, newest meeting first.":"."));
  if(decisions[0])facts.push("Newest: "+decisions[0].date+", "+(decisions[0].body||"governing body")+": "+cut(decisions[0].title,200));
  if(lastSession)facts.push(m.name+"'s latest published meeting in Lokaal Beslist is of "+lastSession+"; decisions taken after it are not published there yet.");
  if(!decisions.length&&!serverCount)facts.push("Nothing found does not mean nothing was decided: municipalities publish with a delay, and titles may use other words (try a shorter word stem, e.g. 'fiets' instead of 'fietspaden').");
  if(m.note)facts.push(m.note);
  return clean({
    municipality:clean({name:m.name,searched:m.members.length>1?m.members:null,note:m.note}),
    query:ws.length?ws.join(" "):null,
    body:group?args.body+": "+group.join(", "):"all: "+ALL_BODIES.join(", "),
    period:when||null,
    total_matching:ws.length>1?null:serverCount,
    matching_title_word:ws.length>1?{word:lead,count:serverCount,checked_newest:Math.min(100,serverCount),all_words_matched:items.length}:null,
    latest_published_meeting:lastSession,
    decisions,
    how_to_read:"Each agenda item is listed once with its meeting date and the body that handled it. 'official_page' is the municipality's own publication; ask local_decisions with agenda_item_id for the decision text, articles and votes.",
    key_facts:facts,
    provenance:provenance()
  });
}

// ---------- all of Flanders: full-text search ----------
async function acrossFlanders(client,args,range){
  const ws=words(args.query);
  if(!ws.length)return{error:"Give a municipality, a query (words to search for, e.g. 'zonnepanelen'), or an agenda_item_id."};
  const limit=Math.min(Math.max(Number(args.limit)||10,1),25);
  const esc=w=>w.replace(/[\\"]/g,"");
  const p=new URLSearchParams({"page[size]":String(limit),"page[number]":"0","sort[session_planned_start.field]":"desc"});
  p.set("filter[:query:search_content]",ws.map(w=>'(title:"'+esc(w)+'" OR description:"'+esc(w)+'")').join(" AND "));
  const hi=range.to||new Date(Date.now()+86400e3).toISOString().slice(0,10);   // no meetings planned years ahead (some publishers date items 2099)
  p.set("filter[:query:session_planned_start]","session_planned_start:["+(range.from||"*")+" TO "+hi+"]");
  const s=await lb(client,"/search/agenda-items/search?"+p,{ttl:6*HOUR});
  if(s.error)return{error:"Lokaal Beslist's search did not answer: "+s.error+". Try again in a minute."};
  const hits=(s.json.data||[]).map(d=>d.attributes||{});
  const total=Number(s.json.count)||0;
  const uuids=hits.map(a=>Array.isArray(a.uuid)?a.uuid[0]:a.uuid).filter(u=>UUID.test(String(u||"")));
  let decisions=[];
  if(uuids.length){
    const r=await lb(client,"/agenda-items?filter[:id:]="+uuids.join(",")+"&page[size]="+uuids.length+"&include=sessions.governing-body&"+ITEM_FIELDS);
    if(r.error)return{error:"Lokaal Beslist did not answer: "+r.error+". Try again in a minute."};
    const sessions=incl(r.json,"sessions"),byId=new Map((r.json.data||[]).map(d=>[d.id,d]));
    const meetings=new Map(uuids.filter(u=>byId.has(u)).map(u=>[u,meetingOf(byId.get(u),sessions,null)]));
    const d=await describeBodies(client,[...meetings.values()].map(m=>m.gb).filter(Boolean));
    const info=d.map||new Map();
    decisions=dedupe(uuids.filter(u=>byId.has(u)).map(u=>{const mt=meetings.get(u);const v=itemView(byId.get(u),mt,info.get(mt.gb));
      const i=info.get(mt.gb);return clean({...v,municipality:i?.place||null})}));
  }
  const when=range.from||range.to?(range.from&&range.to?"between "+range.from+" and "+range.to:range.from?"since "+range.from:"up to "+range.to):"";
  const facts=[nf(total)+" agenda items of Flemish local authorities mention "+ws.map(w=>"'"+w+"'").join(" and ")+" in their title or description"+(when?" "+when:"")+(decisions.length?"; the newest "+decisions.length+" are listed, newest meeting first.":".")];
  if(decisions[0])facts.push("Newest: "+decisions[0].date+", "+[decisions[0].municipality,decisions[0].body].filter(Boolean).join(", ")+": "+cut(decisions[0].title,200));
  facts.push("This search covers every authority publishing in Lokaal Beslist (municipalities, OCMW, provinces, police zones, intermunicipal and church bodies). Name a municipality to list only its decisions, including the many items the Flanders-wide index does not tie to a place.");
  return clean({
    query:ws.join(" "),period:when||null,total_matching:total,decisions,
    how_to_read:"Search across all of Flanders (exact words in title or description). Ask with agenda_item_id for one decision's text, articles and votes.",
    key_facts:facts,provenance:provenance()
  });
}

// ---------- one agenda item ----------
async function oneItem(client,id){
  if(!UUID.test(id))return{error:"agenda_item_id is the id of an agenda item from an earlier answer, e.g. '85385bd7-55a4-582a-a2af-7d1928cdeeca'."};
  const f="fields[agenda-items]=title,description,alternate-link,planned-public,sessions,handled-by&fields[sessions]=planned-start,started-at,ended-at,governing-body"+
    "&fields[agenda-item-handlings]=public,resolutions,has-votes&fields[resolutions]=title,value,description,motivation,articles&fields[articles]=number,value"+
    "&fields[votes]=number-of-proponents,number-of-opponents,number-of-abstentions,secret,subject,consequence";
  const r=await lb(client,"/agenda-items/"+encodeURIComponent(id)+"?include=sessions.governing-body,handled-by.resolutions.articles,handled-by.has-votes&fields[governing-bodies]=uri&"+f,{ttl:DAY,maxBytes:2<<20});
  if(r.error)return{error:r.status===404||/HTTP 404/.test(r.error)?"No agenda item with id "+id+" in Lokaal Beslist.":"Lokaal Beslist did not answer: "+r.error+". Try again in a minute."};
  const item=r.json.data;
  if(!item)return{error:"No agenda item with id "+id+" in Lokaal Beslist."};
  const sessions=incl(r.json,"sessions"),handlings=incl(r.json,"agenda-item-handlings"),resolutions=incl(r.json,"resolutions"),articles=incl(r.json,"articles"),votes=incl(r.json,"votes");
  const mt=meetingOf(item,sessions,null);
  const d=mt.gb?await describeBodies(client,[mt.gb]):{map:new Map()};
  const info=d.map?.get(mt.gb);
  const base=itemView(item,mt,info);
  const h=handlings.get(relIds(item,"handled-by")[0]);
  const res=relIds(h,"resolutions").map(x=>resolutions.get(x)).filter(Boolean).map(x=>{
    const a=x.attributes||{};
    const arts=relIds(x,"articles").map(y=>articles.get(y)?.attributes).filter(Boolean)
      .sort((p,q)=>(parseInt(String(p.number).replace(/\D/g,""))||0)-(parseInt(String(q.number).replace(/\D/g,""))||0));
    return clean({title:a.title?tidy(a.title):null,summary:a.description?cut(String(a.description).replace(/\s+/g," ").trim(),800):null,
      motivation:a.motivation?cut(String(a.motivation).replace(/\s+/g," ").replace(/^Motivering\s*/i,"").trim(),1500):null,
      articles:arts.slice(0,12).map(y=>clean({number:y.number,text:cut(String(y.value||"").replace(/\s+/g," ").trim(),600)})),
      articles_not_shown:arts.length>12?arts.length-12:null});
  });
  const vs=relIds(h,"has-votes").map(x=>votes.get(x)?.attributes).filter(Boolean).map(v=>clean({subject:v.subject,in_favour:v["number-of-proponents"],against:v["number-of-opponents"],
    abstained:v["number-of-abstentions"],secret:v.secret,outcome:v.consequence?cut(String(v.consequence).replace(/\s+/g," ").trim(),300):null}))
    .map(v=>{const n=(v.in_favour||0)+(v.against||0)+(v.abstained||0);return n>MAX_COUNCIL?{...v,doubtful:"more votes ("+n+") than any Flemish council has members ("+MAX_COUNCIL+"): a publishing error; check the minutes"}:v});
  const a=item.attributes||{};
  const facts=[[base.date,info?.place,base.body].filter(Boolean).join(", ")+": "+base.title];
  if(!h)facts.push("No handling (decision) is published for this agenda item: it may not have been treated yet, or only the agenda was published.");
  else if(res[0]?.summary)facts.push("Decision: "+cut(res[0].summary,300));
  if(vs.length)facts.push("Votes as published: "+vs.slice(0,3).map(v=>(v.subject?v.subject+": ":"")+v.in_favour+" in favour, "+v.against+" against, "+v.abstained+" abstained"+(v.doubtful?" (impossible count, a publishing error)":"")).join("; ")+(vs.length>3?"; "+(vs.length-3)+" more":"")+".");
  return clean({
    ...base,
    municipality:info?.place||null,
    public:h?.attributes?.public??a["planned-public"]??null,
    description:a.description&&a.title?cut(String(a.description).replace(/\s+/g," ").trim(),800):null,
    decisions:res,
    votes:vs,
    note_on_votes:vs.length?"Vote counts are given as the authority published them; some publishers count per article or per secret ballot round.":null,
    other_publications:(a["alternate-link"]||[]).filter(u=>/^https:\/\//.test(u)&&u!==base.official_page).slice(0,5),
    key_facts:facts,
    provenance:provenance()
  });
}

function provenance(){
  const d=new Date().toISOString().slice(0,10);
  return{
    source:"Lokaal Beslist (Agentschap Binnenlands Bestuur, Flemish Government): agenda items and decisions published by Flemish local authorities as linked open data (LBLOD); governing bodies from the LBLOD organisation register",
    licence:"Official acts of public authorities, not protected by copyright (Belgian Code of Economic Law, art. XI.172 §2); published for reuse under the publication duty of the Decreet over het Lokaal Bestuur",
    url:"https://lokaalbeslist.vlaanderen.be",
    citation:"Lokaal Beslist, Agentschap Binnenlands Bestuur – consulted on "+d+"; the legally valid text is the authority's own publication (official_page).",
    retrieved:d
  };
}

export async function localDecisions(client,args={}){
  const range=dateRange(args);
  if(range.error)return{error:range.error};
  if(args.agenda_item_id)return oneItem(client,String(args.agenda_item_id).trim());
  if(args.municipality)return byMunicipality(client,args,range);
  return acrossFlanders(client,args,range);
}
