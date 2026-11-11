import { RELAY_INDEX } from "./relay-index.mjs";
import { handleMcp, publicOrigin } from "./mcp-server.mjs";
import { handleFeedbackHttp, runDigest } from "./feedback.mjs";
// The report queue (feedback.mjs): a Durable Object class must be exported from the Worker's main module.
export { FeedbackDesk } from "./feedback.mjs";

const MAX_RELAY_BYTES=8*1024*1024;
const PREVIEW_RELAY_BYTES=512*1024;
const UPSTREAM_TIMEOUT_MS=20000;
const EDGE_TTL_SECONDS=300;
const MAX_REDIRECTS=3;
const FIXED_ACCEPT="text/csv,text/tab-separated-values,text/plain,application/octet-stream;q=0.8,*/*;q=0.1";

const normalizeHost=value=>String(value||"").toLowerCase().replace(/^\[|\]$/g,"").replace(/\.$/,"");
const ipv4Parts=host=>{
  if(!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))return null;
  const p=host.split(".").map(Number);return p.every(x=>x>=0&&x<=255)?p:null;
};
const blockedIpv4=p=>{
  const [a,b,c]=p;
  return a===0||a===10||a===127||a>=224||
    (a===100&&b>=64&&b<=127)||
    (a===169&&b===254)||
    (a===172&&b>=16&&b<=31)||
    (a===192&&b===168)||
    (a===192&&b===0&&(c===0||c===2))||
    (a===198&&(b===18||b===19))||
    (a===198&&b===51&&c===100)||
    (a===203&&b===0&&c===113);
};
export function isBlockedHostname(value){
  const h=normalizeHost(value);
  if(!h||h==="localhost"||h.endsWith(".localhost")||h.endsWith(".local")||h.endsWith(".internal")||h.endsWith(".home")||h.endsWith(".lan"))return true;
  const p=ipv4Parts(h);if(p)return blockedIpv4(p);
  if(h.includes(":")){
    const v=h.toLowerCase();
    if(v==="::"||v==="::1"||v.startsWith("fc")||v.startsWith("fd")||/^fe[89ab]/.test(v)||v.startsWith("ff")||v.startsWith("2001:db8:"))return true;
    const mapped=v.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);if(mapped){const mp=ipv4Parts(mapped[1]);return !mp||blockedIpv4(mp)}
  }
  return false;
}
export function validateRelayTarget(entry,value=entry?.url){
  try{
    const u=new URL(String(value||"")),host=normalizeHost(u.hostname);
    if(u.protocol!=="https:"||u.username||u.password||isBlockedHostname(host))return null;
    const allowed=new Set((entry?.hosts||[]).map(normalizeHost).filter(Boolean));
    if(!allowed.size||!allowed.has(host))return null;
    return u;
  }catch{return null}
}
export function requestedBytesFromRange(value){
  if(!value)return PREVIEW_RELAY_BYTES;
  const m=String(value).trim().match(/^bytes=0-(\d+)$/i);if(!m)return null;
  const n=Number(m[1]);if(!Number.isSafeInteger(n)||n<0)return null;
  return Math.min(MAX_RELAY_BYTES,Math.max(1024,n+1));
}
function boundedBody(body,maxBytes){
  if(!body)return null;
  const reader=body.getReader();let sent=0;
  return new ReadableStream({
    async pull(controller){
      const {done,value}=await reader.read();if(done){controller.close();return}
      const remaining=maxBytes-sent;if(remaining<=0){await reader.cancel().catch(()=>{});controller.close();return}
      const chunk=value.length>remaining?value.slice(0,remaining):value;sent+=chunk.length;controller.enqueue(chunk);
      if(sent>=maxBytes){await reader.cancel().catch(()=>{});controller.close()}
    },
    cancel(){return reader.cancel().catch(()=>{})}
  });
}
async function fetchPublisher(entry,method,requestedBytes,fetchImpl){
  let current=validateRelayTarget(entry);if(!current)throw Object.assign(new Error("Relay target is not a valid approved public HTTPS URL."),{status:502});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),UPSTREAM_TIMEOUT_MS);
  try{
    for(let i=0;i<=MAX_REDIRECTS;i++){
      const headers={accept:FIXED_ACCEPT,"user-agent":"Belgium-Data-Desk/5.0",range:"bytes=0-"+(requestedBytes-1)};
      const currentUrl=String(current),cacheKey=currentUrl+(currentUrl.includes("?")?"&":"?")+"__bdd_relay_bytes="+requestedBytes;
      let r;
      try{
        r=await fetchImpl(currentUrl,{method,headers,redirect:"manual",signal:controller.signal,cf:method==="GET"?{cacheEverything:true,cacheTtl:EDGE_TTL_SECONDS,cacheKey}:undefined});
      }catch(e){
        if(e?.name==="AbortError")throw Object.assign(new Error("Publisher fetch timed out."),{status:504});
        throw Object.assign(new Error("Publisher fetch failed."),{status:502});
      }
      if(![301,302,303,307,308].includes(r.status))return{response:r,finalUrl:current};
      if(i===MAX_REDIRECTS)throw Object.assign(new Error("Too many publisher redirects."),{status:508});
      const location=r.headers.get("location");if(!location)throw Object.assign(new Error("Publisher redirect had no destination."),{status:502});
      const next=validateRelayTarget(entry,new URL(location,current).href);
      if(!next)throw Object.assign(new Error("Publisher redirect left the approved host set or targeted a non-public address."),{status:502});
      current=next;
    }
    throw Object.assign(new Error("Too many publisher redirects."),{status:508});
  }finally{clearTimeout(timer)}
}
async function rateLimit(env,id){
  for(const [binding,key] of [[env?.DATASET_FILE_GLOBAL_RATE_LIMITER,"dataset-file"],[env?.DATASET_FILE_RATE_LIMITER,id]]){
    if(!binding?.limit)continue;
    try{
      const result=await binding.limit({key});
      if(result?.success===false)return false;
    }catch{return false}
  }
  return true;
}
const errorResponse=(message,status,extra={})=>new Response(message,{status,headers:{"cache-control":"no-store","x-content-type-options":"nosniff",...extra}});

