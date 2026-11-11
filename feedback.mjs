// report_data_issue: citizens' reports to data publishers, without letting the connector become a spam relay.
//
//   1. An assistant files a report for the user (dataset id, issue, details, the user's own email). Nothing goes to the publisher.
//   2. We email the user a confirmation link. Only a person who opens it and presses the button queues the report; an unconfirmed
//      report is deleted after 48 hours. Link scanners that open links do not confirm: confirming takes a POST from that page.
//   3. Once a week each publisher gets at most one digest at the address it declared in its own catalogue record, with reports on the
//      same dataset and issue merged ("3 people reported this"). Reporters' addresses are included only if they chose to share them.
//      Every digest has a one-click unsubscribe; an unsubscribed publisher gets nothing more. FEEDBACK_DIGEST=hold (the default) keeps
//      digests unsent while queued reports still show on the public list.
//   4. Limits: 3 reports per reporter per day and 10 per 30 days, one pending report per reporter, dataset and issue, and at most
//      100 confirmation emails a day in total.
//
// State lives in one SQLite-backed Durable Object (FeedbackDesk). Reporter emails are deleted when the digest is sent, or with the
// unconfirmed report; reporters are otherwise known only by a keyed hash, kept 31 days for the limits.
import { ISSUES, ISSUE_IDS, LANGS, languageFor } from "./contact.mjs";

export const LIMITS={perReporterDay:3,perReporterMonth:10,confirmationsPerDay:100,pendingHours:48,digestEveryDays:7,maxReportsPerDigest:30,minDetails:20};
const HOUR=3600e3,DAY=24*HOUR;

export function feedbackConfig(env){
  const on=!!(env?.FEEDBACK&&env?.MAIL_API_KEY&&env?.FEEDBACK_MAIL_FROM&&env?.FEEDBACK_SECRET&&String(env.FEEDBACK_SECRET).length>=32);
  return{on,digest:env?.FEEDBACK_DIGEST==="send"?"send":"hold"};
}

