// Offline tests for train_punctuality: station names, the measurement rules and the judgements that keep its answers true, on synthetic
// answers shaped like Infrabel's Explore API v2.1 (the recorded fixture covers the real shapes).
import assert from "node:assert/strict";
import { makeDovClient } from "../dov.mjs";
import { trainPunctuality, matchStation, normIc, fmtRel, TRAIN_HOSTS } from "../trains.mjs";
import { atTime } from "../lib/fixtures.mjs";
import { checkAnswer } from "../lib/tool-contract.mjs";

// ---- names
const S=(nl,fr,en,tel)=>({nl,fr:fr||nl,en:en||nl,tel});
const stops=[S("LEUVEN","LOUVAIN","LEUVEN",11000),S("LOUVAIN-LA-NEUVE",null,null,2000),S("LIEGE-GUILLEMINS",null,null,11000),S("LIEGE-CARRE",null,null,6000),
  S("BRUSSEL-ZUID","BRUXELLES-MIDI","BRUSSELS-SOUTH",27000),S("BRUSSEL-NOORD","BRUXELLES-NORD","BRUSSELS-NORTH",27000),S("ANTWERPEN-CENTRAAL","ANVERS-CENTRAL",null,12000),
  S("ANTWERPEN-BERCHEM","ANVERS-BERCHEM",null,9000),S("MONS",null,null,5000),S("GENT-SINT-PIETERS",null,null,12000),S("GENT-DAMPOORT",null,null,5000)];
const nameOf=q=>matchStation(stops,q).stop?.nl;
assert.equal(nameOf("Louvain"),"LEUVEN");
assert.equal(nameOf("Louvain-la-Neuve"),"LOUVAIN-LA-NEUVE","a real name that starts with an exonym is not translated");
assert.equal(nameOf("Luik-Guillemins"),"LIEGE-GUILLEMINS");assert.equal(nameOf("Liège"),"LIEGE-GUILLEMINS");
assert.equal(nameOf("Brussels South"),"BRUSSEL-ZUID");assert.equal(nameOf("Bruxelles-Midi"),"BRUSSEL-ZUID");
assert.equal(nameOf("Antwerp"),"ANTWERPEN-CENTRAAL");assert.equal(nameOf("Bergen"),"MONS");assert.equal(nameOf("Gand"),"GENT-SINT-PIETERS");
assert.match(matchStation(stops,"Brussel").error,/several stations: Brussel-Zuid, Brussel-Noord/,"Brussels is not guessed");
assert.match(matchStation(stops,"Atlantis").error,/No passenger station/);
assert.equal(normIc("ic3"),"IC 03");assert.equal(normIc("IC 16-1"),"IC 16-1");assert.equal(normIc("ICE"),null);
assert.equal(fmtRel("IC 03: GENK -> BLANKENBERGE"),"IC 03 Genk → Blankenberge");

