const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const text=a=>norm([a?.title,a?.description,a?.grain,a?.space,a?.time,a?.kind,a?.shape,...(a?.themes||[]),...(a?.schema||[]).flat()].filter(Boolean).join(" "));
const IDENTIFIERS=[
  ["enterprise-number","Enterprise number / KBO-BCE",/enterprise.?number|ondernemingsnummer|numero d.?entreprise|\bkbo\b|\bbce\b/],
  ["establishment-unit-number","Establishment unit",/establishment.?unit|vestigingseenheid|unite d.?etablissement/],
  ["nace-bel","NACE-BEL",/\bnace(?:-?bel)?\b/],
  ["nis-municipality","NIS municipality",/\bnis.?code\b|\bniscode\b|\brefnis\b|\bcd_refnis\b|code nis/],
  ["statistical-sector","Statistical sector",/statistical sector|statistische sector|secteur statistique/],
  ["postal-code","Postal code",/\bpostcode\b|postal code|code postal/],
  ["capakey","CaPaKey / cadastral parcel",/\bcapakey\b|cadastral parcel|kadastraal perceel|parcelle cadastrale/],
  ["basis-address-id","Canonical address ID",/\badresid\b|address.?id|adresse.?id|basisregister.*address|adressenregister/],
  ["gtfs-feed-id","GTFS feed ID",/\bstop_id\b|\btrip_id\b|\broute_id\b|\bgtfs\b/],
  ["waterinfo-station-id","Station / series ID",/\bstation_id\b|\bstation_no\b|\bts_id\b/],
  ["infrabel-ptcar","Infrabel PTCAR",/\bptcar\b/],
  ["education-institution-id","Education institution ID",/institution.?id|instellingsnummer|etablissement.*id/],
  ["nbb-deposit-reference","NBB deposit reference",/deposit reference|neerleggingsnummer|reference de depot/]
];
const SYNONYMS=[
  ["municipality","gemeente","commune","municipal","gemeentelijk"],
  ["enterprise","company","business","onderneming","entreprise","kbo","bce"],
  ["address","adres","adresse"],
  ["population","bevolking","inwoners","habitants"],
  ["energy","energie","énergie","electricity","elektriciteit","électricité"],
  ["environment","milieu","environnement","climate","klimaat","climat","pollution","vervuiling"],
  ["unemployment","werkloosheid","chomage","chômage"],
  ["income","inkomen","revenu"],
  ["parcel","perceel","parcelle","cadastre","kadaster"],
  ["agriculture","landbouw","agricole","crop","gewas","culture"],
  ["mobility","mobiliteit","mobilite","mobilité","transport"],
  ["health","gezondheid","sante","santé"],
  ["school","onderwijs","education","éducation","ecole","école"],
  ["election","verkiezing","election","élection"],
  ["road","weg","route","street","straat","rue"],
  ["postcode","postal","postnummer","code postal"],
  ["company number","enterprise number","ondernemingsnummer","numero d'entreprise","numéro d'entreprise"]
];

const NORM_SYNONYMS=SYNONYMS.map(group=>group.map(norm));  // normalised once: search runs this per dataset per render
export function expandSearchTerms(query){
  const base=norm(query).trim().split(/\s+/).filter(Boolean),out=new Set(base);
  for(const ng of NORM_SYNONYMS){
    if(ng.some(x=>base.some(t=>x.includes(t)||t.includes(x))))ng.flatMap(x=>x.split(/\s+/)).forEach(x=>out.add(x));
  }
  return [...out];
}
export function expandSearchHay(value){
  const base=norm(value),extra=[];
  for(const ng of NORM_SYNONYMS){if(ng.some(x=>base.includes(x)))extra.push(...ng)}
  return base+" "+extra.join(" ");
}
const cleanTitle=title=>String(title||"")
  .replace(/\b(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}\b/g," ")
  .replace(/\b(?:19|20)\d{2}\b/g," ")
  .replace(/\b(?:csv|json|api|xlsx?|download|export|dataset|data set|parquet|geojson)\b/gi," ")
  .replace(/[()[\]{}]/g," ").replace(/\s+/g," ").trim();
