// Public change log of the full-file check: which Belgian open datasets changed since the previous check, and how.
//   node scripts/change-log.mjs --checks .cache/full-check.jsonl --since <ISO start of this run> --dir <data-changes checkout>
// Writes <dir>/changes/<YYYY-MM-DD>.json (every change seen in this run) and <dir>/README.md (latest run plus history). Only
// facts about the files are published (row counts, rows added/removed, schema and coverage moves), never the data itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyVersionChange } from "./version-intelligence.mjs";

const fmt=n=>n==null?"":Number(n).toLocaleString("en-GB");
const signed=n=>n==null?"":(n>0?"+":n<0?"−":"±")+fmt(Math.abs(n));

const hostOf=u=>{try{return new URL(u).host}catch{return"?"}};
/** Hosts that refused the checker this run (scripts/full-check.mjs createHostGate): files not read and the refusal seen. */
export function refusedHosts(records){
  const hosts=new Set(records.filter(r=>r.error==="host_refused").map(r=>hostOf(r.url))),out={};
  for(const r of records){const h=hostOf(r.url);if(!hosts.has(h)||!r.error)continue;
    const x=out[h]||(out[h]={files:0,refusal:null});x.files++;x.refusal=x.refusal||r.refused_with||r.error}
  return out;
}

/** The run's change log from merged full-check records. titles: Map id -> {title, publisher}. */
export function buildChangeLog(records,{since,titles=new Map(),date=new Date().toISOString()}={}){
  const t0=Date.parse(since);
  const thisRun=records.filter(r=>Date.parse(r.checkedAt||0)>=t0);
  const profiled=thisRun.filter(r=>r.profile);
  const count=(list,f)=>{const m={};for(const r of list)for(const k of [].concat(f(r)).filter(Boolean))m[k]=(m[k]||0)+1;return m};
  const changed=profiled.filter(r=>r.change&&Date.parse(r.change.seen_at||0)>=t0).map(r=>{
    const t=titles.get(r.ds)||{};
    return{id:r.ds,title:t.title||null,publisher:t.publisher||r.prov||null,url:r.url,...r.change,
      change_type:classifyVersionChange(r)};
  });
  const size=c=>(c.distinct_rows_added||0)+(c.distinct_rows_removed||0)+Math.abs((c.rows.after||0)-(c.rows.before||0));
  changed.sort((a,b)=>size(b)-size(a)||String(a.title).localeCompare(String(b.title)));
  return{
    run:{date:date.slice(0,10),since,files_checked:thisRun.length,files_profiled:profiled.length,files_compared:profiled.filter(r=>r.header_check?.compared_with).length,
      files_changed:changed.length,row_order_unstable:profiled.filter(r=>r.row_order_unstable).length,
      last_modified:count(profiled,r=>r.header_check?.last_modified),header_issues:count(profiled,r=>r.header_check?.issues||[]),
      failed:thisRun.filter(r=>r.error).length,too_large:thisRun.filter(r=>r.too_large).length,
      refused_hosts:refusedHosts(thisRun)},
    changed,
  };
}

const ALERT_WORDS={emptied:"the file is now empty",rows_dropped:"rows dropped sharply",columns_removed:"columns were removed",coverage_shrank:"the time coverage shrank",
  became_unreadable:"the file stopped being readable",cadence_not_met:"declared cadence not met"};
const CADENCE_WORDS={"1MIN":"continuously",CONT:"continuously",DAILY:"daily",WEEKLY:"weekly",WEEKLY_2:"every two weeks",BIWEEKLY:"every two weeks",MONTHLY:"monthly",QUARTERLY:"quarterly"};
/** Alerts of this run: changes that look like breakage, files that became unreadable for a reason that is the publisher's own,
 *  and datasets that newly miss the cadence they declare. Hosts refusing cloud access and other "not checked" cases never raise an alert. */
