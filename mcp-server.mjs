// Read-only MCP (Model Context Protocol) server for the Belgium Data Desk catalogue, served by the same Worker at POST /mcp.
// Stateless Streamable-HTTP JSON-RPC. It answers only from pre-built static shards (public/mcp/**), never fetches a user-supplied URL,
// and bounds asset reads and parsed JSON per request. The shard format is produced by scripts/build-mcp-index.mjs.

import { expandWord } from "./public/dataset-synonyms-v1.mjs";
import { AUTHORITIES, authoritiesFor } from "./public/dataset-authority-v1.mjs";
import { detectDelimiter, encodingFor, parseDelimitedText } from "./scripts/tabular-profile.mjs";
import { makeDovClient } from "./dov.mjs";
import { LIVE_TOOLS, ROUTING, liveTool } from "./tools/index.mjs";
import { toMcpTool } from "./lib/tool-contract.mjs";

export const MCP_VERSION="0.5.0";
const SUPPORTED_PROTOCOLS=["2025-06-18","2025-03-26","2024-11-05"];
export const DOC_CHUNK=100,DETAIL_CHUNK=50;
const MAX_LIMIT=20,MAX_QUERY_TOKENS=5,MAX_ASSET_READS=30,MAX_GROUP_WORDS=12,MAX_DOC_CHUNKS=8,CANDIDATE_POOL=60;
// Ranking weights, tuned against eval-relevance/queries.json (scripts/eval-mcp-relevance.mjs).
const RELATED_WEIGHT=0.6,CURATED_BONUS=30,LOCAL_PENALTY=20,COVERAGE_WEIGHT=60,MAX_IDF=5,TITLE_FACTOR=30,BODY_FACTOR=10;
const MAX_PREVIEW_ROWS=20,PREVIEW_BYTES=64*1024,MAX_PREVIEW_COLUMNS=40,MAX_CELL_CHARS=160,MAX_PREVIEW_TEXT=14000;
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
    description:"Full catalogue record for one dataset id from search_datasets: publisher, licence and what it allows, update cycle, contact, description, file links, publisher-declared columns, link-check evidence, and whether preview_dataset can read the file. For files checked weekly it adds a dataset card computed from the file itself: whether it is overdue against its declared update cycle, the period the data covers, join keys (NIS municipality codes incl. pre-2025 codes, enterprise numbers, postcodes, coordinates), sparse and constant columns, column changes since the last check, and quotable facts each with its evidence.",
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
  const live=ROUTING.find(([re])=>tokens.some(t=>re.test(t)));
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
  const {d,x}=rec,auth=AUTHORITIES.find(a=>a.ids.includes(d.id)),card=await cardFor(reader,d.id);
  return{id:d.id,title:d.t,publisher:d.p,kind:d.k||"dataset",topic:d.tp,hand_reviewed:!!d.c,licence:{label:d.l||null,family:d.lf||"unknown"},updated:d.u||null,update_cycle:x.fq||null,
    geography:x.g||null,landing_page:x.url||null,contact:{email:x.ce||null,url:x.cu||null},description:x.d||"",columns:x.cols||[],access_tier:d.tier||null,
    ...(auth?{authoritative_source:{need:auth.need,why:auth.why,...(auth.caveat?{caveat:auth.caveat}:{})}}:{}),
    preview_available:previewable(x).length>0,
    web_url:reader.origin+"/?dataset="+encodeURIComponent(d.id),
    link_check:x.pr?{checked_on:x.pr.at,files_checked:x.pr.n,files_ok:x.pr.ok,format_mismatches:x.pr.mm}:null,
    files:(x.files||[]).map(f=>({format:f.f,url:f.u,size_bytes:f.s||null})),...(card?{card}:{}),note:TRUST_NOTE};
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
  const cards=await reader.json("/cards/summary.json");
  return{...rest,...(cards?{dataset_cards:cards}:{}),note:TRUST_NOTE};
}

/** The dataset card (scripts/dataset-card.mjs) for a record, trimmed for an MCP answer: facts with evidence first. */
async function cardFor(reader,id){
  const c=(await reader.json("/cards/"+idShard(id)+".json"))?.[id];
  if(!c)return null;
  return{profiled_at:c.profiled_at,facts:c.facts,freshness:c.freshness,coverage:c.coverage,quality:c.quality,schema:c.schema,
    file:c.file,columns:(c.columns||[]).slice(0,25),
    note:"Computed by code from the first "+Math.round((c.file?.bytes_read||0)/1024)+" KiB of the file and the catalogue record"+(c.file?.rows_exact?" (the whole file)":"; ranges and counts describe the rows read")+". Quote facts with their evidence."};
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

// Live tools (tools/): each gets its own bounded client, limited to the hosts and request budget its definition declares, and
// reads static tables (place context, Statbel) through the same asset reader as the catalogue tools.
export async function callTool(env,origin,name,args,{previewFile=null,dov=null}={}){
  const tool=liveTool(name);
  if(tool){
    if(!dov?.fetchImpl)return asText({error:"Live data access is not available on this server."});
    if(dov.rateLimit&&!(await dov.rateLimit()))return asText({error:"Too many live-data requests right now; try again in a minute."});
    const client=makeDovClient({fetchImpl:dov.fetchImpl,hosts:tool.hosts,maxRequests:tool.maxRequests});
    return asText(await tool.run(client,args||{},{assets:makeReader(env,origin)}));
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
