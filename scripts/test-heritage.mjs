// heritage_at_location against a synthetic Mercator WFS: the point is sent with its SRID to every layer in one request, designations
// are ordered by legal strength with what they mean, protected vs fixed vs inventoried-only, archaeology zone vs no-archaeology area,
// nearby monuments that are not at the point, regions outside Flanders, and a service that answers only in part.
import assert from "node:assert/strict";
import { makeDovClient } from "../dov.mjs";
import { HERITAGE_HOSTS, heritageAtLocation, outsideFlanders, designationView, DESIGNATIONS } from "../heritage.mjs";
import { checkAnswer } from "../lib/tool-contract.mjs";

// ---- regions
assert.equal(outsideFlanders({nis_code:"24062",region:"Vlaams Gewest"}),null,"Leuven");
assert.equal(outsideFlanders({nis_code:"23106"}),null,"Pajottegem (Flemish Brabant)");
assert.match(outsideFlanders({nis_code:"21004",region:"Brussels Hoofdstedelijk Gewest",municipality:"Brussel"}),/urban\.brussels/);
assert.match(outsideFlanders({nis_code:"25072",municipality:"Wavre"}),/AWaP/,"Walloon Brabant");
assert.match(outsideFlanders({nis_code:"92094",municipality:"Namur"}),/AWaP/);
assert.equal(outsideFlanders(null),null,"no place known: the box check already ran");

// ---- the layer list
assert.equal(new Set(DESIGNATIONS.map(d=>d[1])).size,DESIGNATIONS.length,"one kind per layer");
assert.equal(designationView({layer:"ps_unknown",p:{}}),null);
assert.equal(designationView({layer:"ps_bes_monument",p:{naam:"X",url:"javascript:alert(1)"}}).url,undefined,"only https links are passed on");

// ---- a synthetic Mercator
const json=o=>new Response(JSON.stringify(o),{headers:{"content-type":"application/json"}});
const F=(layer,id,p)=>({type:"Feature",id:layer+"."+id,properties:p});
function mercator({answer,downSecond=false}){
  const calls=[];
  return{calls,fetchImpl:async url=>{
    const u=new URL(url),p=Object.fromEntries(u.searchParams);calls.push(p);
    assert.equal(u.pathname,"/raadpleegdienstenmercatorpubliek/wfs");
    const types=p.typeNames.match(/\(([^)]+)\)/g).map(s=>s.slice(1,-1)),cql=p.cql_filter.split(/;(?!POINT)/);   // EWKT "SRID=31370;POINT" carries a ; of its own
    assert.equal(types.length,cql.length,"one filter per layer");
    assert.equal(p.propertyName.match(/\(/g).length,types.length,"one property list per layer");
    for(const c of cql)assert.match(c,/SRID=31370;POINT\(\d+\.\d\d \d+\.\d\d\)/,"the point carries its SRID (layers are in Lambert 72 and 2008)");
    if(types.includes("ps:ps_bes_monument")&&types.includes("ps:ps_vast_be"))return json({type:"FeatureCollection",features:answer.legal});
    if(downSecond)return new Response("busy",{status:503});
    assert.match(cql[0],/^DWITHIN\(geom,SRID=31370;POINT\([^)]+\),15,meters\)$/);
    return json({type:"FeatureCollection",features:answer.extra});
  }};
}
const run=async(answer,opts={},args={latitude:51.2087,longitude:3.2246})=>{const m=mercator({answer,...opts});const client=makeDovClient({fetchImpl:m.fetchImpl,hosts:HERITAGE_HOSTS,maxRequests:6});
  const out=await heritageAtLocation(client,args,{});return{out,calls:m.calls,used:client.used}};

