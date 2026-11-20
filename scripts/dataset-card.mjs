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
import { createDelimitedAccumulator, detectDelimiter } from "./tabular-profile.mjs";
import { MERGERS_2025 } from "../public/nis-mergers-2025-v1.mjs";
import { coordinateColumns, coordinateTally, describeRepairs, isCodeCandidate, isMissingCode } from "../public/data-repair-v1.mjs";

export const CARD_VERSION="1";
const MAX_DISTINCT=2000,MAX_TOP=5,MAX_KEY_SAMPLE=400,MAX_COLUMNS=60,MAX_ROW_HASHES=2_000_000;

// ---------- values ----------
const clean=v=>String(v??"").trim();
// "3.775" or "98,125" (one separator, exactly three digits after it) is either a decimal or a thousands group. Alone it cannot
// be told apart: toNumber reads it as a thousands group unless ambiguous==="decimal"; the column profile decides per column from its
// other values (numberStyle) so a longitude column of 3.775 / 3.7751 reads 3.775, and a count column of 1.234 / 12.345.678 reads 1234.
const AMBIGUOUS=/^[+-]?\d{1,3}[.,]\d{3}$/;
/** What a numeric string says about its column's separators: "decimal" (3.7751, 98,5), "thousands" (1.234.567, 1,234.5, 1 234),
 *  "plain" (an integer without separators), "plain1000" (one of 1000 or more, so separators are not thousands groups),
 *  "ambiguous" (see AMBIGUOUS). */
export function numberStyle(s){
  if(/\d \d{3}(?!\d)/.test(s))return"thousands";
  const t=s.replace(/\s/g,"");
  if(AMBIGUOUS.test(t))return"ambiguous";
  if(/^[+-]?\d+$/.test(t))return Math.abs(Number(t))>=1000?"plain1000":"plain";
  if(/^[+-]?\d{1,3}(?:[.,]\d{3}){2,}$/.test(t)||/^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/.test(t)||/^[+-]?\d{1,3}(?:,\d{3})+\.\d+$/.test(t))return"thousands";
  return"decimal";
}
function toNumber(s,{ambiguous="thousands"}={}){
  if(ambiguous==="decimal"&&AMBIGUOUS.test(s.replace(/\s/g,"")))return Number(s.replace(/\s/g,"").replace(",","."));
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
// Hydrological/agricultural reporting years such as "2002-2003" are periods, not arbitrary text.
function toYearRange(s){
  const m=s.match(/^((?:18|19|20)\d{2})\s*[-/–]\s*((?:18|19|20)\d{2})$/);
  return m&&Number(m[2])===Number(m[1])+1?{from:m[1],to:m[2]}:null;
}

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
      if(cur+old>=0.9)return{kind:"nis_code",match_pct:pct(cur),...(old>0?{pre_2025_codes_pct:pct(old),pre_2025_codes:codes.filter(v=>MERGERS_2025[v]!==undefined).length}:{}),values_checked:codes.length};
    }
  }
  // numeric exports write postcodes as 9000.0
  const pcs=values.map(v=>v.replace(/\.0+$/,"")),pshare=f=>pcs.filter(f).length/pcs.length;
  if(/post|zip|code_?postal|cp$|^pc$/.test(n)&&pshare(v=>/^\d{4}$/.test(v)&&+v>=1000&&+v<=9999)>=0.9)return{kind:"postcode",match_pct:pct(pshare(v=>/^\d{4}$/.test(v)))};
  if(share(v=>validEnterpriseNumber(v))>=0.9)return{kind:"enterprise_number",match_pct:pct(share(validEnterpriseNumber))};
  // "lat, lon" in one column (OpenDataSoft geo_point_2d and similar exports)
  const point=v=>{const m=v.match(/^\[?\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]?$/);return m&&+m[1]>49.4&&+m[1]<51.6&&+m[2]>2.4&&+m[2]<6.5};
  if(share(point)>=0.9)return{kind:"wgs84_point"};
  const nums=values.map(v=>toNumber(v)),degrees=values.map(v=>toNumber(v,{ambiguous:"decimal"}));
  if(/^(lat|latitude|breedte|breedtegraad|y_?wgs)/.test(n)&&degrees.every(x=>x!=null&&x>49.4&&x<51.6))return{kind:"latitude"};
  if(/^(lon|lng|long|longitude|lengte|lengtegraad|x_?wgs)/.test(n)&&degrees.every(x=>x!=null&&x>2.4&&x<6.5))return{kind:"longitude"};
  if(/lambert|l72|31370|^x$|^y$|^x_|^y_|_x$|_y$/.test(n)&&nums.every(x=>x!=null&&x>10000&&x<310000))return{kind:"lambert72"};
  return null;
}
const pct=x=>Math.round(x*1000)/10;

/** Values a column's own range shows to be wrong or coded, from min/max only (no row is named; the file is the evidence):
 *  coordinates_outside_belgium  a latitude/longitude column that leaves Belgium (wrong rows, swapped axes, or a wider coverage)
 *  not_degrees                  a latitude/longitude column holding metres (Lambert) or degrees without their decimal point
 *  missing_value_code           -999, -9999 or 99999-style codes that would distort a sum or an average */
