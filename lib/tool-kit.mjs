// Helpers a live answer tool may use. Import from here, not from the domain modules, so tools stay independent of each other.
//
//   getJson(client, url, {maxBytes, ttl})   -> {json} or {error}; the only way to read an upstream service (bounded by the client)
//   client.get(url, {maxBytes, ttl, binary}) -> {text|bytes, contentType} or {error}; for XML, CSV or ZIP answers
//   resolveLocation(client, args, {area})    -> {loc:{x, y, latitude, longitude, address?, municipality?, ...}} or {error};
//                                               accepts args.address or latitude/longitude or x_lambert72/y_lambert72;
//                                               area "flanders" (default) or "belgium"; x/y are Belgian Lambert 72 metres
//   placeContext(client, assets, loc)        -> the municipality at the point with NIS code, population and income (or null)
//   clean(obj)                               -> obj without null, undefined, "" and empty arrays (keeps answers small)
//   round(value, decimals) / cut(text, n)    -> number and text shortening
//   wgs84ToLambert72 / lambert72ToWgs84      -> coordinate conversion (Belgian Lambert 72, EPSG:31370)
//   DAY, HOUR                                -> edge-cache lifetimes in seconds for the ttl option
import { _dov, lambert72ToWgs84, wgs84ToLambert72 } from "../dov.mjs";
import { placeContext } from "../place.mjs";

export const { getJson, resolveLocation, clean, round, cut, DAY, HOUR } = _dov;
export { placeContext, lambert72ToWgs84, wgs84ToLambert72 };

/** Today's date for citations ("consulted on"). */
export const today=()=>new Date().toISOString().slice(0,10);
