// Reader-facing vocabulary shared by the harvest (scripts/curate.mjs) and the browser UI, so labels cannot drift apart.
export const TOPIC_LABELS={
  geology:"Geology & subsurface",water:"Water & sea",energy:"Energy",transport:"Transport & mobility",health:"Health",
  population:"Population & society",economy:"Economy & business",environment:"Environment & climate",agriculture:"Agriculture & food",
  education:"Education & culture",government:"Government & public sector",places:"Maps & places",other:"Other"
};
export const KIND_LABELS={dataset:"Dataset","map-service":"Map / web service","data-service":"Data service (API / event stream)",publication:"Publication (documents)",research:"Research supplement","metadata-only":"Metadata only"};

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
const ENVI_KEEP=/\b(emissi\w*|uitstoot|broeikas\w*|greenhouse|climat\w*|klimaat\w*|pollution|vervuiling|verontreiniging)\b/;
const ENERGY_STRONG=/\b(energi\w*|electric\w*|elektric\w*|electricite|photovolta\w*|fotovolta\w*|zonnepanel\w*|warmtekaart|fluvius|elia)\b/;
/** For a record whose only specific EU theme is ENVI: the energy, water, geology or agriculture topic its title clearly names, else null.
 *  Titles about emissions or climate stay environment ("Greenhouse gas emissions", "Wind speed - 2085"). Exported so the index builder
 *  can refine topics stored by an earlier harvest. */