// Bruges' Markt: protected monument + townscape + fixed inventory + archaeology zone + UNESCO; one monument nearby, one duplicate row
const MARKT={legal:[
  F("ps_vast_az",1,{aanduid_id:11880,naam:"Historische stadskern van Brugge",geld_start:"2016-02-19",url:"https://inventaris.onroerenderfgoed.be/aanduidingsobjecten/11880"}),
  F("ps_vast_be",2,{aanduid_id:150833,naam:"Neogotisch administratiegebouw",geld_start:"2024-05-14"}),
  F("ps_bes_sd_gezicht",3,{aanduid_id:15075,naam:"Markt en Burg met omgeving",geld_start:"2017-03-15"}),
  F("ps_unesco_kern",4,{aanduid_id:15044,naam:"Historische stadskern van Brugge"}),
  F("ps_bes_monument",5,{aanduid_id:11464,naam:"Neogotisch administratiegebouw",geld_start:"2002-03-28",locatie:"Markt 1 (Brugge)",url:"https://inventaris.onroerenderfgoed.be/aanduidingsobjecten/11464"}),
  F("ps_bes_monument",6,{aanduid_id:11464,naam:"Neogotisch administratiegebouw",geld_start:"2002-03-28"})],
 extra:[F("lu_wet_bk_el_pub",1,{erfgoed_id:29454,naam:"Neogotisch administratiegebouw",b_toestand:"Bewaard"}),
  F("am_archnts",1,{naam:"Markt heraanleg",type_naam:"archeologienota",datum_ind:"2019-05-02",opgraving:true,mtrgl_geen:false}),
  F("ps_bes_monument",1,{aanduid_id:11464,naam:"Neogotisch administratiegebouw"}),F("ps_bes_monument",2,{aanduid_id:999,naam:"Provinciaal Hof"})]};
let {out,calls,used}=await run(MARKT);
assert.deepEqual(checkAnswer(out),[]);
assert.equal(calls.length,2,"all legal layers in one request, the rest in a second");assert.ok(used<=6);
assert.deepEqual(out.designations.map(d=>d.kind),["protected_monument","protected_townscape","unesco_core","fixed_built_heritage","fixed_archaeological_zone"],"strongest first, duplicates folded");
assert.equal(out.protected,true);assert.equal(out.legal_effects,true);
assert.match(out.designations[0].means,/^Legally protected/);
assert.match(out.key_facts[0],/protected monument 'Neogotisch administratiegebouw' \(since 2002-03-28\) and protected town or village view 'Markt en Burg met omgeving'/);
assert.match(out.key_facts.join(" "),/also on the fixed inventory of built heritage/);
assert.match(out.key_facts.join(" "),/archaeology note even for fairly small parcels/);
assert.match(out.key_facts.join(" "),/UNESCO World Heritage: core zone of 'Historische stadskern van Brugge'/);
assert.deepEqual(out.nearby_protected_monuments.map(n=>n.name),["Provinciaal Hof"],"the monument at the point is not 'nearby'");
assert.deepEqual(out.archaeology_notes[0],{name:"Markt heraanleg",type:"archeologienota",date:"2019-05-02",outcome:"excavation"});
assert.match(out.location.input,/coordinates/);

// fixed only, in an area where no archaeology is expected
({out}=await run({legal:[F("ps_vast_be",1,{aanduid_id:1,naam:"Hoeve"}),F("am_gga_gew_pub",2,{aanduid_id:2,naam:"Industriezone"})],extra:[]}));
assert.equal(out.protected,false);assert.equal(out.legal_effects,true);
assert.match(out.key_facts[0],/is not in protected heritage, but in fixed inventory of built heritage 'Hoeve', which has legal effects/);
assert.match(out.key_facts.join(" "),/no archaeology is expected, so no archaeology note is needed/);

// inventoried only: no legal effect, said so
({out}=await run({legal:[],extra:[F("lu_wet_bk_el_pub",1,{erfgoed_id:5,naam:"Burgerhuis"})]}));
assert.equal(out.protected,false);assert.equal(out.legal_effects,false);
assert.match(out.key_facts[0],/is not in any protected or fixed heritage designation/);
assert.match(out.key_facts.join(" "),/scientific inventory of built heritage \('Burgerhuis'\): recorded for its heritage value, without legal effect/);

// the second request fails: the legal answer stands, the gap is named
({out}=await run(MARKT,{downSecond:true}));
assert.equal(out.complete,false);assert.equal(out.designations.length,5);
assert.match(out.key_facts.join(" "),/Not checked: the scientific inventory/);

// the first request fails: no answer that could read as "not heritage"
{const client=makeDovClient({fetchImpl:async()=>new Response("busy",{status:503}),hosts:HERITAGE_HOSTS,maxRequests:6});
 const o=await heritageAtLocation(client,{latitude:51.2087,longitude:3.2246},{});assert.match(o.error,/did not answer.*try again in a minute/);}

// outside the Flemish box
{const client=makeDovClient({fetchImpl:async()=>{throw new Error("no call expected")},hosts:HERITAGE_HOSTS,maxRequests:6});
 const o=await heritageAtLocation(client,{latitude:50.4669,longitude:4.8675},{});assert.match(o.error,/outside the Flemish Region/);}

console.log("heritage: all tests passed");
