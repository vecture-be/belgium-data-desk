import { SOURCES as BASE, QUICK } from "./data.mjs";
import { EXTRA_SOURCES, GUIDANCE, WORKFLOWS, IDENTIFIERS } from "./deep-data.mjs";
import { SOURCE_OVERRIDES, GUIDANCE_OVERRIDES, FACTCHECKED_AT } from "./factcheck-v1.mjs";
import { RELATIONSHIPS_V2, RELATION_TYPE_DEFS, SOURCE_PROFILES, GRAPH_FAMILIES, GRAPH_MODEL, relationFamily, relationJoinability, relationRisk } from "./relationship-graph-v2.mjs";

const SOURCES=[...BASE,...EXTRA_SOURCES].map(s=>({...s,...(SOURCE_OVERRIDES[s.id]||{})}));
const BRIDGES=RELATIONSHIPS_V2.map(r=>Object.assign([r.from,r.to,r.key,r.purpose,r.label,r.score,r.identityPreserving,r.recordLevel,r.caution,r.evidence,r.kind],{meta:r}));
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=(v="")=>String(v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const stackKey="bdd-stack-v6",projectKey="bdd-projects-v6",datasetStackKey="bdd-asset-stack-v2",datasetPinMetaKey="bdd-asset-pin-meta-v1";
const safeJson=(raw,fallback)=>{try{let x=JSON.parse(raw);return x??fallback}catch{return fallback}};
const state={view:"explorer",q:"",access:new Set(),region:new Set(),topic:new Set(),stack:new Set(safeJson(localStorage.getItem(stackKey)||"[]",[])),recipe:[],recommendation:[],codeMode:"manifest",path:[],graphEdge:""};
const datasetPinIds=safeJson(localStorage.getItem(datasetStackKey)||"[]",[]);
const datasetPinMeta=safeJson(localStorage.getItem(datasetPinMetaKey)||"{}",{});
let datasetPinned=(Array.isArray(datasetPinIds)?datasetPinIds:[]).map(id=>datasetPinMeta[id]||{id,title:id,publisher:"Dataset",depth:"harvested",datasetId:id,kind:"dataset",formats:[],sourceUrl:"",sqlSources:[]});
const sqlAccessChecks=new Map();
function sqlAccessInfo(d){
  const source=Array.isArray(d?.sqlSources)?d.sqlSources[0]:null;
  if(!source?.url)return{kind:"none",label:"no direct SQL distribution"};
  return sqlAccessChecks.get(source.url)||{kind:"idle",label:"browser access not checked"};
}
function sqlAccessBadge(d){
  const s=d?.analysisStatus||{kind:Array.isArray(d?.sqlSources)&&d.sqlSources.length?"possible":"not-tabular",label:Array.isArray(d?.sqlSources)&&d.sqlSources.length?"SQL POSSIBLE":"NOT TABULAR",detail:""};
  const cls=s.kind==="ready"?"good":s.kind==="possible"?"checking":s.kind==="download"?"bad":"neutral";
  return'<span class="stack-sql-state '+cls+'" title="'+esc(s.detail||s.label)+'">'+esc(s.label)+'</span>';
}
async function probeSqlAccess(d){
  const source=Array.isArray(d?.sqlSources)?d.sqlSources[0]:null,url=source?.url;
  if(!url||sqlAccessChecks.has(url))return;
  sqlAccessChecks.set(url,{kind:"checking",label:"checking direct browser…"});renderStack();
  try{
    const res=await fetch(url,{method:"HEAD",mode:"cors",cache:"no-store",redirect:"follow"});
    if(res.ok)sqlAccessChecks.set(url,{kind:"ok",label:"direct browser ✓",detail:"HEAD check succeeded; this source is likely directly fetchable by the browser."});
    else if([405,501].includes(res.status))sqlAccessChecks.set(url,{kind:"unknown",label:"HEAD unavailable · try",detail:"The publisher does not support HEAD; the actual SQL load may still work."});
    else sqlAccessChecks.set(url,{kind:"unknown",label:"HTTP "+res.status+" · try",detail:"The lightweight HEAD check did not succeed; the actual SQL load may behave differently."});
  }catch(e){
    sqlAccessChecks.set(url,{kind:"fail",label:"browser access failed",detail:"Direct cross-origin browser check failed. This often means CORS is blocked."});
  }
  renderStack();
}
function probePinnedSqlAccess(){}

function updateStackCount(){$("#stackCount").textContent=state.stack.size+datasetPinned.length}
const by=id=>SOURCES.find(s=>s.id===id);
const guide=s=>({...((GUIDANCE[s.id])||{keys:[],joins:[],caution:s.note||""}),...(GUIDANCE_OVERRIDES[s.id]||{})});
const vals=f=>[...new Set(SOURCES.flatMap(s=>Array.isArray(s[f])?s[f]:[s[f]]))].filter(Boolean).sort();
const norm=v=>String(v||"").toLowerCase();

function bridgeBetween(a,b){return BRIDGES.find(x=>(x[0]===a&&x[1]===b)||(x[0]===b&&x[1]===a))}
function graphFilter(){
  return{family:$("#graphFamily")?.value||"",joinability:$("#graphJoinability")?.value||"",topic:$("#graphTopic")?.value||""};
}
function edgeAllowed(b,forPath=false){
  const f=graphFilter(),m=b.meta||{};
  if(f.family&&relationFamily(m)!==f.family)return false;
  if(f.joinability==="record"&&!m.recordLevel)return false;
  if(f.joinability==="nonlossy"&&m.lossiness!=="none")return false;
  if(f.joinability==="analytical"&&m.recordLevel)return false;
  if(f.topic){
    const a=by(b[0]),d=by(b[1]);
    if(!a?.topics.includes(f.topic)&&!d?.topics.includes(f.topic))return false;
  }
  return true;
}
function adjacency(weighted=false){
  const m=new Map(SOURCES.map(s=>[s.id,[]]));
  BRIDGES.forEach(b=>{if(edgeAllowed(b,true)&&m.has(b[0])&&m.has(b[1])){const w=weighted?10+relationRisk(b.meta):1;m.get(b[0]).push([b[1],b,w]);m.get(b[1]).push([b[0],b,w])}});
  return m;
}
function fewestPath(start,end){
  if(!start||!end)return[];
  if(start===end)return[start];
  const a=adjacency(false),q=[[start]],seen=new Set([start]);
  while(q.length){let p=q.shift(),last=p[p.length-1];for(const [n] of a.get(last)||[]){if(seen.has(n))continue;let np=[...p,n];if(n===end)return np;seen.add(n);q.push(np)}}
  return[];
}
function safestPath(start,end){
  if(!start||!end)return[];
  if(start===end)return[start];
  const a=adjacency(true),dist=new Map(SOURCES.map(s=>[s.id,Infinity])),prev=new Map(),open=new Set(SOURCES.map(s=>s.id));dist.set(start,0);
  while(open.size){
    let u=null,best=Infinity;for(const id of open){const d=dist.get(id);if(d<best){best=d;u=id}}
    if(u===null||best===Infinity)break;open.delete(u);if(u===end)break;
    for(const [v,,w] of a.get(u)||[]){if(!open.has(v))continue;const alt=best+w;if(alt<dist.get(v)){dist.set(v,alt);prev.set(v,u)}}
  }
  if(!prev.has(end))return[];
  const p=[end];for(let cur=end;cur!==start;){cur=prev.get(cur);if(!cur)return[];p.push(cur)}return p.reverse();
}
function shortestPath(start,end){return $("#pathMode")?.value==="fewest"?fewestPath(start,end):safestPath(start,end)}
function commonKeys(a,b){
  const ka=new Set(guide(a).keys.map(norm));
  return guide(b).keys.filter(k=>ka.has(norm(k)));
}
function compatibility(a,b){
  if(!a||!b)return{score:0,label:"Choose two sources",why:""};
  if(a.id===b.id)return{score:100,label:"Same source",why:"Same source; no cross-system relationship is being assessed."};
  const direct=bridgeBetween(a.id,b.id);
  if(direct)return{score:direct[5],label:direct[4],why:direct[3]+". "+direct[8]};
  const p=shortestPath(a.id,b.id);
  if(p.length>1){
    const edges=p.slice(0,-1).map((id,i)=>bridgeBetween(id,p[i+1])).filter(Boolean);
    const weakest=edges.length?Math.min(...edges.map(e=>e[5])):20;
    return{score:Math.max(10,Math.round(weakest*.72)),label:"Relationship path — not a join guarantee",why:"A typed path exists, but every hop must be validated independently. Graph connectivity does not imply record-level joinability."};
  }
  const keys=commonKeys(a,b);
  if(keys.length)return{score:42,label:"Shared key label — semantics unverified",why:"Matching field names do not prove shared namespace, grain, version or identity semantics."};
  const common=a.topics.filter(t=>b.topics.includes(t));
  if(common.length)return{score:18,label:"Same domain only",why:"Topic overlap is contextual, not a join contract."};
  return{score:5,label:"No documented relationship",why:"No explicit relationship is recorded in this field guide."};
}
function machineReady(s){return s.access.some(a=>["API / web service","Metadata API","Download","Geospatial service"].includes(a))}
function hay(s){let g=guide(s);return norm([s.name,s.org,s.region,s.summary,s.note,...s.access,...s.topics,...s.formats,...(s.use||[]),...g.keys,...g.joins,g.caution].join(" "))}
function matches(s){return(!state.q||hay(s).includes(norm(state.q)))&&(!state.access.size||s.access.some(x=>state.access.has(x)))&&(!state.region.size||state.region.has(s.region))&&(!state.topic.size||s.topics.some(x=>state.topic.has(x)))}
function saveStack(){localStorage.setItem(stackKey,JSON.stringify([...state.stack]));updateStackCount();document.dispatchEvent(new CustomEvent("bdd:stack-change",{detail:{count:state.stack.size,ids:[...state.stack]}}))}
function selected(){return[...state.stack].map(by).filter(Boolean)}
function ensureRecipe(){let ids=selected().map(s=>s.id);state.recipe=state.recipe.filter(id=>ids.includes(id));ids.forEach(id=>{if(!state.recipe.includes(id))state.recipe.push(id)})}

function encodeView(){
  const p=new URLSearchParams();
  if(state.view!=="datasets")p.set("view",state.view);
  if(state.q)p.set("q",state.q);
  ["access","region","topic"].forEach(k=>{if(state[k].size)p.set(k,[...state[k]].join(","))});
  const openDataset=new URLSearchParams(location.search).get("dataset");if(openDataset)p.set("dataset",openDataset);   // deep link written by the dataset view
  history.replaceState(null,"",p.toString()?"?"+p.toString():location.pathname);
}
function loadView(){
  const p=new URLSearchParams(location.search);
  state.view=["datasets","explorer","workflows","network","builder","compare","quiz"].includes(p.get("view"))?p.get("view"):"datasets";
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
  return'<article class="card"><div class="card-top"><span class="card-code">BE.'+String(i+1).padStart(2,"0")+" / "+esc(s.region.toUpperCase())+'</span><button class="pin '+(pinned?"active":"")+'" data-pin="'+s.id+'">'+(pinned?"✓ PINNED":"+ STACK")+'</button></div><div class="card-body"><div class="meta-strip"><span class="badge">'+esc(s.org)+'</span><span class="micro">'+(machineReady(s)?"MACHINE-READY":"LOOKUP / CATALOGUE")+"</span></div><h2>"+esc(s.name)+'</h2><p class="summary">'+esc(s.summary)+'</p><div class="keyline"><b>RELATE VIA</b> '+esc(g.keys.slice(0,3).join(" · ")||"publisher metadata")+'</div><div class="tags">'+s.access.slice(0,2).map(x=>'<span class="tag">'+esc(x)+"</span>").join("")+s.formats.slice(0,2).map(x=>'<span class="tag quiet">'+esc(x)+"</span>").join("")+'</div></div><div class="card-foot"><button data-detail="'+s.id+'">Details</button><button data-route="'+s.id+'">Route</button><a href="'+s.url+'" target="_blank" rel="noopener">Official ↗</a></div></article>';
}
function renderSources(){
  makeFilter("#accessFilters",vals("access"),"access");makeFilter("#regionFilters",vals("region"),"region");makeFilter("#topicFilters",vals("topics"),"topic");renderQuick();
  let a=SOURCES.filter(matches);$("#cards").innerHTML=a.map(sourceCard).join("");$("#cards").hidden=!a.length;$("#empty").hidden=!!a.length;$("#resultCount").textContent=a.length+" "+(a.length===1?"source":"sources");
  let pills=[];if(state.q)pills.push('search: “'+state.q+'”');["access","region","topic"].forEach(k=>state[k].forEach(v=>pills.push(v)));$("#activeFilters").innerHTML=pills.map(x=>'<span class="active-pill">'+esc(x)+"</span>").join("");
  saveStack();ensureRecipe();renderStack();encodeView();
}

function renderWorkflows(){
  $("#workflowGrid").innerHTML=WORKFLOWS.map(w=>'<article class="workflow"><div class="workflow-lead"><span class="workflow-no">'+w.n+'</span><div><h2>'+esc(w.title)+"</h2><p>"+esc(w.question)+'</p><div class="outcome">KEYS / '+w.keys.map(esc).join(" · ")+'</div></div></div><div class="steps">'+w.steps.map((st,i)=>{let s=by(st[0]);return'<div class="step"><span>'+String(i+1).padStart(2,"0")+'</span><button data-detail="'+s.id+'">'+esc(s.name)+"</button><b>"+esc(st[1])+"</b><p>"+esc(st[2])+"</p></div>"}).join("")+'</div><div class="workflow-foot"><span>'+[...new Set([...w.steps.map(x=>x[0]),...w.bulk])].length+' source systems · '+w.keys.length+' primary keys</span><div><button data-simulate="'+w.id+'">Open SQL lab</button> <button class="primary" data-workflow="'+w.id+'">Add stack</button></div></div></article>').join("");
}

function fillSelect(sel,blank){
  let el=$(sel),cur=el.value;
  el.innerHTML=(blank?'<option value="">'+esc(blank)+"</option>":"")+SOURCES.map(s=>'<option value="'+s.id+'">'+esc(s.name)+"</option>").join("");
  if(cur&&by(cur))el.value=cur;
}
function networkInit(){
  fillSelect("#pathFrom");fillSelect("#pathTo");$("#pathFrom").value=SOURCES[0].id;$("#pathTo").value=SOURCES[Math.min(3,SOURCES.length-1)].id;
  $("#graphTopic").innerHTML='<option value="">All topics</option>'+vals("topics").map(t=>'<option>'+esc(t)+"</option>").join("");
  $("#graphFamily").innerHTML='<option value="">All relationship families</option>'+GRAPH_FAMILIES.map(x=>'<option value="'+x.id+'">'+esc(x.label)+"</option>").join("");
  $("#graphLegend").innerHTML=GRAPH_FAMILIES.map(x=>'<span data-family="'+x.id+'"><i></i>'+esc(x.label)+"</span>").join("");
  $("#graphModelNote").innerHTML="<b>MODEL "+esc(GRAPH_MODEL.version)+"</b><span>"+esc(GRAPH_MODEL.principle)+"</span><small>"+esc(GRAPH_MODEL.risk)+"</small>";
  renderPath();
}
function relationshipContract(b){
  const m=b?.meta;if(!m)return"";
  const type=RELATION_TYPE_DEFS[m.kind]||{};
  const req=(m.requires||[]).map(x=>'<li>'+esc(x)+'</li>').join("");
  const fail=(m.failureModes||[]).map(x=>'<li>'+esc(x)+'</li>').join("");
  const ev=(m.evidenceUrls||[]).map((u,i)=>'<a href="'+esc(u)+'" target="_blank" rel="noopener">evidence '+(i+1)+' ↗</a>').join("");
  return '<article class="edge-contract"><div class="edge-contract-head"><span class="edge-family" data-family="'+esc(relationFamily(m))+'">'+esc(type.label||m.label)+'</span><strong>'+esc(m.operation||"manual validation")+'</strong></div>'+
    (type.description?'<p class="edge-type-desc">'+esc(type.description)+'</p>':"")+
    '<dl><div><dt>Key / alignment</dt><dd>'+esc(m.key||"dataset-specific")+'</dd></div><div><dt>Namespace</dt><dd>'+esc(m.namespace||"dataset-specific")+'</dd></div><div><dt>Cardinality</dt><dd>'+esc(m.cardinality||"n:m")+'</dd></div><div><dt>Direction</dt><dd>'+esc(m.direction||"bidirectional")+'</dd></div><div><dt>Joinability</dt><dd>'+esc(relationJoinability(m))+'</dd></div><div><dt>Lossiness</dt><dd>'+esc(m.lossiness||"possible")+'</dd></div><div><dt>Evidence level</dt><dd>'+esc(m.evidenceLevel||"analyst-qualified")+'</dd></div><div><dt>Scope</dt><dd>'+esc(m.scope||"source-family relationship")+'</dd></div><div><dt>Temporal contract</dt><dd>'+esc(m.temporal||"verify compatible period/version")+'</dd></div><div><dt>Grain</dt><dd>'+esc((m.grainFrom||"source-specific")+" → "+(m.grainTo||"source-specific"))+'</dd></div></dl>'+
    (req?'<div class="edge-rules"><b>Required before use</b><ul>'+req+'</ul></div>':"")+
    (fail?'<div class="edge-rules warn"><b>Failure modes</b><ul>'+fail+'</ul></div>':"")+
    (m.caution?'<p class="edge-caution">'+esc(m.caution)+'</p>':"")+
    (ev?'<div class="edge-evidence">'+ev+'</div>':"")+
  '</article>';
}
function renderEdgeInspector(id){
  state.graphEdge=id||state.graphEdge;
  const b=BRIDGES.find(x=>x.meta?.id===state.graphEdge);
  $("#graphInspector").innerHTML=b?'<div class="inspector-title"><b>'+esc(by(b[0])?.name||b[0])+' → '+esc(by(b[1])?.name||b[1])+'</b><span>relationship risk '+relationRisk(b.meta)+'/100</span></div>'+relationshipContract(b):'<div class="graph-empty-inspector"><b>Select a relationship</b><p>Click an edge to inspect its join contract, scope and failure modes.</p></div>';
}
function renderPath(){
  let a=by($("#pathFrom").value),b=by($("#pathTo").value),c=compatibility(a,b),p=shortestPath(a&&a.id,b&&b.id);state.path=p;
  const pathEdges=p.slice(0,-1).map((id,i)=>bridgeBetween(id,p[i+1])).filter(Boolean);
  const risk=pathEdges.length?Math.max(...pathEdges.map(x=>relationRisk(x.meta))):0;
  $("#compatibility").innerHTML='<div class="score-number '+(c.score>=75?"good":c.score>=45?"mid":"low")+'">'+c.score+'</div><b>'+esc(c.label)+'</b><p>'+esc(c.why)+'</p>'+
    (pathEdges.length?'<div class="path-risk"><span>weakest-hop risk</span><b>'+risk+'/100</b></div>':"")+
    '<small class="score-disclaimer">Safest path minimises relationship risk, not distance. Every hop remains a separate contract.</small>';
  if(!p.length)$("#pathSteps").innerHTML='<div class="path-hop"><b>No recorded path under these filters</b><span>Relax relationship-family/joinability filters or validate a new edge.</span></div>';
  else $("#pathSteps").innerHTML=p.map((id,i)=>{let s=by(id);if(i===p.length-1)return'<div class="path-hop"><b>'+esc(s.name)+'</b><span>destination</span></div>';let br=bridgeBetween(id,p[i+1]),m=br?.meta;return'<div class="path-hop detailed"><b>'+esc(s.name)+' → '+esc(by(p[i+1]).name)+'</b><span>'+esc((RELATION_TYPE_DEFS[m?.kind]?.label||br?.[4]||"typed relationship")+' · '+(m?.operation||br?.[2]||"validate"))+'</span>'+(m?'<small>'+esc((m.cardinality||"n:m")+' · '+(m.lossiness||"possible")+' loss · '+(m.evidenceLevel||"analyst-qualified"))+'</small>':"")+(br?'<button data-inspect-edge="'+esc(br.meta?.id||"")+'">inspect contract</button>':"")+'</div>'}).join("");
  renderGraph();
}
function graphBands(){
  const bucket={metadata:0,entities:1,aggregates:2,spatial:3,observations:4};
  const layerToBand=l=>["metadata","classification"].includes(l)?"metadata":["entity","document"].includes(l)?"entities":l==="aggregate"?"aggregates":["feature","geospatial"].includes(l)?"spatial":"observations";
  const groups=[[],[],[],[],[]];SOURCES.forEach(s=>groups[bucket[layerToBand(SOURCE_PROFILES[s.id]?.layer)]].push(s));
  return{groups,names:["Metadata / semantics","Entities / registries","Aggregates / results","Spatial / reference","Observations / feeds"]};
}
function renderGraph(){
  const filter=graphFilter(),hot=new Set(state.path),hotEdges=new Set;
  for(let i=0;i<state.path.length-1;i++)hotEdges.add([state.path[i],state.path[i+1]].sort().join("|"));
  const activeEdges=BRIDGES.filter(b=>edgeAllowed(b,false)),activeNodes=new Set(activeEdges.flatMap(b=>[b[0],b[1]]));
  if(!filter.family&&!filter.joinability&&!filter.topic)SOURCES.forEach(s=>activeNodes.add(s.id));
  const {groups,names}=graphBands(),pos={},width=1320,colW=250,padX=150,rowH=62,padY=78,maxRows=Math.max(...groups.map(g=>g.length),1),height=Math.max(680,padY+maxRows*rowH+55);
  groups.forEach((g,gi)=>g.sort((a,b)=>a.name.localeCompare(b.name)).forEach((s,ri)=>pos[s.id]={x:padX+gi*colW,y:padY+ri*rowH}));
  const defs='<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z"></path></marker></defs>';
  const bands=names.map((n,i)=>'<g class="graph-band"><text x="'+(padX+i*colW)+'" y="28" text-anchor="middle">'+esc(n)+'</text><line x1="'+(padX+i*colW)+'" y1="42" x2="'+(padX+i*colW)+'" y2="'+(height-20)+'"></line></g>').join("");
  const edges=BRIDGES.map(b=>{let a=pos[b[0]],d=pos[b[1]],m=b.meta,key=[b[0],b[1]].sort().join("|"),active=activeEdges.includes(b),hotEdge=hotEdges.has(key),selected=state.graphEdge===m?.id;if(!a||!d)return"";return'<line class="graph-edge family-'+esc(relationFamily(m))+' '+(hotEdge?"hot ":"")+(selected?"selected ":"")+(!active?"dim":"")+'" data-graph-edge="'+esc(m?.id||"")+'" x1="'+a.x+'" y1="'+a.y+'" x2="'+d.x+'" y2="'+d.y+'" '+(m?.direction==="forward"?'marker-end="url(#arrow)"':"")+'><title>'+esc((RELATION_TYPE_DEFS[m?.kind]?.label||b[4])+" · "+(m?.operation||"")+" · "+(m?.cardinality||""))+'</title></line>'}).join("");
  const nodes=SOURCES.map(s=>{let p=pos[s.id],profile=SOURCE_PROFILES[s.id]||{},dim=!activeNodes.has(s.id),name=s.name.length>25?s.name.slice(0,23)+"…":s.name;return'<g class="graph-node '+(hot.has(s.id)?"hot ":"")+(dim?"dim":"")+'" data-graph-node="'+s.id+'" transform="translate('+p.x+" "+p.y+')"><rect x="-78" y="-17" width="156" height="34" rx="4"></rect><text class="node-name" x="0" y="-1" text-anchor="middle">'+esc(name)+'</text><text class="node-type" x="0" y="11" text-anchor="middle">'+esc(profile.role||"source")+'</text><title>'+esc(s.name+" · "+(profile.role||"source"))+'</title></g>'}).join("");
  $("#graphWrap").innerHTML='<svg class="graph-svg graph-v2" viewBox="0 0 '+width+" "+height+'" style="height:'+height+'px" role="img" aria-label="Typed source relationship graph">'+defs+bands+edges+nodes+"</svg>";
  const record=activeEdges.filter(b=>b.meta?.recordLevel).length,pub=activeEdges.filter(b=>b.meta?.evidenceLevel==="publisher-explicit").length;
  $("#graphStats").textContent=activeEdges.length+" relationships · "+record+" record-level · "+pub+" publisher-explicit";
  renderEdgeInspector(state.graphEdge);
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
  const machine=a.filter(machineReady).length/a.length;
  const rels=BRIDGES.filter(b=>ids.has(b[0])&&ids.has(b[1]));
  const direct=rels.filter(b=>b[6]&&b[7]),contextual=rels.filter(b=>!b[7]);
  const keyCount=new Set(a.flatMap(s=>guide(s).keys)).size,evidenceCoverage=a.filter(s=>s.evidence?.length).length/a.length;
  const directCoverage=Math.min(1,direct.length/Math.max(1,a.length-1));
  let score=Math.round(15+machine*30+evidenceCoverage*20+directCoverage*20+Math.min(1,keyCount/5)*15);
  if($("#automation").value==="production"&&a.some(s=>!machineReady(s)))score=Math.max(0,score-20);
  score=Math.min(100,score);
  let items=[];
  items.push([direct.length?"good":"warn",direct.length+" identity-preserving record relationship"+(direct.length===1?"":"s"),direct.length?"These edges have an explicit record-level identifier relationship.":"No selected pair has an explicit record-level identity bridge. Graph connectivity is not joinability."]);
  items.push([machine>=.7?"good":"warn",Math.round(machine*100)+"% reusable-interface coverage",machine>=.7?"Most selected systems expose an API, download or geospatial service.":"Some selected systems are primarily consultation/catalogue interfaces."]);
  if(contextual.length)items.push(["warn",contextual.length+" contextual / aggregate relationship"+(contextual.length===1?"":"s"),"These relationships support analysis or navigation, not automatic one-to-one joins."]);
  else items.push(["good",Math.round(evidenceCoverage*100)+"% source-checked coverage","Publisher evidence/caveats are included where this audit has verified them."]);
  if($("#automation").value==="production"&&a.some(s=>!machineReady(s)))items.push(["bad","Production access blocker","Identify an approved reusable API/download/service before implementation."]);
  return{score,items};
}
function renderBuilder(){
  ensureRecipe();renderRecommendation();let d=diagnostics();$("#readinessScore").textContent=d.score;$("#diagnostics").innerHTML=d.items.map(x=>'<div class="diag '+x[0]+'"><b>'+esc(x[1])+"</b><p>"+esc(x[2])+"</p></div>").join("");
  $("#recipe").innerHTML=state.recipe.length?state.recipe.map((id,i)=>{let s=by(id);return'<div class="recipe-row"><span>'+String(i+1).padStart(2,"0")+'</span><div><b>'+esc(s.name)+'</b><small>'+esc(guide(s).keys.slice(0,2).join(" · ")||s.access.join(" / "))+'</small></div><div class="recipe-actions"><button data-up="'+id+'" title="Move up">↑</button><button data-down="'+id+'" title="Move down">↓</button><button data-remove="'+id+'" title="Remove">×</button></div></div>'}).join(""):'<div class="empty"><b>No sources selected</b><p>Choose a workflow or pin publishers before exporting a project.</p></div>';
}
function projectPayload(){
  let a=state.recipe.map(by).filter(Boolean),ids=new Set(a.map(s=>s.id));
  return{project:$("#projectName").value.trim()||"Belgium Data Desk project",objective:$("#objective").selectedOptions[0]?.textContent||"",geography:$("#geography").value,automation:$("#automation").value,output:$("#output").value,generated:new Date().toISOString(),factchecked:FACTCHECKED_AT,sources:a.map(s=>({id:s.id,name:s.name,publisher:s.org,docs_url:s.url,region:s.region,access:s.access,formats:s.formats,topics:s.topics,relationship_keys:guide(s).keys,caution:guide(s).caution,evidence:s.evidence||[]})),relationships:BRIDGES.filter(b=>ids.has(b[0])&&ids.has(b[1])).map(b=>({from:b[0],to:b[1],type:b.meta.kind,family:relationFamily(b.meta),key_or_alignment:b.meta.key,purpose:b.meta.purpose,operation:b.meta.operation,cardinality:b.meta.cardinality,namespace:b.meta.namespace,grain_from:b.meta.grainFrom,grain_to:b.meta.grainTo,temporal_contract:b.meta.temporal,scope:b.meta.scope,lossiness:b.meta.lossiness,evidence_level:b.meta.evidenceLevel,score:b.meta.score,identity_preserving:b.meta.identityPreserving,record_level:b.meta.recordLevel,requires:b.meta.requires,failure_modes:b.meta.failureModes,caution:b.meta.caution,evidence:b.meta.evidence,evidence_urls:b.meta.evidenceUrls}))};
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
    p.relationships.forEach(b=>lines.push("-- "+b.from+" ↔ "+b.to+": "+b.key_or_alignment+" ("+b.relationship_type+")"));
    return lines.join("\n");
  }
  let lines=["# "+p.project,"","**Objective:** "+p.objective+"  ","**Geography:** "+p.geography+"  ","**Automation:** "+p.automation+"  ","**Output:** "+p.output,"","## Sources",""];
  p.sources.forEach((s,i)=>{lines.push((i+1)+". **"+s.name+"** — "+s.publisher);lines.push("   - Access: "+s.access.join(", "));lines.push("   - Relationship fields: "+(s.relationship_keys.join(", ")||"publisher metadata"));lines.push("   - Docs: "+s.docs_url);lines.push("   - Watch: "+s.caution)});
  lines.push("","## Typed relationships","");p.relationships.forEach(b=>lines.push("- "+b.from+" → "+b.to+": **"+b.relationship_type+"** — "+b.key_or_alignment+" — "+b.purpose));
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
    ["Publisher",s=>s.org],["Region",s=>s.region],["Access",s=>s.access],["Formats",s=>s.formats],["Topics",s=>s.topics],["Relationship fields / keys",s=>guide(s).keys],["Machine-ready",s=>machineReady(s)?"Yes":"No / discovery only"],["Friction",s=>s.friction],["Caution",s=>guide(s).caution]
  ];
  let head="<tr><th>Dimension</th>"+a.map(s=>"<th>"+esc(s.name)+"</th>").join("")+"</tr>";
  let body=rows.map(r=>"<tr><td>"+esc(r[0])+"</td>"+a.map(s=>{let v=r[1](s);return"<td>"+(Array.isArray(v)?v.map(x=>'<span class="compare-pill">'+esc(x)+"</span>").join(""):esc(v))+"</td>"}).join("")+"</tr>").join("");
  let compat="<tr><td>Relationship score</td>"+a.map((s,i)=>{if(i===0)return"<td>baseline</td>";let c=compatibility(a[0],s);return"<td><b>"+c.score+"/100</b><br>"+esc(c.label)+"</td>"}).join("")+"</tr>";
  $("#compareTable").innerHTML="<table><thead>"+head+"</thead><tbody>"+body+compat+"</tbody></table>";
}