// ---- a synthetic Infrabel
const NOW="2026-11-15T14:20:00Z";
const json=o=>new Response(JSON.stringify(o),{headers:{"content-type":"application/json"}});
const recs=rows=>json({total_count:rows.length,results:rows});
function infrabel({train="local"}={}){
  return async url=>{
    const u=new URL(url),ds=u.pathname.split("/datasets/")[1].split("/")[0],p=Object.fromEntries(u.searchParams),isExport=u.pathname.endsWith("/exports/json");
    if(ds==="maandelijkse-stiptheid-per-stopplaats"){
      if(p.select==="max(datum) as last")return recs([{last:"2026-10-01T00:00:00+00:00"}]);
      if(isExport){assert.equal(p.where,"datum = date'2026-10-01'");
        // 3 stops: an all-stops average must weight by trains (92.9 %), not average the percentages (88.3 %)
        return json([{ptcar_no:715,installatienaam_nederlands:"LEUVEN",installatienaam_frans:"LOUVAIN",installatienaam_engels:"LEUVEN",stiptheid:90,sumoftel:1000,sumofreg:900,geo_point_2d:{lat:50.881,lon:4.716}},
          {ptcar_no:1,installatienaam_nederlands:"GROOT",installatienaam_frans:"GROOT",installatienaam_engels:"GROOT",stiptheid:95,sumoftel:2000,sumofreg:1900,geo_point_2d:{lat:51,lon:4}},
          {ptcar_no:2,installatienaam_nederlands:"KLEIN",installatienaam_frans:"KLEIN",installatienaam_engels:"KLEIN",stiptheid:80,sumoftel:100,sumofreg:80,geo_point_2d:{lat:50.9,lon:4.7}}]);}
      if(p.group_by==="datum")return recs([{datum:"2026-10-01",reg:2880,tel:3100},{datum:"2026-09-01",reg:2900,tel:3000}]);
      return recs([{datum:"2026-10-01",stiptheid:90,sumoftel:1000,sumofreg:900},{datum:"2026-09-01",stiptheid:92,sumoftel:1000,sumofreg:920}]);
    }
    if(ds==="ruwe-gegevens-van-stiptheid-d-1"){
      if(p.where?.startsWith("train_no")){
        if(train==="abroad")return recs([
          {datdep:"2026-11-14",relation:"IC 16-1",relation_direction:"IC 16-1: BRUSSEL-ZUID -> LUXEMBOURG",train_serv:"SNCB/NMBS",ptcar_lg_nm_nl:"BRUSSEL-ZUID",planned_date_dep:"2026-11-14",planned_time_dep:"12:03:00",delay_dep:30},
          {datdep:"2026-11-14",relation:"IC 16-1",relation_direction:"IC 16-1: BRUSSEL-ZUID -> LUXEMBOURG",train_serv:"SNCB/NMBS",ptcar_lg_nm_nl:"BRUSSEL-CENTRAAL",planned_date_arr:"2026-11-14",planned_time_arr:"12:06:00",delay_arr:55,planned_date_dep:"2026-11-14",planned_time_dep:"12:07:00",delay_dep:107},
          // arrives early at NAMUR, leaves on time after its dwell: the dwell is not "time lost"
          {datdep:"2026-11-14",relation:"IC 16-1",relation_direction:"IC 16-1: BRUSSEL-ZUID -> LUXEMBOURG",train_serv:"SNCB/NMBS",ptcar_lg_nm_nl:"NAMUR",planned_date_arr:"2026-11-14",planned_time_arr:"13:00:00",delay_arr:-180,planned_date_dep:"2026-11-14",planned_time_dep:"13:03:00",delay_dep:60},
          {datdep:"2026-11-14",relation:"IC 16-1",relation_direction:"IC 16-1: BRUSSEL-ZUID -> LUXEMBOURG",train_serv:"SNCB/NMBS",ptcar_lg_nm_nl:"JAMBES-EST",planned_date_arr:"2026-11-14",planned_time_arr:"13:06:00",delay_arr:120,planned_date_dep:"2026-11-14",planned_time_dep:"13:06:00",delay_dep:120},
          {datdep:"2026-11-14",relation:"IC 16-1",relation_direction:"IC 16-1: BRUSSEL-ZUID -> LUXEMBOURG",train_serv:"SNCB/NMBS",ptcar_lg_nm_nl:"ARLON",planned_date_arr:"2026-11-14",planned_time_arr:"14:30:00",delay_arr:600}]);
        return recs([]);
      }
      if(p.select?.startsWith("max(datdep)"))return recs([{day:"2026-11-14T00:00:00+00:00",passes:120,arrivals:100,avg_arr:150,departures:110}]);
      if(p.group_by?.startsWith("train_serv"))return recs([{train_serv:"SNCB/NMBS",band:"[*, 59]",n:60},{train_serv:"SNCB/NMBS",band:"[60, 359]",n:30},{train_serv:"SNCB/NMBS",band:"[360, 899]",n:2},
        {train_serv:"EUROSTAR",band:"[900, *]",n:8}]);
      return recs([{train_no:"9316",relation_direction:"EURST: AMSTERDAM CENTRAAL -> PARIS-NORD",train_serv:"EUROSTAR",planned_time_arr:"09:06:00",delay_arr:19080}]);
    }
    if(ds==="data_punctualite_trainic"){
      if(p.where.includes("IC 99"))return recs([]);
      return recs([{maand:"2026-10-01",relatie:"IC 01",op_stat:"OOSTENDE",regelmaat:88,tel:1000,reg:880,min_rt:1},{maand:"2026-10-01",relatie:"IC 01",op_stat:"EUPEN",regelmaat:84,tel:500,reg:420,min_rt:1}]);
    }
    if(ds==="stiptheid-van-ic-relatie-per-moment")return recs([{maand:"2026-10-01",relatie:"IC 01",op_stat:"EUPEN",moment_of_day:"Weekends",regelmaat:80,tel:100},{maand:"2026-10-01",relatie:"IC 01",op_stat:"EUPEN",moment_of_day:"Morning peak hour",regelmaat:95,tel:100}]);
    if(ds==="nationale-stiptheid-per-maand")return recs(Array.from({length:13},(_,i)=>({maand:new Date(Date.UTC(2026,9-i,1)).toISOString().slice(0,7),regelmaat:i===12?89.8:91.2,regelmaatneutralisatie:94.3,tel:118108,reg:107723,min_rt:226808,regelmaat_ytd:92.9})));
    if(ds==="nationale-stiptheid-met-afgeschafte-treinen")return recs([{maand2:"2026-10",id:88.3,tel:121000}]);
    if(ds==="data_punctualite_typedetrain")return recs([{maand:"2026-10",rel:"IC",regelmaat:88.7,tel:48969},{maand:"2026-10",rel:"L",regelmaat:93.1,tel:62604}]);
    if(ds==="oorzaken-vertraging-per-maand")return recs([{jaar_maand:"2026-10",responsible:"Infrabel",stiptheidsverlies:1.14,aandeel:12.9},{jaar_maand:"2026-10",responsible:"SNCB/NMBS",stiptheidsverlies:3.46,aandeel:39.4}]);
    if(ds==="maandelijks-afgeschafte-treinen-per-operator")return recs([{maand:"2026-10",operator_en:"SNCB",enigetreinen:100000,sups:2000,totaal:1500,partieel:500,sup0:2}]);
    if(ds==="realtime-stiptheid")return recs([{uur:"2026-11-15T14:15:39+00:00",tot_aantalmetingen:1347,tot_aantal_6:1302,stiptheid:96.66}]);
    if(ds==="stiptheid-van-vandaag-per-uur")return recs([{intervallehoraire:"[08h-09h]",aantalmetingen:150,uur_stiptheid:95.3},{intervallehoraire:"[05h-06h]",aantalmetingen:20,uur_stiptheid:90}]);
    throw new Error("unexpected "+url);
  };
}
const run=(args,opts)=>atTime(NOW,()=>trainPunctuality(makeDovClient({fetchImpl:infrabel(opts),hosts:[...TRAIN_HOSTS,"geo.api.vlaanderen.be","best.pr.fedservices.be"],maxRequests:12}),args));

