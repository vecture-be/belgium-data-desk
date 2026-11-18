// Offline tests for public/data-repair-v1.mjs: reading publisher values the way they were meant, and saying what was changed.
// The SQL (repairSelectSql) was checked against readCoordinate row by row in DuckDB 1.1, 1.4 and 2.0 (3,015 rows, no difference);
// here its shape is checked, since CI has no DuckDB.
import assert from "node:assert/strict";
import { lambert72ToWgs84 } from "../dov.mjs";
import { coordinateTally, describeRepairs, inBelgium, isMissingCode, lambert72ToWgs84Approx, readCoordinate, repairSelectSql, coordinateColumns } from "../public/data-repair-v1.mjs";

// Lambert 72 -> WGS84 with a constant datum shift stays within 10 m of the full Helmert conversion over the whole country
let worst=0;
for(let x=20000;x<=290000;x+=10000)for(let y=20000;y<=245000;y+=10000){
  const [a,b]=lambert72ToWgs84(x,y),[c,d]=lambert72ToWgs84Approx(x,y);
  worst=Math.max(worst,Math.hypot((a-c)*111320,(b-d)*111320*Math.cos(a*Math.PI/180)));
}
assert.ok(worst<10,"Lambert conversion within 10 m, worst "+worst.toFixed(1)+" m");

// the outline: Belgian border towns inside, foreign towns near the border outside
const IN={Ostend:[51.23,2.92],DePanne:[51.10,2.59],Knokke:[51.35,3.29],Essen:[51.47,4.47],BaarleHertog:[51.44,4.93],Hamont:[51.25,5.55],Maaseik:[51.10,5.79],Lanaken:[50.89,5.65],Voeren:[50.76,5.80],Kelmis:[50.72,6.01],Raeren:[50.67,6.12],StVith:[50.28,6.13],Gouvy:[50.19,5.94],Martelange:[49.83,5.74],Arlon:[49.68,5.81],Torgny:[49.51,5.47],Bouillon:[49.79,5.07],Vresse:[49.87,4.93],Hastiere:[50.22,4.83],Couvin:[50.05,4.49],Erquelinnes:[50.31,4.11],Quievrain:[50.40,3.68],Tournai:[50.61,3.39],Mouscron:[50.74,3.21],Comines:[50.77,3.00],Ploegsteert:[50.73,2.88],Poperinge:[50.85,2.73],Zandvliet:[51.36,4.31],Brussels:[50.85,4.35]};
const OUT={Lille:[50.63,3.06],Roubaix:[50.69,3.18],Armentieres:[50.685,2.88],Dunkirk:[51.03,2.38],Terneuzen:[51.33,3.83],Hulst:[51.28,4.05],BergenOpZoom:[51.49,4.29],Breda:[51.59,4.78],Eindhoven:[51.44,5.48],Roermond:[51.19,5.99],Aachen:[50.78,6.08],Monschau:[50.55,6.24],Wiltz:[49.97,5.93],Luxembourg:[49.61,6.13],Longwy:[49.52,5.76],Sedan:[49.70,4.94],Charleville:[49.77,4.72],Givet:[50.14,4.82],Hirson:[49.92,4.08],Maubeuge:[50.28,3.97],Valenciennes:[50.36,3.52]};
for(const [k,[la,lo]] of Object.entries(IN))assert.ok(inBelgium(la,lo),k+" is in Belgium");
for(const [k,[la,lo]] of Object.entries(OUT))assert.ok(!inBelgium(la,lo),k+" is not in Belgium");

// one row, every published form
const r=(a,b,p)=>{const x=readCoordinate(a,b,p);return[x.how,x.lat,x.lon]};
assert.deepEqual(r("50.85","4.35"),["degrees",50.85,4.35]);
assert.deepEqual(r("4.27","50.57"),["swapped",50.57,4.27],"Seneffe playgrounds");
assert.deepEqual(r("50864386","4354573"),["scaled",50.864386,4.354573],"Brussels cemeteries: degrees x 10^6");
assert.deepEqual(r("51075","3775"),["scaled",51.075,3.775]);
assert.deepEqual(r("50.880.263","4.354.573"),["scaled",50.880263,4.354573],"Brussels cemeteries: digit groups a spreadsheet put into degrees");
assert.equal(r("150234.5","170123.2")[0],"lambert72");
assert.deepEqual(r("6626189.498","412379.479").map(v=>typeof v==="number"?Math.round(v*1e3)/1e3:v),["web_mercator",51.028,3.704],"Ghent school finder: Web Mercator metres");
assert.deepEqual(r("0","0"),["missing",null,null]);assert.deepEqual(r("","4.3"),["missing",null,null]);assert.deepEqual(r("n/a","4.3"),["missing",null,null]);
assert.deepEqual(r("45.48","3.1"),["outside",null,null],"a place in France stays as published, unmapped");
assert.deepEqual(r("50.63","3.06"),["outside",null,null],"Lille is not Belgium even though it is inside the bounding box");
assert.deepEqual(r("3,72","51,05"),["swapped",51.05,3.72],"decimal commas");
assert.equal(r("44802.3226","24728.1")[0],"outside","SPW Lambert values that land in France are not mapped");

