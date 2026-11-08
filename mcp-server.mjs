// Read-only MCP (Model Context Protocol) server for the Belgium Data Desk catalogue, served by the same Worker at POST /mcp.
// Stateless Streamable-HTTP JSON-RPC. It answers only from pre-built static shards (public/mcp/**), never fetches a user-supplied URL,
// and bounds asset reads and parsed JSON per request. The shard format is produced by scripts/build-mcp-index.mjs.

import { expandWord } from "./public/dataset-synonyms-v1.mjs";
import { AUTHORITIES, authoritiesFor } from "./public/dataset-authority-v1.mjs";
import { detectDelimiter, encodingFor, parseDelimitedText } from "./scripts/tabular-profile.mjs";
import { MODEL_DEPTH, RADIUS, getSubsurfaceRecord, makeDovClient, subsurfaceAtLocation } from "./dov.mjs";
import { SEARCH_LIMIT, SEARCH_RADIUS, TYPES as SEARCH_TYPES, searchSubsurface } from "./dov-search.mjs";
import { belgianStatistics } from "./statbel.mjs";
import { airQuality } from "./air.mjs";
import { floodRisk } from "./flood.mjs";

export const MCP_VERSION="0.5.0";
const SUPPORTED_PROTOCOLS=["2025-06-18","2025-03-26","2024-11-05"];
export const DOC_CHUNK=100,DETAIL_CHUNK=50;
const MAX_LIMIT=20,MAX_QUERY_TOKENS=5,MAX_ASSET_READS=30,MAX_GROUP_WORDS=12,MAX_DOC_CHUNKS=8,CANDIDATE_POOL=60;
// Ranking weights, tuned against eval-relevance/queries.json (scripts/eval-mcp-relevance.mjs).
const RELATED_WEIGHT=0.6,CURATED_BONUS=30,LOCAL_PENALTY=20,COVERAGE_WEIGHT=60,MAX_IDF=5,TITLE_FACTOR=30,BODY_FACTOR=10;
const MAX_PREVIEW_ROWS=20,PREVIEW_BYTES=64*1024,MAX_PREVIEW_COLUMNS=40,MAX_CELL_CHARS=160,MAX_PREVIEW_TEXT=14000;
// Query words (tokenized: lower case, no accents) that ask about the subsurface: search then points to the live DOV tool.
// A search whose words ask for figures or conditions, not files, is pointed at the live tool that answers it (first match wins).
const LIVE_TOOLS=[
  [/^(overstroming|overstromingen|overstromingsgevoelig|flood|floods|flooding|inondation|inondations|wateroverlast|informatieplicht)/,"flood_risk","For whether a place in Flanders is flood-prone, flood_risk reads VMM's official maps (classes A-D) for the address."],
  [/^(luchtkwaliteit|lucht|air|fijnstof|pm10|pm25|no2|ozon|ozone|belaqi|smog|pollution|vervuiling)/,"air_quality","For air quality at a place now, forecast or as an annual mean, air_quality reads IRCEL-CELINE live for the address."],
  [/^(bevolking|inwoners|population|habitants|inhabitants|inkomen|income|revenus|inflatie|inflation|cpi|gezondheidsindex|consumptieprijs|werkloosheid|unemployment|chomage|tewerkstelling|employment)/,"belgian_statistics","For the figures themselves (population, income, inflation, unemployment) by municipality, province or region, belgian_statistics answers with Statbel's official numbers."],
  [/^(boring|boringen|boorgat|borehole|boreholes|forage|forages|sondering|sonderingen|cpt|grondwater|groundwater|nappe|phreatic|freatisch|aquifer|aquifers|bodem|bodemkaart|soil|soils|geolog|geology|geologie|geologique|ondergrond|subsurface|stratigrafie|stratigraphy|lithologie|lithology|dov|geothermie|geothermal)/,"subsurface_at_location","For soil, geology, boreholes or groundwater at a specific place in Flanders, this tool reads Databank Ondergrond Vlaanderen live instead of listing its map layers."]
];
const LOCAL_PUBLISHER=/\b(city of|stad|ville de|gemeente|commune|province|provincie)\b/i;

const STOP=new Set(["the","de","het","een","van","voor","en","et","du","des","le","la","les","of","and","for","in","op","au","aux","par","sur","per","by","a","an","to","with","dans","om","te","is","are"]);
const norm=s=>String(s??"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase();
export function tokenize(text,{cap=40}={}){
  const out=[];
  for(const w of norm(text).split(/[^a-z0-9]+/)){
    if(w.length<2||STOP.has(w)||out.includes(w))continue;
    out.push(w);if(out.length>=cap)break;
  }
  return out;
}
/** Tokens of 7+ characters are also indexed by a 6-character prefix so "bevolking" finds "bevolkingsaantal". */
export const prefixKey=t=>t.length>=7?"~"+t.slice(0,6):null;
export const tokenShard=token=>{const k=token.replace(/^~/,"").slice(0,2).replace(/[^a-z0-9]/g,"_");return k.length<2?k+"_":k};
export function idShard(id){
  let h=0x811c9dc5;for(let i=0;i<id.length;i++){h^=id.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}
  return(h&0xff).toString(16).padStart(2,"0");
}

const jsonResponse=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*","cache-control":"no-store",...extra}});
const rpcError=(id,code,message)=>jsonResponse({jsonrpc:"2.0",id:id??null,error:{code,message}});

// Per-request budget: every asset read goes through here so no query can exceed the subrequest limit.
function makeReader(env,origin){
  let reads=0;const cache=new Map();
  return{origin,
    get reads(){return reads},
    async json(pathname){
      if(cache.has(pathname))return cache.get(pathname);
      const hit=sharedGet(env?.ASSETS,pathname);
      if(hit!==undefined){cache.set(pathname,hit);return hit}
      if(reads>=MAX_ASSET_READS)return null;
      reads++;
      let v=null;
      try{const r=await env.ASSETS.fetch(new Request(origin+pathname));if(r.ok){const text=await r.text();v=deepFreeze(JSON.parse(text));sharedSet(env?.ASSETS,pathname,v,text.length)}}catch{v=null}
      cache.set(pathname,v);return v;
    }
  };
}
// Parsed shards are immutable for the life of a deployment, so an isolate keeps the most recently used ones: repeat searches then skip
// both the asset read and the JSON parse. Keyed per ASSETS binding (tests use several). Bounded by the JSON size of what it holds
// (12 MB of JSON is roughly 30-50 MB of heap; an isolate has 128 MB), least recently used first out; failed reads are not kept.
const SHARED_MAX_BYTES=12*1024*1024,sharedByAssets=new WeakMap();
function sharedGet(assets,key){
  const c=assets&&sharedByAssets.get(assets),e=c?.map.get(key);
  if(!e)return undefined;
  c.map.delete(key);c.map.set(key,e);return e.v;
}
function sharedSet(assets,key,v,bytes){
  if(!assets||typeof assets!=="object"||bytes>SHARED_MAX_BYTES/8)return;
  let c=sharedByAssets.get(assets);if(!c)sharedByAssets.set(assets,c={map:new Map(),bytes:0});
  const old=c.map.get(key);if(old){c.bytes-=old.bytes;c.map.delete(key)}
  c.map.set(key,{v,bytes});c.bytes+=bytes;
  for(const [k,e] of c.map){if(c.bytes<=SHARED_MAX_BYTES)break;c.map.delete(k);c.bytes-=e.bytes}
}
// Frozen so no tool can change a cached shard for later requests (a write would throw: modules run in strict mode).
function deepFreeze(v){if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.freeze(v);for(const k in v)deepFreeze(v[k])}return v}

