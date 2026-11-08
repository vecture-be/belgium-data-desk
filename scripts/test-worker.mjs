import assert from "node:assert/strict";
import { isBlockedHostname, validateRelayTarget, requestedBytesFromRange, proxyDatasetFile } from "../worker.mjs";

assert.equal(isBlockedHostname("localhost"),true);
assert.equal(isBlockedHostname("127.0.0.1"),true);
assert.equal(isBlockedHostname("10.0.0.5"),true);
assert.equal(isBlockedHostname("169.254.169.254"),true);
assert.equal(isBlockedHostname("192.168.1.2"),true);
assert.equal(isBlockedHostname("::1"),true);
assert.equal(isBlockedHostname("fd00::1"),true);
assert.equal(isBlockedHostname("data.example.org"),false);

const id="f_0123456789abcdef0123456789abcdef";
const entry={url:"https://data.example.org/file.csv",hosts:["data.example.org"],format:"CSV"};
assert.equal(validateRelayTarget(entry)?.hostname,"data.example.org");
assert.equal(validateRelayTarget(entry,"https://evil.example/file.csv"),null);
assert.equal(validateRelayTarget({url:"https://127.0.0.1/file.csv",hosts:["127.0.0.1"]}),null);
assert.equal(requestedBytesFromRange("bytes=0-1023"),1024);
assert.equal(requestedBytesFromRange("bytes=100-200"),null);
assert.equal(requestedBytesFromRange("bytes=0-999999999"),8*1024*1024);

let calls=[];
const fetchImpl=async(url,options)=>{
  calls.push({url:String(url),options});
  return new Response("id,name\n1,Alpha\n",{status:206,headers:{
    "content-type":"text/csv","content-range":"bytes 0-15/1000","content-length":"16",
    "set-cookie":"secret=1","x-private-header":"nope"
  }});
};
const limiter={limit:async()=>({success:true})};
const request=new Request("https://belgium-data-desk.example/api/dataset-file/"+id,{
  headers:{Range:"bytes=0-4095",Cookie:"session=secret",Authorization:"Bearer secret","X-Arbitrary":"do-not-forward"}
});
const response=await proxyDatasetFile(request,{DATASET_FILE_GLOBAL_RATE_LIMITER:limiter,DATASET_FILE_RATE_LIMITER:limiter},{index:{[id]:entry},fetchImpl});
assert.equal(response.status,206);
assert.equal(response.headers.get("x-bdd-relay"),"catalogue-id");
assert.equal(response.headers.get("x-bdd-relay-id"),id);
assert.equal(response.headers.get("x-bdd-upstream"),"data.example.org");
assert.equal(response.headers.get("set-cookie"),null);
assert.equal(response.headers.get("x-private-header"),null);
assert.equal(calls.length,1);
const forwarded=calls[0].options.headers;
assert.equal(forwarded.cookie,undefined);
assert.equal(forwarded.authorization,undefined);
assert.equal(forwarded["x-arbitrary"],undefined);
assert.equal(forwarded.range,"bytes=0-4095");
assert.match(forwarded.accept,/text\/csv/);

calls=[];
const arbitrary=await proxyDatasetFile(new Request("https://belgium-data-desk.example/api/dataset-file/"+id+"?url=https://evil.example/a.csv"),{}, {index:{[id]:entry},fetchImpl});
assert.equal(arbitrary.status,400);
assert.equal(calls.length,0);

const unknown=await proxyDatasetFile(new Request("https://belgium-data-desk.example/api/dataset-file/f_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),{}, {index:{[id]:entry},fetchImpl});
assert.equal(unknown.status,404);

const crossSite=await proxyDatasetFile(new Request("https://belgium-data-desk.example/api/dataset-file/"+id,{headers:{"Sec-Fetch-Site":"cross-site"}}),{}, {index:{[id]:entry},fetchImpl});
assert.equal(crossSite.status,403);

let redirectCalls=0;
const redirect=await proxyDatasetFile(new Request("https://belgium-data-desk.example/api/dataset-file/"+id),{},{
  index:{[id]:entry},
  fetchImpl:async()=>{redirectCalls++;return new Response(null,{status:302,headers:{location:"https://evil.example/redirect.csv"}})}
});
assert.equal(redirect.status,502);
assert.equal(redirectCalls,1);

let limitedFetches=0;
const denied={limit:async()=>({success:false})};
const limited=await proxyDatasetFile(new Request("https://belgium-data-desk.example/api/dataset-file/"+id),{
  DATASET_FILE_GLOBAL_RATE_LIMITER:denied,DATASET_FILE_RATE_LIMITER:limiter
},{index:{[id]:entry},fetchImpl:async()=>{limitedFetches++;return new Response("never")}});
assert.equal(limited.status,429);
assert.equal(limitedFetches,0);

console.log(JSON.stringify({ok:true,relay:"catalogue-id",blockedPrivate:true,headersForwarded:false,rateLimited:true}));
