// Public change log of the full-file check: which Belgian open datasets changed since the previous check, and how.
//   node scripts/change-log.mjs --checks .cache/full-check.jsonl --since <ISO start of this run> --dir <data-changes checkout>
// Writes <dir>/changes/<YYYY-MM-DD>.json (every change seen in this run) and <dir>/README.md (latest run plus history). Only
// facts about the files are published (row counts, rows added/removed, schema and coverage moves), never the data itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fmt=n=>n==null?"":Number(n).toLocaleString("en-GB");
const signed=n=>n==null?"":(n>0?"+":n<0?"−":"±")+fmt(Math.abs(n));

/** The run's change log from merged full-check records. titles: Map id -> {title, publisher}. */
export function buildChangeLog(records,{since,titles=new Map(),date=new Date().toISOString()}={}){
  const t0=Date.parse(since);
  const thisRun=records.filter(r=>Date.parse(r.checkedAt||0)>=t0);
  const profiled=thisRun.filter(r=>r.profile);
  const count=(list,f)=>{const m={};for(const r of list)for(const k of [].concat(f(r)).filter(Boolean))m[k]=(m[k]||0)+1;return m};
  const changed=profiled.filter(r=>r.change&&Date.parse(r.change.seen_at||0)>=t0).map(r=>{
    const t=titles.get(r.ds)||{};
    return{id:r.ds,title:t.title||null,publisher:t.publisher||r.prov||null,url:r.url,...r.change};
  });
  const size=c=>(c.distinct_rows_added||0)+(c.distinct_rows_removed||0)+Math.abs((c.rows.after||0)-(c.rows.before||0));
  changed.sort((a,b)=>size(b)-size(a)||String(a.title).localeCompare(String(b.title)));
  return{
    run:{date:date.slice(0,10),since,files_checked:thisRun.length,files_profiled:profiled.length,files_compared:profiled.filter(r=>r.header_check?.compared_with).length,
      files_changed:changed.length,row_order_unstable:profiled.filter(r=>r.row_order_unstable).length,
      last_modified:count(profiled,r=>r.header_check?.last_modified),header_issues:count(profiled,r=>r.header_check?.issues||[]),
      failed:thisRun.filter(r=>r.error).length,too_large:thisRun.filter(r=>r.too_large).length},
    changed,
  };
}

function describe(c){
  const parts=[];
  if(c.distinct_rows_added!=null)parts.push(signed(c.distinct_rows_added)+" / "+signed(-c.distinct_rows_removed)+" distinct rows");
  if(c.columns_added?.length)parts.push("columns added: "+c.columns_added.slice(0,3).join(", "));
  if(c.columns_removed?.length)parts.push("columns removed: "+c.columns_removed.slice(0,3).join(", "));
  for(const v of (c.coverage||[]).slice(0,2))parts.push(v.column+" now "+v.after[0]+" to "+v.after[1]+" (was to "+v.before[1]+")");
  return parts.join("; ");
}
const cell=s=>String(s??"").replace(/\|/g,"\\|").replace(/\s+/g," ").slice(0,120);

export function renderReadme(log,history){
  const r=log.run,lines=[
    "# Belgian open data: what changed",
    "",
    "Every week the [Belgium Data Desk](https://data.vecture.be) downloads each published dataset's main CSV/TSV file in full (up to 100 MB) and compares it with the previous check. This branch keeps the result: which datasets changed, by how many rows, and whether their columns or time coverage moved. Only facts about the files are kept, never the data itself.",
    "",
    "Rows are compared as a set of distinct rows (a fingerprint per row), so an export that only shuffles its rows does not count as changed. Modified rows show up as one removed and one added. A renamed or added column changes every row.",
    "",
    "## Latest check: "+r.date,
    "",
    "- Files checked: "+fmt(r.files_checked)+" ("+fmt(r.files_profiled)+" read in full, "+fmt(r.files_compared)+" compared with a previous check)",
    "- Changed since the previous check: **"+fmt(r.files_changed)+"**",
    "- Same rows, different order on each download: "+fmt(r.row_order_unstable),
    "- Last-Modified header: "+Object.entries(r.last_modified).map(([k,v])=>k.replace("_"," ")+" "+fmt(v)).join(", "),
    ...(Object.keys(r.header_issues).length?["- Change headers that contradict the content: "+Object.entries(r.header_issues).map(([k,v])=>"`"+k+"` "+fmt(v)).join(", ")]:[]),
    "",
  ];
  if(log.changed.length){
    lines.push("| Dataset | Publisher | Rows before → after | Change |","| --- | --- | ---: | --- |");
    for(const c of log.changed.slice(0,100))lines.push("| ["+cell(c.title||c.id)+"]("+c.url+") | "+cell(c.publisher)+" | "+fmt(c.rows.before)+" → "+fmt(c.rows.after)+" | "+cell(describe(c))+" |");
    if(log.changed.length>100)lines.push("","… and "+fmt(log.changed.length-100)+" more in [changes/"+r.date+".json](changes/"+r.date+".json).");
  }else lines.push("No dataset changed since the previous check.");
  lines.push("","## Earlier checks","",...history.map(h=>"- ["+h.date+"](changes/"+h.date+".json): "+fmt(h.files_changed)+" changed of "+fmt(h.files_compared)+" compared"),"",
    "Data: `changes/<date>.json`, one file per check. Fields are described in the Data Desk repository under `docs/reference/dataset-cards.md` (\"Change log\").","");
  return lines.join("\n");
}

function readJsonl(file){return fs.existsSync(file)?fs.readFileSync(file,"utf8").split("\n").flatMap(l=>{try{return[JSON.parse(l)]}catch{return[]}}):[]}

async function main(){
  const arg=n=>{const i=process.argv.indexOf("--"+n);return i>=0?process.argv[i+1]:null};
  const dir=path.resolve(arg("dir")),since=arg("since");
  if(!since||!Number.isFinite(Date.parse(since)))throw new Error("--since <ISO time> is required");
  const titles=new Map();
  try{const {loadRecords}=await import("./build-cards.mjs");for(const r of loadRecords())titles.set(r.id,{title:r.title,publisher:r.publisher})}catch{}
  const log=buildChangeLog(readJsonl(path.resolve(arg("checks")||".cache/full-check.jsonl")),{since,titles});
  fs.mkdirSync(path.join(dir,"changes"),{recursive:true});
  fs.writeFileSync(path.join(dir,"changes",log.run.date+".json"),JSON.stringify(log,null,1)+"\n");
  const history=fs.readdirSync(path.join(dir,"changes")).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse()
    .map(f=>{try{return JSON.parse(fs.readFileSync(path.join(dir,"changes",f),"utf8")).run}catch{return null}}).filter(Boolean);
  fs.writeFileSync(path.join(dir,"README.md"),renderReadme(log,history));
  console.log("[change-log] "+log.run.date+": "+log.run.files_changed+" changed of "+log.run.files_compared+" compared ("+log.run.files_checked+" checked)");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
