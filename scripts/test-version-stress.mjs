// Reproducible adversarial audit for version passports, lineage claims and publisher-file parsing.
// All inputs are local fixtures; no publisher is contacted and no public dataset is changed.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkFile, ROWS } from './full-check.mjs';
import { profileColumns } from './dataset-card.mjs';
import { buildCards, backfillDocs, loadProfiles } from './build-cards.mjs';
import { classifyVersionChange, versionPassport, dependencyImpact, changeDecision, validatePassport } from './version-intelligence.mjs';
import { renderCard } from '../public/dataset-card-panel-v3.mjs';

const failures=[], soft=(name,fn)=>{try{fn()}catch(e){failures.push(name+': '+e.message)}};
const fake={id:'national:stress',title:'Stress test <img src=x onerror=alert(1)>',publisher:'Test publisher',updatedAt:'2026-11-14',landingPage:'https://example.org/cite'};
const variants=[
 'jaar;nis;waarde\n2023;11001;10\n2024;11002;20\n2025;11003;30\n',
 'jaar;nis;waarde\n2025;11003;30\n2023;11001;10\n2024;11002;20\n',
 'jaar;nis;waarde\n2023;11001;10\n2024;11002;20\n2025;11003;30\n2026;11004;40\n',
 'jaar;nis;waarde\n2023;11001;10\n2025;11003;30\n',
 'jaar;nis;waarde;extra\n2023;11001;10;y\n2024;11002;20;n\n2025;11003;30;y\n2026;11004;40;n\n',
 'jaar;nis;waarde\n',
 '<!doctype html><html><body>not a dataset</body></html>'
];
let body=variants[0];
const srv=http.createServer((req,res)=>{
  if(req.url==='/missing'){res.writeHead(404);return res.end('missing')}
  if(req.url==='/html'){res.writeHead(200,{'content-type':'text/csv'});return res.end(variants[6])}
  if(req.url==='/large'){res.writeHead(200,{'content-type':'text/csv','content-length':'999999999'});return res.end('a,b\n1,2\n')}
  res.writeHead(200,{'content-type':'text/csv','etag':'"frozen"'});res.end(body)
});
await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+srv.address().port+'/data.csv';
const work={url:base,fmt:'CSV',ds:fake.id,prov:fake.publisher};
let checked=0;
try{
  const first=await checkFile(work);checked++;
  assert.equal(first.profile?.rows,3);
  body=variants[1];
  const order=await checkFile(work,{previous:first,prevRows:first[ROWS]});checked++;
  soft('row permutation is not semantic change',()=>{
    assert.equal(order.unchanged,true);assert.equal(order.row_order_unstable,true);
    assert.equal(classifyVersionChange(order).kind,'no_semantic_change')
  });
  body=variants[2];
  const appended=await checkFile(work,{previous:order,prevRows:order[ROWS]});checked++;
  soft('append-only with reporting-year extension',()=>{
    assert.equal(appended.change?.distinct_rows_removed,0);
    assert.equal(appended.change?.distinct_rows_added,1);
    assert.equal(classifyVersionChange(appended).kind,'append_with_period_extension');
  });
  body=variants[3];
  const removed=await checkFile(work,{previous:appended,prevRows:appended[ROWS]});checked++;
  soft('removed rows receive review',()=>{
    assert.equal(classifyVersionChange(removed).kind,'potential_breaking_change'); // coverage shrank, a higher-priority alert
    assert.equal(changeDecision(removed,fake).severity,'review');
  });
  body=variants[4];
  const schema=await checkFile(work,{previous:appended,prevRows:appended[ROWS]});checked++;
  soft('schema evolution receives review',()=>{
    assert.equal(classifyVersionChange(schema).kind,'schema_evolution');
  });
  body=variants[5];
  const emptied=await checkFile(work,{previous:appended,prevRows:appended[ROWS]});checked++;
  soft('header-only export preserves zero-row profile and flags empty',()=>{
    assert.equal(emptied.profile?.rows,0);
    assert.deepEqual(emptied.profile?.columns?.map(x=>x.name),['jaar','nis','waarde']);
    assert.equal((emptied.change?.columns_removed||[]).length,0,'header-only export is not a schema deletion');
    assert.equal(emptied.change?.alerts?.includes('emptied'),true);
    assert.equal(classifyVersionChange(emptied).kind,'potential_breaking_change');
  });
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'version-audit-'));
  try{
    const f=path.join(tmp,'full.jsonl');
    fs.writeFileSync(f,JSON.stringify(emptied)+'\n');
    const loaded=loadProfiles(f);
    soft('zero-row full-file observation is not discarded',()=>assert.equal(loaded.has(base),true));
    const cards=buildCards([{...fake,distributions:[{url:base,format:'CSV'}]}],new Map([[base,emptied]]),new Map());
    const card=cards.get(fake.id);
    soft('zero-row dataset still gets version evidence',()=>assert.equal(card.version_passport?.observation?.rows_examined,0));
    soft('passport field equivalence',()=>assert.deepEqual(validatePassport(card.version_passport,fake,emptied),[]));
    soft('rendering exposes observed classification safely',()=>{
      const h=renderCard(card);
      assert.match(h,/Version evidence/i);
      assert.match(h,/potential_breaking_change|potential breaking change/i);
      assert.doesNotMatch(h,/<img src=x onerror=/);
    });
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
  const html=await checkFile({url:base.replace('/data.csv','/html'),fmt:'CSV'});checked++;
  soft('html disguised as CSV rejected',()=>assert.equal(html.error,'html instead of a table'));
  const notFound=await checkFile({url:base.replace('/data.csv','/missing'),fmt:'CSV'});checked++;
  soft('404 rejected',()=>assert.equal(notFound.error,'HTTP 404'));
  const tooLarge=await checkFile({url:base.replace('/data.csv','/large'),fmt:'CSV'},{maxBytes:1024});checked++;
  soft('declared oversized file short-circuits download',()=>assert.equal(tooLarge.too_large,true));
}finally{await new Promise(r=>srv.close(r))}

