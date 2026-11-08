const ISSUE_TYPES=[
  ["duplicates","Duplicate rows / non-unique key"],
  ["missing","Unexpected missing values"],
  ["schema","Schema or field changed"],
  ["stale","Data appears stale"],
  ["access","Download / API is broken"],
  ["metadata","Metadata or documentation is wrong"],
  ["values","Suspicious values / range"],
  ["coverage","Missing period / geography / records"],
  ["license","Licence or reuse terms unclear"],
  ["other","Other data issue"]
];

const esc=(v="")=>String(v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const clean=v=>String(v||"").trim();
const validEmail=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(v));
const emailFrom=v=>{let s=clean(v).replace(/^mailto:/i,"");try{s=decodeURIComponent(s)}catch{}return validEmail(s)?s:""};
const safeUrl=v=>{try{const u=new URL(clean(v));return /^https?:$/.test(u.protocol)?u.href:""}catch{return""}};
const firstDistribution=a=>(a?.distributions||[]).find(d=>d?.[4])?.[4]||a?.tabularProfile?.sourceUrl||"";
const contactFor=a=>{
  const email=emailFrom(a?.contactEmail||a?.contact?.email||"");
  const contactUrl=safeUrl(a?.contactUrl||a?.contact?.url||"");
  const officialUrl=safeUrl(a?.officialUrl||a?.sourceRecord||a?.evidence?.[0]||firstDistribution(a));
  return{email,url:contactUrl||officialUrl,name:clean(a?.contactName||a?.contact?.name||"")};
};
const issueLabel=id=>ISSUE_TYPES.find(x=>x[0]===id)?.[1]||"Data issue";
const stat=v=>Number.isFinite(Number(v))?Number(v).toLocaleString():"";

function profileLines(p){
  if(!p)return[];
  const lines=[];
  if(p.rowCount!=null)lines.push("Rows scanned: "+(p.rowCountKind==="exact"?"":"at least ")+stat(p.rowCount));
  if(p.fields?.length)lines.push("Fields: "+p.fields.length);
  if(p.bytesRead)lines.push("Bytes read: "+stat(p.bytesRead));
  if(p.businessKey){
    const k=p.businessKey;
    if(k.fields?.length)lines.push("Tested key: "+k.fields.join(" + "));
    if(k.rows!=null)lines.push("Key rows tested: "+stat(k.rows));
    if(k.uniqueKeys!=null)lines.push("Unique keys: "+stat(k.uniqueKeys));
    if(k.nullRows!=null)lines.push("Null/incomplete key rows: "+stat(k.nullRows));
    if(k.duplicateRows!=null)lines.push("Duplicate key rows: "+stat(k.duplicateRows));
    if(k.duplicateGroups!=null)lines.push("Duplicate key groups: "+stat(k.duplicateGroups));
  }
  const notable=(p.fields||[]).map(f=>({
    name:f.name,missing:Number(f.missing||0),duplicates:Number(f.duplicates||0),
    min:f.min,max:f.max
  })).filter(f=>f.missing||f.duplicates).sort((a,b)=>(b.duplicates+b.missing)-(a.duplicates+a.missing)).slice(0,8);
  if(notable.length){
    lines.push("Notable columns:");
    for(const f of notable)lines.push("- "+f.name+": "+stat(f.missing)+" missing; "+stat(f.duplicates)+" duplicate values");
  }
  return lines;
}

function reportText({asset,publisherName,profile,issue,details,distribution,includeDiagnostics=true}){
  const lines=[
    "Hello,",
    "",
    "I found a possible open-data issue while using the dataset below.",
    "",
    "Issue: "+issueLabel(issue),
    details?"Details: "+clean(details):"",
    "",
    "Dataset: "+clean(asset?.title),
    "Dataset ID: "+clean(asset?.datasetId||asset?.id),
    "Publisher: "+clean(publisherName||asset?.provider||asset?.product),
    asset?.updatedAt?"Catalogue/update date: "+clean(asset.updatedAt):"",
    distribution?"Distribution: "+distribution:"",
    safeUrl(asset?.officialUrl||asset?.evidence?.[0]||"")?"Official page: "+safeUrl(asset?.officialUrl||asset?.evidence?.[0]||""):"",
  ].filter(Boolean);
  if(includeDiagnostics&&profile){
    lines.push("","Browser observations:");
    lines.push(...profileLines(profile));
    lines.push("Profile scope: "+(profile.rowCountKind==="exact"?"complete file within browser limit":"bounded browser scan"));
  }
  lines.push("","Could you confirm whether this is expected, or update the dataset/metadata if needed?","","Generated from Belgium Data Desk. The report was prepared locally in the user's browser; Belgium Data Desk does not send email on the user's behalf.");
  return lines.join("\n");
}

function ensureDialog(){
  let d=document.querySelector("#datasetFeedbackDialog");
  if(d)return d;
  d=document.createElement("dialog");d.id="datasetFeedbackDialog";d.className="dataset-feedback-dialog";
  document.body.appendChild(d);return d;
}

