import { VALIDATION_MODEL_VERSION } from "./dataset-validation-v1.mjs";

const MAX_FILE_BYTES=60*1024*1024,MAX_ROWS=30000,MAX_COLS=220,MAX_SHEETS=24;
export const LOCAL_FILE_LIMITS={maxFileBytes:MAX_FILE_BYTES,maxRowsPerSheet:MAX_ROWS,maxColumns:MAX_COLS,maxSheets:MAX_SHEETS};
const td=new TextDecoder("utf-8");
const norm=v=>String(v??"").trim();
const keyNorm=v=>norm(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"");
const xmlDecode=s=>String(s??"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));

function uniqueHeaders(raw){
  const seen=new Map;
  return raw.map((x,i)=>{
    const base=norm(x)||"column_"+(i+1),n=(seen.get(base)||0)+1;seen.set(base,n);return n===1?base:base+"_"+n;
  });
}
function tableToSheet(name,table){
  const rows=(table||[]).slice(0,MAX_ROWS).map(r=>Array.from(r||[]).slice(0,MAX_COLS));
  if(!rows.length)return{name,rows:[],columns:[],rowCount:0,headerRow:0};
  let headerRow=0,best=-Infinity;
  for(let i=0;i<Math.min(30,rows.length);i++){
    const vals=rows[i].map(norm),non=vals.filter(Boolean),strings=non.filter(x=>Number.isNaN(Number(x))).length;
    const score=non.length*10+strings-Math.max(0,i-8);
    if(non.length>=2&&score>best){best=score;headerRow=i}
  }
  const headers=uniqueHeaders(rows[headerRow]||[]);
  const objects=[];
  for(const r of rows.slice(headerRow+1)){
    if(!r.some(x=>norm(x)))continue;
    const o={};headers.forEach((h,j)=>o[h]=r[j]??"");objects.push(o);
    if(objects.length>=MAX_ROWS)break;
  }
  return{name,rows:objects,columns:headers,rowCount:objects.length,headerRow};
}
function parseDelimited(text,delimiter){
  text=String(text||"").replace(/^\uFEFF/,"");const out=[],row=[];let cell="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}
      else if(ch==='"')quoted=false;else cell+=ch;
    }else if(ch==='"')quoted=true;
    else if(ch===delimiter){row.push(cell);cell=""}
    else if(ch==="\n"){row.push(cell.replace(/\r$/,""));out.push(row.splice(0));cell="";if(out.length>MAX_ROWS+40)break}
    else cell+=ch;
  }
  if(cell||row.length){row.push(cell.replace(/\r$/,""));out.push(row)}
  return out;
}
function delimiterFor(text,name){
  if(/\.tsv$/i.test(name))return"\t";
  const first=String(text).split(/\r?\n/,1)[0]||"";
  const counts=[[",",(first.match(/,/g)||[]).length],[";",(first.match(/;/g)||[]).length],["\t",(first.match(/\t/g)||[]).length]];
  return counts.sort((a,b)=>b[1]-a[1])[0][0];
}
export function parseDelimitedPreviewText(text,{name="remote.csv",maxRows=25}={}){
  const delimiter=delimiterFor(text,name),sheet=tableToSheet("preview",parseDelimited(text,delimiter));
  return{...sheet,rows:sheet.rows.slice(0,maxRows),delimiter:delimiter==="\t"?"tab":delimiter===";"?"semicolon":"comma"};
}
function jsonRows(j){
  if(Array.isArray(j))return j.map(x=>Array.isArray(x)?x:x&&typeof x==="object"?x:{value:x});
  if(j?.type==="FeatureCollection"&&Array.isArray(j.features))return j.features.map(f=>({...f.properties,_geometry:f.geometry?.type||null}));
  for(const k of ["results","records","items","data","features"]){
    if(Array.isArray(j?.[k]))return k==="features"?j[k].map(f=>({...f.properties,_geometry:f.geometry?.type||null})):j[k];
  }
  return j&&typeof j==="object"?[j]:[];
}
function objectsToSheet(name,objects){
  const rows=(objects||[]).filter(x=>x&&typeof x==="object"&&!Array.isArray(x)).slice(0,MAX_ROWS);
  const columns=[...new Set(rows.flatMap(x=>Object.keys(x)))].slice(0,MAX_COLS);
  return{name,rows:rows.map(x=>Object.fromEntries(columns.map(k=>[k,x[k]??""]))),columns,rowCount:rows.length,headerRow:0};
}
const u16=(v,o)=>v.getUint16(o,true),u32=(v,o)=>v.getUint32(o,true);
async function inflateRaw(bytes){
  if(typeof DecompressionStream==="undefined")throw new Error("This browser cannot decompress XLSX files locally.");
  const ds=new DecompressionStream("deflate-raw"),stream=new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function zipEntries(buffer){
  const bytes=new Uint8Array(buffer),v=new DataView(buffer);let eocd=-1;
  for(let i=Math.max(0,bytes.length-65557);i<=bytes.length-22;i++)if(u32(v,i)===0x06054b50)eocd=i;
  if(eocd<0)throw new Error("Invalid XLSX/ZIP: central directory not found.");
  const count=u16(v,eocd+10),offset=u32(v,eocd+16),entries=new Map;let p=offset;
  for(let n=0;n<count&&p+46<=bytes.length;n++){
    if(u32(v,p)!==0x02014b50)throw new Error("Invalid XLSX/ZIP central directory.");
    const method=u16(v,p+10),size=u32(v,p+20),nameLen=u16(v,p+28),extraLen=u16(v,p+30),commentLen=u16(v,p+32),local=u32(v,p+42);
    const name=td.decode(bytes.slice(p+46,p+46+nameLen));
    if(u32(v,local)!==0x04034b50)throw new Error("Invalid XLSX/ZIP local entry.");
    const ln=u16(v,local+26),le=u16(v,local+28),start=local+30+ln+le,compressed=bytes.slice(start,start+size);
    entries.set(name,async()=>method===0?compressed:method===8?inflateRaw(compressed):Promise.reject(new Error("Unsupported XLSX compression method "+method)));
    p+=46+nameLen+extraLen+commentLen;
  }
  return entries;
}
const attr=(tag,name)=>{const m=String(tag).match(new RegExp("(?:^|\\s)"+name.replace(":","\\:")+"=[\"']([^\"']*)[\"']","i"));return m?xmlDecode(m[1]):""};
const colIndex=ref=>{const m=String(ref).match(/^([A-Z]+)/i);if(!m)return 0;let n=0;for(const ch of m[1].toUpperCase())n=n*26+ch.charCodeAt(0)-64;return n-1};
async function entryText(entries,name){const get=entries.get(name);return get?td.decode(await get()):""}
function sharedStrings(xml){
  const out=[];for(const m of String(xml).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)){
    let s="";for(const t of m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi))s+=xmlDecode(t[1]);out.push(s);
  }return out;
}
function sheetTable(xml,shared){
  const table=[];for(const rm of String(xml).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)){
    const row=[];for(const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)){
      const at=cm[1],body=cm[2],idx=Math.min(MAX_COLS-1,colIndex(attr(at,"r"))),type=attr(at,"t");
      let raw=(body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)||[])[1]??"";
      if(type==="inlineStr"){raw=[...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map(x=>xmlDecode(x[1])).join("")}
      else if(type==="s")raw=shared[Number(raw)]??"";
      else raw=xmlDecode(raw);
      row[idx]=raw;
    }
    table.push(row);if(table.length>=MAX_ROWS+40)break;
  }return table;
}
async function parseXlsx(buffer,name){
  const entries=await zipEntries(buffer),shared=sharedStrings(await entryText(entries,"xl/sharedStrings.xml"));
  const wb=await entryText(entries,"xl/workbook.xml"),rels=await entryText(entries,"xl/_rels/workbook.xml.rels"),targets=new Map;
  for(const m of rels.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/gi))targets.set(attr(m[1],"Id"),attr(m[1],"Target"));
  const defs=[];
  for(const m of wb.matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/gi)){
    const n=attr(m[1],"name")||"Sheet "+(defs.length+1),rid=attr(m[1],"r:id"),target=targets.get(rid);
    if(target)defs.push({name:n,path:target.startsWith("/")?target.slice(1):"xl/"+target.replace(/^\.\//,"")});
  }
  if(!defs.length)for(const k of entries.keys())if(/^xl\/worksheets\/sheet\d+\.xml$/i.test(k))defs.push({name:k.split("/").pop(),path:k});
  const sheets=[];
  for(const d of defs.slice(0,MAX_SHEETS)){const xml=await entryText(entries,d.path);if(xml){const s=tableToSheet(d.name,sheetTable(xml,shared));if(s.rowCount||s.columns.length)sheets.push(s)}}
  if(!sheets.length)throw new Error("No readable worksheet was found in the XLSX file.");
  return{name,type:"xlsx",sheets};
}
export async function parseLocalFile(file){
  if(!file)throw new Error("Choose a file.");
  if(file.size>MAX_FILE_BYTES)throw new Error("File is larger than the 60 MB local-processing limit.");
  const name=file.name||"local file",lower=name.toLowerCase();
  if(lower.endsWith(".xlsx"))return parseXlsx(await file.arrayBuffer(),name);
  const text=await file.text();
  if(lower.endsWith(".json")||lower.endsWith(".geojson")||/json/i.test(file.type||"")){
    const j=JSON.parse(text),s=objectsToSheet("data",jsonRows(j));return{name,type:"json",sheets:[s]};
  }
  if(lower.endsWith(".csv")||lower.endsWith(".tsv")||/csv|tab-separated/i.test(file.type||"")){
    const delimiter=delimiterFor(text,name),s=tableToSheet("data",parseDelimited(text,delimiter));return{name,type:delimiter==="\t"?"tsv":"csv",sheets:[s]};
  }
  throw new Error("Unsupported file. Use XLSX, CSV, TSV, JSON or GeoJSON.");
}
function scoreColumn(name,patterns){const n=keyNorm(name);let best=0;for(const p of patterns){const q=keyNorm(p);if(n===q)best=Math.max(best,100);else if(n.includes(q)||q.includes(n))best=Math.max(best,60-Math.abs(n.length-q.length));}return best}
function findColumn(sheet,patterns){
  const ranked=(sheet?.columns||[]).map(x=>[x,scoreColumn(x,patterns)]).sort((a,b)=>b[1]-a[1]);return ranked[0]?.[1]>15?ranked[0][0]:null;
}
function bestSheet(parsed,fieldPatterns){
  const ranked=(parsed?.sheets||[]).map(s=>[s,fieldPatterns.reduce((n,p)=>n+(findColumn(s,p)?1:0),0)]).sort((a,b)=>b[1]-a[1]||b[0].rowCount-a[0].rowCount);
  return ranked[0]?.[0]||null;
}
function counts(values){const m=new Map;for(const v of values)m.set(v,(m.get(v)||0)+1);return m}
function joinMetrics(left,right,lf,rf){
  const clean=x=>norm(x),la=left.rows.map(x=>clean(x[lf])),ra=right.rows.map(x=>clean(x[rf])),lk=la.filter(Boolean),rk=ra.filter(Boolean),lc=counts(lk),rc=counts(rk),ls=new Set(lk),rs=new Set(rk),matched=[...ls].filter(x=>rs.has(x));
  let lm=false,rm=false;for(const k of matched){if((lc.get(k)||0)>1)lm=true;if((rc.get(k)||0)>1)rm=true}
  const ms=new Set(matched);
  return{
    leftRows:left.rowCount,rightRows:right.rowCount,leftField:lf,rightField:rf,leftNull:la.length-lk.length,rightNull:ra.length-rk.length,
    leftNullRate:la.length?(la.length-lk.length)/la.length:null,rightNullRate:ra.length?(ra.length-rk.length)/ra.length:null,
    leftUnique:ls.size,rightUnique:rs.size,leftDuplicateRecords:lk.length-ls.size,rightDuplicateRecords:rk.length-rs.size,matchedUnique:matched.length,
    matchedLeft:lk.filter(x=>ms.has(x)).length,matchedRight:rk.filter(x=>ms.has(x)).length,
    leftUniqueMatchRate:ls.size?matched.length/ls.size:null,rightUniqueMatchRate:rs.size?matched.length/rs.size:null,
    leftRecordMatchRate:lk.length?lk.filter(x=>ms.has(x)).length/lk.length:null,rightRecordMatchRate:rk.length?rk.filter(x=>ms.has(x)).length/rk.length:null,
    cardinality:matched.length?(lm&&rm?"n:m":lm?"n:1":rm?"1:n":"1:1"):"no matches"
  };
}
const num=v=>{let s=norm(v).replace(/\s/g,"");if(!s)return NaN;if(/^-?\d{1,3}(?:\.\d{3})*,\d+$/.test(s))s=s.replace(/\./g,"").replace(",",".");else if(/^-?\d+,\d+$/.test(s))s=s.replace(",",".");return Number(s)};
const geoKey=v=>keyNorm(v);
function validateStatbel(left,right){
  const lp=[["statistical sector code","cd sector","cd_sector","sector code","statistische sector","sectorcode"]],rp=[["sector code","cd sector","cd_sector","statistical sector","statistische sector","sectorcode"]];
  const ls=bestSheet(left,lp),rs=bestSheet(right,rp);if(!ls||!rs)throw new Error("Could not identify usable sheets.");
  const lf=findColumn(ls,lp[0]),rf=findColumn(rs,rp[0]);if(!lf||!rf)throw new Error("Could not identify the statistical-sector code column in both files.");
  const data=joinMetrics(ls,rs,lf,rf);
  return{modelVersion:VALIDATION_MODEL_VERSION,specId:"statbel-sector-pop-geometry",kind:"join",observedAt:new Date().toISOString(),data,notes:["Files were parsed locally in this browser; nothing was uploaded.","Verify both files use the same 2025 REDEGEO breakdown before interpreting the match rate."]};
}
function validateOpgroeien(left,right){
  const geo=["gemeente","gemeentenaam","naam gemeente","geografie","geography","gebied"],places=["aantal plaatsen","aantal opvangplaatsen","opvangplaatsen","vergunde plaatsen","gesubsidieerde plaatsen","plaatsen met vergunning","capaciteit"],children=["kinderen 0-3","kinderen 0 tot 3","kinderen 0 tem 3","aantal kinderen","kinderen"],ratio=["plaatsen per 100 kinderen","opvangplaatsen per 100 kinderen","plaatsen/100 kinderen","per 100 kinderen","dekkingsgraad"];
  const ls=bestSheet(left,[geo,places]),rs=bestSheet(right,[geo,places,children,ratio]);if(!ls||!rs)throw new Error("Could not identify usable workbook sheets.");
  const lg=findColumn(ls,geo),lp=findColumn(ls,places),rg=findColumn(rs,geo),rp=findColumn(rs,places),rc=findColumn(rs,children),rr=findColumn(rs,ratio);
  if(!lg||!lp||!rg||!rp||!rc||!rr)throw new Error("Could not identify geography, places, children and ratio columns. Left columns: "+ls.columns.join(", ")+" · right columns: "+rs.columns.join(", "));
  const geography=joinMetrics(ls,rs,lg,rg);
  let ratioCompared=0,ratioOutliers=0,maxAbsoluteRatioDelta=0;
  for(const row of rs.rows){
    const p=num(row[rp]),kids=num(row[rc]),published=num(row[rr]);if(!Number.isFinite(p)||!Number.isFinite(kids)||kids<=0||!Number.isFinite(published))continue;
    const delta=Math.abs(100*p/kids-published);ratioCompared++;maxAbsoluteRatioDelta=Math.max(maxAbsoluteRatioDelta,delta);if(delta>0.15)ratioOutliers++;
  }
  let capacityCompared=0,capacityMismatches=0,maxCapacityDelta=0,capacityComparison;
  if(geography.leftDuplicateRecords===0){
    const lm=new Map,rm=new Map;
    for(const row of ls.rows){const g=geoKey(row[lg]),v=num(row[lp]);if(g&&Number.isFinite(v))lm.set(g,v)}
    for(const row of rs.rows){const g=geoKey(row[rg]),v=num(row[rp]);if(g&&Number.isFinite(v))rm.set(g,v)}
    for(const [g,v] of lm){if(!rm.has(g))continue;const delta=Math.abs(v-rm.get(g));capacityCompared++;maxCapacityDelta=Math.max(maxCapacityDelta,delta);if(delta>0.01)capacityMismatches++}
    capacityComparison="computed because the selected capacity sheet has one row per observed geography key";
  }else capacityComparison="skipped because the selected capacity sheet has multiple rows per geography; category aggregation requires an explicit semantic selection";
  return{modelVersion:VALIDATION_MODEL_VERSION,specId:"opgroeien-capacity-coverage",kind:"derivation",observedAt:new Date().toISOString(),data:{
    leftRows:ls.rowCount,rightRows:rs.rowCount,leftGeographyField:lg,placesField:lp,rightGeographyField:rg,rightPlacesField:rp,childrenField:rc,ratioField:rr,
    matchedGeographies:geography.matchedUnique,missingCapacityGeographies:Math.max(0,geography.rightUnique-geography.matchedUnique),
    leftDuplicateGeographyRows:geography.leftDuplicateRecords,ratioCompared,ratioOutliers,maxAbsoluteRatioDelta,ratioReconciliationRate:ratioCompared?1-ratioOutliers/ratioCompared:null,
    capacityCompared,capacityMismatches,maxCapacityDelta,capacityComparison
  },notes:[
    "Files were parsed locally in this browser; nothing was uploaded.",
    "The ratio check recomputes 100 × published places / published children from the coverage workbook itself.",
    capacityComparison,
    "Ratio tolerance is 0.15 percentage point to allow normal publication rounding."
  ]};
}
export async function validateLocalFiles(spec,leftFile,rightFile){
  if(!spec)throw new Error("No validation specification for this pair.");
  const [left,right]=await Promise.all([parseLocalFile(leftFile),parseLocalFile(rightFile)]);
  if(spec.id==="statbel-sector-pop-geometry")return validateStatbel(left,right);
  if(spec.id==="opgroeien-capacity-coverage")return validateOpgroeien(left,right);
  if(spec.id==="fluvius-sector-statbel-geometry"){
    const lp=[["statistische sector","statistical sector","statistische_sector","sector code","nis9"]],rp=[["sector code","cd sector","cd_sector","statistical sector","statistische sector"]];
    const ls=bestSheet(left,lp),rs=bestSheet(right,rp),lf=findColumn(ls,lp[0]),rf=findColumn(rs,rp[0]);if(!ls||!rs||!lf||!rf)throw new Error("Could not identify statistical-sector columns in both files.");
    const data=joinMetrics(ls,rs,lf,rf);return{modelVersion:VALIDATION_MODEL_VERSION,specId:spec.id,kind:"join",observedAt:new Date().toISOString(),data,notes:["Files were parsed locally in this browser; nothing was uploaded.","Cross-source sector codes still require an explicit geography-vintage check."]};
  }
  throw new Error("Local file validation is not configured for this relationship.");
}