export function buildAlerts(log,scorecards,{since,previousCadenceIds=[]}={}){
  const t0=Date.parse(since),alerts=[];
  for(const c of log.changed)for(const a of c.alerts||[])alerts.push({type:a,id:c.id,title:c.title,publisher:c.publisher,url:c.url,detail:describe(c),seen_at:c.seen_at});
  for(const b of scorecards?.broken||[])if(b.was_readable_until&&Date.parse(b.last_attempt||since)>=t0)
    alerts.push({type:"became_unreadable",id:b.id,title:b.title,publisher:b.publisher,url:b.url,detail:b.problem.replace(/_/g," ")+" (readable on "+String(b.was_readable_until).slice(0,10)+")"});
  const before=new Set(previousCadenceIds);
  for(const s of scorecards?.cadence_not_met||[])if(!before.has(s.id))
    alerts.push({type:"cadence_not_met",id:s.id,title:s.title,publisher:s.publisher,url:s.url,detail:"declared "+(CADENCE_WORDS[String(s.declared||"").toUpperCase()]||String(s.declared||"").toLowerCase())+"; latest reporting date "+s.latest_data_point+" ("+s.latest_data_age_days+" days before the check). Consider the reporting lag"});
  return alerts;
}

// ---------- Atom feeds ----------
const RAW="https://raw.githubusercontent.com/vecture-be/belgium-data-desk/data-changes/";
const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
export const slug=s=>String(s||"unknown").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60)||"unknown";
/** entries: [{date, kind: change|alert, type?, id, title, publisher, url, detail}] newest first. */
export function renderAtom(entries,{title,file}){
  const updated=(entries[0]?.date||"1970-01-01")+"T00:00:00Z";
  return['<?xml version="1.0" encoding="utf-8"?>','<feed xmlns="http://www.w3.org/2005/Atom">',
    "<title>"+esc(title)+"</title>",'<link rel="self" href="'+esc(RAW+file)+'"/>','<link href="https://github.com/vecture-be/belgium-data-desk/tree/data-changes"/>',
    "<id>"+esc(RAW+file)+"</id>","<updated>"+updated+"</updated>","<author><name>Belgium Data Desk</name></author>",
    ...entries.slice(0,200).map(e=>["<entry>","<title>"+esc((e.kind==="alert"?"⚠ "+(ALERT_WORDS[e.type]||e.type)+": ":"Changed: ")+(e.title||e.id))+"</title>",
      '<link href="'+esc(e.url)+'"/>',"<id>urn:bdd:"+esc(e.date+":"+e.kind+":"+(e.type||"")+":"+e.id)+"</id>","<updated>"+e.date+"T00:00:00Z</updated>",
      "<summary>"+esc((e.publisher?e.publisher+": ":"")+e.detail)+"</summary>","</entry>"].join("")),
    "</feed>",""].join("\n");
}
/** Feed entries from the published logs (newest first). */
export function feedEntries(logs){
  const out=[];
  for(const l of logs){const d=l.run.date;
    for(const a of l.alerts||[])out.push({date:d,kind:"alert",...a});
    for(const c of l.changed||[])out.push({date:d,kind:"change",id:c.id,title:c.title,publisher:c.publisher,url:c.url,detail:describe(c)});
  }
  return out;
}

function describe(c){
  const parts=[];
  if(c.distinct_rows_added!=null)parts.push(signed(c.distinct_rows_added)+" / "+signed(-c.distinct_rows_removed)+" distinct rows");
  if(c.columns_added?.length)parts.push("columns added: "+c.columns_added.slice(0,3).join(", "));
  if(c.columns_removed?.length)parts.push("columns removed: "+c.columns_removed.slice(0,3).join(", "));
  for(const v of (c.coverage||[]).slice(0,2))parts.push(v.column+" now "+v.after[0]+" to "+v.after[1]+" (was "+v.before[0]+" to "+v.before[1]+")");
  for(const v of (c.ranges||[]).slice(0,2))parts.push(v.column+" now "+fmt(v.after[0])+"–"+fmt(v.after[1])+" (was "+fmt(v.before[0])+"–"+fmt(v.before[1])+")");
  return parts.join("; ")||"values changed";
}
const cell=s=>String(s??"").replace(/\|/g,"\\|").replace(/\s+/g," ").slice(0,120);

