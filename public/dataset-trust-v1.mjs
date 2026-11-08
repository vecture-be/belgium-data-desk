// Freshness and trust checks shared by the harvest, the browser and tests.
import { LICENSE_FAMILY_NOTE, normalizeLicense } from "./dataset-licence-v1.mjs";
/* ---------- freshness ---------- */
const DAY=86400000;
const FREQ_DAYS={"1MIN":1,"5MIN":1,"15MIN":1,"HOURLY":2,CONT:2,REAL_TIME:2,DAILY:3,WEEKLY:10,BIWEEKLY:20,MONTHLY:45,BIMONTHLY:75,QUARTERLY:120,ANNUAL_2:240,ANNUAL_3:300,ANNUAL:430,BIENNIAL:800,TRIENNIAL:1200,QUADRENNIAL:1600,QUINQUENNIAL:2000,DECENNIAL:3800};
export function freshness(item,now=Date.now()){
  const modified=Date.parse(item.dataProcessedAt||item.updatedAt||"");
  const age=Number.isFinite(modified)?Math.max(0,Math.floor((now-modified)/DAY)):null;
  const freq=String(item.frequency||"").toUpperCase();
  if(freq==="NEVER"||freq==="NOT_PLANNED")return{state:"static",ageDays:age,note:"Publisher says it will not be updated."};
  if(age==null)return{state:"unknown",ageDays:null,note:"No modification date in the catalogue record."};
  const expected=FREQ_DAYS[freq];
  if(expected)return age<=expected?{state:"current",ageDays:age,note:"Updated within its declared "+freq.toLowerCase().replace(/_/g," ")+" cycle (metadata date)."}:{state:"stale",ageDays:age,note:"Declared "+freq.toLowerCase().replace(/_/g," ")+" but last modified "+age+" days ago (metadata date)."};
  if(age>1095)return{state:"old",ageDays:age,note:"No update cycle declared; last modified over 3 years ago (metadata date)."};
  return{state:"dated",ageDays:age,note:"No update cycle declared; last modified "+age+" days ago (metadata date)."};
}

/* ---------- trust checks ("receipts") ---------- */
// Each check is pass | warn | fail | unknown with a one-line evidence string. No single score hides an unknown.
export function trustChecks(item,{health={},now=Date.now()}={}){
  const dists=item.distributions||[],lic=item.licenseFamily&&item.licenseFamily!=="unknown"?{...normalizeLicense(item.licenseUri||item.license),family:item.licenseFamily}:normalizeLicense(item.licenseUri||item.license),fr=freshness(item,now),pr=item.probe;
  const probed=dists.filter(d=>health[d.url]),okLinks=probed.filter(d=>health[d.url].ok),mism=probed.filter(d=>health[d.url].formatMatch===false);
  const checks=[];
  checks.push({id:"source",label:"Official source",status:item.officialUrl&&/^https?:/.test(item.officialUrl)?"pass":"warn",detail:item.officialUrl?"Landing page published by "+(item.provider||"the publisher")+".":"No landing page in the record."});
  checks.push({id:"licence",label:"Licence",status:lic.family==="open"||lic.family==="open-sharealike"?"pass":lic.family==="unknown"?"fail":"warn",detail:lic.label?lic.label+" — "+LICENSE_FAMILY_NOTE[lic.family]:LICENSE_FAMILY_NOTE.unknown});
  checks.push({id:"freshness",label:"Freshness",status:{current:"pass",static:"pass",dated:"unknown",unknown:"unknown",old:"warn",stale:"warn"}[fr.state],detail:fr.note});
  // The catalogue ships a compact per-record probe summary (scripts/apply-link-health.mjs); per-URL health is only available offline.
  if(!probed.length&&pr&&pr.n){
    checks.push({id:"access",label:"Link works",status:pr.ok===pr.n?"pass":pr.ok?"warn":"fail",detail:pr.ok+" of "+pr.n+" file links answered when checked on "+pr.at+"."});
    checks.push({id:"format",label:"Format is what it says",status:pr.mm?"warn":"pass",detail:pr.mm?pr.mm+" file(s) did not look like their declared format.":"Downloaded bytes matched the declared format."});
  }else if(!probed.length)checks.push({id:"access",label:"Link works",status:"unknown",detail:dists.length?"Not link-checked yet.":"No download or service link."});
  else checks.push({id:"access",label:"Link works",status:okLinks.length===probed.length?"pass":okLinks.length?"warn":"fail",detail:okLinks.length+" of "+probed.length+" checked file links answered."});
  if(probed.length)checks.push({id:"format",label:"Format is what it says",status:mism.length?"warn":"pass",detail:mism.length?mism.length+" file(s) did not look like their declared format.":"Downloaded bytes match the declared format."});
  checks.push({id:"contact",label:"Who to ask",status:item.contactEmail||item.contactUrl?"pass":"warn",detail:item.contactEmail||item.contactUrl?"Publisher contact is published.":"No publisher contact in the record."});
  checks.push({id:"structure",label:"Columns known",status:(item.fields||[]).length?"pass":"unknown",detail:(item.fields||[]).length?(item.fields.length)+" publisher-declared fields.":"Not known until the file is profiled in your browser."});
  return checks;
}
export function summarizeChecks(checks){
  const n=s=>checks.filter(c=>c.status===s).length;
  return{pass:n("pass"),warn:n("warn"),fail:n("fail"),unknown:n("unknown"),total:checks.length};
}

