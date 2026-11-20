// Classification tests: keep the existing row-difference engine, avoid duplicate version models.
import assert from 'node:assert/strict';
import {buildCards} from './build-cards.mjs';
import {classifyVersionChange} from './version-intelligence.mjs';
import {isCardShardFile,validWholeFileEvidence} from './validate-version-output.mjs';
import {idShard} from '../mcp-server.mjs';

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
assert.deepEqual(
  ['summary.json',idShard(record.id)+'.json','aa.json','a.json','GG.json','zz.json','a1.json.old'].filter(isCardShardFile),
  [idShard(record.id)+'.json','aa.json'],
  'card release gate must discover actual two-hex-digit static card shards'
);
assert.equal(validWholeFileEvidence({rows_exact:true,rows:77,sha256:undefined}),true,'entire small CSV observed by probe is valid without a hash');
assert.equal(validWholeFileEvidence({rows_exact:true,rows:7,sha256:null}),true,'unknown fingerprint is not evidence of corruption');
assert.equal(validWholeFileEvidence({rows_exact:true,rows:0,sha256:'a'.repeat(32)}),true,'empty file with exact hash is valid');
assert.equal(validWholeFileEvidence({rows_exact:true,rows:-1}),false,'negative rows must be rejected');
assert.equal(validWholeFileEvidence({rows_exact:true,rows:7,sha256:'not-a-hash'}),false,'malformed claimed hash must be rejected');
console.log('change classification and lean card contracts: PASS');
