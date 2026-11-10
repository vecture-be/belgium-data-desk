// Dataset cards: what a dataset is, whether it can be trusted today and what it says, as facts computed by code from the
// catalogue record and a bounded read of the file. Nothing here is written by a language model; every fact carries the numbers it
// rests on, so an assistant or a social post can quote a card without inventing anything.
//
//   profileColumns(text, {url, format, bytesRead, totalBytes})  column statistics from the first bytes of a CSV/TSV
//   buildCard(record, profile, {previous, now})                 the card: freshness, coverage, join keys, quality, schema, facts
//
// Profiles come from scripts/probe-links.mjs (weekly, the same request as the link check); cards are built by
// scripts/build-cards.mjs into public/cards/<shard>.json and returned by the MCP get_dataset tool. Field reference:
// docs/reference/dataset-cards.md.
import { createHash } from "node:crypto";
import { detectDelimiter, parseDelimitedText } from "./tabular-profile.mjs";
import { MERGERS_2025 } from "../public/nis-mergers-2025-v1.mjs";

export const CARD_VERSION="1";
const MAX_DISTINCT=2000,MAX_TOP=5,MAX_KEY_SAMPLE=400,MAX_COLUMNS=60;

// ---------- values ----------
const clean=v=>String(v??"").trim();
function toNumber(s){
  if(!/^[+-]?(?:\d+|\d{1,3}(?:[ .]\d{3})+|\d{1,3}(?:,\d{3})+)?(?:[.,]\d+)?$/.test(s)||!/\d/.test(s))return null;
  let t=s.replace(/\s/g,"");
  if(/^[+-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(t))t=t.replace(/\./g,"").replace(",",".");   // 1.234,5
  else if(/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(t))t=t.replace(/,/g,"");                // 1,234.5
  else t=t.replace(",",".");
  const n=Number(t);return Number.isFinite(n)?n:null;
}
/** ISO date (YYYY-MM-DD) for the date forms Belgian files use: ISO, YYYY-MM, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY. */
function toDate(s){
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/);if(m)return valid(m[1],m[2],m[3]);
  m=s.match(/^(\d{4})-(\d{2})$/);if(m)return valid(m[1],m[2],"01");
  m=s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s[\d:]+)?$/);if(m)return valid(m[3],m[2].padStart(2,"0"),m[1].padStart(2,"0"));
  return null;
}
function valid(y,mo,d){const n=Number(y);if(n<1800||n>2100||+mo<1||+mo>12||+d<1||+d>31)return null;return y+"-"+mo+"-"+d}
const isYearColumn=name=>/^(jaar|year|annee|année|jahr|periode|period|yr|refyear|ref_year|cd_year)$|(^|_)(jaar|year|annee|année)($|_)/i.test(name);

// ---------- Belgian identifiers ----------
export function validEnterpriseNumber(s){
  const d=String(s).replace(/[.\s-]/g,"").replace(/^BE/i,"");
  if(!/^[01]?\d{9}$/.test(d))return false;
  const n=d.padStart(10,"0"),base=Number(n.slice(0,8)),check=Number(n.slice(8));
  return 97-(base%97)===check;
}
let NIS=null;
/** The 565 municipality codes of 1 January 2025 plus the provinces, regions and Belgium, from public/statbel/places-v1.json. */
export function setNisReference(places){
  const codes=new Set(Object.keys(places||{}));
  for(const p of Object.values(places||{})){if(p.arr)codes.add(p.arr);if(p.prov)codes.add(p.prov);if(p.region)codes.add(p.region)}
  codes.add("01000");NIS=codes;
}
function detectKey(name,values){
  if(!values.length)return null;
  const share=f=>values.filter(f).length/values.length,n=name.toLowerCase();
  if(NIS){
    // numeric exports drop the leading zero (02000 -> 2000) or add decimals (11001.0); pad only when the column says it is NIS
    const nisName=/nis|refnis|(^|_)ins($|_)|cd_munty|code_?ins|code_?commune|gemeentecode/.test(n);
    const codes=values.map(v=>{const t=v.replace(/\.0+$/,"");return nisName&&/^\d{4}$/.test(t)?t.padStart(5,"0"):t});
    if(codes.every(v=>/^\d{5}$/.test(v))){
      const shareOf=f=>codes.filter(f).length/codes.length;
      const cur=shareOf(v=>NIS.has(v)),old=shareOf(v=>MERGERS_2025[v]!==undefined);
      if(cur+old>=0.9)return{kind:"nis_code",match_pct:pct(cur),...(old>0?{pre_2025_codes_pct:pct(old)}:{})};
    }
  }
  if(/post|zip|code_?postal|cp$|^pc$/.test(n)&&share(v=>/^\d{4}$/.test(v)&&+v>=1000&&+v<=9999)>=0.9)return{kind:"postcode",match_pct:pct(share(v=>/^\d{4}$/.test(v)))};
  if(share(v=>validEnterpriseNumber(v))>=0.9)return{kind:"enterprise_number",match_pct:pct(share(validEnterpriseNumber))};
  // "lat, lon" in one column (OpenDataSoft geo_point_2d and similar exports)
  const point=v=>{const m=v.match(/^\[?\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]?$/);return m&&+m[1]>49.4&&+m[1]<51.6&&+m[2]>2.4&&+m[2]<6.5};
  if(share(point)>=0.9)return{kind:"wgs84_point"};
  const nums=values.map(toNumber);
  if(/^(lat|latitude|breedte|breedtegraad|y_?wgs)/.test(n)&&nums.every(x=>x!=null&&x>49.4&&x<51.6))return{kind:"latitude"};
  if(/^(lon|lng|long|longitude|lengte|lengtegraad|x_?wgs)/.test(n)&&nums.every(x=>x!=null&&x>2.4&&x<6.5))return{kind:"longitude"};
  if(/lambert|l72|31370|^x$|^y$|^x_|^y_|_x$|_y$/.test(n)&&nums.every(x=>x!=null&&x>10000&&x<310000))return{kind:"lambert72"};
  return null;
}
const pct=x=>Math.round(x*1000)/10;