{ // station: weighted all-stops average, rank only among stops with >= 500 trains, SNCB share beside an international disaster
  const out=await run({station:"Louvain"});
  assert.deepEqual(checkAnswer(out),[]);
  assert.equal(out.month.all_stops_pct,92.9,"weighted by trains, not the mean of percentages");
  assert.equal(out.month.rank,2);assert.equal(out.month.ranked_stops,2,"the 100-train stop is not ranked");
  assert.equal(out.yesterday.on_time,90);assert.equal(out.yesterday.arrivals_measured,100);
  assert.match(out.key_facts.find(f=>f.startsWith("Yesterday")),/90 of 100 measured arrivals on time \(90 %; SNCB trains only: 97\.8 % of 92\)/);
  assert.match(out.key_facts.find(f=>f.startsWith("Most delayed")),/train 9316 \(EURST Amsterdam Centraal → Paris-Nord, due 09:06\) 318 min late/);
  assert.match(out.key_facts.at(-1),/not comparable with the national figure/);
}
{ // a train to Luxembourg: the last Belgian point is not its destination, so no on-time verdict there; a dwell after an early arrival is not lost time
  const out=await run({train_number:"2112"},{train:"abroad"});
  assert.equal(out.train.on_time_at_destination,undefined);assert.equal(out.train.continues_abroad_to,"Luxembourg");assert.equal(out.train.last_belgian_point_delay_min,10);
  assert.match(out.key_facts[0],/passed Arlon, its last point on the Belgian network \(it continues to Luxembourg/);
  assert.doesNotMatch(out.key_facts[0],/6-minute rule/);
  assert.match(out.key_facts[1],/Brussel-Centraal, its first Brussels North-South junction stop/);
  assert.equal(out.train.largest_loss.between,"Jambes-Est and Arlon","Namur's early arrival (-3 min) then a punctual departure is not a 5-minute loss");
}
{ // unknown train, invalid inputs
  assert.match((await run({train_number:"99999"})).error,/does not appear in Infrabel's data for yesterday/);
  assert.match((await run({train_number:"IC 2112"})).error,/digits only/);
  assert.match((await run({month:"2026-13"})).error,/2026-10/);
  assert.match((await run({ic_line:"ICE"})).error,/IC 01/);
  assert.match((await run({ic_line:"IC 99"})).error,/no punctuality for IC 99/);
}
{ // IC line: per direction, ordered moments, national context
  const out=await run({ic_line:"ic1"});
  assert.match(out.key_facts[0],/^IC 01 in October 2026: 86\.7 % of 1,500 trains arrived less than 6 minutes late \(national figure 91\.2 %\); towards Oostende 88 %, towards Eupen 84 %\.$/);
  assert.match(out.key_facts[1],/^By time of day: morning peak hour 95 %, weekends 80 %\.$/);
}
{ // national: cancellations, a year earlier, causes, today with the hours sorted
  const out=await run({});
  assert.match(out.key_facts[0],/91\.2 % of 118,108 trains .*88\.3 % when cancelled trains count as late/);
  assert.match(out.key_facts[1],/A year earlier \(October 2025\): 89\.8 %/);
  assert.match(out.key_facts.find(f=>f.startsWith("Punctuality lost")),/SNCB\/NMBS 3\.46 points, Infrabel 1\.14 points \(of 8\.8 points lost in total\)/);
  assert.deepEqual(out.today.by_hour.map(h=>h.hour),["[05h-06h]","[08h-09h]"]);
  assert.match(out.key_facts.find(f=>f.startsWith("Today")),/to 15:15 Brussels time/);
}
console.log(JSON.stringify({ok:true,tests:"train_punctuality names, measurement rules, judgements"}));
