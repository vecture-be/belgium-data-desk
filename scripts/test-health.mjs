// Offline tests for data health: failure classes, publisher scorecards, "stopped updating", change alerts and feeds.
import assert from "node:assert/strict";
import { buildScorecards, classify, renderScorecards } from "./health.mjs";
import { dataStopped, freshness } from "./dataset-card.mjs";
import { describeChange } from "./row-diff.mjs";
import { buildAlerts, feedEntries, renderAtom, slug } from "./change-log.mjs";

const now="2026-11-21T03:00:00Z";
const prof=(rows,cols=[])=>({rows,rows_exact:true,columns:cols});

// 1. failure classes: only the publisher's own failures are problems; refusals of cloud access never are
const refused=new Set(["blocked.be"]);
assert.equal(classify({url:"https://a.be/x",profile:prof(5)}),"ok");
assert.equal(classify({url:"https://a.be/x",profile:prof(0)}),"empty");
assert.equal(classify({url:"https://a.be/x",error:"HTTP 404"}),"gone");
assert.equal(classify({url:"https://a.be/x",error:"HTTP 410"}),"gone");
assert.equal(classify({url:"https://a.be/x",error:"html instead of a table"}),"not_a_table");
assert.equal(classify({url:"https://blocked.be/x",error:"host_refused"},refused),"cloud_refused");
assert.equal(classify({url:"https://blocked.be/x",error:"HTTP 503"},refused),"cloud_refused","the first refusals before the gate tripped");
assert.equal(classify({url:"https://a.be/x",error:"HTTP 503"},refused),"unreachable","a 503 elsewhere is a bad moment, not a problem");
assert.equal(classify({url:"https://a.be/x",error:"HTTP 403"}),"access_denied","403 may be a cloud block: not counted");
assert.equal(classify({url:"https://a.be/x",error:"UND_ERR_CONNECT_TIMEOUT"}),"unreachable");
assert.equal(classify({url:"https://a.be/x",too_large:true}),"too_large");
// a file kept from last week whose fresh attempt failed is judged by the fresh failure
assert.equal(classify({url:"https://a.be/x",profile:prof(5),last_error:"HTTP 404"}),"gone");
assert.equal(classify({url:"https://a.be/x",profile:prof(5),last_error:"timeout"}),"unreachable");

// 2. "stopped updating": sub-annual cadences only, never register dates, a year of slack for year columns
assert.equal(dataStopped("MONTHLY","2026-01-31",now).data_stopped,true);
assert.equal(dataStopped("MONTHLY","2026-10-31",now).data_stopped,undefined);
assert.deepEqual(dataStopped("ANNUAL","2019",now),{},"yearly series are not judged");
assert.deepEqual(dataStopped("DAILY","2018-11-22",now,"Begindatum"),{},"a start date of an asset is not a feed date");
assert.deepEqual(dataStopped("DAILY","2021-09-28",now,"datum_plaatsing"),{});
assert.equal(dataStopped("DAILY","2025",now,"JAAR").data_stopped,undefined,"year 2025 ends 2025-12-31: within a year");
assert.equal(dataStopped("DAILY","2024",now,"JAAR").data_stopped,true);
assert.equal(dataStopped("MONTHLY","2026-07",now).latest_data_age_days,113,"a month counts as its last day");
const f=freshness({frequency:"WEEKLY"},{dataTo:"2026-05-31",dataColumn:"datum",dataComplete:false,now});
assert.equal(f.data_stopped,undefined,"a partial read never judges stopped");
assert.equal(freshness({frequency:"WEEKLY"},{dataTo:"2026-05-31",dataColumn:"datum",dataComplete:true,now}).data_stopped,true);

// 3. scorecards: not-checked files are listed apart and never lower a score
const rec=[{id:"a1",publisher:"Alpha",title:"A one",frequency:"MONTHLY"},{id:"a2",publisher:"Alpha"},{id:"a3",publisher:"Alpha"},{id:"a4",publisher:"Alpha"},
  {id:"b1",publisher:"Beta"},{id:"b2",publisher:"Beta"},{id:"b3",publisher:"Beta"},{id:"b4",publisher:"Beta"}];
