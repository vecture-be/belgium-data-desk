// Download the catalogue of a deployed Belgium Data Desk instead of running the full harvest (which takes minutes and calls ~15 portals).
// Writes the same files the harvest writes (public/harvested-catalog.json, national-catalog*.json, catalogue-manifest.json) and rebuilds
// relay-index.mjs from them, so `npm run build:index` and `npm run dev` then behave like production.
//   node scripts/snapshot.mjs [--from=https://data.vecture.be]
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { RELAY_INDEX_PATH, writeRelayIndex } from "./relay-index-lib.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const pub=path.resolve(__dirname,"../public");
const arg=process.argv.find(a=>a.startsWith("--from="));
const origin=new URL(arg?arg.slice(7):process.env.DATA_DESK_ORIGIN||"https://data.vecture.be").origin;
const ua="Belgium-Data-Desk-snapshot/1.0 (+https://github.com/vecture-be/belgium-data-desk)";

async function get(name){
  const r=await fetch(origin+"/"+name,{headers:{"user-agent":ua,accept:"application/json"}});
  if(!r.ok)throw new Error(name+": HTTP "+r.status);
  const body=Buffer.from(await r.arrayBuffer());
  JSON.parse(body.toString("utf8"));   // fail loudly on an HTML error page
  fs.writeFileSync(path.join(pub,name),body);
  return body;
}
const sha=b=>createHash("sha256").update(b).digest("hex").slice(0,16);

const harvested=JSON.parse((await get("harvested-catalog.json")).toString("utf8"));
const national=JSON.parse((await get("national-catalog.json")).toString("utf8"));
for(const name of fs.readdirSync(pub))if(/^national-catalog-\d{3}\.json$/.test(name))fs.unlinkSync(path.join(pub,name));
const nationalItems=[];
for(const chunk of national.chunks||[]){
  if(!/^national-catalog-\d{3}\.json$/.test(chunk.file))throw new Error("unexpected chunk name "+chunk.file);
  const body=await get(chunk.file);
  if(chunk.sha256&&sha(body)!==chunk.sha256)console.warn("[snapshot] "+chunk.file+" checksum differs from its index entry (catalogue changed during download?)");
  nationalItems.push(...(JSON.parse(body.toString("utf8")).items||[]));
}
writeRelayIndex([...(harvested.items||[]),...nationalItems]);
const manifest={generatedAt:harvested.generatedAt||national.generatedAt,files:{}};
for(const [name,file] of [["harvested-catalog.json",path.join(pub,"harvested-catalog.json")],["national-catalog.json",path.join(pub,"national-catalog.json")],["relay-index.mjs",RELAY_INDEX_PATH]]){
  const body=fs.readFileSync(file);manifest.files[name]={sha256:sha(body),bytes:body.byteLength};
}
fs.writeFileSync(path.join(pub,"catalogue-manifest.json"),JSON.stringify(manifest)+"\n");
console.log("[snapshot] "+origin+": "+(harvested.items||[]).length+" harvested + "+nationalItems.length+" national records ("+(national.chunks||[]).length+" chunks). Next: npm run build:index");