function detail(id,connections=true){
  let s=by(id);if(!s)return;let g=guide(s),related=BRIDGES.filter(b=>b[0]===id||b[1]===id);
  const evidence=s.evidence?.length?'<section class="fact-evidence"><div class="fact-head"><b>SOURCE-CHECKED</b><span>'+esc(FACTCHECKED_AT)+'</span></div><p>'+esc(s.verifiedNote||"Checked against official publisher documentation.")+'</p><div class="evidence-links">'+s.evidence.map(e=>'<a href="'+e[1]+'" target="_blank" rel="noopener">'+esc(e[0])+' ↗</a>').join("")+'</div></section>':"";
  const rel=connections&&related.length?'<div class="connections"><h3>Typed relationships</h3>'+related.map(b=>'<div class="relationship-row"><div><b>'+esc(b[4])+'</b><small>'+esc(b[3])+'</small></div><span>'+esc(b[2])+' · '+b[5]+'/100</span><p>'+esc(b[8])+'</p></div>').join("")+'</div>':"";
  $("#dialogContent").innerHTML='<div class="detail"><small>'+esc(s.region)+" / "+esc(s.org)+'</small><h2>'+esc(s.name)+'</h2><p class="lead">'+esc(s.summary)+'</p><div class="detail-grid"><section><h3>Use it for</h3><ul>'+(s.use||[]).map(x=>"<li>"+esc(x)+"</li>").join("")+'</ul></section><section><h3>Relationship guidance</h3><ul>'+g.joins.map(x=>"<li>"+esc(x)+"</li>").join("")+'</ul></section></div><div class="keys"><b>Useful identifiers / alignment fields</b>'+g.keys.map(x=>"<span>"+esc(x)+"</span>").join("")+'</div><div class="caveat"><b>Watch out</b><p>'+esc(g.caution||s.note||"")+'</p></div>'+evidence+rel+'<a class="detail-link" href="'+s.url+'" target="_blank" rel="noopener">Open official source ↗</a></div>';$("#detailDialog").showModal();
}
function routeTo(id){setView("network");$("#pathTo").value=id;renderPath();window.scrollTo({top:$(".network-shell").offsetTop-80,behavior:"smooth"})}

