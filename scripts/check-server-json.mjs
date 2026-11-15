#!/usr/bin/env node
// Checks server.json, the listing of this server in the official MCP Registry.
//   node scripts/check-server-json.mjs            offline: shape, limits, version equals MCP_VERSION
//   node scripts/check-server-json.mjs --live     also: the remote answers initialize with the same version
//   node scripts/check-server-json.mjs --registry also: the registry's own validator accepts the file and
//                                                  this version is not published yet (a version cannot be republished)
import {readFileSync} from "node:fs";
import {MCP_VERSION} from "../mcp-server.mjs";

const REGISTRY="https://registry.modelcontextprotocol.io";
const SCHEMA="https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
const args=new Set(process.argv.slice(2));
const server=JSON.parse(readFileSync(new URL("../server.json",import.meta.url),"utf8"));
const problems=[];
const need=(ok,msg)=>{if(!ok)problems.push(msg);};

need(server.$schema===SCHEMA,`$schema must be ${SCHEMA}`);
need(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(server.name??""),"name must be <namespace>/<server>");
// GitHub Actions OIDC grants io.github.<repository owner>/*; the publish workflow runs in vecture-be.
need(server.name?.startsWith("io.github.vecture-be/"),"name must stay in the io.github.vecture-be namespace");
need(typeof server.description==="string"&&server.description.length>=1&&server.description.length<=100,"description must be 1-100 characters");
need(!server.title||server.title.length<=100,"title must be at most 100 characters");
need(server.version===MCP_VERSION,`version ${server.version} must equal MCP_VERSION ${MCP_VERSION} in mcp-server.mjs`);
need(Array.isArray(server.remotes)&&server.remotes.length>0,"remotes must list the public endpoint");
for(const r of server.remotes??[])need(r.type==="streamable-http"&&/^https:\/\/[^/]+\/mcp$/.test(r.url),`remote ${r.url} must be streamable-http on https://<host>/mcp`);
for(const i of server.icons??[])need(/^https:\/\//.test(i.src)&&i.src.length<=255,`icon ${i.src} must be https and at most 255 characters`);
need(!server.packages,"this is a remote-only server: no packages");

async function rpc(url,body,headers={}){
  const r=await fetch(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),
    headers:{"content-type":"application/json",accept:"application/json, text/event-stream","mcp-protocol-version":"2025-06-18",...headers},body:JSON.stringify(body)});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  const text=await r.text();
  const json=(r.headers.get("content-type")??"").includes("event-stream")?text.split(/\r?\n/).filter(l=>l.startsWith("data:")).map(l=>JSON.parse(l.slice(5))).find(m=>m.id===body.id):JSON.parse(text);
  return json?.result;
}

if(!problems.length&&args.has("--live")){
  for(const r of server.remotes){
    try{
      const init=await rpc(r.url,{jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"server-json-check",version:"1"}}});
      need(init?.serverInfo?.version===server.version,`${r.url} reports version ${init?.serverInfo?.version}, server.json says ${server.version}: deploy first`);
    }catch(e){problems.push(`${r.url} did not answer initialize: ${e.message}`);}
  }
}

if(!problems.length&&args.has("--registry")){
  const v=await fetch(`${REGISTRY}/v0/validate`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(server),signal:AbortSignal.timeout(15000)});
  const vj=await v.json().catch(()=>({}));
  need(v.ok&&vj.valid===true,`registry validator rejected server.json: ${JSON.stringify(vj.issues??vj.errors??vj)}`);
  const existing=await fetch(`${REGISTRY}/v0.1/servers/${encodeURIComponent(server.name)}/versions/${encodeURIComponent(server.version)}`,{signal:AbortSignal.timeout(15000)});
  need(existing.status===404,existing.ok?`version ${server.version} is already published: bump MCP_VERSION and server.json together`:`registry lookup answered HTTP ${existing.status}`);
}

if(problems.length){for(const p of problems)console.error("server.json: "+p);process.exit(1);}
console.log(`server.json ok: ${server.name} ${server.version}${args.has("--live")?", live version matches":""}${args.has("--registry")?", registry validator accepts it and the version is new":""}`);