export async function proxyDatasetFile(request,env={},options={}){
  if(!["GET","HEAD"].includes(request.method))return errorResponse("Method not allowed.",405,{Allow:"GET, HEAD"});
  const url=new URL(request.url);
  if(url.search)return errorResponse("Query parameters are not accepted on dataset relay URLs.",400);
  if(request.headers.get("sec-fetch-site")==="cross-site")return errorResponse("Cross-site use is not allowed.",403);
  const origin=request.headers.get("origin");if(origin&&origin!==url.origin)return errorResponse("Cross-origin use is not allowed.",403);
  const m=url.pathname.match(/^\/api\/dataset-file\/(f_[a-f0-9]{32})$/i);if(!m)return errorResponse("Unknown dataset relay.",404);
  const id=m[1].toLowerCase(),index=options.index||RELAY_INDEX,entry=index[id];
  if(!entry)return errorResponse("Unknown dataset relay.",404);
  if(!validateRelayTarget(entry))return errorResponse("Dataset relay target is not safe.",502);
  const requestedBytes=requestedBytesFromRange(request.headers.get("range"));
  if(requestedBytes===null)return errorResponse("Only a single range starting at byte 0 is supported.",416);
  if(!(await rateLimit(env,id)))return errorResponse("Dataset relay rate limit exceeded.",429,{"retry-after":"60"});
  let upstream,finalUrl;
  try{
    const result=await fetchPublisher(entry,request.method,requestedBytes,options.fetchImpl||fetch);upstream=result.response;finalUrl=result.finalUrl;
  }catch(e){return errorResponse(e?.message||"Publisher fetch failed.",Number(e?.status)||502)}
  const contentRange=upstream.headers.get("content-range")||"",rangeTotal=Number(contentRange.match(/\/(\d+)$/)?.[1])||0;
  const reported=rangeTotal||Number(upstream.headers.get("content-length"))||0;
  const headers=new Headers;
  for(const h of ["content-type","last-modified","etag","content-disposition","content-range","accept-ranges"])if(upstream.headers.has(h))headers.set(h,upstream.headers.get(h));
  if(reported)headers.set("x-bdd-upstream-size",String(reported));
  headers.set("x-bdd-range-bytes",String(requestedBytes));
  headers.set("cache-control","public, max-age="+EDGE_TTL_SECONDS);
  headers.set("cross-origin-resource-policy","same-origin");
  headers.set("x-content-type-options","nosniff");
  headers.set("x-bdd-relay","catalogue-id");
  headers.set("x-bdd-relay-id",id);
  headers.set("x-bdd-upstream",normalizeHost(finalUrl?.hostname));
  const body=request.method==="HEAD"?null:boundedBody(upstream.body,requestedBytes);
  return new Response(body,{status:upstream.status,statusText:upstream.statusText,headers});
}

