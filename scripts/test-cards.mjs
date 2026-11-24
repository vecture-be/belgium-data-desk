// Offline tests for dataset cards (scripts/dataset-card.mjs): column profiles, Belgian key detection, freshness, facts, drift.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCard, createColumnProfiler, freshness, profileColumns, setNisReference, validEnterpriseNumber } from "./dataset-card.mjs";

const pub=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../public");
setNisReference(JSON.parse(fs.readFileSync(path.join(pub,"statbel/places-v1.json"),"utf8")).places);

// enterprise numbers: 97 - (first 8 digits mod 97) = last 2 digits
const kbo=b=>{const s=String(b).padStart(8,"0")+String(97-(b%97)).padStart(2,"0");return s.slice(0,4)+"."+s.slice(4,7)+"."+s.slice(7)};
assert.equal(validEnterpriseNumber("0403.170.701"),true,"a real enterprise number");
assert.equal(validEnterpriseNumber("0403.170.702"),false);
assert.equal(validEnterpriseNumber("BE0403170701"),true);

// 1. municipality table: NIS codes (two pre-2025), a year column, a measure, a sparse column and a constant
const nisRows=["11002","44021","21004","62063","92094","71022","44040","11001","23088","57081"];
const csv1="CD_REFNIS;jaar;inwoners;opmerking;bron\n"+nisRows.map((n,i)=>[n,2019+(i%5),String(1000*(i+1)).replace(/(\d)(\d{3})$/,"$1.$2"),i===3?"herzien":"","Statbel"].join(";")).join("\n")+"\n";
const p1=profileColumns(csv1,{bytesRead:csv1.length,totalBytes:csv1.length});
assert.equal(p1.rows,10);assert.equal(p1.rows_exact,true);assert.equal(p1.delimiter,";");
const c=Object.fromEntries(p1.columns.map(x=>[x.name,x]));
assert.equal(c.CD_REFNIS.key.kind,"nis_code");assert.equal(c.CD_REFNIS.key.pre_2025_codes_pct,20,"Hasselt-old 71022 and Melle 44040 are pre-2025");
assert.deepEqual([c.jaar.type,c.jaar.from,c.jaar.to],["year","2019","2023"]);
assert.deepEqual([c.inwoners.type,c.inwoners.min,c.inwoners.max],["integer",1000,10000],"1.000 is a thousand, not one");
assert.equal(c.opmerking.filled_pct,10);assert.equal(c.bron.distinct,1);
// numeric exports lose the leading zero of region codes (02000 -> 2000) or add decimals; padded only for a NIS-named column
assert.equal(profileColumns("NIS_CODE;x\n2000;1\n11001.0;2\n44088;3\n").columns[0].key?.kind,"nis_code");
assert.equal(profileColumns("postcode;x\n2000;1\n9000;2\n1000;3\n").columns[0].key?.kind,"postcode","4-digit postcodes stay postcodes");

// 2. companies: enterprise numbers, European dates, coordinates, a truncated read
const csv2="ondernemingsnummer,startdatum,lat,lon,sector\n"+Array.from({length:40},(_,i)=>[kbo(4000000+i*7919),(i%28+1)+"/0"+(i%9+1)+"/20"+(10+i%15),(50.5+i/100).toFixed(4),(4.3+i/100).toFixed(4),i%3?"retail":"horeca"].join(",")).join("\n")+"\n0999.";
const p2=profileColumns(csv2,{bytesRead:csv2.length,totalBytes:csv2.length*10});
assert.equal(p2.rows_exact,false);assert.equal(p2.rows,40,"the partial last line is dropped");
const c2=Object.fromEntries(p2.columns.map(x=>[x.name,x]));
assert.equal(c2.ondernemingsnummer.key.kind,"enterprise_number");
assert.equal(c2.startdatum.type,"date");assert.equal(c2.startdatum.from,"2010-01-01");
assert.equal(c2.lat.key.kind,"latitude");assert.equal(c2.lon.key.kind,"longitude");
assert.deepEqual(c2.sector.top[0],["retail",26]);