function renderStack(){
  const publishers=selected(),datasets=datasetPinned;
  const phtml=publishers.map(s=>'<div class="stack-item"><div><b>'+esc(s.name)+'</b><small>'+esc(s.region)+" · "+esc(s.access.join(" / "))+'</small></div><button data-remove="'+esc(s.id)+'">remove</button></div>').join("");
  const dhtml=datasets.map(d=>'<div class="stack-item"><div><button class="stack-dataset-link" data-open-pinned-dataset="'+esc(d.id)+'"><b>'+esc(d.title)+'</b></button><small>'+esc(d.publisher||"Dataset")+' · '+esc(d.datasetId||d.id)+' · '+esc(d.depth||"harvested")+'</small><div class="stack-sql-row">'+sqlAccessBadge(d)+'</div></div><button data-remove-dataset="'+esc(d.id)+'">remove</button></div>').join("");
  $("#stackItems").innerHTML=publishers.length||datasets.length?(publishers.length?'<div class="stack-group-label">PUBLISHERS · '+publishers.length+'</div>'+phtml:"")+(datasets.length?'<div class="stack-group-label">DATASETS · '+datasets.length+'</div>'+dhtml:""):'<div class="stack-item"><div><b>Nothing pinned yet.</b><small>Pin publishers or datasets to collect them here.</small></div></div>';
  $("#exportStack").disabled=!(publishers.length||datasets.length);
  $("#exportDatasets").disabled=!datasets.length;
  const analyzable=datasets.filter(d=>["ready","possible"].includes(d.analysisStatus?.kind)||(!d.analysisStatus&&Array.isArray(d.sqlSources)&&d.sqlSources.length));
  const ready=datasets.filter(d=>d.analysisStatus?.kind==="ready").length,possible=datasets.filter(d=>d.analysisStatus?.kind==="possible").length;
  $("#analyzeDatasetsSql").disabled=!analyzable.length;
  $("#analyzeDatasetsSql").textContent=ready?"Analyze "+ready+" ready"+(possible?" · try "+possible:""):possible?"Try "+possible+" SQL possible":"Analyze in SQL lab";
  updateStackCount();
  probePinnedSqlAccess();
}

