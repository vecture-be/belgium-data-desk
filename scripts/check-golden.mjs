// Answer-level regression checks: questions with officially known answers (eval-relevance/golden-facts.json) asked to a running
// server through MCP, as an assistant would. Run after every deploy; a failure means an answer changed, whether through our code or
// a source that changed meaning, format or figures.
//   node scripts/check-golden.mjs [origin]        default https://data.vecture.be; exit code 1 on any failed check
// Each fact: {question, tool, args, expect: [{path, equals | between: [lo, hi] | matches: "regex"}], source, why}.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const origin=(process.argv[2]||"https://data.vecture.be").replace(/\/$/,"");
const file=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../eval-relevance/golden-facts.json");
const facts=JSON.parse(fs.readFileSync(file,"utf8"));
const get=(o,p)=>p.split(".").reduce((v,k)=>v==null?v:v[/^\d+$/.test(k)?Number(k):k],o);

export function checkExpect(answer,expect){
  const problems=[];
  for(const e of expect){
    const v=get(answer,e.path);
    if("equals" in e&&v!==e.equals)problems.push(e.path+" is "+JSON.stringify(v)+", expected "+JSON.stringify(e.equals));
    if(e.between&&!(typeof v==="number"&&v>=e.between[0]&&v<=e.between[1]))problems.push(e.path+" is "+JSON.stringify(v)+", expected between "+e.between.join(" and "));
    if(e.matches&&!new RegExp(e.matches,"i").test(String(v??"")))problems.push(e.path+" is "+JSON.stringify(v)+", expected to match /"+e.matches+"/");
  }
  return problems;
}

async function main(){
  let failed=0;
  for(const f of facts){
    let answer;
    try{
      const r=await fetch(origin+"/mcp",{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream"},
        body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:f.tool,arguments:f.args}})});
      answer=JSON.parse((await r.json()).result.content[0].text);
    }catch(e){answer={error:"no answer: "+e.message}}
    const problems=answer.error?["answered an error: "+answer.error]:checkExpect(answer,f.expect);
    console.log((problems.length?"FAIL ":"PASS ")+f.question+(problems.length?"\n     "+problems.join("\n     ")+"\n     source: "+f.source:""));
    if(problems.length)failed++;
  }
  console.log(facts.length-failed+"/"+facts.length+" golden facts hold on "+origin);
  process.exit(failed?1:0);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
