// Repairs for publisher values whose correct reading is unambiguous, shared by the dataset cards (scripts/dataset-card.mjs),
// get_dataset (mcp-server.mjs) and the SQL Lab (public/sql-lab-v1.mjs). Publishers will keep sending swapped axes, metres in a
// "latitude" column and -999 for "unknown"; the desk reads them the way they were meant, says what it changed, and never changes
// a value it cannot place: a coordinate that fits no reading stays as published and is counted as unusable.
//
// Coordinates, per row (a latitude column and a longitude column):
//   degrees      as published, inside Belgium
//   swapped      latitude and longitude exchanged
//   scaled       a decimal point lost (50864386 -> 50.864386, 51075 -> 51.075)
//   lambert72    Belgian Lambert 72 metres (EPSG:31370) in degree columns; converted to WGS84
//   web_mercator Web Mercator metres (EPSG:3857); converted
//   missing      empty or 0
//   outside      none of these lands in Belgium (a wrong value, or a place abroad): kept, not mapped by the desk
// Missing-value codes: -999, -9999, 99999... far outside the rest of a column are read as "no value".

export const BE={lat:[49.45,51.55],lon:[2.5,6.45]};
// Belgium's outline, simplified and drawn a little outside the border ([lon, lat], 66 points, a few km of margin): a reading that
// lands in northern France, Luxembourg or Zeelandic Flanders is not taken for a Belgian place. scripts/test-data-repair.mjs checks
// 44 Belgian border towns inside and 26 foreign towns near the border outside.
export const BE_OUTLINE=[[2.52,51.08],[2.53,51.12],[3.37,51.40],[3.53,51.31],[3.80,51.24],[4.00,51.24],[4.08,51.27],[4.20,51.33],[4.24,51.40],[4.42,51.49],[4.55,51.51],[4.68,51.45],[4.80,51.52],[4.98,51.50],[5.10,51.45],[5.24,51.33],[5.48,51.32],[5.58,51.30],[5.86,51.18],[5.85,51.06],[5.78,50.95],[5.70,50.87],[5.70,50.79],[5.93,50.79],[6.03,50.78],[6.13,50.73],[6.20,50.64],[6.17,50.56],[6.26,50.50],[6.42,50.34],[6.16,50.12],[6.02,50.15],[5.97,50.02],[5.86,50.03],[5.77,49.86],[5.76,49.79],[5.92,49.67],[5.82,49.545],[5.65,49.535],[5.47,49.49],[5.30,49.64],[5.10,49.74],[4.96,49.77],[4.86,49.78],[4.88,49.95],[4.89,50.14],[4.82,50.18],[4.78,50.15],[4.70,50.10],[4.48,49.94],[4.15,49.95],[4.13,50.12],[4.22,50.25],[4.12,50.29],[3.95,50.32],[3.70,50.33],[3.63,50.47],[3.30,50.51],[3.26,50.66],[3.22,50.715],[3.15,50.73],[3.10,50.77],[2.95,50.75],[2.86,50.69],[2.62,50.79],[2.60,50.86],[2.52,51.08]];
const EDGES=BE_OUTLINE.slice(1).map((p,i)=>[BE_OUTLINE[i][0],BE_OUTLINE[i][1],p[0],p[1]]);
export function inBelgium(la,lo){
  if(!(la>=BE.lat[0]&&la<=BE.lat[1]&&lo>=BE.lon[0]&&lo<=BE.lon[1]))return false;
  let c=false;for(const [x1,y1,x2,y2] of EDGES)if((y1>la)!==(y2>la)&&lo<(x2-x1)*(la-y1)/(y2-y1)+x1)c=!c;
  return c;
}
const inBE=inBelgium;
export const COORD_HOW=["degrees","swapped","scaled","lambert72","web_mercator","missing","outside"];

