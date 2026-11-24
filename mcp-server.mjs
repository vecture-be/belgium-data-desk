// Read-only MCP (Model Context Protocol) server for the Belgium Data Desk catalogue, served by the same Worker at POST /mcp.
// Stateless Streamable-HTTP JSON-RPC. It answers only from pre-built static shards (public/mcp/**), never fetches a user-supplied URL,
// and bounds asset reads and parsed JSON per request. The shard format is produced by scripts/build-mcp-index.mjs.

import { expandWord } from "./public/dataset-synonyms-v1.mjs";
import { AUTHORITIES, authoritiesFor } from "./public/dataset-authority-v1.mjs";
import { detectDelimiter, encodingFor, parseDelimitedText } from "./scripts/tabular-profile.mjs";
import { makeDovClient } from "./dov.mjs";
import { LIVE_TOOLS, ROUTING, liveTool } from "./tools/index.mjs";
import { toMcpTool } from "./lib/tool-contract.mjs";
import { ISSUE_IDS, LANGS, contactPublisher } from "./contact.mjs";
import { feedbackConfig, reportDataIssue } from "./feedback.mjs";
import { repairSelectSql } from "./public/data-repair-v1.mjs";

export const MCP_VERSION="0.5.1";
const SUPPORTED_PROTOCOLS=["2025-06-18","2025-03-26","2024-11-05"];
export const DOC_CHUNK=100,DETAIL_CHUNK=50;
const MAX_LIMIT=20,MAX_QUERY_TOKENS=5,MAX_ASSET_READS=30,MAX_GROUP_WORDS=12,MAX_DOC_CHUNKS=8,CANDIDATE_POOL=60;
// Ranking weights, tuned against eval-relevance/queries.json (scripts/eval-mcp-relevance.mjs).
const RELATED_WEIGHT=0.6,CURATED_BONUS=30,LOCAL_PENALTY=20,COVERAGE_WEIGHT=60,MAX_IDF=5,TITLE_FACTOR=30,BODY_FACTOR=10;
const MAX_PREVIEW_ROWS=20,PREVIEW_BYTES=64*1024,MAX_PREVIEW_COLUMNS=40,MAX_CELL_CHARS=160,MAX_PREVIEW_TEXT=14000;
// Turn a narrow, unambiguous English question into a topic lookup before indexing words.
// In "How many people live in Gent?", "live" otherwise retrieves traffic live feeds.
// Only this population intent is rewritten; other uses of "live" (e.g. live train data) remain untouched.
export function normalizeSearchIntent(q){
  const s=String(q??"");
  const m=/^\s*(?:how many\s+(?:people|residents|inhabitants)\s+(?:live|are living|are there|are)\s+in|number of\s+(?:people|residents)\s+(?:living\s+)?in)\s+(.+?)[?.!]*\s*$/i.exec(s);
  return m?"population "+m[1]:s;
}
// A search whose words ask for figures or conditions, not files, is pointed at the live tool that answers it. The words come from
// each tool's `routing` in tools/; a query word may match only one tool (scripts/test-tools.mjs checks that).
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
  let reads=0;const cache=new Map(),stats={cache_hits:0,parse_ms:0,freeze_ms:0};
  return{origin,stats,
    get reads(){return reads},
    async json(pathname){
      if(cache.has(pathname)){stats.cache_hits++;return cache.get(pathname)}
      const hit=sharedGet(env?.ASSETS,pathname);
      if(hit!==undefined){stats.cache_hits++;cache.set(pathname,hit);return hit}
      if(reads>=MAX_ASSET_READS)return null;
      reads++;
      // Search synonym groups often ask for the same shard concurrently. Register
      // the in-flight promise before fetching so it is fetched/parsed only once.
      const pending=(async()=>{
        let v=null;
        try{const r=await env.ASSETS.fetch(new Request(origin+pathname));if(r.ok){
          const text=await r.text(),t0=performance.now(),parsed=JSON.parse(text),t1=performance.now();
          v=deepFreeze(parsed);stats.parse_ms+=t1-t0;stats.freeze_ms+=performance.now()-t1;
          sharedSet(env?.ASSETS,pathname,v,text.length);
        }}catch{v=null}
        return v;
      })();
      cache.set(pathname,pending);
      return pending;
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
  covers_year:{type:"integer",minimum:1800,maximum:2100,description:"Only records whose data covers this year (the period the publisher declares, or the dates read from the file). Records with no known period are left out."},
  language:{type:"string",enum:["nl","fr","en","de"],description:"Only records whose publisher declares this language. Records with no declared language are left out."},
  limit:{type:"integer",minimum:1,maximum:MAX_LIMIT,description:"Number of results, default 10."}
},required:["query"]};
const TOOLS=[
  {
    name:"search_datasets",title:"Search Belgian open datasets",
    description:"Search Belgian open data (about 21,700 records from federal, regional and local publishers: hand-reviewed national registers, data.gov.be and directly harvested portals) in Dutch, French or English. For common needs such as population, the enterprise register (KBO/BCE), air quality, unemployment or train punctuality, the official reference source is listed first, marked authoritative_source, with a guidance block saying who publishes it and the usual pitfalls. Scope 'datasets' (default) means data files and APIs; map layers, PDF publications, research supplements and metadata-only records are separate scopes. Results are catalogue metadata and link-check evidence, not statements about data correctness. Examples: {\"query\":\"bevolking per gemeente\"}; {\"query\":\"thuisbatterij\"}; {\"query\":\"census 2021\",\"open_licence_only\":true}; {\"query\":\"wegenregister\",\"scope\":\"maps\"}; {\"query\":\"luchtkwaliteit\",\"topic\":\"environment\",\"limit\":5}.",
    inputSchema:SEARCH_SCHEMA,annotations:{title:"Search Belgian open datasets",readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },
  {
    name:"get_dataset",title:"Get one dataset record",
    description:"Full catalogue record for one dataset id from search_datasets: publisher, licence and what it allows, update cycle, contact, description, file links, publisher-declared columns, link-check evidence, and whether preview_dataset can read the file. For files checked weekly it adds a dataset card computed from the file itself: whether it is overdue against its declared update cycle, the period the data covers, join keys (NIS municipality codes incl. pre-2025 codes, enterprise numbers, postcodes, coordinates), sparse and constant columns, column changes since the last check, and quotable facts each with its evidence. Fields the publisher leaves empty are listed under not_declared_by_publisher with the source page; for analysis over the whole file, the analysis block gives download links and the domains a sandbox must allow. Example: {\"id\":\"national:d04b704a-1672-4567-bf0d-9a9452618812\"}.",
    inputSchema:{type:"object",properties:{id:{type:"string",description:"Dataset id as returned by search_datasets."}},required:["id"]},annotations:{title:"Get one dataset record",readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },
  {
    name:"preview_dataset",title:"Preview the rows of a dataset file",
    description:"Read the first rows of a dataset's CSV/TSV file directly from the publisher and return the column names, inferred column types, the delimiter and encoding, and up to 20 sample rows as published. Works for datasets whose get_dataset record shows preview_available: true. Normally reads the first 64 KiB (up to 256 KiB only when the first CSV record is very wide), so it shows structure and example values, not totals over the whole file; for those, its analysis block gives the download links, a DuckDB query in the file's own dialect and the domains to allow in a sandbox. Example: {\"id\":\"national:d04b704a-1672-4567-bf0d-9a9452618812\",\"rows\":5}.",
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
    name:"contact_publisher",title:"Draft a message to a dataset's publisher",
    description:"Prepare a message to the people who publish a dataset, for the user to send themselves: the contact the publisher declared in its catalogue record (never a guessed address), a polite draft in the publisher's language (Dutch, French, English or German) naming the dataset, file, issue and the evidence checked, and a mailto: link. Nothing is sent by this tool. Use it when the user wants to report a problem (stale data, broken link, missing units or metadata, wrong values) or ask the publisher a question. Run get_dataset or preview_dataset first and pass what they showed as evidence; the answer says what to check before writing. Show the draft to the user to edit and send; send one message per problem, not one per related dataset. Example: {\"id\":\"national:d04b704a-1672-4567-bf0d-9a9452618812\",\"issue\":\"metadata\",\"details\":\"The record says 2019 but the file has 2026 data.\"}.",
    inputSchema:{type:"object",properties:{
      id:{type:"string",description:"Dataset id from search_datasets or get_dataset."},
      issue:{type:"string",enum:ISSUE_IDS,description:"What the message is about: stale, access, metadata, units, values, missing, schema, licence or question."},
      details:{type:"string",description:"What is wrong or what the user wants to know, in the user's words (at most 1,500 characters)."},
      evidence:{type:"array",items:{type:"string"},maxItems:5,description:"Up to 5 facts checked with the other tools, each with its source, e.g. 'preview_dataset: TIMESTAMP_EXTRACT goes up to 2026-11-01, catalogue says 2019-01-21'."},
      language:{type:"string",enum:LANGS,description:"Language of the draft; default the publisher's (Dutch for Flemish bodies, French for Walloon and Brussels ones, else English)."}
    },required:["id","issue"]},annotations:{title:"Draft a message to a dataset's publisher",readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },
  {
    name:"report_data_issue",title:"Report a data problem to its publisher (confirmed by email)",
    description:"File a report about a dataset for the publisher, on the user's behalf. Call it only when the user has asked to report the problem through this service and has given their own email address. Nothing reaches the publisher until the user confirms: a confirmation link is emailed to them, and an unconfirmed report is deleted after 48 hours. Confirmed reports go out in one weekly digest per publisher, to the address declared in its catalogue record, merged with other reports of the same issue. Limits: 3 reports per person a day. To let the user send a message themselves instead, use contact_publisher.",
    inputSchema:{type:"object",properties:{
      id:{type:"string",description:"Dataset id from search_datasets or get_dataset."},
      issue:{type:"string",enum:ISSUE_IDS,description:"What is wrong: stale, access, metadata, units, values, missing, schema, licence or question."},
      details:{type:"string",description:"What is wrong, specifically (file, columns, rows or dates), 20 to 1,500 characters, in the user's words."},
      evidence:{type:"array",items:{type:"string"},maxItems:5,description:"Up to 5 facts checked with the other tools, each with its source."},
      reporter_email:{type:"string",description:"The user's own email address, given by the user for this report; the confirmation link is sent there."},
      share_email_with_publisher:{type:"boolean",description:"Default false. True only if the user agrees that the publisher may see their address to reply."},
      language:{type:"string",enum:LANGS,description:"Language of the report in the digest; default the publisher's."}
    },required:["id","issue","details","reporter_email"]},annotations:{title:"Report a data problem to its publisher",readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true}
  },
  // Live answer tools: one definition per file in tools/, listed in tools/index.mjs.
  ...LIVE_TOOLS.map(toMcpTool),
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
const NOT_DECLARED="not declared by the publisher";
const summary=d=>({id:d.id,title:d.t,publisher:d.p,kind:d.k||"dataset",topic:d.tp,formats:d.f,licence:d.l||NOT_DECLARED,licence_family:d.lf||"unknown",access_tier:d.tier||null,updated:d.u||null,
  ...(d.ld?{latest_data:d.ld}:{}),...(d.dg?{disagreements:d.dg,disagreements_note:"Data checks to review: "+d.dg+(d.dg>1?" points":" point")+"; get_dataset lists them."}:{}),
  ...(d.y?{covers_years:d.y,...(d.ym?{covers_years_from:"read from the file"}:{})}:{}),...(d.lg?{languages:d.lg}:{}),...(d.ar?{access_rights:d.ar}:{}),
  hand_reviewed:!!d.c,landing_page:d.w||null,snippet:d.s||""});
/** Search filters on the period a record covers and its language. Records that declare neither are left out when the filter is set. */
export const coversYear=(d,year)=>!year||(Array.isArray(d?.y)&&d.y[0]<=year&&year<=d.y[1]);
export const inLanguage=(d,lang)=>!lang||(d?.lg||[]).includes(lang);

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
    const s={...summary(x.d),...(x.partial?{matches_only:x.partial}:{})};if(x.d.sid)seen.set(x.d.sid,s);out.push(s);
  }
  return out;
}

export async function searchDatasets(reader,args){
  const q=String(args?.query||"").slice(0,200),scope=["datasets","maps","publications","research","metadata","all"].includes(args?.scope)?args.scope:"datasets";
  const limit=Math.min(MAX_LIMIT,Math.max(1,Number(args?.limit)||10)),intentQuery=normalizeSearchIntent(q),tokens=tokenize(intentQuery,{cap:MAX_QUERY_TOKENS});
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
  // Period and language filters apply to every candidate (one small facet file), not just to the few documents read below.
  const year=Number.isInteger(Number(args?.covers_year))&&Number(args.covers_year)>1000?Number(args.covers_year):null;
  const lang=["nl","fr","en","de"].includes(args?.language)?args.language:null;
  const facets=year||lang?await reader.json("/mcp/f.json"):null;
  const LANG_BIT={nl:1,fr:2,en:4,de:8};
  const passes=idx=>!facets||((!year||(Array.isArray(facets.y?.[idx])&&facets.y[idx][0]<=year&&year<=facets.y[idx][1]))&&(!lang||((facets.lg?.[idx]||0)&LANG_BIT[lang])));
  const candidates=[...counts].filter(([idx])=>passes(idx)).sort((x,y)=>covered.get(y[0])-covered.get(x[0])||y[1]-x[1]||x[0]-y[0]).slice(0,CANDIDATE_POOL);
  const docChunks=new Map(),scored=[];let skipped=0;
  const docAt=async idx=>{
    const chunk=Math.floor(idx/DOC_CHUNK);
    if(!docChunks.has(chunk))docChunks.set(chunk,await reader.json("/mcp/d/"+chunk+".json")||[]);
    return docChunks.get(chunk)[idx%DOC_CHUNK];
  };
  // For a common need (population, enterprise register, air quality...) the hand-reviewed authoritative source goes first, with the reason.
  const keep=d=>d&&!(args?.topic&&d.tp!==args.topic)&&!(args?.open_licence_only&&!isOpen(d))&&coversYear(d,year)&&inLanguage(d,lang);
  const authority=(scope==="datasets"||scope==="all")?authoritiesFor(tokenize(intentQuery,{cap:10}))[0]:null;
  const pinned=[];
  if(authority)for(const id of authority.ids){const idx=manifest.pins?.[id];if(idx===undefined)continue;const d=await docAt(idx);if(keep(d))pinned.push(d)}
  // "dienstregeling De Lijn": the pinned source the user names (in its title or publisher) goes first.
  const names=d=>tokenize(d.t+" "+d.p,{cap:40}).filter(w=>tokens.includes(w)).length;
  pinned.sort((a,b)=>names(b)-names(a));
  const pinnedIds=new Set(pinned.map(d=>d.id));
  for(const [idx] of candidates){
    const chunk=Math.floor(idx/DOC_CHUNK);
    if(!docChunks.has(chunk)){
      // MAX_DOC_CHUNKS is the floor; when the token shards came from the isolate cache there is read budget left for more chunks.
      if(docChunks.size>=MAX_DOC_CHUNKS&&(docChunks.size>=MAX_DOC_CHUNKS*2||reader.reads>=MAX_ASSET_READS-2)){skipped++;continue}
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
    const coveredWords=tokens.filter((t,i)=>own[i].has(idx)||related[i].has(idx));
    scored.push({d,idx,...(coveredWords.length<tokens.length?{partial:coveredWords}:{}),score:(covered.get(idx)||0)*COVERAGE_WEIGHT+match+(d.c?CURATED_BONUS:0)+pubHits*5-local-idx/1e6});
  }
  scored.sort((x,y)=>y.score-x.score);
  const results=[...pinned.map(d=>({...summary(d),authoritative_source:true})),...collapseCollections(scored)].slice(0,limit);
  const live=ROUTING.find(([re])=>tokens.some(t=>re.test(t)));
  // A query word that no returned record matches (e.g. "batteries" in "solar panels photovoltaic batteries") is named, so the caller
  // does not read the results as covering it. Pinned sources are matched by need, not by word, so only scored results count here.
  const shownIdx=new Set(),shownIds=new Set(results.map(r=>r.id));for(const s of scored)if(shownIds.has(s.d.id))shownIdx.add(s.idx);
  const absent=tokens.filter((t,i)=>![...shownIdx].some(x=>own[i].has(x)||related[i].has(x))&&!pinned.some(d=>tokenize(d.t+" "+d.s,{cap:40}).includes(t)));
  const nowhere=absent.filter(t=>{const i=tokens.indexOf(t);return!own[i].size&&!related[i].size});
  return{query:q,scope,candidates_considered:counts.size,
    ...(live?{related_tool:{name:live[1],why:live[2]}}:{}),
    ...(pinned.length?{guidance:{need:authority.need,authoritative_source:authority.why,...(authority.caveat?{caveat:authority.caveat}:{})}}:{}),
    ...(absent.length?{words_not_matched:absent,words_note:(nowhere.length?"No record in the catalogue matches "+nowhere.map(w=>"'"+w+"'").join(", ")+". ":"")+
      (absent.length>nowhere.length?"No result shown matches "+absent.filter(w=>!nowhere.includes(w)).map(w=>"'"+w+"'").join(", ")+"; search for it on its own to see those records. ":"")+"These results cover the other words only."}:{}),
    ...(results.some(r=>r.matches_only)?{partial_matches:"Results with matches_only match only those words of the query, not all of it (e.g. 'home' without 'battery'); they are listed because few records match every word."}:{}),
    ...(facets?{filters:{...(year?{covers_year:year}:{}),...(lang?{language:lang}:{})},filter_note:"Only records whose period"+(lang?" or language":"")+" is known can match"+(year?"; the period is the one the publisher declares, or the dates read from the file":"")+". Records that state neither are left out, not judged."}:{}),
    ...(skipped&&results.length<limit?{note_partial:"Fewer results than asked: some candidates were not scored to stay within the service budget. A shorter or more specific query finds them."}:{}),results,note:TRUST_NOTE};
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
// EU frequency vocabulary (publications.europa.eu/resource/authority/frequency) as words. A publisher that points at an unresolved
// RDF blank node leaves an opaque id in the harvest: that is not a cycle, so it is reported as not stated.
const CYCLE_WORDS={"1MIN":"every minute","5MIN":"every five minutes","10MIN":"every ten minutes","15MIN":"every fifteen minutes","30MIN":"every thirty minutes",
  HOURLY:"hourly","12HRS":"twice a day",CONT:"continuously",CONTINUOUS:"continuously",UPDATE_CONT:"continuously",REAL_TIME:"in real time",DAILY:"daily",DAILY_2:"twice a day",
  WEEKLY:"weekly",WEEKLY_2:"twice a week",WEEKLY_3:"three times a week",BIWEEKLY:"every two weeks",MONTHLY:"monthly",MONTHLY_2:"twice a month",MONTHLY_3:"three times a month",
  BIMONTHLY:"every two months",QUARTERLY:"quarterly",ANNUAL_2:"twice a year",ANNUAL_3:"three times a year",ANNUAL:"yearly",BIENNIAL:"every two years",TRIENNIAL:"every three years",
  QUADRENNIAL:"every four years",QUINQUENNIAL:"every five years",DECENNIAL:"every ten years",IRREG:"irregularly",AS_NEEDED:"as needed",NEVER:"never (a one-off release)",
  NOT_PLANNED:"no updates planned",ARCHIVED:"archived, no further updates",OTHER:"other (not specified)",UNKNOWN:"unknown"};
export function updateCycle(code){
  const c=String(code||"").trim().toUpperCase();
  if(!c)return{update_cycle:"not declared by the publisher",update_cycle_declared:false};
  if(CYCLE_WORDS[c])return{update_cycle:CYCLE_WORDS[c],update_cycle_code:c};
  if(/^[A-Z0-9_]{2,20}$/.test(c))return{update_cycle:c.toLowerCase().replace(/_/g," "),update_cycle_code:c};
  return{update_cycle:"not declared by the publisher",update_cycle_declared:false,update_cycle_note:"The publisher's metadata names an update cycle that cannot be resolved (an internal reference, not a code)."};
}

/** How to analyse the whole file: preview and card read only its start. Download links (the publisher's, and the relay for sandboxes
 *  that allow few domains), the in-browser SQL page, and the exact domains a network allowlist needs. */
function analysisFor(x,origin,id,dialect=null,card=null){
  const files=x.files||[];
  // the whole file: a relayed CSV/TSV, else a CSV/TSV link, else the first link (an API page with a row limit is a last resort)
  const f=files.find(y=>y.r)||files.find(y=>/csv|tsv/i.test(y.f||"")&&!/[?&]limit=/.test(y.u))||files.find(y=>!/[?&]limit=/.test(y.u))||files[0];if(!f)return null;
  const relayFile=(x.files||[]).find(y=>y.r),host=u=>{try{return new URL(u).hostname}catch{return null}};
  const relayUrl=relayFile?origin+"/api/dataset-file/"+relayFile.r:null;
  const hosts=[...new Set([host(f.u),relayUrl&&host(origin)].filter(Boolean))];
  const src=relayUrl||f.u,delim=dialect?.delimiter,dec=dialect?.decimal==="comma";
  return{whole_file:"preview_dataset and the dataset card read only the start of the file. For counts, sums or min/max over all rows, download the file and analyse it locally (Python, R, DuckDB or a spreadsheet), or open web_sql, which runs SQL over the whole file in the browser.",
    download:f.u,...(relayUrl?{download_via_relay:relayUrl,relay_note:"The same file through "+host(origin)+" (CSV/TSV up to 8 MiB), for sandboxes that cannot reach the publisher's server."}:{}),
    web_sql:origin+"/?dataset="+encodeURIComponent(id),
    hosts_to_allow:hosts,sandbox_note:"In a sandbox with a network allowlist the download fails unless "+(hosts.length>1?"one of these domains is":"this domain is")+" allowed: "+hosts.join(", ")+". Say so to the user rather than reporting the file as broken.",
    ...(/csv|tsv/i.test(relayFile?.f||f.f)?(()=>{
      const rel="read_csv('"+src+"'"+(delim?", delim='"+(delim==="\t"?"\\t":delim)+"'":"")+(dec?", decimal_separator=','":"")+", header=true)";
      // the card's repairs as a query: -999-style codes become NULL, coordinates written wrongly get lat_wgs84/lon_wgs84
      const clean=card?.repairs&&card.file?.url===f.u?repairSelectSql(card,rel):null;
      return{duckdb:"SELECT COUNT(*) FROM "+rel+";",...(clean?{duckdb_repaired:clean+";",duckdb_repaired_note:"The same file with the repairs listed under card.repairs applied; the published columns stay as they are and coordinate_repair says per row what was done."}:{})};
    })():{})};
}

export async function getDataset(reader,args){
  const rec=await loadRecord(reader,args?.id);if(rec.error)return{error:rec.error};
  const {d,x}=rec,auth=AUTHORITIES.find(a=>a.ids.includes(d.id)),card=await cardFor(reader,d.id);
  const canPreview=previewable(x).length>0,cols=x.cols?.length?x.cols:(card?.columns||[]).map(c=>c.name).filter(Boolean);
  // Say why a field is empty, so an empty value is not read as "no columns" or "link broken".
  const fieldNotes={
    updated:"Date the publisher last changed the catalogue record, not necessarily when the data was refreshed; files are often replaced without touching the record."+(canPreview?" preview_dataset compares it with dates in the file.":""),
    ...(!cols.length?{columns:"The publisher declares no column list."+(canPreview?" preview_dataset reads the real columns from the file.":"")}:!x.cols?.length||x.cm?{columns:"Read from the file by the weekly check (the publisher declares none)."}:{}),
    ...(!x.pr?{link_check:"No conclusive weekly link-check result is recorded: the last check of its files was inconclusive (timeout, rate limit or the publisher blocking the checker) or its formats are not checked. This is not a sign of a broken link."+(canPreview?" preview_dataset reads the file live.":"")}:{}),
    ...((x.files||[]).some(f=>!f.s)?{size_bytes:"Null where the publisher declares no file size."}:{}),
    units:"Units are only known when the publisher states them in the description or column names; do not assume one."
  };
  const cycle=updateCycle(x.fq),source=x.url||d.w||null;
  // Fields the publisher's own record leaves empty: named as gaps in the source, with the page where the publisher may say more.
  const measuredPeriod=card?.coverage?.time;
  const gaps=[!d.l&&"licence",cycle.update_cycle_declared===false&&"update cycle",(!x.cols?.length||x.cm)&&"column list",!x.ce&&!x.cu&&"contact",!d.u&&"update date",!x.tc&&!measuredPeriod&&"period covered"].filter(Boolean);
  // What the data is about in time, language, access and lineage: declared by the publisher, or read from the file (said which).
  const about={
    ...(x.tc?{period:{from:x.tc.s,to:x.tc.e,source:d.c?"from the hand-reviewed description of this dataset":"declared by the publisher",...(x.tc.pe?{planned_end:x.tc.pe,planned_end_note:"The publisher gives an end date in the future: a validity or planning date, so the period is shown as open-ended."}:{})}}:measuredPeriod?{period:{from:measuredPeriod.from,to:measuredPeriod.to,source:"read from the file (column "+measuredPeriod.column+")"}}:{}),
    ...(x.lang?{languages:x.lang}:{}),
    ...(x.ar&&x.ar!=="PUBLIC"?{access_rights:{value:x.ar,note:x.ar==="NON_PUBLIC"?"The publisher marks this dataset as not public: the record describes it, but the data itself is not openly available.":"The publisher restricts access: expect a request, registration or conditions before you get the data."}}:x.ar?{access_rights:{value:x.ar}}:{}),
    ...(x.prov?{lineage:x.prov}:{}),...(x.crs?{coordinate_systems:x.crs}:{}),...(x.res?{spatial_resolution_m:x.res}:{}),
    ...(x.hvd?{eu_high_value_dataset:x.hvd}:{}),...(x.std?{conforms_to:x.std}:{}),...(x.iss?{first_published:x.iss}:{})
  };
  const profile=card?.file?{rows:card.file.rows,rows_exact:!!card.file.rows_exact,...(card.file.rows_exact?{}:{rows_note:"Rows in the first "+Math.round((card.file.bytes_read||0)/1024)+" KiB read by the weekly check; the whole file has more."}),
    ...(card.coverage?.time?{period:{from:card.coverage.time.from,to:card.coverage.time.to,column:card.coverage.time.column}}:{}),profiled_at:card.profiled_at}:null;
  return{id:d.id,title:d.t,publisher:d.p,kind:d.k||"dataset",topic:d.tp,hand_reviewed:!!d.c,
    licence:{label:d.l||NOT_DECLARED,family:d.lf||"unknown",...(x.lcf?{conflict:"Copies of this dataset in other catalogues state different licences: "+x.lcf.join("; ")+"."}:{}),...(x.lt?{terms_text:x.lt}:{}),...(x.lsrc?{source:/^publisher:/.test(x.lsrc)?"The licence "+x.lsrc.slice(10)+" states on "+(x.lshare||90)+" % of its catalogue records; this hand-reviewed record has none of its own.":"The publisher's licence, from the harvested record "+x.lsrc+" of the same dataset."}:{}),...(!d.l&&source?{check:source}:{})},
    updated:d.u||null,...cycle,
    ...(gaps.length?{not_declared_by_publisher:{fields:gaps,source_page:source,note:"These are gaps in the publisher's own catalogue record, not faults in this tool. The source page may give them."}}:{}),
    ...(profile?{data_profile:profile}:{}),
    ...about,...(x.pinf?{publisher_inferred:"The catalogue record names no publisher; this one is inferred from the record's "+({kbo:"owner enterprise number",mail:"contact address",domain:"contact e-mail domain",host:"website or file host",slug:"dataset id on the publisher's own portal"}[x.pinf]||x.pinf)+"."}:{}),
    geography:x.g||null,landing_page:x.url||null,contact:{...(x.cn?{name:x.cn}:{}),email:x.ce||null,url:x.cu||null},description:x.d||"",columns:cols,access_tier:d.tier||null,
    ...(analysisFor(x,reader.origin,d.id,null,card)?{analysis:analysisFor(x,reader.origin,d.id,null,card)}:{}),
    ...(auth?{authoritative_source:{need:auth.need,why:auth.why,...(auth.caveat?{caveat:auth.caveat}:{})}}:{}),
    preview_available:canPreview,
    web_url:reader.origin+"/?dataset="+encodeURIComponent(d.id),
    link_check:x.pr?{checked_on:x.pr.at,files_checked:x.pr.n,files_ok:x.pr.ok,format_mismatches:x.pr.mm}:null,field_notes:fieldNotes,
    // LDES endpoints: "stream" = answered with LDES/TREE vocabulary when checked; not a statement about history completeness
    ...(x.sc?{stream_check:x.sc.map(s=>({endpoint:s.url,checked_on:s.at,result:s.result,...(s.status?{http_status:s.status}:{}),...(s.error?{error:s.error}:{})}))}:{}),
    files:(x.files||[]).map(f=>({format:f.f,url:f.u,size_bytes:f.s||null})),...(card?{card}:{}),
    trust:trustSummary(d,x,card,measuredPeriod),note:TRUST_NOTE};
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
  let got=await previewFile(file.r,PREVIEW_BYTES);
  if(got.error)return{...base,file:{format:file.f,url:file.u},error:"The publisher's file could not be read: "+got.error};
  let bytes=got.bytes;
  let {encoding,skip}=encodingFor(bytes);
  let text=new TextDecoder(encoding).decode(bytes.subarray(skip));
  let truncated=got.truncated;
  if(truncated){const nl=text.lastIndexOf("\n");if(nl>0)text=text.slice(0,nl)}   // drop the partial last line
  if(/^\s*</.test(text)||/html/i.test(got.contentType||""))return{...base,file:{format:file.f,url:file.u},error:"The publisher answered with a web page instead of a CSV file; the download link may have moved. Check the landing page."};
  let delimiter=detectDelimiter(text,{url:file.u,format:file.f});
  // Latest date per column over every row read (ISO or dd/mm/yyyy, never later than today): files are often refreshed without the
  // catalogue record changing, and a date in the data later than the record's date shows it.
  const latest=new Map(),today=new Date().toISOString().slice(0,10);
  const onRow=(values,headers)=>{for(let i=0;i<values.length&&i<headers.length;i++){const v=String(values[i]??"").trim();
    const m=/^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/.exec(v)||((m2)=>m2&&[m2[0],m2[3],m2[2],m2[1]])(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/.exec(v));
    if(!m||+m[1]<1900||+m[2]<1||+m[2]>12||+m[3]<1||+m[3]>31)continue;const iso=m[1]+"-"+m[2]+"-"+m[3];if(iso>today)continue;
    if(!latest.has(headers[i])||latest.get(headers[i])<iso)latest.set(headers[i],iso)}};
  let parsed=parseDelimitedText(text,{delimiter,sampleRows:rows,inferRows:1000,onRow});
  // Very wide GeoJSON columns can make the first CSV record longer than 64 KiB.
  // Retry only when we read a header but no complete record. Never report zero sample
  // rows as if the underlying dataset were empty.
  if(truncated&&!parsed.rowCount&&parsed.headers.length){
    const more=await previewFile(file.r,PREVIEW_BYTES*4);
    if(!more.error&&more.bytes.length>got.bytes.length){
      got=more;bytes=got.bytes;({encoding,skip}=encodingFor(bytes));
      text=new TextDecoder(encoding).decode(bytes.subarray(skip));truncated=got.truncated;
      if(truncated){const end=text.lastIndexOf("\n");if(end>0)text=text.slice(0,end)}
      delimiter=detectDelimiter(text,{url:file.u,format:file.f});
      parsed=parseDelimitedText(text,{delimiter,sampleRows:rows,inferRows:1000,onRow});
    }
  }
  if(truncated&&!parsed.rowCount)return{...base,file:{format:file.f,url:file.u},
    error:"The first data record exceeds the bounded preview size; no complete row could be read. This does not mean the dataset is empty.",
    columns:parsed.headers.slice(0,MAX_PREVIEW_COLUMNS).map((name,i)=>({name,type:parsed.types[i]||"string"})),
    analysis:analysisFor(x,reader.origin,d.id,{delimiter}),
    note:"The catalogue's whole-file row count is separate evidence. Use the publisher file or browser SQL for data rows."};
  if(!parsed.headers.length)return{...base,file:{format:file.f,url:file.u},error:"The file is empty or could not be parsed as delimited text."};
  const cols=parsed.headers.slice(0,MAX_PREVIEW_COLUMNS);
  const sample=parsed.samples.map(r=>Object.fromEntries(cols.map(h=>[h,cut(r[h])])));
  // Belgian files often write 1.234,5: say so, so numbers are not misread.
  const commaDecimals=parsed.samples.some(r=>cols.some(h=>/^-?\d{1,3}(\.\d{3})*,\d+$|^-?\d+,\d+$/.test(String(r[h]??"").trim())));
  const newest=[...latest].sort((p,q)=>q[1].localeCompare(p[1]))[0];
  const catalogueDate=d.u||null,daysAfter=newest&&catalogueDate?Math.round((Date.parse(newest[1])-Date.parse(catalogueDate))/864e5):null;
  const freshness=newest?{latest_date_in_rows_read:newest[1],column:newest[0],catalogue_updated:catalogueDate,
    ...(daysAfter>30?{data_newer_than_catalogue_date:true,note:"The file holds dates up to "+newest[1]+" ("+newest[0]+"), later than the catalogue record's date "+catalogueDate+": the dates describe different things and do not establish when the file changed."}:{})}:null;
  // Measures only: identifiers, codes, years and flags have no unit.
  const numeric=parsed.headers.slice(0,MAX_PREVIEW_COLUMNS).filter((h,i)=>/^(integer|number)$/.test(parsed.types[i]||"")&&!/(^|[_\s-])(id|code|nis|refnis|ins|postcode|zip|jaar|year|annee|indicator|flag|nr|nummer|number)([_\s-]|$)/i.test(String(h).trim()));
  const out={...base,file:{format:file.f,url:file.u,size_bytes:got.totalBytes||file.s||null},delimiter:DELIMITER_NAMES[delimiter]||delimiter,encoding,
    ...(commaDecimals?{decimal_separator:"comma"}:{}),...(freshness?{freshness}:{}),
    ...(numeric.length?{units:"Units are not part of the file. Numeric columns ("+numeric.slice(0,6).join(", ")+(numeric.length>6?", ...":"")+") have the unit the publisher states on the landing page or in the column name, if any; if none is stated, say the unit is not declared rather than guessing."}:{}),
    columns:cols.map((h,i)=>({name:h,type:parsed.types[i]||"string"})),...(parsed.headers.length>cols.length?{columns_omitted:parsed.headers.length-cols.length}:{}),
    rows:sample,rows_read:parsed.rowCount,whole_file_read:!truncated,
    ...(truncated?{analysis:analysisFor(x,reader.origin,d.id,{delimiter,decimal:commaDecimals?"comma":"point"})}:{}),
    note:(truncated?"Only the first "+Math.round(bytes.byteLength/1024)+" KiB were read: rows_read counts rows in that part, not in the whole file. ":"")+"Values are shown as published; types are inferred from the rows read."};
  // Keep the answer proportionate: drop sample rows until it fits the text budget.
  while(out.rows.length>1&&JSON.stringify(out).length>MAX_PREVIEW_TEXT)out.rows.pop();
  return out;
}

export async function catalogueOverview(reader){
  const m=await reader.json("/mcp/manifest.json");
  if(!m)return{error:"Index not available."};
  const {ranges,pins,...rest}=m;void ranges;void pins;
  const cards=await reader.json("/cards/summary.json"),checks=await reader.json("/catalogue-sanity.json");
  return{...rest,...(cards?{dataset_cards:cards}:{}),
    // record-level problems the publishers own, counted across the catalogue (scripts/catalogue-sanity.mjs)
    ...(checks?{catalogue_checks:{checked:checks.checked,all_gates_passed:checks.gates.every(g=>g.ok),issues:Object.fromEntries(Object.entries(checks.notes).map(([k,v])=>[k,{records:v.count,pct:v.pct}]))}}:{}),note:TRUST_NOTE};
}

/** The dataset card (scripts/dataset-card.mjs) for a record, trimmed for an MCP answer: facts with evidence first. */
/**
 * What a reader can rely on: what this service checked itself, what only the publisher states, and where the two disagree.
 * Publishers are often incomplete or inconsistent; this does not fix them, it keeps their statements apart from what was verified.
 */
const KEY_NAMES={nis_code:"NIS municipality codes",enterprise_number:"enterprise numbers (KBO/BCE)",postcode:"Belgian postcodes",wgs84_point:"WGS84 points inside Belgium",latitude:"latitudes",longitude:"longitudes",lambert72:"Lambert 72 coordinates"};
export function trustSummary(d,x,card,measuredPeriod){
  const checked=[],stated=[],disagreements=[];
  if(x.pr)checked.push("Links: "+x.pr.ok+" of "+x.pr.n+" answered when checked on "+x.pr.at+(x.pr.mm?"; "+x.pr.mm+" did not contain the declared format":"; the bytes matched the declared format")+".");
  if(card?.file){
    const f=card.file;checked.push((f.rows_exact?"Whole file read on ":"First "+Math.round((f.bytes_read||0)/1024)+" KiB read on ")+card.profiled_at+": "+(f.rows_exact?"":"at least ")+Number(f.rows).toLocaleString("en-GB")+(f.rows===1?" row":" rows")+(card.columns?.length?", "+card.columns.length+" columns":"")+".");
    if(measuredPeriod)checked.push("Dates in the file run from "+measuredPeriod.from+" to "+measuredPeriod.to+" (column '"+measuredPeriod.column+"').");
    const fr=card.freshness||{};if(fr.content_unchanged_since&&fr.content_unchanged_since<card.profiled_at)checked.push("Data content unchanged in checks since at least "+fr.content_unchanged_since+".");
    if(fr.content_change_seen)checked.push("Content change observed on "+fr.content_change_seen+".");
    else if(fr.last_change_basis==="file date"&&fr.last_change)checked.push("File Last-Modified: "+fr.last_change+".");
    for(const k of (card.coverage?.keys||[]).slice(0,3))checked.push("Column '"+k.column+"' holds "+(KEY_NAMES[k.kind]||String(k.kind).replace(/_/g," ")+" values")+".");
  }
  if(x.cm)checked.push("Column names read from the file (the publisher declares none).");
  if(d.l)stated.push("Licence: "+d.l+(x.lsrc?" (from another record of the same dataset)":"")+".");
  if(d.u)stated.push("Catalogue last updated: "+d.u+".");
  if(x.fq)stated.push("Update frequency: "+x.fq.toLowerCase().replace(/_/g," ")+".");
  if(x.tc&&!measuredPeriod)stated.push("Period: "+(x.tc.s||"?")+" to "+(x.tc.e||"now")+" (not checked against a file).");
  if(x.g)stated.push("Geography: "+x.g+".");
  for(const g of card?.disagreements||[])disagreements.push(g.text);
  if(x.lcf)disagreements.push("Copies of this dataset in other catalogues state different licences: "+x.lcf.join("; ")+". Check the publisher's page before reuse.");
  return{checked_by_this_service:checked.length?checked:["Nothing: no file of this record could be read or link-checked (the publisher's host may block automated checks, or it has no file)."],
    stated_by_publisher_only:stated,...(disagreements.length?{disagreements}:{}),
    ...(card?.repairs?.summary?.length?{read_differently_than_published:card.repairs.summary}:{}),
    note:"Checked facts come from this service's own downloads; stated facts are the publisher's and were not verified. Catalogue modification, observed content changes and reporting dates are separate facts; none implies the others."+
      (card?.repairs?" Values the publisher wrote in a wrong form (swapped or metre coordinates, -999 for 'unknown') are read the way they were meant, as listed; the file itself is unchanged.":"")};
}

async function cardFor(reader,id){
  const c=(await reader.json("/cards/"+idShard(id)+".json"))?.[id];
  if(!c)return null;
  return{profiled_at:c.profiled_at,facts:c.facts,...(c.disagreements?.length?{disagreements:c.disagreements}:{}),...(c.repairs?{repairs:c.repairs}:{}),freshness:c.freshness,...(c.last_change_seen?{last_change_seen:c.last_change_seen}:{}),coverage:c.coverage,quality:c.quality,schema:c.schema,
    file:c.file,columns:(c.columns||[]).slice(0,25),
    note:(c.file?.rows_exact
      ?"Computed by code from the whole file ("+Math.round((c.file?.bytes_read||0)/1024)+" KiB) and the catalogue record; change dates are checked against the file's content week over week"
      :"Computed by code from the first "+Math.round((c.file?.bytes_read||0)/1024)+" KiB of the file and the catalogue record; ranges and counts describe the rows read")+". Quote facts with their evidence."};
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
// A short-lived HMAC proves a test runner knows the secret without sending the
// secret on the wire (request headers can appear in platform observability).
export async function mcpTrafficClass(request,env,body=""){
  const secret=typeof env?.MCP_TEST_TOKEN==="string"?env.MCP_TEST_TOKEN:"";
  const timestamp=request.headers.get("x-bdd-test-timestamp")||"";
  const proof=request.headers.get("x-bdd-test-signature")||"";
  if(secret.length<24||secret.length>256||!/^[0-9]{10}$/.test(timestamp)||!/^[a-f0-9]{64}$/.test(proof))return "unclassified";
  if(Math.abs(Date.now()/1000-Number(timestamp))>120)return "unclassified";
  try{
    const encoder=new TextEncoder(),key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
    const signature=Uint8Array.from(proof.match(/../g),h=>parseInt(h,16));
    return await crypto.subtle.verify("HMAC",key,signature,encoder.encode(timestamp+"\n"+body))?"self_test":"unclassified";
  }catch{return "unclassified"}
}
// Cloudflare's invocation log contains actual CPU time. A sampled console entry is
// attached to that same invocation, so tool names can be correlated without query/IP logging.
function logMcpDiagnostics(env,{tool,status,elapsedMs,reader,trafficClass}){
  const rate=Math.min(1,Math.max(0,Number(env?.MCP_DIAGNOSTICS_SAMPLE_RATE)||0));
  if(!rate||Math.random()>=rate)return;
  console.info("bdd.mcp.tool",JSON.stringify({
    tool,status,traffic_class:trafficClass,elapsed_ms:elapsedMs,
    asset_reads:reader.reads,cache_hits:reader.stats.cache_hits,
    parse_ms:Math.round(reader.stats.parse_ms*10)/10,
    freeze_ms:Math.round(reader.stats.freeze_ms*10)/10
  }));
}
function writeMcpUsage(env,{method,tool="",args={},status="ok",durationMs=0,resultCount=0,trafficClass="unclassified"}={}){
  const sink=env?.MCP_USAGE;if(!sink?.writeDataPoint)return;
  // Deliberately do not store query text, dataset ids, headers, IP addresses or conversation content.
  const query=String(args?.query||""),queryWords=query.trim().split(/\s+/).filter(Boolean).length;
  try{sink.writeDataPoint({
    indexes:[tool||method||"mcp"],
    blobs:[method||"",tool||"",String(args?.scope||""),status,mcpTopic(query),trafficClass],
    doubles:[Math.max(0,Number(durationMs)||0),Math.max(0,Number(resultCount)||0),queryWords]
  })}catch{}
}

// Live tools (tools/): each gets its own bounded client, limited to the hosts and request budget its definition declares, and
// reads static tables (place context, Statbel) through the same asset reader as the catalogue tools.
/** Tools this server offers: report_data_issue only where sending is configured (feedback.mjs), so no client sees a tool that cannot work. */
/** An address without a house number is geocoded to a point on the street (or in the municipality): say so in the first key fact,
 *  not only in the location note, so the answer is not quoted as being about one building. */
export function withPrecision(out){
  const loc=out?.location,p=loc?.precision;
  if(!Array.isArray(out?.key_facts)||(p!=="street"&&p!=="municipality"))return out;
  const what=loc.matched_address?"'"+loc.matched_address+"'":"The address";
  return{...out,key_facts:[(p==="street"?"Street-level, approximate: ":"Municipality-level, approximate: ")+what+" matched a "+p+", not a building (no house number), so this answer is for one point "+(p==="street"?"on that street":"in that municipality")+". Give the house number for a building-level answer.",...out.key_facts]};
}

export const toolsFor=env=>TOOLS.filter(t=>t.name!=="report_data_issue"||feedbackConfig(env).on);

export async function callTool(env,origin,name,args,{previewFile=null,dov=null,mailFetch=null,reader=null}={}){
  const assets=reader||makeReader(env,origin);
  const tool=liveTool(name);
  if(tool){
    if(!dov?.fetchImpl)return asText({error:"Live data access is not available on this server."});
    if(dov.rateLimit&&!(await dov.rateLimit()))return asText({error:"Too many live-data requests right now; try again in a minute."});
    const client=makeDovClient({fetchImpl:dov.fetchImpl,hosts:tool.hosts,maxRequests:tool.maxRequests});
    return asText(withPrecision(await tool.run(client,args||{},{assets})));
  }
  reader=assets;
  if(name==="search_datasets")return asText(await searchDatasets(reader,args));
  if(name==="get_dataset")return asText(await getDataset(reader,args));
  if(name==="preview_dataset")return asText(await previewDataset(reader,args,previewFile));
  if(name==="catalogue_overview")return asText(await catalogueOverview(reader));
  if(name==="contact_publisher"||name==="report_data_issue"){
    const g=await getDataset(reader,{id:args?.id});if(g.error)return asText({error:g.error});
    return asText(name==="contact_publisher"?contactPublisher(g,args||{},origin):await reportDataIssue(env,g,args||{},{origin,fetchImpl:mailFetch||fetch}));
  }
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
  const id=msg.id,trafficClass=await mcpTrafficClass(request,env,text);
  switch(msg.method){
    case"initialize":{
      const wanted=msg.params?.protocolVersion,version=SUPPORTED_PROTOCOLS.includes(wanted)?wanted:SUPPORTED_PROTOCOLS[0];
      writeMcpUsage(env,{method:"initialize",trafficClass});
      return jsonResponse({jsonrpc:"2.0",id,result:{protocolVersion:version,capabilities:{tools:{listChanged:false}},serverInfo:{name:"belgium-open-data",title:"Belgian Open Data",version:MCP_VERSION},
        instructions:"Belgian public data, answered from the official sources. For figures, use the answer tools: belgian_statistics (Statbel: population and income by municipality, province or region, rankings, inflation and health index, unemployment), air_quality (IRCEL-CELINE: now, forecast and annual means at an address), flood_risk (VMM's official flood-prone classes at an address in Flanders), river_levels (live river, canal and tide gauges in Flanders against their watch and alarm levels), weather (KMI/IRM: measured now, last days and a 48-hour forecast at a place), train_punctuality (Infrabel: a station, a train yesterday, an IC line or the network), and for the subsurface in Flanders subsurface_at_location, search_subsurface and get_subsurface_record (DOV). Their answers start with key_facts built from the data in the same answer; quote them with the reference date and cite the provenance block. To find datasets and files instead: search_datasets (Dutch, French or English; the official source first for common needs), get_dataset (licence, contact, link checks), preview_dataset (real columns and sample rows) and catalogue_overview. To tell a publisher about a problem in its data, contact_publisher drafts a message the user sends from their own mailbox. Catalogue results are metadata and link-check evidence, not statements about data correctness."}});
    }
    case"ping":return jsonResponse({jsonrpc:"2.0",id,result:{}});
    case"tools/list":return jsonResponse({jsonrpc:"2.0",id,result:{tools:toolsFor(env)}});
    case"tools/call":{
      const name=msg.params?.name,args=msg.params?.arguments||{},started=Date.now(),tools=toolsFor(env),reader=makeReader(env,origin);
      if(!tools.some(t=>t.name===name))return rpcError(id,-32602,"Unknown tool '"+String(name).slice(0,64)+"'. Available: "+tools.map(t=>t.name).join(", ")+".");
      try{
        const result=await callTool(env,origin,name,args,{...options,reader});
        const elapsedMs=Date.now()-started,status=result?.isError?"error":"ok";
        writeMcpUsage(env,{method:"tools/call",tool:name,args,status,durationMs:elapsedMs,resultCount:usageResultCount(result),trafficClass});
        logMcpDiagnostics(env,{tool:name,status,elapsedMs,reader,trafficClass});
        return jsonResponse({jsonrpc:"2.0",id,result});
      }catch{
        const elapsedMs=Date.now()-started;
        writeMcpUsage(env,{method:"tools/call",tool:name,args,status:"error",durationMs:elapsedMs,trafficClass});
        logMcpDiagnostics(env,{tool:name,status:"error",elapsedMs,reader,trafficClass});
        return jsonResponse({jsonrpc:"2.0",id,result:{content:[{type:"text",text:"The "+name+" tool hit an internal error while reading the catalogue index. Retry once; if it persists, report it at info@vecture.be."}],isError:true}});
      }
    }
    default:return rpcError(id,-32601,"Method not found.");
  }
}

/** Read-only JSON for the website (GET /api/search, /api/dataset, /api/overview): the same search and records the MCP tools return. */
export async function handleSiteApi(request,env){
  if(request.method!=="GET"&&request.method!=="HEAD")return jsonResponse({error:"Method not allowed."},405,{allow:"GET"});
  const url=new URL(request.url),origin=publicOrigin(env,request),reader=makeReader(env,origin),p=url.searchParams;
  const cache={"cache-control":"public, max-age=300"};
  if(url.pathname==="/api/search"){
    const args={query:String(p.get("q")||"").slice(0,200),scope:p.get("scope")||"datasets",limit:MAX_LIMIT};
    if(p.get("topic"))args.topic=p.get("topic");
    if(p.get("open")==="1")args.open_licence_only=true;
    const out=await searchDatasets(reader,args);
    return jsonResponse(out,out?.error?400:200,out?.error?{}:cache);
  }
  if(url.pathname==="/api/dataset"){
    const out=await getDataset(reader,{id:String(p.get("id")||"").slice(0,400)});
    return jsonResponse(out,out?.error?404:200,out?.error?{}:cache);
  }
  if(url.pathname==="/api/overview")return jsonResponse(await catalogueOverview(reader),200,cache);
  return jsonResponse({error:"Unknown API path."},404);
}
