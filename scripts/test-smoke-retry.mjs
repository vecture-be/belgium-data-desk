// The smoke test waits out a deploy that is still rolling out, and nothing else.
import assert from "node:assert/strict";
import { callThroughRollout, isRolloutMiss } from "./smoke-retry.mjs";

const unknown={status:200,body:{jsonrpc:"2.0",id:1,error:{code:-32602,message:"Unknown tool 'electricity_grid'. Available: search_datasets."}}};
const ok={status:200,body:{jsonrpc:"2.0",id:1,result:{content:[{type:"text",text:"{}"}]}}};
const listed=["search_datasets","electricity_grid"];
const seq=answers=>{let i=0;const f=async()=>answers[Math.min(i++,answers.length-1)];f.count=()=>i;return f};
const quiet={sleep:async()=>{},log:()=>{}};

assert.equal(isRolloutMiss(unknown,"electricity_grid",listed),true);
assert.equal(isRolloutMiss(unknown,"no_such_tool",listed),false,"a tool the server never listed is a real error");
assert.equal(isRolloutMiss(ok,"electricity_grid",listed),false);
assert.equal(isRolloutMiss({status:200,body:{error:{code:-32603,message:"Internal error"}}},"electricity_grid",listed),false,"other errors are not retried");

{ // the 16 Nov deploy: unknown once, then the new version answers
  const call=seq([unknown,ok]),logs=[];
  const r=await callThroughRollout(call,"electricity_grid",listed,{sleep:async()=>{},log:m=>logs.push(m)});
  assert.equal(r,ok);assert.equal(call.count(),2);
  assert.match(logs[0],/^RETRY electricity_grid: the server listed it but an instance did not know it yet \(deploy still rolling out\); asking again in 5 s$/);
}
{ // still unknown after every wait: the last answer is returned, so the smoke test fails as it should
  const call=seq([unknown]),waits=[];
  const r=await callThroughRollout(call,"electricity_grid",listed,{waits:[1,2,3],sleep:async ms=>{waits.push(ms)},log:()=>{}});
  assert.equal(r,unknown);assert.equal(call.count(),4);assert.deepEqual(waits,[1,2,3]);
}
{ // a working tool is called once
  const call=seq([ok]);await callThroughRollout(call,"electricity_grid",listed,quiet);assert.equal(call.count(),1);
}
console.log(JSON.stringify({ok:true,tests:"smoke test waits out a rolling deploy, and only that"}));
