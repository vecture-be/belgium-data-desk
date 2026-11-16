// The harvest's catalogue requests: a passing problem is retried, a real one is not, and a real timeout is reported as one.
import assert from "node:assert/strict";
import http from "node:http";
import { getJsonOnce, getJsonRetry, transient } from "./harvest-fetch.mjs";

const URL_="https://bruxellesdata.opendatasoft.com/api/explore/v2.1/catalog/datasets?limit=100&offset=0";
const err=(o,msg="x")=>Object.assign(new Error(msg),o);
function fake(script){   // each call takes the next outcome: an Error to throw, anything else to return
  const calls=[];
  return{calls,fetchOnce:async(url,{ms})=>{calls.push(ms);const r=script[calls.length-1];if(r instanceof Error)throw r;return r}};
}
const quiet={sleep:async()=>{},log:()=>{}};

{ // what counts as passing
  assert.equal(transient(err({timeout:true})),true);
  assert.equal(transient(err({status:503})),true);
  assert.equal(transient(err({status:429})),true);
  assert.equal(transient(Object.assign(new TypeError("fetch failed"))),true,"a dropped connection");
  assert.equal(transient(err({status:404})),false);
  assert.equal(transient(new SyntaxError("Unexpected token <")),false,"an HTML page instead of JSON will not get better");
}
{ // the 16 Nov case: the first page times out once, the second try answers, with a longer timeout
  const f=fake([err({timeout:true},"timed out after 20 s"),{results:[1,2]}]),logs=[];
  const j=await getJsonRetry(URL_,{...quiet,log:m=>logs.push(m),fetchOnce:f.fetchOnce});
  assert.deepEqual(j,{results:[1,2]});
  assert.deepEqual(f.calls,[20000,30000]);
  assert.match(logs[0],/^\[harvest\] retry 1\/2 bruxellesdata\.opendatasoft\.com: timed out after 20 s$/);
}
{ // a server error that persists: three tries, then the error says so
  const f=fake([err({status:502},"502 Bad Gateway"),err({status:502},"502 Bad Gateway"),err({status:502},"502 Bad Gateway")]);
  await assert.rejects(getJsonRetry(URL_,{...quiet,fetchOnce:f.fetchOnce}),/^Error: 502 Bad Gateway \(after 3 tries\)$/);
  assert.deepEqual(f.calls,[20000,30000,45000]);
}
{ // a 404 is not retried
  const f=fake([err({status:404},"404 Not Found")]);
  await assert.rejects(getJsonRetry(URL_,{...quiet,fetchOnce:f.fetchOnce}),/^Error: 404 Not Found$/);
  assert.equal(f.calls.length,1);
}
{ // the pause between tries grows
  const waits=[],f=fake([err({timeout:true}),err({timeout:true}),{ok:1}]);
  await getJsonRetry(URL_,{log:()=>{},sleep:async ms=>{waits.push(ms)},fetchOnce:f.fetchOnce});
  assert.deepEqual(waits,[2000,5000]);
}
{ // the real fetch: a slow server becomes a timeout error with .timeout; a 500 carries .status; JSON is parsed
  const srv=http.createServer((q,r)=>{
    if(q.url==="/slow")return setTimeout(()=>{r.end("{}")},1500);
    if(q.url==="/boom"){r.statusCode=500;return r.end("no")}
    r.setHeader("content-type","application/json");r.end(JSON.stringify({ua:q.headers["user-agent"]}));
  });
  await new Promise(r=>srv.listen(0,"127.0.0.1",r));
  const base="http://127.0.0.1:"+srv.address().port;
  try{
    await assert.rejects(getJsonOnce(base+"/slow",{ms:200}),e=>e.timeout===true&&/^timed out after 0 s$/.test(e.message));
    await assert.rejects(getJsonOnce(base+"/boom",{ms:2000}),e=>e.status===500);
    assert.deepEqual(await getJsonOnce(base+"/ok",{ms:2000,ua:"T/1"}),{ua:"T/1"});
    const slowThenFine=await getJsonRetry(base+"/ok",{...quiet,timeouts:[2000]});
    assert.ok(slowThenFine.ua.startsWith("Belgium-Data-Desk/"));
  }finally{srv.closeAllConnections?.();srv.close()}
}
console.log(JSON.stringify({ok:true,tests:"harvest catalogue fetch: retries, timeouts, what is passing"}));