export function familyTitle(title){const x=cleanTitle(title);return x.length>=8?x:String(title||"")}
export function familyKey(asset,publisher=""){
  if(asset?.seriesId)return"series|"+asset.seriesId;   // harvest-time collection (numbered periodicals, model layers)
  const base=norm(familyTitle(asset?.title)).replace(/[^a-z0-9]+/g," ").trim();
  const pub=norm(publisher||asset?.provider||asset?.product).replace(/[^a-z0-9]+/g," ").trim();
  if(base.length<8)return pub+"|"+norm(asset?.title);
  return pub+"|"+base;
}
const ID_HINT_CACHE=new WeakMap(),BRIEF_CACHE=new WeakMap();
export function inferIdentifierHints(asset){
  if(asset&&typeof asset==="object"&&ID_HINT_CACHE.has(asset))return ID_HINT_CACHE.get(asset);
  const hay=text(asset),fields=(asset?.schema||[]).map(x=>norm(x?.[0])).filter(Boolean),hits=[];
  for(const [id,label,re] of IDENTIFIERS){
    const fieldHit=fields.find(f=>re.test(f)),allHit=re.test(hay);
    if(fieldHit||allHit)hits.push({id,label,confidence:fieldHit?"field-name":"text",evidence:fieldHit||"title / metadata"});
  }
  if(asset&&typeof asset==="object")ID_HINT_CACHE.set(asset,hits);
  return hits;
}
function yearsFor(a){
  const ys=[...new Set(([a?.title,a?.description,a?.time,a?.grain].filter(Boolean).join(" ").match(/\b(?:19|20)\d{2}\b/g)||[]).map(Number))].sort((a,b)=>a-b);
  return ys;
}
function geographyFor(a){
  const h=text(a);
  if(/statistical sector|statistische sector|secteur statistique/.test(h))return"statistical sector";
  if(/municipality|gemeente|commune|refnis|nis.?code/.test(h))return"municipality";
  if(/postcode|postal code|code postal/.test(h))return"postal code";
  if(/flanders|vlaanderen|flandre/.test(h))return"Flanders";
  if(/wallonia|wallonie|wallonie/.test(h))return"Wallonia";
  if(/brussels|bruxelles|brussel/.test(h))return"Brussels";
  if(/belgium|belgie|belgique/.test(h))return"Belgium";
  if(/province/.test(h))return"province";
  return a?.space&&!/see publisher|published spatial/i.test(a.space)?a.space:"not clearly stated";
}
function grainFor(a,hints){
  const g=String(a?.grain||"").trim();
  if(g&&!/semantic grain|not manually audited|publisher-defined|catalogue/i.test(g))return g;
  const ids=new Set(hints.map(x=>x.id)),dims=[];
  if(ids.has("enterprise-number"))dims.push("enterprise");
  if(ids.has("establishment-unit-number"))dims.push("establishment");
  if(ids.has("nis-municipality"))dims.push("municipality");
  if(ids.has("statistical-sector"))dims.push("statistical sector");
  if(ids.has("postal-code"))dims.push("postal code");
  if(ids.has("capakey"))dims.push("parcel");
  if(ids.has("nace-bel"))dims.push("NACE activity");
  const h=text(a);
  if(/\byear\b|annual|jaar|annee|année/.test(h))dims.push("year");
  if(/\bmonth\b|monthly|maand|mois/.test(h))dims.push("month");
  return dims.length?[...new Set(dims)].join(" × "):"record (grain not verified)";
}
export function inferDatasetBrief(asset){
  if(asset&&typeof asset==="object"&&BRIEF_CACHE.has(asset))return BRIEF_CACHE.get(asset);
  const hints=inferIdentifierHints(asset),years=yearsFor(asset),geography=geographyFor(asset),grain=grainFor(asset,hints);
  const time=years.length?(years.length===1?String(years[0]):years[0]+"–"+years.at(-1)):"not clearly stated";
  const uses=[];
  if(geography!=="not clearly stated")uses.push("geographic comparison");
  if(years.length>1)uses.push("time trends");
  if(hints.length)uses.push("linking on "+hints.slice(0,2).map(x=>x.label).join(" / "));
  if(/geometry|geojson|wfs|polygon|coordinates|latitude|longitude/.test(text(asset)))uses.push("mapping");
  const limitations=[];
  if(!years.length)limitations.push("time coverage is not explicit");
  if(grain.includes("not verified"))limitations.push("row grain is not verified");
  if(!hints.length)limitations.push("no recognised Belgian identifier detected");
  const result={
    grain,time,geography,identifiers:hints,
    oneRow:(asset?.depth==="modelled"?"One row represents ":"Likely one row represents ")+grain+".",
    useFor:uses.length?uses.join(" · "):"inspect the publisher's subject data",
    limitations:limitations.length?limitations.join(" · "):"still validate definitions and version compatibility before production use"
  };
  if(asset&&typeof asset==="object")BRIEF_CACHE.set(asset,result);
  return result;
}
export function joinHint(left,right){
  if(!left||!right)return{kind:"none",label:"Choose two datasets",score:0,shared:[]};
  const a=inferIdentifierHints(left),b=inferIdentifierHints(right),bIds=new Set(b.map(x=>x.id)),shared=a.filter(x=>bIds.has(x.id));
  const aBrief=inferDatasetBrief(left),bBrief=inferDatasetBrief(right);
  if(shared.length){
    return{kind:"identifier",label:"Shared identifier candidate",score:90,shared,detail:"Both datasets expose signals for "+shared.map(x=>x.label).join(", ")+". Validate namespace, uniqueness and time/version before joining."};
  }
  if(aBrief.geography===bBrief.geography&&aBrief.geography!=="not clearly stated"){
    return{kind:"geography",label:"Shared geography candidate",score:55,shared:[],detail:"Both appear to use "+aBrief.geography+" geography, but no canonical shared identifier was detected. Prefer an explicit code field over name matching."};
  }
  return{kind:"none",label:"No obvious safe join key",score:0,shared:[],detail:"No recognised shared identifier or clearly matching geography was detected from catalogue metadata."};
}