const LAT_NAME=/^(lat|latitude|breedtegraad|y_?wgs\w*|geo_?lat)$/i,LON_NAME=/^(lon|lng|long|longitude|lengtegraad|x_?wgs\w*|geo_?lon)$/i;
export const DECIMAL_READING_SINCE="2026-11-18T07:15:00Z";
const CODES=new Set([-9999,-999,-99,99999,999999,9999999]);
export function suspectValues(cols){
  const out=[];
  for(const c of cols){
    if((c.type!=="number"&&c.type!=="integer")||c.min==null)continue;
    const lat=LAT_NAME.test(c.name),lon=!lat&&LON_NAME.test(c.name);
    if(lat||lon){
      const [lo,hi]=lat?[49.4,51.6]:[2.4,6.5],deg=lat?90:180;
      if(Math.abs(c.min)>deg||Math.abs(c.max)>deg)out.push({column:c.name,kind:"not_degrees",min:c.min,max:c.max,
        text:"Column '"+c.name+"' reaches "+num(Math.abs(c.max)>deg?c.max:c.min)+", which is not a "+(lat?"latitude":"longitude")+" in degrees: some rows hold metres or lost their decimal point."});
      else if(c.min<lo||c.max>hi)out.push({column:c.name,kind:"coordinates_outside_belgium",min:c.min,max:c.max,
        text:"Column '"+c.name+"' ranges from "+num(c.min)+" to "+num(c.max)+", beyond Belgium's "+lo+"–"+hi+": some coordinates are wrong or swapped, or the file covers more than Belgium."});
    }
    for(const v of [c.min,c.max])if(CODES.has(v)&&c.min!==c.max){
      out.push({column:c.name,kind:"missing_value_code",value:v,min:c.min,max:c.max,
        text:"Column '"+c.name+"' contains "+num(v)+", probably a code for a missing value: leave those rows out before summing or averaging."});
      break;
    }
  }
  return out;
}

// ---------- column profile ----------
export function profileColumns(text,{url="",format="",bytesRead=null,totalBytes=null}={}){
  const delimiter=detectDelimiter(text,{url,format});
  // a bounded read usually ends mid-row: drop the partial last line unless the whole file was read
  const whole=totalBytes!=null&&bytesRead!=null&&bytesRead>=totalBytes;
  const body=whole?text:text.slice(0,Math.max(text.lastIndexOf("\n"),0));
  const p=createColumnProfiler(delimiter);p.push(body);return p.finish({exact:whole});
}

/** Streaming column profile for a whole file (scripts/full-check.mjs): push(text) with consecutive decoded pieces, then
 *  finish({exact:true}). Same output as profileColumns, plus duplicate_rows (rows identical to an earlier row). */
export function createColumnProfiler(delimiter){
  const cols=[],seen=new Set(),grain=createGrainTracker();let duplicates=0,dupCapped=false,sumHi=0,sumLo=0,hdr="",coord=null;
  // Keep the schema of a header-only file: a zero-row export can be a serious
  // regression, but an unchanged header must not be misreported as columns removed.
  const initHeaders=headers=>{
    if(cols.length||!headers?.length)return;
    headers.slice(0,MAX_COLUMNS).forEach(h=>cols.push({name:h,filled:0,distinct:new Map(),capped:false,min:null,max:null,dmin:null,dmax:null,observedMin:null,observedMax:null,pmin:null,pmax:null,periods:0,nums:0,ints:0,dates:0,keySample:[],style:{decimal:0,thousands:0,plain:0,plain1000:0,ambiguous:0,zeros:0},amb:{dmin:null,dmax:null,tmin:null,tmax:null}}));hdr=headers.join("\u0001");
    const cc=coordinateColumns(headers);if(cc)coord={...cc,tally:coordinateTally()};
  };
  const a=createDelimitedAccumulator(delimiter,{sampleRows:0,inferRows:250,onRow(values,headers){
    initHeaders(headers);
    grain.row(values);
    if(coord)coord.tally.add(values[coord.lat],values[coord.lon]);
    // a 53-bit hash per row. Duplicate rows: a Set of these (numbers stay small); past MAX_ROW_HASHES the count stops growing and
    // is reported as a lower bound. False matches are ~1 in 10^4 files at a million rows.
    const b=createHash("sha1").update(values.join("\u0001")).digest(),h=b.readUInt32BE(0)*2**21+(b.readUInt32BE(4)>>>11);
    // row-set fingerprint: the sum of row hashes does not depend on row order, so an export that returns the same rows in another
    // order keeps its fingerprint while its bytes (sha256) change. Two sums of 26/27-bit halves stay exact past a billion rows.
    sumLo+=h%2**26;sumHi+=Math.floor(h/2**26);
    if(!dupCapped){if(seen.has(h))duplicates++;else{seen.add(h);if(seen.size>=MAX_ROW_HASHES)dupCapped=true}}
    const cells=values.slice(0,cols.length).map(clean);
    const filledCells=cells.reduce((n,v)=>n+(v?1:0),0);
    // A trailing date-only row is not evidence that a measured series covers that date.
    // A single-column date list is itself meaningful data, so retain its full range.
    const hasData=cols.length===1||filledCells>1;
    for(let i=0;i<cols.length;i++){
      const c=cols[i],v=cells[i];if(!v)continue;
      c.filled++;
      if(!c.capped){c.distinct.set(v,(c.distinct.get(v)||0)+1);if(c.distinct.size>MAX_DISTINCT)c.capped=true}
      else if(c.distinct.has(v))c.distinct.set(v,c.distinct.get(v)+1);
      if(c.keySample.length<MAX_KEY_SAMPLE)c.keySample.push(v);
      const d=toDate(v),period=d?null:toYearRange(v),n=(d||period)?null:toNumber(v);
      if(d){
        c.dates++;if(!c.dmin||d<c.dmin)c.dmin=d;if(!c.dmax||d>c.dmax)c.dmax=d;
        if(hasData){if(!c.observedMin||d<c.observedMin)c.observedMin=d;if(!c.observedMax||d>c.observedMax)c.observedMax=d}
      }else if(period){
        c.periods++;
        if(!c.pmin||period.from<c.pmin)c.pmin=period.from;
        if(!c.pmax||period.to>c.pmax)c.pmax=period.to;
      }else if(n!=null){
        c.nums++;const st=numberStyle(v);c.style[st]++;
        if(st==="ambiguous"){
          // keep both readings; summarise picks one for the whole column. "1.000" (three zeros) is a thousand: nobody writes
          // three decimals of zeros.
          if(/0{3}$/.test(v))c.style.zeros++;
          const dec=toNumber(v,{ambiguous:"decimal"}),A=c.amb;
          if(A.dmin==null||dec<A.dmin)A.dmin=dec;if(A.dmax==null||dec>A.dmax)A.dmax=dec;
          if(A.tmin==null||n<A.tmin)A.tmin=n;if(A.tmax==null||n>A.tmax)A.tmax=n;
        }else if(isCodeCandidate(n)){(c.codes??={})[n]=(c.codes[n]||0)+1;if(Number.isInteger(n))c.ints++}   // judged in summarise
        else{if(Number.isInteger(n))c.ints++;if(c.min==null||n<c.min)c.min=n;if(c.max==null||n>c.max)c.max=n}
      }
    }
  }});
  const self={push:t=>a.push(t),rowHashes:null,finish({exact=true,keepRowHashes=false}={}){
    const parsed=a.finish();
    initHeaders(parsed.headers);
    // the distinct row hashes, sorted, for a row-level diff with the next run (scripts/full-check.mjs); none past the cap
    if(keepRowHashes&&exact&&!dupCapped)self.rowHashes=Float64Array.from(seen).sort();
    seen.clear();
    const rowSet=exact?createHash("sha1").update(hdr+"\u0002"+sumHi+"."+sumLo+"."+parsed.rowCount).digest("hex").slice(0,20):null;
    const out=summarise(cols,parsed,exact,coord?{coordinates:{lat_column:coord.latName,lon_column:coord.lonName,...coord.tally.result()}}:null,exact?{duplicate_rows:duplicates,...(dupCapped?{duplicate_rows_lower_bound:true}:{}),row_set:rowSet}:{},delimiter);
    const g=grain.finish(out.columns);if(g)out.grain=g;
    return out;
  }};
  return self;
}

