// Value-level cleaning shared by the harvest (national DCAT, ISO, portals) and the index build.
import { createHash } from "node:crypto";
// Each rule fixes a defect measured on the live catalogue (2026-11-17 quality round); the counts are in the comments.
const clean=s=>String(s??"").replace(/\s+/g," ").trim();
const thisYear=()=>new Date().getUTCFullYear();

/* ---------- dates ---------- */
/** A catalogue "updated" date: a real day between 1970 and next year, else "" ("Invalid Date", 1571-01-01, 9999-...). */
export function validUpdated(v){
  const m=clean(v).match(/^(\d{4})-(\d\d)-(\d\d)/);if(!m)return"";
  const y=Number(m[1]);return y>=1970&&y<=thisYear()+1&&Number(m[2])>=1&&Number(m[2])<=12?m[0]:"";
}
/**
 * A declared period. An end more than a year ahead (2029, 2050, 2099, 9999: 60 records) is a validity or planning date,
 * not data the file holds, so the period is open-ended and the stated end kept as plannedEnd.
 */
export function cleanPeriod(p){
  if(!p)return null;
  const yr=v=>Number(String(v||"").slice(0,4));
  let start=p.start||null,end=p.end||null,plannedEnd=null;
  if(start&&!(yr(start)>=1000))start=null;
  if(end&&!(yr(end)>=1000))end=null;
  if(end&&yr(end)>thisYear()+1){plannedEnd=end;end=null}
  if(start&&yr(start)>thisYear()+1)return null;
  if(!start&&!end)return null;
  return{start,end,...(plannedEnd?{plannedEnd}:{})};
}

/* ---------- frequency ---------- */
// EU frequency authority codes (publications.europa.eu/resource/authority/frequency)
const EU_FREQ=new Set(["TRIENNIAL","BIENNIAL","ANNUAL","ANNUAL_2","ANNUAL_3","BIMONTHLY","SEMIMONTHLY","MONTHLY","MONTHLY_2","MONTHLY_3","BIWEEKLY","WEEKLY","WEEKLY_2","WEEKLY_3",
  "DAILY","DAILY_2","CONT","IRREG","UNKNOWN","OTHER","QUARTERLY","DECENNIAL","QUADRENNIAL","QUINQUENNIAL","TRIDECENNIAL","HOURLY","BIHOURLY","TRIHOURLY","12HRS","1MIN","5MIN","10MIN","15MIN","30MIN",
  "UPDATE_CONT","AS_NEEDED","NOT_PLANNED","NEVER","BIDECENNIAL","OP_DATPRO"]);
const FREQ_ALIAS={CONTINUOUS:"CONT",CONTINUAL:"CONT",IRREGULAR:"IRREG",ANNUALLY:"ANNUAL",YEARLY:"ANNUAL",QUARTERLY:"QUARTERLY",MONTHLY:"MONTHLY",WEEKLY:"WEEKLY",DAILY:"DAILY",ASNEEDED:"AS_NEEDED",NOTPLANNED:"NOT_PLANNED"};
/** An EU frequency code, or "" for anything else (blank-node ids such as b6d53d…-3958c… leaked as frequency on 10 records). */
export function cleanFrequency(v){
  const s=clean(v).toUpperCase().replace(/[\s-]+/g,"_");if(!s)return"";
  if(EU_FREQ.has(s))return s;
  return FREQ_ALIAS[s.replace(/_/g,"")]||"";
}

/* ---------- identifiers that leaked as labels ---------- */
export const isOpaqueId=s=>/^[a-f0-9]{20,}(?:-[a-f0-9]{8,})?$/i.test(clean(s))||/\.well-known\/genid\//i.test(String(s||""));