// ---------- Lambert 72 -> WGS84 ----------
// Inverse Lambert conformal conic (2SP) on the International 1924 ellipsoid, then the BD72 -> WGS84 datum shift as a constant
// offset. scripts/test-data-repair.mjs checks it against dov.mjs's full Helmert conversion: within 10 m anywhere in Belgium.
const RAD=Math.PI/180,LA=6378388,LF=1/297,LE=Math.sqrt(LF*(2-LF));
const P1=(51+10/60+0.00204/3600)*RAD,P2=(49+50/60+0.00204/3600)*RAD,L0=(4+22/60+2.952/3600)*RAD,FE=150000.013,FN=5400088.438;
const lm=p=>Math.cos(p)/Math.sqrt(1-LE*LE*Math.sin(p)**2),lt=p=>Math.tan(Math.PI/4-p/2)/((1-LE*Math.sin(p))/(1+LE*Math.sin(p)))**(LE/2);
export const LCC={n:(Math.log(lm(P1))-Math.log(lm(P2)))/(Math.log(lt(P1))-Math.log(lt(P2))),e:LE,a:LA,fe:FE,fn:FN,l0:L0};
LCC.f=lm(P1)/(LCC.n*lt(P1)**LCC.n);
// BD72 geodetic -> WGS84 offset in degrees, measured at the centre of Belgium (the rest varies by up to 6 m over the country)
export const DATUM_SHIFT={dlat:-0.0005449,dlon:0.0012656};
export function lambert72ToWgs84Approx(x,y){
  const dx=x-FE,dy=FN-y,r=Math.hypot(dx,dy),t=(r/(LA*LCC.f))**(1/LCC.n),lon=Math.atan2(dx,dy)/LCC.n+L0;
  let lat=Math.PI/2-2*Math.atan(t);
  for(let i=0;i<6;i++)lat=Math.PI/2-2*Math.atan(t*((1-LE*Math.sin(lat))/(1+LE*Math.sin(lat)))**(LE/2));
  return[lat/RAD+DATUM_SHIFT.dlat,lon/RAD+DATUM_SHIFT.dlon];
}
const R3857=6378137;
export function webMercatorToWgs84(x,y){return[Math.atan(Math.sinh(y/R3857))/RAD,x/R3857/RAD]}

const L72_RANGE=v=>v>=15000&&v<=300000;
const scaledInto=(v,[lo,hi])=>{const a=Math.abs(v);for(let k=1;k<=9;k++){const s=a/10**k;if(s>=lo&&s<=hi)return s;if(s<lo)break}return null};
// A coordinate as a number. Two or more dots (or commas) are digit groups a spreadsheet put in ("50.880.263" = 50880263, read on
// as a lost decimal point); one comma is a decimal comma.
const toNum=v=>{
  if(typeof v==="number")return v;
  const s=String(v??"").trim(),dots=s.split(".").length-1,commas=s.split(",").length-1;
  return Number(dots>1?s.replace(/\./g,""):commas>1?s.replace(/,/g,""):s.replace(",","."));
};
// empty, 0 or not a number (what TRY_CAST makes NULL in the SQL): no position given
const noValue=v=>v==null||String(v).trim()===""||!Number.isFinite(toNum(v))||toNum(v)===0;
/** Every reading of one row's pair that lands in Belgium, in order of preference: [{how, lat, lon}]. Empty: missing or outside. */
export function coordinateReadings(latV,lonV){
  const a=toNum(latV),b=toNum(lonV);
  if(!Number.isFinite(a)||!Number.isFinite(b)||a===0||b===0)return[];
  if(inBE(a,b))return[{how:"degrees",lat:a,lon:b}];
  if(inBE(b,a))return[{how:"swapped",lat:b,lon:a}];
  const out=[];
  const sa=a>=BE.lat[0]&&a<=BE.lat[1]?a:scaledInto(a,BE.lat),sb=b>=BE.lon[0]&&b<=BE.lon[1]?b:scaledInto(b,BE.lon);
  if(sa!=null&&sb!=null&&a>0&&b>0&&inBE(sa,sb))out.push({how:"scaled",lat:sa,lon:sb});
  if(L72_RANGE(a)&&L72_RANGE(b))for(const [x,y] of [[b,a],[a,b]]){const [la,lo]=lambert72ToWgs84Approx(x,y);if(inBE(la,lo)){out.push({how:"lambert72",lat:round(la),lon:round(lo)});break}}
  for(const [x,y] of [[b,a],[a,b]])if(x>200000&&x<800000&&y>6e6&&y<7e6){const [la,lo]=webMercatorToWgs84(x,y);if(inBE(la,lo)){out.push({how:"web_mercator",lat:round(la),lon:round(lo)});break}}
  return out;
}
/** One row's pair read the way it was meant: {how, lat, lon}. `prefer` (the reading the file's unambiguous rows use) settles a
 *  pair that fits two readings, e.g. 50644 / 41350 (degrees without their point, or Lambert metres). */
