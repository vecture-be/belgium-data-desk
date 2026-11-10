// Record and replay upstream answers for live tools, so their tests run offline against what the real service said.
// A fixture is tools/fixtures/<tool>.json: the example's arguments, the time it was recorded, and every upstream call
// (URL, status, content type, body gzip+base64). Replay serves those answers by URL and freezes the clock at the recording
// time, because tools build time windows ("last 24 hours") into their URLs. A request that is not in the fixture fails loudly:
// the tool changed what it asks for, so record again (npm run tool:record -- <name>).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../tools/fixtures");
export const fixturePath=name=>path.join(dir,name+".json");
export const readFixture=name=>{try{return JSON.parse(fs.readFileSync(fixturePath(name),"utf8"))}catch{return null}};

export function recordingFetch(calls){
  return async(url,init={})=>{
    const {cf,signal,...rest}=init;
    const r=await fetch(url,{...rest,signal});
    const body=Buffer.from(await r.arrayBuffer());
    calls.push({url:String(url),status:r.status,contentType:r.headers.get("content-type")||"",body:zlib.gzipSync(body).toString("base64")});
    return new Response(body,{status:r.status,headers:{"content-type":r.headers.get("content-type")||""}});
  };
}
export function writeFixture(name,{args,recordedAt,calls}){
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(fixturePath(name),JSON.stringify({tool:name,args,recordedAt,calls},null,1)+"\n");
}

export function replayFetch(fixture){
  const byUrl=new Map(fixture.calls.map(c=>[c.url,c]));
  return async url=>{
    const c=byUrl.get(String(url));
    if(!c)throw new Error("not in the fixture (record it again): "+String(url).slice(0,160));
    return new Response(zlib.gunzipSync(Buffer.from(c.body,"base64")),{status:c.status,headers:{"content-type":c.contentType}});
  };
}

/** Runs fn with Date (and Date.now) frozen at `iso`, so time-windowed URLs match the recording. */
export async function atTime(iso,fn){
  const Real=globalThis.Date,t0=Real.parse(iso);
  class Frozen extends Real{constructor(...a){a.length?super(...a):super(t0)}static now(){return t0}}
  globalThis.Date=Frozen;
  try{return await fn()}finally{globalThis.Date=Real}
}
