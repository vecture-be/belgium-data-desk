// Classification tests: keep the existing row-difference engine, avoid duplicate version models.
import assert from 'node:assert/strict';
import {buildCards} from './build-cards.mjs';
import {classifyVersionChange} from './version-intelligence.mjs';

const record={id:'national:belgian-population',title:'Population by municipality',publisher:'Statbel'};
const url='https://statbel.fgov.be/data.csv';
const old='2026-11-14T01:00:00Z',now='2026-11-20T01:00:00Z';
const base={ds:record.id,url,checkedAt:now,sha256:'abc123',profile:{rows:110,rows_exact:true,row_set:'set2',fingerprint:'schema1'}};
const change=(props={})=>({...base,change:{seen_at:now,rows:{before:100,after:110},distinct_rows_added:10,distinct_rows_removed:0,...props}});
const classify=c=>classifyVersionChange(c);
assert.equal(classify(change({coverage:[{column:'jaar',before:['2023','2024'],after:['2023','2025']}]})).kind,'append_with_period_extension');
assert.equal(classify(change()).kind,'append_only_observed');
assert.equal(classify(change({distinct_rows_removed:2})).kind,'rows_replaced_or_removed');
assert.equal(classify(change({columns_removed:['nis']})).kind,'potential_breaking_change');
assert.equal(classify(change({alerts:['rows_dropped']})).severity,'review');
assert.equal(classify(change({columns_added:['extra']})).kind,'schema_evolution');
assert.equal(classify(change({distinct_rows_added:undefined,distinct_rows_removed:undefined})).kind,'content_change_unresolved');
assert.equal(classify({...base,unchanged:true,row_order_unstable:true}).kind,'no_semantic_change');
assert.equal(classify({...base,change:{seen_at:old},unchanged:true}).kind,'unchanged');
assert.equal(classify(base).kind,'unassessed');
assert.equal(classify({...base,profile:{rows:10,rows_exact:false}}).kind,'not_observed');

const cards=buildCards([{...record,distributions:[{url,format:'CSV'}]}],new Map([[url,change()]]),new Map());
const card=cards.get(record.id);
assert.equal(card.id,record.id);
assert.equal(card.file.rows,110);
assert.equal(card.file.sha256,'abc123');
assert.equal(card.last_change_seen?.distinct_rows_added,10);
assert.equal(card.version_passport,undefined,'no duplicated passport in every static dataset card');
assert.equal(card.lineage,undefined,'no serialized synthetic dependency graph');
assert.equal(card.change_impact,undefined,'no redundant decision layer');
console.log('change classification and lean card contracts: PASS');
