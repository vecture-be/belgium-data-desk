// Offline GIPOD LDES change interpretation, not an LDES client or creation detector.
// Input: a bounded JSON array of {id, object} from a standards-compliant LDES client.
// No project dependencies or network calls.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

export const SOURCE="https://gipod.api.vlaanderen.be/api/v1/ldes/mobility-hindrances";
const arr=x=>x==null?[]:Array.isArray(x)?x:[x];
const val=x=>x&&typeof x==="object"&&"value" in x?x.value:x;
const str=x=>typeof x==="string"?x.trim():"";
const iso=x=>typeof x==="string"&&/^\d{4}-\d\d-\d\dT/.test(x)&&Number.isFinite(Date.parse(x))?new Date(x).toISOString():null;
const stable=x=>JSON.stringify(x,(k,v)=>v&&!Array.isArray(v)&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
const hash=x=>createHash("sha256").update(stable(x)).digest("hex").slice(0,20);
const periods=x=>arr(x).filter(v=>v&&typeof v==="object").map(v=>({start:iso(val(v.start)),end:iso(val(v.end))}))
  .filter(v=>v.start||v.end).sort((a,b)=>stable(a).localeCompare(stable(b)));
const term=v=>({id:str(val(v?.id))||null,label:str(val(v?.prefLabel))||null});
const memberIRI=raw=>{
  const id=str(raw);
  if(/^https?:\/\//i.test(id))return id;
  if(/^\/?api\/v1\/mobility-hindrances\/\d+(?:\/\d+)?$/.test(id))
    return "https://gipod.api.vlaanderen.be/"+id.replace(/^\//,"");
  return null;
};
const versionIdentity=raw=>str(val(raw)).match(/(?:^|\/)api\/v1\/mobility-hindrances\/(\d+)\/?$/)?.[1]||null;
const iriVersion=memberId=>{
  const match=memberId.match(/\/api\/v1\/mobility-hindrances\/(\d+)\/(\d+)$/);
  return match?{entity:match[1],position:match[2]}:null;
};
const comparePosition=(a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0;
// The publisher documents EPSG:31370. This is a conservative envelope, not a polygon-intersection claim.
const envelope=wkt=>{
  const text=str(val(wkt));
  if(!/^(?:<[^>]+>\s*)?(?:POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON)\s*\(/i.test(text))return null;
  const pairs=[...text.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)(?=[,\s)])/g)].map(m=>[+m[1],+m[2]]);
  if(!pairs.length||pairs.length>25000||pairs.some(([x,y])=>x<0||x>310000||y<0||y>300000))return null;
  return [Math.min(...pairs.map(p=>p[0])),Math.min(...pairs.map(p=>p[1])),
    Math.max(...pairs.map(p=>p[0])),Math.max(...pairs.map(p=>p[1]))].map(n=>Math.round(n*100)/100);
};
const zones=x=>arr(x).filter(v=>v&&typeof v==="object").map(z=>{
  const wkt=str(val(z.geometry?.wkt));
  return{id:str(val(z.id))||null,
    consequences:arr(z.consequence).filter(Boolean).map(term).filter(c=>c.id||c.label)
      .sort((a,b)=>stable(a).localeCompare(stable(b))),
    geometry_hash:wkt?hash(wkt):null,geometry_envelope_31370:wkt?envelope(wkt):null};
}).sort((a,b)=>stable(a).localeCompare(stable(b)));

export function normalizeGipodMember(member){
  const o=member?.object||member,memberId=memberIRI(member?.id||o?.id),published=iso(val(o?.generatedAtTime));
  if(!memberId)return{error:"unrecognized_member_iri",member_id:str(member?.id||o?.id)||null};
  if(!published)return{error:"missing_generated_at_time",member_id:memberId};
  const explicit=String(val(o?.gipodId)??"").trim();
  const entityFromId=/^\d+$/.test(explicit)?explicit:null;
  const entityFromVersion=versionIdentity(o?.isVersionOf);
  if(entityFromId&&entityFromVersion&&entityFromId!==entityFromVersion)
    return{error:"conflicting_publisher_entity_identity",member_id:memberId,
      identifiers:[entityFromId,entityFromVersion]};
  const uri=iriVersion(memberId),resolvedId=entityFromId||entityFromVersion||null;
  if(uri&&resolvedId&&uri.entity!==resolvedId)
    return{error:"member_iri_identity_mismatch",member_id:memberId,
      identifiers:[uri.entity,resolvedId]};
  return{
    member_id:memberId,entity_id:resolvedId,
    version_position:uri?.position||null,
    version_of:str(val(o?.isVersionOf))||null,published_at:published,
    created_at:iso(val(o?.createdOn)),last_modified_at:iso(val(o?.lastModifiedOn)),
    source_event_name:str(val(o?.eventName))||null,source_url:SOURCE,
    snapshot:{status:term(o?.status),description:str(val(o?.description))||null,
      periods:periods(o?.period),schedule_hash:o?.timeSchedule?hash(o.timeSchedule):null,
      zones:zones(o?.zone)}
  };
}

function changes(previous,current){
  const result=[];
  for(const field of ["status","description","periods","schedule_hash"]){
    if(stable(previous[field])!==stable(current[field]))
      result.push({field,before:previous[field],after:current[field]});
  }
  if(stable(previous.zones)!==stable(current.zones)){
    const cs=zs=>zs.flatMap(z=>z.consequences.map(c=>({zone_id:z.id,...c}))).sort((a,b)=>stable(a).localeCompare(stable(b)));
    if(stable(cs(previous.zones))!==stable(cs(current.zones)))
      result.push({field:"mobility_consequences",before:cs(previous.zones),after:cs(current.zones)});
    const gs=zs=>zs.map(z=>({zone_id:z.id,geometry_hash:z.geometry_hash,geometry_envelope_31370:z.geometry_envelope_31370}));
    if(stable(gs(previous.zones))!==stable(gs(current.zones)))
      result.push({field:"zone_geometry",before:gs(previous.zones),after:gs(current.zones)});
    if(!result.some(r=>r.field==="mobility_consequences"||r.field==="zone_geometry"))
      result.push({field:"zone_structure",before:previous.zones.map(z=>z.id),after:current.zones.map(z=>z.id)});
  }
  return result;
}
function priority(changes){
  const f=new Set(changes.map(c=>c.field));
  if(["mobility_consequences","periods","schedule_hash"].some(x=>f.has(x)))return"review_first";
  if(["status","zone_geometry","zone_structure"].some(x=>f.has(x)))return"review";
  return changes.length?"minor":"none";
}
function headline(id,changes){
  const f=new Set(changes.map(c=>c.field));
  if(f.has("mobility_consequences"))return"GIPOD "+id+": published mobility consequence revised";
  if(f.has("periods")||f.has("schedule_hash"))return"GIPOD "+id+": planned timetable revised";
  if(f.has("status"))return"GIPOD "+id+": published status changed";
  if(f.has("zone_geometry"))return"GIPOD "+id+": hindrance geometry revised";
  return"GIPOD "+id+": version updated";
}

/** Interpret only supplied versions; never assert complete history, first creation or physical impact. */
// One editorial candidate per entity, never one per event-store version.
// Compare the last version in the requested window with the closest observed baseline.
// The input is still a partial sample: no publication or real-world event is inferred.
export function buildReviewQueue(versions,{sincePublishedAt=null,blockedEntities=[]}={}){
  const since=sincePublishedAt?iso(sincePublishedAt):null;
  if(sincePublishedAt&&!since)throw Error("Invalid sincePublishedAt timestamp");
  const blocked=new Set(blockedEntities),byEntity=new Map();
  for(const v of versions){
    if(!v.entity_id||blocked.has(v.entity_id))continue;
    const list=byEntity.get(v.entity_id)||[];list.push(v);byEntity.set(v.entity_id,list);
  }
  const queue=[];
  for(const [entityId,list] of byEntity){
    const chronological=[...list].sort((a,b)=>{
      if(a.version_position&&b.version_position)
        return comparePosition(a.version_position,b.version_position);
      return a.published_at.localeCompare(b.published_at)||a.member_id.localeCompare(b.member_id);
    });
    const recent=chronological.filter(v=>!since||v.published_at>=since);
    if(!recent.length)continue;
    const first=recent[0],latest=recent.at(-1),firstIndex=chronological.indexOf(first);
    const baseline=firstIndex?chronological[firstIndex-1]:first;
    if(baseline===latest)continue;
    const diff=changes(baseline.snapshot,latest.snapshot),p=priority(diff);
    // We publish research/evidence candidates, not raw administrative revision chatter.
    if(p!=="review_first"&&p!=="review")continue;
    queue.push({
      kind:"evidence_review_candidate",entity_id:entityId,title:headline(entityId,diff),
      review_priority:p,published_at:latest.published_at,
      first_evidence_member:baseline.member_id,last_evidence_member:latest.member_id,
      first_evidence_published_at:baseline.published_at,
      versions_in_sample:chronological.length,versions_in_requested_window:recent.length,
      before_after:diff,changed_fields:diff.map(x=>x.field),
      published_status:latest.snapshot.status,
      planned_periods:latest.snapshot.periods,
      zones:latest.snapshot.zones.map(z=>({id:z.id,consequences:z.consequences,
        geometry_envelope_31370:z.geometry_envelope_31370})),
      source_url:SOURCE,
      evidence_limitations:[
        "This is the net difference between observed versions; intermediate changes may be absent",
        "The first version in the sample may not be the initial version ever published",
        "Publication events and planned periods do not verify an actual road closure",
        "Bounding envelopes are not exact geometric intersections"
      ]
    });
  }
  const rank={review_first:0,review:1};
  return queue.sort((a,b)=>rank[a.review_priority]-rank[b.review_priority]||
    b.published_at.localeCompare(a.published_at)||a.entity_id.localeCompare(b.entity_id));
}

export function analyseGipodVersions(members,{maxMembers=2000,sincePublishedAt=null}={}){
  if(!Array.isArray(members)||members.length>maxMembers)
    throw Error("Expected a bounded array of parsed LDES client members");
  const errors=[],seen=new Map(),versions=[];let duplicates=0;
  for(const [index,member] of members.entries()){
    const n=normalizeGipodMember(member);
    if(n.error){errors.push({index,reason:n.error,member_id:n.member_id,identifiers:n.identifiers});continue;}
    const fingerprint=hash(n);
    if(seen.has(n.member_id)){
      if(seen.get(n.member_id)!==fingerprint)throw Error("Conflicting immutable member: "+n.member_id);
      duplicates++;continue;
    }
    seen.set(n.member_id,fingerprint);versions.push(n);
  }
  versions.sort((a,b)=>{
    const t=a.published_at.localeCompare(b.published_at);if(t)return t;
    // With equal publication times, the publisher's /history/{position} version suffix
    // gives a documented version discriminator; do not sort numeric positions lexically.
    if(a.entity_id&&a.entity_id===b.entity_id&&a.version_position&&b.version_position)
      return comparePosition(a.version_position,b.version_position);
    return a.member_id.localeCompare(b.member_id);
  });
  const byEntity=new Map();
  for(const v of versions)if(v.entity_id){
    const list=byEntity.get(v.entity_id)||[];list.push(v);byEntity.set(v.entity_id,list);
  }
  const last=new Map(),blocked=new Set(),events=[];
  for(const v of versions){
    const base={entity_id:v.entity_id,member_id:v.member_id,published_at:v.published_at,
      source_url:v.source_url,source_event_name:v.source_event_name,
      source_created_at:v.created_at,source_modified_at:v.last_modified_at};
    if(!v.entity_id){
      events.push({...base,kind:"identity_unverified",note:"Publisher-defined ID missing; no version join inferred"});
      continue;
    }
    if(blocked.has(v.entity_id)){
      events.push({...base,kind:"ordering_unverified",note:"Ambiguous timestamp history; no later revision inferred"});
      continue;
    }
    const sameTime=byEntity.get(v.entity_id).filter(n=>n.published_at===v.published_at);
    const positions=sameTime.map(x=>x.version_position);
    const hasOrderedVersions=positions.every(Boolean)&&new Set(positions).size===positions.length;
    // Tied generatedAtTime is common during GIPOD batch projections. If every record
    // has a distinct numeric publisher version position, it is not an ambiguous version chain.
    if(sameTime.length>1&&!hasOrderedVersions){
      errors.push({entity_id:v.entity_id,reason:"equal_publication_timestamps",
        member_ids:sameTime.map(n=>n.member_id)});
      blocked.add(v.entity_id);last.delete(v.entity_id);
      events.push({...base,kind:"ordering_unverified",
        note:"Two distinct versions share a publication timestamp; cannot order them"});
      continue;
    }
    const previous=last.get(v.entity_id);
    if(previous&&v.version_position&&previous.version_position&&
       comparePosition(previous.version_position,v.version_position)>=0){
      errors.push({entity_id:v.entity_id,member_id:v.member_id,reason:"non_monotonic_version_positions"});
      blocked.add(v.entity_id);last.delete(v.entity_id);
      events.push({...base,kind:"ordering_unverified",
        note:"Publisher version positions contradict the observed timestamp order"});
      continue;
    }
    const diff=previous?changes(previous.snapshot,v.snapshot):[];
    events.push({...base,kind:previous?"observed_revision":"first_observed_version",
      previous_member_id:previous?.member_id||null,
      publisher_version_position:v.version_position,
      ordering_basis:previous&&previous.published_at===v.published_at&&v.version_position?
        "publisher_version_position":"generated_at_time",
      changed_fields:diff.map(x=>x.field),
      before_after:diff,review_priority:previous?priority(diff):"not_a_change_claim",
      title:previous?headline(v.entity_id,diff):"GIPOD "+v.entity_id+": first version observed in sample",
      observed_status:v.snapshot.status,planned_periods:v.snapshot.periods,
      zones:v.snapshot.zones.map(z=>({id:z.id,consequences:z.consequences,
        geometry_envelope_31370:z.geometry_envelope_31370})),
      interpretation:previous?
        "Comparison of two observed published versions; intermediate versions may be missing":
        "First observed version is NOT evidence the roadwork was newly created"});
    last.set(v.entity_id,v);
  }
  const review_queue=buildReviewQueue(versions,{sincePublishedAt,blockedEntities:[...blocked]});
  return{kind:"ldes_change_evidence",source:SOURCE,history_complete:false,
    review_queue,review_queue_count:review_queue.length,requested_since:sincePublishedAt||null,
    coordinate_system:"EPSG:31370",
    limitations:["Only the supplied LDES members were processed; no complete historical coverage",
      "generatedAtTime is publication time, not planned work time",
      "First observed version is not proof of entity creation",
      "A published mobility consequence is not confirmation of actual traffic conditions",
      "Coordinates are Lambert 72; bounding envelopes are not exact spatial intersections",
      "Recurring schedules are fingerprinted, not expanded into occurrences",
      "Review priority ranks the changed published fields, not severity of actual impact"],
    counts:{input:members.length,unique_valid:versions.length,duplicates,
      revisions:events.filter(e=>e.kind==="observed_revision").length,
      actionable_revisions:events.filter(e=>e.kind==="observed_revision"&&e.review_priority==="review_first").length,
      timestamp_ties_resolved:events.filter(e=>e.ordering_basis==="publisher_version_position").length,
      unlinked:events.filter(e=>e.kind==="identity_unverified").length,
      invalid:errors.filter(e=>e.index!==undefined).length},
    errors,events};
}

function selfTest(){
  // Publisher-example shape: relative id, explicit isVersionOf, numeric object ID, single consequence and WKT.
  const version=(id,time,extra={})=>({object:{
    id:"api/v1/mobility-hindrances/10031313/"+id,
    isVersionOf:"api/v1/mobility-hindrances/10031313",
    gipodId:{type:"xsd:integer",value:"10031313"},generatedAtTime:time,
    createdOn:"2026-11-01T09:00:00Z",period:[{start:"2026-12-01T08:00:00Z",end:"2026-12-02T17:00:00Z"}],
    status:{id:"api/v1/taxonomies/statuses/1",prefLabel:"Gepland"},
    zone:[{id:"api/v1/mobility-hindrances/10031313/zones/1",
      geometry:{wkt:"POLYGON ((105000 191000, 106000 191000, 106000 192000, 105000 191000))"},
      consequence:{id:"api/v1/taxonomies/consequencetypes/a",prefLabel:"Geen doorgang"}}],
    ...extra}});
  const a=version("1","2026-11-08T10:00:00Z");
  const b=version("2","2026-11-09T11:00:00Z",{
    period:[{start:"2026-12-02T08:00:00Z",end:"2026-12-02T17:00:00Z"}],
    zone:[{...a.object.zone[0],consequence:{id:"api/v1/taxonomies/consequencetypes/b",prefLabel:"Fietspad afgesloten"}}]});
  const r=analyseGipodVersions([b,a,a]);
  assert.deepEqual(r.events.map(e=>e.kind),["first_observed_version","observed_revision"]);
  assert.deepEqual(r.events[1].changed_fields,["periods","mobility_consequences"]);
  assert.equal(r.events[1].review_priority,"review_first");
  assert.deepEqual(r.events[1].zones[0].geometry_envelope_31370,[105000,191000,106000,192000]);
  assert.equal(r.counts.duplicates,1);
  const q=analyseGipodVersions([a,b],{sincePublishedAt:"2026-11-09T00:00:00Z"}).review_queue;
  assert.equal(q.length,1);
  assert.equal(q[0].entity_id,"10031313");
  assert.deepEqual(q[0].changed_fields,["periods","mobility_consequences"]);
  assert.equal(r.events[0].member_id,"https://gipod.api.vlaanderen.be/api/v1/mobility-hindrances/10031313/1");
  assert.equal(analyseGipodVersions([version("3","2026-11-11T11:00:00Z",
    {gipodId:null,isVersionOf:null})]).events[0].kind,"identity_unverified");
  const tied=analyseGipodVersions([a,version("2","2026-11-08T10:00:00Z"),version("3","2026-11-09T11:00:00Z")]);
  assert.equal(tied.events[1].kind,"observed_revision");
  assert.equal(tied.events[1].ordering_basis,"publisher_version_position");
  assert.equal(tied.counts.timestamp_ties_resolved,1);
  assert.equal(analyseGipodVersions([version("4","2026-11-12T11:00:00Z",
    {gipodId:{value:"99"}})]).counts.invalid,1);
  assert.throws(()=>analyseGipodVersions([a,{object:{...a.object,description:"conflict"}}]),
    /Conflicting immutable member/);
  console.log("GIPOD LDES: 13 publisher-shape and net-change checks passed");
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  if(process.argv[2]==="--self-test")selfTest();
  else if(process.argv.length===3){
    if(statSync(process.argv[2]).size>8*1024*1024)throw Error("Input exceeds 8 MiB");
    console.log(JSON.stringify(analyseGipodVersions(JSON.parse(readFileSync(process.argv[2],"utf8"))),null,2));
  }else{console.error("Usage: node scripts/ldes-gipod-events.mjs --self-test | client-members.json");process.exitCode=2;}
}