export function enviOverride(item){
  const eu=SPECIFIC_EU.filter(c=>(item.euThemes||[]).includes(c));
  if(eu.length!==1||eu[0]!=="ENVI")return null;
  const t=norm(item.title);if(ENVI_KEEP.test(t))return null;
  if(ENERGY_STRONG.test(t))return"energy";
  const own=TOPIC_RULES.find(([,,re])=>re.test(t))?.[0];
  return["water","geology","agriculture"].includes(own)?own:null;
}
const SPECIFIC_EU=["ENER","TRAN","HEAL","AGRI","EDUC","ENVI","SOCI","ECON","JUST","INTR"];
// High-precision signals (title and keywords, accents removed), first match wins: specific water infrastructure before species and
// waste ("stedelijk afvalwater" is water), species before the sea they live in, school population before population.
const STRONG_RULES=[
  ["water",/\b(afvalwater\w*|waste ?water|eaux usees|uwwtd|epuration|zuiveringsinstallatie\w*|rwzi|waterlichamen|grondwaterlichamen|oppervlaktewaterlichamen|water bodies|masses d.?eau|drinkwater\w*|drinking water|eau potable|waterlopen|cours d.?eau|watercourses?|overstroming\w*|flood\w*|inondation\w*)\b/],
  ["agriculture",/\b(animal health|dierengezondheid|sante animale|veterinar\w*|landbouwgebruikspercelen|parcelles agricoles)\b/],
  ["environment",/\b(species|soorten|especes?|invasi\w*|exot\w*|biodivers\w*|fauna|flora|plankton|zooplankton|benthos|macrobenthos|hyperbenthos|vogels?|birds?|oiseaux|vlinders?|butterfl\w*|papillons?|zero dechet|zero waste|afval\w*|dechets?|points de collecte|inzamel\w*|luchtkwaliteit|air quality|qualite de l.?air|uitstoot|emissions?|canopee|arbres|bomen)\b/],
  ["geology",/\b(geolog\w*|hydrogeolog\w*|grondmechani\w*|bodemmechani\w*|ondergrond|subsurface|sous-sol|boringen|forages|sonderingen|aquifer\w*|hcov)\b/],
  ["energy",/\b(energi\w*|electric\w*|elektric\w*|photovolta\w*|fotovolta\w*|zonnepanel\w*|warmtekaart|warmtekracht\w*|gasmeter\w*|compteurs? (communicants|gaz)|fluvius|elia|ores)\b/],
  ["transport",/\b(wegknoop|wegknopen|wegsegment\w*|wegenregister|fietstel\w*|fietsparking\w*|parkings? velos?|velos? disponibles|hydrogen refuel\w*|waterstoftankstation\w*|laadpal\w*|bornes? de recharge|charging (points?|stations?)|filaire des voiries|wegennet|road network|gipod|mobiliteitshinder|mobility hindrance|vrachtroute\w*|freight routes?|wandelnetwerk\w*|fietsnetwerk\w*|knooppuntennetwerk\w*)\b/],
  ["population",/\b(census|volkstelling|recensement)\b/],
  ["education",/\b(population scolaire|schoolbevolking|leerlingen|eleves|onderwijs\w*|enseignement|scholen|sport\w*|verenigingen|bibliothe\w*|kinderopvang|vakantieaanbod|jeugdwerk|rencontres artistiques|festival\w*|evenementen|feesten)\b/],
  ["places",/\b(limites? (administratives?|de la commune)|administrative (units|boundar\w*)|grenzen|landgebruik|land use|occupation du sol|ruimtelijk\w*|ruimtebeslag|stedenbouw\w*|urbanisme|landinrichting|gewestplan|plan de secteur|place names|noms de lieux|toponym\w*|orthofoto\w*|orthophoto\w*|luchtfoto\w*|aerial (photo\w*|imagery)|in 3d|3d model\w*)\b/],
  ["government",/\b(marches? publics?|overheidsopdracht\w*|public (procurements?|contracts)|bourgmestres?|burgemeesters?|gemeenteraad|conseil communal|comptes? des (communes|provinces|cpas)|finances? (locales|publiques)|begroting\w*|eguichet|e-guichet|iso 9001|indicateurs? qualite|batiments communaux|administration et services publics|service public, administration|stadsbestuur|aanwerving\w*|recrutements?|infopagina\w*)\b/],
  ["economy",/\b(horeca|cafes|restaurants|toeris\w*|touris\w*|jobbonus|sante commerciale|bedrijventerrein\w*|zones? d.?activite\w*)\b/]
];
// Order of trust: publisher-declared EU theme → title keywords (title only, never the publisher name) → publisher default → weak EU codes.
export function topicOf(item){
  const title=norm([item.title,(item.themes||[]).filter(t=>!/^[A-Z]{4}$/.test(t)).join(" ")].join(" ")),provider=norm(item.provider);
  const eu=SPECIFIC_EU.filter(c=>(item.euThemes||[]).includes(c));
  const byTitle=TOPIC_RULES.find(([,,re])=>re.test(title))?.[0];
  // Unambiguous title or keyword signals outrank the publisher's EU theme, which is often a portal-wide default (zero-waste shops and
  // butterfly counts tagged AGRI, geotechnical maps tagged ENVI). Measured on eval-relevance/topics.json (scripts/eval-topics.mjs).
  const strong=STRONG_RULES.find(([,re])=>re.test(title))?.[0];if(strong)return strong;
  // ENVI is the catch-all many publishers tag on energy, water and soil records: a title that clearly names one of those wins over it
  // ("Renewable energies in the Brussels-Capital Region" is energy, not environment).
  const refined=enviOverride(item);if(refined)return refined;
  if(eu.length===1)return EU_TO_TOPIC[eu[0]];
  if(eu.length>1){const topics=eu.map(c=>EU_TO_TOPIC[c]);return topics.includes(byTitle)?byTitle:topics[0]}
  // a single-domain publisher (Elia, DOV, Sciensano...) is a better signal than a weak title word ("imbalance prices" is energy)
  const pub=PUBLISHER_TOPIC.find(([re])=>re.test(provider));if(pub)return pub[1];
  if(byTitle)return byTitle;
  const weak=item.euThemes||[];
  return weak.includes("REGI")?"places":weak.includes("GOVE")?"government":"other";
}
