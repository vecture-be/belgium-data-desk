// Run a tool's replay example against the real services and save every upstream answer as its test fixture.
//   node scripts/tool-record.mjs <tool_name> [...]     (or --all)
// Run it when you add a tool or change what it asks upstream; commit tools/fixtures/<tool>.json with the change.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_TOOLS } from "../tools/index.mjs";
import { makeDovClient } from "../dov.mjs";
import { checkAnswer } from "../lib/tool-contract.mjs";
import { recordingFetch, writeFixture } from "../lib/fixtures.mjs";

const pub=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../public");
const assets={json:async p=>{try{return JSON.parse(fs.readFileSync(path.join(pub,p),"utf8"))}catch{return null}}};
const names=process.argv.slice(2);
const tools=names.includes("--all")?LIVE_TOOLS:LIVE_TOOLS.filter(t=>names.includes(t.name));
if(!tools.length){console.error("usage: node scripts/tool-record.mjs <tool_name> | --all\ntools: "+LIVE_TOOLS.map(t=>t.name).join(", "));process.exit(2)}
let failed=0;
for(const tool of tools){
  const ex=tool.examples.find(e=>e.replay)||tool.examples[0],calls=[],recordedAt=new Date().toISOString();
  const client=makeDovClient({fetchImpl:recordingFetch(calls),hosts:tool.hosts,maxRequests:tool.maxRequests});
  const out=await tool.run(client,ex.args,{assets});
  const problems=out?.error?["the example answered an error: "+out.error]:checkAnswer(out);
  if(problems.length){failed++;console.error("✗ "+tool.name+": "+problems.join("; ")+" (fixture not written)");continue}
  writeFixture(tool.name,{args:ex.args,recordedAt,calls});
  const kb=Math.round(calls.reduce((n,c)=>n+c.body.length,0)/1024);
  console.log("✓ "+tool.name+": "+calls.length+" upstream calls recorded ("+kb+" KiB) — "+out.key_facts[0].slice(0,100));
}
process.exit(failed?1:0);
