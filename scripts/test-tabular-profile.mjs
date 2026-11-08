import assert from "node:assert/strict";
import {
  detectDelimiter,isTabularDistribution,parseDelimitedText,profileDelimitedDistribution,
  profileNationalTabular,reusePreviousTabularProfiles,safePublicUrl
} from "./tabular-profile.mjs";
import { thinNationalCatalogue } from "./national-dcat.mjs";

const csv=`id;name;note;amount
1;"A; B";"line 1
line 2";12,5
2;C;ok;7
`;
assert.equal(detectDelimiter(csv,{url:"x.csv"}),";");
const p=parseDelimitedText(csv,{delimiter:";"});
assert.equal(p.rowCount,2);
assert.deepEqual(p.headers,["id","name","note","amount"]);
assert.equal(p.samples[0].note,"line 1\nline 2");
assert.deepEqual(p.types,["integer","string","string","number"]);

assert.ok(safePublicUrl("https://example.org/file.csv"));
assert.equal(safePublicUrl("http://localhost/file.csv"),null);
assert.equal(safePublicUrl("http://127.0.0.1/file.csv"),null);
assert.equal(safePublicUrl("http://10.0.0.4/file.csv"),null);
assert.equal(safePublicUrl("http://192.168.1.2/file.csv"),null);
assert.equal(safePublicUrl("https://example.org:8443/file.csv"),null);
assert.equal(isTabularDistribution({format:"http://publications.europa.eu/resource/authority/file-type/CSV",url:"https://example.org/file"}),true);

const files=new Map([
  ["https://example.org/favv.csv",`operator_id;name;pap_code
1;Alpha;ACT001
2;Beta;ACT002
3;Gamma;ACT001
`],
  ["https://example.org/other.csv",`id,name
1,A
2,B
`],
  ["https://example.org/large.csv","id,name\n"+Array.from({length:2000},(_,i)=>(i+1)+",row"+(i+1)).join("\n")+"\n"]
]);
async function mockFetch(url){
  const u=String(url);
  if(u==="https://example.org/redirect.csv")return new Response(null,{status:302,headers:{location:"https://example.org/favv.csv"}});
  if(u==="https://example.org/private-redirect.csv")return new Response(null,{status:302,headers:{location:"http://127.0.0.1/secret.csv"}});
  const body=files.get(u);if(body==null)return new Response("missing",{status:404});
  return new Response(body,{status:200,headers:{"content-type":"text/csv; charset=utf-8","content-length":String(Buffer.byteLength(body)),"last-modified":"Wed, 30 Sep 2026 10:00:00 GMT","etag":"fixture"}});
}
const exact=await profileDelimitedDistribution({format:"CSV",url:"https://example.org/favv.csv"},{fetchImpl:mockFetch,maxBytes:1024*1024});
assert.equal(exact.rowCount,3);
assert.equal(exact.rowCountKind,"exact");
assert.deepEqual(exact.fields.map(x=>x.name),["operator_id","name","pap_code"]);
assert.equal(exact.previewRows.length,3);
assert.equal(exact.delimiter,"semicolon");

const redirected=await profileDelimitedDistribution({format:"CSV",url:"https://example.org/redirect.csv"},{fetchImpl:mockFetch,maxBytes:1024*1024});
assert.equal(redirected.rowCount,3);
await assert.rejects(
  profileDelimitedDistribution({format:"CSV",url:"https://example.org/private-redirect.csv"},{fetchImpl:mockFetch}),
  /unsafe/
);

const bounded=await profileDelimitedDistribution({format:"CSV",url:"https://example.org/large.csv"},{fetchImpl:mockFetch,maxBytes:180});
assert.equal(bounded.rowCountKind,"lower-bound");
assert.ok(bounded.rowCount>0);
assert.ok(bounded.rowCount<2000);

const national={
  generatedAt:"2026-10-01T00:00:00Z",items:[
    {id:"national:favv",datasetId:"favv-afsca-operators",provider:"FAVV",distributions:[{name:"List of operators",format:"CSV",url:"https://example.org/favv.csv"}],enrichment:{score:20,reasons:[]}},
    {id:"national:other",datasetId:"other",provider:"Other",distributions:[{name:"Other",format:"CSV",url:"https://example.org/other.csv"}],enrichment:{score:20,reasons:[]}},
    {id:"national:broken",datasetId:"broken",provider:"Broken",distributions:[{name:"Broken",format:"CSV",url:"https://example.org/missing.csv"}],enrichment:{score:20,reasons:[]}}
  ]
};
const enriched=await profileNationalTabular(national,{fetchImpl:mockFetch,limit:3,concurrency:2});
const favv=enriched.items.find(x=>x.id==="national:favv");
assert.equal(favv.recordCount,3);
assert.equal(favv.recordCountKind,"exact");
assert.equal(favv.schemaOrigin,"observed-file-header");
assert.equal(favv.sampleOrigin,"profiled-file-records");
assert.deepEqual(favv.fields.map(x=>x.name),["operator_id","name","pap_code"]);
assert.equal(enriched.profileSummary.succeeded,2);
assert.equal(enriched.profileSummary.failed,1);
const broken=enriched.items.find(x=>x.id==="national:broken");
assert.equal(broken.tabularProfile.status,"failed");
assert.equal(broken.tabularProfile.sourceUrl,"https://example.org/missing.csv");
assert.match(broken.tabularProfile.error,/HTTP 404/);
const thin=thinNationalCatalogue({...enriched,health:{ok:true}});
const thinFavv=thin.items.find(x=>x.id==="national:favv");
assert.equal(thinFavv.recordCount,3);
assert.equal(thinFavv.recordCountKind,"exact");
assert.deepEqual(thinFavv.fields.map(x=>x.name),["operator_id","name","pap_code"]);
assert.equal(thinFavv.previewRows.length,3);
assert.equal(thinFavv.tabularProfile.status,"ok");
assert.equal(thin.profileSummary.succeeded,2);
const thinBroken=thin.items.find(x=>x.id==="national:broken");
assert.equal(thinBroken.tabularProfile.status,"failed");
assert.match(thinBroken.tabularProfile.error,/HTTP 404/);

const previous={items:[{
  id:"old",datasetId:"keep-me",distributions:[{url:"https://example.org/favv.csv"}],
  recordCount:3,recordCountKind:"exact",fields:[{name:"operator_id"}],previewRows:[{operator_id:"1"}],
  schemaOrigin:"observed-file-header",sampleOrigin:"profiled-file-records",tabularProfile:{status:"ok",sourceUrl:"https://example.org/favv.csv"}
}]};
const current={items:[
  {id:"new",datasetId:"keep-me",distributions:[{url:"https://example.org/favv.csv"}]},
  {id:"changed",datasetId:"changed",distributions:[{url:"https://example.org/other.csv"}]}
]};
const reused=reusePreviousTabularProfiles(current,previous);
assert.equal(reused.items[0].recordCount,3);
assert.equal(reused.items[0].tabularProfile.reusedFromSnapshot,true);
assert.equal(reused.profileSummary.reused,1);

console.log(JSON.stringify({ok:true,exactRows:exact.rowCount,boundedRows:bounded.rowCount,profiled:enriched.profileSummary.succeeded}));