export function renderReadme(log,history){
  const r=log.run,hasBaseline=r.files_compared>0,lines=[
    "# Belgian open data: what changed",
    "",
    "Every week the [Belgium Data Desk](https://data.vecture.be) downloads each published dataset's main CSV/TSV file in full (up to 100 MB) and compares it with the previous check. This branch keeps the result: which datasets changed, by how many rows, and whether their columns or time coverage moved. Only facts about the files are kept, never the data itself.",
    "",
    "Rows are compared as a set of distinct rows (a fingerprint per row), so an export that only shuffles its rows does not count as changed. Modified rows show up as one removed and one added. A renamed or added column changes every row.",
    "",
    "## Latest check: "+r.date,
    "",
    "- Files checked: "+fmt(r.files_checked)+" ("+fmt(r.files_profiled)+" read in full, "+fmt(r.files_compared)+" compared with a previous check)",
    hasBaseline?"- Changed since the previous check: **"+fmt(r.files_changed)+"**":"- Changed since the previous check: **Not yet known (no comparable baseline)**",
    "- Same rows, different order on each download: "+fmt(r.row_order_unstable),
    "- Last-Modified header: "+Object.entries(r.last_modified).map(([k,v])=>k.replace("_"," ")+" "+fmt(v)).join(", "),
    ...(Object.keys(r.header_issues).length?["- Change headers that contradict the content: "+Object.entries(r.header_issues).map(([k,v])=>"`"+k+"` "+fmt(v)).join(", ")]:[]),
    ...(Object.keys(r.refused_hosts||{}).length?["- Not checked, because the host refuses automated requests from cloud servers: "+Object.entries(r.refused_hosts).map(([h,v])=>h+" ("+fmt(v.files)+" files, "+v.refusal+")").join(", ")]:[]),
    "",
  ];
  if(log.alerts?.length){
    lines.push("## Alerts","","Changes that usually mean something broke, files that stopped being readable, and datasets that newly miss the update cadence they declare: their latest reporting date lies more than three declared cycles back. This is a possible reporting lag, not proof that publication stopped. Only datasets declared to update more often than yearly are judged; one-off, yearly and undeclared ones never are.","",
      "| Alert | Dataset | Publisher | Detail |","| --- | --- | --- | --- |");
    for(const a of log.alerts.slice(0,100))lines.push("| "+(ALERT_WORDS[a.type]||a.type)+" | ["+cell(a.title||a.id)+"]("+a.url+") | "+cell(a.publisher)+" | "+cell(a.detail)+" |");
    lines.push("");
  }
  lines.push("## Changed since the previous check","");
  if(log.changed.length){
    lines.push("| Dataset | Publisher | Change type | Rows before → after | Change |","| --- | --- | ---: | ---: | --- |");
    for(const c of log.changed.slice(0,100))lines.push("| ["+cell(c.title||c.id)+"]("+c.url+") | "+cell(c.publisher)+" | "+cell(c.change_type?.kind||"unassessed")+" | "+fmt(c.rows.before)+" → "+fmt(c.rows.after)+" | "+cell(describe(c))+" |");
    if(log.changed.length>100)lines.push("","… and "+fmt(log.changed.length-100)+" more in [changes/"+r.date+".json](changes/"+r.date+".json).");
  }else lines.push(hasBaseline?"No dataset changed among the "+fmt(r.files_compared)+" files compared with a previous check.":"This is an initial baseline: no files were compared with a previous check, so changes cannot yet be determined.");
  lines.push("","## Earlier checks","",...history.map(h=>"- ["+h.date+"](changes/"+h.date+".json): "+(h.files_compared>0?fmt(h.files_changed)+" changed of "+fmt(h.files_compared)+" compared":"initial baseline (0 compared)")),"",
    "## Follow it","",
    "- [Publisher scorecards](publishers.md) ([JSON](publishers.json)): per publisher, readable files, gone links, web pages served as tables, empty files and datasets that miss their declared update cadence. Files that could not be checked from our servers are listed apart and never counted against a publisher.",
    "- Atom feeds: [all changes and alerts]("+RAW+"feeds/changes.xml), [alerts only]("+RAW+"feeds/alerts.xml), and one per publisher under [feeds/publishers/](feeds/publishers/).",
    "- Data: `changes/<date>.json`, one file per check. Fields are described in the Data Desk repository under `docs/reference/dataset-cards.md` (\"Change log\").","");
  return lines.join("\n");
}