/* ---------- row grain: which label columns together identify a row ----------
 * The catalogue's "one row = postal code × year × month" is a guess from titles and column names. This tests it on the file:
 * every value of a label column (codes, dates, names, years; not measured numbers) gets a small integer code while streaming,
 * then label columns are added greedily, each time the one that separates the most rows, until every row is unique or no
 * column helps. Counting is exact: a group id times the column's code count stays below 2^53. */
const MAX_GRAIN_ROWS=500_000,MAX_GRAIN_CODES=50_000,MAX_GRAIN_COLUMNS=24,MAX_GRAIN_KEY=12,GRAIN_CHUNK=65536;
const LABEL_INT=/code|_id\b|\bid\b|nr\b|nummer|numero|num[eé]ro|jaar|year|ann[eé]e|maand|month|mois|kwartaal|quarter|trimestre|week|semaine|postcode|post_code|code_postal|nis|refnis|ins\b|kbo|bce|ondernemings|sector|niveau|level|klasse|class/i;
export function createGrainTracker(){
  let n=0,width=-1;const cols=[];
  const push=(c,v)=>{const ci=n>>16;if(!c.chunks[ci])c.chunks[ci]=new Int32Array(GRAIN_CHUNK);c.chunks[ci][n&(GRAIN_CHUNK-1)]=v};
  return{
    row(values){
      if(width<0){width=Math.min(values.length,MAX_GRAIN_COLUMNS);for(let i=0;i<width;i++)cols.push({codes:new Map(),chunks:[],out:false})}
      if(n>=MAX_GRAIN_ROWS){n++;return}
      for(let i=0;i<width;i++){
        const c=cols[i];if(c.out)continue;
        const v=String(values[i]??"").trim();let code=c.codes.get(v);
        if(code===undefined){if(c.codes.size>=MAX_GRAIN_CODES){c.out=true;c.chunks=null;c.codes=null;continue}code=c.codes.size;c.codes.set(v,code)}
        push(c,code);
      }
      n++;
    },
    finish(columns){
      const tested=Math.min(n,MAX_GRAIN_ROWS);if(tested<2)return null;
      const cand=[];
      for(let i=0;i<cols.length;i++){
        const c=cols[i],meta=columns[i];if(c.out||!meta||meta.distinct===1)continue;
        if(meta.type==="number")continue;   // a measured value, not a label
        if(meta.type==="integer"&&!meta.key&&!LABEL_INT.test(meta.name))continue;
        cand.push({i,name:meta.name,size:c.codes.size,get:r=>c.chunks[r>>16][r&(GRAIN_CHUNK-1)]});
      }
      if(!cand.length)return null;
      let gid=new Int32Array(tested),groups=1;const chosen=[];
      while(chosen.length<MAX_GRAIN_KEY&&groups<tested){
        let best=null,bestGroups=groups;
        for(const c of cand){
          if(chosen.includes(c))continue;
          const s=new Set();for(let r=0;r<tested;r++)s.add(gid[r]*c.size+c.get(r));
          if(s.size>bestGroups){bestGroups=s.size;best=c}
        }
        if(!best)break;
        const m=new Map(),next=new Int32Array(tested);
        for(let r=0;r<tested;r++){const k=gid[r]*best.size+best.get(r);let g=m.get(k);if(g===undefined){g=m.size;m.set(k,g)}next[r]=g}
        gid=next;groups=m.size;chosen.push(best);
      }
      for(const c of cols){c.chunks=null;c.codes=null}
      if(!chosen.length)return null;
      return{columns:chosen.map(c=>c.name),unique:groups===tested,keys:groups,rows_tested:tested,...(groups<tested&&chosen.length>=MAX_GRAIN_KEY?{capped:true}:{}),...(n>tested?{rows_total:n}:{})};
    }
  };
}
/** How a column's ambiguous numbers (AMBIGUOUS) read: as decimals when the column writes other decimals or integers of 1000 and
 *  more without grouping; as thousands groups when it groups other numbers, holds only plain integers besides them, or writes
 *  "1.000" (zeros). With no other evidence they read as decimals (3.775 is more often a measurement than 3775 with a dot). */