// ---------- the store (synchronous SQL, as in a Durable Object; tests run it on node:sqlite) ----------
export class FeedbackStore{
  constructor(exec,now=()=>Date.now()){this.q=exec;this.now=now;this.init()}
  init(){
    this.q(`CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,dataset_id TEXT,title TEXT,publisher TEXT,contact_email TEXT,issue TEXT,details TEXT,evidence TEXT,lang TEXT,
      reporter_hash TEXT,reporter_email TEXT,share_email INTEGER,status TEXT,token_hash TEXT,created INTEGER,confirmed INTEGER,sent INTEGER)`);
    this.q("CREATE INDEX IF NOT EXISTS reports_status ON reports(status,contact_email)");
    this.q("CREATE INDEX IF NOT EXISTS reports_token ON reports(token_hash)");
    this.q("CREATE TABLE IF NOT EXISTS publishers(contact_email TEXT PRIMARY KEY,last_sent INTEGER,suppressed INTEGER DEFAULT 0)");
  }
  one(sql,...b){return this.q(sql,...b)[0]}
  submit(r){
    const now=this.now();
    if(this.one("SELECT suppressed FROM publishers WHERE contact_email=?",r.contact_email)?.suppressed)return{error:"This publisher has asked not to receive reports through Belgium Data Desk. Use contact_publisher to write to them yourself."};
    const day=this.one("SELECT COUNT(*) n FROM reports WHERE reporter_hash=? AND created>?",r.reporter_hash,now-DAY).n;
    const month=this.one("SELECT COUNT(*) n FROM reports WHERE reporter_hash=? AND created>?",r.reporter_hash,now-30*DAY).n;
    if(day>=LIMITS.perReporterDay||month>=LIMITS.perReporterMonth)return{error:"Report limit reached for this email address ("+LIMITS.perReporterDay+" a day, "+LIMITS.perReporterMonth+" in 30 days). Try again later or write to the publisher yourself with contact_publisher.",limited:true};
    if(this.one("SELECT id FROM reports WHERE reporter_hash=? AND dataset_id=? AND issue=? AND status IN ('pending','confirmed')",r.reporter_hash,r.dataset_id,r.issue))
      return{error:"You already have a report on this dataset and issue waiting (check your mailbox for the confirmation link).",duplicate:true};
    if(this.one("SELECT COUNT(*) n FROM reports WHERE created>?",now-DAY).n>=LIMITS.confirmationsPerDay)return{error:"The reporting service has reached its daily limit; try again tomorrow.",limited:true};
    this.q(`INSERT INTO reports(id,dataset_id,title,publisher,contact_email,issue,details,evidence,lang,reporter_hash,reporter_email,share_email,status,token_hash,created)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,r.id,r.dataset_id,r.title,r.publisher,r.contact_email,r.issue,r.details,JSON.stringify(r.evidence||[]),r.lang,
      r.reporter_hash,r.reporter_email,r.share_email?1:0,r.token_hash,now);
    const similar=this.one("SELECT COUNT(*) n FROM reports WHERE dataset_id=? AND issue=? AND status IN ('confirmed','sent') AND id<>?",r.dataset_id,r.issue,r.id).n;
    return{ok:true,id:r.id,similar_reports:similar};
  }
  pendingByToken(token_hash){
    const r=this.one("SELECT * FROM reports WHERE token_hash=? AND status='pending'",token_hash);
    return r&&r.created>this.now()-LIMITS.pendingHours*HOUR?r:null;
  }
  view(token_hash){const r=this.pendingByToken(token_hash);return r?{report:publicView(r),pending:true}:{error:"This link has expired or was already used."}}
  confirm(token_hash){
    const r=this.pendingByToken(token_hash);if(!r)return{error:"This link has expired or was already used."};
    this.q("UPDATE reports SET status='confirmed',confirmed=?,token_hash=NULL WHERE id=?",this.now(),r.id);
    const held=this.one("SELECT suppressed FROM publishers WHERE contact_email=?",r.contact_email)?.suppressed;
    return{ok:true,report:publicView(r),...(held?{held:true}:{})};
  }
  cancel(token_hash){
    const r=this.one("SELECT id FROM reports WHERE token_hash=? AND status='pending'",token_hash);if(!r)return{error:"This link has expired or was already used."};
    this.q("DELETE FROM reports WHERE id=?",r.id);return{ok:true};
  }
  /** Publishers due a digest: confirmed reports waiting, not unsubscribed, nothing sent to them in the last week. */
  due(){
    const now=this.now(),out=[];
    for(const {contact_email} of this.q("SELECT DISTINCT contact_email FROM reports WHERE status='confirmed'")){
      const p=this.one("SELECT * FROM publishers WHERE contact_email=?",contact_email);
      if(p?.suppressed||(p?.last_sent&&p.last_sent>now-LIMITS.digestEveryDays*DAY+HOUR))continue;
      out.push({contact_email,reports:this.q("SELECT * FROM reports WHERE status='confirmed' AND contact_email=? ORDER BY confirmed LIMIT ?",contact_email,LIMITS.maxReportsPerDigest)});
    }
    return out;
  }
  markSent(contact_email,ids){
    const now=this.now();
    for(const id of ids)this.q("UPDATE reports SET status='sent',sent=?,reporter_email=NULL WHERE id=? AND status='confirmed'",now,id);
    this.q("INSERT INTO publishers(contact_email,last_sent) VALUES(?,?) ON CONFLICT(contact_email) DO UPDATE SET last_sent=excluded.last_sent",contact_email,now);
    return{ok:true};
  }
  unsubscribe(contact_email){
    this.q("INSERT INTO publishers(contact_email,suppressed) VALUES(?,1) ON CONFLICT(contact_email) DO UPDATE SET suppressed=1",contact_email);
    this.q("UPDATE reports SET status='held',reporter_email=NULL WHERE contact_email=? AND status IN ('pending','confirmed')",contact_email);
    return{ok:true};
  }
  /** Retention: unconfirmed reports go after 48 h; reporter hashes after 31 days; reports after a year. */
  cleanup(){
    const now=this.now();
    this.q("DELETE FROM reports WHERE status='pending' AND created<?",now-LIMITS.pendingHours*HOUR);
    this.q("UPDATE reports SET reporter_hash=NULL WHERE created<?",now-31*DAY);
    this.q("DELETE FROM reports WHERE created<?",now-365*DAY);
    return{ok:true};
  }
  /** Public list: no personal data, merged by dataset and issue. */
  openList(){
    return this.q(`SELECT dataset_id,title,publisher,issue,COUNT(*) reports,MIN(confirmed) first_reported,MAX(sent) last_sent_to_publisher,
      SUM(status='confirmed') waiting,SUM(status='held') held FROM reports WHERE status IN ('confirmed','sent','held') GROUP BY dataset_id,issue ORDER BY first_reported DESC LIMIT 500`)
      .map(x=>({dataset_id:x.dataset_id,title:x.title,publisher:x.publisher,issue:x.issue,issue_label:ISSUES[x.issue]?.en||x.issue,reports:x.reports,
        first_reported:new Date(x.first_reported).toISOString().slice(0,10),status:x.waiting?"queued for the publisher's weekly digest":x.last_sent_to_publisher?"sent to the publisher":x.held?"not forwarded: the publisher opted out":"sent to the publisher",
        ...(x.last_sent_to_publisher?{last_sent_to_publisher:new Date(x.last_sent_to_publisher).toISOString().slice(0,10)}:{})}));
  }
}
const publicView=r=>({dataset_id:r.dataset_id,title:r.title,publisher:r.publisher,issue:r.issue,issue_label:ISSUES[r.issue]?.en||r.issue,details:r.details,
  evidence:JSON.parse(r.evidence||"[]"),share_email:!!r.share_email,to:r.contact_email});

/** The Durable Object: one instance ("desk") holds the queue. The Worker calls it with {op,args}. */
export class FeedbackDesk{
  constructor(ctx){const sql=ctx.storage.sql;this.store=new FeedbackStore((q,...b)=>sql.exec(q,...b).toArray())}
  async fetch(request){
    const {op,args=[]}=await request.json();
    if(!["submit","view","confirm","cancel","due","markSent","unsubscribe","cleanup","openList"].includes(op))return Response.json({error:"bad op"},{status:400});
    return Response.json(this.store[op](...args));
  }
}
const desk=env=>{const ns=env.FEEDBACK;const stub=ns.get(ns.idFromName("desk"));
  return async(op,...args)=>{const r=await stub.fetch("https://feedback.internal/",{method:"POST",body:JSON.stringify({op,args})});return r.json()}};

// ---------- crypto helpers ----------
const enc=new TextEncoder();
const b64u=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
export async function sha256(s){return b64u(await crypto.subtle.digest("SHA-256",enc.encode(s)))}
export async function hmac(secret,s){const k=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64u(await crypto.subtle.sign("HMAC",k,enc.encode(s)))}
const randomToken=()=>b64u(crypto.getRandomValues(new Uint8Array(32)));
const validEmail=s=>typeof s==="string"&&s.length<=254&&/^[^\s@<>()",;:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s);
const oneLine=(s,max)=>String(s??"").replace(/[\r\n\t]+/g," ").replace(/\s{2,}/g," ").trim().slice(0,max);
const block=(s,max)=>String(s??"").replace(/\r\n?/g,"\n").replace(/\n{3,}/g,"\n\n").trim().slice(0,max);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

// ---------- mail (Resend's HTTP API; the key is the MAIL_API_KEY secret) ----------
export async function sendMail(env,{to,subject,text,replyTo,headers={}},fetchImpl=fetch){
  try{
    const r=await fetchImpl("https://api.resend.com/emails",{method:"POST",headers:{authorization:"Bearer "+env.MAIL_API_KEY,"content-type":"application/json"},
      body:JSON.stringify({from:env.FEEDBACK_MAIL_FROM,to:[to],subject,text,...(replyTo?{reply_to:replyTo}:{}),headers})});
    if(!r.ok)return{error:"mail service answered HTTP "+r.status};
    return{ok:true};
  }catch{return{error:"mail service could not be reached"}}
}

// ---------- the MCP tool ----------
/** report_data_issue for a get_dataset record. */
export async function reportDataIssue(env,g,args={},{fetchImpl=fetch,origin=""}={}){
  const cfg=feedbackConfig(env);if(!cfg.on)return{error:"Sending reports is not switched on for this server. Use contact_publisher to write to the publisher yourself."};
  if(!ISSUE_IDS.includes(args.issue))return{error:"issue must be one of: "+ISSUE_IDS.join(", ")+"."};
  const details=block(args.details,1500);
  if(details.length<LIMITS.minDetails)return{error:"details must say what is wrong in at least "+LIMITS.minDetails+" characters (which file, column, rows or dates)."};
  const reporter=String(args.reporter_email||"").trim().toLowerCase();
  if(!validEmail(reporter))return{error:"reporter_email must be the user's own email address: the confirmation link goes there."};
  const contact=g.contact?.email;
  if(!validEmail(contact))return{error:"This publisher declares no contact email in its catalogue record, so reports cannot be forwarded. Use contact_publisher for its web contact."};
  if(reporter===contact.toLowerCase())return{error:"reporter_email is the publisher's own address."};
  const lang=LANGS.includes(args.language)?args.language:languageFor(g);
  const token=randomToken(),id=crypto.randomUUID();
  const d=desk(env);
  const res=await d("submit",{id,dataset_id:g.id,title:oneLine(g.title,200),publisher:oneLine(g.publisher,120),contact_email:contact.toLowerCase(),issue:args.issue,details,
    evidence:(Array.isArray(args.evidence)?args.evidence:[]).map(e=>oneLine(e,300)).filter(Boolean).slice(0,5),lang,
    reporter_hash:await hmac(env.FEEDBACK_SECRET,"reporter:"+reporter),reporter_email:reporter,share_email:args.share_email_with_publisher===true,token_hash:await sha256(token)});
  if(res.error)return{error:res.error};
  const link=origin+"/feedback/confirm?t="+token;
  const mail=await sendMail(env,{to:reporter,subject:"Confirm your report on “"+oneLine(g.title,80)+"”",text:confirmationText(g,args.issue,details,link,args.share_email_with_publisher===true),
    headers:{"Auto-Submitted":"auto-generated"}},fetchImpl);
  if(mail.error){await d("cancel",await sha256(token));return{error:"The confirmation email could not be sent ("+mail.error+"); nothing was filed. Try again later or use contact_publisher."}}
  return{filed:"pending_confirmation",dataset:{id:g.id,title:g.title,publisher:g.publisher},issue:args.issue,
    ...(res.similar_reports?{similar_reports:res.similar_reports}:{}),
    key_facts:["A confirmation email was sent to "+reporter+". Nothing goes to "+g.publisher+" until the user opens that email and presses Confirm, within "+LIMITS.pendingHours+" hours.",
      "Confirmed reports reach the publisher in one weekly digest at the address it declared in its catalogue record"+(res.similar_reports?", together with "+res.similar_reports+" earlier report(s) of the same issue":"")+"."+
      (cfg.digest==="hold"?" Digests are currently held for review before the first ones go out; the report appears on the public list once confirmed.":""),
      args.share_email_with_publisher===true?"The user's email address will be included so the publisher can reply.":"The user's email address is not passed to the publisher."],
    public_list:origin+"/feedback/open.json",privacy:origin+"/privacy.html#reports"};
}

function confirmationText(g,issue,details,link,share){
  return["Someone (we hope you) asked an AI assistant to report a problem with an open dataset through Belgium Data Desk, giving this email address.","",
    "Dataset: "+oneLine(g.title,200),"Publisher: "+oneLine(g.publisher,120),"Issue: "+ISSUES[issue].en,"",details,"",
    "To send it, open this link within "+LIMITS.pendingHours+" hours and press Confirm:",link,"",
    "Confirmed reports go to the publisher in a weekly digest, merged with others about the same issue. "+(share?"Your email address will be included so they can reply to you.":"Your email address will not be shared with the publisher."),
    "If you did not ask for this, ignore this email: the report is deleted after "+LIMITS.pendingHours+" hours and nothing is sent.","",
    "Nederlands: open de link hierboven om je melding te bevestigen; zonder bevestiging wordt niets verstuurd.",
    "Français : ouvrez le lien ci-dessus pour confirmer votre signalement ; sans confirmation, rien n'est envoyé.","",
    "Belgium Data Desk · data.vecture.be"].join("\n");
}

// ---------- the weekly digest ----------
const D={
  en:{subject:n=>"Open data feedback from users: "+n+" report(s)",hello:"Hello,",intro:"Users of your open data asked us to pass on the following reports. Each was confirmed by its author by email. Reports about the same dataset and issue are merged.",
    people:n=>n===1?"1 report":n+" reports",reply:"Reply to",noReply:"The authors did not share their address; reply by updating the dataset or its record.",why:"You receive this because this address is the contact declared in the catalogue record of these datasets.",
    unsub:"To receive no more digests from Belgium Data Desk:",sign:"Belgium Data Desk (data.vecture.be), a free index of Belgian open data. Questions: info@vecture.be"},
  nl:{subject:n=>"Feedback van gebruikers over jullie open data: "+n+" melding(en)",hello:"Beste,",intro:"Gebruikers van jullie open data vroegen ons de volgende meldingen door te geven. Elke melding werd door de auteur per e-mail bevestigd. Meldingen over dezelfde dataset en hetzelfde probleem zijn samengevoegd.",
    people:n=>n===1?"1 melding":n+" meldingen",reply:"Antwoorden aan",noReply:"De auteurs deelden hun adres niet; jullie kunnen reageren door de dataset of de beschrijving bij te werken.",why:"Jullie ontvangen dit omdat dit adres als contact vermeld staat in de catalogusbeschrijving van deze datasets.",
    unsub:"Geen overzichten meer ontvangen van Belgium Data Desk:",sign:"Belgium Data Desk (data.vecture.be), een gratis index van Belgische open data. Vragen: info@vecture.be"},
  fr:{subject:n=>"Retours d'utilisateurs sur vos données ouvertes : "+n+" signalement(s)",hello:"Bonjour,",intro:"Des utilisateurs de vos données ouvertes nous ont demandé de vous transmettre les signalements suivants. Chacun a été confirmé par son auteur par e-mail. Les signalements sur le même jeu de données et le même problème sont regroupés.",
    people:n=>n===1?"1 signalement":n+" signalements",reply:"Répondre à",noReply:"Les auteurs n'ont pas partagé leur adresse ; vous pouvez répondre en mettant à jour le jeu de données ou sa fiche.",why:"Vous recevez ce message car cette adresse est le contact indiqué dans la fiche catalogue de ces jeux de données.",
    unsub:"Pour ne plus recevoir de résumés de Belgium Data Desk :",sign:"Belgium Data Desk (data.vecture.be), un index gratuit des données ouvertes belges. Questions : info@vecture.be"},
  de:{subject:n=>"Rückmeldungen von Nutzern zu Ihren offenen Daten: "+n+" Meldung(en)",hello:"Guten Tag,",intro:"Nutzer Ihrer offenen Daten haben uns gebeten, folgende Meldungen weiterzugeben. Jede wurde von ihrem Verfasser per E-Mail bestätigt. Meldungen zum selben Datensatz und Problem sind zusammengefasst.",
    people:n=>n===1?"1 Meldung":n+" Meldungen",reply:"Antwort an",noReply:"Die Verfasser haben ihre Adresse nicht geteilt.",why:"Sie erhalten dies, weil diese Adresse als Kontakt im Katalogeintrag dieser Datensätze angegeben ist.",
    unsub:"Keine weiteren Zusammenfassungen von Belgium Data Desk erhalten:",sign:"Belgium Data Desk (data.vecture.be). Fragen: info@vecture.be"}
};
export function digestText(reports,unsubLink,origin){
  const lang=reports[0]?.lang&&D[reports[0].lang]?reports[0].lang:"en",t=D[lang];
  const groups=new Map();for(const r of reports){const k=r.dataset_id+"|"+r.issue;(groups.get(k)||groups.set(k,[]).get(k)).push(r)}
  const parts=[t.hello,"",t.intro,""];
  for(const rs of groups.values()){
    const r=rs[0],shared=[...new Set(rs.filter(x=>x.share_email&&x.reporter_email).map(x=>x.reporter_email))];
    parts.push("■ "+r.title+" ("+t.people(rs.length)+")",ISSUES[r.issue]?.[lang]||r.issue,origin+"/?dataset="+encodeURIComponent(r.dataset_id));
    for(const x of rs.slice(0,3)){parts.push("","“"+block(x.details,800)+"”");for(const e of JSON.parse(x.evidence||"[]"))parts.push("  - "+e)}
    if(rs.length>3)parts.push("","(+"+(rs.length-3)+")");
    parts.push("",shared.length?t.reply+": "+shared.join(", "):t.noReply,"","");
  }
  parts.push(t.why,t.unsub+" "+unsubLink,"",t.sign);
  return{subject:t.subject(reports.length),text:parts.join("\n")};
}
export async function runDigest(env,{fetchImpl=fetch,origin=""}={}){
  const cfg=feedbackConfig(env);if(!env?.FEEDBACK)return{skipped:"no queue"};
  const d=desk(env);await d("cleanup");
  if(!cfg.on||cfg.digest!=="send")return{skipped:"digest held"};
  const sent=[];
  for(const {contact_email,reports} of await d("due")){
    const e=b64u(enc.encode(contact_email)),unsub=origin+"/feedback/unsubscribe?e="+e+"&s="+await hmac(env.FEEDBACK_SECRET,"unsub:"+contact_email);
    const {subject,text}=digestText(reports,unsub,origin);
    const r=await sendMail(env,{to:contact_email,subject,text,headers:{"List-Unsubscribe":"<"+unsub+">","Auto-Submitted":"auto-generated"}},fetchImpl);
    if(r.ok){await d("markSent",contact_email,reports.map(x=>x.id));sent.push({to:contact_email,reports:reports.length})}
  }
  return{sent};
}

// ---------- the web pages behind the links ----------
const page=(title,body,status=200)=>new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} — Belgium Data Desk</title>
<style>:root{--bg:#fbfaf6;--fg:#15171a;--mut:#5c6370;--acc:#245eea}@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#ecebe6;--mut:#a0a6b2;--acc:#8fb0ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif}main{max-width:640px;margin:0 auto;padding:32px 16px 64px}a{color:var(--acc)}.mut{color:var(--mut)}
blockquote{margin:12px 0;padding:8px 14px;border-left:3px solid var(--acc);white-space:pre-wrap}button{font:inherit;padding:10px 18px;margin:6px 8px 0 0;border-radius:8px;border:1px solid var(--mut);background:transparent;color:var(--fg);cursor:pointer}button.go{background:var(--acc);border-color:var(--acc);color:#fff}</style>
<main><p><a href="/">← Belgium Data Desk</a></p><h1>${esc(title)}</h1>${body}</main></html>`,{status,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer","x-robots-tag":"noindex"}});

export async function handleFeedbackHttp(request,env){
  const url=new URL(request.url),cfg=feedbackConfig(env);
  if(url.pathname==="/feedback/open.json"){
    const list=env?.FEEDBACK?await desk(env)("openList"):[];
    return new Response(JSON.stringify({about:"Reports from data users, confirmed by their authors by email and passed to publishers in a weekly digest. No personal data.",reports:list}),{headers:{"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*","cache-control":"public, max-age=300"}});
  }
  if(!cfg.on)return page("Reporting is not switched on","<p>This server does not forward reports.</p>",404);
  const d=desk(env);
  if(url.pathname==="/feedback/confirm"){
    const t=url.searchParams.get("t")||"";if(!/^[A-Za-z0-9_-]{40,60}$/.test(t))return page("Link not valid","<p>This link is incomplete. Open it again from the email.</p>",400);
    const th=await sha256(t);
    if(request.method==="POST"){
      const form=await request.formData().catch(()=>null),action=form?.get("action");
      if(action==="cancel"){const r=await d("cancel",th);return page(r.ok?"Report deleted":"Link expired",r.ok?"<p>The report was deleted. Nothing was sent.</p>":"<p>This link has expired or was already used.</p>")}
      const r=await d("confirm",th);
      if(!r.ok)return page("Link expired","<p>This link has expired or was already used. Unconfirmed reports are deleted after "+LIMITS.pendingHours+" hours.</p>",410);
      return page("Report confirmed",r.held?"<p>Thank you. This publisher has asked not to receive reports through us, so it will not be forwarded; you can write to them yourself.</p>":
        `<p>Thank you. Your report on <b>${esc(r.report.title)}</b> is queued for ${esc(r.report.publisher)}'s next weekly digest${cfg.digest==="hold"?" (digests are currently reviewed before sending)":""}.</p><p class="mut">It is listed without personal data at <a href="/feedback/open.json">/feedback/open.json</a>.</p>`);
    }
    const v=await d("view",th);
    if(v.error)return page("Link expired","<p>This link has expired or was already used. Unconfirmed reports are deleted after "+LIMITS.pendingHours+" hours.</p>",410);
    const r=v.report;
    return page("Confirm your report",`<p>Dataset: <b>${esc(r.title)}</b><br>Publisher: ${esc(r.publisher)}<br>Issue: ${esc(r.issue_label)}</p><blockquote>${esc(r.details)}</blockquote>
${r.evidence.length?"<ul>"+r.evidence.map(e=>"<li>"+esc(e)+"</li>").join("")+"</ul>":""}
<p class="mut">It goes to the publisher's declared contact (${esc(r.to)}) in a weekly digest. ${r.share_email?"Your email address is included so they can reply.":"Your email address is not shared."} See <a href="/privacy.html#reports">privacy</a>.</p>
<form method="post"><button class="go" name="action" value="confirm">Confirm and send</button><button name="action" value="cancel">Delete it</button></form>`);
  }
  if(url.pathname==="/feedback/unsubscribe"){
    let email="";try{email=new TextDecoder().decode(Uint8Array.from(atob((url.searchParams.get("e")||"").replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0)))}catch{}
    const ok=validEmail(email)&&(url.searchParams.get("s")||"")===await hmac(env.FEEDBACK_SECRET,"unsub:"+email);
    if(!ok)return page("Link not valid","<p>This unsubscribe link is not valid. Write to info@vecture.be and we will stop the digests.</p>",400);
    if(request.method==="POST"){await d("unsubscribe",email);return page("Unsubscribed","<p>"+esc(email)+" will receive no more digests from Belgium Data Desk. Reports waiting for this address were withdrawn.</p>")}
    return page("Stop the digests",`<p>Stop sending user reports to <b>${esc(email)}</b>?</p><form method="post"><button class="go">Unsubscribe</button></form>`);
  }
  return page("Not found","<p>Unknown page.</p>",404);
}