/* ---------- publishers ---------- */
// SPW directorates-general: one name each, the short form data.gov.be already uses.
const SPW_DG=[
  [/secr[ée]tariat g[ée]n[ée]ral|\bSPW-SG\b/i,"SPW-SG Secrétariat général"],
  [/agriculture,? ressources naturelles et environnement|\bARNE\b|\bDGO3\b/i,"SPW ARNE"],
  [/mobilit[ée] et infrastructures|\bSPW-MI\b|\bDGO[12]\b/i,"SPW-MI Mobilité et Infrastructures"],
  [/territoire,? logement,? patrimoine,? [ée]nergie|\bTLPE\b|\bDGO4\b/i,"SPW TLPE Territoire, Logement, Patrimoine, Énergie"],
  [/[ée]co(?:no)?mie,? emploi,? recherche|\bSPW EER\b|\bDGO6\b/i,"SPW EER Économie, Emploi, Recherche"],
  [/int[ée]rieur et action sociale|\bSPW IAS\b|\bDGO5\b/i,"SPW IAS Intérieur et Action sociale"],
  [/\bfiscalit[ée]\b|\bDGO7\b/i,"SPW Fiscalité"]
];
const ALIASES=[
  [/^(spw|service public de wallonie(?: \(spw\))?|spw wallonia: .*\bhvd)$/i,"Service public de Wallonie (SPW)"],
  [/^(geo\.be \/ )?national geographic institute|^ngi$|^institut g[ée]ographique national\b|^nationaal geografisch instituut\b/i,"National Geographic Institute (NGI)"],
  [/^royal belgian institute (?:of|for) natural sciences|^koninklijk belgisch instituut voor natuurwetenschappen|^institut royal des sciences naturelles/i,"Royal Belgian Institute of Natural Sciences"],
  [/^royal meteorological institute|^koninklijk meteorologisch instituut|^institut royal m[ée]t[ée]orologique/i,"Royal Meteorological Institute of Belgium"],
  [/^(fps|spf|fod) finan(ce|ces|ciën)\b|\((spf|fps|fod) finan(ces?|ciën)\b|documentation patrimoniale|patrimoniumdocumentatie|patrimonial documentation/i,"FPS Finance"],
  [/^(le )?forem$/i,"Le Forem"],
  // product or portal names used as publisher by direct harvests and hand-reviewed sources
  [/^(agentschap )?digitaal vlaanderen(:.*)?$/i,"Agentschap Digitaal Vlaanderen"],
  [/^brussels mobility(:.*| open data)?$|^bruxelles mobilit[ée]$/i,"Brussels Mobility"],
  [/^vlaamse milieumaatschappij|^vmm\b|^flanders environment agency/i,"Flanders Environment Agency"],
  [/^(belgian interregional environment agency|ircel ?[-\/]? ?celine|irceline)\b/i,"IRCEL-CELINE"],
  [/^belgian national access point for its$|^transportdata\.be$/i,"transportdata.be"],
  [/^(riziv|inami)\b|^nihdi$/i,"NIHDI"],
  [/^bebat$/i,"Bebat"]
];
/** One name per organisation. `name` may be an ISO party string such as "Gestion et valorisation de la donnée (SPW - Secrétariat général - …)". */
export function canonicalPublisher(name){
  let s=clean(name);if(!s)return"";
  // "Unit (SPW - Directorate-general - Department - Unit)": the directorate-general publishes
  const spw=s.match(/\(SPW\s*-\s*([^)]*)\)/i)||(/^(SPW|Service public de Wallonie)\b/i.test(s)?[s,s]:null);
  if(spw){for(const [re,canon] of SPW_DG)if(re.test(spw[1]))return canon}
  for(const [re,canon] of ALIASES)if(re.test(s))return canon;
  // long ISO party strings: "Org (ACR), Directorate…, Unit (X)" -> "Org (ACR)"
  if(s.length>70&&s.includes(","))s=s.split(",")[0].trim();
  for(const [re,canon] of ALIASES)if(re.test(s))return canon;
  return s;
}
// spellings compare without accents, case, spaces, legal form or a trailing acronym: "Be WaPP asbl" = "BeWaPP", "Agence du Numérique (AdN)" = "Agence du Numérique"
const nameKey=s=>clean(s).replace(/\s*\([A-Za-zÀ-ÿ.\-]{2,12}\)\s*$/,"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase()
  .replace(/\b(asbl|vzw|nv|sa|bv|srl|scrl|cvba|n\.v\.|s\.a\.)\.?$/,"").replace(/[^a-z0-9]+/g,"").trim();
/** Spellings that differ only in case, accents or punctuation (BEBAT/Bebat, Université Libre/libre) take the most used one. */
export function unifyPublisherNames(items,field="provider"){
  const counts=new Map();
  for(const x of items){const k=nameKey(x[field]);if(!k)continue;const m=counts.get(k)||counts.set(k,new Map()).get(k);m.set(x[field],(m.get(x[field])||0)+1)}
  const pick=new Map();for(const [k,m] of counts)if(m.size>1)pick.set(k,[...m].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0][0]);
  let n=0;for(const x of items){const p=pick.get(nameKey(x[field]));if(p&&p!==x[field]){x[field]=p;n++}}
  return n;
}