export function ambiguousReading(style){
  const dec=style.decimal+style.plain1000,thou=style.thousands+(style.zeros||0)+(style.decimal?0:style.plain);
  return thou>dec?"thousands":"decimal";
}
function resolveAmbiguous(c){
  if(!c.style?.ambiguous)return;
  const reading=ambiguousReading(c.style),A=c.amb;
  const lo=reading==="decimal"?A.dmin:A.tmin,hi=reading==="decimal"?A.dmax:A.tmax;
  if(c.min==null||lo<c.min)c.min=lo;if(c.max==null||hi>c.max)c.max=hi;
  if(reading==="thousands")c.ints+=c.style.ambiguous;
  c.numberReading=reading;
}
function summarise(cols,parsed,whole,repairsIn,extra,delimiter){
  const rows=parsed.rowCount;
  for(const c of cols)resolveAmbiguous(c);
  // -999 / 99999-style values: "no value" when the rest of the column stays far from them, else ordinary values again
  const missing=[];
  for(const c of cols){
    if(!c.codes)continue;
    const found=[];let n=0;
    for(const [k,cnt] of Object.entries(c.codes)){
      const v=Number(k);
      if(isMissingCode(v,c.min,c.max,c.name)){found.push(v);n+=cnt}
      else{if(c.min==null||v<c.min)c.min=v;if(c.max==null||v>c.max)c.max=v}
    }
    if(found.length)missing.push({column:c.name,codes:found.sort((a,b)=>a-b),rows:n});
  }
  const repairs={...(repairsIn?.coordinates&&repairsIn.coordinates.rows?{coordinates:repairsIn.coordinates}:{}),...(missing.length?{missing_codes:missing}:{})};
  const columns=cols.map((c,i)=>{
    const type=c.filled&&c.dates/c.filled>=0.9?"date":c.filled&&c.periods/c.filled>=0.9?"period":c.filled&&c.nums/c.filled>=0.9?(c.ints===c.nums?"integer":"number"):parsed.types[i]==="boolean"?"boolean":"text";
    const out={name:c.name,type,filled_pct:rows?pct(c.filled/rows):0,distinct:c.capped?MAX_DISTINCT+"+":c.distinct.size};
    if(type==="date")Object.assign(out,{from:c.observedMin||c.dmin,to:c.observedMax||c.dmax});
    if(type==="period")Object.assign(out,{from:c.pmin,to:c.pmax});
    if(type==="integer"||type==="number"){Object.assign(out,{min:c.min,max:c.max});
      if(type==="integer"&&isYearColumn(c.name)&&c.min>=1800&&c.max<=2100)Object.assign(out,{type:"year",from:String(c.min),to:String(c.max)})}
    if(type==="text"&&!c.capped&&c.distinct.size<=50&&c.distinct.size>1&&c.distinct.size<=c.filled/2)out.top=[...c.distinct].sort((a,b)=>b[1]-a[1]).slice(0,MAX_TOP).map(([v,n])=>[v.slice(0,60),n]);
    const key=detectKey(c.name,c.keySample);if(key)out.key=key;
    return out;
  });
  const fingerprint=createHash("sha256").update(cols.map(c=>c.name.toLowerCase()).join("\u0001")).digest("hex").slice(0,12);
  return{rows,rows_exact:whole,delimiter,columns,column_count:parsed.headers.length,fingerprint,...(Object.keys(repairs).length?{repairs}:{}),...extra};
}

// ---------- freshness ----------
// EU frequency codes (data.gov.be uses these) -> days after which the data counts as overdue.
const CADENCE_DAYS={"1MIN":3,CONT:3,DAILY:4,WEEKLY:14,WEEKLY_2:21,BIWEEKLY:21,MONTHLY:45,QUARTERLY:120,ANNUAL_2:220,ANNUAL:400,BIENNIAL:800,TRIENNIAL:1200,QUINQUENNIAL:2000,DECENNIAL:3900};
const CADENCE_WORDS={"1MIN":"continuously",CONT:"continuously",DAILY:"daily",WEEKLY:"weekly",WEEKLY_2:"every two weeks",BIWEEKLY:"every two weeks",MONTHLY:"monthly",QUARTERLY:"quarterly",ANNUAL_2:"twice a year",ANNUAL:"yearly",BIENNIAL:"every two years",TRIENNIAL:"every three years",QUINQUENNIAL:"every five years",DECENNIAL:"every ten years"};
const day=s=>{const t=Date.parse(s);return Number.isFinite(t)?new Date(t).toISOString().slice(0,10):null};
const daysBetween=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000);
// "Declared cadence not met": a dataset declared to update more often than yearly whose latest data point lies more than three
// of those cycles back. It is a contradiction between the metadata and the data, not a verdict: either the series stopped or the
// declared frequency is wrong (often a portal default), and only the publisher knows which. One-off, yearly, irregular and
// undeclared datasets are never judged (publishing a year's figures many months later is normal). A year counts as its last day,
// a month as its last day.
const SUB_ANNUAL=new Set(["1MIN","CONT","DAILY","WEEKLY","WEEKLY_2","BIWEEKLY","MONTHLY","QUARTERLY"]);
// Dates of things in a register (when a sign was placed, a project started, a file was registered or last edited) say nothing
// about whether the register is kept up to date, so they never count. Found on the first full run, where
// road-asset inventories declared "daily" were flagged on their Begindatum / datum_plaatsing columns.
const NOT_A_FEED_DATE=/begin|start|d[eé]but|plaatsing|inschrijving|inscription|registr|toekenning|attrib|encodage|aanvraag|demande|ingang|geldig|valid|install|aanleg|oprichting/i;
export function cadenceNotMet(code,dataTo,now=new Date().toISOString(),column=""){
  if(!SUB_ANNUAL.has(code)||!dataTo||NOT_A_FEED_DATE.test(column||""))return{};
  const s=String(dataTo),yearOnly=/^\d{4}$/.test(s);
  const end=yearOnly?s+"-12-31":/^\d{4}-\d{2}$/.test(s)?new Date(Date.UTC(+s.slice(0,4),+s.slice(5,7),0)).toISOString().slice(0,10):s.slice(0,10);
  const behind=daysBetween(end,now.slice(0,10));
  if(!Number.isFinite(behind))return{};
  // a year column cannot show a gap of days: allow a whole year
  const limit=yearOnly?Math.max(365,3*CADENCE_DAYS[code]):3*CADENCE_DAYS[code];
  return{latest_data_age_days:behind,...(behind>limit?{cadence_not_met:true}:{})};
}
/** content (from scripts/full-check.mjs, optional): {since, changedAt, observedSince, lastModifiedUsable}. With it, the dates
 *  publishers state are checked against the bytes: a Last-Modified header caught misleading is ignored, and a catalogue update date
 *  after which the file stayed byte-for-byte the same no longer counts as a change. */
