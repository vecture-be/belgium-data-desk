// Who published this dataset? Pure naming logic, kept out of the UI module so it can be tested.
// Precedence: the publisher the catalogue itself declares → a curated name for an enterprise number → an EXACT official-host match
// (only when the record carries no usable name). Host matching is never fuzzy: a shared parent domain such as vlaanderen.be
// says nothing about who published a record.
export const KNOWN_PUBLISHERS={"0267387230":"FAVV / FASFC","0410057701":"Institute of Tropical Medicine","0477445084":"Fluvius"};

export const publisherReference=a=>{
  const raw=String(a.provider||"").trim(),uri=String(a.publisherUri||""),m=(raw.match(/^\d{10}$/)||uri.match(/CbeRegisteredEntity\/(\d{10})(?:$|[?#])/i));
  return m?(m[1]||m[0]):"";
};
export const formatEnterpriseNumber=id=>/^\d{10}$/.test(id)?id.slice(0,4)+"."+id.slice(4,7)+"."+id.slice(7):id;

const unusableName=raw=>!raw||/^organization$/i.test(raw)||raw.length>90||/^[a-f0-9]{24,}(?:-[a-f0-9]{8,})?$/i.test(raw)||/^data\.gov\.be source$/i.test(raw);

export function createPublisherNamer(sources=[]){
  const byHost=new Map(sources.flatMap(s=>{try{const host=new URL(s.url).hostname.toLowerCase().replace(/^www\./,"");return host?[[host,s.org||s.name]]:[]}catch{return[]}}));
  const fromOfficialHost=a=>{
    for(const value of [a.evidence?.[0],...(a.distributions||[]).map(d=>d[4])]){
      try{const name=byHost.get(new URL(value).hostname.toLowerCase().replace(/^www\./,""));if(name)return name}catch{}
    }
    return"";
  };
  const publisherDisplayName=a=>{
    const raw=String(a.provider||a.product||"").trim(),id=publisherReference(a);
    if(KNOWN_PUBLISHERS[id])return KNOWN_PUBLISHERS[id];
    if(/(^|[^a-z])(favv|fasfc|afsca)([^a-z]|$)/i.test(raw))return"FAVV / FASFC";
    const matches=[...raw.matchAll(/[?&]refine\.publisher=([^?&#]+)/gi)].map(x=>{try{return decodeURIComponent(x[1].replace(/\+/g," "))}catch{return x[1]}}).filter(Boolean);
    if(matches.length===1)return matches[0];
    // A readable declared name always wins, even when the record also carries an enterprise-number URI.
    if(/^\d{10}$/.test(raw)||unusableName(raw)){
      const host=fromOfficialHost(a);if(host)return host;
      if(id)return"Belgian organisation "+formatEnterpriseNumber(id);
      return a.discovery==="data.gov.be"?"data.gov.be publisher":(a.platform||"Publisher");
    }
    return raw;
  };
  return{publisherDisplayName,fromOfficialHost};
}
