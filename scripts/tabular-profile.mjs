export const TABULAR_PROFILE_VERSION="1";
const DEFAULT_SAMPLE_ROWS=8,DEFAULT_INFER_ROWS=250;
const clean=v=>String(v??"").trim();
const fmt=v=>clean(v).toLowerCase();

export function isTabularDistribution(d){
  const f=fmt(d?.format),u=String(d?.url||"").toLowerCase(),n=fmt(d?.name);
  return /(?:^|\b)(csv|tsv|tab[- ]?separated)(?:\b|$)/i.test(f+" "+n)||
    /file-type\/(?:CSV|TSV)(?:$|[?#])/i.test(String(d?.format||""))||
    /\.(?:csv|tsv)(?:$|[?#])/i.test(u);
}
export function pickTabularDistribution(item){
  const rows=(item?.distributions||[]).filter(isTabularDistribution);
  return rows.sort((a,b)=>distributionScore(b)-distributionScore(a))[0]||null;
}
function distributionScore(d){
  const u=String(d?.url||""),n=fmt(d?.name),f=fmt(d?.format);let s=0;
  if(/\.csv(?:$|[?#])/i.test(u))s+=40;if(/\.tsv(?:$|[?#])/i.test(u))s+=35;
  if(/\bCSV\b/i.test(String(d?.format||"")))s+=20;if(/\bTSV\b/i.test(String(d?.format||"")))s+=18;
  if(/(?:_nl|[-_]nl)\.csv/i.test(u)||/dutch|nederlands|n[eé]erlandais/.test(n))s+=8;
  if(/(?:_en|[-_]en)\.csv/i.test(u)||/english|anglais/.test(n))s+=6;
  if(/^https:/i.test(u))s+=3;if(/download|static|file/.test(u))s+=2;
  return s;
}

function privateIpv4(host){
  const m=host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);if(!m)return false;
  const a=m.slice(1).map(Number);if(a.some(x=>x>255))return true;
  return a[0]===10||a[0]===127||a[0]===0||a[0]===169&&a[1]===254||a[0]===192&&a[1]===168||a[0]===172&&a[1]>=16&&a[1]<=31;
}
export function safePublicUrl(value){
  try{
    const u=new URL(String(value||""));if(!/^https?:$/.test(u.protocol))return null;
    if(u.username||u.password)return null;
    const h=u.hostname.toLowerCase();
    if(!h||h==="localhost"||h.endsWith(".localhost")||h.endsWith(".local")||h==="::1"||h.startsWith("[")||privateIpv4(h))return null;
    if(u.port&&!["80","443"].includes(u.port))return null;
    return u;
  }catch{return null}
}
async function fetchSafe(url,{fetchImpl=fetch,signal,headers={},maxRedirects=4}={}){
  let current=safePublicUrl(url);if(!current)throw new Error("unsafe or unsupported distribution URL");
  for(let i=0;i<=maxRedirects;i++){
    const r=await fetchImpl(current.href,{headers,signal,redirect:"manual"});
    if(r.status>=300&&r.status<400){
      const loc=r.headers?.get?.("location");if(!loc)throw new Error("redirect without location");
      current=safePublicUrl(new URL(loc,current).href);if(!current)throw new Error("redirected to unsafe URL");continue;
    }
    return r;
  }
  throw new Error("too many redirects");
}
export function encodingFor(bytes){
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
  let q=false,n=0;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){if(q&&line[i+1]==='"'){i++;continue}q=!q}
    else if(!q&&ch===delimiter)n++;
  }return n;
}
export function detectDelimiter(text,{url="",format=""}={}){
  if(/\.tsv(?:$|[?#])/i.test(url)||/\btsv\b|tab[- ]?separated/i.test(format))return"\t";
  const line=firstLogicalLine(String(text||"")),candidates=[",",";","\t","|"].map(x=>[x,countOutsideQuotes(line,x)]);
  candidates.sort((a,b)=>b[1]-a[1]);return candidates[0][1]>0?candidates[0][0]:",";
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
function accumulator(delimiter,{sampleRows=DEFAULT_SAMPLE_ROWS,inferRows=DEFAULT_INFER_ROWS}={}){
  let cell="",row=[],quoted=false,pendingQuote=false,headers=null,rowCount=0,nonEmptyRows=0;
  const samples=[],types=[];
  const finishRow=()=>{
    const values=[...row,cell];row=[];cell="";
    if(!values.some(v=>clean(v)))return;
    nonEmptyRows++;
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
  const finish=()=>{
    if(pendingQuote){pendingQuote=false;quoted=false}
    if(cell||row.length)finishRow();
    return{headers:headers||[],rowCount,samples,types:(headers||[]).map((_,i)=>types[i]||"string"),nonEmptyRows};
  };
  return{push,finish};
}
export function parseDelimitedText(text,{delimiter=detectDelimiter(text),sampleRows=DEFAULT_SAMPLE_ROWS,inferRows=DEFAULT_INFER_ROWS}={}){
  const a=accumulator(delimiter,{sampleRows,inferRows});a.push(String(text||""));return{delimiter,...a.finish()};
}
function delimiterLabel(d){return d==="\t"?"tab":d===";"?"semicolon":d==="|"?"pipe":"comma"}

export async function profileDelimitedDistribution(distribution,{
  fetchImpl=fetch,timeoutMs=18000,maxBytes=16*1024*1024,sampleRows=DEFAULT_SAMPLE_ROWS,inferRows=DEFAULT_INFER_ROWS,userAgent="Belgium-Data-Desk/3.1"
}={}){
  const url=distribution?.url,u=safePublicUrl(url);if(!u)throw new Error("distribution URL is not a safe public HTTP(S) URL");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetchSafe(u.href,{fetchImpl,signal:controller.signal,headers:{"user-agent":userAgent,accept:"text/csv,text/tab-separated-values,text/plain;q=0.9,*/*;q=0.2"}});
    if(!r.ok)throw new Error("HTTP "+r.status);
    if(!r.body)throw new Error("response has no body");
    const contentType=r.headers?.get?.("content-type")||"",contentLength=Number(r.headers?.get?.("content-length"))||null;
    const reader=r.body.getReader();let first=true,decoder=null,enc="utf-8",skip=0,delim=null,a=null,bytesRead=0,truncated=false;
    while(true){
      const {done,value}=await reader.read();if(done)break;if(!value?.length)continue;
      let chunk=value;
      if(bytesRead+chunk.length>maxBytes){
        const keep=Math.max(0,maxBytes-bytesRead);chunk=chunk.slice(0,keep);truncated=true;
      }
      bytesRead+=chunk.length;
      if(first){
        first=false;const e=encodingFor(chunk);enc=e.encoding;skip=e.skip;decoder=new TextDecoder(enc);chunk=chunk.slice(skip);
        const initial=decoder.decode(chunk,{stream:true});
        if(/^\s*<(?:!doctype|html)\b/i.test(initial)&&!/csv|tab-separated|text\/plain/i.test(contentType))throw new Error("distribution returned HTML instead of a tabular file");
        delim=detectDelimiter(initial,{url:u.href,format:distribution?.format||""});a=accumulator(delim,{sampleRows,inferRows});a.push(initial);
      }else a.push(decoder.decode(chunk,{stream:true}));
      if(truncated){await reader.cancel().catch(()=>{});break}
    }
    if(first)throw new Error("empty response");
    a.push(decoder.decode());
    const parsed=a.finish(),exact=!truncated;
    const fields=parsed.headers.map((name,i)=>({name,label:name,type:parsed.types[i]||"string",description:"Observed from downloaded file header; type inferred from sampled values."}));
    return{
      status:"ok",version:TABULAR_PROFILE_VERSION,sourceUrl:u.href,profiledAt:new Date().toISOString(),
      contentType,contentLength,bytesRead,encoding:enc,delimiter:delimiterLabel(delim),
      rowCount:parsed.rowCount,rowCountKind:exact?"exact":"lower-bound",
      fields,previewRows:parsed.samples,
      fileLastModified:r.headers?.get?.("last-modified")||null,etag:r.headers?.get?.("etag")||null
    };
  }finally{clearTimeout(timer)}
}
function priorityScore(item,d,priorityIds){
  const id=String(item?.datasetId||"").toLowerCase(),p=fmt(item?.provider),u=String(d?.url||"");let s=0;
  if(priorityIds.some(x=>id.includes(String(x).toLowerCase())))s+=10000;
  if(/favv|afsca|fasfc/.test(p+" "+id))s+=5000;
  if(/\.csv(?:$|[?#])/i.test(u))s+=400;if(/^https:/i.test(u))s+=40;
  return s;
}
function diversifiedCandidates(payload,{limit,priorityIds}){
  const rows=(payload?.items||[]).map(item=>({item,d:pickTabularDistribution(item)})).filter(x=>x.d&&safePublicUrl(x.d.url));
  rows.sort((a,b)=>priorityScore(b.item,b.d,priorityIds)-priorityScore(a.item,a.d,priorityIds));
  const selected=[],seen=new Set;
  for(const x of rows){
    if(priorityScore(x.item,x.d,priorityIds)<5000)break;
    selected.push(x);seen.add(x.item.id);
  }
  const groups=new Map;
  for(const x of rows){if(seen.has(x.item.id))continue;const k=fmt(x.item.provider)||"unknown";if(!groups.has(k))groups.set(k,[]);groups.get(k).push(x)}
  const keys=[...groups.keys()].sort(),day=Math.floor(Date.parse(payload?.generatedAt||new Date().toISOString())/86400000)||0;
  const ordered=keys.length?keys.slice(day%keys.length).concat(keys.slice(0,day%keys.length)):[];
  for(const k of ordered){const xs=groups.get(k);if(xs?.length){const n=day%xs.length;groups.set(k,xs.slice(n).concat(xs.slice(0,n)))}}
  while(selected.length<limit){
    let added=false;
    for(const k of ordered){const xs=groups.get(k),x=xs?.shift();if(x){selected.push(x);added=true;if(selected.length>=limit)break}}
    if(!added)break;
  }
  return selected.slice(0,limit);
}
async function mapLimit(xs,n,fn){
  const out=new Array(xs.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=xs.length)return;try{out[i]=await fn(xs[i],i)}catch(e){out[i]={error:e.message}}}}
  await Promise.all(Array.from({length:Math.min(n,xs.length)},worker));return out;
}
export function reusePreviousTabularProfiles(payload,previous){
  const prior=new Map((previous?.items||[]).filter(x=>x?.tabularProfile?.status==="ok").map(x=>[String(x.datasetId||x.id),x]));
  let reused=0;
  const items=(payload?.items||[]).map(item=>{
    if(item.tabularProfile?.status==="ok")return item;
    const old=prior.get(String(item.datasetId||item.id));if(!old)return item;
    const source=old.tabularProfile?.sourceUrl,currentUrls=new Set((item.distributions||[]).map(d=>d.url).filter(Boolean));
    if(!source||!currentUrls.has(source))return item;
    reused++;
    return{...item,recordCount:old.recordCount,recordCountKind:old.recordCountKind,fields:old.fields||[],previewRows:old.previewRows||[],schemaOrigin:old.schemaOrigin||"observed-file-header",sampleOrigin:old.sampleOrigin||"profiled-file-records",tabularProfile:{...old.tabularProfile,reusedFromSnapshot:true},enrichment:old.enrichment||item.enrichment};
  });
  return{...payload,items,profileSummary:{...(payload.profileSummary||{}),reused}};
}
export async function profileNationalTabular(payload,{
  fetchImpl=fetch,limit=32,concurrency=4,priorityIds=["favv-afsca-operators","fasfc-activity-codes","afsca-smiley"]
}={}){
  const candidates=diversifiedCandidates(payload,{limit,priorityIds});
  const attemptedAt=new Date().toISOString();
  const results=await mapLimit(candidates,concurrency,async ({item,d})=>{
    const important=priorityScore(item,d,priorityIds)>=5000;
    try{
      const profile=await profileDelimitedDistribution(d,{fetchImpl,maxBytes:important?128*1024*1024:16*1024*1024,timeoutMs:important?45000:16000});
      return{itemId:item.id,sourceUrl:d.url,profile};
    }catch(e){return{itemId:item.id,sourceUrl:d.url,error:e?.message||String(e)}}
  });
  const byId=new Map(results.filter(x=>x?.itemId&&x.profile).map(x=>[x.itemId,x.profile]));
  const failedById=new Map(results.filter(x=>x?.itemId&&x.error).map(x=>[x.itemId,x]));
  const failures=failedById.size;
  const items=(payload.items||[]).map(item=>{
    const p=byId.get(item.id);
    if(p)return{
      ...item,recordCount:p.rowCount,recordCountKind:p.rowCountKind,fields:p.fields,previewRows:p.previewRows,
      schemaOrigin:"observed-file-header",sampleOrigin:"profiled-file-records",tabularProfile:p,
      enrichment:{...(item.enrichment||{}),score:Math.max(35,item.enrichment?.score||0),reasons:[...new Set([...(item.enrichment?.reasons||[]),"downloaded file header","sampled file rows",p.rowCountKind==="exact"?"exact streamed row count":"bounded streamed row count"])],schemaOrigin:"observed-file-header",sampled:true}
    };
    const failed=failedById.get(item.id);if(!failed)return item;
    return{...item,tabularProfile:{status:"failed",version:TABULAR_PROFILE_VERSION,sourceUrl:failed.sourceUrl,profiledAt:attemptedAt,error:failed.error}};
  });
  return{
    ...payload,items,
    profileSummary:{version:TABULAR_PROFILE_VERSION,attempted:candidates.length,succeeded:byId.size,failed:failures,exact:[...byId.values()].filter(x=>x.rowCountKind==="exact").length,generatedAt:new Date().toISOString()}
  };
}