export function freshness(record,{fileLastModified=null,dataTo=null,dataColumn="",dataComplete=false,now=new Date().toISOString(),content=null}={}){
  const code=String(record.frequency||"").toUpperCase(),limit=CADENCE_DAYS[code];
  const updated=day(record.dataProcessedAt||record.updatedAt);
  const headerDate=day(fileLastModified),file=content&&content.lastModifiedUsable===false?null:headerDate;
  const out={declared:CADENCE_WORDS[code]||null,metadata_updated:updated,file_changed:file};
  if(headerDate&&!file)out.file_header_ignored=headerDate;
  if(dataComplete)Object.assign(out,cadenceNotMet(code,dataTo,now,dataColumn));   // a partial read sees only the first (often oldest) rows
  let metaCounts=!!updated;
  if(content?.since){
    const since=day(content.since),changed=day(content.changedAt);
    out.content_unchanged_since=since;out.observed_since=day(content.observedSince)||since;
    if(changed)out.content_change_seen=changed;
    // the catalogue says "updated" on a later day than the first run that saw today's bytes: the file did not change with it
    // (the update may have touched only the description)
    if(updated&&since<updated){out.metadata_date_not_reflected_in_file=true;metaCounts=false}
  }
  const candidates=[[metaCounts?updated:null,"catalogue date"],[file,"file date"],[out.content_change_seen,"content change seen"]].filter(c=>c[0]);
  const best=candidates.sort((a,b)=>a[0].localeCompare(b[0])).pop();
  out.last_change=best?.[0]||null;if(best)out.last_change_basis=best[1];
  if(!limit)return{...out,status:"unknown"};
  if(!out.last_change){
    // only "unchanged since we first saw it": the real change was on or before that day, so this can prove overdue, never current
    if(out.content_unchanged_since){const age=daysBetween(out.content_unchanged_since,now.slice(0,10));
      if(age>limit)return{...out,last_change:out.content_unchanged_since,last_change_basis:"unchanged since",age_days:age,status:"overdue",overdue_days:age-limit,at_least:true}}
    return{...out,status:"unknown"};
  }
  const age=daysBetween(out.last_change,now.slice(0,10));
  return{...out,age_days:age,status:age>limit?"overdue":"current",...(age>limit?{overdue_days:age-limit}:{})};
}

// Columns whose dates describe the record or a thing, not the period the data is about.
const NOT_PERIOD=/creat|cré|gemaakt|aangemaakt|update|bijgewerkt|mise.?[àa].?jour|changed|modif|timestamp|last_?seen|export|dob|naiss|geboort|birth|bouw|build|constr|anciennet|ordening|order|aanleg|oprich|fond[ée]|built|load|ingest|insert|apic/i;
const PERIOD=/periode|period|jaar|year|ann[ée]e|maand|month|mois|trimest|kwarta|quarter|peildatum|referen|ref_?|rapporter|reporting|date.?d.?(?:es|onn)|date_data|exercice|exercise|semaine|week/i;
const periodRank=name=>PERIOD.test(name)?0:1;
/** The period the data describes: never a record-keeping timestamp, a birth date or a construction year; reporting-period
 *  names first, then generic dates, best filled first. {from, to, column} or null. */
export function timeCoverage(profile){
  const cols=(profile?.columns||[]).filter(c=>c.from&&c.to&&!NOT_PERIOD.test(c.name)).sort((a,b)=>(periodRank(a.name)-periodRank(b.name))||(b.filled_pct-a.filled_pct)||String(a.from).localeCompare(String(b.from)));
  return cols[0]?{from:cols[0].from,to:cols[0].to,column:cols[0].name}:null;
}

// header issues found by scripts/full-check.mjs (headerCheck)
const HEADER_FACTS={
  last_modified_is_request_time:"The server's Last-Modified date is the time of each request, so it says nothing about when the data changed.",
  last_modified_in_future:"The server's Last-Modified date lies in the future.",
  last_modified_moved_content_same:"The server's Last-Modified date moved although the file's content stayed exactly the same.",
  content_changed_last_modified_same:"The file's content changed, but the server's Last-Modified date did not.",
  etag_moved_content_same:"The server's ETag changed although the file's content stayed exactly the same, so caches download it again for nothing.",
  content_changed_etag_same:"The file's content changed, but the server's ETag did not, so caches may keep serving the old file.",
};