// ---------- column profile ----------
export function profileColumns(text,{url="",format="",bytesRead=null,totalBytes=null}={}){
  const delimiter=detectDelimiter(text,{url,format});
  // a bounded read usually ends mid-row: drop the partial last line unless the whole file was read
  const whole=totalBytes!=null&&bytesRead!=null&&bytesRead>=totalBytes;
  const body=whole?text:text.slice(0,Math.max(text.lastIndexOf("\n"),0));
  const cols=[];
  const parsed=parseDelimitedText(body,{delimiter,sampleRows:0,inferRows:250,onRow(values,headers){
    if(!cols.length)headers.slice(0,MAX_COLUMNS).forEach(h=>cols.push({name:h,filled:0,distinct:new Map(),capped:false,min:null,max:null,dmin:null,dmax:null,nums:0,ints:0,dates:0,keySample:[]}));
    for(let i=0;i<cols.length;i++){
      const c=cols[i],v=clean(values[i]);if(!v)continue;
      c.filled++;
      if(!c.capped){c.distinct.set(v,(c.distinct.get(v)||0)+1);if(c.distinct.size>MAX_DISTINCT)c.capped=true}
      else if(c.distinct.has(v))c.distinct.set(v,c.distinct.get(v)+1);
      if(c.keySample.length<MAX_KEY_SAMPLE)c.keySample.push(v);
      const d=toDate(v),n=d?null:toNumber(v);
      if(d){c.dates++;if(!c.dmin||d<c.dmin)c.dmin=d;if(!c.dmax||d>c.dmax)c.dmax=d}
      else if(n!=null){c.nums++;if(Number.isInteger(n))c.ints++;if(c.min==null||n<c.min)c.min=n;if(c.max==null||n>c.max)c.max=n}
    }
  }});
  const rows=parsed.rowCount;
  const columns=cols.map((c,i)=>{
    const type=c.filled&&c.dates/c.filled>=0.9?"date":c.filled&&c.nums/c.filled>=0.9?(c.ints===c.nums?"integer":"number"):parsed.types[i]==="boolean"?"boolean":"text";
    const out={name:c.name,type,filled_pct:rows?pct(c.filled/rows):0,distinct:c.capped?MAX_DISTINCT+"+":c.distinct.size};
    if(type==="date")Object.assign(out,{from:c.dmin,to:c.dmax});
    if(type==="integer"||type==="number"){Object.assign(out,{min:c.min,max:c.max});
      if(type==="integer"&&isYearColumn(c.name)&&c.min>=1800&&c.max<=2100)Object.assign(out,{type:"year",from:String(c.min),to:String(c.max)})}
    if(type==="text"&&!c.capped&&c.distinct.size<=50&&c.distinct.size>1&&c.distinct.size<=c.filled/2)out.top=[...c.distinct].sort((a,b)=>b[1]-a[1]).slice(0,MAX_TOP).map(([v,n])=>[v.slice(0,60),n]);
    const key=detectKey(c.name,c.keySample);if(key)out.key=key;
    return out;
  });
  const fingerprint=createHash("sha256").update(cols.map(c=>c.name.toLowerCase()).join("\u0001")).digest("hex").slice(0,12);
  return{rows,rows_exact:whole,delimiter,columns,column_count:parsed.headers.length,fingerprint};
}

