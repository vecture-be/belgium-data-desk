// Contract tests for every live answer tool in tools/index.mjs, offline. For each tool:
//   - the definition passed lib/tool-contract.mjs (checked at import) and shows up in tools/list with read-only annotations
//   - its recorded example (tools/fixtures/<tool>.json) replays to a valid answer: key_facts, provenance, size, no undefined/NaN
//   - the replay stays within the tool's declared hosts and request budget
//   - its search routing words do not overlap another tool's
// The platform itself (allow-list enforcement, contract rules) is tested at the end with deliberately broken tools.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_TOOLS, ROUTING } from "../tools/index.mjs";
import { makeDovClient } from "../dov.mjs";
import { checkAnswer, checkArgs, defineTool, toMcpTool } from "../lib/tool-contract.mjs";
import { atTime, readFixture, replayFetch } from "../lib/fixtures.mjs";
import { handleMcp } from "../mcp-server.mjs";

const pub=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../public");
const assets={json:async p=>{try{return JSON.parse(fs.readFileSync(path.join(pub,p),"utf8"))}catch{return null}}};
const env={ASSETS:{fetch:async r=>{try{return new Response(fs.readFileSync(path.join(pub,new URL(r.url).pathname)))}catch{return new Response("",{status:404})}}}};

const listed=(await (await handleMcp(new Request("https://x.test/mcp",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"})}),env,{})).json()).result.tools;
const report=[];
for(const tool of LIVE_TOOLS){
  const where="tool "+tool.name;
  assert.deepEqual(listed.find(t=>t.name===tool.name),toMcpTool(tool),where+": tools/list shows the definition");
  const fx=readFixture(tool.name);
  assert.ok(fx,where+": no fixture; record one with: npm run tool:record -- "+tool.name);
  assert.deepEqual(checkArgs(tool.inputSchema,fx.args),[],where+": fixture arguments no longer fit the schema; record again");
  const client=makeDovClient({fetchImpl:replayFetch(fx),hosts:tool.hosts,maxRequests:tool.maxRequests});
  const t0=performance.now();
  const out=await atTime(fx.recordedAt,()=>tool.run(client,fx.args,{assets}));
  const ms=performance.now()-t0;
  assert.ok(!out?.error,where+": replay answered an error: "+out?.error);
  assert.deepEqual(checkAnswer(out),[],where+": answer contract");
  assert.ok(client.used<=tool.maxRequests,where+": used "+client.used+" upstream requests, budget "+tool.maxRequests);
  for(const c of fx.calls)assert.ok(tool.hosts.includes(new URL(c.url).hostname),where+": fixture calls undeclared host "+new URL(c.url).hostname);
  report.push(tool.name+" "+client.used+"/"+tool.maxRequests+" req "+ms.toFixed(1)+" ms");
}

// One query word must lead to one tool: every literal word of a tool's routing must not match another tool's routing.
for(const [re,name] of ROUTING){
  const words=re.source.replace(/^\^\(|\)$/g,"").split("|");
  for(const [re2,name2] of ROUTING)if(name2!==name)for(const w of words)assert.ok(!re2.test(w),"routing word '"+w+"' of "+name+" also matches "+name2);
}

// The platform guards, with throwaway definitions.
const base={name:"demo_tool",title:"Demo",description:"A demonstration tool that answers nothing useful; it exists only to test the contract checks of the platform.",
  inputSchema:{type:"object",properties:{place:{type:"string",description:"A place name"}}},source:{publisher:"Nobody",licence:"CC0",url:"https://example.org"},
  hosts:["example.org"],run:async()=>({key_facts:["x"],provenance:{source:"y"}}),examples:[{args:{place:"Gent"},note:"a"},{args:{place:"Liège"},note:"b"}]};
assert.doesNotThrow(()=>defineTool(base));
assert.throws(()=>defineTool({...base,name:"Bad-Name"}),/lower_snake_case/);
assert.throws(()=>defineTool({...base,inputSchema:{type:"object",properties:{source_url:{type:"string",description:"where to read"}}}}),/looks like a URL/);
assert.throws(()=>defineTool({...base,inputSchema:{type:"object",properties:{place:{type:"string"}}}}),/needs a description/);
assert.throws(()=>defineTool({...base,hosts:["https://example.org/"]}),/bare hostnames/);
assert.throws(()=>defineTool({...base,examples:[{args:{place:"Gent"},note:"a"}]}),/two examples/);
assert.throws(()=>defineTool({...base,examples:[{args:{town:"Gent"},note:"a"},{args:{place:"x"},note:"b"}]}),/unknown argument 'town'/);
assert.throws(()=>defineTool({...base,maxRequests:50}),/maxRequests/);
assert.deepEqual(checkAnswer({key_facts:["Population: undefined"],provenance:{source:"s"}}),["answer contains undefined, NaN or [object Object]"]);
assert.match(checkAnswer({provenance:{source:"s"}})[0],/key_facts/);
// a tool's client refuses every host it did not declare, and stops at its budget
const refused=await makeDovClient({fetchImpl:async()=>new Response("{}"),hosts:["geo.irceline.be"]}).get("https://www.dov.vlaanderen.be/geoserver/wfs");
assert.equal(refused.error,"upstream host not allowed");
const small=makeDovClient({fetchImpl:async()=>new Response("{}"),hosts:["geo.irceline.be"],maxRequests:1});
await small.get("https://geo.irceline.be/a");assert.match((await small.get("https://geo.irceline.be/b")).error,/budget/);

console.log(JSON.stringify({ok:true,tools:LIVE_TOOLS.length,replays:report}));

// A map service that does not answer must not be reported as "not flood-prone": replay flood_risk with the river map failing.
{
  const flood=LIVE_TOOLS.find(t=>t.name==="flood_risk"),fx=readFixture("flood_risk"),replay=replayFetch(fx);
  const fetchImpl=async url=>{if(/fluviaal/.test(url))throw Object.assign(new Error("timeout"),{name:"TimeoutError"});return replay(url)};
  const out=await atTime(fx.recordedAt,()=>flood.run(makeDovClient({fetchImpl,hosts:flood.hosts}),fx.args,{assets}));
  assert.doesNotMatch(out.key_facts[0],/any of the three/,"must not claim all three maps");
  assert.match(out.key_facts.join(" "),/Not checked: flooding from rivers.*not ruled out/);
  assert.equal(out.highest_class,undefined);assert.equal(out.complete,false);
}
console.log(JSON.stringify({ok:true,partial_answers:"flood_risk"}));
