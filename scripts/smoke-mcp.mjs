// Calls every MCP tool once against a deployed server the way an MCP client does (initialize, tools/list, tools/call).
//   node scripts/smoke-mcp.mjs [origin]     exit code 1 when a call fails or returns an error result
// Live tools reach DOV, Statbel tables, IRCEL and VMM, so a failure can also mean an upstream service is down; the output says which.
const origin=(process.argv[2]||"https://data.vecture.be").replace(/\/$/,"");
const PROTOCOL="2025-06-18";
let id=0,failed=0,warned=0;
async function rpc(method,params){
  const t=Date.now();
  const r=await fetch(origin+"/mcp",{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream","mcp-protocol-version":PROTOCOL},body:JSON.stringify({jsonrpc:"2.0",id:++id,method,params})});
  const text=await r.text();let body=null;try{body=JSON.parse(text)}catch{}
  return{status:r.status,body,ms:Date.now()-t,text};
}
const CALLS=[
  ["search_datasets",{query:"bevolking per gemeente",limit:3}],
  ["get_dataset",null],                                   // id taken from the search result
  ["preview_dataset",null],
  ["catalogue_overview",{}],
  ["belgian_statistics",{places:["Gent"],topic:"population"}],
  ["air_quality",{address:"Grote Markt 1, 1000 Brussel"}],
  ["flood_risk",{address:"Grote Markt 1, 3000 Leuven"}],
  ["subsurface_at_location",{address:"Grote Markt 1, 3000 Leuven"}],
  ["search_subsurface",{record_type:"boreholes",municipality:"Leuven",limit:3}],
  ["get_subsurface_record",{id:"boring/2016-140688"}],
  ["search",{query:"luchtkwaliteit"}],
  ["fetch",null]
];
const init=await rpc("initialize",{protocolVersion:PROTOCOL,capabilities:{},clientInfo:{name:"bdd-smoke",version:"1"}});
const okInit=init.status===200&&init.body?.result?.serverInfo;
console.log((okInit?"PASS":"FAIL")+" initialize "+init.ms+"ms "+(init.body?.result?.serverInfo?.version||init.text.slice(0,120)));if(!okInit)failed++;
const list=await rpc("tools/list",{});
const names=(list.body?.result?.tools||[]).map(t=>t.name);
console.log((names.length?"PASS":"FAIL")+" tools/list "+names.length+" tools: "+names.join(", "));if(!names.length)failed++;
let datasetId=null,fetchId=null;
// preview_dataset needs a record whose file the relay index knows: take the first CSV result of a query that has many.
const csv=await rpc("tools/call",{name:"search_datasets",arguments:{query:"stiptheid treinen",limit:10}});
let previewId=null;try{previewId=JSON.parse(csv.body.result.content[0].text).results.find(x=>(x.formats||[]).some(f=>/csv/i.test(f)))?.id}catch{}
for(let [name,args] of CALLS){
  if(!names.includes(name)){console.log("SKIP "+name+" (not offered by this server)");continue}
  if(name==="get_dataset")args={id:datasetId};
  if(name==="preview_dataset")args={id:previewId||datasetId,rows:3};
  if(name==="fetch")args={id:fetchId||datasetId};
  const r=await rpc("tools/call",{name,arguments:args});
  const res=r.body?.result,text=res?.content?.[0]?.text||"";let parsed=null;try{parsed=JSON.parse(text)}catch{}
  const err=r.status!==200||r.body?.error||res?.isError||parsed?.error;
  if(name==="search_datasets"){const items=parsed?.results||parsed?.items||[];datasetId=items[0]?.id}
  if(name==="search"){fetchId=parsed?.results?.[0]?.id}
  // An official service that is down is reported by the tool as such; that is a warning about the source, not a broken deploy.
  const msg=err?String(r.body?.error?.message||parsed?.error||r.text):"",upstream=err&&r.status===200&&/did not answer|could not be reached|try again in a minute|answered HTTP 5\d\d/i.test(msg);
  console.log((upstream?"WARN":err?"FAIL":"PASS")+" "+name+" "+r.ms+"ms "+(err?msg.slice(0,160)+(upstream?" (upstream service down; not a deploy failure)":""):text.length+" chars"));
  if(upstream)warned++;else if(err)failed++;
}
console.log(failed?failed+" failed":"all passed"+(warned?" ("+warned+" upstream warning"+(warned>1?"s":"")+")":""));
process.exit(failed?1:0);
