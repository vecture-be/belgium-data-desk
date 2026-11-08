const fmt=v=>String(v??"").toLowerCase();
const clean=v=>String(v??"").trim();

export const isTabularDistribution=d=>{
  const format=fmt(d?.[1]),url=String(d?.[4]||"").toLowerCase(),name=fmt(d?.[0]);
  return /\b(?:csv|tsv)\b/.test(format+" "+name)||/file-type\/(?:csv|tsv)(?:$|[?#])/i.test(String(d?.[1]||""))||/\.(?:csv|tsv)(?:$|[?#])/i.test(url);
};
const distributionLanguage=d=>{
  const hay=fmt([d?.[0],d?.[4]].join(" "));
  const m=hay.match(/(?:^|[_\-/])(nl|fr|de|en)(?:[._\-/?]|$)/i);if(m)return m[1].toLowerCase();
  if(/nederlands|dutch/.test(hay))return"nl";if(/fran[cç]ais|french/.test(hay))return"fr";if(/deutsch|german/.test(hay))return"de";if(/english/.test(hay))return"en";
  return"";
};
const preferredLanguages=()=>{
  const browser=typeof navigator!=="undefined"?(navigator.languages||[navigator.language]).filter(Boolean).map(x=>String(x).toLowerCase().split("-")[0]):[];
  return [...new Set([...browser,"nl","fr","de","en"])];
};
export function tabularDistributionsForAsset(asset,{languages=preferredLanguages()}={}){
  const order=[...new Set((languages||[]).map(x=>String(x).toLowerCase().split("-")[0]))];
  return (asset?.distributions||[]).filter(isTabularDistribution).map((d,i)=>({d,i,rank:(()=>{const lang=distributionLanguage(d),n=order.indexOf(lang);return n<0?999:n})()})).sort((a,b)=>a.rank-b.rank||a.i-b.i).map(x=>x.d);
}
export function tabularDistributionForAsset(asset,options){
  return tabularDistributionsForAsset(asset,options)[0]||null;
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
const numericValue=v=>{
  const s=clean(v).replace(/\s/g,"");if(!s)return null;
  const n=Number(s.includes(",")&&!s.includes(".")?s.replace(",","."):s);
  return Number.isFinite(n)?n:null;
};
const profileValue=(p,value,maxDistinct)=>{
  const s=clean(value);if(!s){p.missing++;return}
  p.nonEmpty++;
  if(!p.capped){
    if(p.seen.has(s))p.duplicates++;
    else if(p.seen.size<maxDistinct)p.seen.add(s);
    else p.capped=true;
  }
  if(p.minText===null||s.localeCompare(p.minText)<0)p.minText=s;
  if(p.maxText===null||s.localeCompare(p.maxText)>0)p.maxText=s;
  const n=numericValue(s);if(n!==null){if(p.minNum===null||n<p.minNum)p.minNum=n;if(p.maxNum===null||n>p.maxNum)p.maxNum=n}
  if(/^\d{4}-\d{2}-\d{2}/.test(s)){if(p.minDate===null||s<p.minDate)p.minDate=s;if(p.maxDate===null||s>p.maxDate)p.maxDate=s}
};
function accumulator(delimiter,{sampleRows=25,inferRows=250,profileColumns=true,maxDistinctPerField=100000,businessKey=[],maxKeyDistinct=500000}={}){
  let cell="",row=[],quoted=false,pendingQuote=false,headers=null,rowCount=0,keyIndexes=[],keyMissingFields=[];
  const samples=[],types=[],profiles=[],keyState={seen:new Map,rows:0,completeRows:0,nullRows:0,duplicateRows:0,duplicateGroups:0,capped:false};
  const finishRow=()=>{
    const values=[...row,cell];row=[];cell="";
    if(!values.some(v=>clean(v)))return;
    if(!headers){
      headers=uniqueHeaders(values);
      if(profileColumns)headers.forEach(()=>profiles.push({seen:new Set,nonEmpty:0,missing:0,duplicates:0,capped:false,minText:null,maxText:null,minNum:null,maxNum:null,minDate:null,maxDate:null}));
      keyIndexes=(businessKey||[]).map(name=>headers.indexOf(name));keyMissingFields=(businessKey||[]).filter((_,i)=>keyIndexes[i]<0);
      return;
    }
    rowCount++;
    if(rowCount<=inferRows)headers.forEach((_,i)=>types[i]=mergeType(types[i],valueType(values[i]??"")));
    if(profileColumns)headers.forEach((_,i)=>profileValue(profiles[i],values[i]??"",maxDistinctPerField));
    if(samples.length<sampleRows){
      const o={};headers.forEach((h,i)=>o[h]=values[i]??"");samples.push(o);
    }
    if(businessKey?.length&&!keyMissingFields.length){
      keyState.rows++;const parts=keyIndexes.map(i=>clean(values[i]??""));
      if(parts.some(v=>!v)){keyState.nullRows++;return}
      keyState.completeRows++;const key=JSON.stringify(parts);
      const count=keyState.seen.get(key);
      if(count){keyState.seen.set(key,count+1);keyState.duplicateRows++;if(count===1)keyState.duplicateGroups++}
      else if(keyState.seen.size<maxKeyDistinct)keyState.seen.set(key,1);
      else keyState.capped=true;
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
    const finalTypes=(headers||[]).map((_,i)=>types[i]||"string");
    const columnProfile=(headers||[]).map((name,i)=>{
      const x=profiles[i];if(!profileColumns||!x)return{name,type:finalTypes[i]};
      const type=finalTypes[i],min=type==="integer"||type==="number"?x.minNum:type==="date"||type==="datetime"?x.minDate:x.minText,max=type==="integer"||type==="number"?x.maxNum:type==="date"||type==="datetime"?x.maxDate:x.maxText;
      return{name,type,nonEmpty:x.nonEmpty,missing:x.missing,unique:x.seen.size,uniqueKind:x.capped?"lower-bound":"exact",duplicates:x.duplicates,duplicateKind:x.capped?"lower-bound":"exact",min,max};
    });
    return{headers:headers||[],rowCount,samples,types:finalTypes,columnProfile,businessKey:businessKey?.length?{fields:[...businessKey],missingFields:keyMissingFields,rows:keyState.rows,completeRows:keyState.completeRows,nullRows:keyState.nullRows,uniqueKeys:keyState.seen.size,duplicateRows:keyState.duplicateRows,duplicateGroups:keyState.duplicateGroups,capped:keyState.capped}:null};
  };
  return{push,finish};
}
const delimiterLabel=d=>d==="\t"?"tab":d===";"?"semicolon":d==="|"?"pipe":"comma";

export async function inspectTabularInBrowser(asset,{
  fetchImpl=fetch,maxBytes=64*1024*1024,maxRows=25,timeoutMs=45000,profileColumns=true,maxDistinctPerField=100000,businessKey=[],maxKeyDistinct=500000
}={}){
  const d=tabularDistributionForAsset(asset);if(!d)throw new Error("No CSV/TSV distribution found.");
  const url=d[4],controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    let r,transport="direct";
    const headers={accept:"text/csv,text/tab-separated-values,text/plain;q=0.9,*/*;q=0.2"};
    try{
      r=await fetchImpl(url,{headers,signal:controller.signal});
    }catch(e){
      if(e?.name==="AbortError")throw new Error("Browser inspection timed out.");
      transport="proxy";
      try{r=await fetchImpl("/api/publisher-file?url="+encodeURIComponent(url),{headers,signal:controller.signal})}
      catch(proxyError){
        if(proxyError?.name==="AbortError")throw new Error("Browser inspection timed out.");
        const err=new Error("Publisher blocked the direct browser read and the safe proxy fallback was unavailable.");err.code="CORS_OR_NETWORK";throw err;
      }
    }
    if(!r.ok){
      const err=new Error((transport==="proxy"?"Safe proxy":"Publisher")+" returned HTTP "+r.status+".");
      err.code=transport==="proxy"&&r.status===403?"PROXY_NOT_ALLOWED":"HTTP_ERROR";throw err;
    }
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
        delimiter=detectDelimiter(initial,{url,format:d[1]||""});a=accumulator(delimiter,{sampleRows:maxRows,profileColumns,maxDistinctPerField,businessKey,maxKeyDistinct});a.push(initial);
      }else a.push(decoder.decode(chunk,{stream:true}));
      if(truncated){await reader.cancel().catch(()=>{});break}
    }
    if(first)throw new Error("Publisher returned an empty file.");
    a.push(decoder.decode());
    const parsed=a.finish({includePartial:!truncated});
    return{
      url,format:d[1]||"CSV",encoding,delimiter:delimiterLabel(delimiter),transport,
      bytesRead,reportedBytes,truncated,rowCount:parsed.rowCount,rowCountKind:truncated?"lower-bound":"exact",
      fields:parsed.columnProfile.map(f=>truncated&&profileColumns?{...f,uniqueKind:"lower-bound",duplicateKind:"lower-bound"}:f),
      rows:parsed.samples,
      businessKey:parsed.businessKey?{...parsed.businessKey,exact:!truncated&&!parsed.businessKey.capped&&!parsed.businessKey.missingFields.length}:null,
      contentType:r.headers?.get?.("content-type")||"",lastModified:r.headers?.get?.("last-modified")||null
    };
  }finally{clearTimeout(timer)}
}
