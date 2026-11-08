import { SOURCES, QUICK } from "./data.mjs";

const $ = (s) => document.querySelector(s);
const cards = $("#cards");
const search = $("#search");
const resultCount = $("#resultCount");
const activeFiltersEl = $("#activeFilters");
const empty = $("#empty");
const stackPanel = $("#stackPanel");
const scrim = $("#scrim");
const dialog = $("#detailDialog");
const stackKey = "belgium-data-desk-stack-v1";

const state = {
  q:"",
  access:new Set(),
  region:new Set(),
  topic:new Set(),
  stack:new Set((() => { try { return JSON.parse(localStorage.getItem(stackKey) || "[]"); } catch { return []; } })())
};

function uniq(field){
  return [...new Set(SOURCES.flatMap(s => Array.isArray(s[field]) ? s[field] : [s[field]]))].sort();
}
function norm(v){ return String(v || "").toLowerCase(); }
function hay(s){
  return norm([s.name,s.org,s.region,s.summary,s.note,...s.access,...s.topics,...s.formats,...s.use].join(" "));
}
function intersects(values,set){ return !set.size || values.some(v => set.has(v)); }
function matches(s){
  if(state.q && !hay(s).includes(norm(state.q))) return false;
  if(!intersects(s.access,state.access)) return false;
  if(state.region.size && !state.region.has(s.region)) return false;
  if(!intersects(s.topics,state.topic)) return false;
  return true;
}
function sourceById(id){ return SOURCES.find(s => s.id === id); }

function saveStack(){
  localStorage.setItem(stackKey, JSON.stringify([...state.stack]));
  $("#stackCount").textContent = state.stack.size;
}

function encodeView(){
  const p = new URLSearchParams();
  if(state.q) p.set("q",state.q);
  if(state.access.size) p.set("access",[...state.access].join(","));
  if(state.region.size) p.set("region",[...state.region].join(","));
  if(state.topic.size) p.set("topic",[...state.topic].join(","));
  const next = p.toString() ? "?" + p.toString() : location.pathname;
  history.replaceState(null,"",next);
}
function loadView(){
  const p = new URLSearchParams(location.search);
  state.q = p.get("q") || "";
  search.value = state.q;
  ["access","region","topic"].forEach(k => {
    const raw = p.get(k);
    if(raw) raw.split(",").filter(Boolean).forEach(v => state[k].add(v));
  });
}

function makeFilter(container, values, key){
  const el = $(container);
  el.innerHTML = "";
  values.forEach(value => {
    const field = key === "topic" ? "topics" : key;
    const count = SOURCES.filter(s => key === "region" ? s.region === value : s[field].includes(value)).length;
    const b = document.createElement("button");
    b.className = "filter-option" + (state[key].has(value) ? " active" : "");
    b.type = "button";
    b.innerHTML = "<span>"+value+"</span><small>"+count+"</small>";
    b.addEventListener("click",() => {
      state[key].has(value) ? state[key].delete(value) : state[key].add(value);
      render();
    });
    el.appendChild(b);
  });
}

function renderQuick(){
  const row = $("#quickRow");
  row.innerHTML = "";
  QUICK.forEach(([label,value]) => {
    const isAccess = uniq("access").includes(value);
    const key = isAccess ? "access" : "topic";
    const b = document.createElement("button");
    b.className = "quick" + (state[key].has(value) ? " active" : "");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click",() => {
      state[key].has(value) ? state[key].delete(value) : state[key].add(value);
      render();
    });
    row.appendChild(b);
  });
}

function card(s,index){
  const article = document.createElement("article");
  article.className = "card";
  const pinned = state.stack.has(s.id);
  article.innerHTML =
    '<div class="card-top"><span class="card-code">BE.'+String(index+1).padStart(2,"0")+' / '+s.region.toUpperCase()+'</span>'+
    '<button class="pin '+(pinned ? "active" : "")+'" type="button" data-pin="'+s.id+'">'+(pinned ? "✓ PINNED" : "+ STACK")+'</button></div>'+
    '<div class="card-body">'+
    '<div><span class="badge '+(s.friction === "Low" ? "low" : "medium")+'">'+s.friction.toUpperCase()+' FRICTION</span></div>'+
    '<h2>'+s.name+'</h2><div class="org">'+s.org+'</div>'+
    '<p class="summary">'+s.summary+'</p>'+
    '<div class="tags">'+s.access.slice(0,2).map(x => '<span class="tag">'+x+'</span>').join("")+
    s.formats.slice(0,2).map(x => '<span class="tag">'+x+'</span>').join("")+'</div></div>'+
    '<div class="card-foot"><button type="button" data-detail="'+s.id+'">Why use it</button><a href="'+s.url+'" target="_blank" rel="noopener">Open source ↗</a></div>';
  return article;
}

function renderActive(){
  const items = [];
  if(state.q) items.push('search: “'+state.q+'”');
  ["access","region","topic"].forEach(k => state[k].forEach(v => items.push(v)));
  activeFiltersEl.innerHTML = items.map(x => '<span class="active-pill">'+x+'</span>').join("");
}

