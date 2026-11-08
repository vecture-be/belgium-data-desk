import { parseDelimitedPreviewText } from "./dataset-local-files-v2.mjs";

const fmt=v=>String(v??"").toLowerCase();
export function tabularDistributionForAsset(asset){
  return (asset?.distributions||[]).find(d=>{
    const format=fmt(d?.[1]),url=String(d?.[4]||"").toLowerCase(),name=fmt(d?.[0]);
    return /\b(?:csv|tsv)\b/.test(format+" "+name)||/file-type\/(?:csv|tsv)(?:$|[?#])/i.test(String(d?.[1]||""))||/\.(?:csv|tsv)(?:$|[?#])/i.test(url);
  })||null;
}
function encodingFor(bytes){
  if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)return{encoding:"utf-8",skip:3};
  if(bytes[0]===0xff&&bytes[1]===0xfe)return{encoding:"utf-16le",skip:2};
  if(bytes[0]===0xfe&&bytes[1]===0xff)return{encoding:"utf-16be",skip:2};
  try{new TextDecoder("utf-8",{fatal:true}).decode(bytes.slice(0,Math.min(bytes.length,65536)));return{encoding:"utf-8",skip:0}}
  catch{return{encoding:"windows-1252",skip:0}}
}
export async function fetchTabularPreview(asset,{fetchImpl=fetch,maxBytes=768*1024,maxRows=25,timeoutMs=12000}={}){
  const d=tabularDistributionForAsset(asset);if(!d)throw new Error("No CSV/TSV distribution found.");
  const url=d[4],controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    let r;
    try{r=await fetchImpl(url,{headers:{accept:"text/csv,text/tab-separated-values,text/plain;q=0.9,*/*;q=0.2"},signal:controller.signal})}
    catch(e){
      if(e?.name==="AbortError")throw e;
      const err=new Error("Browser could not fetch the publisher file. This is commonly caused by CORS.");err.code="CORS_OR_NETWORK";throw err;
    }
    if(!r.ok)throw new Error("Publisher returned HTTP "+r.status+".");
    if(!r.body)throw new Error("Publisher response has no readable body.");
    const reader=r.body.getReader(),parts=[];let total=0,truncated=false;
    while(true){
      const {done,value}=await reader.read();if(done)break;if(!value?.length)continue;
      const keep=Math.min(value.length,maxBytes-total);if(keep>0){parts.push(value.slice(0,keep));total+=keep}
      if(total>=maxBytes){truncated=true;await reader.cancel().catch(()=>{});break}
    }
    if(!parts.length)throw new Error("Publisher returned an empty file.");
    const bytes=new Uint8Array(total);let pos=0;for(const p of parts){bytes.set(p,pos);pos+=p.length}
    const e=encodingFor(bytes),text=new TextDecoder(e.encoding).decode(bytes.slice(e.skip));
    const parsed=parseDelimitedPreviewText(text,{name:url.split("/").pop()?.split("?")[0]||"remote.csv",maxRows});
    if(truncated&&parsed.rows.length)parsed.rows=parsed.rows.slice(0,Math.max(0,parsed.rows.length-1));
    return{
      ...parsed,url,format:d[1]||"CSV",bytesRead:total,truncated,encoding:e.encoding,
      contentLength:Number(r.headers?.get?.("content-length"))||null,contentType:r.headers?.get?.("content-type")||"",
      lastModified:r.headers?.get?.("last-modified")||null
    };
  }finally{clearTimeout(timer)}
}