export function readCoordinate(latV,lonV,prefer=null){
  const blank=v=>v==null||String(v).trim()==="";
  if(noValue(latV)||noValue(lonV))return{how:"missing",lat:null,lon:null};
  const c=coordinateReadings(latV,lonV);
  if(!c.length)return{how:"outside",lat:null,lon:null};
  return(prefer&&c.find(x=>x.how===prefer))||c[0];
}
/** Tally of a column pair, built row by row: add(latV, lonV) then result(). Ambiguous rows follow the reading most unambiguous rows use. */
export function coordinateTally(){
  const sure={},ambiguous=new Map;let rows=0;
  return{
    add(latV,lonV){
      rows++;const blank=v=>v==null||String(v).trim()==="";
      if(noValue(latV)||noValue(lonV)){sure.missing=(sure.missing||0)+1;return}
      const c=coordinateReadings(latV,lonV);
      if(!c.length)sure.outside=(sure.outside||0)+1;
      else if(c.length===1)sure[c[0].how]=(sure[c[0].how]||0)+1;
      else{const k=c.map(x=>x.how).join("|");ambiguous.set(k,(ambiguous.get(k)||0)+1)}
    },
    result(){
      const how={...sure};
      const ranked=["scaled","lambert72","web_mercator"].sort((x,y)=>(sure[y]||0)-(sure[x]||0));
      for(const [k,n] of ambiguous){const opts=k.split("|");const pick=ranked.find(h=>opts.includes(h))||opts[0];how[pick]=(how[pick]||0)+n}
      const prefer=ranked.find(h=>how[h])||null;
      const repaired=(how.swapped||0)+(how.scaled||0)+(how.lambert72||0)+(how.web_mercator||0);
      return{rows,how,repaired,prefer};
    }
  };
}
const round=v=>Math.round(v*1e7)/1e7;

const LAT_NAME=/^(lat|latitude|breedtegraad|y_?wgs\w*|geo_?lat|wgs84_?lat\w*|lat_?wgs\w*)$/i,LON_NAME=/^(lon|lng|long|longitude|lengtegraad|x_?wgs\w*|geo_?lon|wgs84_?lon\w*|lon_?wgs\w*)$/i;
/** The latitude and longitude columns of a header, or null. */
export function coordinateColumns(names){
  const lat=names.findIndex(n=>LAT_NAME.test(String(n).trim())),lon=names.findIndex(n=>LON_NAME.test(String(n).trim()));
  return lat>=0&&lon>=0&&lat!==lon?{lat,lon,latName:names[lat],lonName:names[lon]}:null;
}

// ---------- missing-value codes ----------
export const MISSING_CODES=[-9999,-999,-99,99999,999999,9999999];
const CODE_SET=new Set(MISSING_CODES);
export const isCodeCandidate=v=>CODE_SET.has(v);
/** A candidate code counts as "no value" when the column's other values stay far from it (at most half its size); a column of
 *  codes or identifiers (id, code, nr) is left alone. */
export function isMissingCode(code,restMin,restMax,name=""){
  if(!CODE_SET.has(code)||/(^|_|\b)(id|code|nr|nummer|numero|num[eé]ro)(_|\b|$)/i.test(name))return false;
  if(restMin==null||restMax==null)return false;
  return Math.max(Math.abs(restMin),Math.abs(restMax))<=Math.abs(code)/2;
}