/** One sentence for the last change the full-file check saw (scripts/row-diff.mjs describeChange). */
export function changeSentence(c){
  const parts=[];
  if(c.rows?.before!=null&&c.rows?.after!=null)parts.push(c.rows.before===c.rows.after?"still "+fmtInt(c.rows.after)+" rows":"rows went from "+fmtInt(c.rows.before)+" to "+fmtInt(c.rows.after));
  if(c.distinct_rows_added!=null)parts.push(fmtInt(c.distinct_rows_added)+" distinct row"+(c.distinct_rows_added===1?"":"s")+" added and "+fmtInt(c.distinct_rows_removed)+" removed");
  if(c.columns_added?.length)parts.push("column"+(c.columns_added.length>1?"s ":" ")+c.columns_added.slice(0,3).map(x=>"'"+x+"'").join(", ")+" added");
  if(c.columns_removed?.length)parts.push("column"+(c.columns_removed.length>1?"s ":" ")+c.columns_removed.slice(0,3).map(x=>"'"+x+"'").join(", ")+" removed");
  for(const v of (c.coverage||[]).slice(0,2))parts.push("'"+v.column+"' now runs from "+v.after[0]+" to "+v.after[1]+" (was "+v.before[0]+" to "+v.before[1]+")");
  for(const v of (c.ranges||[]).slice(0,2))parts.push("'"+v.column+"' now ranges from "+num(v.after[0])+" to "+num(v.after[1])+" (was "+num(v.before[0])+" to "+num(v.before[1])+")");
  return"Between the checks of "+day(c.since)+" and "+day(c.seen_at)+" the file changed: "+(parts.join("; ")||"its values differ")+".";
}