function readJsonl(file){return fs.existsSync(file)?fs.readFileSync(file,"utf8").split("\n").flatMap(l=>{try{return[JSON.parse(l)]}catch{return[]}}):[]}

async function main(){
  const arg=n=>{const i=process.argv.indexOf("--"+n);return i>=0?process.argv[i+1]:null};
  const dir=path.resolve(arg("dir")),since=arg("since");
  if(!since||!Number.isFinite(Date.parse(since)))throw new Error("--since <ISO time> is required");
  const titles=new Map();let records=[];
  try{const {loadRecords}=await import("./build-cards.mjs");records=loadRecords();for(const r of records)titles.set(r.id,{title:r.title,publisher:r.publisher})}catch{}
  const checks=readJsonl(path.resolve(arg("checks")||".cache/full-check.jsonl"));
  const log=buildChangeLog(checks,{since,titles});
  fs.mkdirSync(path.join(dir,"changes"),{recursive:true});
  const readLog=f=>{try{return JSON.parse(fs.readFileSync(path.join(dir,"changes",f),"utf8"))}catch{return null}};
  const files=fs.readdirSync(path.join(dir,"changes")).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)&&f!==log.run.date+".json").sort().reverse();
  const previous=files.length?readLog(files[0]):null;
  // health: scorecards per publisher and this run's alerts (hosts refusing cloud access never count, see scripts/health.mjs)
  const {buildScorecards,renderScorecards}=await import("./health.mjs");
  const sc=buildScorecards(checks,records);
  log.alerts=buildAlerts(log,sc,{since,previousCadenceIds:previous?.cadence_not_met_ids||previous?.stopped_ids||[]});
  log.cadence_not_met_ids=sc.cadence_not_met.map(s=>s.id);
  log.run.alerts=log.alerts.length;log.run.cadence_not_met=sc.cadence_not_met.length;
  fs.writeFileSync(path.join(dir,"changes",log.run.date+".json"),JSON.stringify(log,null,1)+"\n");
  fs.writeFileSync(path.join(dir,"publishers.json"),JSON.stringify(sc,null,1)+"\n");
  fs.writeFileSync(path.join(dir,"publishers.md"),renderScorecards(sc));
  const logs=[log,...files.slice(0,11).map(readLog).filter(Boolean)];
  fs.writeFileSync(path.join(dir,"README.md"),renderReadme(log,logs.map(l=>l.run)));
  // feeds: the last twelve checks
  const entries=feedEntries(logs);
  fs.mkdirSync(path.join(dir,"feeds","publishers"),{recursive:true});
  fs.writeFileSync(path.join(dir,"feeds","changes.xml"),renderAtom(entries,{title:"Belgian open data: changes and alerts",file:"feeds/changes.xml"}));
  fs.writeFileSync(path.join(dir,"feeds","alerts.xml"),renderAtom(entries.filter(e=>e.kind==="alert"),{title:"Belgian open data: alerts",file:"feeds/alerts.xml"}));
  const byPub=new Map();for(const e of entries)if(e.publisher)(byPub.get(e.publisher)||byPub.set(e.publisher,[]).get(e.publisher)).push(e);
  for(const p of sc.publishers)if(!byPub.has(p.publisher))byPub.set(p.publisher,[]);
  // two publisher names can share a slug ("City of Liège" / "City of Liege"): the second gets -2, in a stable (sorted) order
  const used=new Map();
  for(const [p,list] of [...byPub].sort((a,b)=>a[0].localeCompare(b[0]))){
    const base=slug(p),n=(used.get(base)||0)+1;used.set(base,n);const name=n>1?base+"-"+n:base;
    fs.writeFileSync(path.join(dir,"feeds","publishers",name+".xml"),renderAtom(list,{title:"Belgian open data: "+p,file:"feeds/publishers/"+name+".xml"}));
  }
  console.log("[change-log] "+log.run.date+": "+log.run.files_changed+" changed of "+log.run.files_compared+" compared ("+log.run.files_checked+" checked); "+log.alerts.length+" alerts; "+sc.cadence_not_met.length+" miss their declared cadence; "+byPub.size+" publisher feeds");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
