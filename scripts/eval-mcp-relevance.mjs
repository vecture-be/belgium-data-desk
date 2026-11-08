// Relevance regression for the MCP search: each query must surface a plausible record in the top 5.
//   node scripts/eval-mcp-relevance.mjs [--min 0.85] [--min-best 0.8]      (needs public/mcp built by scripts/build-mcp-index.mjs)
// Expectations are case-insensitive regexes over "title | publisher | snippet". A hit means "something an informed person would
// accept is in the first five results" — it measures regressions, not absolute quality.
// Queries with a "best" regex also check that the answer a Belgian data expert would give (Statbel population tables, the KBO
// enterprise register, IRCEL measurements...) is in the top 3, matched over "title | publisher". That is the stricter number.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callTool } from "../mcp-server.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url)),pub=path.resolve(__dirname,"../public");
const args=process.argv.slice(2),opt=(name,def)=>args.includes(name)?Number(args[args.indexOf(name)+1]):def;
const min=opt("--min",0.85),minBest=opt("--min-best",0.8);
const queries=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../eval-relevance/queries.json"),"utf8"));
const env={ASSETS:{fetch:async req=>{const f=path.join(pub,new URL(req.url).pathname);return fs.existsSync(f)?new Response(fs.readFileSync(f)):new Response("nf",{status:404})}}};

let hits=0,bestHits=0,bestTotal=0;const misses=[],bestMisses=[],rows=[];let maxReads=0;
for(const {q,expect,best} of queries){
  let reads=0;const counting={ASSETS:{fetch:async r=>{reads++;return env.ASSETS.fetch(r)}}};
  const res=(await callTool(counting,"https://eval.local","search_datasets",{query:q,limit:5})).structuredContent;
  maxReads=Math.max(maxReads,reads);
  const results=res.results||[];
  const re=new RegExp(expect,"i"),rank=results.findIndex(r=>re.test(r.title+" | "+r.publisher+" | "+r.snippet));
  if(rank>=0)hits++;else misses.push(q);
  let bestRank=null;
  if(best){
    bestTotal++;
    const i=results.slice(0,3).findIndex(r=>new RegExp(best,"i").test(r.title+" | "+r.publisher));
    if(i>=0){bestHits++;bestRank=i+1}else bestMisses.push(q);
  }
  rows.push({q,rank:rank>=0?rank+1:null,best:best?bestRank??"miss":"",top:results[0]?.title?.slice(0,50)||""});
}
const rate=hits/queries.length,bestRate=bestTotal?bestHits/bestTotal:1;
const summary="MCP relevance: "+hits+"/"+queries.length+" queries have an acceptable result in the top 5 ("+(100*rate).toFixed(0)+"%); "+
  "expert answer in the top 3 for "+bestHits+"/"+bestTotal+" ("+(100*bestRate).toFixed(0)+"%); max asset reads per query "+maxReads;
console.log(summary);
for(const r of rows)console.log((r.rank?"  ok  #"+r.rank:"  MISS ")+(r.best===""?"        ":r.best==="miss"?"  BEST- ":"  best#"+r.best)+"  "+r.q+"  ->  "+r.top);
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,"### "+summary+"\n"+(misses.length?"Misses: "+misses.map(m=>"`"+m+"`").join(", ")+"\n":"")+
  (bestMisses.length?"Expert answer not in top 3: "+bestMisses.map(m=>"`"+m+"`").join(", ")+"\n":""));
if(rate<min){console.error("below threshold "+min);process.exit(1)}
if(bestRate<minBest){console.error("expert-answer rate below threshold "+minBest);process.exit(1)}
