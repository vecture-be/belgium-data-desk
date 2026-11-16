// Fetching for the catalogue harvest. A source is all or nothing: if its listing cannot be read, the harvest keeps last
// week's records for it. So a catalogue-level request gets three tries with growing timeouts; per-dataset requests do not.

/** One GET of a JSON document. Throws with .timeout or .status so the caller can tell a passing problem from a real one. */
export async function getJsonOnce(url,{ms=14000,ua="Belgium-Data-Desk/2.0 (+https://data.vecture.be)"}={}){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  try{
    const r=await fetch(url,{headers:{"user-agent":ua,accept:"application/json"},signal:c.signal});
    if(!r.ok)throw Object.assign(new Error(`${r.status} ${r.statusText}`),{status:r.status});
    return await r.json();
  }catch(e){
    if(c.signal.aborted)throw Object.assign(new Error(`timed out after ${Math.round(ms/1000)} s`),{timeout:true});
    throw e;
  }finally{clearTimeout(t)}
}

/** Worth another try: a timeout, a dropped connection, rate limiting or a server error. Not a 4xx, not a body that is not JSON. */
export const transient=e=>!!(e?.timeout||e?.status===429||e?.status>=500||(e?.status==null&&e?.name==="TypeError"));

/** Up to `tries` attempts with growing timeouts and a pause between them; the final error says how many tries it took. */
export async function getJsonRetry(url,{tries=3,timeouts=[20000,30000,45000],backoff=[2000,5000],ua,
  fetchOnce=getJsonOnce,sleep=ms=>new Promise(r=>setTimeout(r,ms)),log=console.warn}={}){
  for(let i=0;;i++){
    try{return await fetchOnce(url,{ms:timeouts[Math.min(i,timeouts.length-1)],ua})}
    catch(e){
      if(i>=tries-1||!transient(e))throw new Error(e.message+(i?` (after ${i+1} tries)`:""));
      log(`[harvest] retry ${i+1}/${tries-1} ${new URL(url).host}: ${e.message}`);
      await sleep(backoff[Math.min(i,backoff.length-1)]);
    }
  }
}
