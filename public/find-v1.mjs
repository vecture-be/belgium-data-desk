// Belgium Data Desk front page: one search, plain results, one page per dataset with the checks a reader needs.
// Data comes from the same index the MCP tools use (GET /api/search, /api/dataset, /api/overview), so nothing large is downloaded.
const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=n=>Number(n).toLocaleString("en-GB");
const plain=s=>String(s??"").replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim();
// Hand-curated records carry analyst notes ("aggregate table. one … per …"), not a description a reader needs.
const readable=s=>{s=plain(s);return /^[a-z]/.test(s)&&/one [^.]{0,80}per|table.|reference./.test(s)?"":s};
const VAGUE=new Set(["file","bulk file","other","api"]);
const safeUrl=u=>/^https?:\/\//i.test(String(u||""))?String(u):"";
const TOPICS={geology:"Geology & subsurface",water:"Water & sea",energy:"Energy",transport:"Transport & mobility",health:"Health",population:"Population & society",economy:"Economy & business",environment:"Environment & climate",agriculture:"Agriculture & food",education:"Education & culture",government:"Government & public sector",places:"Maps & places",other:"Other topics"};
const KINDS={dataset:"Dataset","map-service":"Map service",publication:"Report or document",research:"Research data",metadata:"Description only (no file)","data-service":"Data service"};

const els={form:$("#searchForm"),q:$("#q"),filters:$("#filters"),open:$("#openOnly"),scope:$("#scope"),home:$("#home"),start:$("#start"),results:$("#results"),dataset:$("#dataset")};

async function api(path){
  const r=await fetch(path,{headers:{accept:"application/json"}});
  let body=null;try{body=await r.json()}catch{}
  if(!r.ok||!body||body.error)throw new Error(body?.error||("The server answered "+r.status+"."));
  return body;
}

/* ---------- labels: one short phrase per fact, never a score ---------- */
function licenceTag(family){
  if(family==="open"||family==="open-sharealike")return["good","Open licence"];
  if(family==="non-commercial"||family==="no-derivatives")return["warn","Restricted licence"];
  if(family==="custom")return["warn","Own terms"];
  return["unk","No licence stated"];
}
function linkTag(r){
  if(r.access_tier==="ready")return["good","Download works"];
  if(r.access_tier==="broken")return["bad","Download failed"];
  return null;
}
const tag=([cls,text])=>'<span class="tag '+cls+'">'+esc(text)+"</span>";

function resultItem(r){
  const tags=[];
  if(r.authoritative_source)tags.push(tag(["good","Official source"]));
  tags.push(tag(licenceTag(r.licence_family)));
  const lt=linkTag(r);if(lt)tags.push(tag(lt));
  const meta=[r.publisher,KINDS[r.kind]||"",r.updated?"record updated "+r.updated:"",(r.formats||[]).filter(f=>!/^https?:/.test(f)&&!VAGUE.has(String(f).toLowerCase())).slice(0,3).join(", ")].filter(Boolean);
  return'<li><a class="rt" href="/?dataset='+encodeURIComponent(r.id)+'" data-id="'+esc(r.id)+'">'+esc(r.title)+'</a>'+
    '<div class="meta">'+esc(meta.join(" · "))+"</div>"+
    (readable(r.snippet)?'<p class="snip">'+esc(readable(r.snippet))+"</p>":"")+
    '<div class="tags">'+tags.join("")+"</div></li>";
}

/* ---------- views ---------- */
function show(view){
  const home=view==="home";
  els.home.hidden=!home;els.start.hidden=!home;
  els.results.hidden=view!=="results";els.dataset.hidden=view!=="dataset";
  els.filters.hidden=view!=="results";
  els.form.hidden=view==="dataset";
}

let searchSeq=0;
async function runSearch(q,{scope="datasets",open=false}={}){
  show("results");
  document.title=q+" · Belgium Data Desk";
  els.results.innerHTML='<p class="mut">Searching…</p>';
  const seq=++searchSeq;
  let out;
  try{out=await api("/api/search?"+new URLSearchParams({q,scope,...(open?{open:"1"}:{})}))}
  catch(e){if(seq===searchSeq)els.results.innerHTML='<p class="err">'+esc(e.message)+"</p>";return}
  if(seq!==searchSeq)return;
  const list=out.results||[];
  let html="";
  if(out.guidance?.authoritative_source)html+='<div class="guide"><b>Where this data officially comes from</b><p>'+esc(out.guidance.authoritative_source)+"</p>"+(out.guidance.caveat?'<p class="mut">'+esc(out.guidance.caveat)+"</p>":"")+"</div>";
  html+=list.length
    ?'<p class="count">'+(list.length>=20?"Top 20 matches":list.length+" match"+(list.length===1?"":"es"))+' for <b>'+esc(q)+"</b>"+(list.length>=20?". Add a word to narrow it down.":"")+'</p><ol class="list">'+list.map(resultItem).join("")+"</ol>"
    :'<p class="count">Nothing found for <b>'+esc(q)+'</b>. Try fewer words, another language (Dutch, French or English), or <a href="/topics/">browse by topic</a>.</p>';
  els.results.innerHTML=html;
}

