// Right after a deploy, Cloudflare can still route some requests to the previous Worker version for a few seconds. A tool that the
// new version lists in tools/list can then come back as "Unknown tool" from an old instance. That is a rollout in progress, not a
// broken deploy, so the smoke test asks again (a few times, a few seconds apart). Every other error still fails at once.

/** True when the answer is the JSON-RPC "Unknown tool" error for a tool the server has just listed. */
export const isRolloutMiss=(r,name,listed)=>listed.includes(name)&&r?.body?.error?.code===-32602&&/^Unknown tool/.test(String(r.body.error.message||""));

/** Calls `call()` until it is not a rollout miss, at most waits.length extra times; says each retry through `log`. */
export async function callThroughRollout(call,name,listed,{waits=[5000,5000,5000,5000,5000,5000],sleep=ms=>new Promise(r=>setTimeout(r,ms)),log=console.log}={}){
  let r=await call();
  for(let i=0;i<waits.length&&isRolloutMiss(r,name,listed);i++){
    log("RETRY "+name+": the server listed it but an instance did not know it yet (deploy still rolling out); asking again in "+waits[i]/1000+" s");
    await sleep(waits[i]);r=await call();
  }
  return r;
}
