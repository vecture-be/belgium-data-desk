// Opt-in, bounded harvest using the publisher-recommended TREEcg LDES client.
// Only ignored .cache/ state is written. No daemon, deployment, or continuous polling.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { analyseGipodVersions, normalizeGipodMember, SOURCE } from "./ldes-gipod-events.mjs";

const require=createRequire(import.meta.url);
function argsOf(argv){
  const a=Object.fromEntries(argv.reduce((p,v,i)=>v.startsWith("--")?[...p,[v.slice(2),argv[i+1]]]:p,[]));
  const since=String(a.since||""),limit=Number(a.limit||30),out=path.resolve(a.out||".cache/ldes-gipod");
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(since)||!Number.isFinite(Date.parse(since)))
    throw Error("Pass --since YYYY-MM-DDTHH:MM:SSZ; earlier history is NOT covered");
  if(!Number.isInteger(limit)||limit<1||limit>250)throw Error("--limit must be 1..250");
  return{since,limit,out};
}
async function main(){
  const {since,limit,out}=argsOf(process.argv.slice(2));
  let lib;
  try{lib=require("@treecg/actor-init-ldes-client")}
  catch{throw Error("Install optional client: npm i --no-save --package-lock=false @treecg/actor-init-ldes-client@4.0.9")}
  if(typeof lib.newEngine!=="function")throw Error("Unsupported TREEcg client API");
  const contextURL="https://gipod.api.vlaanderen.be/api/v1/context/gipod.jsonld";
  const res=await fetch(contextURL,{signal:AbortSignal.timeout(20000)});
  if(!res.ok)throw Error("GIPOD JSON-LD context HTTP "+res.status);
  const jsonLdContext=await res.json();
  fs.mkdirSync(out,{recursive:true});
  const manifestFile=path.join(out,"manifest.json"),stateFile=path.join(out,"state.json"),
    membersFile=path.join(out,"members.json"),reportFile=path.join(out,"change-evidence.json");
  if(fs.existsSync(manifestFile)){
    const prev=JSON.parse(fs.readFileSync(manifestFile,"utf8"));
    if(prev.since!==since||prev.source!==SOURCE)
      throw Error("Checkpoint belongs to another stream/window; choose a new --out directory");
  }
  const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,"utf8")):null;
  const existing=fs.existsSync(membersFile)?JSON.parse(fs.readFileSync(membersFile,"utf8")):[];
  if(!Array.isArray(existing)||existing.length>1800)throw Error("Sample already too large; use a new --out directory");
  const buffered=[...existing],seen=new Set(existing.map(m=>String(m.id||m.object?.id||"")));
  let received=0,invalid=0,bufferOverflow=false,bytes=Buffer.byteLength(JSON.stringify(buffered));
  const url=new URL(SOURCE);url.searchParams.set("generatedAtTime",since);
  const engine=new lib.newEngine();
  const stream=engine.createReadStream(url.toString(),{
    representation:"Object",emitMemberOnce:true,disableSynchronization:true,
    jsonLdContext,processedURIsCount:3000
  },state||undefined);
  let finished=false,stopping=false;
  const atomic=(file,obj)=>{
    const tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify(obj));fs.renameSync(tmp,file);
  };
  const finalize=async reason=>{
    if(finished)return;finished=true;
    let checkpoint=null;
    try{checkpoint=stream.exportState()}catch(e){console.warn("No checkpoint: "+e.message)}
    // Write members BEFORE checkpoint: a crash cannot advance the cursor past unpersisted data.
    atomic(membersFile,buffered);
    const report=analyseGipodVersions(buffered,{sincePublishedAt:since});
    atomic(reportFile,report);
    // Never advance the cursor when the data cap forced us to discard a member.
    if(checkpoint&&!bufferOverflow)atomic(stateFile,checkpoint);
    atomic(manifestFile,{source:SOURCE,since,checkpointed:!!checkpoint&&!bufferOverflow,
      stop_reason:reason,history_complete:false,members:buffered.length,
      buffer_overflow:bufferOverflow});
    const byKind=Object.fromEntries([...new Set(report.events.map(e=>e.kind))]
      .map(k=>[k,report.events.filter(e=>e.kind===k).length]));
    console.log(JSON.stringify({kind:"bounded_ldes_sample",since,received,
      target_limit:limit,retained:buffered.length,parsing_issues:invalid,report_errors:report.errors.length,
      before_requested_since:report.events.filter(e=>e.published_at&&e.published_at<since).length,
      byKind,revisions:report.counts.revisions,review_first:report.counts.actionable_revisions,
      timestamp_ties_resolved:report.counts.timestamp_ties_resolved,
      net_review_candidates:report.review_queue_count,
      checkpointed:!!checkpoint&&!bufferOverflow,buffer_overflow:bufferOverflow,
      history_complete:false}));
    if(bufferOverflow)throw Error("Bounded buffer overflow: checkpoint withheld to avoid losing events");
  };
  let timer;
  const done=new Promise((resolve,reject)=>{
    const stop=()=>{if(stopping||finished)return;stopping=true;stream.pause()};
    timer=setTimeout(stop,60000);
    stream.on("data",member=>{
      received++;
      if(normalizeGipodMember(member).error)invalid++;
      const key=String(member.id||member.object?.id||"");
      if(!seen.has(key)){
        const encoded=JSON.stringify(member),size=Buffer.byteLength(encoded);
        if(bytes+size<=7*1024*1024){seen.add(key);buffered.push(member);bytes+=size}
        else{bufferOverflow=true;stop();return}
      }
      if(received>=limit)stop();
    });
    stream.on("pause",()=>finalize("bounded_pause").then(resolve,reject));
    stream.on("end",()=>finalize("end").then(resolve,reject));
    stream.on("error",reject);
  });
  try{await done}finally{clearTimeout(timer)}
}
main().catch(e=>{console.error("GIPOD live evidence FAILED:",e.stack||e.message);process.exitCode=1});