// ---------- freshness ----------
// EU frequency codes (data.gov.be uses these) -> days after which the data counts as overdue.
const CADENCE_DAYS={"1MIN":3,CONT:3,DAILY:4,WEEKLY:14,WEEKLY_2:21,BIWEEKLY:21,MONTHLY:45,QUARTERLY:120,ANNUAL_2:220,ANNUAL:400,BIENNIAL:800,TRIENNIAL:1200,QUINQUENNIAL:2000,DECENNIAL:3900};
const CADENCE_WORDS={"1MIN":"continuously",CONT:"continuously",DAILY:"daily",WEEKLY:"weekly",WEEKLY_2:"every two weeks",BIWEEKLY:"every two weeks",MONTHLY:"monthly",QUARTERLY:"quarterly",ANNUAL_2:"twice a year",ANNUAL:"yearly",BIENNIAL:"every two years",TRIENNIAL:"every three years",QUINQUENNIAL:"every five years",DECENNIAL:"every ten years"};
const day=s=>{const t=Date.parse(s);return Number.isFinite(t)?new Date(t).toISOString().slice(0,10):null};
const daysBetween=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000);
export function freshness(record,{fileLastModified=null,dataTo=null,now=new Date().toISOString()}={}){
  const code=String(record.frequency||"").toUpperCase(),limit=CADENCE_DAYS[code];
  const updated=day(record.dataProcessedAt||record.updatedAt),file=day(fileLastModified);
  const last=[updated,file].filter(Boolean).sort().pop()||null;
  const out={declared:CADENCE_WORDS[code]||null,metadata_updated:updated,file_changed:file,last_change:last};
  if(dataTo)out.latest_data_point=dataTo;
  if(!limit||!last)return{...out,status:"unknown"};
  const age=daysBetween(last,now.slice(0,10));
  return{...out,age_days:age,status:age>limit?"overdue":"current",...(age>limit?{overdue_days:age-limit}:{})};
}

// Columns whose dates describe the record or a thing, not the period the data is about.
const NOT_PERIOD=/creat|cré|gemaakt|aangemaakt|update|bijgewerkt|mise.?[àa].?jour|changed|modif|timestamp|last_?seen|export|dob|naiss|geboort|birth|bouw|constr|ordening|order|aanleg|oprich|fond[ée]|built|load|ingest|insert|apic/i;
const PERIOD=/periode|period|jaar|year|ann[ée]e|maand|month|mois|trimest|kwarta|quarter|peildatum|referen|ref_?|rapporter|reporting|date.?d.?(?:es|onn)|date_data|exercice|exercise|semaine|week/i;
const periodRank=name=>PERIOD.test(name)?0:1;

