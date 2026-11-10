// Human-readable, evidence-first review notes from the bounded GIPOD LDES report.
// Pure rendering: no model, no social-media posting, no invented spatial context.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const plain=v=>String(v??"").replace(/[\r\n\t]+/g," ").replace(/\s+/g," ").replace(/[<>]/g,"").slice(0,240);
const quote=v=>plain(v).replaceAll("*","").replaceAll("#","").replaceAll("[","").replaceAll("]","");
const truncate=(v,max=180)=>v.length>max?v.slice(0,max-1)+"…":v;
const label=x=>plain(x?.label||x?.id||x||"unknown");
const time=x=>plain(x||"not given").replace("T"," ").replace(/\.000Z$/,"Z");
const formatPeriods=ps=>(Array.isArray(ps)?ps:[]).map(p=>time(p.start)+" to "+time(p.end)).join("; ")||"not specified";
const fmtConsequence=xs=>(Array.isArray(xs)?xs:[]).map(x=>
  (x.zone_id?"zone "+plain(x.zone_id).split("/").at(-1)+": ":"")+label(x)).join("; ")||"none";
const summary=x=>{
  if(x?.field==="mobility_consequences")
    return{before:fmtConsequence(x.before),after:fmtConsequence(x.after)};
  if(x?.field==="periods")
    return{before:formatPeriods(x.before),after:formatPeriods(x.after)};
  if(x?.field==="status")
    return{before:label(x.before),after:label(x.after)};
  if(x?.field==="description")
    return{before:plain(x.before),after:plain(x.after)};
  return{before:"Changed (inspect source version)",after:"Changed (inspect source version)"};
};
const link=id=>/^https:\/\/gipod\.api\.vlaanderen\.be\/api\/v1\/mobility-hindrances\/\d+\/\d+$/.test(id||"")
  ?"[source version]("+id+")":plain(id||"unknown");

export function renderGipodReview(report,{maxCandidates=20}={}){
  if(report?.kind!=="ldes_change_evidence"||report?.history_complete!==false)
    throw Error("Expected an explicitly partial GIPOD LDES change-evidence report");
  if(!Array.isArray(report?.review_queue))throw Error("No per-entity review queue present");
  if(!Number.isInteger(maxCandidates)||maxCandidates<1||maxCandidates>100)
    throw Error("maxCandidates must be 1..100");
  const editorial=report.review_queue.filter(x=>x.review_channel==="editorial_review");
  const technical=report.review_queue.length-editorial.length;
  const lines=[
    "# GIPOD public-data change review — partial sample",
    "",
    "This is a **research review queue**, not verified road-closure news, not a complete daily feed, and not suitable for automatic posting.",
    "",
    "- Publisher: "+plain(report.source),
    "- Publication entry point: "+plain(report.requested_since||"unspecified"),
    "- Distinct members processed: "+Number(report.counts?.unique_valid||0),
    "- Net change candidates: "+report.review_queue.length,
    "- Editorial review candidates: "+editorial.length,
    "- Technical-only candidates: "+technical,
    "- Historical/window completeness: **NOT ESTABLISHED**",
    "",
    "## Published changes requiring human review", ""
  ];
  if(!editorial.length)lines.push("None in this bounded sample. This does **not** mean no changes were published.");
  for(const c of editorial.slice(0,maxCandidates)){
    lines.push("### "+plain(c.title));
    lines.push("");
    lines.push("- Publisher entity ID: "+plain(c.entity_id));
    lines.push("- Latest publication timestamp: "+time(c.published_at));
    lines.push("- Published status: "+label(c.published_status));
    lines.push("- Observed versions of this entity: "+Number(c.versions_in_sample||0));
    lines.push("- Evidence: "+link(c.first_evidence_member)+" → "+link(c.last_evidence_member));
    for(const change of c.before_after||[]){
      if(change.field==="zone_geometry"||change.field==="zone_structure"||change.field==="schedule_hash")continue;
      const v=summary(change);
      lines.push("- "+plain(change.field)+": **"+truncate(quote(v.before))+"** → **"+truncate(quote(v.after))+"**");
    }
    lines.push("- Planned period(s) in latest published version: "+truncate(formatPeriods(c.planned_periods),350));
    lines.push("- **Next verification:** check publisher's actual geometry, planned effective time, and version history; do not infer present physical restrictions");
    lines.push("");
  }
  if(editorial.length>maxCandidates)lines.push("Additional "+(editorial.length-maxCandidates)+" editorial candidates omitted.");
  lines.push("## Interpretation limits", "",
    "- First seen in the sample is not new roadwork; before/after is not necessarily complete history.",
    "- Changes in publisher records are not evidence that works have started or restrictions are currently in force.",
    "- The producer's GIPOD statuses and periods determine whether a claim is even eligible for review.",
    "- EPSG:31370 geometry envelopes are not street addresses or exact intersection tests.",
    "- Absence of candidates never establishes that nothing changed in a time period.",
    "");
  return lines.join("\n");
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  if(process.argv.length!==3){console.error("Usage: node scripts/ldes-gipod-review.mjs change-evidence.json");process.exitCode=2}
  else console.log(renderGipodReview(JSON.parse(fs.readFileSync(process.argv[2],"utf8"))));
}
