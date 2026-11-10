// Offline tests for dataset cards (scripts/dataset-card.mjs): column profiles, Belgian key detection, freshness, facts, drift.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCard, freshness, profileColumns, setNisReference, validEnterpriseNumber } from "./dataset-card.mjs";

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
assert.equal(freshness({frequency:"MONTHLY",updatedAt:"2026-10-20"},{now}).status,"current");
const late=freshness({frequency:"MONTHLY",updatedAt:"2025-01-01"},{fileLastModified:"Tue, 01 Apr 2025 10:00:00 GMT",now});
assert.equal(late.status,"overdue");assert.equal(late.last_change,"2025-04-01");assert.equal(late.overdue_days,543);
assert.equal(freshness({frequency:"IRREG",updatedAt:"2020-01-01"},{now}).status,"unknown","irregular data is never overdue");

// 4. the card: facts carry their evidence, no undefined/NaN, schema drift against the previous card
const rec={id:"national:test-pop",frequency:"ANNUAL",updatedAt:"2024-03-01"};
const card=buildCard(rec,p1,{now,file:{url:"https://example.be/pop.csv",format:"CSV",bytesRead:csv1.length,totalBytes:csv1.length}});
assert.equal(card.freshness.status,"overdue");
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
