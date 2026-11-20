// Read-only synthetic CPU profile of cold vs warm MCP search shards.
// Usage: npm run bench:mcp
// Uses fixture assets and Node CPU time, not production traffic or Cloudflare CPU billing.
// No external requests, no assertions on hardware-dependent latency.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {buildIndex,writeIndex} from "./build-mcp-index.mjs";

const N=Number(process.env.BDD_BENCH_RECORDS)||4000;
assert.ok(Number.isInteger(N)&&N>=100&&N<=23000);
const topics=["population","energy","mobility","water","air"];
const items=Array.from({length:N},(_,i)=>({
  id:"benchmark:"+i,
  title:topics[i%topics.length]+" municipality observations "+(i%150),
  description:"Official synthetic data for Belgian municipalities "+(i%37)+" and monthly historical indicators",
  provider:"Synthetic public publisher",
  dataKind:"dataset",topic:topics[i%topics.length],
  licenseFamily:"open",distributions:[{format:"CSV",url:"https://example.invalid/data/"+i+".csv"}]
}));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"bdd-mcp-cpu-"));
try {
  const built=buildIndex(items);
  writeIndex(path.join(dir,"mcp"),built,{records:items.length,ranges:built.ranges});
  let assetFetches=0;
  const env={ASSETS:{fetch:async request=>{
    assetFetches++;
    const p=path.join(dir,new URL(request.url).pathname);
    return fs.existsSync(p)?new Response(fs.readFileSync(p)):new Response("missing",{status:404});
  }}};
  const request=()=>new Request("https://bench.invalid/mcp",{method:"POST",
    body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",
      params:{name:"search_datasets",arguments:{query:"population municipality",limit:10}}})});
  async function measure(handler){
    const beforeFetches=assetFetches,beforeCpu=process.cpuUsage(),start=performance.now();
    const response=await handler(request(),env);
    const parsed=await response.json();
    const cpu=process.cpuUsage(beforeCpu);
    assert.equal(response.status,200);
    assert.ok(Array.isArray(parsed.result.structuredContent.results));
    return {cpu_ms:(cpu.user+cpu.system)/1000,wall_ms:performance.now()-start,
      asset_fetches:assetFetches-beforeFetches,result_count:parsed.result.structuredContent.results.length};
  }
  const cold=[];
  for(let i=0;i<5;i++){
    // A distinct ES module owns a distinct WeakMap of immutable shard caches.
    const {handleMcp}=await import("../mcp-server.mjs?isolated="+i);
    cold.push(await measure(handleMcp));
  }
  const {handleMcp}=await import("../mcp-server.mjs");
  for(let i=0;i<3;i++)await measure(handleMcp);
  const warm=[];
  for(let i=0;i<20;i++)warm.push(await measure(handleMcp));
  const quantile=(values,p)=>{
    const sorted=values.slice().sort((a,b)=>a-b);
    return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)];
  };
  const summarise=samples=>({
    runs:samples.length,cpu_p50_ms:+quantile(samples.map(x=>x.cpu_ms),.5).toFixed(2),
    cpu_p95_ms:+quantile(samples.map(x=>x.cpu_ms),.95).toFixed(2),
    wall_p50_ms:+quantile(samples.map(x=>x.wall_ms),.5).toFixed(2),
    asset_fetches_p50:quantile(samples.map(x=>x.asset_fetches),.5),
    results:samples[0].result_count
  });
  console.log(JSON.stringify({kind:"synthetic-mcp-search-profile",records:N,
    warning:"Node fixture CPU is not Cloudflare CPU; do not treat measurements as production benchmarks",
    cold:summarise(cold),warm:summarise(warm)},null,2));
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}
