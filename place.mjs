// One place, one set of identifiers: every location answer (air quality, flood risk) carries the 2025 municipality with its NIS code,
// province and region, plus the Statbel headline figures for it, so answers from different sources join on the same codes.
//   address  -> the geocoder's municipality (BeSt gives the NIS code directly; the Flemish service gives the name)
//   point    -> Digitaal Vlaanderen's 2025 municipality boundaries (VRBG2025) in Flanders; BeSt's nearest address elsewhere
import { _dov, GEO_ORIGIN } from "./dov.mjs";
import { municipalitySummary } from "./statbel.mjs";
const {getJson,DAY}=_dov;
const BEST="https://best.pr.fedservices.be/api/opendata/best/v1/belgianAddress/v2/addresses";

async function nisAtPoint(client,loc){
  const q=new URLSearchParams({service:"WFS",version:"2.0.0",request:"GetFeature",typeNames:"VRBG2025:Refgem",outputFormat:"application/json",srsName:"EPSG:31370",count:"1",
    propertyName:"NAAM,NISCODE",cql_filter:`INTERSECTS(SHAPE,POINT(${loc.x} ${loc.y}))`});
  const r=await getJson(client,GEO_ORIGIN+"/VRBG2025/wfs?"+q,{maxBytes:64*1024,ttl:30*DAY});
  const f=r.json?.features?.[0]?.properties;if(f?.NISCODE)return f.NISCODE;
  if(loc.latitude==null)return null;
  // outside Flanders: the municipality of the nearest registered address (BeSt answers a full page, ~0.4 MB, so this is the fallback)
  const b=await getJson(client,BEST+"?"+new URLSearchParams({xLong:String(loc.longitude),yLat:String(loc.latitude),radius:"300",crs:"wgs84"}),{maxBytes:1<<20,ttl:30*DAY});
  return b.json?.items?.[0]?.hasMunicipality?.nisCode||null;
}
export async function placeContext(client,assets,loc){
  if(!assets)return null;
  const nis=loc.nis_code||(loc.municipality?null:await nisAtPoint(client,loc));
  return municipalitySummary(assets,nis||loc.municipality);
}
