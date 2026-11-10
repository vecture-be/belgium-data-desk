// Scaffold a new live answer tool: writes tools/<name>.mjs from a commented template and registers it in tools/index.mjs.
//   node scripts/new-tool.mjs water_level
// Then follow docs/adding-a-tool.md: fill in the TODOs, record a fixture, run npm test.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const name=process.argv[2]||"";
if(!/^[a-z][a-z0-9_]{2,40}$/.test(name)){console.error("usage: node scripts/new-tool.mjs <lower_snake_case_name>, e.g. water_level");process.exit(2)}
const file=name.replace(/_/g,"-")+".mjs",target=path.join(root,"tools",file);
if(fs.existsSync(target)){console.error("tools/"+file+" already exists");process.exit(1)}
const camel=name.replace(/_([a-z0-9])/g,(_,c)=>c.toUpperCase());

fs.writeFileSync(target,`// ${name}: TODO one line saying what question this answers and from which official source.
import { COORDINATE_PROPERTIES, GEOCODER_HOSTS, defineTool } from "../lib/tool-contract.mjs";
import { clean, getJson, placeContext, resolveLocation, today, HOUR } from "../lib/tool-kit.mjs";

// TODO the service's address. Build every URL from validated arguments; never pass a user-supplied URL upstream.
const BASE="https://TODO.example.be/api";

async function run(client,args,{assets}={}){
  // 1. Validate and resolve the input. resolveLocation accepts address, latitude/longitude or Lambert 72 x/y.
  const w=await resolveLocation(client,args,{area:"belgium"});
  if(w.error)return{error:w.error};
  const loc=w.loc;
  // 2. Ask the service only for what the answer needs. getJson returns {json} or {error}; never throws.
  const r=await getJson(client,BASE+"?x="+Math.round(loc.x)+"&y="+Math.round(loc.y),{maxBytes:256*1024,ttl:HOUR});
  if(r.error)return{error:"TODO publisher did not answer: "+r.error};
  // 3. Interpret with domain knowledge: units, reference dates, thresholds, what the figure does NOT mean.
  const value=r.json?.TODO;
  // 4. key_facts: complete sentences built only from values in this answer, with units and reference dates.
  const key_facts=[\`TODO: the answer in one sentence, e.g. "The value at this place is \${value} unit (reference date)."\`];
  return clean({
    key_facts,
    location:loc,
    place:await placeContext(client,assets,loc).catch(()=>null),
    value,
    provenance:{source:"TODO publisher, dataset or service name",licence:"TODO licence",url:BASE,citation:"TODO as the publisher asks, consulted on "+today()}
  });
}

export default defineTool({
  name:"${name}",
  title:"TODO short title the assistant shows",
  description:"TODO 80-1600 characters: what this answers, from which official source, for which area and period, what each field means, and what it does not answer. Starts with key_facts.",
  inputSchema:{type:"object",properties:{
    address:{type:"string",description:"Address in Belgium, e.g. 'Grote Markt 1, 3000 Leuven'."},
    ...COORDINATE_PROPERTIES
  }},
  source:{publisher:"TODO publisher",licence:"TODO licence (must allow reuse)",url:"https://TODO.example.be"},
  hosts:["TODO.example.be",...GEOCODER_HOSTS],   // every hostname run() calls; the client refuses all others
  maxRequests:6,                                  // upstream requests per call (max 20)
  run,
  examples:[
    {args:{address:"Grote Markt 1, 3000 Leuven"},note:"TODO the question a person would ask",replay:true},
    {args:{address:"Place Saint-Lambert 1, 4000 Liège"},note:"TODO a second, different question"}
  ],
  // optional: search_datasets points here when a query word starts with one of these (lower case, no accents)
  // routing:{words:/^(todo|words)/,hint:"For TODO, ${name} answers from TODO live."}
});
`);

const idx=path.join(root,"tools","index.mjs");
let s=fs.readFileSync(idx,"utf8");
const lastImport=s.lastIndexOf("\nimport ");const eol=s.indexOf("\n",lastImport+1);
s=s.slice(0,eol+1)+`import ${camel} from "./${file}";\n`+s.slice(eol+1);
s=s.replace(/\n\]\);/,`,\n  ${camel}\n]);`);
fs.writeFileSync(idx,s);
console.log(`Created tools/${file} and registered it in tools/index.mjs.

Next:
  1. Fill in every TODO in tools/${file} (docs/adding-a-tool.md explains each part).
  2. npm run tool:record -- ${name}      records the replay example from the real service
  3. npm test                             contract and replay tests for every tool
  4. npm run dev, then node scripts/smoke-mcp.mjs http://localhost:8787`);
