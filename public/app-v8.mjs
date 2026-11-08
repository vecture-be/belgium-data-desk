import { SOURCES as BASE, QUICK } from "./data.mjs";
import { EXTRA_SOURCES, GUIDANCE, WORKFLOWS, IDENTIFIERS, BRIDGES } from "./deep-data.mjs";

const SOURCES=[...BASE,...EXTRA_SOURCES];
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=(v="")=>String(v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const stackKey="bdd-stack-v6",projectKey="bdd-projects-v6";
const safeJson=(raw,fallback)=>{try{let x=JSON.parse(raw);return x??fallback}catch{return fallback}};
const state={view:"explorer",q:"",access:new Set(),region:new Set(),topic:new Set(),stack:new Set(safeJson(localStorage.getItem(stackKey)||"[]",[])),recipe:[],recommendation:[],codeMode:"manifest",path:[]};
const by=id=>SOURCES.find(s=>s.id===id);
const guide=s=>GUIDANCE[s.id]||{keys:[],joins:[],caution:s.note||""};
const vals=f=>[...new Set(SOURCES.flatMap(s=>Array.isArray(s[f])?s[f]:[s[f]]))].filter(Boolean).sort();
const norm=v=>String(v||"").toLowerCase();

function bridgeBetween(a,b){return BRIDGES.find(x=>(x[0]===a&&x[1]===b)||(x[0]===b&&x[1]===a))}
function adjacency(){
  const m=new Map(SOURCES.map(s=>[s.id,[]]));
  BRIDGES.forEach(b=>{if(m.has(b[0])&&m.has(b[1])){m.get(b[0]).push(b[1]);m.get(b[1]).push(b[0])}});
  return m;
}
function shortestPath(start,end){
  if(!start||!end)return[];
  if(start===end)return[start];
  const a=adjacency(),q=[[start]],seen=new Set([start]);
  while(q.length){let p=q.shift(),last=p[p.length-1];for(const n of a.get(last)||[]){if(seen.has(n))continue;let np=[...p,n];if(n===end)return np;seen.add(n);q.push(np)}}
  return[];
}
function commonKeys(a,b){
  const ka=new Set(guide(a).keys.map(norm));
  return guide(b).keys.filter(k=>ka.has(norm(k)));
}
function compatibility(a,b){
  if(!a||!b)return{score:0,label:"Choose two sources",why:""};
  if(a.id===b.id)return{score:100,label:"Same source",why:"No join is needed."};
  const direct=bridgeBetween(a.id,b.id);
  if(direct)return{score:100,label:"Documented bridge",why:direct[2]+" · "+direct[4]};
  const p=shortestPath(a.id,b.id);
  if(p.length===3)return{score:84,label:"One bridge source",why:"Documented path via "+by(p[1]).name+"."};
  if(p.length===4)return{score:68,label:"Multi-hop path",why:"Documented path across "+(p.length-2)+" intermediary systems."};
  const keys=commonKeys(a,b);
  if(keys.length)return{score:64,label:"Shared identifier",why:"Both expose "+keys.join(", ")+"; verify grain and version before joining."};
  const common=a.topics.filter(t=>b.topics.includes(t));
  if(common.length)return{score:38,label:"Same domain, no documented key",why:"Both cover "+common.slice(0,2).join(", ")+" but this desk has no explicit join path."};
  return{score:18,label:"Weak compatibility",why:"No explicit bridge or shared key is documented here."};
}
function machineReady(s){return s.access.some(a=>["API / web service","Download","Geospatial service"].includes(a))}
function hay(s){let g=guide(s);return norm([s.name,s.org,s.region,s.summary,s.note,...s.access,...s.topics,...s.formats,...(s.use||[]),...g.keys,...g.joins,g.caution].join(" "))}
function matches(s){return(!state.q||hay(s).includes(norm(state.q)))&&(!state.access.size||s.access.some(x=>state.access.has(x)))&&(!state.region.size||state.region.has(s.region))&&(!state.topic.size||s.topics.some(x=>state.topic.has(x)))}
function saveStack(){localStorage.setItem(stackKey,JSON.stringify([...state.stack]));$("#stackCount").textContent=state.stack.size;document.dispatchEvent(new CustomEvent("bdd:stack-change",{detail:{count:state.stack.size,ids:[...state.stack]}}))}
function selected(){return[...state.stack].map(by).filter(Boolean)}
function ensureRecipe(){let ids=selected().map(s=>s.id);state.recipe=state.recipe.filter(id=>ids.includes(id));ids.forEach(id=>{if(!state.recipe.includes(id))state.recipe.push(id)})}

function encodeView(){
  const p=new URLSearchParams();
  if(state.view!=="explorer")p.set("view",state.view);
  if(state.q)p.set("q",state.q);
  ["access","region","topic"].forEach(k=>{if(state[k].size)p.set(k,[...state[k]].join(","))});
  history.replaceState(null,"",p.toString()?"?"+p.toString():location.pathname);
}
function loadView(){
  const p=new URLSearchParams(location.search);
  state.view=["explorer","workflows","network","builder","compare","quiz"].includes(p.get("view"))?p.get("view"):"explorer";
  state.q=p.get("q")||"";$("#search").value=state.q;
  ["access","region","topic"].forEach(k=>{let x=p.get(k);if(x)x.split(",").filter(Boolean).forEach(v=>state[k].add(v))});
}
function setView(v){
  state.view=v;
  $$(".view").forEach(e=>e.hidden=e.dataset.view!==v);
  $$(".nav-tab").forEach(e=>e.classList.toggle("active",e.dataset.view===v));
  $("#globalSearchWrap").hidden=v!=="explorer";
  if(v==="network")renderGraph();
  if(v==="builder"){renderBuilder();renderCode()}
  if(v==="compare")renderCompare();
  encodeView();
  document.dispatchEvent(new CustomEvent("bdd:view-change",{detail:{view:v}}));
}

function makeFilter(sel,items,key){
  let el=$(sel),field=key==="topic"?"topics":key;el.innerHTML="";
  items.forEach(v=>{let n=SOURCES.filter(s=>key==="region"?s.region===v:s[field].includes(v)).length,b=document.createElement("button");b.className="filter-option"+(state[key].has(v)?" active":"");b.innerHTML="<span>"+esc(v)+"</span><small>"+n+"</small>";b.onclick=()=>{state[key].has(v)?state[key].delete(v):state[key].add(v);renderSources()};el.appendChild(b)});
}
function renderQuick(){
  let access=vals("access");
  $("#quickRow").innerHTML=QUICK.map(x=>{let k=access.includes(x[1])?"access":"topic";return'<button class="quick '+(state[k].has(x[1])?"active":"")+'" data-qk="'+k+'" data-qv="'+esc(x[1])+'">'+esc(x[0])+"</button>"}).join("");
}
function sourceCard(s,i){
  let g=guide(s),pinned=state.stack.has(s.id);
  return'<article class="card"><div class="card-top"><span class="card-code">BE.'+String(i+1).padStart(2,"0")+" / "+esc(s.region.toUpperCase())+'</span><button class="pin '+(pinned?"active":"")+'" data-pin="'+s.id+'">'+(pinned?"✓ PINNED":"+ STACK")+'</button></div><div class="card-body"><div class="meta-strip"><span class="badge">'+esc(s.org)+'</span><span class="micro">'+(machineReady(s)?"MACHINE-READY":"LOOKUP / CATALOGUE")+"</span></div><h2>"+esc(s.name)+'</h2><p class="summary">'+esc(s.summary)+'</p><div class="keyline"><b>JOIN ON</b> '+esc(g.keys.slice(0,3).join(" · ")||"publisher metadata")+'</div><div class="tags">'+s.access.slice(0,2).map(x=>'<span class="tag">'+esc(x)+"</span>").join("")+s.formats.slice(0,2).map(x=>'<span class="tag quiet">'+esc(x)+"</span>").join("")+'</div></div><div class="card-foot"><button data-detail="'+s.id+'">Deep dive</button><button data-route="'+s.id+'">Route</button><a href="'+s.url+'" target="_blank" rel="noopener">Official ↗</a></div></article>';
}
function renderSources(){
  makeFilter("#accessFilters",vals("access"),"access");makeFilter("#regionFilters",vals("region"),"region");makeFilter("#topicFilters",vals("topics"),"topic");renderQuick();
  let a=SOURCES.filter(matches);$("#cards").innerHTML=a.map(sourceCard).join("");$("#cards").hidden=!a.length;$("#empty").hidden=!!a.length;$("#resultCount").textContent=a.length+" "+(a.length===1?"source":"sources");
  let pills=[];if(state.q)pills.push('search: “'+state.q+'”');["access","region","topic"].forEach(k=>state[k].forEach(v=>pills.push(v)));$("#activeFilters").innerHTML=pills.map(x=>'<span class="active-pill">'+esc(x)+"</span>").join("");
  saveStack();ensureRecipe();renderStack();encodeView();
}

function renderWorkflows(){
  $("#workflowGrid").innerHTML=WORKFLOWS.map(w=>'<article class="workflow"><div class="workflow-lead"><span class="workflow-no">'+w.n+'</span><div><h2>'+esc(w.title)+"</h2><p>"+esc(w.question)+'</p><div class="outcome">KEYS / '+w.keys.map(esc).join(" · ")+'</div></div></div><div class="steps">'+w.steps.map((st,i)=>{let s=by(st[0]);return'<div class="step"><span>'+String(i+1).padStart(2,"0")+'</span><button data-detail="'+s.id+'">'+esc(s.name)+"</button><b>"+esc(st[1])+"</b><p>"+esc(st[2])+"</p></div>"}).join("")+'</div><div class="workflow-foot"><span>'+[...new Set([...w.steps.map(x=>x[0]),...w.bulk])].length+' source systems · '+w.keys.length+' primary keys</span><div><button data-simulate="'+w.id+'">Open in builder</button> <button class="primary" data-workflow="'+w.id+'">Add stack</button></div></div></article>').join("");
}

function fillSelect(sel,blank){
  let el=$(sel),cur=el.value;
  el.innerHTML=(blank?'<option value="">'+esc(blank)+"</option>":"")+SOURCES.map(s=>'<option value="'+s.id+'">'+esc(s.name)+"</option>").join("");
  if(cur&&by(cur))el.value=cur;
}
function networkInit(){
  fillSelect("#pathFrom");fillSelect("#pathTo");$("#pathFrom").value=SOURCES[0].id;$("#pathTo").value=SOURCES[Math.min(3,SOURCES.length-1)].id;
  $("#graphTopic").innerHTML='<option value="">All topics</option>'+vals("topics").map(t=>'<option>'+esc(t)+"</option>").join("");
  renderPath();
}
function renderPath(){
  let a=by($("#pathFrom").value),b=by($("#pathTo").value),c=compatibility(a,b),p=shortestPath(a&&a.id,b&&b.id);state.path=p;
  $("#compatibility").innerHTML='<div class="score-number '+(c.score>=75?"good":c.score>=45?"mid":"low")+'">'+c.score+'</div><b>'+esc(c.label)+'</b><p>'+esc(c.why)+'</p>';
  if(!p.length){$("#pathSteps").innerHTML='<div class="path-hop"><b>No documented graph path.</b><span>Try a shared identifier or add an intermediary source manually.</span></div>'}
  else{$("#pathSteps").innerHTML=p.map((id,i)=>{let s=by(id);if(i===p.length-1)return'<div class="path-hop"><b>'+esc(s.name)+'</b><span>destination</span></div>';let br=bridgeBetween(id,p[i+1]);return'<div class="path-hop"><b>'+esc(s.name)+' → '+esc(by(p[i+1]).name)+'</b><span>'+esc(br?br[2]+" · "+br[4]:"documented connection")+"</span></div>"}).join("")}
  renderGraph();
}
function renderGraph(){
  let topic=$("#graphTopic")?$("#graphTopic").value:"",visible=new Set(SOURCES.filter(s=>!topic||s.topics.includes(topic)).map(s=>s.id)),hot=new Set(state.path),hotEdges=new Set;
  for(let i=0;i<state.path.length-1;i++)hotEdges.add([state.path[i],state.path[i+1]].sort().join("|"));
  let n=SOURCES.length,cx=600,cy=335,rx=470,ry=250,pos={};
  SOURCES.forEach((s,i)=>{let angle=(-Math.PI/2)+(i/n)*Math.PI*2;pos[s.id]={x:cx+Math.cos(angle)*rx,y:cy+Math.sin(angle)*ry}});
  let edges=BRIDGES.map(b=>{let a=pos[b[0]],d=pos[b[1]],key=[b[0],b[1]].sort().join("|"),dim=topic&&(!visible.has(b[0])||!visible.has(b[1]));return'<line class="graph-edge '+(hotEdges.has(key)?"hot ":"")+(dim?"dim":"")+'" x1="'+a.x+'" y1="'+a.y+'" x2="'+d.x+'" y2="'+d.y+'"><title>'+esc(b[3])+" — "+esc(b[2])+"</title></line>"}).join("");
  let nodes=SOURCES.map((s,i)=>{let p=pos[s.id],dim=topic&&!visible.has(s.id),name=s.name.length>22?s.name.slice(0,20)+"…":s.name;return'<g class="graph-node '+(hot.has(s.id)?"hot ":"")+(dim?"dim":"")+'" data-graph-node="'+s.id+'" transform="translate('+p.x+" "+p.y+')"><circle r="'+(hot.has(s.id)?18:14)+'"></circle><text x="0" y="-22" text-anchor="middle">'+esc(name)+"</text><title>"+esc(s.name)+"</title></g>"}).join("");
  $("#graphWrap").innerHTML='<svg class="graph-svg" viewBox="0 0 1200 680" role="img" aria-label="Source relationship graph">'+edges+nodes+"</svg>";
}

const objectiveMap={};
WORKFLOWS.forEach(w=>objectiveMap[w.id]=w);
function builderInit(){
  $("#objective").innerHTML=WORKFLOWS.map(w=>'<option value="'+w.id+'">'+esc(w.title)+"</option>").join("");
  state.recommendation=recommendSources();
}
function recommendSources(){
  let w=objectiveMap[$("#objective").value]||WORKFLOWS[0],geo=$("#geography").value,automation=$("#automation").value,ids=[...new Set([...w.steps.map(x=>x[0]),...w.bulk])];
  if(geo!=="Belgium"){let regional=SOURCES.filter(s=>s.region===geo&&s.topics.some(t=>["Geography","Government","Addresses","Environment"].includes(t)));regional.slice(0,2).forEach(s=>ids.push(s.id))}
  if(automation==="production")ids=ids.filter((id,i)=>machineReady(by(id))||i===0);
  return[...new Set(ids)].filter(id=>by(id));
}
function renderRecommendation(){
  let ids=state.recommendation,w=objectiveMap[$("#objective").value]||WORKFLOWS[0];
  $("#recommendation").innerHTML=ids.map((id,i)=>{let s=by(id);return'<div class="rec-card"><b>'+String(i+1).padStart(2,"0")+" · "+esc(s.name)+'</b><small>'+esc(i<w.steps.length&&w.steps[i]?w.steps[i][1]:"regional / reusable support")+"</small></div>"}).join("");
}
function diagnostics(){
  const a=selected(),ids=new Set(a.map(s=>s.id));if(!a.length)return{score:0,items:[["bad","No sources selected","Add a workflow or pin sources in Explorer."]]};
  const adj=adjacency(),seen=new Set,components=[];
  for(const id of ids){if(seen.has(id))continue;let q=[id],comp=[];seen.add(id);while(q.length){let x=q.shift();comp.push(x);for(const y of adj.get(x)||[]){if(ids.has(y)&&!seen.has(y)){seen.add(y);q.push(y)}}}components.push(comp)}
  let largest=Math.max(...components.map(c=>c.length)),connected=largest/a.length,machine=a.filter(machineReady).length/a.length,edgeCount=BRIDGES.filter(b=>ids.has(b[0])&&ids.has(b[1])).length,keyCount=new Set(a.flatMap(s=>guide(s).keys)).size;
  let score=Math.round(20+connected*40+machine*20+Math.min(1,edgeCount/Math.max(1,a.length-1))*10+Math.min(1,keyCount/4)*10);score=Math.min(100,score);
  let items=[];
  items.push([connected===1?"good":"warn",connected===1?"Stack is connected":components.length+" disconnected components",connected===1?"Every selected source is reachable through documented bridges.":"Add bridge sources or validate an undocumented join before implementation."]);
  items.push([machine>=.7?"good":"warn",Math.round(machine*100)+"% machine-ready",machine>=.7?"Most sources expose API, download or geospatial access.":"Some sources are primarily lookup/catalogue interfaces."]);
  let automation=$("#automation").value;if(automation==="production"&&a.some(s=>!machineReady(s)))items.push(["bad","Production blocker","One or more selected sources do not expose a reusable interface in this desk."]);
  else items.push(["good",keyCount+" useful identifiers","Preserve keys in raw layers so later joins remain traceable."]);
  return{score,items};
}
function renderBuilder(){
  ensureRecipe();renderRecommendation();let d=diagnostics();$("#readinessScore").textContent=d.score;$("#diagnostics").innerHTML=d.items.map(x=>'<div class="diag '+x[0]+'"><b>'+esc(x[1])+"</b><p>"+esc(x[2])+"</p></div>").join("");
  $("#recipe").innerHTML=state.recipe.length?state.recipe.map((id,i)=>{let s=by(id);return'<div class="recipe-row"><span>'+String(i+1).padStart(2,"0")+'</span><div><b>'+esc(s.name)+'</b><small>'+esc(guide(s).keys.slice(0,2).join(" · ")||s.access.join(" / "))+'</small></div><div class="recipe-actions"><button data-up="'+id+'" title="Move up">↑</button><button data-down="'+id+'" title="Move down">↓</button><button data-remove="'+id+'" title="Remove">×</button></div></div>'}).join(""):'<div class="empty"><b>EMPTY STACK</b><p>Add a workflow or pin sources first.</p></div>';
}
function projectPayload(){
  let a=state.recipe.map(by).filter(Boolean),ids=new Set(a.map(s=>s.id));
  return{project:$("#projectName").value.trim()||"Belgium Data Desk project",objective:$("#objective").selectedOptions[0]?.textContent||"",geography:$("#geography").value,automation:$("#automation").value,output:$("#output").value,generated:new Date().toISOString(),sources:a.map(s=>({id:s.id,name:s.name,publisher:s.org,docs_url:s.url,region:s.region,access:s.access,formats:s.formats,topics:s.topics,keys:guide(s).keys,caution:guide(s).caution})),bridges:BRIDGES.filter(b=>ids.has(b[0])&&ids.has(b[1])).map(b=>({from:b[0],to:b[1],key:b[2],purpose:b[3],type:b[4]}))};
}
function generatedCode(mode){
  let p=projectPayload();
  if(mode==="manifest")return JSON.stringify(p,null,2);
  if(mode==="python"){
    let lines=["# Generated project skeleton","# Landing/docs URLs are provenance references, not assumed data endpoints.","from dataclasses import dataclass","","@dataclass","class Source:","    id: str","    name: str","    docs_url: str","    keys: tuple[str, ...]","","SOURCES = ["];
    p.sources.forEach(s=>lines.push("    Source("+JSON.stringify(s.id)+", "+JSON.stringify(s.name)+", "+JSON.stringify(s.docs_url)+", "+JSON.stringify(s.keys)+"),"));
    lines.push("]","","def extract(source: Source):","    # TODO: implement the publisher-specific reusable endpoint/download.","    # Do not scrape a consultation UI when a bulk/API product exists.","    raise NotImplementedError(source.id)","","for source in SOURCES:","    print(source.id, '->', source.keys)");
    return lines.join("\n");
  }
  if(mode==="sql"){
    let lines=["-- Generated modelling outline","-- Replace *_raw relations with landed source tables.",""];
    p.sources.forEach((s,i)=>{let name=s.id.replace(/[^a-z0-9_]/gi,"_");lines.push((i?" ,":"WITH ")+name+" AS (","  SELECT *","  FROM "+name+"_raw",")")});
    lines.push("","SELECT *","FROM "+(p.sources[0]?p.sources[0].id.replace(/[^a-z0-9_]/gi,"_"):"source_raw")+";","","-- Candidate bridge keys:");
    p.bridges.forEach(b=>lines.push("-- "+b.from+" ↔ "+b.to+": "+b.key+" ("+b.type+")"));
    return lines.join("\n");
  }
  let lines=["# "+p.project,"","**Objective:** "+p.objective+"  ","**Geography:** "+p.geography+"  ","**Automation:** "+p.automation+"  ","**Output:** "+p.output,"","## Sources",""];
  p.sources.forEach((s,i)=>{lines.push((i+1)+". **"+s.name+"** — "+s.publisher);lines.push("   - Access: "+s.access.join(", "));lines.push("   - Keys: "+(s.keys.join(", ")||"publisher metadata"));lines.push("   - Docs: "+s.docs_url);lines.push("   - Watch: "+s.caution)});
  lines.push("","## Documented bridges","");p.bridges.forEach(b=>lines.push("- "+b.from+" → "+b.to+": **"+b.key+"** — "+b.purpose));
  return lines.join("\n");
}
function renderCode(){$("#codeOutput code").textContent=generatedCode(state.codeMode)}
function renderProjects(){
  let p=safeJson(localStorage.getItem(projectKey)||"[]",[]);
  $("#projectList").innerHTML=p.length?p.map(x=>'<div class="project-card"><b>'+esc(x.name)+'</b><small>'+esc(x.date)+" · "+x.stack.length+' sources</small><div><button data-load-project="'+x.id+'">Load</button><button data-delete-project="'+x.id+'">Delete</button></div></div>').join(""):'<div class="project-card"><b>No saved snapshots</b><small>Saved projects stay in this browser.</small></div>';
}
function saveProject(){
  let p=safeJson(localStorage.getItem(projectKey)||"[]",[]),name=$("#projectName").value.trim()||"Untitled project";
  p.unshift({id:Date.now().toString(36),name,date:new Date().toLocaleString(),stack:[...state.stack],recipe:[...state.recipe],objective:$("#objective").value,geography:$("#geography").value,automation:$("#automation").value,output:$("#output").value});p=p.slice(0,12);localStorage.setItem(projectKey,JSON.stringify(p));renderProjects();
}
function loadProject(id){
  let p=safeJson(localStorage.getItem(projectKey)||"[]",[]).find(x=>x.id===id);if(!p)return;
  state.stack=new Set(p.stack);state.recipe=p.recipe.filter(id=>by(id));$("#projectName").value=p.name;$("#objective").value=p.objective;$("#geography").value=p.geography;$("#automation").value=p.automation;$("#output").value=p.output;saveStack();renderStack();renderBuilder();renderCode();
}
function deleteProject(id){let p=safeJson(localStorage.getItem(projectKey)||"[]",[]).filter(x=>x.id!==id);localStorage.setItem(projectKey,JSON.stringify(p));renderProjects()}

function compareInit(){["#cmpA","#cmpB","#cmpC"].forEach(fillSelect);$("#cmpA").value=SOURCES[0].id;$("#cmpB").value=SOURCES[Math.min(1,SOURCES.length-1)].id;$("#cmpC").value=SOURCES[Math.min(2,SOURCES.length-1)].id}
function renderCompare(){
  let a=[$("#cmpA").value,$("#cmpB").value,$("#cmpC").value].map(by).filter(Boolean);if(!a.length)return;
  const rows=[
    ["Publisher",s=>s.org],["Region",s=>s.region],["Access",s=>s.access],["Formats",s=>s.formats],["Topics",s=>s.topics],["Join keys",s=>guide(s).keys],["Machine-ready",s=>machineReady(s)?"Yes":"No / discovery only"],["Friction",s=>s.friction],["Caution",s=>guide(s).caution]
  ];
  let head="<tr><th>Dimension</th>"+a.map(s=>"<th>"+esc(s.name)+"</th>").join("")+"</tr>";
  let body=rows.map(r=>"<tr><td>"+esc(r[0])+"</td>"+a.map(s=>{let v=r[1](s);return"<td>"+(Array.isArray(v)?v.map(x=>'<span class="compare-pill">'+esc(x)+"</span>").join(""):esc(v))+"</td>"}).join("")+"</tr>").join("");
  let compat="<tr><td>Pair compatibility</td>"+a.map((s,i)=>{if(i===0)return"<td>baseline</td>";let c=compatibility(a[0],s);return"<td><b>"+c.score+"/100</b><br>"+esc(c.label)+"</td>"}).join("")+"</tr>";
  $("#compareTable").innerHTML="<table><thead>"+head+"</thead><tbody>"+body+compat+"</tbody></table>";
}

function detail(id,connections=true){
  let s=by(id);if(!s)return;let g=guide(s),related=BRIDGES.filter(b=>b[0]===id||b[1]===id);
  $("#dialogContent").innerHTML='<div class="detail"><small>'+esc(s.region)+" / "+esc(s.org)+'</small><h2>'+esc(s.name)+'</h2><p class="lead">'+esc(s.summary)+'</p><div class="detail-grid"><section><h3>Use it for</h3><ul>'+(s.use||[]).map(x=>"<li>"+esc(x)+"</li>").join("")+'</ul></section><section><h3>Join logic</h3><ul>'+g.joins.map(x=>"<li>"+esc(x)+"</li>").join("")+'</ul></section></div><div class="keys"><b>Useful keys</b>'+g.keys.map(x=>"<span>"+esc(x)+"</span>").join("")+'</div><div class="caveat"><b>Watch out</b><p>'+esc(g.caution||s.note||"")+'</p></div>'+(connections?'<div class="connections"><h3>Documented bridges</h3>'+related.map(b=>'<div><b>'+esc(b[3])+'</b><span>'+esc(b[2])+" · "+esc(b[4])+"</span></div>").join("")+"</div>":"")+'<a class="detail-link" href="'+s.url+'" target="_blank" rel="noopener">Open official source ↗</a></div>';$("#detailDialog").showModal();
}
function routeTo(id){setView("network");$("#pathTo").value=id;renderPath();window.scrollTo({top:$(".network-shell").offsetTop-80,behavior:"smooth"})}

function renderStack(){
  let a=selected();$("#stackItems").innerHTML=a.length?a.map(s=>'<div class="stack-item"><div><b>'+esc(s.name)+"</b><small>"+esc(s.region)+" · "+esc(s.access.join(" / "))+'</small></div><button data-remove="'+s.id+'">remove</button></div>').join(""):'<div class="stack-item"><div><b>Nothing pinned yet.</b><small>Add a source or workflow.</small></div></div>';$("#exportStack").disabled=!a.length;
}
function openStack(){$("#stackPanel").classList.add("open");$("#scrim").hidden=false}
function closeStack(){$("#stackPanel").classList.remove("open");$("#scrim").hidden=true}
function addWorkflow(id){let w=WORKFLOWS.find(x=>x.id===id);if(!w)return;[...w.steps.map(x=>x[0]),...w.bulk].forEach(x=>state.stack.add(x));saveStack();ensureRecipe();renderSources();renderBuilder()}
function resetFilters(){state.q="";$("#search").value="";state.access.clear();state.region.clear();state.topic.clear();renderSources()}
function download(name,text,type="application/json"){let b=new Blob([text],{type}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

const paletteActions=[
  ["Explorer","Open source explorer",()=>setView("explorer")],["Workflows","Open guided workflows",()=>setView("workflows")],["Network","Open source graph and path finder",()=>setView("network")],["Builder","Open project builder",()=>setView("builder")],["Compare","Compare source systems",()=>setView("compare")],["Quiz","Open Data Skills Lab",()=>setView("quiz")],["Project stack","Open selected sources",openStack]
];
function openPalette(){renderPalette("");$("#paletteDialog").showModal();setTimeout(()=>$("#paletteSearch").focus(),30)}
function renderPalette(q){
  q=norm(q);let items=[];
  SOURCES.filter(s=>!q||hay(s).includes(q)).slice(0,8).forEach(s=>items.push({title:s.name,sub:"Source · "+s.org,fn:()=>detail(s.id)}));
  WORKFLOWS.filter(w=>!q||norm(w.title+" "+w.question).includes(q)).slice(0,5).forEach(w=>items.push({title:w.title,sub:"Workflow",fn:()=>{setView("workflows");$("#paletteDialog").close()}}));
  paletteActions.filter(x=>!q||norm(x[0]+" "+x[1]).includes(q)).forEach(x=>items.push({title:x[0],sub:x[1],fn:x[2]}));
  $("#paletteResults").innerHTML=items.slice(0,12).map((x,i)=>'<button class="palette-item" data-palette="'+i+'"><b>'+esc(x.title)+"</b><small>"+esc(x.sub)+"</small></button>").join("");$("#paletteResults")._items=items.slice(0,12);
}

document.addEventListener("click",e=>{
  let n=e.target.closest(".nav-tab");if(n)setView(n.dataset.view);
  let q=e.target.closest("[data-qk]");if(q){let set=state[q.dataset.qk],v=q.dataset.qv;set.has(v)?set.delete(v):set.add(v);renderSources()}
  let p=e.target.closest("[data-pin]");if(p){state.stack.has(p.dataset.pin)?state.stack.delete(p.dataset.pin):state.stack.add(p.dataset.pin);renderSources();renderBuilder();renderCode()}
  let d=e.target.closest("[data-detail]");if(d)detail(d.dataset.detail);
  let r=e.target.closest("[data-route]");if(r)routeTo(r.dataset.route);
  let w=e.target.closest("[data-workflow]");if(w)addWorkflow(w.dataset.workflow);
  let sim=e.target.closest("[data-simulate]");if(sim){$("#objective").value=sim.dataset.simulate;state.recommendation=recommendSources();setView("builder");renderRecommendation()}
  let rm=e.target.closest("[data-remove]");if(rm){state.stack.delete(rm.dataset.remove);state.recipe=state.recipe.filter(x=>x!==rm.dataset.remove);renderSources();renderBuilder();renderCode()}
  let up=e.target.closest("[data-up]");if(up){let i=state.recipe.indexOf(up.dataset.up);if(i>0)[state.recipe[i-1],state.recipe[i]]=[state.recipe[i],state.recipe[i-1]];renderBuilder();renderCode()}
  let dn=e.target.closest("[data-down]");if(dn){let i=state.recipe.indexOf(dn.dataset.down);if(i>=0&&i<state.recipe.length-1)[state.recipe[i+1],state.recipe[i]]=[state.recipe[i],state.recipe[i+1]];renderBuilder();renderCode()}
  let ct=e.target.closest("[data-code]");if(ct){state.codeMode=ct.dataset.code;$$(".code-tab").forEach(x=>x.classList.toggle("active",x===ct));renderCode()}
  let gn=e.target.closest("[data-graph-node]");if(gn)detail(gn.dataset.graphNode);
  let lp=e.target.closest("[data-load-project]");if(lp)loadProject(lp.dataset.loadProject);
  let dp=e.target.closest("[data-delete-project]");if(dp)deleteProject(dp.dataset.deleteProject);
  let pi=e.target.closest("[data-palette]");if(pi){let item=$("#paletteResults")._items?.[Number(pi.dataset.palette)];if(item){$("#paletteDialog").close();item.fn()}}
});

$("#search").oninput=e=>{state.q=e.target.value.trim();renderSources()};
document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openPalette()}
  else if(e.key==="/"&&document.activeElement!==$("#search")&&state.view==="explorer"){e.preventDefault();$("#search").focus()}
  else if(e.key==="Escape")closeStack();
});
$("#paletteBtn").onclick=openPalette;$("#paletteSearch").oninput=e=>renderPalette(e.target.value);
$("#stackBtn").onclick=openStack;$("#stackClose").onclick=closeStack;$("#scrim").onclick=closeStack;$("#resetFilters").onclick=resetFilters;$("#emptyReset").onclick=resetFilters;$("#dialogClose").onclick=()=>$("#detailDialog").close();
$("#clearStack").onclick=()=>{state.stack.clear();state.recipe=[];renderSources();renderBuilder();renderCode()};
$("#exportStack").onclick=()=>download("belgium-data-stack.json",JSON.stringify(projectPayload(),null,2));
$("#copyView").onclick=async()=>{try{await navigator.clipboard.writeText(location.href);$("#copyView").textContent="Copied";setTimeout(()=>$("#copyView").textContent="Copy view link",900)}catch{}};
$("#findPath").onclick=renderPath;$("#pathFrom").onchange=renderPath;$("#pathTo").onchange=renderPath;$("#graphTopic").onchange=renderGraph;
$("#recommendBtn").onclick=()=>{state.recommendation=recommendSources();renderRecommendation()};
["#objective","#geography","#automation","#output"].forEach(s=>$(s).onchange=()=>{state.recommendation=recommendSources();renderRecommendation();renderBuilder();renderCode()});
$("#applyRecommendation").onclick=()=>{state.recommendation.forEach(id=>state.stack.add(id));saveStack();ensureRecipe();renderSources();renderBuilder();renderCode()};
$("#copyCode").onclick=async()=>{try{await navigator.clipboard.writeText(generatedCode(state.codeMode));$("#copyCode").textContent="Copied";setTimeout(()=>$("#copyCode").textContent="Copy",900)}catch{}};
$("#downloadProject").onclick=()=>download("belgium-data-project.json",JSON.stringify(projectPayload(),null,2));
$("#saveProject").onclick=saveProject;
["#cmpA","#cmpB","#cmpC"].forEach(s=>$(s).onchange=renderCompare);

loadView();builderInit();networkInit();compareInit();
$("#sourceStat").textContent=SOURCES.length;$("#workflowStat").textContent=WORKFLOWS.length;$("#identifierStat").textContent=IDENTIFIERS.length;$("#bridgeStat").textContent=BRIDGES.length;
renderSources();renderWorkflows();renderProjects();renderBuilder();renderCode();renderCompare();setView(state.view);
document.addEventListener("bdd:open-source",e=>{const id=e.detail?.id;if(id)detail(id)});
