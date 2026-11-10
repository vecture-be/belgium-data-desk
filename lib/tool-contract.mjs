// The contract every live answer tool follows. A tool is one file in tools/ that calls defineTool({...}); the registry
// (tools/index.mjs) lists it, and the MCP server, the search hints, the upstream allow-list and the contract tests are all
// derived from that one definition. A contributor writes domain logic and examples; the platform supplies the rest.
//
// What a definition must say, and why:
//   name, title, description   what the assistant sees; the description says which source answers and what it does not answer
//   inputSchema                JSON Schema of the arguments; every property is described (assistants rely on these texts)
//   source                     publisher, licence and a page about the data: the answer's provenance names the same source
//   hosts                      the only hostnames this tool may call (enforced by the client it receives); no tool takes a URL
//   maxRequests                upstream requests per call, at most MAX_REQUESTS
//   run(client, args, ctx)     returns { key_facts: [...], ..., provenance: {...} } or { error: "..." }; reads only via client.get
//                              (bounded: hosts, budget, timeout, bytes, caching) and ctx.assets.json (committed static tables)
//   examples                   real questions as arguments; the first one with replay: true is recorded and replayed in tests
//   routing (optional)         words that make search_datasets point to this tool instead of listing files

export const MAX_REQUESTS=20;
/** Address lookup (Digitaal Vlaanderen, then the federal BeSt address service): add these when a tool accepts an address. */
export const GEOCODER_HOSTS=Object.freeze(["geo.api.vlaanderen.be","best.pr.fedservices.be"]);
/** The four coordinate arguments every location tool accepts next to `address`. */
export const COORDINATE_PROPERTIES=Object.freeze({
  latitude:{type:"number",description:"WGS84 latitude, e.g. 51.0453 (use with longitude instead of address)."},
  longitude:{type:"number",description:"WGS84 longitude, e.g. 3.7275."},
  x_lambert72:{type:"number",description:"Belgian Lambert 72 (EPSG:31370) x in metres, as an alternative to latitude/longitude."},
  y_lambert72:{type:"number",description:"Belgian Lambert 72 (EPSG:31370) y in metres."}
});

const NAME=/^[a-z][a-z0-9_]{2,40}$/,HOST=/^(?=.{4,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const URLISH=/(^|_)(url|uri|link|endpoint|href)s?($|_)/;
const TYPES=new Set(["string","number","integer","boolean","array","object"]);

function fail(name,msg){throw new Error("tool "+(name||"?")+": "+msg)}

/** Checks example (or any) arguments against the schema subset tools use. Returns a list of problems, empty when fine. */
export function checkArgs(schema,args){
  const problems=[],props=schema.properties||{};
  if(!args||typeof args!=="object"||Array.isArray(args))return["arguments must be an object"];
  for(const r of schema.required||[])if(args[r]===undefined)problems.push("missing required '"+r+"'");
  for(const [k,v] of Object.entries(args)){
    const p=props[k];if(!p){problems.push("unknown argument '"+k+"'");continue}
    const ok=p.type==="integer"?Number.isInteger(v):p.type==="array"?Array.isArray(v):p.type==="number"?typeof v==="number"&&Number.isFinite(v):typeof v===p.type;
    if(!ok){problems.push("'"+k+"' should be "+p.type);continue}
    if(p.enum&&!p.enum.includes(v))problems.push("'"+k+"' must be one of "+p.enum.join(", "));
    if(typeof v==="number"&&((p.minimum!=null&&v<p.minimum)||(p.maximum!=null&&v>p.maximum)))problems.push("'"+k+"' out of range");
    if(Array.isArray(v)&&p.maxItems!=null&&v.length>p.maxItems)problems.push("'"+k+"' has too many items");
  }
  return problems;
}

export function defineTool(spec){
  const n=spec?.name;
  if(!NAME.test(n||""))fail(n,"name must be lower_snake_case, 3-41 characters");
  if(!spec.title||spec.title.length>90)fail(n,"title is required, at most 90 characters");
  if(!spec.description||spec.description.length<80||spec.description.length>1600)fail(n,"description must be 80-1600 characters: what it answers, from which source, and what it does not answer");
  const s=spec.inputSchema;
  if(s?.type!=="object"||!s.properties||typeof s.properties!=="object")fail(n,"inputSchema must be {type:'object', properties:{...}}");
  for(const [k,p] of Object.entries(s.properties)){
    if(!TYPES.has(p?.type))fail(n,"argument '"+k+"' needs a JSON Schema type");
    if(!p.description||p.description.length<8)fail(n,"argument '"+k+"' needs a description");
    if(URLISH.test(k))fail(n,"argument '"+k+"' looks like a URL: tools never accept URLs, only identifiers, places and values");
  }
  for(const r of s.required||[])if(!s.properties[r])fail(n,"required '"+r+"' is not a property");
  const src=spec.source||{};
  if(!src.publisher||!src.licence||!/^https:\/\//.test(src.url||""))fail(n,"source needs publisher, licence and an https url");
  if(!Array.isArray(spec.hosts)||!spec.hosts.length||spec.hosts.some(h=>!HOST.test(h)))fail(n,"hosts must list the bare hostnames it calls, e.g. ['geo.irceline.be']");
  const maxRequests=spec.maxRequests??10;
  if(!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>MAX_REQUESTS)fail(n,"maxRequests must be 1-"+MAX_REQUESTS);
  if(typeof spec.run!=="function")fail(n,"run(client, args, ctx) is required");
  const ex=spec.examples;
  if(!Array.isArray(ex)||ex.length<2)fail(n,"give at least two examples: {args, note}");
  ex.forEach((e,i)=>{const p=checkArgs(s,e.args);if(p.length)fail(n,"example "+(i+1)+": "+p.join("; "));if(!e.note)fail(n,"example "+(i+1)+" needs a note (the question it answers)")});
  if(spec.routing&&(!(spec.routing.words instanceof RegExp)||!spec.routing.hint))fail(n,"routing needs {words: RegExp, hint}");
  return Object.freeze({...spec,maxRequests,hosts:Object.freeze([...new Set(spec.hosts)]),examples:Object.freeze(ex)});
}

/** The tool as MCP tools/list shows it. Live tools are read-only and reach the open world (official services). */
export function toMcpTool(t){
  return{name:t.name,title:t.title,description:t.description,inputSchema:t.inputSchema,
    annotations:{title:t.title,readOnlyHint:true,destructiveHint:false,openWorldHint:true}};
}

/** Contract for what run() returns; used by the tests on recorded upstream answers. Returns a list of problems. */
export function checkAnswer(out,{maxBytes=64*1024}={}){
  if(!out||typeof out!=="object")return["answer must be an object"];
  if(out.error)return typeof out.error==="string"?[]:["error must be a string"];
  const p=[],text=JSON.stringify(out);
  if(!Array.isArray(out.key_facts)||!out.key_facts.length||out.key_facts.length>10)p.push("key_facts must be 1-10 sentences");
  else if(out.key_facts.some(f=>typeof f!=="string"||!f.trim()||f.length>600))p.push("each key_fact is a non-empty sentence under 600 characters");
  if(!out.provenance||typeof out.provenance.source!=="string")p.push("provenance.source is required");
  if(text.length>maxBytes)p.push("answer is "+text.length+" bytes, over "+maxBytes);
  if(/\b(undefined|NaN)\b|\[object Object\]/.test(text))p.push("answer contains undefined, NaN or [object Object]");
  return p;
}
