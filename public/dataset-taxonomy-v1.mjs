// Reader-facing vocabulary shared by the harvest (scripts/curate.mjs) and the browser UI, so labels cannot drift apart.
export const TOPIC_LABELS={
  geology:"Geology & subsurface",water:"Water & sea",energy:"Energy",transport:"Transport & mobility",health:"Health",
  population:"Population & society",economy:"Economy & business",environment:"Environment & climate",agriculture:"Agriculture & food",
  education:"Education & culture",government:"Government & public sector",places:"Maps & places",other:"Other"
};
export const KIND_LABELS={dataset:"Dataset","map-service":"Map / web service",publication:"Publication (documents)",research:"Research supplement","metadata-only":"Metadata only"};

// "What do you want to see?" — the default view shows real datasets; the rest is one click away and always counted.
export const SCOPES=[
  {id:"datasets",label:"Datasets",hint:"Data files and APIs"},
  {id:"maps",label:"Maps & services",hint:"WMS, WFS and other map layers"},
  {id:"publications",label:"Publications",hint:"PDF reports and documents"},
  {id:"research",label:"Research",hint:"Supplements to scientific papers"},
  {id:"metadata",label:"Metadata only",hint:"Described, but no download or service link"},
  {id:"all",label:"Everything",hint:"All catalogue records"}
];
const SCOPE_OF_KIND={"map-service":"maps",publication:"publications",research:"research","metadata-only":"metadata"};
/** Records without a computed kind (hand-curated assets) are treated as datasets. */
export const scopeOf=a=>SCOPE_OF_KIND[a?.dataKind]||"datasets";
export const inScope=(a,scope)=>!scope||scope==="all"||scopeOf(a)===scope;
export function scopeCounts(items){
  const counts={all:0};for(const s of SCOPES)counts[s.id]=0;
  for(const a of items){counts[scopeOf(a)]++;counts.all++}
  return counts;
}

// ---- topic classification (shared so the browser classifies hand-curated assets with the same rules as the harvest) ----
const norm=s=>String(s??"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase();
// Reader-facing topics. EU codes REGI/TECH/GOVE are tagged on most records so they are only a last resort.
const TOPIC_RULES=[
  ["geology","Geology & subsurface",/\b(ondergrond|subsurface|geolog\w*|grondwater|groundwater|boring\w*|hydrogeolog\w*|bodem\w*|soil)\b/],
  ["water","Water & sea",/\b(waterinfo|water|rivier|river|kust|coast|noordzee|north sea|overstroming|flood|hydro\w*)\b/],
  ["energy","Energy",/\b(energi\w*|electric\w*|elektric\w*|gas|solar|zonne|wind|fluvius|elia|net ?injection|netinjectie)\b/],
  ["transport","Transport & mobility",/\b(transport|mobil\w*|verkeer|traffic|gtfs|rail|spoor|train|bus|tram|metro|fiets|bike|parking|vervoer|voertuig\w*|motorvoertuig\w*|infrabel)\b/],
  ["health","Health",/\b(health|gezondheid|sant[eé]|ziekte|disease|hospital|ziekenhuis|vaccin\w*|sciensano|covid)\b/],
  ["population","Population & society",/\b(population|bevolking|inwoners|habitants|demograph\w*|census|volkstelling|huishoud\w*|household|armoede|poverty|migratie)\b/],
  ["economy","Economy & business",/\b(econom\w*|enterprise|onderneming\w*|entreprise|company|bedrijf|bedrijven|vat|btw|bankrupt\w*|faillissement\w*|employment|werkgelegenheid|arbeid|labour|prijzen|prices|inflation|income|inkomen)\b/],
  ["environment","Environment & climate",/\b(environment|milieu|environnement|climat\w*|klimaat|air quality|luchtkwaliteit|biodivers\w*|natura ?2000|natuur|nature|emissi\w*|afval|waste)\b/],
  ["agriculture","Agriculture & food",/\b(agricultur\w*|landbouw|agricole|farm|food|voeding|favv|afsca|visserij|fisher\w*)\b/],
  ["education","Education & culture",/\b(education|onderwijs|school\w*|enseignement|student\w*|museum|cultuur|culture|erfgoed|heritage|library|bibliotheek)\b/],
  ["government","Government & public sector",/\b(election\w*|verkiezing\w*|[eé]lection\w*|parliament|parlement|budget|begroting|overheid|public procurement|overheidsopdracht)\b/],
  ["places","Maps & places",/\b(address\w*|adres\w*|cadast\w*|kadaster|parcel|perceel|boundar\w*|grenzen|municipalit\w*|gemeente\w*|statistical sector|statistische sector|grb|urbis|gis|geo\w*)\b/]
];
const EU_TO_TOPIC={AGRI:"agriculture",ECON:"economy",EDUC:"education",ENER:"energy",ENVI:"environment",HEAL:"health",JUST:"government",SOCI:"population",TRAN:"transport",INTR:"government"};
// Publishers whose whole catalogue sits in one topic.
const PUBLISHER_TOPIC=[[/databank ondergrond|\bdov\b/,"geology"],[/sciensano|departement zorg|fps health/,"health"],[/infrabel|sncb|nmbs|de lijn|\bstib\b|\btec\b|transportdata|mobility/,"transport"],[/\belia\b|fluvius/,"energy"]];
const SPECIFIC_EU=["ENER","TRAN","HEAL","AGRI","EDUC","ENVI","SOCI","ECON","JUST","INTR"];
// Order of trust: publisher-declared EU theme → title keywords (title only, never the publisher name) → publisher default → weak EU codes.
export function topicOf(item){
  const title=norm([item.title,(item.themes||[]).filter(t=>!/^[A-Z]{4}$/.test(t)).join(" ")].join(" ")),provider=norm(item.provider);
  const eu=SPECIFIC_EU.filter(c=>(item.euThemes||[]).includes(c));
  const byTitle=TOPIC_RULES.find(([,,re])=>re.test(title))?.[0];
  if(eu.length===1)return EU_TO_TOPIC[eu[0]];
  if(eu.length>1){const topics=eu.map(c=>EU_TO_TOPIC[c]);return topics.includes(byTitle)?byTitle:topics[0]}
  if(byTitle)return byTitle;
  const pub=PUBLISHER_TOPIC.find(([re])=>re.test(provider));if(pub)return pub[1];
  const weak=item.euThemes||[];
  return weak.includes("REGI")?"places":weak.includes("GOVE")?"government":"other";
}
