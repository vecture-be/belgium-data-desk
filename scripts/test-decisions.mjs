// local_decisions against a synthetic Lokaal Beslist and LBLOD organisation register: municipality names and mergers, a municipality
// resolved to its governing bodies through the organisation register (not through the app's missing location links), one item
// published as several records, multi-word title search, the latest-meeting date, the Flanders-wide search, one item with an
// impossible vote count, and services that do not answer.
import assert from "node:assert/strict";
import { makeDovClient } from "../dov.mjs";
import { DECISION_HOSTS, localDecisions, matchMunicipality, dedupe, fold, MERGERS } from "../decisions.mjs";
import { checkAnswer } from "../lib/tool-contract.mjs";

// ---- names
const NAMES=["Leuven","Gent","Aarschot","Merelbeke","Melle","Merelbeke-Melle","Aalter","Aalter (voor fusie)","Knesselare","Sint-Niklaas","Sint-Truiden","Tielt","Tielt-Winge","Meulebeke"];
assert.equal(matchMunicipality(NAMES,"leuven").name,"Leuven");
assert.equal(matchMunicipality(NAMES,"Louvain").name,"Leuven","French exonym");
assert.equal(matchMunicipality(NAMES,"Ghent").name,"Gent","English exonym");
assert.equal(matchMunicipality(NAMES,"Stad Gent").name,"Gent","'stad' prefix");
assert.deepEqual(matchMunicipality(NAMES,"Melle").members,["Merelbeke-Melle","Merelbeke","Melle"],"a former municipality is asked with its successor");
assert.match(matchMunicipality(NAMES,"Melle").note,/merged into Merelbeke-Melle on 1 January 2025/);
assert.deepEqual(matchMunicipality(NAMES,"Merelbeke-Melle").members,["Merelbeke-Melle","Merelbeke","Melle"]);
assert.deepEqual(matchMunicipality(NAMES,"Aalter").members,["Aalter","Knesselare","Aalter (voor fusie)"],"2019 merger, with the register's pre-merger name");
assert.equal(matchMunicipality(NAMES,"Tielt").name,"Tielt","an exact name is not taken as the start of Tielt-Winge");
assert.deepEqual(matchMunicipality(NAMES,"Tielt-Winge").members,["Tielt-Winge"]);
assert.match(matchMunicipality(NAMES,"Sint").error,/several municipalities: Sint-Niklaas, Sint-Truiden/);
assert.match(matchMunicipality(NAMES,"Namur").error,/Flanders only/);
assert.equal(fold("Kruishoutem - Zingem"),"kruishoutem-zingem");
for(const [k,v] of Object.entries(MERGERS))assert.ok(!v.includes(k),k+" is not its own predecessor");

// ---- one item published as several records
const d=dedupe([{date:"2026-08-28",body:"C",title:"X - Goedkeuring",id:"a",official_page:"https://x/besluitenlijst"},
  {date:"2026-08-28",body:"C",title:"X  -  goedkeuring",id:"b",official_page:"https://x/agendapunten/1"},{date:"2026-08-21",body:"C",title:"X - Goedkeuring",id:"c"}]);
assert.equal(d.length,2,"same meeting, body and title = one item; another meeting stays");
assert.equal(d[0].id,"b","the record with the item's own page is kept");assert.deepEqual(d[0].also_published_as,["a"]);

// ---- a synthetic Lokaal Beslist and organisation register
const json=o=>new Response(JSON.stringify(o),{headers:{"content-type":"application/json"}});
const sp=rows=>json({head:{vars:[]},results:{bindings:rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,{type:"literal",value:v}])))}});
// Leuven: council (abstract body gr, its 2025 version gr25), college (cbs25); a police council that must never be asked for
const BODIES=[{u:"gr",cls:"Gemeenteraad",unit:"Leuven"},{u:"gr25",cls:"Gemeenteraad",unit:"Leuven"},{u:"cbs25",cls:"College van Burgemeester en Schepenen",unit:"Leuven"},
  {u:"rmw25",cls:"Raad voor Maatschappelijk Welzijn",unit:"Leuven"}];
