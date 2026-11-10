// The live answer tools, in the order tools/list shows them. Adding a tool = one file in this folder plus one line here
// (scripts/new-tool.mjs does both). Everything else (tools/list, dispatch, search hints, upstream allow-lists, contract tests)
// is derived from these definitions. See docs/adding-a-tool.md.
import subsurfaceAtLocation from "./subsurface-at-location.mjs";
import getSubsurfaceRecord from "./get-subsurface-record.mjs";
import searchSubsurface from "./search-subsurface.mjs";
import belgianStatistics from "./belgian-statistics.mjs";
import airQuality from "./air-quality.mjs";
import floodRisk from "./flood-risk.mjs";

export const LIVE_TOOLS=Object.freeze([
  subsurfaceAtLocation,
  getSubsurfaceRecord,
  searchSubsurface,
  belgianStatistics,
  airQuality,
  floodRisk
]);

const byName=new Map();
for(const t of LIVE_TOOLS){
  if(byName.has(t.name))throw new Error("tool "+t.name+" is registered twice");
  byName.set(t.name,t);
}
export const liveTool=name=>byName.get(name)||null;

/** Search hints: [words, tool name, hint] for each tool that declares routing. A query word may match only one tool. */
export const ROUTING=Object.freeze(LIVE_TOOLS.filter(t=>t.routing).map(t=>[t.routing.words,t.name,t.routing.hint]));