function check(state,title,body){
  const icon={good:"✓",warn:"!",bad:"✕",unk:"?"}[state];
  return'<li class="chk '+state+'"><span class="ic" aria-hidden="true">'+icon+'</span><div><b>'+esc(title)+"</b><p>"+body+"</p></div></li>";
}

function freshnessCheck(d){
  const f=d.card?.freshness,period=d.data_profile?.period||d.card?.coverage?.time;
  const parts=[];
  if(period?.to)parts.push("The data runs "+(period.from?"from "+esc(period.from)+" ":"")+"to "+esc(period.to)+".");
  if(d.updated)parts.push("The publisher last changed the catalogue record on "+esc(d.updated)+".");
  if(d.update_cycle_declared)parts.push("Declared update cycle: "+esc(d.update_cycle)+".");
  else parts.push("The publisher does not say how often it updates this.");
  if(f?.status==="overdue")return check("warn","Possibly out of date",parts.join(" ")+" That is "+esc(num(f.overdue_days))+" days later than the declared cycle allows"+(f.at_least?" (at least)":"")+".");
  if(f?.status==="current")return check("good","Up to date with its declared cycle",parts.join(" "));
  return check("unk","Up to date?",parts.join(" "));
}

function datasetHtml(d){
  const lic=d.licence||{},[lc]=licenceTag(lic.family),link=d.link_check,card=d.card;
  const official=safeUrl(d.landing_page);
  const files=(d.files||[]).filter(f=>safeUrl(f.url));
  const contact=d.contact||{};
  const checks=[];
  checks.push(check(lc,"Can I reuse it?",
    lic.family==="open"?"Yes. Open licence: "+esc(lic.label)+".":
    lic.family==="open-sharealike"?"Yes, if you share your result under the same licence ("+esc(lic.label)+").":
    lic.family==="non-commercial"?"Not for commercial use ("+esc(lic.label)+").":
    lic.family==="no-derivatives"?"Only unchanged ("+esc(lic.label)+").":
    lic.family==="custom"?"The publisher uses its own terms ("+esc(lic.label)+"). Read them on the official page before you reuse the data.":
    "The publisher did not state a licence. Ask them before you reuse the data."));
  checks.push(freshnessCheck(d));
  checks.push(link&&link.files_checked
    ?check(link.files_ok===link.files_checked&&!link.format_mismatches?"good":link.files_ok?"warn":"bad","Does the download work?",
      esc(link.files_ok)+" of "+esc(link.files_checked)+" file link"+(link.files_checked===1?"":"s")+" worked when we checked on "+esc(link.checked_on)+"."+(link.format_mismatches?" "+esc(link.format_mismatches)+" file(s) were not in the format the publisher states.":""))
    :check("unk","Does the download work?","We have not checked the file links of this record yet."));
  checks.push(contact.email||safeUrl(contact.url)
    ?check("good","Who can I ask?",contact.email?'<a href="mailto:'+esc(contact.email)+'">'+esc(contact.email)+"</a>":'<a href="'+esc(safeUrl(contact.url))+'" rel="noopener">'+esc(contact.url)+"</a>")
    :check("unk","Who can I ask?","No contact in the publisher's record."+(official?" The official page may list one.":"")));

  const what=[];
  if(d.data_profile?.rows!=null)what.push(["Rows",(d.data_profile.rows_exact?"":"about ")+num(d.data_profile.rows)]);
  if(d.columns?.length)what.push(["Columns",String(d.columns.length)]);
  const period=d.data_profile?.period||card?.coverage?.time;
  if(period?.to)what.push(["Period",(period.from||"?")+" to "+period.to]);
  if(d.geography)what.push(["Area",typeof d.geography==="string"?d.geography:(d.geography.level||d.geography.label||"")]);
  const keys=(card?.coverage?.keys||[]).map(k=>k.column+" ("+String(k.kind).replace(/_/g," ")+")");
  if(keys.length)what.push(["Can be linked on",keys.join(", ")]);
  what.push(["Topic",TOPICS[d.topic]||d.topic||"—"],["Kind",KINDS[d.kind]||d.kind||"—"]);

  const facts=(card?.facts||[]).map(f=>f.text).filter(t=>!/^The file has [\d,]+ rows/.test(t)&&!/^The data runs from/.test(t));

  return'<p class="back"><a href="/" data-back>← '+(history.state?.fromSearch?"Back to results":"Search")+'</a></p>'+
    '<p class="pub">'+esc(d.publisher)+(d.hand_reviewed?' · <span class="tag good">Checked by hand</span>':"")+"</p>"+
    "<h1>"+esc(d.title)+"</h1>"+
    (d.description?'<p class="desc">'+esc(plain(d.description).replace(/([^.!?…)])$/,"$1…"))+"</p>":"")+
    '<p class="actions">'+(official?'<a class="btn primary" href="'+esc(official)+'" rel="noopener">Official page ↗</a>':"")+
      (files.length?'<a class="btn" href="'+esc(files.find(f=>/csv|xlsx?|json|zip|parquet|tsv/i.test(f.format))?.url||files[0].url)+'" rel="noopener nofollow">Download ↓</a>':"")+
      (d.preview_available?'<a class="btn" href="/lab/?dataset='+encodeURIComponent(d.id)+'">Explore in SQL lab</a>':"")+"</p>"+
    "<h2>Before you use it</h2><ul class=\"checks\">"+checks.join("")+"</ul>"+
    "<h2>What is in it</h2><dl class=\"facts\">"+what.map(([k,v])=>"<dt>"+esc(k)+"</dt><dd>"+esc(v)+"</dd>").join("")+"</dl>"+
    (facts.length?'<ul class="plainlist">'+facts.map(t=>"<li>"+esc(t)+"</li>").join("")+'</ul><p class="mut small">Measured by us on '+esc(card.profiled_at)+" from "+(d.data_profile?.rows_exact?"the whole file":"the start of the file")+".</p>":"")+
    (d.columns?.length?'<details><summary>Column names ('+d.columns.length+")</summary><p class=\"cols\">"+d.columns.map(c=>"<code>"+esc(c)+"</code>").join(" ")+"</p></details>":"")+
    (files.length?"<h2>Files</h2><ul class=\"plainlist\">"+files.map(f=>'<li><a href="'+esc(f.url)+'" rel="noopener nofollow">'+esc(String(f.format||"file").replace(/^https?:\/\/.*\//,""))+"</a>"+(f.size_bytes?' <span class="mut">'+esc(num(Math.round(f.size_bytes/1024)))+" KB</span>":"")+"</li>").join("")+"</ul>":"")+
    (d.not_declared_by_publisher?.fields?.length?'<p class="mut small">Not stated in the publisher\'s record: '+esc(d.not_declared_by_publisher.fields.join(", "))+".</p>":"")+
    '<p class="mut small">These checks describe the catalogue record and the file. They do not guarantee that the figures are correct. Record id: <code>'+esc(d.id)+"</code></p>";
}

async function openDataset(id){
  show("dataset");
  els.dataset.innerHTML='<p class="mut">Loading…</p>';
  try{
    const d=await api("/api/dataset?id="+encodeURIComponent(id));
    els.dataset.innerHTML=datasetHtml(d);
    document.title=d.title+" · Belgium Data Desk";
  }catch(e){
    els.dataset.innerHTML='<p class="back"><a href="/">← Search</a></p><p class="err">This dataset could not be loaded: '+esc(e.message)+"</p>";
  }
  window.scrollTo(0,0);
}

/* ---------- routing: ?q=… and ?dataset=… are shareable links ---------- */
function route(){
  const p=new URLSearchParams(location.search);
  const id=p.get("dataset"),q=(p.get("q")||"").trim();
  if(id)return openDataset(id);
  if(q){
    els.q.value=q;els.scope.value=p.get("scope")||"datasets";els.open.checked=p.get("open")==="1";
    return runSearch(q,{scope:els.scope.value,open:els.open.checked});
  }
  els.q.value="";show("home");document.title="Belgium Data Desk: find Belgian open data and check it before you use it";
}
function go(params){
  const qs=new URLSearchParams(params).toString();
  history.pushState(null,"","/"+(qs?"?"+qs:""));
  route();
}
function searchParams(){
  const q=els.q.value.trim();
  return{q,...(els.scope.value!=="datasets"?{scope:els.scope.value}:{}),...(els.open.checked?{open:"1"}:{})};
}

els.form.addEventListener("submit",e=>{e.preventDefault();if(els.q.value.trim())go(searchParams())});
els.scope.addEventListener("change",()=>{if(els.q.value.trim())go(searchParams())});
els.open.addEventListener("change",()=>{if(els.q.value.trim())go(searchParams())});
document.addEventListener("click",e=>{
  const back=e.target.closest("a[data-back]");
  if(back&&history.state?.fromSearch){e.preventDefault();history.back();return}
  const a=e.target.closest("a[href^='/?']");
  if(!a||e.metaKey||e.ctrlKey||e.shiftKey||e.button!==0)return;
  e.preventDefault();history.pushState({fromSearch:!!new URLSearchParams(location.search).get("q")},"",a.getAttribute("href"));route();
});
window.addEventListener("popstate",route);
route();

api("/api/overview").then(o=>{
  const n=o.records;const when=o.links_last_checked;
  if(n)$("#stats").textContent=num(n)+" records from Belgian publishers"+(when?", file links last checked on "+String(when).slice(0,10):"")+".";
}).catch(()=>{});
