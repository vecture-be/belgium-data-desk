// Visual Data Studio: browser-only, lazy-loaded Perspective.
const $=selector=>document.querySelector(selector);
const CDN="https://cdn.jsdelivr.net/npm/@perspective-dev/",VERSION="5.5.1";
let loading=null,worker=null,viewer=null,activeTable=null,active=null,busy=false;
export function makeVisualQuery(sql,limit=10000){
  if(!Number.isSafeInteger(limit)||limit<1||limit>10000)throw Error("Invalid row limit");
  return "SELECT * FROM ("+sql+") AS __bdd_visual LIMIT "+(limit+1);
}
function convert(v){
  if(v==null)return null;
  if(typeof v==="bigint")return v<=BigInt(Number.MAX_SAFE_INTEGER)&&v>=BigInt(Number.MIN_SAFE_INTEGER)?Number(v):v.toString();
  if(v instanceof Date)return Number.isFinite(v.getTime())?v.toISOString():null;
  if(typeof v==="number")return Number.isFinite(v)?v:null;
  if(typeof v==="boolean")return v;
  if(typeof v==="string")return v.slice(0,4096);
  try{return JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x).slice(0,4096)}
  catch{return String(v).slice(0,4096)}
}
export function normalizeVisualRows(cols,rows){
  if(!Array.isArray(cols)||cols.length<1||cols.length>80||
    cols.some(c=>typeof c!=="string"||!c||c.length>512)||new Set(cols).size!==cols.length)
    throw Error("Select 1–80 uniquely named columns (use AS for duplicate SQL columns).");
  if(!Array.isArray(rows)||!rows.length||rows.length>10000)throw Error("Visualizations require 1–10,000 rows.");
  let size=0;
  return rows.map(row=>{
    const item={};
    for(const name of cols){
      const v=convert(row?.[name]);if(typeof v==="string")size+=v.length;
      if(size>12*1024*1024)throw Error("Visualization text budget exceeded (12 MiB); filter or narrow the SQL query.");
      item[name]=v;
    }
    return item;
  });
}
function status(msg,type=""){
  const el=$("#visualStudioStatus");
  if(el){el.textContent=msg;el.className="visual-status "+type}
}
async function ensureLoaded(){
  if(loading)return loading;
  loading=(async()=>{
    if(!$("#bddPerspectiveTheme")){
      const link=document.createElement("link");
      link.id="bddPerspectiveTheme";link.rel="stylesheet";link.crossOrigin="anonymous";
      link.href=CDN+"viewer@"+VERSION+"/dist/css/pro.css";
      document.head.append(link);
      await new Promise((ok,fail)=>{link.onload=ok;link.onerror=()=>fail(Error("Perspective theme could not load"))});
    }
    await import(CDN+"viewer@"+VERSION+"/dist/cdn/perspective-viewer.js");
    await import(CDN+"viewer-datagrid@"+VERSION+"/dist/cdn/perspective-viewer-datagrid.js");
    await import(CDN+"viewer-charts@"+VERSION+"/dist/cdn/perspective-viewer-charts.js");
    const perspective=(await import(CDN+"client@"+VERSION+"/dist/cdn/perspective.js")).default;
    if(!worker)worker=await perspective.worker();
  })().catch(err=>{loading=null;throw err});
  return loading;
}
function chartConfig(type,cols,rows){
  const number=cols.filter(c=>rows.some(r=>typeof r[c]==="number"));
  const category=cols.find(c=>rows.some(r=>typeof r[c]==="string"));
  if(type==="scatter"){
    if(number.length<2)throw Error("Scatter requires two numeric columns.");
    return{plugin:"X/Y Scatter",columns:number.slice(0,2)};
  }
  if(type==="bar"||type==="line"){
    if(!category||!number.length)throw Error("This chart needs a text category and a numeric column.");
    return{plugin:type==="bar"?"Y Bar":"Y Line",group_by:[category],columns:[number[0]]};
  }
  return{plugin:"Datagrid"};
}
async function applyPreset(type){
  if(!viewer||!active)return;
  await viewer.restore(chartConfig(type,active.cols,active.rows));
}
async function exportView(){
  if(!viewer||!active)return;
  const output={kind:"belgium-data-desk-view",version:1,containsDataset:false,
    sql:active.demo?null:active.sql||null,limited:Boolean(active.truncated),
    rows:active.rows.length,view:await viewer.save()};
  const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:"application/json"}));
  const anchor=document.createElement("a");anchor.href=url;anchor.download="belgium-data-studio-view.json";anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importView(file){
  if(!viewer||!file)return;
  if(file.size>100*1024)throw Error("View file exceeds 100 KiB.");
  const data=JSON.parse(await file.text());
  if(data?.kind!=="belgium-data-desk-view"||data.version!==1||!data.view||typeof data.view!=="object"||Array.isArray(data.view))
    throw Error("Not a Belgium Data Desk view configuration.");
  await viewer.restore(data.view);
  status("View settings restored. No dataset was imported.","good");
}
export function bindVisualStudio(){
  const sel=$("#visualPreset");if(!sel||sel.dataset.bound)return;
  sel.dataset.bound="true";
  sel.onchange=()=>applyPreset(sel.value).then(()=>status("View changed.","good")).catch(e=>status(e.message,"bad"));
  $("#visualExportView").onclick=()=>exportView().catch(e=>status(e.message,"bad"));
  const input=$("#visualImportFile");
  $("#visualImportView").onclick=()=>input.click();
  input.onchange=()=>{const f=input.files?.[0];input.value="";importView(f).catch(e=>status(e.message,"bad"))};
  $("#visualClose").onclick=()=>{$("#visualStudio").hidden=true};
}
export async function openVisualStudio(input){
  if(busy)return;
  busy=true;
  const container=$("#visualStudio");
  if(!container)throw Error("Visual Data Studio section missing");
  container.hidden=false;
  container.scrollIntoView({behavior:"smooth",block:"start"});
  status("Preparing in-browser visualization…","busy");
  try{
    const rows=normalizeVisualRows(input.cols,input.rows);
    await ensureLoaded();
    if(!viewer){
      viewer=document.createElement("perspective-viewer");
      viewer.setAttribute("theme","Pro Light");
      viewer.setAttribute("aria-label","Interactive dataset charts and pivot tables");
      $("#visualCanvas").replaceChildren(viewer);
    }
    const table=await worker.table(rows);
    let type="table";
    try{
      await viewer.load(table);
      const hasDimension=input.cols.some(c=>rows.some(r=>typeof r[c]==="string"));
      const hasNumeric=input.cols.some(c=>rows.some(r=>typeof r[c]==="number"));
      type=hasDimension&&hasNumeric?"bar":"table";
      await viewer.restore(chartConfig(type,input.cols,rows)).catch(async()=>{type="table";await viewer.restore({plugin:"Datagrid"})});
    }catch(e){await table.delete().catch(()=>{});throw e}
    const prev=activeTable;
    activeTable=table;active={...input,rows};
    if(prev)await prev.delete().catch(()=>{});
    $("#visualPreset").value=type;
    $("#visualPreset").disabled=false;$("#visualExportView").disabled=false;$("#visualImportView").disabled=false;
    $("#visualCaption").textContent=(input.demo?"SYNTHETIC EXAMPLE · ":"")+rows.length.toLocaleString("en-BE")+
      " rows · "+input.cols.length+" columns"+(input.truncated?" · 10,000-row limit reached: not the full result":"")+
      " · Browser-only processing.";
    status("Ready. Choose a chart or drag fields to group, filter and pivot.","good");
  }catch(e){
    status("Could not load visualization: "+(e.message||String(e))+". Try again if the CDN was unavailable.","bad");
    throw e;
  }finally{busy=false}
}
export async function openVisualExample(){
  const regions=["Brussels","Flanders","Wallonia"],rows=[];
  for(let year=2022;year<=2025;year++)for(let i=0;i<3;i++)
    rows.push({region:regions[i],year,example_index:35+(year-2022)*9+i*14,example_count:12+(year-2022)*3+i*7});
  return openVisualStudio({cols:["region","year","example_index","example_count"],rows,demo:true,truncated:false});
}
