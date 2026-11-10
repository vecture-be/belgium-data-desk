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
const zones=x=>arr(x).filter(v=>v&&typeof v==="object").map(z=>({
  id:str(val(z.id))||null,
  consequences:arr(z.consequence).map(c=>str(val(c?.id))||str(c?.prefLabel)||"").filter(Boolean).sort(),
  geometry_hash:z.geometry?.wkt?hash(z.geometry.wkt):null
})).sort((a,b)=>stable(a).localeCompare(stable(b)));

export function normalizeGipodMember(member){
  const o=member?.object,memberId=str(member?.id),published=iso(val(o?.generatedAtTime));
  if(!/^https?:\/\//.test(memberId))return{error:"missing_immutable_member_iri",member_id:memberId||null};
  if(!published)return{error:"missing_generated_at_time",member_id:memberId};
  const businessId=String(val(o?.gipodId)??"").trim();
  return{
    member_id:memberId,entity_id:/^\d+$/.test(businessId)?businessId:null,
    published_at:published,source_event_name:str(val(o?.eventName))||null,
    source_url:SOURCE,
    snapshot:{
      status:str(val(o?.status?.id))||str(o?.status?.prefLabel)||null,
      description:str(val(o?.description))||null,
      periods:periods(o?.period),
      schedule_hash:o?.timeSchedule?hash(o.timeSchedule):null,
      zones:zones(o?.zone)
    }
  };
}
function changed(a,b){
  const keys=["status","description","periods","schedule_hash","zones"];
  const keysChanged=keys.filter(k=>stable(a[k])!==stable(b[k]));
  if(!keysChanged.includes("zones"))return keysChanged;
  const details=keysChanged.filter(k=>k!=="zones");
  if(stable(a.zones.map(z=>z.consequences))!==stable(b.zones.map(z=>z.consequences)))details.push("zone_consequences");
  if(stable(a.zones.map(z=>z.geometry_hash))!==stable(b.zones.map(z=>z.geometry_hash)))details.push("zone_geometry");
  if(!details.includes("zone_consequences")&&!details.includes("zone_geometry"))details.push("zone_structure");
  return details;
}

/** Interpret only supplied versions; never assert complete history, first creation or physical impact. */
export function analyseGipodVersions(members,{maxMembers=2000}={}){
  if(!Array.isArray(members)||members.length>maxMembers)throw Error("Expected a bounded array of parsed LDES client members");
  const errors=[],seen=new Map(),versions=[];
  let duplicates=0;
  for(let i=0;i<members.length;i++){
    const v=normalizeGipodMember(members[i]);
    if(v.error){errors.push({index:i,member_id:v.member_id,reason:v.error});continue;}
    const old=seen.get(v.member_id),fingerprint=hash(v);
    if(old){
      if(old!==fingerprint)throw Error("Conflicting immutable member: "+v.member_id);
      duplicates++;continue;
    }
    seen.set(v.member_id,fingerprint);versions.push(v);
  }
  versions.sort((a,b)=>a.published_at.localeCompare(b.published_at)||a.member_id.localeCompare(b.member_id));
  const last=new Map(),events=[];
  for(const v of versions){
    if(!v.entity_id){
      events.push({kind:"identity_unverified",member_id:v.member_id,entity_id:null,published_at:v.published_at,
        source_url:v.source_url,note:"No publisher-defined numeric GIPOD ID; cannot link versions"});
      continue;
    }
    const prior=last.get(v.entity_id);
    if(prior&&prior.published_at===v.published_at){
      events.push({kind:"ordering_unverified",member_id:v.member_id,entity_id:v.entity_id,
        published_at:v.published_at,previous_member_id:prior.member_id,source_url:v.source_url});
      errors.push({member_id:v.member_id,reason:"same_publication_timestamp_for_entity"});
      last.delete(v.entity_id);continue;
    }
    const differences=prior?changed(prior.snapshot,v.snapshot):[];
    events.push({
      kind:prior?"observed_revision":"first_observed_version",
      member_id:v.member_id,previous_member_id:prior?.member_id||null,entity_id:v.entity_id,
      published_at:v.published_at,source_url:v.source_url,source_event_name:v.source_event_name,
      changed_fields:differences,observed_status:v.snapshot.status,observed_periods:v.snapshot.periods,
      interpretation:prior?(differences.length?"selected_published_fields_changed":"no_change_in_selected_fields"):
        "First supplied version, not proof of a newly created real-world entity"
    });
    last.set(v.entity_id,v);
  }
  return{
    kind:"ldes_change_evidence",source:SOURCE,history_complete:false,
    limitations:[
      "Only the versions supplied by the external LDES client were examined",
      "Publication time generatedAtTime differs from real-world activity periods",
      "Recurring schedules were fingerprinted, not expanded into occurrences",
      "Selected data-field changes do not prove physical impact or road closure",
      "First observed version does not prove creation; there may be older versions",
      "Names, descriptions and locations are never used as invented entity identifiers"
    ],
    counts:{input:members.length,unique_valid:versions.length,duplicates,
      revisions:events.filter(e=>e.kind==="observed_revision").length,
      unlinked:events.filter(e=>e.kind==="identity_unverified").length},
    errors,events
  };
}
function selfTest(){
  const version=(name,time,extra={})=>({
    id:"https://example.org/stream/"+name,object:{
      gipodId:{value:"123"},generatedAtTime:time,eventName:"MobilityHindranceWasCreated",
      status:{id:"planned"},period:[{start:"2026-12-01T08:00:00Z",end:"2026-12-01T17:00:00Z"}],
      ...extra
    }
  });
  const a=version("a","2026-11-08T10:00:00Z");
  const b=version("b","2026-11-09T10:00:00Z",{status:{id:"changed"}});
  const report=analyseGipodVersions([b,a,a]);
  assert.deepEqual(report.events.map(x=>x.kind),["first_observed_version","observed_revision"]);
  assert.deepEqual(report.events[1].changed_fields,["status"]);
  assert.equal(report.counts.duplicates,1);
  assert.match(report.events[0].interpretation,/not proof/);
  assert.equal(analyseGipodVersions([version("c","2026-11-10T10:00:00Z",{gipodId:null})]).events[0].kind,"identity_unverified");
  assert.equal(analyseGipodVersions([a,version("d","2026-11-08T10:00:00Z")]).events[1].kind,"ordering_unverified");
  assert.throws(()=>analyseGipodVersions([a,{...a,object:{...a.object,description:"other"}}]),/Conflicting immutable member/);
  console.log("GIPOD LDES pilot: 6 offline checks passed");
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  if(process.argv[2]==="--self-test")selfTest();
  else if(process.argv.length===3){
    if(statSync(process.argv[2]).size>8*1024*1024)throw Error("Input exceeds 8 MiB");
    console.log(JSON.stringify(analyseGipodVersions(JSON.parse(readFileSync(process.argv[2],"utf8"))),null,2));
  }else{console.error("Usage: node scripts/ldes-gipod-events.mjs --self-test | client-members.json");process.exitCode=2;}
}
