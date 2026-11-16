// Data health per publisher, from the full-file check (scripts/full-check.mjs): what is wrong with the files themselves, kept apart
// from what could not be checked from our servers.
//
// Only failures that are the publisher's own count against a publisher: a link that is gone (404/410), a "CSV" link that serves a
// web page, an empty file. Hosts that refuse automated requests from cloud servers, timeouts, server errors, DNS trouble and
// 401/403 (which some hosts send to cloud addresses) are reported as "not checked" and never counted as broken.
import { cadenceNotMet, timeCoverage } from "./dataset-card.mjs";

const REFUSAL=/^(UND_ERR_CONNECT_TIMEOUT|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|HTTP 401|HTTP 403|HTTP 429|HTTP 503)$/;
const hostOf=u=>{try{return new URL(u).host}catch{return"?"}};

/** One of: ok | gone | not_a_table | empty (publisher problems) | cloud_refused | access_denied | unreachable | too_large (not checked). */
export function classify(r,refusedHosts=new Set()){
  const err=r.last_error||r.error;
  if(!err&&r.too_large)return"too_large";
  if(!err&&r.profile)return r.profile.rows===0?"empty":"ok";
  if(r.too_large||err==="too_large")return"too_large";
  if(/^HTTP 40[4]$|^HTTP 410$/.test(err))return"gone";
  if(/html instead of a table/.test(err))return"not_a_table";
  if(/^empty file$/.test(err))return"empty";
  if(err==="host_refused"||(REFUSAL.test(err)&&refusedHosts.has(hostOf(r.url))))return"cloud_refused";
  if(/^HTTP 40[13]$/.test(err))return"access_denied";
  return"unreachable";
}
export const PUBLISHER_PROBLEMS=["gone","not_a_table","empty"],NOT_CHECKED=["cloud_refused","access_denied","unreachable","too_large"];

/** checks: full-check records (merged); records: published records ({id,title,publisher,frequency}). */
export function buildScorecards(checks,records,{now=new Date().toISOString()}={}){
  const byId=new Map(records.map(r=>[r.id,r]));
  const refused=new Set(checks.filter(r=>(r.last_error||r.error)==="host_refused").map(r=>hostOf(r.url)));
  const pubs=new Map(),mismatches=[],broken=[],totals={files:0,ok:0};for(const k of [...PUBLISHER_PROBLEMS,...NOT_CHECKED])totals[k]=0;totals.cadence_not_met=0;
  for(const r of checks){
    const rec=byId.get(r.ds)||{},name=rec.publisher||r.prov||"(unknown publisher)",cls=classify(r,refused);
    const p=pubs.get(name)||{publisher:name,files:0,ok:0,problems:Object.fromEntries(PUBLISHER_PROBLEMS.map(k=>[k,0])),not_checked:Object.fromEntries(NOT_CHECKED.map(k=>[k,0])),
      cadence_not_met:0,with_duplicate_rows:0,last_modified_sent:0,examples:[],refused_hosts:new Set()};
    pubs.set(name,p);p.files++;totals.files++;
    if(cls==="ok")p.ok++;else if(PUBLISHER_PROBLEMS.includes(cls))p.problems[cls]++;else p.not_checked[cls]++;
    totals[cls]++;
    if(cls==="cloud_refused")p.refused_hosts.add(hostOf(r.url));
    if(PUBLISHER_PROBLEMS.includes(cls)){if(p.examples.length<5)p.examples.push({id:r.ds,title:rec.title||null,url:r.url,problem:cls});
      broken.push({id:r.ds,title:rec.title||null,publisher:name,url:r.url,problem:cls,...(r.last_error?{was_readable_until:r.checkedAt,last_attempt:r.last_attempt}:{})})}
    if(cls==="ok"){
      if(r.profile.duplicate_rows>0)p.with_duplicate_rows++;
      if(r.header_check?.last_modified&&r.header_check.last_modified!=="missing")p.last_modified_sent++;
      const t=r.profile.rows_exact?timeCoverage(r.profile):null,s=t?cadenceNotMet(String(rec.frequency||"").toUpperCase(),t.to,now,t.column):{};
      if(s.cadence_not_met){p.cadence_not_met++;totals.cadence_not_met++;
        mismatches.push({id:r.ds,title:rec.title||null,publisher:name,url:r.url,declared:rec.frequency,latest_data_point:t.to,column:t.column,latest_data_age_days:s.latest_data_age_days});
        if(p.examples.length<5)p.examples.push({id:r.ds,title:rec.title||null,url:r.url,problem:"cadence_not_met",latest_data_point:t.to,declared:rec.frequency})}
    }
  }
  const publishers=[...pubs.values()].map(p=>{
    const judged=p.ok+PUBLISHER_PROBLEMS.reduce((s,k)=>s+p.problems[k],0);
    return{...p,refused_hosts:[...p.refused_hosts],
      // share of the files we could judge that are readable tables; null when fewer than 3 could be judged
      readable_pct:judged>=3?Math.round(p.ok/judged*1000)/10:null,judged,
      last_modified_sent_pct:p.ok?Math.round(p.last_modified_sent/p.ok*1000)/10:null};
  }).sort((a,b)=>b.files-a.files||a.publisher.localeCompare(b.publisher));
  return{generated:now.slice(0,10),totals,publishers,cadence_not_met:mismatches,broken,
    note:"Counts per publisher's main CSV/TSV file per dataset. Only gone links, web pages served as tables and empty files count as problems; files that could not be checked from our servers (hosts refusing cloud access, timeouts, server errors, 401/403, over 100 MB) are not counted against anyone."};
}

