// Load the merged catalogue (national DCAT + directly harvested portals + hand-reviewed atlas) from public/ as plain items.
// Shared by the SEO page builder; the MCP index builder performs the same merge.
import fs from "node:fs";
import path from "node:path";
import { curatedToItems, mergeItems } from "./build-mcp-index.mjs";

export async function loadCatalogueItems(pub){
  const idx=path.join(pub,"national-catalog.json"),national=[];
  let index={};
  if(fs.existsSync(idx)){index=JSON.parse(fs.readFileSync(idx,"utf8"));for(const c of index.chunks||[])national.push(...JSON.parse(fs.readFileSync(path.join(pub,c.file),"utf8")).items||[])}
  const hvPath=path.join(pub,"harvested-catalog.json"),hv=fs.existsSync(hvPath)?JSON.parse(fs.readFileSync(hvPath,"utf8")):{items:[]};
  if(!national.length&&!hv.items.length)throw new Error("no catalogue files in "+pub+"; run harvest first");
  const items=mergeItems(national,hv.items||[]);
  const [{ASSETS},{EXTRA_ATLAS_ASSETS},{COMPLETENESS_ASSETS},{COMPLETENESS_ASSETS_V2},{COMPLETENESS_ASSETS_V3},{COMPLETENESS_ASSETS_V4},{SOURCES},{EXTRA_SOURCES}]=await Promise.all([
    import("../public/dataset-atlas-v1.mjs"),import("../public/dataset-atlas-extra-v1.mjs"),import("../public/dataset-atlas-completeness-v1.mjs"),import("../public/dataset-atlas-completeness-v2.mjs"),
    import("../public/dataset-atlas-completeness-v3.mjs"),import("../public/dataset-atlas-completeness-v4.mjs"),import("../public/data.mjs"),import("../public/deep-data.mjs")]);
  items.push(...curatedToItems([...ASSETS,...EXTRA_ATLAS_ASSETS,...COMPLETENESS_ASSETS,...COMPLETENESS_ASSETS_V2,...COMPLETENESS_ASSETS_V3,...COMPLETENESS_ASSETS_V4],[...SOURCES,...EXTRA_SOURCES]));
  return{items,generatedAt:hv.generatedAt||index.generatedAt||null,linksCheckedAt:index.linkHealth?.at||hv.linkHealth?.at||null};
}