// a file's tally: which reading its rows needed, and the one its unambiguous rows use (it settles a row two readings fit; with
// Belgium's outline the lost-decimal and metre readings never both fit one pair, so the tie-break is a safeguard)
{
  const t=coordinateTally();for(const row of [["150234.5","170123.2"],["151000.1","171000.9"],["50.85","4.35"],["",""]])t.add(...row);
  assert.deepEqual(t.result(),{rows:4,how:{lambert72:2,degrees:1,missing:1},repaired:2,prefer:"lambert72"});
  const t2=coordinateTally();for(const row of [["50864386","4354573"],["50.85","4.35"],["4.27","50.57"]])t2.add(...row);
  assert.deepEqual(t2.result(),{rows:3,how:{scaled:1,degrees:1,swapped:1},repaired:2,prefer:"scaled"});
}
assert.deepEqual(coordinateColumns(["id","Latitude","Longitude"]),{lat:1,lon:2,latName:"Latitude",lonName:"Longitude"});
assert.equal(coordinateColumns(["id","lengte","breedte"]),null,"Dutch length and width are not coordinates");

// missing-value codes
assert.equal(isMissingCode(-999,1,14,"floors"),true);
assert.equal(isMissingCode(-999,-500,254,"price"),false,"-999 next to -500 is a value");
assert.equal(isMissingCode(99999,45,9999,"code_etudes"),false,"identifier columns keep their codes");
assert.equal(isMissingCode(-9999,120,266,"MNT_ALT_MIN"),true);

// what the card says
const rep={coordinates:{lat_column:"lat",lon_column:"long",rows:200,how:{degrees:180,swapped:10,missing:6,outside:4},repaired:10,prefer:null},missing_codes:[{column:"floors",codes:[-999],rows:12}]};
const said=describeRepairs(rep);
assert.equal(said[0],"Coordinates ('lat', 'long'): 95 % of the 200 rows can be mapped, 90 % as published and 5 % latitude and longitude swapped back; 5 % have no usable position (4 outside Belgium in every reading, kept as published).");
assert.equal(said[1],"'floors' uses -999 for a missing value in 12 rows; the ranges shown leave them out.");

// the SQL view: published columns stay, repaired ones are added; nothing to repair, no view
const sql=repairSelectSql({repairs:rep},"t");
assert.ok(sql.startsWith('SELECT * EXCLUDE (__a, __b, __pick) REPLACE (CASE WHEN TRY_CAST(replace(CAST("floors" AS VARCHAR),\',\',\'.\') AS DOUBLE) IN (-999) THEN NULL ELSE "floors" END AS "floors") , round(CASE __pick WHEN 1 THEN __a WHEN 2 THEN __b ELSE NULL END,7) AS lat_wgs84, '),"published columns kept, codes nulled, lat_wgs84 added");
assert.ok(/ AS coordinate_repair FROM \(SELECT \*, CASE WHEN .* END AS __pick FROM \(SELECT \*, .* AS __a, .* AS __b FROM t\)\)$/.test(sql),"one outline test per row and candidate, over the numbers read once");
assert.ok(sql.length<20000,"no repeated outline tests: "+sql.length+" characters");
assert.ok(!/->|lambda/.test(sql),"no lambda syntax (it differs between DuckDB versions)");
assert.equal(repairSelectSql({},"t"),null);
assert.equal(repairSelectSql({repairs:{coordinates:{...rep.coordinates,repaired:0}}},"t"),null,"coordinates that need nothing get no view");
console.log(JSON.stringify({ok:true,repairs:"coordinates, outline, codes, sentences, SQL shape",lambert_worst_m:Math.round(worst*10)/10}));