function openStack(){$("#stackPanel").classList.add("open");$("#scrim").hidden=false}
function closeStack(){$("#stackPanel").classList.remove("open");$("#scrim").hidden=true}
function addWorkflow(id){let w=WORKFLOWS.find(x=>x.id===id);if(!w)return;[...w.steps.map(x=>x[0]),...w.bulk].forEach(x=>state.stack.add(x));saveStack();ensureRecipe();renderSources();renderBuilder()}
function resetFilters(){state.q="";$("#search").value="";state.access.clear();state.region.clear();state.topic.clear();renderSources()}
function download(name,text,type="application/json"){let b=new Blob([text],{type}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

const paletteActions=[
  ["Dataset Atlas","Open concrete datasets and distributions",()=>setView("datasets")],["Publishers","Open publisher/source context",()=>setView("explorer")],["Workflows","Open guided workflows",()=>setView("workflows")],["Publisher map","Show publisher-level relationships",()=>setView("network")],["SQL lab","Load files, run SQL and test joins in browser",()=>setView("builder")],["Compare","Compare source systems",()=>setView("compare")],["Quiz","Open Data Skills Lab",()=>setView("quiz")],["Project stack","Open selected sources",openStack]
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
  let datasetOpen=e.target.closest("[data-open-pinned-dataset]");if(datasetOpen){setView("datasets");closeStack();document.dispatchEvent(new CustomEvent("bdd:dataset-open",{detail:{id:datasetOpen.dataset.openPinnedDataset}}));return}
  let datasetRemove=e.target.closest("[data-remove-dataset]");if(datasetRemove){document.dispatchEvent(new CustomEvent("bdd:dataset-pin-toggle",{detail:{id:datasetRemove.dataset.removeDataset}}));return}
  let p=e.target.closest("[data-pin]");if(p){state.stack.has(p.dataset.pin)?state.stack.delete(p.dataset.pin):state.stack.add(p.dataset.pin);renderSources();renderBuilder();renderCode()}
  let d=e.target.closest("[data-detail]");if(d)detail(d.dataset.detail);
  let r=e.target.closest("[data-route]");if(r)routeTo(r.dataset.route);
  let w=e.target.closest("[data-workflow]");if(w)addWorkflow(w.dataset.workflow);
  let sim=e.target.closest("[data-simulate]");if(sim){$("#objective").value=sim.dataset.simulate;state.recommendation=recommendSources();setView("builder");renderRecommendation()}
  let rm=e.target.closest("[data-remove]");if(rm){state.stack.delete(rm.dataset.remove);state.recipe=state.recipe.filter(x=>x!==rm.dataset.remove);renderSources();renderBuilder();renderCode()}
  let up=e.target.closest("[data-up]");if(up){let i=state.recipe.indexOf(up.dataset.up);if(i>0)[state.recipe[i-1],state.recipe[i]]=[state.recipe[i],state.recipe[i-1]];renderBuilder();renderCode()}
  let dn=e.target.closest("[data-down]");if(dn){let i=state.recipe.indexOf(dn.dataset.down);if(i>=0&&i<state.recipe.length-1)[state.recipe[i+1],state.recipe[i]]=[state.recipe[i],state.recipe[i+1]];renderBuilder();renderCode()}
  let ct=e.target.closest("[data-code]");if(ct){state.codeMode=ct.dataset.code;$$(".code-tab").forEach(x=>x.classList.toggle("active",x===ct));renderCode()}
  let ge=e.target.closest("[data-graph-edge]");if(ge){state.graphEdge=ge.dataset.graphEdge;renderEdgeInspector(state.graphEdge);renderGraph()}
  let ie=e.target.closest("[data-inspect-edge]");if(ie){state.graphEdge=ie.dataset.inspectEdge;renderEdgeInspector(state.graphEdge);renderGraph()}
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
$("#clearStack").onclick=()=>{state.stack.clear();state.recipe=[];document.dispatchEvent(new CustomEvent("bdd:dataset-clear"));renderSources();renderBuilder();renderCode()};
$("#exportStack").onclick=()=>download("belgium-data-stack.json",JSON.stringify({...projectPayload(),datasets:datasetPinned},null,2));
$("#exportDatasets").onclick=()=>document.dispatchEvent(new CustomEvent("bdd:dataset-export"));
$("#analyzeDatasetsSql").onclick=()=>{closeStack();document.dispatchEvent(new CustomEvent("bdd:sql-add-items",{detail:{items:datasetPinned}}))};
$("#copyView").onclick=async()=>{try{await navigator.clipboard.writeText(location.href);$("#copyView").textContent="Copied";setTimeout(()=>$("#copyView").textContent="Copy view link",900)}catch{}};
$("#findPath").onclick=renderPath;$("#pathFrom").onchange=renderPath;$("#pathTo").onchange=renderPath;["#graphTopic","#graphFamily","#graphJoinability","#pathMode"].forEach(s=>$(s).onchange=renderPath);
$("#recommendBtn").onclick=()=>{state.recommendation=recommendSources();renderRecommendation()};
["#objective","#geography","#automation","#output"].forEach(s=>$(s).onchange=()=>{state.recommendation=recommendSources();renderRecommendation();renderBuilder();renderCode()});
$("#applyRecommendation").onclick=()=>{state.recommendation.forEach(id=>state.stack.add(id));saveStack();ensureRecipe();renderSources();renderBuilder();renderCode()};
$("#copyCode").onclick=async()=>{try{await navigator.clipboard.writeText(generatedCode(state.codeMode));$("#copyCode").textContent="Copied";setTimeout(()=>$("#copyCode").textContent="Copy",900)}catch{}};
$("#downloadProject").onclick=()=>download("belgium-data-project.json",JSON.stringify(projectPayload(),null,2));
$("#saveProject").onclick=saveProject;
["#cmpA","#cmpB","#cmpC"].forEach(s=>$(s).onchange=renderCompare);

document.addEventListener("bdd:dataset-stack-change",e=>{datasetPinned=e.detail?.items||[];renderStack()});
loadView();builderInit();networkInit();compareInit();
$("#sourceStat").textContent=SOURCES.length;$("#workflowStat").textContent=WORKFLOWS.length;$("#identifierStat").textContent=IDENTIFIERS.length;$("#bridgeStat").textContent=BRIDGES.length;
document.addEventListener("bdd:catalogue-stats",e=>{
  const d=e.detail||{};if(!d.datasets)return;
  $("#sourceStat").textContent=Number(d.datasets).toLocaleString();$("#sourceStatLabel").textContent=d.records?"datasets · "+Number(d.records).toLocaleString()+" records incl. maps & documents":"unique datasets";
  $("#workflowStat").textContent=Number(d.publishers||0).toLocaleString();$("#workflowStatLabel").textContent=d.nationalLoaded?"national publishers":"publishers loaded";
  $("#identifierStat").textContent=Number(d.structured||0).toLocaleString();$("#identifierStatLabel").textContent="publisher schemas";
  $("#bridgeStat").textContent=Number(d.sampled||0).toLocaleString();$("#bridgeStatLabel").textContent="record samples";
});
renderSources();renderWorkflows();renderProjects();renderBuilder();renderCode();renderCompare();setView(state.view);
document.addEventListener("bdd:open-source",e=>{const id=e.detail?.id;if(id)detail(id)});