// 3. freshness against the declared EU frequency code
const now="2026-11-10T09:00:00Z";
assert.equal(freshness({frequency:"MONTHLY",updatedAt:"2026-10-20"},{now}).status,"unknown","a catalogue date is not evidence of a content change");
const late=freshness({frequency:"MONTHLY",updatedAt:"2025-01-01"},{fileLastModified:"Tue, 01 Apr 2025 10:00:00 GMT",now});
assert.equal(late.status,"overdue");assert.equal(late.last_change,"2025-04-01");assert.equal(late.overdue_days,543);
assert.equal(freshness({frequency:"IRREG",updatedAt:"2020-01-01"},{now}).status,"unknown","irregular data is never overdue");

// 4. the card: facts carry their evidence, no undefined/NaN, schema drift against the previous card
const rec={id:"national:test-pop",frequency:"ANNUAL",updatedAt:"2024-03-01"};
const card=buildCard(rec,p1,{now,file:{url:"https://example.be/pop.csv",format:"CSV",bytesRead:csv1.length,totalBytes:csv1.length}});
assert.equal(card.freshness.status,"unknown");
assert.equal(card.freshness.last_change,null);
assert.ok(card.facts.length>=5);for(const f of card.facts)assert.ok(f.text.length<300&&f.evidence,"fact with evidence: "+f.text);
const text=card.facts.map(f=>f.text).join(" ");
assert.match(text,/10 rows and 5 columns/);assert.match(text,/from 2019 to 2023/);assert.match(text,/NIS municipality codes \(8 of 10 values read match the 2025 list; 2 are pre-2025 codes/,"few values: counts, not percentages");
assert.match(text,/'opmerking' is empty in 90 %/);assert.match(text,/'bron' has a single value/);
assert.doesNotMatch(JSON.stringify(card),/undefined|NaN|\[object Object\]/);
assert.ok(JSON.stringify(card).length<8000,"cards stay small");
const csv3=csv1.replace("opmerking;bron","remark;source");
const card2=buildCard(rec,profileColumns(csv3,{bytesRead:csv3.length,totalBytes:csv3.length}),{previous:card,now:"2026-11-17T09:00:00Z",file:{}});
assert.deepEqual([card2.schema.added,card2.schema.removed],[["remark","source"],["opmerking","bron"]]);
assert.match(card2.facts.map(f=>f.text).join(" "),/columns changed since 2026-11-10/);
const card3=buildCard(rec,p1,{previous:card,now:"2026-11-17T09:00:00Z",file:{}});
assert.equal(card3.schema.stable_since,"2026-11-10");

console.log(JSON.stringify({ok:true,cards:"profile/keys/freshness/facts/drift",facts:card.facts.length}));

// time coverage is the period the data describes: a record timestamp or a birth date never wins over a reporting year
{
  const csv="datecreation;build_year;jaar;dob;waarde\n2020-01-05;1850;2015;1950-03-01;1\n2026-02-01;1990;2023;1999-12-31;2\n";
  const card=buildCard({id:"t"},profileColumns(csv,{bytesRead:csv.length,totalBytes:csv.length}),{now:"2026-11-10T00:00:00Z",file:{}});
  assert.deepEqual(card.coverage.time,{from:"2015",to:"2023",column:"jaar"});
  const only="created_at;x\n2024-01-01;1\n2024-02-01;2\n";
  assert.equal(buildCard({id:"u"},profileColumns(only,{bytesRead:only.length,totalBytes:only.length}),{now:"2026-11-10T00:00:00Z",file:{}}).coverage.time,null,"a creation timestamp alone gives no coverage");
}
console.log(JSON.stringify({ok:true,coverage:"reporting periods only"}));

// row grain: the label columns that together identify a row, tested on the file
{
  const lines=["maand,postcode,sector,regime,aantal"];let k=0;
  for(const m of ["2024-01","2024-02"])for(const p of ["9300","1000","2000"])for(const s of ["Elektriciteit","Gas"])for(const r of ["Digitaal","Klassiek"])lines.push([m,p,s,r,100+(k++)].join(","));
  const text=lines.join("\n")+"\n",prof=profileColumns(text,{bytesRead:text.length,totalBytes:text.length});
  assert.equal(prof.grain.unique,true);
  assert.deepEqual([...prof.grain.columns].sort(),["maand","postcode","regime","sector"],"the count column is a measure, not a label");
  const card=buildCard({id:"g"},prof,{now:"2026-11-17T00:00:00Z",file:{}});
  assert.ok(card.facts.some(f=>/^Each row is one combination of .* \(tested on all 24 rows\)\.$/.test(f.text)));
  assert.equal(card.coverage.grain.columns.length,4);
  const bad="gemeente,jaar,waarde\n"+[..."ABCDEF"].flatMap((g,i)=>[g+",2020,"+i+".5",g+",2020,"+i+".25"]).join("\n")+"\n";
  const pb=profileColumns(bad,{bytesRead:bad.length,totalBytes:bad.length});
  assert.equal(pb.grain.unique,false);
  assert.ok(buildCard({id:"h"},pb,{now:"2026-11-17T00:00:00Z",file:{}}).facts.some(f=>/^No combination of its label columns identifies each row: by 'gemeente', 6 rows still share their labels/.test(f.text)));
  const tiny="id,naam\n1,a\n2,b\n";
  assert.ok(!buildCard({id:"t"},profileColumns(tiny,{bytesRead:tiny.length,totalBytes:tiny.length}),{now:"2026-11-17T00:00:00Z",file:{}}).facts.some(f=>/combination|label columns/.test(f.text)),"no grain sentence for a handful of rows");
  console.log(JSON.stringify({ok:true,grain:"tested on the file"}));
}


// Regression #56: a publisher can pre-create future months with no measured value.
// Such placeholders must not extend the actual coverage of a time series.
{
  const csv="empty;totaal\n2026-12;\n2026-11;\n2026-10;106591\n2026-09;103297\n";
  const p=profileColumns(csv,{bytesRead:csv.length,totalBytes:csv.length});
  const card=buildCard({id:"harvest:infrabel:total-tractie-permaand"},p);
  assert.deepEqual(card.coverage.time,{from:"2026-09-01",to:"2026-10-01",column:"empty"});
  assert.match(card.facts.map(f=>f.text).join(" "),/to 2026-10-01/);
  const streaming=createColumnProfiler(";");
  streaming.push(csv.slice(0,19));streaming.push(csv.slice(19,41));streaming.push(csv.slice(41));
  assert.deepEqual(buildCard({id:"train"},streaming.finish({exact:true})).coverage.time,card.coverage.time);
  const dateOnly="month\n2026-11\n2026-12\n";
  const justDates=profileColumns(dateOnly,{bytesRead:dateOnly.length,totalBytes:dateOnly.length});
  assert.equal(justDates.columns[0].to,"2026-12-01","single-column date data must remain valid");
}

// Regression #57: VMM agricultural reporting years use '2002-2003' rather than ISO dates.
{
  const csv="Data,gemiddelde nitraatconcentratie\n2002-2003,23.37\n2003-2004,23.46\n2024-2025,16.1\n";
  const p=profileColumns(csv,{bytesRead:csv.length,totalBytes:csv.length});
  assert.equal(p.columns[0].type,"period");
  assert.deepEqual(buildCard({id:"national:vmm-nitrate"},p).coverage.time,{from:"2002",to:"2025",column:"Data"});
  const notPeriod="Data,waarde\n2002-2005,1\n2004-2008,2\n";
  assert.equal(buildCard({id:"other"},profileColumns(notPeriod)).coverage.time,null,"nonconsecutive year-like codes are not assumed to be reporting years");
}
console.log(JSON.stringify({ok:true,regressions:"blank future periods and reporting-year ranges"}));

// "3.775" / "98,125": one separator and three digits is a decimal or a thousands group; the column decides (found on live cards:
// Ghent longitudes read as 3775, Infrabel punctuality as 98125 %)
{
  const col=(csv,name)=>profileColumns(csv).columns.find(c=>c.name===name);
  const csv="id;lon;lat;pct;cnt;amt\n1;3.775;51.075;98,125;1.234;1.000\n2;3.7751234;51.0123;71,59;999;12.500\n3;3.70001;50.99;80,1;12.345.678;3.750\n";
  assert.deepEqual([col(csv,"lon").min,col(csv,"lon").max],[3.70001,3.7751234],"a longitude column keeps 3.775 a decimal");
  assert.equal(col(csv,"lat").max,51.075);assert.equal(col(csv,"pct").max,98.125);
  assert.deepEqual([col(csv,"cnt").type,col(csv,"cnt").max],["integer",12345678],"grouped counts stay thousands");
  assert.deepEqual([col(csv,"amt").type,col(csv,"amt").min,col(csv,"amt").max],["integer",1000,12500],"1.000 is a thousand");
  assert.equal(col("id;x\n1;1 234\n2;5.678\n","x").max,5678,"space-grouped numbers mark the column as grouped");
  assert.equal(col("id;latitude;longitude\n1;51.075;3.775\n2;51.0123;3.7751\n","latitude").key?.kind,"latitude","three-decimal degrees are coordinates");
}
// repairs: values written wrongly are read the way they were meant, and the card says what was changed
{
  const card=buildCard({id:"x"},profileColumns("id;lat;long;floors;lengte\n1;4.21;50.52;-999;11240\n2;4.27;50.57;3;5\n3;4.25;50.55;2;7\n"));
  assert.deepEqual(card.repairs.coordinates.how,{swapped:3},"Seneffe-style swapped axes are read swapped back");
  assert.deepEqual(card.repairs.missing_codes,[{column:"floors",codes:[-999],rows:1}]);
  assert.deepEqual([card.columns.find(c=>c.name==="floors").min,card.columns.find(c=>c.name==="floors").max],[2,3],"ranges leave the code out");
  assert.equal(card.quality.suspect_values,undefined,"the repairs replace the min/max flags; 'lengte' is a length, not a longitude");
  assert.ok(card.facts.some(f=>/100 % of the 3 rows can be mapped, 0 % as published and 100 % latitude and longitude swapped back/.test(f.text)));
  assert.ok(card.facts.some(f=>/'floors' uses -999 for a missing value in 1 row/.test(f.text)));
  const lambert=buildCard({id:"y"},profileColumns("id;latitude;longitude\n1;150234.5;170123.2\n2;151000.1;171000.9\n"));
  assert.equal(lambert.repairs.coordinates.how.lambert72,2,"Lambert 72 metres in degree columns are converted");
  assert.equal(buildCard({id:"z"},profileColumns("id;lat;lon\n1;50.85;4.35\n2;51.2;4.4\n")).repairs,undefined,"nothing to repair, nothing said");
  assert.equal(buildCard({id:"c"},profileColumns("id;code;v\n1;99999;1\n2;45;2\n")).repairs,undefined,"a code column keeps 99999");
  assert.deepEqual(buildCard({id:"e"},profileColumns("id;price\n1;-999\n2;-500\n3;254\n")).columns[1].min,-999,"-999 near the rest of the column is a value");
  // old profiles (no row-level repairs) keep the min/max flags, minus 'not in degrees' before the decimal fix
  const old={...profileColumns("id;latitude;longitude\n1;150234.5;170123.2\n2;151000.1;171000.9\n")};delete old.repairs;
  assert.equal(buildCard({id:"y"},old).quality.suspect_values[0].kind,"not_degrees");
  assert.equal(buildCard({id:"y"},old,{now:"2026-11-17T09:00:00Z"}).quality.suspect_values,undefined,"profiles from before the decimal fix may hold 3775 for 3.775");
}
console.log(JSON.stringify({ok:true,numbers:"ambiguous separators per column; suspect values"}));
// postcodes a numeric export wrote as 9000.0 are still postcodes (Ghent school finder)
assert.equal(profileColumns("id;postcode\n1;9000.0\n2;9050.0\n3;9031.0\n").columns[1].key?.kind,"postcode");