const SEARCH_SCHEMA={type:"object",properties:{
  query:{type:"string",description:"Words in Dutch, French or English, e.g. 'population by municipality' or 'bevolking gemeente'."},
  scope:{type:"string",enum:["datasets","maps","publications","research","metadata","all"],description:"Kind of record. Default 'datasets'."},
  topic:{type:"string",description:"Optional topic id: geology, water, energy, transport, health, population, economy, environment, agriculture, education, government, places, other."},
  open_licence_only:{type:"boolean",description:"Only records whose licence permits reuse (open or share-alike)."},
  limit:{type:"integer",minimum:1,maximum:MAX_LIMIT,description:"Number of results, default 10."}
},required:["query"]};
const TOOLS=[
  {
    name:"search_datasets",title:"Search Belgian open datasets",
    description:"Search Belgian open data (about 21,700 records from federal, regional and local publishers: hand-reviewed national registers, data.gov.be and directly harvested portals) in Dutch, French or English. For common needs such as population, the enterprise register (KBO/BCE), air quality, unemployment or train punctuality, the official reference source is listed first, marked authoritative_source, with a guidance block saying who publishes it and the usual pitfalls. Scope 'datasets' (default) means data files and APIs; map layers, PDF publications, research supplements and metadata-only records are separate scopes. Results are catalogue metadata and link-check evidence, not statements about data correctness.",
    inputSchema:SEARCH_SCHEMA,annotations:{title:"Search Belgian open datasets",readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },
  {
    name:"get_dataset",title:"Get one dataset record",
    description:"Full catalogue record for one dataset id from search_datasets: publisher, licence and what it allows, update cycle, contact, description, file links, publisher-declared columns, link-check evidence, and whether preview_dataset can read the file.",
    inputSchema:{type:"object",properties:{id:{type:"string",description:"Dataset id as returned by search_datasets."}},required:["id"]},annotations:{title:"Get one dataset record",readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },
  {
    name:"preview_dataset",title:"Preview the rows of a dataset file",
    description:"Read the first rows of a dataset's CSV/TSV file directly from the publisher and return the column names, inferred column types, the delimiter and encoding, and up to 20 sample rows as published. Works for datasets whose get_dataset record shows preview_available: true. Reads at most the first 64 KiB of the file, so it shows structure and example values, not totals over the whole file.",
    inputSchema:{type:"object",properties:{
      id:{type:"string",description:"Dataset id as returned by search_datasets or get_dataset."},
      rows:{type:"integer",minimum:1,maximum:MAX_PREVIEW_ROWS,description:"Number of sample rows, default 10."}
    },required:["id"]},annotations:{title:"Preview the rows of a dataset file",readOnlyHint:true,destructiveHint:false,openWorldHint:true}
  },
  {
    name:"catalogue_overview",title:"Catalogue overview",
    description:"Counts of the catalogue by scope and topic, the date it was built, and when file links were last checked: what is available and how fresh the evidence is.",
    inputSchema:{type:"object",properties:{}},annotations:{title:"Catalogue overview",readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },
  {
    name:"subsurface_at_location",title:"Soil, geology and groundwater at a place in Flanders",
    description:"What is under a location in Flanders, read live from Databank Ondergrond Vlaanderen (DOV), the Flemish Government's subsurface database: the soil-map unit, the Tertiary and Quaternary geological map units and the groundwater bodies at the point, whether it lies in a drinking-water protection zone, the modelled column of geological and hydrogeological (aquifer) units with depths from DOV's 3D models (an answer even where no borehole exists), the boreholes, cone penetration tests (CPT) and groundwater monitoring wells within radius_m (counts plus the nearest and deepest, with ids), groundwater abstraction permits and described soil profiles within at least 1 km (licensed volume per aquifer; names of private persons withheld), and the current shallow groundwater status at the nearest status well. Starts with key_facts: the answer in a few sentences. Give an address in Flanders, or latitude/longitude, or Lambert 72 x/y. Use get_subsurface_record with a returned id for layer-by-layer borehole logs, CPT profiles or groundwater levels and quality. Map units and the model column are map- and model-scale information, not a site investigation.",
    inputSchema:{type:"object",properties:{
      address:{type:"string",description:"Address in Flanders, e.g. 'Grote Markt 1, 3000 Leuven'. Looked up in the Flemish address register."},
      latitude:{type:"number",description:"WGS84 latitude, e.g. 51.0453 (use with longitude instead of address)."},
      longitude:{type:"number",description:"WGS84 longitude, e.g. 3.7275."},
      x_lambert72:{type:"number",description:"Belgian Lambert 72 (EPSG:31370) x in metres, as an alternative to latitude/longitude."},
      y_lambert72:{type:"number",description:"Belgian Lambert 72 (EPSG:31370) y in metres."},
      radius_m:{type:"integer",minimum:RADIUS.min,maximum:RADIUS.max,description:"Search radius for boreholes, CPTs and wells in metres, default "+RADIUS.default+"."},
      max_depth_m:{type:"integer",minimum:MODEL_DEPTH.min,maximum:MODEL_DEPTH.max,description:"Deepest unit start listed in the modelled column, default "+MODEL_DEPTH.default+" m; deeper units are counted. Raise it for deep geothermal or deep aquifer questions."}
    }},annotations:{title:"Soil, geology and groundwater at a place in Flanders",readOnlyHint:true,destructiveHint:false,openWorldHint:true}
  },
  {
    name:"get_subsurface_record",title:"Borehole, CPT or groundwater-well details from DOV",
    description:"Details of one DOV record by id from subsurface_at_location: for a borehole ('boring/…') its depth, purpose and layer-by-layer interpretations (formal stratigraphy with formation names, the logged lithological description, hydrogeological units) plus ids of further interpretations; for a groundwater screen ('filter/…') the aquifer, screen depth, water levels (latest, lowest, highest, last 12 readings, yearly means) and groundwater quality (every result of the latest lab sample, and trends of nitrate, chloride, sulphate, ammonium, conductivity and pH); for a CPT ('sondering/…') cone resistance and sleeve friction per metre with the Robertson soil behaviour type; for a soil profile ('bodemlocatie/…') its classification, site (water table, drainage, land use, parent material) and per horizon the Munsell colour, texture, organic carbon, pH and lime; or one interpretation ('interpretatie/…'). Codes are decoded with DOV's published code lists; every answer starts with key_facts.",
    inputSchema:{type:"object",properties:{id:{type:"string",description:"Record id such as 'boring/2016-140688', 'filter/1978-006372', 'sondering/1984-065526', 'bodemlocatie/1964-007478' or 'interpretatie/1993-088861' (a DOV URL for the record also works)."}},required:["id"]},
    annotations:{title:"Borehole, CPT or groundwater-well details from DOV",readOnlyHint:true,destructiveHint:false,openWorldHint:true}
  },
  {
    name:"search_subsurface",title:"Find boreholes, wells, CPTs, soil profiles or groundwater permits in Flanders",
    description:"Find DOV records by area and attributes, e.g. the deepest boreholes in a municipality, geothermal boreholes since 2020, groundwater wells in the Brussel sand with quality data, electric CPTs near an address, soil profiles with lab data, or the largest groundwater abstraction permits in a municipality (with the licensed total per aquifer). Area: a municipality (official 2025 boundary; old pre-merger names work), or an address/coordinates with radius_m, or nothing for all of Flanders. Filtering and sorting run on DOV's server, so counts cover every matching record. Use get_subsurface_record with a result id for details.",
    inputSchema:{type:"object",properties:{
      record_type:{type:"string",enum:Object.keys(SEARCH_TYPES),description:"What to find."},
      municipality:{type:"string",description:"Municipality in Flanders, e.g. 'Leuven' or 'Merelbeke-Melle'."},
      address:{type:"string",description:"Address in Flanders, as an alternative to municipality (then radius_m applies)."},
      latitude:{type:"number"},longitude:{type:"number"},x_lambert72:{type:"number"},y_lambert72:{type:"number"},
      radius_m:{type:"integer",minimum:SEARCH_RADIUS.min,maximum:SEARCH_RADIUS.max,description:"Radius around the address or coordinates, default "+SEARCH_RADIUS.default+" m."},
      min_depth_m:{type:"number",description:"Minimum depth (borehole or CPT depth, well screen bottom, permitted well depth)."},
      max_depth_m:{type:"number",description:"Maximum depth, same fields."},
      date_from:{type:"string",description:"YYYY, YYYY-MM or YYYY-MM-DD: drilling/test date, last water-level date for wells, permit start, survey date."},
      date_to:{type:"string",description:"Same formats as date_from."},
      purpose:{type:"string",enum:["geological","geotechnical","groundwater_abstraction","dewatering","hydrogeological","geothermal","groundwater_monitoring","energy_exploration","contaminated_site_monitoring"],description:"Boreholes: why it was drilled."},
      with_stratigraphy:{type:"boolean",description:"Boreholes: only those with a formal, hydrogeological or Quaternary stratigraphy."},
      cpt_method:{type:"string",enum:["electric","mechanical"],description:"CPTs: electric CPTs also measure sleeve friction."},
      aquifer:{type:"string",description:"Wells and permits: HCOV code (A0620, or A06 for the whole system) or words from the unit name ('Brussel', 'Krijt')."},
      with_quality_data:{type:"boolean",description:"Wells: only screens with groundwater quality samples."},
      with_lab_data:{type:"boolean",description:"Soil profiles: only those with lab samples."},
      min_annual_m3:{type:"number",description:"Permits: minimum licensed annual volume in m³."},
      sort:{type:"string",enum:["nearest","deepest","newest","oldest","largest","most_described"],description:"Default: nearest with a location; otherwise deepest (boreholes, CPTs), newest (wells), largest (permits), most_described (soil profiles)."},
      limit:{type:"integer",minimum:1,maximum:SEARCH_LIMIT.max,description:"Results to list, default "+SEARCH_LIMIT.default+"."}
    },required:["record_type"]},
    annotations:{title:"Find boreholes, wells, CPTs, soil profiles or groundwater permits in Flanders",readOnlyHint:true,destructiveHint:false,openWorldHint:true}
  },
  {
    name:"belgian_statistics",title:"Official Belgian statistics: population, income, prices, labour market",
    description:"Answers with Statbel's official figures (not dataset links). Places: any of the 565 municipalities (2025 boundaries; Dutch, French or pre-merger names such as Melle work; NIS codes too), the provinces, the three regions or Belgium. topic 'profile' (default) gives population on 1 January (total, sex, age bands, non-Belgian nationality, change since 2019) and average net taxable income per inhabitant and per declaration (income years up to the latest published); a single municipality comes with its province, region and Belgium for comparison. rank_by ranks municipalities within a province, region or Belgium (e.g. highest income per inhabitant in Limburg, oldest population). topic 'prices' gives the latest CPI, inflation and (smoothed) health index read live from Statbel; topic 'labour' gives the latest quarterly employment, unemployment and activity rates for Belgium and the regions (Labour Force Survey). Each answer starts with key_facts and states reference dates, definitions and the Statbel citation (CC BY 4.0).",
    inputSchema:{type:"object",properties:{
      places:{type:"array",items:{type:"string"},maxItems:6,description:"Up to 6 places to compare, e.g. ['Leuven','Gent'], ['Limburg','Wallonia','Belgium'] or ['44088']. A bare 'Brussels' means the region; use 'City of Brussels' for the municipality."},
      topic:{type:"string",enum:["profile","population","income","prices","labour"],description:"Default 'profile' (population and income)."},
      year:{type:"integer",description:"Population year (1 January), 2019 to the latest; default latest."},
      income_year:{type:"integer",description:"Income year, default the latest published."},
      rank_by:{type:"string",enum:["population","population_growth_pct","share_65_plus_pct","share_0_17_pct","non_belgian_nationality_pct","income_per_inhabitant","income_per_declaration"],description:"Rank municipalities by this indicator instead of listing places."},
      within:{type:"string",description:"With rank_by: a province, region or 'Belgium' (default)."},
      order:{type:"string",enum:["highest","lowest"],description:"With rank_by; default highest."},
      limit:{type:"integer",minimum:1,maximum:25,description:"With rank_by; default 10."},
      with_context:{type:"boolean",description:"Default true: one municipality is shown with its province, region and Belgium."}
    }},annotations:{title:"Official Belgian statistics: population, income, prices, labour market",readOnlyHint:true,destructiveHint:false,openWorldHint:true}
  },
  {
    name:"air_quality",title:"Air quality at a place in Belgium (now, forecast, annual)",
    description:"Air quality at an address or point anywhere in Belgium from IRCEL-CELINE, read live: this hour's modelled NO2, PM2.5, PM10, ozone and black carbon for the 4 km cell, the last 24-hour PM means against the WHO 24-hour guidelines, the BelAQI forecast for today and the next three days (1 excellent to 10 horrible), annual means of the last complete year (street level in Flanders via ATMO-Street, 4 km background elsewhere) compared with the WHO 2021 guidelines and the current and 2030 EU limit values, and the nearest measuring stations that are reporting now (out-of-service stations are skipped and named). Includes the municipality (NIS code) with its population and income. Starts with key_facts; cite IRCEL-CELINE (CC BY 4.0).",
    inputSchema:{type:"object",properties:{
      address:{type:"string",description:"Address in Belgium, e.g. 'Grote Markt 1, 3000 Leuven' or 'Place Saint-Lambert 1, 4000 Liège'."},
      latitude:{type:"number"},longitude:{type:"number"},x_lambert72:{type:"number"},y_lambert72:{type:"number"}
    }},annotations:{title:"Air quality at a place in Belgium (now, forecast, annual)",readOnlyHint:true,destructiveHint:false,openWorldHint:true}
  },
  {
    name:"flood_risk",title:"Flood-prone classes at a place in Flanders (official VMM maps)",
    description:"Whether an address or point in Flanders is flood-prone on the official VMM maps of flood-prone areas from rivers (fluvial), heavy rain (pluvial) and the sea, each as class A (no flooding modelled), B (small chance under climate change), C (small chance) or D (medium chance). These maps underlie the flood information required when property in Flanders is sold or let and the water test for permits. Includes the municipality (NIS code) with its population and income. Flanders only. Starts with key_facts; describes the location, not a building's floor level or defences.",
    inputSchema:{type:"object",properties:{
      address:{type:"string",description:"Address in Flanders, e.g. 'Groenplaats 1, 2000 Antwerpen'."},
      latitude:{type:"number"},longitude:{type:"number"},x_lambert72:{type:"number"},y_lambert72:{type:"number"}
    }},annotations:{title:"Flood-prone classes at a place in Flanders (official VMM maps)",readOnlyHint:true,destructiveHint:false,openWorldHint:true}
  },
  // Compatibility with ChatGPT deep research / company knowledge, which expect exactly these two tools.
  {
    name:"search",title:"Search (deep-research compatible)",
    description:"Search Belgian open-data records. Returns result ids, titles and landing-page URLs; use fetch with an id for the full record.",
    inputSchema:{type:"object",properties:{query:{type:"string",description:"Search query."}},required:["query"]},annotations:{title:"Search",readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },
  {
    name:"fetch",title:"Fetch (deep-research compatible)",
    description:"Fetch the full catalogue record for an id returned by search.",
    inputSchema:{type:"object",properties:{id:{type:"string",description:"Record id from search."}},required:["id"]},annotations:{title:"Fetch",readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  }
];

const TRUST_NOTE="Evidence, not correctness: tier 'ready' means a file link answered with the declared format when checked (see link_check); topic is auto-assigned; SQL analysis runs in the visitor's browser, not here. Relay paths serve CSV/TSV up to 8 MiB.";
const SCOPE_OF_KIND={"map-service":"maps",publication:"publications",research:"research","metadata-only":"metadata"};
const isOpen=doc=>doc.lf==="open"||doc.lf==="open-sharealike";
const summary=d=>({id:d.id,title:d.t,publisher:d.p,kind:d.k||"dataset",topic:d.tp,formats:d.f,licence:d.l||null,licence_family:d.lf||"unknown",access_tier:d.tier||null,updated:d.u||null,hand_reviewed:!!d.c,landing_page:d.w||null,snippet:d.s||""});

async function postings(reader,token,shards){
  const shard=tokenShard(token);
  if(!shards.has(shard))shards.set(shard,await reader.json("/mcp/t/"+shard+".json")||{});
  return shards.get(shard)[token]||[];
}

// Members of one numbered series (e.g. 1,600 near-identical map layers) collapse to the best-scoring member plus a count.
function collapseCollections(scored){
  const out=[],seen=new Map();
  for(const x of scored){
    if(x.d.sid&&seen.has(x.d.sid)){seen.get(x.d.sid).more_in_collection=(seen.get(x.d.sid).more_in_collection||0)+1;continue}
    const s=summary(x.d);if(x.d.sid)seen.set(x.d.sid,s);out.push(s);
  }
  return out;
}

export async function searchDatasets(reader,args){
  const q=String(args?.query||"").slice(0,200),scope=["datasets","maps","publications","research","metadata","all"].includes(args?.scope)?args.scope:"datasets";
  const limit=Math.min(MAX_LIMIT,Math.max(1,Number(args?.limit)||10)),tokens=tokenize(q,{cap:MAX_QUERY_TOKENS});
  if(!tokens.length)return{error:"Query has no searchable words."};
  const manifest=await reader.json("/mcp/manifest.json");
  if(!manifest)return{error:"Index not available."};
  const range=scope==="all"?null:manifest.ranges?.[scope];
  const inRange=i=>!range||(i>=range[0]&&i<range[1]);
  // Each query word stands for a concept: its Dutch/French/English equivalents are alternatives (OR); different words still all have to match.
  // The word budget per concept shrinks as the query grows so a request stays inside MAX_ASSET_READS.
  const perGroup=Math.max(4,Math.min(MAX_GROUP_WORDS,Math.floor(18/tokens.length)));
  const groups=tokens.map(t=>expandWord(t).filter(w=>w.length>=2&&!STOP.has(w)).slice(0,perGroup));
  const shards=new Map();
  const postingsOf=words=>Promise.all(words.map(w=>postings(reader,w,shards)));
  // Per concept: records containing the user's own word, and records that only contain a translation or related word.
  const own=[],related=[];
  await Promise.all(groups.map(async(g,i)=>{const [first,...rest]=await postingsOf(g);own[i]=new Set(first);related[i]=new Set(rest.flat().filter(x=>!own[i].has(x)))}));
  const complete=()=>{const c=new Map();groups.forEach((g,i)=>{for(const x of new Set([...own[i],...related[i]]))if(inRange(x))c.set(x,(c.get(x)||0)+1)});return[...c.values()].filter(n=>n===tokens.length).length};
  // With few complete matches, relax each word to its 6-letter prefix so inflected or compound words still find records.
  if(complete()<limit)await Promise.all(tokens.map(async(t,i)=>{const pk=prefixKey(t);if(pk)for(const x of await postings(reader,pk,shards)){own[i].add(x);related[i].delete(x)}}));
  // A rare concept ("air") says more about what the user wants than a common one ("quality"): weight each concept by inverse document
  // frequency, capped so one very rare word cannot outweigh the rest. A record with the user's own word beats one that only has a
  // translation or a broader related word. Matching every concept comes first: "panels" alone (a lab-assay record) must not beat "solar panels".
  const counts=new Map(),covered=new Map();
  const weights=groups.map((g,i)=>Math.min(MAX_IDF,Math.log(1+(manifest.records||21000)/(1+own[i].size+related[i].size))));
  groups.forEach((g,i)=>{
    const w=weights[i];
    for(const x of own[i])if(inRange(x)){counts.set(x,(counts.get(x)||0)+w);covered.set(x,(covered.get(x)||0)+1)}
    for(const x of related[i])if(inRange(x)){counts.set(x,(counts.get(x)||0)+w*RELATED_WEIGHT);covered.set(x,(covered.get(x)||0)+1)}
  });
  // Candidates: most concepts covered, then highest weighted match, then catalogue rank (a smaller index is a better-evidenced record).
  const candidates=[...counts].sort((x,y)=>covered.get(y[0])-covered.get(x[0])||y[1]-x[1]||x[0]-y[0]).slice(0,CANDIDATE_POOL);
  const docChunks=new Map(),scored=[];let skipped=0;
  const docAt=async idx=>{
    const chunk=Math.floor(idx/DOC_CHUNK);
    if(!docChunks.has(chunk))docChunks.set(chunk,await reader.json("/mcp/d/"+chunk+".json")||[]);
    return docChunks.get(chunk)[idx%DOC_CHUNK];
  };
  // For a common need (population, enterprise register, air quality...) the hand-reviewed authoritative source goes first, with the reason.
  const keep=d=>d&&!(args?.topic&&d.tp!==args.topic)&&!(args?.open_licence_only&&!isOpen(d));
  const authority=(scope==="datasets"||scope==="all")?authoritiesFor(tokenize(q,{cap:10}))[0]:null;
  const pinned=[];
  if(authority)for(const id of authority.ids){const idx=manifest.pins?.[id];if(idx===undefined)continue;const d=await docAt(idx);if(keep(d))pinned.push(d)}
  // "dienstregeling De Lijn": the pinned source the user names (in its title or publisher) goes first.
  const names=d=>tokenize(d.t+" "+d.p,{cap:40}).filter(w=>tokens.includes(w)).length;
  pinned.sort((a,b)=>names(b)-names(a));
  const pinnedIds=new Set(pinned.map(d=>d.id));
  for(const [idx] of candidates){
    const chunk=Math.floor(idx/DOC_CHUNK);
    if(!docChunks.has(chunk)){
      if(docChunks.size>=MAX_DOC_CHUNKS){skipped++;continue}
      docChunks.set(chunk,await reader.json("/mcp/d/"+chunk+".json")||[]);
    }
    const d=docChunks.get(chunk)[idx%DOC_CHUNK];
    if(!keep(d)||pinnedIds.has(d.id))continue;
    const title=new Set(tokenize(d.t,{cap:30})),pub=new Set(tokenize(d.p,{cap:6}));
    // A concept named in the title counts far more than one that only appears in the description.
    const inTitle=i=>title.has(tokens[i])||(tokens[i].length>=7&&[...title].some(w=>w.startsWith(tokens[i].slice(0,6))))||groups[i].slice(1).some(w=>title.has(w));
    const match=groups.reduce((s,g,i)=>s+(own[i].has(idx)?1:related[i].has(idx)?RELATED_WEIGHT:0)*weights[i]*(inTitle(i)?TITLE_FACTOR:BODY_FACTOR),0);
    const pubHits=tokens.filter(t=>pub.has(t)).length;
    // Unless the user names the place, a city or province publication is a worse answer than national or regional coverage of the same subject.
    const local=!pubHits&&LOCAL_PUBLISHER.test(d.p)?LOCAL_PENALTY:0;
    scored.push({d,score:(covered.get(idx)||0)*COVERAGE_WEIGHT+match+(d.c?CURATED_BONUS:0)+pubHits*5-local-idx/1e6});
  }
  scored.sort((x,y)=>y.score-x.score);
  const results=[...pinned.map(d=>({...summary(d),authoritative_source:true})),...collapseCollections(scored)].slice(0,limit);
  const live=LIVE_TOOLS.find(([re])=>tokens.some(t=>re.test(t)));
  return{query:q,scope,candidates_considered:counts.size,
    ...(live?{related_tool:{name:live[1],why:live[2]}}:{}),
    ...(pinned.length?{guidance:{need:authority.need,authoritative_source:authority.why,...(authority.caveat?{caveat:authority.caveat}:{})}}:{}),
    ...(skipped?{note_partial:"Result set was capped to stay within the service budget; refine the query for more."}:{}),results,note:TRUST_NOTE};
}

async function loadRecord(reader,rawId){
  const id=String(rawId||"").slice(0,300);if(!id)return{error:"id is required: pass a dataset id from search_datasets."};
  const shard=await reader.json("/mcp/i/"+idShard(id)+".json")||{},idx=shard[id];
  if(idx===undefined)return{error:"Unknown dataset id '"+id.slice(0,80)+"'. Use search_datasets to find ids."};
  const [light,detail]=await Promise.all([reader.json("/mcp/d/"+Math.floor(idx/DOC_CHUNK)+".json"),reader.json("/mcp/x/"+Math.floor(idx/DETAIL_CHUNK)+".json")]);
  const d=light?.[idx%DOC_CHUNK],x=detail?.[idx%DETAIL_CHUNK];
  if(!d||!x)return{error:"The record for '"+id.slice(0,80)+"' could not be read from the index; try again shortly."};
  return{d,x};
}
// Files preview_dataset can read: CSV/TSV distributions that the harvest put in the catalogue relay index.
const previewable=x=>(x.files||[]).filter(f=>f.r);

export async function getDataset(reader,args){
  const rec=await loadRecord(reader,args?.id);if(rec.error)return{error:rec.error};
  const {d,x}=rec,auth=AUTHORITIES.find(a=>a.ids.includes(d.id));
  return{id:d.id,title:d.t,publisher:d.p,kind:d.k||"dataset",topic:d.tp,hand_reviewed:!!d.c,licence:{label:d.l||null,family:d.lf||"unknown"},updated:d.u||null,update_cycle:x.fq||null,
    geography:x.g||null,landing_page:x.url||null,contact:{email:x.ce||null,url:x.cu||null},description:x.d||"",columns:x.cols||[],access_tier:d.tier||null,
    ...(auth?{authoritative_source:{need:auth.need,why:auth.why,...(auth.caveat?{caveat:auth.caveat}:{})}}:{}),
    preview_available:previewable(x).length>0,
    web_url:reader.origin+"/?dataset="+encodeURIComponent(d.id),
    link_check:x.pr?{checked_on:x.pr.at,files_checked:x.pr.n,files_ok:x.pr.ok,format_mismatches:x.pr.mm}:null,
    files:(x.files||[]).map(f=>({format:f.f,url:f.u,size_bytes:f.s||null})),note:TRUST_NOTE};
}

const cut=s=>{const t=String(s??"");return t.length>MAX_CELL_CHARS?t.slice(0,MAX_CELL_CHARS-1)+"…":t};
const DELIMITER_NAMES={",":"comma",";":"semicolon","\t":"tab","|":"pipe"};
/** First rows of a dataset's CSV/TSV file, read through the catalogue relay (only pre-indexed publisher URLs; never a caller-supplied URL). */
export async function previewDataset(reader,args,previewFile){
  const rec=await loadRecord(reader,args?.id);if(rec.error)return{error:rec.error};
  const {d,x}=rec,rows=Math.min(MAX_PREVIEW_ROWS,Math.max(1,Number(args?.rows)||10));
  const files=previewable(x);
  const base={id:d.id,title:d.t,publisher:d.p,landing_page:x.url||null};
  if(!files.length)return{...base,error:"No previewable CSV/TSV file for this dataset (formats listed: "+((d.f||[]).join(", ")||"none")+"). Open the landing page or the web app link to inspect it.",web_url:reader.origin+"/?dataset="+encodeURIComponent(d.id)};
  if(!previewFile)return{...base,error:"File preview is not available on this server."};
  const file=files[0];
  const got=await previewFile(file.r,PREVIEW_BYTES);
  if(got.error)return{...base,file:{format:file.f,url:file.u},error:"The publisher's file could not be read: "+got.error};
  const bytes=got.bytes;
  const {encoding,skip}=encodingFor(bytes);
  let text=new TextDecoder(encoding).decode(bytes.subarray(skip));
  const truncated=got.truncated;
  if(truncated){const nl=text.lastIndexOf("\n");if(nl>0)text=text.slice(0,nl)}   // drop the partial last line
  if(/^\s*</.test(text)||/html/i.test(got.contentType||""))return{...base,file:{format:file.f,url:file.u},error:"The publisher answered with a web page instead of a CSV file; the download link may have moved. Check the landing page."};
  const delimiter=detectDelimiter(text,{url:file.u,format:file.f});
  const parsed=parseDelimitedText(text,{delimiter,sampleRows:rows,inferRows:1000});
  if(!parsed.headers.length)return{...base,file:{format:file.f,url:file.u},error:"The file is empty or could not be parsed as delimited text."};
  const cols=parsed.headers.slice(0,MAX_PREVIEW_COLUMNS);
  const sample=parsed.samples.map(r=>Object.fromEntries(cols.map(h=>[h,cut(r[h])])));
  // Belgian files often write 1.234,5: say so, so numbers are not misread.
  const commaDecimals=parsed.samples.some(r=>cols.some(h=>/^-?\d{1,3}(\.\d{3})*,\d+$|^-?\d+,\d+$/.test(String(r[h]??"").trim())));
  const out={...base,file:{format:file.f,url:file.u,size_bytes:got.totalBytes||file.s||null},delimiter:DELIMITER_NAMES[delimiter]||delimiter,encoding,
    ...(commaDecimals?{decimal_separator:"comma"}:{}),
    columns:cols.map((h,i)=>({name:h,type:parsed.types[i]||"string"})),...(parsed.headers.length>cols.length?{columns_omitted:parsed.headers.length-cols.length}:{}),
    rows:sample,rows_read:parsed.rowCount,whole_file_read:!truncated,
    note:(truncated?"Only the first "+Math.round(PREVIEW_BYTES/1024)+" KiB were read: rows_read counts rows in that part, not in the whole file. ":"")+"Values are shown as published; types are inferred from the rows read."};
  // Keep the answer proportionate: drop sample rows until it fits the text budget.
  while(out.rows.length>1&&JSON.stringify(out).length>MAX_PREVIEW_TEXT)out.rows.pop();
  return out;
}

export async function catalogueOverview(reader){
  const m=await reader.json("/mcp/manifest.json");
  if(!m)return{error:"Index not available."};
  const {ranges,pins,...rest}=m;void ranges;void pins;
  return{...rest,note:TRUST_NOTE};
}

// Compact JSON: the same object is also in structuredContent, and indentation would roughly double the tokens a client reads.
const asText=obj=>({content:[{type:"text",text:JSON.stringify(obj)}],structuredContent:obj,isError:!!obj.error});
// Deep-research shape: one text content item holding JSON with results[{id,title,url}] (search) or {id,title,text,url,metadata} (fetch).
const asPlain=obj=>({content:[{type:"text",text:JSON.stringify(obj)}]});

function usageResultCount(result){
  if(Array.isArray(result?.structuredContent?.results))return result.structuredContent.results.length;
  try{
    const parsed=JSON.parse(result?.content?.[0]?.text||"");
    return Array.isArray(parsed?.results)?parsed.results.length:0;
  }catch{return 0}
}
function mcpTopic(query=""){
  const q=String(query).toLowerCase();
  const groups=[
    ["agriculture",/agri|landbouw|agriculture|crop|parcel|perceel|fyt|farmer|boer/],
    ["energy",/energ|electric|elektr|power|grid|solar|wind|gas|elia|fluvius/],
    ["mobility",/mobil|transport|traffic|verkeer|train|trein|rail|bus|bike|fiets|road|weg/],
    ["business",/company|enterprise|business|ondernem|bedrijf|kbo|bce|vat|btw|nace/],
    ["population",/population|bevolk|population|demograph|resident|inwoner|household|huishoud/],
    ["environment",/environment|milieu|climate|klimaat|air|lucht|water|soil|bodem|nature|natuur/],
    ["geography",/address|adres|building|gebouw|parcel|perceel|map|kaart|geo|municip|gemeente|commune/],
    ["health",/health|gezond|sant[eé]|hospital|zieken|riziv|inami|disease|ziekte/],
    ["education",/education|onderwijs|école|school|student|university|universit/],
    ["finance",/finance|financ|tax|belasting|imp[oô]t|budget|bank|nbb|bnb|income|inkomen/],
    ["government",/government|overheid|public sector|federal|federaal|region|gewest|province|provinc/]
  ];
  return groups.find(([,re])=>re.test(q))?.[0]||(q.trim()?"other":"none");
}
function writeMcpUsage(env,{method,tool="",args={},status="ok",durationMs=0,resultCount=0}={}){
  const sink=env?.MCP_USAGE;if(!sink?.writeDataPoint)return;
  // Deliberately do not store query text, dataset ids, headers, IP addresses or conversation content.
  const query=String(args?.query||""),queryWords=query.trim().split(/\s+/).filter(Boolean).length;
  try{sink.writeDataPoint({
    indexes:[tool||method||"mcp"],
    blobs:[method||"",tool||"",String(args?.scope||""),status,mcpTopic(query)],
    doubles:[Math.max(0,Number(durationMs)||0),Math.max(0,Number(resultCount)||0),queryWords]
  })}catch{}
}

// Live tools: they read official services (bounded client in dov.mjs) and, for place context and statistics, the static Statbel tables.
const DOV_TOOLS={subsurface_at_location:subsurfaceAtLocation,get_subsurface_record:getSubsurfaceRecord,search_subsurface:searchSubsurface,
  belgian_statistics:belgianStatistics,air_quality:airQuality,flood_risk:floodRisk};
export async function callTool(env,origin,name,args,{previewFile=null,dov=null}={}){
  if(DOV_TOOLS[name]){
    if(!dov?.fetchImpl)return asText({error:"Live data access is not available on this server."});
    if(dov.rateLimit&&!(await dov.rateLimit()))return asText({error:"Too many live-data requests right now; try again in a minute."});
    return asText(await DOV_TOOLS[name](makeDovClient({fetchImpl:dov.fetchImpl}),args,{assets:makeReader(env,origin)}));
  }
  const reader=makeReader(env,origin);
  if(name==="search_datasets")return asText(await searchDatasets(reader,args));
  if(name==="get_dataset")return asText(await getDataset(reader,args));
  if(name==="preview_dataset")return asText(await previewDataset(reader,args,previewFile));
  if(name==="catalogue_overview")return asText(await catalogueOverview(reader));
  if(name==="search"){
    const r=await searchDatasets(reader,{query:args?.query,limit:10,scope:"datasets"});
    if(r.error)return asPlain({results:[]});
    return asPlain({results:r.results.map(x=>({id:x.id,title:x.title+" — "+x.publisher,url:x.landing_page||(origin+"/")}))});
  }
  if(name==="fetch"){
    const g=await getDataset(reader,{id:args?.id});
    if(g.error)return{content:[{type:"text",text:JSON.stringify({id:String(args?.id||""),title:"Not found",text:g.error,url:origin+"/",metadata:{}})}],isError:true};
    const text=[g.title,"Publisher: "+g.publisher,"Licence: "+(g.licence.label||"none stated")+" ("+g.licence.family+")",g.updated?"Updated: "+g.updated:"",g.description,
      g.columns.length?"Columns: "+g.columns.join(", "):"",g.files.length?"Files: "+g.files.map(f=>f.format+" "+f.url).join("; "):"",TRUST_NOTE].filter(Boolean).join("\n");
    return asPlain({id:g.id,title:g.title,text,url:g.landing_page||(origin+"/"),metadata:{publisher:g.publisher,licence_family:g.licence.family,access_tier:g.access_tier,topic:g.topic}});
  }
  return null;
}

/** Address used in links the tools return. PUBLIC_ORIGIN (wrangler var) wins because data.vecture.be reaches the Worker through a Netlify
 *  proxy, so the request itself carries the workers.dev host. Asset reads use it too; the ASSETS binding ignores the host. */
export function publicOrigin(env,request){
  try{const u=new URL(String(env?.PUBLIC_ORIGIN||""));if(u.protocol==="https:")return u.origin}catch{}
  return new URL(request.url).origin;
}

export async function handleMcp(request,env,options={}){
  const origin=publicOrigin(env,request);
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":"*","access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"content-type, mcp-protocol-version, mcp-session-id","access-control-max-age":"86400"}});
  if(request.method==="GET"||request.method==="DELETE")return jsonResponse({error:"This MCP endpoint is stateless: use POST with a JSON-RPC message."},405,{allow:"POST, OPTIONS"});
  if(request.method!=="POST")return jsonResponse({error:"Method not allowed."},405,{allow:"POST, OPTIONS"});
  let text;try{text=await request.text()}catch{return rpcError(null,-32700,"Unreadable body.")}
  if(text.length>16*1024)return rpcError(null,-32600,"Request too large.");
  let msg;try{msg=JSON.parse(text)}catch{return rpcError(null,-32700,"Parse error.")}
  if(Array.isArray(msg))return rpcError(null,-32600,"Batch requests are not supported.");
  if(!msg||msg.jsonrpc!=="2.0"||typeof msg.method!=="string")return rpcError(msg?.id,-32600,"Invalid request.");
  if(msg.id===undefined)return new Response(null,{status:202,headers:{"access-control-allow-origin":"*"}});   // notification
  const id=msg.id;
  switch(msg.method){
    case"initialize":{
      const wanted=msg.params?.protocolVersion,version=SUPPORTED_PROTOCOLS.includes(wanted)?wanted:SUPPORTED_PROTOCOLS[0];
      writeMcpUsage(env,{method:"initialize"});
      return jsonResponse({jsonrpc:"2.0",id,result:{protocolVersion:version,capabilities:{tools:{listChanged:false}},serverInfo:{name:"belgium-open-data",title:"Belgian Open Data",version:MCP_VERSION},
        instructions:"Belgian public data, answered from the official sources. For figures, use the answer tools: belgian_statistics (Statbel: population and income by municipality, province or region, rankings, inflation and health index, unemployment), air_quality (IRCEL-CELINE: now, forecast and annual means at an address), flood_risk (VMM's official flood-prone classes at an address in Flanders), and for the subsurface in Flanders subsurface_at_location, search_subsurface and get_subsurface_record (DOV). Their answers start with key_facts built from the data in the same answer; quote them with the reference date and cite the provenance block. To find datasets and files instead: search_datasets (Dutch, French or English; the official source first for common needs), get_dataset (licence, contact, link checks), preview_dataset (real columns and sample rows) and catalogue_overview. Catalogue results are metadata and link-check evidence, not statements about data correctness."}});
    }
    case"ping":return jsonResponse({jsonrpc:"2.0",id,result:{}});
    case"tools/list":return jsonResponse({jsonrpc:"2.0",id,result:{tools:TOOLS}});
    case"tools/call":{
      const name=msg.params?.name,args=msg.params?.arguments||{},started=Date.now();
      if(!TOOLS.some(t=>t.name===name))return rpcError(id,-32602,"Unknown tool '"+String(name).slice(0,64)+"'. Available: "+TOOLS.map(t=>t.name).join(", ")+".");
      try{
        const result=await callTool(env,origin,name,args,options);
        writeMcpUsage(env,{method:"tools/call",tool:name,args,status:result?.isError?"error":"ok",durationMs:Date.now()-started,resultCount:usageResultCount(result)});
        return jsonResponse({jsonrpc:"2.0",id,result});
      }catch{
        writeMcpUsage(env,{method:"tools/call",tool:name,args,status:"error",durationMs:Date.now()-started});
        return jsonResponse({jsonrpc:"2.0",id,result:{content:[{type:"text",text:"The "+name+" tool hit an internal error while reading the catalogue index. Retry once; if it persists, report it at info@vecture.be."}],isError:true}});
      }
    }
    default:return rpcError(id,-32601,"Method not found.");
  }
}