const S=(id,gb,date,started=true)=>({type:"sessions",id,attributes:{"planned-start":date,...(started?{"started-at":date}:{})},relationships:{"governing-body":{data:{type:"governing-bodies",id:gb}}}});
const I=(id,title,sessions,links=[])=>({type:"agenda-items",id,attributes:{title,"alternate-link":links},relationships:{sessions:{data:sessions.map(s=>({type:"sessions",id:s}))}}});
function services({down=[],accept=[]}={}){
  const calls=[];
  const fetchImpl=async(url,init)=>{
    const u=new URL(url);calls.push(u);
    if(down.includes(u.hostname))return new Response("busy",{status:503});
    if(u.hostname==="data.lblod.info"){
      accept.push(init?.headers?.accept);
      assert.equal(u.pathname,"/sparql");
      const q=u.searchParams.get("query");
      if(/SELECT DISTINCT \?label/.test(q))return sp(NAMES.map(label=>({label})));
      if(/VALUES \?name/.test(q)){assert.match(q,/"Leuven"/);assert.match(q,/FILTER\(\?ecls IN \("Gemeente","OCMW"\)\)/);assert.match(q,/isTijdspecialisatieVan/,"per-legislature versions are included");
        return sp(BODIES.map(b=>({u:b.u,cls:b.cls,unit:b.unit})))}
      if(/VALUES \?u/.test(q))return sp([{u:"aar25",cls:"Gemeenteraad",unit:"Aarschot",ecls:"Gemeente",place:"Aarschot"},{u:"tvr",cls:"Gemeenteraad",unit:"Tervuren",ecls:"Gemeente",place:"Tervuren"}]);
      throw new Error("unexpected query "+q);
    }
    const p=Object.fromEntries(u.searchParams);
    if(u.pathname==="/agenda-items"&&p["filter[sessions][governing-body][:id:]"]){
      const ids=p["filter[sessions][governing-body][:id:]"].split(",");
      const want=p.body||null;
      assert.ok(ids.includes("gr")&&ids.includes("gr25"),"asked by the governing bodies from the register");
      if(p["filter[title]"]==="verkeersdrempel")assert.equal(p["page[size]"],"100","several words: the newest 100 are checked");
      const items=p["filter[title]"]==="niets"?[]:[
        I("i1","2026_CBS_1 - Verkeersdrempel Kerkstraat - Goedkeuring",["s1"],["https://leuven/besluitenlijst"]),
        I("i2","2026_CBS_1 - Verkeersdrempel Kerkstraat - Goedkeuring",["s1b"],["https://leuven/agendapunten/9"]),
        I("i3","2026_GR_7 - Verkeersdrempel Naamsestraat",["s2"]),
        I("i4",null,["s3"])];
      return json({data:items,meta:{count:items.length?1234:0},included:[S("s1","cbs25","2026-08-28T09:00:00+02:00"),S("s1b","cbs25","2026-08-28T09:00:00+02:00"),S("s2","gr25","2026-08-24T20:00:00+02:00"),S("s3","gr25","2026-12-14T20:00:00+01:00",false)]});
    }
    if(u.pathname==="/sessions")return json({data:[{type:"sessions",id:"s9",attributes:{"planned-start":"2026-09-04T09:00:00+02:00"}}],meta:{count:154}});
    if(u.pathname==="/search/agenda-items/search"){
      assert.match(p["filter[:query:search_content]"],/\(title:"zonnepanelen" OR description:"zonnepanelen"\)/);
      assert.match(p["filter[:query:session_planned_start]"],/^session_planned_start:\[2026-01-01 TO \d{4}-\d{2}-\d{2}\]$/,"no far-future placeholder dates");
      return json({count:3309,data:[{attributes:{uuid:["x1"]}},{attributes:{uuid:"x2"}}]});
    }
    if(u.pathname==="/agenda-items"&&p["filter[:id:]"])return json({data:[I("x1","Zonnepanelen op sporthal",["t1"],["https://aarschot/agendapunten/1"]),I("x2","Zonnepanelen school",["t2"])],
      included:[S("t1","aar25","2026-10-15T20:00:00+02:00"),S("t2","tvr","2026-09-01T20:00:00+02:00")]});
    if(u.pathname==="/agenda-items/v1")return json({data:{type:"agenda-items",id:"v1",attributes:{title:"Aanduiding vertegenwoordigers",description:"d","planned-public":true,"alternate-link":["https://tervuren/agendapunten/1","https://tervuren/notulen"]},
        relationships:{sessions:{data:[{type:"sessions",id:"t2"}]},"handled-by":{data:{type:"agenda-item-handlings",id:"h1"}}}},
      included:[S("t2","tvr","2025-02-27T20:00:00+01:00"),{type:"agenda-item-handlings",id:"h1",attributes:{public:true},relationships:{resolutions:{data:[{type:"resolutions",id:"r1"}]},"has-votes":{data:[{type:"votes",id:"v1"},{type:"votes",id:"v2"}]}}},
        {type:"resolutions",id:"r1",attributes:{description:"De raad duidt drie afgevaardigden aan.",motivation:"Motivering   Aanleiding ..."},relationships:{articles:{data:[{type:"articles",id:"a2"},{type:"articles",id:"a10"}]}}},
        {type:"articles",id:"a2",attributes:{number:"Artikel 2",value:" Twee "}},{type:"articles",id:"a10",attributes:{number:"Artikel 10",value:"Tien"}},
        {type:"votes",id:"v1",attributes:{"number-of-proponents":150,"number-of-opponents":0,"number-of-abstentions":0,secret:true,subject:"Stemming artikel 1"}},
        {type:"votes",id:"v2",attributes:{"number-of-proponents":24,"number-of-opponents":2,"number-of-abstentions":1,secret:false,subject:"Stemming artikel 2"}}]});
    if(u.pathname==="/agenda-items/gone")return new Response("not found",{status:404});
    throw new Error("unexpected call "+url);
  };
  return{fetchImpl,calls};
}
const run=async(args,opts)=>{const s=services(opts);const client=makeDovClient({fetchImpl:s.fetchImpl,hosts:DECISION_HOSTS,maxRequests:6});const out=await localDecisions(client,args);return{out,calls:s.calls,used:client.used}};