function render(){
  makeFilter("#accessFilters",uniq("access"),"access");
  makeFilter("#regionFilters",uniq("region"),"region");
  makeFilter("#topicFilters",uniq("topics"),"topic");
  renderQuick();
  renderActive();

  const visible = SOURCES.filter(matches);
  cards.innerHTML = "";
  visible.forEach((s,i) => cards.appendChild(card(s,i)));
  resultCount.textContent = visible.length + (visible.length === 1 ? " source" : " sources");
  empty.hidden = visible.length !== 0;
  cards.hidden = visible.length === 0;
  saveStack();
  renderStack();
  encodeView();
}

function toggleStack(id){
  state.stack.has(id) ? state.stack.delete(id) : state.stack.add(id);
  render();
}
function renderStack(){
  const list = $("#stackItems");
  const selected = [...state.stack].map(sourceById).filter(Boolean);
  list.innerHTML = selected.length ? selected.map(s =>
    '<div class="stack-item"><div><strong>'+s.name+'</strong><small>'+s.region+' · '+s.access.join(" / ")+'</small></div>'+
    '<button type="button" data-remove="'+s.id+'">remove</button></div>'
  ).join("") : '<div class="stack-item"><div><strong>Nothing pinned yet.</strong><small>Add sources from the desk.</small></div></div>';
  $("#exportStack").disabled = !selected.length;
}
function openStack(){
  stackPanel.classList.add("open");
  stackPanel.setAttribute("aria-hidden","false");
  scrim.hidden = false;
}
function closeStack(){
  stackPanel.classList.remove("open");
  stackPanel.setAttribute("aria-hidden","true");
  scrim.hidden = true;
}
function openDetail(id){
  const s = sourceById(id);
  if(!s) return;
  $("#dialogContent").innerHTML =
    '<div class="detail-content"><div class="section-kicker">'+s.region+' / '+s.access.join(" + ")+'</div>'+
    '<h2>'+s.name+'</h2><div class="org">'+s.org+'</div><p class="summary">'+s.summary+'</p>'+
    '<div class="detail-grid"><div class="detail-box"><b>USE IT FOR</b><ul class="detail-list">'+s.use.map(x => '<li>'+x+'</li>').join("")+'</ul></div>'+
    '<div class="detail-box"><b>ACCESS PROFILE</b><div>'+s.access.join(" · ")+'</div><div class="tags" style="margin-top:10px">'+s.formats.map(x => '<span class="tag">'+x+'</span>').join("")+'</div></div></div>'+
    '<div class="detail-box"><b>DESK NOTE</b><div>'+s.note+'</div></div>'+
    '<a class="detail-link" href="'+s.url+'" target="_blank" rel="noopener">Open official source ↗</a></div>';
  dialog.showModal();
}

function reset(){
  state.q = ""; search.value = "";
  state.access.clear(); state.region.clear(); state.topic.clear();
  render();
}
function exportStack(){
  const selected = [...state.stack].map(sourceById).filter(Boolean).map(s => ({
    id:s.id,name:s.name,publisher:s.org,url:s.url,region:s.region,access:s.access,formats:s.formats,topics:s.topics
  }));
  const blob = new Blob([JSON.stringify({title:"Belgium Data Desk stack",checked:"2026-09-29",sources:selected},null,2)],{type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "belgium-data-stack.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href),1000);
}

document.addEventListener("click",(e) => {
  const pin = e.target.closest("[data-pin]");
  if(pin) toggleStack(pin.dataset.pin);
  const detail = e.target.closest("[data-detail]");
  if(detail) openDetail(detail.dataset.detail);
  const remove = e.target.closest("[data-remove]");
  if(remove){ state.stack.delete(remove.dataset.remove); render(); }
});
search.addEventListener("input",e => { state.q = e.target.value.trim(); render(); });
document.addEventListener("keydown",e => {
  if(e.key === "/" && document.activeElement !== search){ e.preventDefault(); search.focus(); }
  if(e.key === "Escape") closeStack();
});
$("#stackBtn").addEventListener("click",openStack);
$("#stackClose").addEventListener("click",closeStack);
scrim.addEventListener("click",closeStack);
$("#methodBtn").addEventListener("click",() => $("#method").scrollIntoView({behavior:"smooth"}));
$("#resetFilters").addEventListener("click",reset);
$("#emptyReset").addEventListener("click",reset);
$("#dialogClose").addEventListener("click",() => dialog.close());
$("#clearStack").addEventListener("click",() => { state.stack.clear(); render(); });
$("#exportStack").addEventListener("click",exportStack);
$("#copyView").addEventListener("click",async() => {
  try{
    await navigator.clipboard.writeText(location.href);
    const b = $("#copyView"); const old = b.textContent; b.textContent = "Copied";
    setTimeout(() => b.textContent = old,1100);
  }catch{}
});

loadView();
render();
