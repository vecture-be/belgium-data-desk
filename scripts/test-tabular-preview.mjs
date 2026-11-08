import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { relayIdForUrl } from "../public/dataset-relay-id-v1.mjs";
import { inspectTabularInBrowser, tabularDistributionForAsset } from "../public/dataset-tabular-preview-v5.mjs";

const asset={distributions:[
  ["List of operators","http://publications.europa.eu/resource/authority/file-type/CSV","publisher-defined","see source","https://example.org/operators.csv"]
]};
assert.equal(tabularDistributionForAsset(asset)?.[4],"https://example.org/operators.csv");
assert.equal(await relayIdForUrl("https://example.org/operators.csv"),"f_"+createHash("sha256").update("https://example.org/operators.csv").digest("hex").slice(0,32));
const multilingual={distributions:[
  ["FR","CSV","","","https://www.static.favv.be/file_fr.csv"],
  ["NL","CSV","","","https://www.static.favv.be/file_nl.csv"],
  ["DE","CSV","","","https://www.static.favv.be/file_DE.csv"]
]};
assert.match(tabularDistributionForAsset(multilingual,{languages:["nl"]})?.[4],/_nl\.csv$/i);

const csv=`id;name;note
1;Alpha;ok
2;Beta;"two
lines"
3;Gamma;ok
`;
const makeResponse=body=>new Response(body,{status:200,headers:{"content-type":"text/csv","content-length":String(Buffer.byteLength(body))}});
const makeBoundedResponse=(body,total)=>new Response(body,{status:206,headers:{"content-type":"text/csv","content-range":"bytes 0-"+(Buffer.byteLength(body)-1)+"/"+total,"x-bdd-upstream-size":String(total)}});
const exact=await inspectTabularInBrowser(asset,{fetchImpl:async()=>makeResponse(csv),maxBytes:1024,maxRows:25,timeoutMs:2000});
assert.equal(exact.rowCount,3);
assert.equal(exact.rowCountKind,"exact");
assert.equal(exact.rows.length,3);
assert.deepEqual(exact.fields.map(x=>x.name),["id","name","note"]);
assert.equal(exact.rows[1].note,"two\nlines");
assert.equal(exact.delimiter,"semicolon");
const idProfile=exact.fields.find(x=>x.name==="id"),noteProfile=exact.fields.find(x=>x.name==="note");
assert.equal(idProfile.unique,3);
assert.equal(idProfile.duplicates,0);
assert.equal(idProfile.min,1);
assert.equal(idProfile.max,3);
assert.equal(noteProfile.unique,2);
assert.equal(noteProfile.duplicates,1);
const keyTest=await inspectTabularInBrowser(asset,{fetchImpl:async()=>makeResponse(csv),businessKey:["id"],profileColumns:false,maxRows:0,timeoutMs:2000});
assert.equal(keyTest.businessKey.exact,true);
assert.equal(keyTest.businessKey.uniqueKeys,3);
assert.equal(keyTest.businessKey.duplicateRows,0);
assert.equal(keyTest.businessKey.nullRows,0);
const boundedProxy=await inspectTabularInBrowser(asset,{fetchImpl:async url=>String(url).startsWith("/api/")?makeBoundedResponse(csv,1000000):Promise.reject(new TypeError("Failed to fetch")),maxBytes:512*1024,proxyBytes:512*1024,profileColumns:false,timeoutMs:2000});
assert.equal(boundedProxy.rowCountKind,"lower-bound");
assert.equal(boundedProxy.reportedBytes,1000000);
assert.equal(boundedProxy.transport,"proxy");
// Regression (found by the NTTS evaluation harness): the relay clamps at its ceiling and ends the stream cleanly; with no known upstream size that read is bounded, not exact.
const clamp=new Response(csv,{status:200,headers:{"content-type":"text/csv","x-bdd-range-bytes":String(Buffer.byteLength(csv)),"x-bdd-relay":"catalogue-id"}});
const clamped=await inspectTabularInBrowser(asset,{fetchImpl:async url=>String(url).startsWith("/api/")?clamp:Promise.reject(new TypeError("Failed to fetch")),maxBytes:1024,maxRows:25,timeoutMs:2000});
assert.equal(clamped.transport,"proxy");
assert.equal(clamped.rowCountKind,"lower-bound","relay read that reached the ceiling without a known size must not be labelled exact");
const smallRelay=new Response(csv,{status:200,headers:{"content-type":"text/csv","x-bdd-range-bytes":"1048576","x-bdd-relay":"catalogue-id"}});
const underCeiling=await inspectTabularInBrowser(asset,{fetchImpl:async url=>String(url).startsWith("/api/")?smallRelay:Promise.reject(new TypeError("Failed to fetch")),maxBytes:1024,maxRows:25,timeoutMs:2000});
assert.equal(underCeiling.rowCountKind,"exact","a relay read that ended well below the ceiling is complete");
const duplicateKeyTest=await inspectTabularInBrowser(asset,{fetchImpl:async()=>makeResponse(csv),businessKey:["note"],profileColumns:false,maxRows:0,timeoutMs:2000});
assert.equal(duplicateKeyTest.businessKey.exact,true);
assert.equal(duplicateKeyTest.businessKey.uniqueKeys,2);
assert.equal(duplicateKeyTest.businessKey.duplicateRows,1);

const large="id,name\n"+Array.from({length:500},(_,i)=>(i+1)+",row"+(i+1)).join("\n")+"\n";
const bounded=await inspectTabularInBrowser(asset,{fetchImpl:async()=>makeResponse(large),maxBytes:180,maxRows:25,timeoutMs:2000});
assert.equal(bounded.rowCountKind,"lower-bound");
assert.ok(bounded.rowCount>0);
assert.ok(bounded.rowCount<500);

let calls=[];
const corsThenProxy=async url=>{calls.push(String(url));if(/^\/api\/dataset-file\/f_[a-f0-9]{32}$/.test(String(url)))return makeResponse(csv);throw new TypeError("Failed to fetch")};
const proxied=await inspectTabularInBrowser(asset,{fetchImpl:corsThenProxy,timeoutMs:2000});
assert.equal(proxied.transport,"proxy");
assert.equal(proxied.rowCount,3);
assert.equal(calls.length,2);
assert.match(calls[1],/^\/api\/dataset-file\/f_[a-f0-9]{32}$/);
assert.equal(calls[1].includes("url="),false);
assert.equal(calls[1].includes("example.org"),false);

const corsFetch=async()=>{throw new TypeError("Failed to fetch")};
await assert.rejects(inspectTabularInBrowser(asset,{fetchImpl:corsFetch,timeoutMs:2000}),e=>e.code==="CORS_OR_NETWORK");

const noCsv={distributions:[["PDF","PDF","","","https://example.org/a.pdf"]]};
assert.equal(tabularDistributionForAsset(noCsv),null);

console.log(JSON.stringify({ok:true,exactRows:exact.rowCount,boundedRows:bounded.rowCount,columns:exact.fields.length}));