// ---------- the card ----------
const fmtInt=n=>Number(n).toLocaleString("en-GB");
const num=n=>Number.isInteger(n)?fmtInt(n):Number(n).toLocaleString("en-GB",{maximumFractionDigits:2});
export function buildCard(record,profile,{previous=null,now=new Date().toISOString(),file={}}={}){
  const facts=[],add=(text,evidence)=>facts.push({text,evidence});
  const cols=profile?.columns||[];
  // time coverage: the period the data describes, so never a record-keeping timestamp, a birth date or a construction year;
  // reporting-period names first, then generic dates, best filled first
  const timeCols=cols.filter(c=>c.from&&c.to&&!NOT_PERIOD.test(c.name)).sort((a,b)=>(periodRank(a.name)-periodRank(b.name))||(b.filled_pct-a.filled_pct)||String(a.from).localeCompare(String(b.from)));
  const time=timeCols[0]?{from:timeCols[0].from,to:timeCols[0].to,column:timeCols[0].name}:null;
  const fresh=freshness(record,{fileLastModified:file.lastModified,dataTo:time?.to,now});
  const keys=cols.filter(c=>c.key).map(c=>({column:c.name,...c.key}));
  const sparse=cols.filter(c=>c.filled_pct<50).map(c=>({column:c.name,filled_pct:c.filled_pct}));
  const constant=cols.filter(c=>c.distinct===1&&c.filled_pct>=90).map(c=>c.name);
  const rowsWord=(profile.rows_exact?"":"at least ")+fmtInt(profile.rows)+" rows";

  add("The file has "+rowsWord+" and "+profile.column_count+" columns"+(profile.rows_exact?".":" in the part read ("+Math.round((file.bytesRead||0)/1024)+" KiB)."),
    {rows:profile.rows,rows_exact:profile.rows_exact,columns:profile.column_count});
  if(time)add((time.from===time.to?"The data is for "+time.from:"The data runs from "+time.from+" to "+time.to)+" (column '"+time.column+"')"+(profile.rows_exact?".":" in the rows read; later rows may extend it."),time);
  if(fresh.status==="overdue")add("It is declared to be updated "+fresh.declared+", but last changed on "+fresh.last_change+", "+fmtInt(fresh.overdue_days)+" days later than that cadence allows.",
    {declared:fresh.declared,last_change:fresh.last_change,overdue_days:fresh.overdue_days});
  else if(fresh.status==="current")add("It is declared to be updated "+fresh.declared+" and last changed on "+fresh.last_change+", within that cadence.",{declared:fresh.declared,last_change:fresh.last_change});
  for(const k of keys){
    if(k.kind==="nis_code")add("Column '"+k.column+"' holds NIS municipality codes ("+k.match_pct+" % match the 2025 list"+(k.pre_2025_codes_pct?"; "+k.pre_2025_codes_pct+" % are pre-2025 codes of merged municipalities":"")+"), so it joins with Statbel figures.",k);
    else if(k.kind==="enterprise_number")add("Column '"+k.column+"' holds valid enterprise numbers (KBO/BCE check digits pass for "+k.match_pct+" %), so it joins with the enterprise register.",k);
    else if(k.kind==="postcode")add("Column '"+k.column+"' holds Belgian postcodes.",k);
  }
  if(keys.some(k=>k.kind==="wgs84_point"))add("Column '"+keys.find(k=>k.kind==="wgs84_point").column+"' holds WGS84 points inside Belgium, so it can be mapped directly.",keys.find(k=>k.kind==="wgs84_point"));
  else if(keys.some(k=>k.kind==="latitude")&&keys.some(k=>k.kind==="longitude"))add("Every row has WGS84 coordinates inside Belgium, so it can be mapped directly.",{columns:keys.filter(k=>/itude/.test(k.kind)).map(k=>k.column)});
  else if(keys.filter(k=>k.kind==="lambert72").length>=2)add("Rows carry Belgian Lambert 72 coordinates, so it can be mapped.",{columns:keys.filter(k=>k.kind==="lambert72").map(k=>k.column)});
  for(const s of sparse.slice(0,3))add("Column '"+s.column+"' is empty in "+num(Math.round((100-s.filled_pct)*10)/10)+" % of the rows read.",s);
  const cats=cols.filter(c=>c.top&&c.top.length>1&&c.filled_pct>=90).slice(0,2);
  for(const c of cats){const [v,n]=c.top[0];add("The most common value of '"+c.name+"' is '"+v+"' ("+fmtInt(n)+" of "+fmtInt(profile.rows)+" rows read).",{column:c.name,value:v,count:n,rows:profile.rows})}
  const measures=cols.filter(c=>(c.type==="number"||c.type==="integer")&&!c.key&&c.min!=null&&c.min!==c.max&&c.filled_pct>=90).slice(0,2);
  for(const c of measures)add("'"+c.name+"' ranges from "+num(c.min)+" to "+num(c.max)+" in the rows read.",{column:c.name,min:c.min,max:c.max});
  if(constant.length)add("Column"+(constant.length>1?"s ":" ")+constant.slice(0,3).map(c=>"'"+c+"'").join(", ")+" "+(constant.length>1?"have":"has")+" a single value "+(profile.rows_exact?"throughout.":"in all rows read."),{columns:constant});

  let schema={fingerprint:profile.fingerprint};
  if(previous?.schema?.fingerprint&&previous.schema.fingerprint!==profile.fingerprint){
    const before=new Set((previous.columns||[]).map(c=>c.name)),after=new Set(cols.map(c=>c.name));
    const added=[...after].filter(c=>!before.has(c)),removed=[...before].filter(c=>!after.has(c));
    schema={...schema,changed_since:previous.profiled_at,added,removed};
    add("The columns changed since "+previous.profiled_at+(added.length?": added "+added.slice(0,5).map(c=>"'"+c+"'").join(", "):"")+(removed.length?(added.length?";":":")+" removed "+removed.slice(0,5).map(c=>"'"+c+"'").join(", "):"")+".",{added,removed});
  }else if(previous?.schema)schema={...schema,stable_since:previous.schema.stable_since||previous.profiled_at};

  return{v:CARD_VERSION,id:record.id,...(record.title?{title:record.title,publisher:record.publisher||null,topic:record.topic||null}:{}),...(record.authoritative?{hand_reviewed:true}:{}),profiled_at:now.slice(0,10),
    file:{url:file.url||null,format:file.format||null,bytes_read:file.bytesRead??null,total_bytes:file.totalBytes??null,rows:profile.rows,rows_exact:profile.rows_exact},
    freshness:fresh,coverage:{time,keys},quality:{sparse_columns:sparse,constant_columns:constant},schema,
    columns:cols.map(({key,...c})=>c).slice(0,40),facts};
}