// ---------- SQL (DuckDB) ----------
const qid=s=>'"'+String(s).replace(/"/g,'""')+'"';
// a number column as DOUBLE; a text column ("3,72" in a comma-decimal file) with its decimal comma read as a point
const num=c=>"TRY_CAST(replace(CAST("+qid(c)+" AS VARCHAR),',','.') AS DOUBLE)";
// a coordinate column, read like toNum: digit groups dropped, a single decimal comma read as a point
const coordNum=c=>{const s="trim(CAST("+qid(c)+" AS VARCHAR))",count=ch=>"(length("+s+")-length(replace("+s+",'"+ch+"','')))";
  return"TRY_CAST(CASE WHEN "+count(".")+">1 THEN replace("+s+",'.','') WHEN "+count(",")+">1 THEN replace("+s+",',','') ELSE replace("+s+",',','.') END AS DOUBLE)"};
function lambertSql(x,y){
  const {n,e,a,f,fe,fn,l0}=LCC,dx="("+x+"-"+fe+")",dy="("+fn+"-"+y+")",t="pow(sqrt("+dx+"*"+dx+"+"+dy+"*"+dy+")/"+(a*f)+",1.0/"+n+")";
  // three fixed-point steps of the latitude iteration are enough for millimetres
  let lat="(pi()/2-2*atan("+t+"))";
  for(let i=0;i<3;i++)lat="(pi()/2-2*atan("+t+"*pow((1-"+e+"*sin("+lat+"))/(1+"+e+"*sin("+lat+")),"+e/2+")))";
  return{lat:"(degrees("+lat+")+("+DATUM_SHIFT.dlat+"))",lon:"(degrees(atan2("+dx+","+dy+")/"+n+"+"+l0+")+("+DATUM_SHIFT.dlon+"))"};
}
/** A SELECT over `relation` that applies a card's repairs: missing-value codes become NULL, and a coordinate pair gains
 *  lat_wgs84 / lon_wgs84 / coordinate_repair columns (the published columns stay as they are). Null when nothing needs repair. */
// Belgium test in SQL: the bounding box, then ray casting over the outline's edges, written out edge by edge (lambda syntax
// differs between DuckDB versions; plain CASE arithmetic runs on all of them).
const inBeSql=(la,lo)=>"("+la+" BETWEEN "+BE.lat[0]+" AND "+BE.lat[1]+" AND "+lo+" BETWEEN "+BE.lon[0]+" AND "+BE.lon[1]+" AND ("+
  EDGES.filter(([,y1,,y2])=>y1!==y2).map(([x1,y1,x2,y2])=>"(CASE WHEN ("+la+">"+y1+")<>("+la+">"+y2+") AND "+lo+"<"+((x2-x1)/(y2-y1))+"*("+la+"-"+y1+")+"+x1+" THEN 1 ELSE 0 END)").join("+")+")%2=1)";
/** A SELECT over `relation` that applies a card's repairs: missing-value codes become NULL, and a coordinate pair gains
 *  lat_wgs84 / lon_wgs84 / coordinate_repair columns (the published columns stay as they are). Null when nothing needs repair.
 *  Gives the same answer as readCoordinate(lat, lon, card.repairs.coordinates.prefer) for every row (checked with DuckDB). */
export function repairSelectSql(card,relation){
  const r=card?.repairs;if(!r)return null;
  const replace=[];
  for(const m of r.missing_codes||[])replace.push("CASE WHEN "+num(m.column)+" IN ("+m.codes.join(",")+") THEN NULL ELSE "+qid(m.column)+" END AS "+qid(m.column));
  const c=r.coordinates,hidden=[];let from=relation,extra=[];
  if(c&&c.repaired>0){
    // level 1: the two values as numbers; level 2: every candidate reading, computed once; level 3: the first that lands in Belgium
    from="(SELECT *, "+coordNum(c.lat_column)+" AS __a, "+coordNum(c.lon_column)+" AS __b FROM "+relation+")";
    const cand=[["deg","__a","__b","degrees"],["swp","__b","__a","swapped"]],alt=[];
    if(c.how?.scaled){
      const sc=(v,lo,hi)=>"CASE WHEN "+v+" BETWEEN "+lo+" AND "+hi+" THEN "+v+" WHEN "+v+">"+hi+" THEN "+v+"/pow(10,ceil(log10("+v+"/"+hi+"))) END";
      alt.push(["scl",sc("__a",BE.lat[0],BE.lat[1]),sc("__b",BE.lon[0],BE.lon[1]),"scaled"]);
    }
    if(c.how?.lambert72){const L1=lambertSql("__b","__a"),L2=lambertSql("__a","__b");alt.push(["l1",L1.lat,L1.lon,"lambert72"],["l2",L2.lat,L2.lon,"lambert72"])}
    if(c.how?.web_mercator)for(const [k,x,y] of [["m1","__b","__a"],["m2","__a","__b"]])alt.push([k,"degrees(atan(sinh("+y+"/"+R3857+")))","degrees("+x+"/"+R3857+")","web_mercator"]);
    // the reading the file's unambiguous rows use goes first, as in the card (coordinateTally)
    cand.push(...alt.filter(x=>x[3]===c.prefer),...alt.filter(x=>x[3]!==c.prefer));
    const computed=cand.filter(x=>x[0]!=="deg"&&x[0]!=="swp");
    if(computed.length){
      from="(SELECT *, "+computed.map(([k,la,lo])=>la+" AS __"+k+"_la, "+lo+" AS __"+k+"_lo").join(", ")+" FROM "+from+")";
      hidden.push(...computed.flatMap(([k])=>["__"+k+"_la","__"+k+"_lo"]));
    }
    const col=(k,la,lo,which)=>k==="deg"||k==="swp"?(which==="la"?la:lo):"__"+k+"_"+which;
    // level 4: the number of the first candidate inside Belgium (the outline test runs once per row and candidate)
    from="(SELECT *, CASE "+cand.map(([k,la,lo],i)=>"WHEN "+inBeSql(col(k,la,lo,"la"),col(k,la,lo,"lo"))+" THEN "+(i+1)).join(" ")+" ELSE 0 END AS __pick FROM "+from+")";
    const pick=w=>"CASE __pick "+cand.map(([k,la,lo,how],i)=>"WHEN "+(i+1)+" THEN "+(w==="how"?"'"+how+"'":col(k,la,lo,w))).join(" ")+
      " ELSE "+(w==="how"?"CASE WHEN __a IS NULL OR __b IS NULL OR __a=0 OR __b=0 THEN 'missing' ELSE 'outside' END":"NULL")+" END";
    extra=["round("+pick("la")+",7) AS lat_wgs84","round("+pick("lo")+",7) AS lon_wgs84",pick("how")+" AS coordinate_repair"];
    hidden.push("__a","__b","__pick");
  }
  if(!extra.length&&!replace.length)return null;
  return"SELECT * "+(hidden.length?"EXCLUDE ("+hidden.join(", ")+") ":"")+(replace.length?"REPLACE ("+replace.join(", ")+") ":"")+(extra.length?", "+extra.join(", ")+" ":"")+"FROM "+from;
}

/** Plain sentences for what was repaired, for cards, get_dataset and the SQL Lab. */
export function describeRepairs(r){
  const out=[];if(!r)return out;
  const c=r.coordinates;
  if(c){
    const p=n=>Math.round(n/c.rows*1000)/10,parts=[];
    const words={swapped:"latitude and longitude swapped back",scaled:"a lost decimal point restored",lambert72:"converted from Lambert 72 metres",web_mercator:"converted from Web Mercator metres"};
    for(const k of Object.keys(words))if(c.how?.[k])parts.push(p(c.how[k])+" % "+words[k]);
    const usable=(c.how?.degrees||0)+c.repaired;
    out.push("Coordinates ('"+c.lat_column+"', '"+c.lon_column+"'): "+p(usable)+" % of the "+c.rows.toLocaleString("en-GB")+" rows can be mapped"+
      (c.repaired?", "+p(c.how?.degrees||0)+" % as published and "+parts.join(", "):" as published")+
      ((c.how?.missing||0)+(c.how?.outside||0)?"; "+p((c.how.missing||0)+(c.how.outside||0))+" % have no usable position"+(c.how?.outside?" ("+c.how.outside.toLocaleString("en-GB")+" outside Belgium in every reading, kept as published)":""):"")+".");
  }
  for(const m of r.missing_codes||[])out.push("'"+m.column+"' uses "+m.codes.join(" and ")+" for a missing value in "+m.rows.toLocaleString("en-GB")+" row"+(m.rows>1?"s":"")+"; the ranges shown leave "+(m.rows>1?"them":"it")+" out.");
  return out;
}