// ---------- the card ----------
const fmtInt=n=>Number(n).toLocaleString("en-GB");
const num=n=>Number.isInteger(n)?fmtInt(n):Number(n).toLocaleString("en-GB",{maximumFractionDigits:2});
export function buildCard(record,profile,{previous=null,now=new Date().toISOString(),file={}}={}){
  const facts=[],add=(text,evidence)=>facts.push({text,evidence});
  const cols=profile?.columns||[];
  // time coverage: the period the data describes, so never a record-keeping timestamp, a birth date or a construction year;
  // reporting-period names first, then generic dates, best filled first
  const time=timeCoverage(profile);
  const fresh=freshness(record,{fileLastModified:file.lastModified,dataTo:time?.to,dataColumn:time?.column||"",dataComplete:!!profile.rows_exact,now,content:file.content||null});
  const keys=cols.filter(c=>c.key).map(c=>({column:c.name,...c.key}));
  const sparse=cols.filter(c=>c.filled_pct<50).map(c=>({column:c.name,filled_pct:c.filled_pct}));
  const constant=cols.filter(c=>c.distinct===1&&c.filled_pct>=90).map(c=>c.name);
  const rowsWord=(profile.rows_exact?"":"at least ")+fmtInt(profile.rows)+" rows";

  add("The file has "+rowsWord+" and "+profile.column_count+" columns"+(profile.rows_exact?".":" in the part read ("+Math.round((file.bytesRead||0)/1024)+" KiB)."),
    {rows:profile.rows,rows_exact:profile.rows_exact,columns:profile.column_count});
  if(time)add((time.from===time.to?"The data is for "+time.from:"The data runs from "+time.from+" to "+time.to)+" (column '"+time.column+"')"+(profile.rows_exact?".":" in the rows read; later rows may extend it."),time);
  if(fresh.cadence_not_met)add("It is declared to be updated "+fresh.declared+", but its latest data is for "+time.to+" (column '"+time.column+"'), "+fmtInt(fresh.latest_data_age_days)+" days ago. Either the series stopped or the declared frequency is wrong.",
    {disagreement:"declared_cadence_not_met",declared:fresh.declared,latest_data_point:time.to,column:time.column,latest_data_age_days:fresh.latest_data_age_days});
  if(fresh.status==="overdue"&&fresh.at_least)add("It is declared to be updated "+fresh.declared+", but the file has been byte-for-byte the same since at least "+fresh.last_change+", "+fmtInt(fresh.overdue_days)+" days longer than that cadence allows.",
    {disagreement:"declared_cadence_overdue",declared:fresh.declared,unchanged_since:fresh.last_change,overdue_days:fresh.overdue_days,at_least:true});
  else if(fresh.status==="overdue")add("It is declared to be updated "+fresh.declared+", but last changed on "+fresh.last_change+", "+fmtInt(fresh.overdue_days)+" days later than that cadence allows.",
    {disagreement:"declared_cadence_overdue",declared:fresh.declared,last_change:fresh.last_change,overdue_days:fresh.overdue_days});
  else if(fresh.status==="current")add("It is declared to be updated "+fresh.declared+" and last changed on "+fresh.last_change+", within that cadence.",{declared:fresh.declared,last_change:fresh.last_change});
  // what the bytes say about the dates publishers state (whole-file checks only)
  if(fresh.metadata_date_not_reflected_in_file)add("The catalogue says it was updated on "+fresh.metadata_updated+", but the file is byte-for-byte the same as on "+fresh.content_unchanged_since+", before that date (the update may have touched only the description).",
    {disagreement:"catalogue_date_not_in_file",metadata_updated:fresh.metadata_updated,content_unchanged_since:fresh.content_unchanged_since});
  // Where the publisher's own metadata and the file disagree (whole-file reads only: a partial read can miss later rows).
  // We cannot correct the publisher; we can say plainly which statement the file supports.
  if(profile.rows_exact&&time){
    const yr=v=>{const m=String(v||"").match(/^(\d{4})/);return m?Number(m[1]):null},from=yr(time.from),to=yr(time.to);
    const upd=yr(record.updatedAt);
    if(upd&&to&&upd-to>=2&&fresh.status!=="current")add("The catalogue record was updated on "+String(record.updatedAt).slice(0,10)+", but the newest date in the file ('"+time.column+"') is "+time.to+". A recent catalogue date here does not mean recent data.",
      {disagreement:"catalogue_date_newer_than_data",catalogue_updated:String(record.updatedAt).slice(0,10),newest_data:time.to,column:time.column});
    const dp=record.declaredPeriod,ds=yr(dp?.s||dp?.start),de=yr(dp?.e||dp?.end)||(ds?new Date(now).getUTCFullYear():null);
    if(ds&&from&&to&&(to<ds-1||from>de+1))add("The record declares the period "+(dp.s||dp.start)+" to "+(dp.e||dp.end||"now")+", but the dates in the file ('"+time.column+"') run from "+time.from+" to "+time.to+".",
      {disagreement:"declared_period_not_in_file",declared:{from:dp.s||dp.start,to:dp.e||dp.end||null},file:{from:time.from,to:time.to},column:time.column});
    const ty=[...new Set((String(record.title||"").match(/\b(?:19|20)\d{2}\b/g)||[]).map(Number))];
    if(!ds&&ty.length===1&&from&&to&&(ty[0]<from-1||ty[0]>to+1))add("The title names "+ty[0]+", but the dates in the file ('"+time.column+"') run from "+time.from+" to "+time.to+".",
      {disagreement:"title_year_not_in_file",title_year:ty[0],file:{from:time.from,to:time.to},column:time.column});
  }
  if(fresh.content_change_seen&&file.content?.changedAfter&&!file.change)add("The file's content changed between "+day(file.content.changedAfter)+" and "+fresh.content_change_seen+".",{after:day(file.content.changedAfter),on_or_before:fresh.content_change_seen});
  if(file.change)add(changeSentence(file.change),file.change);
  if(file.content?.rowOrderUnstable)add("Downloading it twice gives the same rows in a different order, so its bytes change while its data does not; caches and simple diffs see a new file every time.",{row_order_unstable:true});
  for(const issue of file.headerCheck?.issues||[])add(HEADER_FACTS[issue],{issue,last_modified:file.lastModified||null,etag:file.etag||null});
  for(const k of keys){
    // with few values a percentage overstates the evidence: say "1 of 3 values" instead
    if(k.kind==="nis_code")add("Column '"+k.column+"' holds NIS municipality codes ("+(k.values_checked<30
        ?(k.values_checked-(k.pre_2025_codes||0))+" of "+k.values_checked+" values read match the 2025 list"+(k.pre_2025_codes?"; "+k.pre_2025_codes+" "+(k.pre_2025_codes>1?"are":"is a")+" pre-2025 code"+(k.pre_2025_codes>1?"s":"")+" of merged municipalities":"")
        :k.match_pct+" % match the 2025 list"+(k.pre_2025_codes_pct?"; "+k.pre_2025_codes_pct+" % are pre-2025 codes of merged municipalities":""))+"), so it joins with Statbel figures.",k);
    else if(k.kind==="enterprise_number")add("Column '"+k.column+"' holds valid enterprise numbers (KBO/BCE check digits pass for "+k.match_pct+" %), so it joins with the enterprise register.",k);
    else if(k.kind==="postcode")add("Column '"+k.column+"' holds Belgian postcodes.",k);
  }
  if(keys.some(k=>k.kind==="wgs84_point"))add("Column '"+keys.find(k=>k.kind==="wgs84_point").column+"' holds WGS84 points inside Belgium, so it can be mapped directly.",keys.find(k=>k.kind==="wgs84_point"));
  else if(keys.some(k=>k.kind==="latitude")&&keys.some(k=>k.kind==="longitude"))add("Every row has WGS84 coordinates inside Belgium, so it can be mapped directly.",{columns:keys.filter(k=>/itude/.test(k.kind)).map(k=>k.column)});
  else if(keys.filter(k=>k.kind==="lambert72").length>=2)add("Rows carry Belgian Lambert 72 coordinates, so it can be mapped.",{columns:keys.filter(k=>k.kind==="lambert72").map(k=>k.column)});
  const ofRows=profile.rows_exact?"rows":"rows read";   // a whole-file profile speaks about the file, a partial one about the part read
  for(const s of sparse.slice(0,3))add("Column '"+s.column+"' is empty in "+num(Math.round((100-s.filled_pct)*10)/10)+" % of the "+ofRows+".",s);
  const cats=cols.filter(c=>c.top&&c.top.length>1&&c.filled_pct>=90).slice(0,2);
  for(const c of cats){const [v,n]=c.top[0];add("The most common value of '"+c.name+"' is '"+v+"' ("+fmtInt(n)+" of "+fmtInt(profile.rows)+" "+ofRows+").",{column:c.name,value:v,count:n,rows:profile.rows})}
  const measures=cols.filter(c=>(c.type==="number"||c.type==="integer")&&!c.key&&c.min!=null&&c.min!==c.max&&c.filled_pct>=90).slice(0,2);
  for(const c of measures)add("'"+c.name+"' ranges from "+num(c.min)+" to "+num(c.max)+" in the "+ofRows+".",{column:c.name,min:c.min,max:c.max});
  if(profile.duplicate_rows>0)add((profile.duplicate_rows_lower_bound?"At least ":"")+fmtInt(profile.duplicate_rows)+" of the "+fmtInt(profile.rows)+" rows ("+num(Math.round(profile.duplicate_rows/profile.rows*1000)/10)+" %) repeat an earlier row exactly.",
    {duplicate_rows:profile.duplicate_rows,rows:profile.rows,...(profile.duplicate_rows_lower_bound?{lower_bound:true}:{})});
  const g=profile.grain;
  // a handful of rows says nothing about what a row stands for
  if(g&&g.rows_tested>=10){
    const list=g.columns.map(c=>"'"+c+"'"),names=list.length>1?list.slice(0,-1).join(", ")+" and "+list.at(-1):list[0];
    const scope=!profile.rows_exact?"the "+fmtInt(g.rows_tested)+" rows read":g.rows_total?"the first "+fmtInt(g.rows_tested)+" of "+fmtInt(g.rows_total)+" rows":"all "+fmtInt(g.rows_tested)+" rows";
    const repeats=g.rows_tested-g.keys,onlyDuplicates=!g.unique&&profile.duplicate_rows>0&&repeats<=profile.duplicate_rows;
    if(g.unique)add("Each row is one combination of "+names+" (tested on "+scope+").",g);
    else if(onlyDuplicates)add("Apart from the repeated rows, each row is one combination of "+names+" (tested on "+scope+").",g);
    else if(g.capped)add("The "+g.columns.length+" label columns that separate rows best ("+names+") still leave "+fmtInt(repeats)+(repeats===1?" row":" rows")+" repeating their labels; more columns were not tested (tested on "+scope+").",g);
    else add("No combination of its label columns identifies each row: by "+names+", "+fmtInt(repeats)+(repeats===1?" row still shares its":" rows still share their")+" labels with another row (tested on "+scope+").",g);
  }
  if(constant.length)add("Column"+(constant.length>1?"s ":" ")+constant.slice(0,3).map(c=>"'"+c+"'").join(", ")+" "+(constant.length>1?"have":"has")+" a single value "+(profile.rows_exact?"throughout.":"in all rows read."),{columns:constant});
  // Profiles made before the per-column decimal reading (#81) read 3.775 as 3775, which looks exactly like a lost decimal point:
  // "not in degrees" is only said of profiles made after it; the other flags do not depend on that reading.
  // A profile that read the coordinates row by row (profile.repairs) says exactly what was repaired; the min/max flags are only
  // the fallback for profiles made before that.
  const repairs=profile.repairs||null,rc=repairs?.coordinates;
  const suspect=suspectValues(cols).filter(s=>(s.kind!=="not_degrees"||now>=DECIMAL_READING_SINCE)&&!(rc&&s.kind!=="missing_value_code"));
  for(const s of suspect.slice(0,3))add(s.text,{column:s.column,suspect:s.kind,min:s.min,max:s.max});
  const notable=rc&&(rc.repaired>0||(rc.how?.outside||0)+(rc.how?.missing||0)>0);
  const repairFacts=describeRepairs({...(notable?{coordinates:rc}:{}),missing_codes:repairs?.missing_codes});
  for(const t of repairFacts)add(t,{repair:true});

  let schema={fingerprint:profile.fingerprint};
  if(previous?.schema?.fingerprint&&previous.schema.fingerprint!==profile.fingerprint){
    const before=new Set((previous.columns||[]).map(c=>c.name)),after=new Set(cols.map(c=>c.name));
    const added=[...after].filter(c=>!before.has(c)),removed=[...before].filter(c=>!after.has(c));
    schema={...schema,changed_since:previous.profiled_at,added,removed};
    add("The columns changed since "+previous.profiled_at+(added.length?": added "+added.slice(0,5).map(c=>"'"+c+"'").join(", "):"")+(removed.length?(added.length?";":":")+" removed "+removed.slice(0,5).map(c=>"'"+c+"'").join(", "):"")+".",{added,removed});
  }else if(previous?.schema)schema={...schema,stable_since:previous.schema.stable_since||previous.profiled_at};

  return{v:CARD_VERSION,id:record.id,...(record.title?{title:record.title,publisher:record.publisher||null,topic:record.topic||null}:{}),...(record.authoritative?{hand_reviewed:true}:{}),profiled_at:now.slice(0,10),
    file:{url:file.url||null,format:file.format||null,read:profile.rows_exact?"whole file":"first bytes",bytes_read:file.bytesRead??null,total_bytes:file.totalBytes??null,rows:profile.rows,rows_exact:profile.rows_exact,...(file.sha256?{sha256:file.sha256}:{}),...(file.headerCheck?{headers:file.headerCheck}:{})},
    ...(file.change?{last_change_seen:file.change}:{}),
    freshness:fresh,coverage:{time,keys,...(profile.grain?{grain:profile.grain}:{})},quality:{sparse_columns:sparse,constant_columns:constant,...(profile.duplicate_rows!=null?{duplicate_rows:profile.duplicate_rows}:{}),...(file.content?.rowOrderUnstable?{row_order_unstable:true}:{}),...(suspect.length?{suspect_values:suspect.map(({text,...s})=>s)}:{})},schema,
    // how the desk reads values the publisher wrote wrongly (public/data-repair-v1.mjs); the file itself is never changed
    ...(repairs&&(notable||repairs.missing_codes)?{repairs:{...(notable?{coordinates:rc}:{}),...(repairs.missing_codes?{missing_codes:repairs.missing_codes}:{}),summary:repairFacts}}:{}),
    columns:cols.map(({key,...c})=>c).slice(0,40),facts,
    // the publisher's statements the file contradicts, in one list (also among the facts)
    disagreements:facts.filter(f=>f.evidence?.disagreement).map(f=>({kind:f.evidence.disagreement,text:f.text}))};
}