// Deterministic metamorphic variants: no claimed publisher versions, no negative counts, no invented impact.
let seed=2374481;
const rand=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
const severity=new Set(['none','informational','review']);
const kindCounts={};
for(let i=0;i<3000;i++){
  const exact=rand()>0.06, prior=rand()>0.1, a=Math.floor(rand()*20),r=Math.floor(rand()*20);
  const at='2026-11-20T12:00:00Z',previous='2026-11-13T12:00:00Z';
  const check={ds:fake.id,url:base,checkedAt:at,profile:{rows:100+a-r,rows_exact:exact,row_set:'fingerprint',fingerprint:'columns-v2'},sha256:'deadbeef',unchanged:!prior,row_order_unstable:!prior&&rand()>0.5};
  if(prior)check.change={seen_at:at,since:previous,rows:{before:100,after:100+a-r},distinct_rows_added:a,distinct_rows_removed:r,
    ...(rand()<0.2?{columns_removed:['nis']}:{}),...(rand()<0.2?{columns_added:['extra']}:{}),
    ...(rand()<0.1?{alerts:['coverage_shrank']}:{}),...(rand()<0.1?{coverage:[{column:'jaar',before:['2023','2024'],after:['2023','2025']}]}:{})};
  const v=versionPassport(fake,check),d=changeDecision(check,fake),g=dependencyImpact(fake,check);
  kindCounts[v.change_classification.kind]=(kindCounts[v.change_classification.kind]||0)+1;
  if(!severity.has(d.severity)||d.automatic_release_block!==false||v.publisher_revision!=null||v.publisher_release!=null||validatePassport(v,fake,check).length){
    failures.push('metamorphic #'+i+': unsafe or contradictory version');
    break;
  }
  if(d.classification!==v.change_classification.kind)failures.push('metamorphic #'+i+': inconsistent decision/classification');
  if(i<100)soft('lineage captures affected search-derived outputs #'+i,()=>{
    assert.ok(g.affected_outputs.some(t=>t.includes('search_datasets')), 'missing search results dependent on measured periods and disagreements');
    assert.ok(g.affected_outputs.some(t=>t.includes('catalogue_overview')), 'missing published card summary');
  });
}
// Production must fail closed on a missing full-file baseline, not ship empty/stale passports.
const checkout=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!fs.existsSync(path.join(checkout,'.cache','full-check.jsonl'))){
  const gate=spawnSync(process.execPath,['scripts/validate-version-output.mjs'],{
    cwd:checkout,env:{...process.env,REQUIRE_FULL_FILE_PROFILE:'1',MIN_FULL_FILE_CARDS:'2000'},encoding:'utf8'});
  soft('production gate rejects missing full-file baseline',()=>{
    assert.notEqual(gate.status,0);
    assert.match((gate.stderr||'')+(gate.stdout||''),/full-file profile cache is missing or empty/);
  });
}
console.log('[audit] checked HTTP fixture cases='+checked+' and metamorphic versions=3000; classes='+JSON.stringify(kindCounts));
console.log('[audit] unexpected findings='+failures.length);
for(const f of failures.slice(0,16))console.error('AUDIT FAIL '+f);
if(failures.length)throw Error('Version intelligence audit failed '+failures.length+' invariants (first '+Math.min(failures.length,16)+' shown)');
