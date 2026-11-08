const norm=v=>String(v||"").toLowerCase();

export function sourceAlias(a){
  if(a.depth==="modelled")return a.sourceId||norm(a.product);
  const p=norm(a.provider||a.product);
  const aliases=[["elia","elia"],["infrabel","infrabel"],["transportdata","transportdata"],["de lijn","transportdata"],["favv","favv"],["afsca","favv"],["fasfc","favv"],["digitaal vlaanderen — grb","grb"],["grb","grb"],["vkbo","datavlaanderen"],["dov","dov"],["spw wallonia","wallonia"],["wallonia","wallonia"],["brussels","brussels"],["geo.be","ngi"],["national geographic institute","ngi"]];
  return aliases.find(([needle])=>p.includes(needle))?.[1]||p.replace(/[^a-z0-9]+/g,"-");
}
const hostAliases={"opendata.elia.be":"elia","opendata.infrabel.be":"infrabel","opendata.fluvius.be":"fluvius","transportdata.be":"transportdata","www.transportdata.be":"transportdata","favv-afsca.be":"favv","www.favv-afsca.be":"favv","foodweb.favv-afsca.be":"favv"};
export function urlIdentity(value){
  const raw=String(value||"").trim(),m=raw.match(/^https?:\/\/([^/?#]+)([^?#]*)?(?:\?([^#]*))?/i);
  if(!m)return"";
  const host=m[1].toLowerCase(),alias=hostAliases[host]||host.replace(/^www\./,""),path=m[2]||"/",q=m[3]?"?"+m[3]:"";
  const d=path.match(/\/(?:explore\/dataset|dataset)\/([^/]+)/i)
    ||path.match(/\/api\/explore\/v(?:1|2(?:\.1)?)\/catalog\/datasets\/([^/]+)/i);
  if(d){try{return alias+"|"+norm(decodeURIComponent(d[1]))}catch{return alias+"|"+norm(d[1])}}
  return alias+"|"+norm(path.replace(/\/+$/,"")||"/")+q;
}
const UUID=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export function identityKeys(a){
  const out=new Set(),alias=sourceAlias(a),id=norm(a.datasetId||"").trim(),plainId=id&&!/^https?:\/\//i.test(id)?id.replace(/\s+/g," "):"";
  if(id)out.add(alias+"|"+id.replace(/\s+/g," "));
  const urlKeys=[];
  for(const v of [a.datasetId,a.evidence?.[0],...(a.distributions||[]).map(d=>d[4])]){
    const k=urlIdentity(v);if(k){out.add(k);urlKeys.push(k)}
  }
  if(plainId)for(const k of urlKeys){const hostAlias=k.split("|",1)[0];if(hostAlias)out.add(hostAlias+"|"+plainId)}
  // GeoNetwork catalogues (Metawal, geo.be) and data.gov.be describe the same record with the same UUID under different hosts.
  for(const v of [a.datasetId,a.evidence?.[0],a.sourceRecord]){const u=String(v||"").match(UUID);if(u)out.add("uuid|"+u[0].toLowerCase())}
  if(!out.size)out.add(alias+"|"+norm(a.title));
  return [...out];
}
const depthRank={modelled:3,structured:2,harvested:1};
// Within one depth, the record carrying more usable metadata wins (licence, typed distributions) before the publisher-vs-national tie-break.
const informationScore=a=>(a.license?3:0)+Math.min(5,(a.distributions||[]).filter(d=>d?.[1]&&d[1]!=="URL").length)+(a.themes?.length?1:0);
const assetRank=a=>(depthRank[a.depth]||0)*100+informationScore(a)*2+(a.discovery==="data.gov.be"?0:1);
const mergeUsefulMetadata=(preferred,other,sources)=>({...preferred,contactName:preferred.contactName||other.contactName||"",contactEmail:preferred.contactEmail||other.contactEmail||"",contactUrl:preferred.contactUrl||other.contactUrl||"",officialUrl:preferred.officialUrl||other.officialUrl||"",publisherUri:preferred.publisherUri||other.publisherUri||null,discoverySources:sources});

const titleKey=a=>norm(a.title).normalize("NFKD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g," ").trim();
// A key that one source attaches to several differently-titled records (a shared WMS endpoint, a catalogue landing page)
// identifies a service or a catalogue, not a dataset. Using it to merge would silently delete distinct datasets.
function unsafeKeys(entries){
  const bySource=new Map();
  for(const {a,keys} of entries){
    const src=a.discovery||"curated";
    for(const k of keys){
      let sources=bySource.get(k);if(!sources)bySource.set(k,sources=new Map());
      let titles=sources.get(src);if(!titles)sources.set(src,titles=new Set());
      titles.add(titleKey(a));
    }
  }
  const unsafe=new Set();
  for(const [k,sources] of bySource)for(const titles of sources.values())if(titles.size>1){unsafe.add(k);break}
  return unsafe;
}
export function mergeDiscoveredAssets(assets){
  const winners=[],keyToIndex=new Map(),winnerKeys=[];
  const entries=(assets||[]).map(raw=>({a:{...raw,discoverySources:[...new Set(raw.discoverySources||[raw.discovery||"curated"])]},keys:identityKeys(raw)})),unsafe=unsafeKeys(entries);
  for(const entry of entries){
    const a=entry.a,keys=entry.keys.filter(k=>!unsafe.has(k));
    if(!keys.length)keys.push("record|"+(a.id||titleKey(a)));
    let idx=keys.map(k=>keyToIndex.get(k)).find(x=>x!==undefined);
    if(idx===undefined){
      idx=winners.length;winners.push(a);winnerKeys.push(keys);for(const k of keys)keyToIndex.set(k,idx);continue;
    }
    const prev=winners[idx],sources=[...new Set([...(prev.discoverySources||[]),...(a.discoverySources||[])])];
    winnerKeys[idx]=[...new Set([...winnerKeys[idx],...keys])];
    if(assetRank(a)>assetRank(prev))winners[idx]=mergeUsefulMetadata(a,prev,sources);
    else winners[idx]=mergeUsefulMetadata(prev,a,sources);
    for(const k of winnerKeys[idx])keyToIndex.set(k,idx);
  }
  return winners;
}
export const isNationalIndexed=a=>(a?.discoverySources||[]).includes("data.gov.be");
