const fmt=v=>String(v??"").toLowerCase();
const clean=v=>String(v??"").trim();

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
function firstLogicalLine(text){
  let quoted=false,out="";
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){
      if(quoted&&text[i+1]==='"'){out+='""';i++;continue}
      quoted=!quoted;out+=ch;continue;
    }
    if(!quoted&&(ch==="\n"||ch==="\r"))break;
    out+=ch;
  }
  return out;
}
function countOutsideQuotes(line,delimiter){
  let quoted=false,n=0;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(quoted&&line[i+1]==='"'){i++;continue}
      quoted=!quoted;
    }else if(!quoted&&ch===delimiter)n++;
  }
  return n;
}
function detectDelimiter(text,{url="",format=""}={}){
  if(/\.tsv(?:$|[?#])/i.test(url)||/\btsv\b|tab[- ]?separated/i.test(format))return"\t";
  const line=firstLogicalLine(String(text||""));
  const candidates=[",",";","\t","|"].map(d=>[d,countOutsideQuotes(line,d)]).sort((a,b)=>b[1]-a[1]);
  return candidates[0][1]>0?candidates[0][0]:",";
}
function uniqueHeaders(raw){
  const seen=new Map;
  return raw.map((v,i)=>{const base=clean(v)||"column_"+(i+1),n=(seen.get(base)||0)+1;seen.set(base,n);return n===1?base:base+"_"+n});
}
function valueType(v){
  const s=clean(v);if(!s)return null;
  if(/^(?:true|false|yes|no|ja|nee)$/i.test(s))return"boolean";
  if(/^[+-]?\d+$/.test(s))return"integer";
  if(/^[+-]?(?:\d+[.,]\d+|\d{1,3}(?:[ .]\d{3})+(?:,\d+)?)$/.test(s))return"number";
  if(/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(s))return s.length>10?"datetime":"date";
  return"string";
}
function mergeType(a,b){
  if(!a)return b;if(!b||a===b)return a;
  if((a==="integer"&&b==="number")||(a==="number"&&b==="integer"))return"number";
  if((a==="date"&&b==="datetime")||(a==="datetime"&&b==="date"))return"datetime";
  return"string";
}
function accumulator(delimiter,{sampleRows=25,inferRows=250}={}){
  let cell="",row=[],quoted=false,pendingQuote=false,headers=null,rowCount=0;
  const samples=[],types=[];
  const finishRow=()=>{
    const values=[...row,cell];row=[];cell="";
    if(!values.some(v=>clean(v)))return;
    if(!headers){headers=uniqueHeaders(values);return}
    rowCount++;
    if(rowCount<=inferRows)values.forEach((v,i)=>types[i]=mergeType(types[i],valueType(v)));
    if(samples.length<sampleRows){
      const o={};headers.forEach((h,i)=>o[h]=values[i]??"");samples.push(o);
    }
  };
  const push=text=>{
    let i=0;
    if(pendingQuote){
      if(text[0]==='"'){cell+='"';quoted=true;i=1}else quoted=false;
      pendingQuote=false;
    }
    for(;i<text.length;i++){
      const ch=text[i];
      if(quoted){
        if(ch==='"'){
          if(i+1<text.length&&text[i+1]==='"'){cell+='"';i++}
          else if(i===text.length-1)pendingQuote=true;
          else quoted=false;
        }else cell+=ch;
      }else if(ch==='"')quoted=true;
      else if(ch===delimiter){row.push(cell);cell=""}
      else if(ch==="\n")finishRow();
      else if(ch!=="\r")cell+=ch;
    }
  };
  const finish=({includePartial=true}={})=>{
    if(pendingQuote){pendingQuote=false;quoted=false}
    if(includePartial&&(cell||row.length))finishRow();
    return{headers:headers||[],rowCount,samples,types:(headers||[]).map((_,i)=>types[i]||"string")};
  };
  return{push,finish};
}
const delimiterLabel=d=>d==="\t"?"tab":d===";"?"semicolon":d==="|"?"pipe":"comma";

export async function inspectTabularInBrowser(asset,{
  fetchImpl=fetch,maxBytes=64*1024*1024,maxRows=25,timeoutMs=45000
}={}){
  const d=tabularDistributionForAsset(asset);if(!d)throw new Error("No CSV/TSV distribution found.");
  const url=d[4],controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    let r;
    try{
      r=await fetchImpl(url,{headers:{accept:"text/csv,text/tab-separated-values,text/plain;q=0.9,*/*;q=0.2"},signal:controller.signal});
    }catch(e){
      if(e?.name==="AbortError")throw new Error("Browser inspection timed out.");
      const err=new Error("Browser could not read the publisher file. The publisher may block cross-origin requests (CORS).");err.code="CORS_OR_NETWORK";throw err;
    }
    if(!r.ok)throw new Error("Publisher returned HTTP "+r.status+".");
    if(!r.body)throw new Error("Publisher response has no readable body.");
    const reportedBytes=Number(r.headers?.get?.("content-length"))||null;
    const reader=r.body.getReader();let first=true,decoder=null,encoding="utf-8",delimiter=",",a=null,bytesRead=0,truncated=false;
    while(true){
      const {done,value}=await reader.read();if(done)break;if(!value?.length)continue;
      let chunk=value;
      if(bytesRead+chunk.length>maxBytes){
        const keep=Math.max(0,maxBytes-bytesRead);chunk=chunk.slice(0,keep);truncated=true;
      }
      bytesRead+=chunk.length;
      if(first){
        first=false;
        const e=encodingFor(chunk);encoding=e.encoding;decoder=new TextDecoder(encoding);chunk=chunk.slice(e.skip);
        const initial=decoder.decode(chunk,{stream:true});
        delimiter=detectDelimiter(initial,{url,format:d[1]||""});a=accumulator(delimiter,{sampleRows:maxRows});a.push(initial);
      }else a.push(decoder.decode(chunk,{stream:true}));
      if(truncated){await reader.cancel().catch(()=>{});break}
    }
    if(first)throw new Error("Publisher returned an empty file.");
    a.push(decoder.decode());
    const parsed=a.finish({includePartial:!truncated});
    return{
      url,format:d[1]||"CSV",encoding,delimiter:delimiterLabel(delimiter),
      bytesRead,reportedBytes,truncated,rowCount:parsed.rowCount,rowCountKind:truncated?"lower-bound":"exact",
      fields:parsed.headers.map((name,i)=>({name,type:parsed.types[i]||"string"})),
      rows:parsed.samples,
      contentType:r.headers?.get?.("content-type")||"",lastModified:r.headers?.get?.("last-modified")||null
    };
  }finally{clearTimeout(timer)}
}
