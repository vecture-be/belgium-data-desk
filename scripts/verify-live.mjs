// Integrity check of a deployed Belgium Data Desk: catalogue files, metrics, relay, MCP and static pages.
//   node scripts/verify-live.mjs [origin]      exit code 1 when any check fails
// Read-only; makes a few hundred small requests. Each check prints PASS/WARN/FAIL with the evidence.
import { createHash } from "node:crypto";

const origin=(process.argv[2]||"https://data.vecture.be").replace(/\/$/,"");
const results=[];
const rec=(level,name,detail="")=>{results.push({level,name,detail});console.log((level==="PASS"?"  PASS ":level==="WARN"?"  WARN ":"  FAIL ")+name+(detail?" — "+detail:""))};
const check=(ok,name,detail)=>rec(ok?"PASS":"FAIL",name,detail);
const get=async(p,opt)=>fetch(origin+p,{cache:"no-store",...opt});
const json=async p=>{const r=await get(p);if(!r.ok)throw new Error(p+" "+r.status);return r.json()};
const rpc=async(name,args)=>{const r=await fetch(origin+"/mcp",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}})});return(await r.json()).result?.structuredContent};
const sha=s=>createHash("sha256").update(s).digest("hex").slice(0,16);
const rng=(()=>{let a=20261002;return()=>(a=(a*1664525+1013904223)%4294967296)/4294967296})();
const pick=(arr,n)=>Array.from({length:n},()=>arr[Math.floor(rng()*arr.length)]);

const TOPICS=new Set(["geology","water","energy","transport","health","population","economy","environment","agriculture","education","government","places","other"]);
const KINDS=new Set(["dataset","map-service","publication","research","metadata-only",""]);
const FAMILIES=new Set(["open","open-sharealike","non-commercial","no-derivatives","custom","unknown",""]);
const TIERS=new Set(["ready","download","service","document","metadata","broken",""]);

console.log("Verifying "+origin);
console.log("\n[1] Catalogue files");
const manifest=await json("/catalogue-manifest.json"),index=await json("/national-catalog.json");
const national=[];
for(const c of index.chunks){
  const body=await (await get("/"+c.file)).text();
  if(sha(body)!==c.sha256)rec("FAIL","chunk checksum "+c.file);
  national.push(...JSON.parse(body).items);
}
check(national.length===index.itemCount,"national item count matches index",national.length+" items");
check(index.health?.ok===true,"national health flag ok",JSON.stringify(index.health?.errors||[]));
const nationalIndexBody=await (await get("/national-catalog.json")).text();
check(sha(nationalIndexBody)===manifest.files["national-catalog.json"].sha256,"manifest checksum for national-catalog.json");
const hvBody=await (await get("/harvested-catalog.json")).text(),hv=JSON.parse(hvBody);
check(sha(hvBody)===manifest.files["harvested-catalog.json"].sha256,"manifest checksum for harvested-catalog.json");
const failedSources=Object.entries(hv.sources).filter(([,s])=>!s.ok||!s.count);
check(!failedSources.length,"every harvest source ok with records",failedSources.length?failedSources.map(([k,s])=>k+":"+(s.error||"0 rows")).join("; "):Object.keys(hv.sources).length+" sources");
const ageDays=(Date.now()-Date.parse(hv.generatedAt))/86400000;
check(ageDays<10,"catalogue is fresh",ageDays.toFixed(1)+" days old");