/* ---------- copies of one portal dataset ---------- */
/** The portal dataset slug in an OpenDataSoft-style URL ("…/explore/dataset/<slug>/", "…/catalog/datasets/<slug>/…"), when distinctive. */
export function portalSlug(u){const m=String(u||"").match(/\/(?:explore\/dataset|catalog\/datasets)\/([^/?#]+)/i);return m&&m[1].length>=12&&/[-_]/.test(m[1])?m[1].toLowerCase():""}
/**
 * The same portal dataset is often listed 2-4 times: the portal's own record (Dutch title), data.gov.be (English title), a hand-reviewed
 * record (370 datasets, 776 records on 2026-11-17). Records sharing a distinctive slug and the same (or an unknown) publisher get one
 * collection id, so search shows the best one with "more in collection". A real series (series:…) is never overwritten.
 */
export function groupPortalCopies(items,{unknown="data.gov.be source"}={}){
  const bySlug=new Map();
  for(const x of items){
    const slugs=new Set([x.officialUrl,...(x.distributions||[]).map(d=>Array.isArray(d)?d[4]:d?.url)].map(portalSlug).filter(Boolean));
    for(const s of slugs)(bySlug.get(s)||bySlug.set(s,[]).get(s)).push(x);
  }
  let n=0;
  for(const [slug,xs] of bySlug){
    const members=[...new Set(xs)];if(members.length<2)continue;
    const pubs=new Set(members.map(x=>x.provider).filter(p=>p&&p!==unknown));if(pubs.size>1)continue;
    const id="copy:"+createHash("sha1").update(slug).digest("hex").slice(0,10);
    // a copy without a named publisher takes the one its other copies name
    if(pubs.size===1){const p=[...pubs][0];for(const x of members)if(!x.provider||x.provider===unknown){x.provider=p;x.publisherInferredFrom="slug"}}
    const eligible=members.filter(x=>!x.seriesId||/^(same|copy):/.test(x.seriesId));
    if(eligible.length<2)continue;   // the others already belong to a real series
    for(const x of eligible)if(x.seriesId!==id){x.seriesId=id;n++}
  }
  return n;
}

/* ---------- geography ---------- */
const CITY=/^(?:City of|Ville de|Stad|Gemeente|Commune de)\s+(.+?)(?:\s+-\s+.*)?$/i;
/** A city's own records cover the city, not the region its national record names (Namur 196, Liège 96, Mons 25 records). */
export function cityGeography(provider,geo){
  const m=clean(provider).match(CITY);
  return m&&(!geo||/^(Belgium|Flanders|Wallonia|Brussels-Capital)$/.test(geo))?m[1]:geo||"";
}

/* ---------- text ---------- */
/** Cut at a word boundary and say so, instead of stopping mid-word (1,432 descriptions). */
export function cutText(s,n){
  const t=clean(s);if(t.length<=n)return t;
  const cut=t.slice(0,n-1),sp=cut.lastIndexOf(" ");
  return (sp>n*0.6?cut.slice(0,sp):cut).replace(/[\s,;:.\-–(]+$/,"")+"…";
}
/** HTML to text, including a tag cut off by an earlier truncation ("… du <a href=\"https://www.gall"). */
export function htmlToText(s){
  return clean(String(s??"").replace(/<(script|style)[\s\S]*?<\/\1>/gi," ").replace(/<[^>]*>/g," ").replace(/<[a-z\/][^>]*$/i," ")
    .replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;|&rsquo;|&lsquo;/g,"'")
    .replace(/&eacute;/g,"é").replace(/&egrave;/g,"è").replace(/&agrave;/g,"à").replace(/&ccedil;/g,"ç").replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(Number(d))));
}

/* ---------- links ---------- */
// Hosts that answer the same page over https (checked 2026-11-17); their http landing pages are upgraded.
const HTTPS_HOSTS=new Set(["www.ejustice.just.fgov.be","geologie.wallonie.be","walstat.iweps.be","www.spge.be","ravel.wallonie.be","statbel.fgov.be","eau.wallonie.be",
  "indicatoren.verkeerscentrum.be","metawal.wallonie.be","erddap.naturalsciences.be","ec.europa.eu","www.meteo.be","scolytes.be","environnement.wallonie.be","www.arch.be",
  "www.requasud.be","ibpt.be","www.issep.be","www.openstreetmap.org"]);
export function httpsLink(u){
  const s=clean(u);const m=s.match(/^http:\/\/([^/?#]+)/i);
  return m&&HTTPS_HOSTS.has(m[1].toLowerCase())?"https"+s.slice(4):s;
}
/** A landing page people can open: never a data.gov.be blank-node IRI (1,485 records). A DOI dataset lands on doi.org. */
export function landingPage({landingPage="",subject="",identifier="",distributions=[]}){
  if(landingPage&&!/\.well-known\/genid\//i.test(landingPage))return httpsLink(landingPage);
  const doi=(String(identifier||"")+" "+subject).match(/\b(10\.\d{4,9}\/[^\s"<>]+)/);
  if(doi)return"https://doi.org/"+doi[1];
  if(/^https?:\/\//i.test(subject)&&!/\.well-known\/genid\//i.test(subject))return httpsLink(subject);
  return distributions.find(d=>d?.url)?.url||"";
}
