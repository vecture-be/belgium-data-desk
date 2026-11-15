// Run one tool against the real services with any arguments and print the answer (a development aid; nothing is recorded).
//   node scripts/try-tool.mjs <tool_name> '<json args>' [--full]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_TOOLS } from "../tools/index.mjs";
import { makeDovClient } from "../dov.mjs";
import { checkAnswer } from "../lib/tool-contract.mjs";

const pub=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../public");
const assets={json:async p=>{try{return JSON.parse(fs.readFileSync(path.join(pub,p),"utf8"))}catch{return null}}};
const [name,raw="{}",flag]=process.argv.slice(2);
const tool=LIVE_TOOLS.find(t=>t.name===name);
if(!tool){console.error("tools: "+LIVE_TOOLS.map(t=>t.name).join(", "));process.exit(2)}
const client=makeDovClient({hosts:tool.hosts,maxRequests:tool.maxRequests});
const t0=Date.now(),out=await tool.run(client,JSON.parse(raw),{assets});
console.log(flag==="--full"?JSON.stringify(out,null,1):JSON.stringify(out.error?out:{key_facts:out.key_facts},null,1));
console.error("requests "+client.used+"/"+tool.maxRequests+", "+(Date.now()-t0)+" ms, "+JSON.stringify(out).length+" bytes, contract: "+(JSON.stringify(checkAnswer(out))));