const fmt=n=>n==null?"–":Number(n).toLocaleString("en-GB");
const cell=s=>String(s??"").replace(/\|/g,"\\|").replace(/\s+/g," ").slice(0,90);
export function renderScorecards(sc){
  const t=sc.totals,lines=[
    "# Publisher scorecards","",
    "From the weekly full-file check of each dataset's main CSV/TSV file ("+sc.generated+"). "+sc.note,"",
    "Totals: "+fmt(t.files)+" files, "+fmt(t.ok)+" readable; problems: "+fmt(t.gone)+" gone, "+fmt(t.not_a_table)+" web page instead of a table, "+fmt(t.empty)+" empty; "+
      "not checked: "+fmt(t.cloud_refused)+" host refuses cloud access, "+fmt(t.access_denied)+" access denied, "+fmt(t.unreachable)+" unreachable this run, "+fmt(t.too_large)+" over 100 MB; "+
      fmt(t.cadence_not_met)+" do not meet the update cadence they declare (their latest data lies more than three declared cycles back: either the series stopped or the declared frequency is wrong). One-off, yearly and undeclared datasets are never judged.","",
    "| Publisher | Files | Readable | Gone | Web page | Empty | Declared cadence not met | Not checked | Last-Modified sent |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"];
  for(const p of sc.publishers){
    const nc=NOT_CHECKED.reduce((s,k)=>s+p.not_checked[k],0);
    lines.push("| "+cell(p.publisher)+" | "+fmt(p.files)+" | "+(p.readable_pct==null?"–":p.readable_pct+" %")+" | "+fmt(p.problems.gone)+" | "+fmt(p.problems.not_a_table)+" | "+fmt(p.problems.empty)+" | "+fmt(p.cadence_not_met)+" | "+fmt(nc)+(p.refused_hosts.length?" ¹":"")+" | "+(p.last_modified_sent_pct==null?"–":p.last_modified_sent_pct+" %")+" |");
  }
  const refused=[...new Set(sc.publishers.flatMap(p=>p.refused_hosts))];
  lines.push("","¹ Includes files on a host that refuses automated requests from cloud servers ("+(refused.join(", ")||"none")+"). These are not counted as problems: the host may simply not allow our checker.","");
  return lines.join("\n");
}
