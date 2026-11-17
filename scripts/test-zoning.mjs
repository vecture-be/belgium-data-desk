// zoning_at_location against a synthetic Mercator WFS: the most detailed plan in force wins, drafts and plans with a later procedure
// step are kept apart from plans in force, an adopted plan's earlier participation stage is not a draft, repealed regulations are left
// out, placeholder dates are dropped, permit applicants are never passed on, and a service that answers only in part.
import assert from "node:assert/strict";
import { makeDovClient } from "../dov.mjs";
import { ZONING_HOSTS, zoningAtLocation, rankZones, zoneView, PHASES } from "../zoning.mjs";
import { checkAnswer } from "../lib/tool-contract.mjs";

// ---- ranking and phases
const Z=(dossiertype,naam,d_bs,fase="BG",extra={})=>{if(typeof fase==="object"){extra=fase;fase="BG"}return{dossiertype,naam,d_bs,fase,svnaam:"zone "+naam,algplanid:naam,...extra}};
assert.deepEqual(rankZones([Z("GWP","gwp","1977-04-20"),Z("BPA","bpa","2004-06-01"),Z("gemRUP","rup","2014-09-26")]).map(z=>z.plan),["rup","bpa","gwp"],"RUP over BPA over gewestplan");
assert.deepEqual(rankZones([Z("gemRUP","old","2005-01-01"),Z("gemRUP","new","2020-01-01")]).map(z=>z.plan),["new","old"],"newer plan of the same level first");
assert.deepEqual(rankZones([Z("gemRUP","draft","2026-01-01","VV"),Z("GWP","gwp","1977-04-20")]).map(z=>z.plan),["gwp","draft"],"a draft never outranks a plan in force");
assert.equal(zoneView(Z("BPA","x","1900-01-01")).published,undefined,"1900-01-01 is the register's 'no date'");
assert.equal(zoneView(Z("GWP","x","1977-04-20",{categorie:"WON"})).category,"housing");
assert.equal(zoneView(Z("GWP","x","1977-04-20",{categorie:"ZZZ"})).category,undefined,"an unknown category is not guessed");
assert.equal(zoneView(Z("GWP","x","1977-04-20",{svidlink:"http://insecure"})).rules,undefined,"only https links");
assert.equal(PHASES.VV[0],"draft");assert.equal(PHASES.DV[0],"in_force");assert.equal(PHASES.NA[0],"unclear");

// ---- a synthetic Mercator
const json=o=>new Response(JSON.stringify(o),{headers:{"content-type":"application/json"}});
const F=(layer,i,p)=>({type:"Feature",id:layer+"."+i,properties:p});
const PLANS=[
  F("lu_si_gv",1,{...Z("GWP","origineel gewestplan Leuven","1977-04-20",{categorie:"WON",svnaam:"woongebieden"})}),
  F("lu_si_gv",2,{...Z("gemRUP","GGR-K4 Tiensesteenweg","2014-09-26",{categorie:"WON",svnaam:"Zone voor wonen 1",label:"W1",svidlink:"https://download.dsi.omgeving.vlaanderen.be/x#page=3",algplanid:"RUP_24062_214_00002_00004"})}),
  F("lu_si_ov",1,{dossiertype:"gewRUP",naam:"Afbakening RSG Leuven",fase:"NA",svnaam:"Afbakeningslijn regionaalstedelijk gebied Leuven",d_bs:"2019-07-29"}),
  F("lu_si_ct",1,{dossiertype:"gewRUP",algplanid:"RUP_A",naam:"Afbakening RSG Leuven",fase:"NA",d_bs:"2019-07-29"}),
  F("lu_si_ct",2,{dossiertype:"gemSVO",algplanid:"SVO_E",naam:"Stedenbouwkundige Verordening Erfgoed",fase:"DV",d_bs:"2018-12-27"}),
  F("lu_si_ct",3,{dossiertype:"proSVO",algplanid:"SVO_H",naam:"Provinciale verordening hemelwater",fase:"DV",d_bs:null}),
  F("lu_si_ct",4,{dossiertype:"gewSVO",algplanid:"SVO_T",naam:"Gewestelijke stedenbouwkundige verordening inzake toegankelijkheid",fase:"BG"}),
  F("lu_si_ct",5,{dossiertype:"gewSVO",algplanid:"SVO_O",naam:"OPGEHEVEN: Gewestelijke verordening hemelwaterputten",fase:"BG"}),
  F("lu_si_ct",6,{dossiertype:"gemONT",algplanid:"ONT_1",naam:"Onteigeningsplan Kerkstraat",fase:"BG",d_bs:"2010-01-01"}),
  F("lu_si_ct",7,{dossiertype:"gemRUP",algplanid:"RUP_K",naam:"RUP Kernversterking",fase:"VV",d_bs:null}),
  F("lu_si_participatie_ct",1,{dossiertype:"proSVO",algplanid:"SVO_H",naam:"Provinciale verordening hemelwater",fase:"ADV",d_participatie:"2022-09-23"}),
  F("lu_si_participatie_ct",2,{dossiertype:"gemRUP",algplanid:"RUP_K",naam:"RUP Kernversterking",fase:"VV",d_participatie:"2026-03-25",termijn:"60 dagen"})];