console.log("\n[2] Record integrity");
const all=[...hv.items,...national];
const ids=new Map();for(const x of all){ids.set(x.id,(ids.get(x.id)||0)+1)}
check([...ids.values()].every(n=>n===1),"record ids are unique",[...ids].filter(([,n])=>n>1).length+" duplicated");
const bad=(f)=>all.filter(f).length;
check(bad(x=>!x.id||!x.title||!x.provider)===0,"every record has id, title, provider",bad(x=>!x.id||!x.title||!x.provider)+" missing");
check(bad(x=>x.dataKind&&!KINDS.has(x.dataKind))===0,"dataKind values valid");
check(bad(x=>x.topic&&!TOPICS.has(x.topic))===0,"topic values valid");
check(bad(x=>x.licenseFamily&&!FAMILIES.has(x.licenseFamily))===0,"licence family values valid");
check(bad(x=>x.tier&&!TIERS.has(x.tier))===0,"tier values valid");
check(bad(x=>!x.dataKind)===0,"every record classified by kind",bad(x=>!x.dataKind)+" unclassified");
check(bad(x=>!x.topic)===0,"every record has a topic",bad(x=>!x.topic)+" without");
check(bad(x=>(x.distributions||[]).some(d=>d.url&&!/^(https?|ftp):\/\//i.test(d.url)))===0,"distribution URLs are http(s) or ftp");
check(bad(x=>(x.distributions||[]).some(d=>d.byteSize===0))===0,"no distribution reports byteSize 0 (unknown must be null)");
check(bad(x=>/^v\d|^\d{5,}$/.test(x.license||"")||/^\d{6,}$/.test(x.geoCoverage||""))===0,"no raw licence tail or GeoNames id leaks as a label");
check(bad(x=>x.probe&&(x.probe.ok>x.probe.n||x.probe.mm>x.probe.ok))===0,"probe summaries are coherent");
check(bad(x=>x.tier==="ready"&&!(x.probe&&x.probe.ok>0))===0,"READY tier only with a successful probe",bad(x=>x.tier==="ready"&&!(x.probe&&x.probe.ok>0))+" violations");
const seriesIds=new Set((index.series||[]).map(s=>s.id)),memberCount=new Map();
for(const x of national)if(x.seriesId)memberCount.set(x.seriesId,(memberCount.get(x.seriesId)||0)+1);
check([...memberCount.keys()].every(id=>seriesIds.has(id)),"every seriesId exists in the series table");
const drift=(index.series||[]).filter(s=>memberCount.get(s.id)!==s.count);
check(!drift.length,"series counts equal member counts",drift.length+" mismatches");
const dovCount=national.filter(x=>/Databank Ondergrond/.test(x.provider)).length;
check(!all.some(x=>/Databank Ondergrond/.test(x.provider)&&x.provider!==national.find(n=>/Databank Ondergrond/.test(n.provider)).provider),"publisher names stay as declared (DOV)",dovCount+" DOV records");

console.log("\n[3] Metrics consistency");
const kinds={};for(const x of all)kinds[x.dataKind]=(kinds[x.dataKind]||0)+1;
console.log("      kinds:",JSON.stringify(kinds));
const overview=await rpc("catalogue_overview",{});
const scopeSum=Object.entries(overview.scopes).filter(([k])=>k!=="all").reduce((n,[,v])=>n+v.count,0);
check(scopeSum===overview.records&&overview.scopes.all.count===overview.records,"MCP scope counts add up to total records",scopeSum+" / "+overview.records);
const rawTotal=all.length;
check(overview.records<=rawTotal+overview.curated_records&&overview.records>=rawTotal*0.85,"MCP record total is plausible vs raw pools",overview.records+" merged from "+rawTotal+" raw + "+overview.curated_records+" curated");
const tierSum=Object.values(overview.tiers).reduce((a,b)=>a+b,0);
check(tierSum===overview.records,"MCP tier counts add up",tierSum+" / "+overview.records);
const lhDays=(Date.now()-Date.parse(overview.links_last_checked))/86400000;
check(lhDays<10,"link health is recent",overview.links_last_checked+" ("+lhDays.toFixed(1)+" days)");
check(overview.tiers.ready>1000,"substantial number of READY records",String(overview.tiers.ready));

console.log("\n[4] Relay");
const relayCandidates=[];
for(const x of all)for(const d of x.distributions||[])if(/^https:/.test(d.url||"")&&/csv|tsv/i.test(d.format||"")&&x.probe?.ok)relayCandidates.push(d.url);
const relayIds=[...new Set(relayCandidates)].map(u=>"f_"+createHash("sha256").update(u).digest("hex").slice(0,32));
let relayOk=0,relayTried=0,relay404=0;
for(const id of pick(relayIds,12)){
  relayTried++;
  const r=await get("/api/dataset-file/"+id,{headers:{range:"bytes=0-2047"}});
  if(r.status===200||r.status===206){relayOk++;await r.arrayBuffer()}else if(r.status===404)relay404++;else await r.arrayBuffer();
}
check(relayOk>=relayTried*0.7,"relay serves catalogued files",relayOk+"/"+relayTried+" ok ("+relay404+" not indexed)");
check((await get("/api/dataset-file/f_"+"0".repeat(32))).status===404,"relay rejects an id that is not in the catalogue");
check((await get("/api/dataset-file/"+relayIds[0]+"?url=http://127.0.0.1/")).status>=400,"relay rejects query parameters");
check((await get("/api/publisher-file?url=https://example.org/x.csv")).status===410,"arbitrary-URL proxy stays retired (410)");

console.log("\n[5] MCP search recall and detail round-trip");
const probes=pick(national.filter(x=>x.dataKind==="dataset"&&x.title.length>25),60);
let found=0,top5=0,collapsed=0;
for(const x of probes){
  const r=await rpc("search_datasets",{query:x.title,limit:20,scope:"datasets"});
  const rank=(r?.results||[]).findIndex(y=>y.title===x.title||y.id===x.id);
  if(rank>=0){found++;if(rank<5)top5++}
  else if(x.seriesId&&(r?.results||[]).some(y=>y.more_in_collection))collapsed++;   // a series member shown through its collection representative
}
check((found+collapsed)/probes.length>=0.9,"searching a dataset's own title finds it or its collection (top 20)",found+" found ("+top5+" in top 5), "+collapsed+" via collection, of "+probes.length);
let trip=0;
for(const x of pick(all,40)){const g=await rpc("get_dataset",{id:x.id});if(g&&g.id===x.id)trip++}
check(trip>=36,"get_dataset resolves sampled record ids",trip+"/40 (rest are merged duplicates)");
check((await rpc("get_dataset",{id:"nope"})).error!==undefined,"unknown id is an error, not a crash");

console.log("\n[6] Static pages");
for(const p of ["/","/connect","/privacy","/terms","/robots.txt","/sitemap.xml","/og.png"]){
  const r=await get(p);check(r.ok,"GET "+p,String(r.status));await r.arrayBuffer();
}

console.log("\n[7] SEO surface");
{
  const sm=await (await get("/sitemap.xml")).text();
  check(/<sitemapindex/.test(sm),"sitemap.xml is a sitemap index");
  const subs=[...sm.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m=>m[1]);
  let urls=0,bad=0;
  for(const s of subs){
    const body=await (await fetch(s,{cache:"no-store"})).text(),locs=[...body.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m=>m[1]);
    urls+=locs.length;
    for(const u of pick(locs,8)){const r=await fetch(u,{redirect:"follow"});if(!r.ok)bad++;await r.arrayBuffer()}
  }
  check(subs.length>=2&&urls>1000,"sitemaps list many URLs",subs.length+" files, "+urls+" URLs");
  check(bad===0,"sampled sitemap URLs return 200",bad+" failures");
  const robots=await (await get("/robots.txt")).text();
  check(/Sitemap: .*sitemap\.xml/.test(robots)&&/Disallow: \/mcp/.test(robots),"robots.txt points at the sitemap and hides /mcp");
  for(const p of ["/nl/","/fr/","/topics/energy/","/nl/themas/energie/","/fr/themes/energie/","/connect/","/nl/verbinden/","/fr/connecter/","/publishers/"]){
    const r=await get(p),h=await r.text();
    check(r.ok&&/rel="canonical"/.test(h)&&/hreflang="x-default"/.test(h)&&/application\/ld\+json/.test(h),"page "+p+" has canonical, hreflang and structured data",String(r.status));
  }
  const home=await (await get("/")).text();
  check(/hreflang="nl"/.test(home)&&/FAQPage/.test(home),"app landing page carries hreflang and FAQ data");
  check((await get("/llms.txt")).ok,"llms.txt is served");
}

const fails=results.filter(r=>r.level==="FAIL"),warns=results.filter(r=>r.level==="WARN");
console.log("\n"+results.length+" checks: "+(results.length-fails.length-warns.length)+" pass, "+warns.length+" warn, "+fails.length+" fail");
process.exit(fails.length?1:0);