const checks=[
  {ds:"a1",url:"https://alpha.be/1",profile:{...prof(10,[{name:"datum",from:"2025-01-01",to:"2026-01-31",filled_pct:100}]),duplicate_rows:2},header_check:{last_modified:"plausible"}},
  {ds:"a2",url:"https://alpha.be/2",profile:prof(3),header_check:{last_modified:"missing"}},
  {ds:"a3",url:"https://alpha.be/3",error:"HTTP 404"},
  {ds:"a4",url:"https://alpha.be/4",error:"html instead of a table"},
  {ds:"b1",url:"https://blocked.be/1",error:"UND_ERR_CONNECT_TIMEOUT"},
  {ds:"b2",url:"https://blocked.be/2",error:"host_refused",refused_with:"UND_ERR_CONNECT_TIMEOUT"},
  {ds:"b3",url:"https://blocked.be/3",error:"host_refused"},
  {ds:"b4",url:"https://beta.be/4",profile:prof(4),header_check:{last_modified:"missing"}},
];
const sc=buildScorecards(checks,rec,{now});
const A=sc.publishers.find(p=>p.publisher==="Alpha"),B=sc.publishers.find(p=>p.publisher==="Beta");
assert.deepEqual([A.ok,A.problems.gone,A.problems.not_a_table,A.readable_pct,A.stopped_updating,A.with_duplicate_rows,A.last_modified_sent_pct],[2,1,1,50,1,1,50]);
assert.deepEqual([B.ok,B.not_checked.cloud_refused,B.readable_pct,B.refused_hosts],[1,3,null,["blocked.be"]],"three refused files: no score at all, never a bad one");
assert.equal(sc.totals.cloud_refused,3);assert.equal(sc.stopped.length,1);assert.equal(sc.stopped[0].id,"a1");
assert.deepEqual(sc.broken.map(b=>b.problem),["gone","not_a_table"]);
const md=renderScorecards(sc);
assert.match(md,/\| Beta \| 4 \| – \| 0 \| 0 \| 0 \| 0 \| 3 ¹ \| 0 % \|/);assert.match(md,/¹ Includes files on a host that refuses automated requests from cloud servers \(blocked\.be\)/);

// 4. change alerts
const c=(before,after,bc,ac)=>describeChange({checkedAt:"x",profile:{rows:before,columns:bc}},{profile:{rows:after,columns:ac}});
const dcol=(to)=>[{name:"d",from:"2020-01-01",to,filled_pct:100},{name:"v",type:"integer",min:1,max:2}];
assert.deepEqual(c(100,0,dcol("2026-01-01"),dcol("2026-01-01")).alerts,["emptied"]);
assert.deepEqual(c(100,60,dcol("2026-01-01"),dcol("2026-01-01")).alerts,["rows_dropped"]);
assert.equal(c(100,80,dcol("2026-01-01"),dcol("2026-01-01")).alerts,undefined,"a 20 % drop is within normal churn");
assert.equal(c(10,3,dcol("2026-01-01"),dcol("2026-01-01")).alerts,undefined,"tiny tables are not judged on drops");
assert.deepEqual(c(100,100,dcol("2026-01-01"),[dcol("2026-01-01")[0]]).alerts,["columns_removed"]);
assert.deepEqual(c(100,100,dcol("2026-01-01"),dcol("2025-06-01")).alerts,["coverage_shrank"]);

// 5. run alerts: breakage, newly unreadable (publisher's own reason only), newly stopped
const since="2026-11-21T01:00:00Z";
const log={run:{date:"2026-11-21"},changed:[{id:"x",title:"X",publisher:"P",url:"u",rows:{before:100,after:0},alerts:["emptied"],seen_at:since}]};
const alerts=buildAlerts(log,{broken:[{id:"g",title:"G",publisher:"P",url:"ug",problem:"gone",was_readable_until:"2026-11-14T01:00:00Z",last_attempt:"2026-11-21T02:00:00Z"},
  {id:"old",problem:"gone",url:"uo"}],stopped:[{id:"s1",title:"S",publisher:"P",url:"us",declared:"MONTHLY",latest_data_point:"2026-01-31",latest_data_age_days:294},{id:"s0",url:"u0"}]},
  {since,previousStoppedIds:["s0"]});
assert.deepEqual(alerts.map(a=>a.type+":"+a.id),["emptied:x","became_unreadable:g","stopped_updating:s1"],"a link broken for weeks and an already-known stop do not alert again");

// 6. feeds
const entries=feedEntries([{...log,alerts}]);
const atom=renderAtom(entries,{title:"T & co",file:"feeds/changes.xml"});
assert.match(atom,/^<\?xml version="1\.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
assert.equal((atom.match(/<entry>/g)||[]).length,4);assert.match(atom,/<title>T &amp; co<\/title>/);
assert.match(atom,/<title>⚠ the file is now empty: X<\/title>/);assert.match(atom,/<updated>2026-11-21T00:00:00Z<\/updated>/);
assert.equal(slug("Agentschap Wegen en Verkeer"),"agentschap-wegen-en-verkeer");assert.equal(slug("Ville de Liège"),"ville-de-liege");

console.log(JSON.stringify({ok:true,health:"classes/stopped/scorecards/alerts/feeds"}));