/** For the MCP preview_dataset tool: the first maxBytes of a catalogue-indexed file, with the same host, redirect, timeout and rate limits as
 *  the browser relay. Only an opaque relay id from the generated index is accepted, never a URL. */
export function makePreviewFile(env={},options={}){
  return async(relayId,maxBytes)=>{
    const id=String(relayId||"").toLowerCase(),entry=/^f_[a-f0-9]{32}$/.test(id)?(options.index||RELAY_INDEX)[id]:null;
    if(!entry||!validateRelayTarget(entry))return{error:"this file is not in the catalogue relay index."};
    if(!(await rateLimit(env,id)))return{error:"the preview rate limit for this file was reached; try again in a minute."};
    const budget=Math.max(1024,Math.min(MAX_RELAY_BYTES,maxBytes));
    let upstream;
    try{upstream=(await fetchPublisher(entry,"GET",budget,options.fetchImpl||fetch)).response}
    catch(e){return{error:String(e?.message||"Publisher fetch failed.")}}
    if(upstream.status>=400)return{error:"the publisher answered HTTP "+upstream.status+"."};
    const reader=upstream.body?.getReader(),parts=[];let size=0,truncated=false;
    if(reader)for(;;){
      const {done,value}=await reader.read();if(done)break;
      const room=budget-size;
      if(value.length>=room){parts.push(value.slice(0,room));size+=room;truncated=true;await reader.cancel().catch(()=>{});break}
      parts.push(value);size+=value.length;
    }
    const bytes=new Uint8Array(size);let o=0;for(const p of parts){bytes.set(p,o);o+=p.length}
    const total=Number((upstream.headers.get("content-range")||"").match(/\/(\d+)$/)?.[1])||Number(upstream.headers.get("content-length"))||0;
    if(total>size)truncated=true;   // a declared size above what was read means there is more file
    return{bytes,truncated,totalBytes:total||null,contentType:upstream.headers.get("content-type")||""};
  };
}

/** For the DOV tools: one rate-limit check per tool call (key "dov"), on top of the per-answer request budget in dov.mjs. */
export async function dovRateLimit(env){
  const binding=env?.DOV_RATE_LIMITER;if(!binding?.limit)return true;
  try{return (await binding.limit({key:"dov"}))?.success!==false}catch{return false}
}

export default{
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname.startsWith("/api/dataset-file/"))return proxyDatasetFile(request,env);
    if(url.pathname==="/mcp")return handleMcp(request,env,{previewFile:makePreviewFile(env),dov:{fetchImpl:(u,init)=>fetch(u,init),rateLimit:()=>dovRateLimit(env)}});
    if(url.pathname==="/api/publisher-file")return errorResponse("This URL-based proxy has been removed. Use a catalogue-backed dataset relay ID.",410);
    if(url.pathname.startsWith("/feedback/"))return handleFeedbackHttp(request,env);
    return env.ASSETS.fetch(request);
  },
  // Weekly (wrangler.jsonc triggers): clean up the report queue and send the publisher digests when FEEDBACK_DIGEST=send.
  async scheduled(event,env,ctx){
    ctx.waitUntil(runDigest(env,{origin:publicOrigin(env,new Request("https://data.vecture.be/"))}).catch(()=>null));
  }
};
