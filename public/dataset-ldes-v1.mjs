// Common LDES catalogue interpretation for the browser, SEO and harvest. Metadata
// discovery is not a live health check and does not imply complete event history.
const clean=v=>String(v??"").trim();
export function isLdesEndpoint(url){
  try{
    const u=new URL(clean(url));
    return u.protocol==="https:"&&/(?:^|\/)ldes(?:\/|$)/i.test(u.pathname);
  }catch{return false}
}
export function isLdesDistribution(distribution){
  const d=Array.isArray(distribution)
    ?{name:distribution[0],format:distribution[1],url:distribution[4]}:distribution||{};
  const url=clean(d.url);
  if(!/^https:\/\/[^\s]+$/i.test(url))return false;
  // A JSON-LD document, RDF file, or a page mentioning LDES is not necessarily
  // a stream. Require an explicit distribution type/name or a recognizable endpoint.
  return isLdesEndpoint(url)||/\bldes\b|linked data event stream/i.test(clean(d.format)+" "+clean(d.name));
}
export function ldesCapability(asset){
  const seen=new Set(),endpoints=[];
  for(const d of asset?.distributions||[]){
    const x=Array.isArray(d)?{name:d[0],format:d[1],url:d[4]}:d||{};
    if(!isLdesDistribution(x)||seen.has(x.url))continue;
    seen.add(x.url);
    endpoints.push({url:x.url,format:clean(x.format)||"LDES",name:clean(x.name)||"Linked Data Event Stream"});
  }
  const described=/\bldes\b|linked data event streams?/i.test([asset?.title,asset?.description].join(" "));
  return{status:endpoints.length?"publisher_declared":described?"mentioned_only":"none",endpoints};
}
