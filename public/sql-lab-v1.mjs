import { relayIdForUrl } from "./dataset-relay-id-v1.mjs";
const $=(s,r=document)=>r.querySelector(s);
const esc=(v="")=>String(v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const qid=v=>'"'+String(v).replace(/"/g,'""')+'"';
const slit=v=>"'"+String(v).replace(/'/g,"''")+"'";
const DUCKDB_VERSION="1.32.0";
const ENGINE_SOURCES=[
  {
    name:"jsDelivr bundled",
    importUrl:"https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@"+DUCKDB_VERSION+"/+esm",
    assetBase:"https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@"+DUCKDB_VERSION+"/dist/"
  },
  {
    name:"esm.sh bundled",
    importUrl:"https://esm.sh/@duckdb/duckdb-wasm@"+DUCKDB_VERSION+"?bundle",
    assetBase:"https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@"+DUCKDB_VERSION+"/dist/"
  }
];
const duckdbBundles=base=>({
  mvp:{mainModule:base+"duckdb-mvp.wasm",mainWorker:base+"duckdb-browser-mvp.worker.js"},
  eh:{mainModule:base+"duckdb-eh.wasm",mainWorker:base+"duckdb-browser-eh.worker.js"}
});
const SQL_DRAFT_KEY="bdd-sql-lab-draft-v1";
const DISPLAY_LIMIT=500;
const VISUAL_LIMIT=10000;
const RELAY_SQL_MAX_BYTES=8*1024*1024;
const USER_QUERY_TIMEOUT_MS=20000;
const SAFE_ENGINE_SETTINGS=[
  "SET autoinstall_known_extensions = false",
  "SET allow_community_extensions = false",
  "SET allow_unsigned_extensions = false",
  "SET allow_persistent_secrets = false",
  "SET allow_unredacted_secrets = false",
  "SET threads = 2",
  "SET memory_limit = '512MB'",
  "SET max_temp_directory_size = '64MB'",
  "SET max_expression_depth = 300",
  "SET preserve_insertion_order = false",
  "SET lock_configuration = true"
];

let duckdb,db,conn,enginePromise,lastResult=null,fileSeq=0,lastSelectorTableCount=0;
const tables=new Map();

function setEngineStatus(text,kind=""){
  const el=$("#sqlEngineStatus");if(!el)return;el.textContent=text;el.className="sql-engine-status"+(kind?" "+kind:"");
}
function message(text,kind=""){
  const el=$("#sqlMessage");if(!el)return;el.textContent=text;el.className="sql-message"+(kind?" "+kind:"");
}
async function ensureEngine(){
  if(conn)return conn;
  if(enginePromise)return enginePromise;
  enginePromise=(async()=>{
    setEngineStatus("loading engine","busy");message("Loading DuckDB-Wasm in this browser…","warn");
    let lastError=null;
    for(const source of ENGINE_SOURCES){
      let worker=null,workerUrl="";
      try{
        setEngineStatus("loading "+source.name,"busy");
        duckdb=await import(source.importUrl);
        const bundle=await duckdb.selectBundle(duckdbBundles(source.assetBase));
        workerUrl=URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`],{type:"text/javascript"}));
        worker=new Worker(workerUrl);
        db=new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(),worker);
        await db.instantiate(bundle.mainModule,bundle.pthreadWorker);
        if(workerUrl)URL.revokeObjectURL(workerUrl);
        conn=await db.connect();
        for(const sql of SAFE_ENGINE_SETTINGS){try{await conn.query(sql)}catch{}}
        setEngineStatus("DuckDB ready · restricted","ready");message("Ready via "+source.name+". SQL runs in a restricted DuckDB-Wasm worker; local files are not uploaded.","good");
        return conn;
      }catch(e){
        lastError=e;
        if(workerUrl)URL.revokeObjectURL(workerUrl);
        try{await db?.terminate?.()}catch{}
        try{worker?.terminate?.()}catch{}
        db=null;duckdb=null;
      }
    }
    enginePromise=null;setEngineStatus("engine failed","bad");
    const detail=lastError?.message||String(lastError||"unknown error");
    message("Could not load DuckDB-Wasm from jsDelivr or unpkg: "+detail,"bad");
    throw lastError||new Error("DuckDB-Wasm unavailable");
  })();
  return enginePromise;
}
function resultRows(result){
  const cols=result.schema.fields.map(f=>f.name);
  const rows=result.toArray().map(r=>{
    const j=typeof r?.toJSON==="function"?r.toJSON():null;
    return Object.fromEntries(cols.map(c=>[c,j&&Object.prototype.hasOwnProperty.call(j,c)?j[c]:r?.[c]]));
  });
  return{cols,rows};
}
function valueText(v){
  if(v==null)return"";
  if(typeof v==="bigint")return v.toString();
  if(v instanceof Date)return v.toISOString();
  if(typeof v==="object"){try{return JSON.stringify(v,(_,x)=>typeof x==="bigint"?x.toString():x)}catch{return String(v)}}
  return String(v);
}
function numberValue(v){if(typeof v==="bigint")return Number(v);const n=Number(v);return Number.isFinite(n)?n:0}
function formatBytes(n){
  n=Number(n);if(!Number.isFinite(n)||n<=0)return"";
  const u=["B","KiB","MiB","GiB"];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}
  return(n>=10||i===0?n.toFixed(0):n.toFixed(1))+" "+u[i];
}
function safeTableName(value){
  let s=String(value||"table").replace(/\.[^.]+$/,"").normalize("NFKD").replace(/[^a-zA-Z0-9_]+/g,"_").replace(/^_+|_+$/g,"").toLowerCase();
  if(!s)s="table";if(/^\d/.test(s))s="t_"+s;return s.slice(0,60);
}
function uniqueTable(base){let n=base,i=2;while(tables.has(n))n=base+"_"+i++;return n}
function formatFrom(name,forced="auto"){
  if(forced&&forced!=="auto")return forced;
  let path=String(name||"").toLowerCase();try{path=new URL(path).pathname.toLowerCase()}catch{}
  if(/\.parquet$/.test(path))return"parquet";
  if(/\.(jsonl|ndjson|json)$/.test(path))return"json";
  if(/\.tsv$/.test(path))return"tsv";
  if(/\.csv$/.test(path))return"csv";
  return"";
}
const browserIpv4Parts=host=>{
  if(!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))return null;
  const p=host.split(".").map(Number);return p.every(x=>x>=0&&x<=255)?p:null;
};
const blockedBrowserIpv4=p=>{
  const [a,b,c]=p;
  return a===0||a===10||a===127||a>=224||
    (a===100&&b>=64&&b<=127)||
    (a===169&&b===254)||
    (a===172&&b>=16&&b<=31)||
    (a===192&&b===168)||
    (a===192&&b===0&&(c===0||c===2))||
    (a===198&&(b===18||b===19))||
    (a===198&&b===51&&c===100)||
    (a===203&&b===0&&c===113);
};
export function safeRemoteHttpUrl(value){
  try{
    const u=new URL(String(value||"").trim()),h=u.hostname.toLowerCase().replace(/^\[|\]$/g,"").replace(/\.$/,"");
    if(u.protocol!=="https:"||u.username||u.password||!h)return null;
    if(h==="localhost"||h.endsWith(".localhost")||h.endsWith(".local")||h.endsWith(".internal")||h.endsWith(".home")||h.endsWith(".lan"))return null;
    const p=browserIpv4Parts(h);if(p&&blockedBrowserIpv4(p))return null;
    if(h.includes(":")){
      if(h==="::1"||h==="::"||h.startsWith("fc")||h.startsWith("fd")||/^fe[89ab]/.test(h)||h.startsWith("ff")||h.startsWith("2001:db8:"))return null;
      const mapped=h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);if(mapped){const mp=browserIpv4Parts(mapped[1]);if(!mp||blockedBrowserIpv4(mp))return null}
    }
    return u.href;
  }catch{return null}
}
function relationSql(format,vfs){
  if(format==="parquet")return"read_parquet("+slit(vfs)+")";
  if(format==="json")return"read_json_auto("+slit(vfs)+")";
  if(format==="tsv")return"read_csv_auto("+slit(vfs)+", delim='\\t', header=true)";
  if(format==="csv")return"read_csv_auto("+slit(vfs)+", header=true)";
  throw new Error("Choose CSV, TSV, JSON or Parquet.");
}
async function describeTable(name){
  const r=await queryWithTimeout("DESCRIBE SELECT * FROM "+qid(name));
  return resultRows(r).rows.map(x=>({name:valueText(x.column_name),type:valueText(x.column_type)}));
}
async function registerLocalFile(file){
  await ensureEngine();
  const format=formatFrom(file.name);if(!format)throw new Error(file.name+": unsupported format. Use CSV, TSV, JSON/JSONL or Parquet.");
  const table=uniqueTable(safeTableName(file.name)),ext=file.name.split(".").pop()||format,vfs="local_"+(++fileSeq)+"."+ext.replace(/[^a-z0-9]/gi,"");
  setEngineStatus("ingesting "+file.name,"busy");
  await db.registerFileHandle(vfs,file,duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,true);
  try{
    await queryWithTimeout("CREATE OR REPLACE VIEW "+qid(table)+" AS SELECT * FROM "+relationSql(format,vfs));
    const schema=await describeTable(table);
    tables.set(table,{name:table,label:file.name,source:file.name,kind:"local",format,size:file.size,vfs,schema,rowCount:null});
    renderTables();refreshSelectors();
    message("Loaded "+file.name+" as "+table+" · "+schema.length+" columns.","good");
  }catch(e){try{await db.dropFile(vfs)}catch{}throw e}
  finally{setEngineStatus("DuckDB ready","ready")}
}
async function fetchCompleteRelayBuffer(url,format){
  if(!["csv","tsv"].includes(format))throw Object.assign(new Error("Catalogue relay SQL fallback currently supports complete CSV/TSV files only."),{code:"RELAY_FORMAT"});
  const id=await relayIdForUrl(url),r=await fetch("/api/dataset-file/"+id,{headers:{accept:format==="tsv"?"text/tab-separated-values,text/plain;q=0.9,*/*;q=0.2":"text/csv,text/plain;q=0.9,*/*;q=0.2",range:"bytes=0-"+(RELAY_SQL_MAX_BYTES-1)},cache:"no-store"});
  if(!r.ok)throw Object.assign(new Error(r.status===404?"Dataset is not in the approved relay index.":r.status===429?"Catalogue relay is temporarily rate-limited.":"Catalogue relay returned HTTP "+r.status+"."),{code:r.status===404?"RELAY_NOT_CATALOGUED":r.status===429?"RELAY_RATE_LIMITED":"RELAY_HTTP"});
  const contentRange=r.headers.get("content-range")||"",rangeTotal=Number(contentRange.match(/\/(\d+)$/)?.[1])||0,contentLength=Number(r.headers.get("content-length"))||0,reported=Number(r.headers.get("x-bdd-upstream-size"))||rangeTotal||(r.status===200?contentLength:0);
  if(reported>RELAY_SQL_MAX_BYTES)throw Object.assign(new Error("Publisher file is "+formatBytes(reported)+"; relay-backed SQL is limited to complete files up to "+formatBytes(RELAY_SQL_MAX_BYTES)+". Download/drop it for full SQL."),{code:"RELAY_TOO_LARGE"});
  const bytes=new Uint8Array(await r.arrayBuffer());
  const complete=(reported>0?bytes.byteLength>=reported:(r.status===200&&bytes.byteLength<RELAY_SQL_MAX_BYTES));
  if(!complete)throw Object.assign(new Error("Relay returned only a bounded prefix. SQL Lab will not register a partial file as a complete table."),{code:"RELAY_PARTIAL"});
  return{id,bytes,size:reported||bytes.byteLength};
}
async function registerRemote(opts={}){
  const rawUrl=String(opts.url||$("#sqlRemoteUrl").value||"").trim();if(!rawUrl)throw new Error("Enter a remote URL.");
  const url=safeRemoteHttpUrl(rawUrl);if(!url)throw new Error("Remote SQL ingest accepts public HTTPS URLs without embedded credentials.");
  await ensureEngine();
  const requestedFormat=opts.format||$("#sqlRemoteFormat").value,format=formatFrom(url,requestedFormat);if(!format)throw new Error("Could not infer format. Choose CSV, TSV, JSON or Parquet.");
  const fallback=(()=>{try{return new URL(url).pathname.split("/").filter(Boolean).pop()||"remote"}catch{return"remote"}})();
  const label=String(opts.label||opts.name||$("#sqlRemoteName").value.trim()||fallback),suggested=String(opts.tableName||opts.name||$("#sqlRemoteName").value.trim()||fallback);
  const table=uniqueTable(safeTableName(suggested)),seq=++fileSeq,vfs="remote_"+seq+"."+format;
  setEngineStatus("registering "+label,"busy");
  let transport="direct",registeredVfs=vfs,size=null,relayId="";
  try{
    await db.registerFileURL(vfs,url,duckdb.DuckDBDataProtocol.HTTP,false);
    try{
      await queryWithTimeout("CREATE OR REPLACE VIEW "+qid(table)+" AS SELECT * FROM "+relationSql(format,vfs));
      await describeTable(table);
    }catch(directError){
      try{await conn.query("DROP VIEW IF EXISTS "+qid(table))}catch{}
      try{await db.dropFile(vfs)}catch{}
      if(!["csv","tsv"].includes(format))throw directError;
      const relayed=await fetchCompleteRelayBuffer(url,format);
      transport="relay";relayId=relayed.id;size=relayed.size;registeredVfs="relay_"+seq+"."+format;
      await db.registerFileBuffer(registeredVfs,relayed.bytes);
      await queryWithTimeout("CREATE OR REPLACE VIEW "+qid(table)+" AS SELECT * FROM "+relationSql(format,registeredVfs));
    }
    const schema=await describeTable(table);
    tables.set(table,{name:table,label,source:url,publisher:opts.publisher||"",datasetId:opts.datasetId||"",kind:transport,format,size,vfs:registeredVfs,schema,rowCount:null,relayId});
    renderTables();refreshSelectors();
    if(!opts.keepInputs){$("#sqlRemoteUrl").value="";$("#sqlRemoteName").value=""}
    document.dispatchEvent(new CustomEvent("bdd:sql-access-result",{detail:{url,ok:true,transport}}));
    message("Loaded "+label+" as SQL table "+table+(transport==="relay"?" through the approved catalogue relay.":" directly from the publisher.") ,"good");
    return table;
  }catch(e){
    try{await conn.query("DROP VIEW IF EXISTS "+qid(table))}catch{}
    try{await db.dropFile(registeredVfs)}catch{}
    document.dispatchEvent(new CustomEvent("bdd:sql-access-result",{detail:{url,ok:false,code:e?.code||"",detail:e?.message||String(e)}}));
    throw new Error((e?.message||e)+(e?.code?"":" — direct browser loading failed and no complete safe relay fallback was available."));
  }finally{setEngineStatus("DuckDB ready · restricted","ready")}
}
function renderTables(){
  const el=$("#sqlTables");if(!el)return;
  if(!tables.size){el.innerHTML='<div class="sql-empty">No tables loaded yet.</div>';return}
  const left=$("#sqlJoinLeft")?.value||"",right=$("#sqlJoinRight")?.value||"";
  el.innerHTML=[...tables.values()].map(t=>{
    const cols=t.schema.slice(0,8).map(c=>'<span title="'+esc(c.type)+'">'+esc(c.name)+'</span>').join(""),roles=(t.name===left?'<span class="sql-role left">LEFT</span>':"")+(t.name===right?'<span class="sql-role right">RIGHT</span>':"");
    return'<article class="sql-table-card"><div class="sql-table-card-head"><div><div class="sql-table-title"><b>'+esc(t.label||t.name)+'</b><span class="sql-loaded">SQL LOADED</span>'+(t.kind==="relay"?'<span class="sql-role">CATALOGUE RELAY</span>':"")+roles+'</div><small>SQL table <code>'+esc(t.name)+'</code>'+(t.publisher?' · '+esc(t.publisher):"")+'</small><small>'+esc(t.source)+'</small></div><code>'+esc(t.format.toUpperCase())+(t.size?" · "+formatBytes(t.size):"")+(t.rowCount!=null?" · "+Number(t.rowCount).toLocaleString()+" rows":"")+'</code></div><div class="sql-schema-mini">'+cols+(t.schema.length>8?'<span>+'+(t.schema.length-8)+' fields</span>':"")+'</div><div class="sql-table-actions"><button data-sql-left="'+esc(t.name)+'">Use as left</button><button data-sql-right="'+esc(t.name)+'">Use as right</button><button data-sql-preview="'+esc(t.name)+'">Preview</button><button data-sql-count="'+esc(t.name)+'">Count rows</button><button data-sql-remove="'+esc(t.name)+'">Remove</button></div></article>';
  }).join("");
}
function options(current=""){
  const names=[...tables.keys()];return names.map(n=>{const t=tables.get(n),label=t?.label||n,text=label===n?n:label+" — "+n;return'<option value="'+esc(n)+'" '+(n===current?"selected":"")+'>'+esc(text)+'</option>'}).join("");
}
function keyOptions(table,current=""){
  const cols=tables.get(table)?.schema||[];return cols.map(c=>'<option value="'+esc(c.name)+'" '+(c.name===current?"selected":"")+'>'+esc(c.name)+' · '+esc(c.type)+'</option>').join("");
}
function refreshSelectors(){
  const names=[...tables.keys()],grewToJoin=lastSelectorTableCount<2&&names.length>=2;
  const jl=$("#sqlJoinLeft"),jr=$("#sqlJoinRight"),dt=$("#sqlDupTable");
  const oldL=jl?.value,oldR=jr?.value,oldD=dt?.value;
  if(jl){jl.innerHTML=options(oldL);if(!jl.value&&names[0])jl.value=names[0]}
  if(jr){jr.innerHTML=options(oldR);if(!jr.value&&names[0])jr.value=names[0];if(grewToJoin){const other=names.find(n=>n!==jl?.value);if(other)jr.value=other}}
  if(dt){dt.innerHTML=options(oldD);if(!dt.value&&names[0])dt.value=names[0]}
  lastSelectorTableCount=names.length;
  refreshJoinKeys();refreshDupKeys();renderTables();
}
function refreshJoinKeys(){
  const l=$("#sqlJoinLeft")?.value,r=$("#sqlJoinRight")?.value,lk=$("#sqlJoinLeftKey"),rk=$("#sqlJoinRightKey");
  const oldL=lk?.value,oldR=rk?.value;
  if(lk)lk.innerHTML=keyOptions(l,oldL);if(rk)rk.innerHTML=keyOptions(r,oldR);
  if(l&&r&&lk&&rk&&!oldR){
    const leftNames=new Set((tables.get(l)?.schema||[]).map(x=>x.name));
    const common=(tables.get(r)?.schema||[]).find(x=>leftNames.has(x.name));
    if(common){lk.value=common.name;rk.value=common.name}
  }
}
function refreshDupKeys(){
  const t=$("#sqlDupTable")?.value,k=$("#sqlDupKey"),old=k?.value;if(k)k.innerHTML=keyOptions(t,old);
}
function renderResult(cols,rows,meta=""){
  lastResult={cols,rows};
  $("#sqlExport").disabled=!rows.length;
  $("#sqlResultMeta").textContent=meta||rows.length+" rows";
  if(!cols.length){$("#sqlResult").innerHTML='<div class="sql-empty">Query returned no columns.</div>';return}
  const head=cols.map(c=>"<th>"+esc(c)+"</th>").join("");
  const body=rows.map(row=>"<tr>"+cols.map(c=>'<td title="'+esc(valueText(row[c]))+'">'+esc(valueText(row[c]))+"</td>").join("")+"</tr>").join("");
  $("#sqlResult").innerHTML="<table><thead><tr>"+head+"</tr></thead><tbody>"+body+"</tbody></table>";
}
function sqlSafetyShape(raw){
  const input=String(raw||"");let out="",i=0,blockDepth=0;
  while(i<input.length){
    const ch=input[i],next=input[i+1];
    if(blockDepth){
      if(ch==="/"&&next==="*"){blockDepth++;out+="  ";i+=2;continue}
      if(ch==="*"&&next==="/"){blockDepth--;out+="  ";i+=2;continue}
      out+=ch==="\n"?"\n":" ";i++;continue;
    }
    if(ch==="/"&&next==="*"){blockDepth=1;out+="  ";i+=2;continue}
    if(ch==="-"&&next==="-"){while(i<input.length&&input[i]!=="\n"){out+=" ";i++}continue}
    if(ch==="'"||ch==='"'){
      const quote=ch;out+=quote;i++;
      while(i<input.length){
        if(input[i]===quote&&input[i+1]===quote){out+="  ";i+=2;continue}
        if(input[i]===quote){out+=quote;i++;break}
        out+=input[i]==="\n"?"\n":" ";i++;
      }
      continue;
    }
    if(ch==="$"){
      const m=input.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if(m){
        const tag=m[0],end=input.indexOf(tag,i+tag.length);
        if(end>=0){out+="''";const span=end+tag.length-i;out+=" ".repeat(Math.max(0,span-2));i=end+tag.length;continue}
      }
    }
    out+=ch;i++;
  }
  return out;
}
export function cleanReadOnlySql(raw){
  let sql=String(raw||"").trim().replace(/;+\s*$/,"").trim();
  if(!sql)throw new Error("Enter a SELECT query.");
  const shape=sqlSafetyShape(sql),normalized=shape.trim();
  if(shape.includes(";"))throw new Error("Run one statement at a time.");
  if(!/^(select|with)\b/i.test(normalized))throw new Error("This public lab accepts SELECT / WITH queries only.");
  if(/\b(insert|update|delete|create|drop|alter|copy|attach|detach|install|load|call|vacuum|export|import|pragma|set|reset|prepare|execute|checkpoint|secret)\b/i.test(shape))throw new Error("State-changing or privileged SQL is disabled in this lab.");
  if(/\b(?:from|join)\s*(?:'|\$)/i.test(shape))throw new Error("Direct file/URL relations are disabled. Load data through the INGEST panel first.");
  if(/\b(?:query|read_[a-z0-9_]+|[a-z0-9_]+_scan|parquet_[a-z0-9_]+|sniff_csv|glob|sqlite_query|postgres_query|mysql_query|st_read[a-z0-9_]*|http_[a-z0-9_]+|write_log|force_checkpoint|checkpoint|duckdb_secrets|which_secret)\s*\(/i.test(shape))throw new Error("External I/O, nested SQL, secret inspection and side-effect functions are disabled. Query only tables loaded in this lab.");
  return sql;
}
async function queryWithTimeout(sql,timeoutMs=USER_QUERY_TIMEOUT_MS){
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{try{conn?.cancelSent?.().catch(()=>{})}catch{}reject(Object.assign(new Error("Query stopped after "+Math.round(timeoutMs/1000)+" seconds to protect this browser session."),{code:"QUERY_TIMEOUT"}))},timeoutMs)});
  try{return await Promise.race([conn.query(sql),timeout])}
  finally{clearTimeout(timer)}
}
async function executeSql(raw=$("#sqlEditor").value){
  await ensureEngine();const sql=cleanReadOnlySql(raw),select=/^(select|with)\b/i.test(sql);
  const actual=select?"SELECT * FROM ("+sql+") AS __bdd_result LIMIT "+DISPLAY_LIMIT:sql;
  setEngineStatus("running query","busy");message("Running query locally…","warn");const started=performance.now();
  try{
    const r=await queryWithTimeout(actual),{cols,rows}=resultRows(r),ms=Math.round(performance.now()-started);
    renderResult(cols,rows,rows.length+(rows.length===DISPLAY_LIMIT?" shown (display cap)":"")+" · "+ms+" ms");
    message("Query complete in "+ms+" ms. Only the displayed result is held for CSV export.","good");
  }catch(e){message(e?.message||String(e),"bad");throw e}
  finally{setEngineStatus("DuckDB ready","ready")}
}
async function visualizeSql(){
  const button=$("#sqlVisualize");
  button.disabled=true;
  try{
    await ensureEngine();
    const sql=cleanReadOnlySql($("#sqlEditor").value);
    const studio=await import("./visual-data-studio-v1.mjs");
    studio.bindVisualStudio();
    setEngineStatus("visual query running","busy");
    const result=await queryWithTimeout(studio.makeVisualQuery(sql,VISUAL_LIMIT));
    const {cols,rows}=resultRows(result);
    if(!rows.length)throw Error("No rows were returned to visualize. Select another query.");
    const truncated=rows.length>VISUAL_LIMIT;
    await studio.openVisualStudio({cols,rows:rows.slice(0,VISUAL_LIMIT),sql,truncated});
    message("Visual Data Studio loaded "+Math.min(rows.length,VISUAL_LIMIT).toLocaleString()+" rows"+(truncated?" (10,000-row limit reached; not a full-dataset analysis).":"."),"good");
  }catch(e){message(e?.message||String(e),"bad");throw e}
  finally{button.disabled=false;setEngineStatus("DuckDB ready · restricted","ready")}
}
function writeSql(sql){$("#sqlEditor").value=sql;localStorage.setItem(SQL_DRAFT_KEY,sql);$("#sqlEditor").focus()}
async function previewTable(name){
  const sql="SELECT * FROM "+qid(name)+" LIMIT 100";writeSql(sql+";");await executeSql(sql);
}
async function countTable(name){
  await ensureEngine();setEngineStatus("counting "+name,"busy");
  try{
    const r=await queryWithTimeout("SELECT COUNT(*) AS n FROM "+qid(name)),x=resultRows(r).rows[0],n=numberValue(x?.n);
    const t=tables.get(name);if(t)t.rowCount=n;renderTables();message(name+" has "+n.toLocaleString()+" rows.","good");
  }finally{setEngineStatus("DuckDB ready","ready")}
}
async function removeTable(name){
  const t=tables.get(name);if(!t)return;await ensureEngine();
  try{await conn.query("DROP VIEW IF EXISTS "+qid(name))}catch{}
  try{if(t.vfs)await db.dropFile(t.vfs)}catch{}
  tables.delete(name);renderTables();refreshSelectors();message("Removed "+name+".","good");
}
function buildJoinSql(){
  const l=$("#sqlJoinLeft").value,r=$("#sqlJoinRight").value,lk=$("#sqlJoinLeftKey").value,rk=$("#sqlJoinRightKey").value,type=$("#sqlJoinType").value;
  if(!l||!r||!lk||!rk)throw new Error("Load two tables and choose join keys.");
  return"SELECT l.*, r.*\nFROM "+qid(l)+" AS l\n"+type+" JOIN "+qid(r)+" AS r\n  ON l."+qid(lk)+" = r."+qid(rk)+"\nLIMIT 200";
}
async function testJoin(){
  await ensureEngine();
  const l=$("#sqlJoinLeft").value,r=$("#sqlJoinRight").value,lk=$("#sqlJoinLeftKey").value,rk=$("#sqlJoinRightKey").value;
  if(!l||!r||!lk||!rk)throw new Error("Load two tables and choose join keys.");
  setEngineStatus("testing join","busy");message("Testing key uniqueness, nulls, match rate and row multiplication…","warn");
  const L=qid(l),R=qid(r),LK=qid(lk),RK=qid(rk);
  const sql=`WITH
ldup AS (SELECT COUNT(*) groups_n, COALESCE(SUM(n-1),0) extra_n FROM (SELECT ${LK}, COUNT(*) n FROM ${L} WHERE ${LK} IS NOT NULL GROUP BY ${LK} HAVING COUNT(*)>1)),
rdup AS (SELECT COUNT(*) groups_n, COALESCE(SUM(n-1),0) extra_n FROM (SELECT ${RK}, COUNT(*) n FROM ${R} WHERE ${RK} IS NOT NULL GROUP BY ${RK} HAVING COUNT(*)>1))
SELECT
 (SELECT COUNT(*) FROM ${L}) left_rows,
 (SELECT COUNT(*) FROM ${R}) right_rows,
 (SELECT COUNT(*) FROM ${L} WHERE ${LK} IS NULL) left_nulls,
 (SELECT COUNT(*) FROM ${R} WHERE ${RK} IS NULL) right_nulls,
 (SELECT COUNT(*) FROM ${L} l WHERE l.${LK} IS NOT NULL AND EXISTS (SELECT 1 FROM ${R} r WHERE r.${RK}=l.${LK})) left_matched,
 (SELECT COUNT(*) FROM ${L} l WHERE l.${LK} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${R} r WHERE r.${RK}=l.${LK})) left_unmatched,
 (SELECT COUNT(*) FROM ${R} r WHERE r.${RK} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${L} l WHERE l.${LK}=r.${RK})) right_unmatched,
 (SELECT COUNT(*) FROM ${L} l JOIN ${R} r ON l.${LK}=r.${RK}) join_rows,
 (SELECT groups_n FROM ldup) left_dup_groups,
 (SELECT extra_n FROM ldup) left_dup_extra,
 (SELECT groups_n FROM rdup) right_dup_groups,
 (SELECT extra_n FROM rdup) right_dup_extra`;
  try{
    const result=await queryWithTimeout(sql),x=resultRows(result).rows[0]||{},v=Object.fromEntries(Object.entries(x).map(([k,n])=>[k,numberValue(n)]));
    const relation=v.left_dup_groups&&v.right_dup_groups?"many-to-many":v.left_dup_groups?"many-to-one":v.right_dup_groups?"one-to-many":"one-to-one";
    const rate=v.left_rows?v.left_matched/v.left_rows:0,mult=v.left_matched?v.join_rows/v.left_matched:0;
    const typeL=tables.get(l)?.schema.find(x=>x.name===lk)?.type||"",typeR=tables.get(r)?.schema.find(x=>x.name===rk)?.type||"",typeMismatch=typeL&&typeR&&typeL!==typeR;
    const severity=relation==="many-to-many"?"bad":(v.left_unmatched||v.right_unmatched||v.left_nulls||v.right_nulls||relation!=="one-to-one"||typeMismatch)?"warn":"good";
    $("#sqlJoinDiagnostics").innerHTML=
      '<div class="sql-join-summary"><div><b>'+esc(relation.toUpperCase())+'</b><span>'+esc(l+"."+lk)+" ↔ "+esc(r+"."+rk)+(typeMismatch?" · type mismatch "+esc(typeL)+" / "+esc(typeR):"")+'</span></div><div><b>'+Math.round(rate*100)+'% left match</b><span>'+mult.toFixed(2)+'× joined rows per matched left row</span></div></div>'+
      '<div class="sql-diag '+severity+'"><b>'+v.join_rows.toLocaleString()+'</b><span>joined rows · '+v.left_matched.toLocaleString()+' matched left rows</span></div>'+
      '<div class="sql-diag '+(v.left_dup_groups?"warn":"good")+'"><b>'+v.left_dup_groups.toLocaleString()+'</b><span>left duplicate key groups · '+v.left_dup_extra.toLocaleString()+' extra rows</span></div>'+
      '<div class="sql-diag '+(v.right_dup_groups?"warn":"good")+'"><b>'+v.right_dup_groups.toLocaleString()+'</b><span>right duplicate key groups · '+v.right_dup_extra.toLocaleString()+' extra rows</span></div>'+
      '<div class="sql-diag '+((v.left_unmatched||v.right_unmatched)?"warn":"good")+'"><b>'+v.left_unmatched.toLocaleString()+' / '+v.right_unmatched.toLocaleString()+'</b><span>unmatched left / right non-null keys</span></div>'+
      '<div class="sql-diag '+((v.left_nulls||v.right_nulls)?"warn":"good")+'"><b>'+v.left_nulls.toLocaleString()+' / '+v.right_nulls.toLocaleString()+'</b><span>null join keys left / right</span></div>';
    message("Join test complete: "+relation+", "+Math.round(rate*100)+"% of left rows matched.","good");
  }catch(e){message(e?.message||String(e),"bad");throw e}
  finally{setEngineStatus("DuckDB ready","ready")}
}
function duplicateSql(rows){
  const t=$("#sqlDupTable").value,k=$("#sqlDupKey").value;if(!t||!k)throw new Error("Choose a table and key.");
  if(rows)return"SELECT *\nFROM (\n  SELECT *, COUNT(*) OVER (PARTITION BY "+qid(k)+") AS __duplicate_count\n  FROM "+qid(t)+"\n  WHERE "+qid(k)+" IS NOT NULL\n) d\nWHERE __duplicate_count > 1\nORDER BY __duplicate_count DESC\nLIMIT 200";
  return"SELECT "+qid(k)+", COUNT(*) AS duplicate_count\nFROM "+qid(t)+"\nWHERE "+qid(k)+" IS NOT NULL\nGROUP BY "+qid(k)+"\nHAVING COUNT(*) > 1\nORDER BY duplicate_count DESC\nLIMIT 200";
}
export function safeCsvCellValue(v){
  let s=valueText(v);
  if(typeof v==="string"&&/^[\u0000-\u0020]*[=+@-]/.test(s))s="'"+s;
  return s;
}
function csvCell(v){const s=safeCsvCellValue(v);return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function exportCsv(){
  if(!lastResult?.rows?.length)return;
  const body=[lastResult.cols.map(csvCell).join(","),...lastResult.rows.map(r=>lastResult.cols.map(c=>csvCell(r[c])).join(","))].join("\r\n");
  const blob=new Blob(["\ufeff",body],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="sql-result.csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function clearResult(){lastResult=null;$("#sqlExport").disabled=true;$("#sqlResultMeta").textContent="No result";$("#sqlResult").innerHTML='<div class="sql-empty">Run a SELECT to see rows here.</div>'}
async function ingestFiles(files){
  for(const file of files||[]){try{await registerLocalFile(file)}catch(e){message(e?.message||String(e),"bad")}}
  if(tables.size===1){const name=[...tables.keys()][0];writeSql("SELECT * FROM "+qid(name)+" LIMIT 100;")}
}

function bind(){
  const draft=localStorage.getItem(SQL_DRAFT_KEY);if(draft)$("#sqlEditor").value=draft;
  $("#sqlFiles").onchange=e=>{ingestFiles(e.target.files);e.target.value=""};
  const zone=$("#sqlDropZone");
  ["dragenter","dragover"].forEach(type=>zone.addEventListener(type,e=>{e.preventDefault();zone.classList.add("drag")}));
  ["dragleave","drop"].forEach(type=>zone.addEventListener(type,e=>{e.preventDefault();zone.classList.remove("drag")}));
  zone.addEventListener("drop",e=>ingestFiles(e.dataTransfer?.files));
  $("#sqlAddRemote").onclick=()=>registerRemote().catch(e=>message(e?.message||String(e),"bad"));
  $("#sqlRun").onclick=()=>executeSql().catch(()=>{});
  $("#sqlVisualize").onclick=()=>visualizeSql().catch(()=>{});
  $("#sqlDemoVisual").onclick=()=>import("./visual-data-studio-v1.mjs").then(m=>{m.bindVisualStudio();return m.openVisualExample()}).catch(e=>message(e?.message||String(e),"bad"));
  $("#sqlEditor").oninput=e=>localStorage.setItem(SQL_DRAFT_KEY,e.target.value);
  $("#sqlEditor").onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();executeSql().catch(()=>{})}};
  $("#sqlCopy").onclick=async()=>{try{await navigator.clipboard.writeText($("#sqlEditor").value);$("#sqlCopy").textContent="Copied";setTimeout(()=>$("#sqlCopy").textContent="Copy SQL",900)}catch{}};
  $("#sqlExport").onclick=exportCsv;$("#sqlClearResult").onclick=clearResult;
  $("#sqlJoinLeft").onchange=()=>{refreshJoinKeys();renderTables()};$("#sqlJoinRight").onchange=()=>{refreshJoinKeys();renderTables()};$("#sqlDupTable").onchange=refreshDupKeys;
  $("#sqlBuildJoin").onclick=()=>{try{writeSql(buildJoinSql()+";");message("Join SQL written. Run it when ready.","good")}catch(e){message(e.message,"bad")}};
  $("#sqlTestJoin").onclick=()=>testJoin().catch(()=>{});
  $("#sqlDupGroups").onclick=()=>{try{const sql=duplicateSql(false);writeSql(sql+";");executeSql(sql).catch(()=>{})}catch(e){message(e.message,"bad")}};
  $("#sqlDupRows").onclick=()=>{try{const sql=duplicateSql(true);writeSql(sql+";");executeSql(sql).catch(()=>{})}catch(e){message(e.message,"bad")}};
  $("#sqlTables").addEventListener("click",e=>{
    const left=e.target.closest("[data-sql-left]");if(left){$("#sqlJoinLeft").value=left.dataset.sqlLeft;refreshJoinKeys();renderTables();message("Left table: "+(tables.get(left.dataset.sqlLeft)?.label||left.dataset.sqlLeft)+".","good");return}
    const right=e.target.closest("[data-sql-right]");if(right){$("#sqlJoinRight").value=right.dataset.sqlRight;refreshJoinKeys();renderTables();message("Right table: "+(tables.get(right.dataset.sqlRight)?.label||right.dataset.sqlRight)+".","good");return}
    const p=e.target.closest("[data-sql-preview]");if(p){previewTable(p.dataset.sqlPreview).catch(x=>message(x.message,"bad"));return}
    const count=e.target.closest("[data-sql-count]");if(count){countTable(count.dataset.sqlCount).catch(x=>message(x.message,"bad"));return}
    const rm=e.target.closest("[data-sql-remove]");if(rm)removeTable(rm.dataset.sqlRemove).catch(x=>message(x.message,"bad"));
  });
  document.addEventListener("bdd:view-change",e=>{if(e.detail?.view==="builder")ensureEngine().catch(()=>{})});
  document.addEventListener("bdd:sql-add-url",e=>{
    const d=e.detail||{},nav=document.querySelector('.nav-tab[data-view="builder"]');
    if(nav)nav.click();
    if(d.url)$("#sqlRemoteUrl").value=d.url;
    if(d.name)$("#sqlRemoteName").value=safeTableName(d.name);
    if(d.format&&["csv","tsv","json","parquet"].includes(d.format))$("#sqlRemoteFormat").value=d.format;
    registerRemote({url:d.url,format:d.format,name:d.name,label:d.name,publisher:d.publisher,datasetId:d.datasetId}).catch(err=>message(err?.message||String(err),"bad"));
  });
  document.addEventListener("bdd:sql-add-items",async e=>{
    const items=Array.isArray(e.detail?.items)?e.detail.items:[],nav=document.querySelector('.nav-tab[data-view="builder"]');
    if(nav)nav.click();
    const eligible=items.filter(item=>!item.analysisStatus||["ready","possible"].includes(item.analysisStatus.kind));
    const sources=eligible.flatMap(item=>{
      const source=Array.isArray(item.sqlSources)?item.sqlSources[0]:null;
      return source?[{...source,name:item.title||source.name||"dataset",label:item.title||source.name||"dataset",publisher:item.publisher||"",datasetId:item.datasetId||item.id||""}]:[];
    });
    if(!sources.length){message("None of the selected datasets is SQL READY or SQL POSSIBLE. Download-only and non-tabular datasets stay out of the lab.","warn");return}
    let loaded=0,failed=0;
    for(const source of sources){
      try{await registerRemote({...source,keepInputs:true});loaded++}catch(err){failed++;message((err?.message||String(err))+" · You can still use the publisher download and drop the file here.","warn")}
    }
    if(loaded){
      refreshSelectors();
      const joinHint=loaded>=2?" Choose the two tables and keys under JOIN CHECK, then click Test join.":"";
      message("Loaded "+loaded+" selected catalogue dataset"+(loaded===1?"":"s")+(failed?" · "+failed+" could not be loaded completely in-browser":"")+"."+joinHint,"good");
      if(loaded>=2)$("#sqlJoinDiagnostics").innerHTML='<div class="sql-empty"><b>'+loaded+' tables loaded.</b><br>Choose left/right tables and keys above, then <b>Test join</b> to check duplicates, null keys, match rate and row multiplication.</div>';
    }
  });
}
if(typeof document!=="undefined"&&$("#sqlEditor"))bind();