// municipality, several words
let accept=[];
let {out,used}=await run({municipality:"Louvain",query:"verkeersdrempel Kerkstraat",limit:5},{accept});
assert.deepEqual(checkAnswer(out),[]);
assert.ok(accept.every(a=>a==="application/sparql-results+json"),"the register is asked for results, not its web page");
assert.equal(out.municipality.name,"Leuven");
assert.equal(out.decisions.length,1,"only items with every word; the duplicate record is folded in");
assert.equal(out.decisions[0].id,"i2");assert.equal(out.decisions[0].body,"College van Burgemeester en Schepenen (college of mayor and aldermen)");
assert.equal(out.decisions[0].official_page,"https://leuven/agendapunten/9");
assert.equal(out.matching_title_word.word,"verkeersdrempel");assert.equal(out.matching_title_word.all_words_matched,2);
assert.equal(out.latest_published_meeting,"2026-09-04");
assert.match(out.key_facts.join(" "),/latest published meeting in Lokaal Beslist is of 2026-09-04/);
assert.ok(used<=6);

// municipality, no words: an untitled item and a meeting still to come
({out}=await run({municipality:"Leuven"}));
assert.equal(out.total_matching,1234);
const future=out.decisions.find(x=>x.id==="i4");assert.equal(future.title,"(no title published)");assert.match(future.status,/still to come/);
assert.match(out.key_facts[0],/1,234 agenda-item records of Leuven's council, college and OCMW are published/);

// nothing found is not "nothing decided"
({out}=await run({municipality:"Leuven",query:"niets"}));
assert.equal(out.decisions,undefined);assert.match(out.key_facts.join(" "),/does not mean nothing was decided/);

// bad arguments
({out}=await run({municipality:"Leuven",body:"police"}));assert.match(out.error,/council, college, social/);
({out}=await run({municipality:"Leuven",from:"1 januari"}));assert.match(out.error,/YYYY-MM-DD/);
({out}=await run({municipality:"Leuven",from:"2026-02-01",to:"2026-01-01"}));assert.match(out.error,/after/);
({out}=await run({}));assert.match(out.error,/municipality, a query/);
({out}=await run({agenda_item_id:"x y"}));assert.match(out.error,/id of an agenda item/);

// Flanders-wide: places come from the register, not the search index
({out}=await run({query:"zonnepanelen",from:"2026-01-01"}));
assert.deepEqual(checkAnswer(out),[]);
assert.equal(out.total_matching,3309);
assert.deepEqual(out.decisions.map(x=>[x.municipality,x.date]),[["Aarschot","2026-10-15"],["Tervuren","2026-09-01"]]);
assert.match(out.key_facts[0],/3,309 agenda items of Flemish local authorities mention 'zonnepanelen'/);

// one item: articles in number order, an impossible vote flagged, other publications kept
({out}=await run({agenda_item_id:"v1"}));
assert.deepEqual(checkAnswer(out),[]);
assert.equal(out.municipality,"Tervuren");assert.equal(out.date,"2025-02-27");
assert.deepEqual(out.decisions[0].articles.map(a=>a.number),["Artikel 2","Artikel 10"]);assert.equal(out.decisions[0].articles[0].text,"Twee");
assert.match(out.decisions[0].motivation,/^Aanleiding/);
assert.match(out.votes[0].doubtful,/more votes \(150\) than any Flemish council has members \(55\)/);assert.equal(out.votes[1].doubtful,undefined);
assert.match(out.key_facts.join(" "),/150 in favour, 0 against, 0 abstained \(impossible count/);
assert.deepEqual(out.other_publications,["https://tervuren/notulen"]);
({out}=await run({agenda_item_id:"gone"}));assert.match(out.error,/No agenda item with id gone/);

// services that do not answer
({out}=await run({municipality:"Leuven"},{down:["data.lblod.info"]}));assert.match(out.error,/organisation register did not answer.*try again in a minute/i);
({out}=await run({municipality:"Leuven"},{down:["lokaalbeslist.vlaanderen.be"]}));assert.match(out.error,/Lokaal Beslist did not answer.*try again in a minute/i);
({out}=await run({query:"zonnepanelen"},{down:["lokaalbeslist.vlaanderen.be"]}));assert.match(out.error,/search did not answer/);

console.log("decisions: all tests passed");