function distributionOptions(asset,selected){
  const rows=(asset?.distributions||[]).filter(d=>d?.[4]);
  if(!rows.length)return'<option value="">No distribution URL in metadata</option>';
  return rows.map(d=>'<option value="'+esc(d[4])+'" '+(d[4]===selected?"selected":"")+'>'+esc((d[0]||d[1]||"distribution")+" · "+d[4])+'</option>').join("");
}

export function feedbackCard(asset,publisherName){
  const c=contactFor(asset),label=c.email?(c.name||c.email):c.url?"publisher page available":"contact not published";
  return '<section class="publisher-feedback-card"><div><small>DATA QUALITY FEEDBACK</small><h3>Found something wrong?</h3><p>Turn what you observed into a reproducible report for '+esc(publisherName||asset?.provider||"the publisher")+'. Belgium Data Desk prepares it locally; you decide whether to send it.</p></div><div class="publisher-feedback-actions"><span>'+esc(label)+'</span><button type="button" data-report-asset="'+esc(asset?.id||"")+'">Report data issue</button></div></section>';
}

export function openDatasetFeedback(asset,{publisherName="",profile=null}={}){
  const d=ensureDialog(),c=contactFor(asset),selected=profile?.url||profile?.sourceUrl||firstDistribution(asset);
  d.innerHTML='<form method="dialog" class="dataset-feedback-shell"><header><div><small>PUBLISHER FEEDBACK</small><h2>Report a data issue</h2><p>'+esc(asset?.title||"Dataset")+'</p></div><button value="cancel" class="dataset-feedback-close" aria-label="Close">×</button></header>'+
    '<div class="dataset-feedback-contact"><b>'+esc(publisherName||asset?.provider||"Publisher")+'</b><span>'+(c.email?'Email: '+esc(c.email):c.url?'No email in catalogue metadata · publisher page available':'No machine-readable contact found')+'</span></div>'+
    '<label>Issue type<select id="datasetFeedbackType">'+ISSUE_TYPES.map(([id,label])=>'<option value="'+id+'">'+esc(label)+'</option>').join("")+'</select></label>'+
    '<label>What did you observe?<textarea id="datasetFeedbackDetails" rows="5" placeholder="Example: customer_id should be unique, but 18 duplicate key groups appeared in the browser profile."></textarea></label>'+
    '<label>Distribution<select id="datasetFeedbackDistribution">'+distributionOptions(asset,selected)+'</select></label>'+
    (profile?'<label class="dataset-feedback-check"><input id="datasetFeedbackDiagnostics" type="checkbox" checked> Include browser profile evidence (row count, missing values, duplicates, tested key)</label>':'<p class="dataset-feedback-hint">Run the browser profiler first if you want the report to include measured duplicate/null evidence automatically.</p>')+
    '<details class="dataset-feedback-preview"><summary>Preview generated report</summary><pre id="datasetFeedbackPreview"></pre></details>'+
    '<div id="datasetFeedbackStatus" class="dataset-feedback-status" role="status"></div>'+
    '<footer><button type="button" id="datasetFeedbackCopy">Copy report</button>'+(c.url?'<button type="button" id="datasetFeedbackOpen">Open publisher page</button>':'')+(c.email?'<button type="button" id="datasetFeedbackMail" class="primary">Open email draft</button>':'')+'</footer>'+
    '<p class="dataset-feedback-privacy">Nothing is submitted to Belgium Data Desk. Opening an email draft uses your own mail app. Copy/open is the fallback when the publisher did not expose an email contact.</p></form>';
  const type=d.querySelector("#datasetFeedbackType"),details=d.querySelector("#datasetFeedbackDetails"),dist=d.querySelector("#datasetFeedbackDistribution"),diag=d.querySelector("#datasetFeedbackDiagnostics"),preview=d.querySelector("#datasetFeedbackPreview"),status=d.querySelector("#datasetFeedbackStatus");
  type.value=profile?.businessKey&&Number(profile.businessKey.duplicateRows||0)>0?"duplicates":profile?.fields?.some(f=>Number(f.missing||0)>0)?"missing":"other";
  const payload=()=>reportText({asset,publisherName,profile,issue:type.value,details:details.value,distribution:dist.value,includeDiagnostics:diag?diag.checked:false});
  const refresh=()=>{preview.textContent=payload()};[type,details,dist,diag].filter(Boolean).forEach(el=>el.addEventListener("input",refresh));refresh();
  d.querySelector("#datasetFeedbackCopy").onclick=async()=>{
    try{await navigator.clipboard.writeText(payload());status.textContent="Report copied."}
    catch{status.textContent="Clipboard blocked by the browser. Select the report preview and copy it manually."}
  };
  const open=d.querySelector("#datasetFeedbackOpen");if(open)open.onclick=()=>window.open(c.url,"_blank","noopener");
  const mail=d.querySelector("#datasetFeedbackMail");if(mail)mail.onclick=()=>{
    const subject="[Open data feedback] "+(asset?.title||asset?.datasetId||"dataset")+" — "+issueLabel(type.value);
    location.href="mailto:"+c.email+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(payload());
    status.textContent="Email draft opened in your mail app. Nothing was sent by Belgium Data Desk.";
  };
  d.showModal();
}

export { ISSUE_TYPES, profileLines, reportText, contactFor };
