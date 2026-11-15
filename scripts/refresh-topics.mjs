// Re-apply the current topic rules (public/dataset-taxonomy-v1.mjs) to the stored catalogue, so a rule change reaches the website
// and the MCP index at the next deploy instead of waiting for the weekly harvest. Rewrites public/national-catalog-*.json,
// public/harvested-catalog.json and their checksums in the indexes and manifest. Records whose topic is unchanged are left as they are.
//   node scripts/refresh-topics.mjs
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { topicOf } from "../public/dataset-taxonomy-v1.mjs";

const pub=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../public");
const sha=b=>createHash("sha256").update(b).digest("hex").slice(0,16);
let changed=0,total=0;
const refresh=items=>{for(const it of items||[]){total++;const t=topicOf(it);if(t!==it.topic){it.topic=t;changed++}}};
const manifestPath=path.join(pub,"catalogue-manifest.json"),manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,"utf8")):{files:{}};
const indexPath=path.join(pub,"national-catalog.json");
if(fs.existsSync(indexPath)){
  const index=JSON.parse(fs.readFileSync(indexPath,"utf8"));
  for(const c of index.chunks||[]){
    const fp=path.join(pub,c.file);if(!fs.existsSync(fp))continue;
    const page=JSON.parse(fs.readFileSync(fp,"utf8"));refresh(page.items);
    const body=JSON.stringify(page)+"\n";fs.writeFileSync(fp,body);c.bytes=Buffer.byteLength(body);c.sha256=sha(body);
  }
  const body=JSON.stringify(index)+"\n";fs.writeFileSync(indexPath,body);
  manifest.files["national-catalog.json"]={sha256:sha(body),bytes:Buffer.byteLength(body)};
}
const hvPath=path.join(pub,"harvested-catalog.json");
if(fs.existsSync(hvPath)){
  const hv=JSON.parse(fs.readFileSync(hvPath,"utf8"));refresh(hv.items);
  const body=JSON.stringify(hv)+"\n";fs.writeFileSync(hvPath,body);
  manifest.files["harvested-catalog.json"]={sha256:sha(body),bytes:Buffer.byteLength(body)};
}
if(fs.existsSync(manifestPath))fs.writeFileSync(manifestPath,JSON.stringify(manifest)+"\n");
console.log("[topics] "+changed+" of "+total+" records changed topic under the current rules");