const PERMITS=[
  F("lu_omv_gd_v2",1,{projectnummer:"2018001699",project_type_code:"OMV2017_AANVRAAG",omschrijving_projecttype:"Aanvraag omgevingsproject",handeling_omschrijving:"Bouwen of herbouwen",aanvrager:"Jan Peeters",datum_indiening:"2018-01-15",huidige_toestand:"Vergunning",datum_huidige_toestand:"2018-05-18",vvo_huidige_toestand:"Leuven",project_link:"https://omgevingsloket.omgeving.vlaanderen.be?project=2018001699"}),
  F("lu_omv_vk_v2",1,{projectnummer:"2023000001",project_type_code:"OMV2017_VK_NIEUW",omschrijving_projecttype:"Aanvraag nieuwe verkaveling",aanvrager:"Bouwbedrijf NV",datum_indiening:"2023-02-01",huidige_toestand:"Weigering"}),
  F("lu_omv_gd_v2",2,{projectnummer:"2018001699",datum_indiening:"2018-01-15"})];
function mercator({downPermits=false}={}){
  return async url=>{
    const u=new URL(url),p=Object.fromEntries(u.searchParams);
    assert.equal(u.pathname,"/raadpleegdienstenmercatorpubliek/wfs");
    const types=p.typeNames.match(/\(([^)]+)\)/g).map(s=>s.slice(1,-1)),cql=p.cql_filter.split(/;(?!POINT)/);
    assert.equal(types.length,cql.length);
    for(const c of cql)assert.match(c,/SRID=31370;POINT\(\d+\.\d\d \d+\.\d\d\)/,"the point carries its SRID (the plan layers are in Lambert 2008)");
    assert.ok(!/aanvrager/.test(p.propertyName),"the applicant is never asked for");
    if(types.includes("lu:lu_si_gv")){assert.match(cql[0],/^INTERSECTS\(geometrie,/);return json({type:"FeatureCollection",features:PLANS})}
    if(downPermits)return new Response("busy",{status:503});
    assert.match(cql[0],/^DWITHIN\(geom,/);
    return json({type:"FeatureCollection",features:PERMITS});
  };
}
const run=async(opts={},args={x_lambert72:176100.5,y_lambert72:173900.25})=>{const client=makeDovClient({fetchImpl:mercator(opts),hosts:ZONING_HOSTS,maxRequests:6});
  return{out:await zoningAtLocation(client,args,{}),used:client.used}};

let {out,used}=await run();
assert.deepEqual(checkAnswer(out),[]);assert.ok(used<=6);
assert.equal(out.applies.plan,"GGR-K4 Tiensesteenweg");assert.equal(out.applies.code,"W1");assert.equal(out.applies.in_force,true);
assert.match(out.applies.rules,/^https:\/\/download\.dsi/);
assert.match(out.key_facts[0],/lies in 'Zone voor wonen 1' \(W1\), a housing zone, of the municipal spatial implementation plan \(RUP\) 'GGR-K4 Tiensesteenweg' \(published 2014-09-26\)/);
assert.match(out.key_facts[1],/^Underneath: 'woongebieden' in the regional zoning plan/);
assert.deepEqual(out.plans_in_procedure.map(d=>d.name),["RUP Kernversterking"],"the adopted rainwater regulation's old participation stage is not a draft; the RUP in procedure is listed once");
assert.equal(out.plans_in_procedure[0].participation_period,"60 dagen");
assert.deepEqual(out.other_plans.map(p=>p.name),["Afbakening RSG Leuven"],"NA: published, effect to check");
assert.deepEqual(out.regulations.municipal_and_provincial.map(r=>r.name),["Stedenbouwkundige Verordening Erfgoed","Provinciale verordening hemelwater"]);
assert.equal(out.regulations.regional_count,1);assert.equal(out.regulations.repealed_left_out,1);
assert.match(out.key_facts.join(" "),/An expropriation plan covers this point/);
assert.match(out.key_facts.join(" "),/1 plan or regulation still in procedure covers this point, e.g. 'RUP Kernversterking'/);
assert.match(out.key_facts.join(" "),/2 municipal or provincial regulations apply here/);
assert.equal(out.permit_applications.count,2,"one project listed once");
assert.deepEqual(out.permit_applications.newest.map(p=>[p.project,p.status,p.subdivision??false]),[["2023000001","refused (Weigering)",true],["2018001699","permit granted (Vergunning)",false]]);
assert.ok(!JSON.stringify(out).includes("Peeters")&&!JSON.stringify(out).includes("Bouwbedrijf"),"no applicant in the answer");
assert.match(out.key_facts.at(-1),/^2 permit applications filed through the Omgevingsloket since 2017 cover this point; the newest: 2023-02-01/);

// permits do not answer: the planning answer stands, the gap is named
({out}=await run({downPermits:true}));
assert.equal(out.complete,false);assert.equal(out.applies.plan,"GGR-K4 Tiensesteenweg");
assert.match(out.key_facts.at(-1),/Not checked: permit applications/);

// plans do not answer: no answer that could read as "no zoning"
{const client=makeDovClient({fetchImpl:async()=>new Response("busy",{status:503}),hosts:ZONING_HOSTS,maxRequests:6});
 const o=await zoningAtLocation(client,{x_lambert72:176100,y_lambert72:173900},{});assert.match(o.error,/did not answer.*try again in a minute/);}
// outside the Flemish box
{const client=makeDovClient({fetchImpl:async()=>{throw new Error("no call expected")},hosts:ZONING_HOSTS,maxRequests:6});
 const o=await zoningAtLocation(client,{latitude:50.4669,longitude:4.8675},{});assert.match(o.error,/outside the Flemish Region/);}

console.log("zoning: all tests passed");
