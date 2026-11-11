// Offline tests for contact_publisher (contact.mjs) and the confirmed report queue (feedback.mjs): drafts, limits, confirmation,
// digest, unsubscribe and the MCP wiring. The Durable Object's SQL runs on node:sqlite.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { contactPublisher, draftMessage, languageFor, mailtoLink } from "../contact.mjs";
import { FeedbackDesk, FeedbackStore, LIMITS, digestText, feedbackConfig, handleFeedbackHttp, reportDataIssue, runDigest, sha256 } from "../feedback.mjs";
import { toolsFor } from "../mcp-server.mjs";

const g={id:"national:d04b",title:"Data Zonne-Energie EPB-aangiftes",publisher:"Flemish Energy and Climate Agency",geography:"Flanders",
  contact:{email:"opendata.veka@vlaanderen.be",url:null},landing_page:"https://open-data.energiesparen.be/x.html",files:[{format:"CSV",url:"https://open-data.energiesparen.be/x.csv"}],web_url:"https://data.vecture.be/?dataset=national%3Ad04b"};

// ---------- contact_publisher ----------
assert.equal(languageFor(g),"nl");assert.equal(languageFor({geography:"Wallonia"}),"fr");assert.equal(languageFor({publisher:"Statbel"}),"en");
const c=contactPublisher(g,{issue:"stale",details:"De bijwerkingsdatum zegt 2019.",evidence:["preview_dataset: TIMESTAMP_EXTRACT tot 2026-11-01"]},"https://data.vecture.be");
assert.equal(c.sent,false);assert.equal(c.channel,"email");assert.equal(c.contact.email,"opendata.veka@vlaanderen.be");
assert.equal(c.draft.language,"nl");assert.match(c.draft.body,/^Beste,/);assert.match(c.draft.body,/Catalogus-id: national:d04b/);assert.match(c.draft.body,/- preview_dataset: TIMESTAMP_EXTRACT/);
assert.ok(c.mailto.startsWith("mailto:opendata.veka@vlaanderen.be?subject="));assert.match(c.check_first,/preview_dataset/);
assert.equal(contactPublisher(g,{issue:"stale",language:"fr"}).draft.language,"fr");
// no declared address: no mailto, no guessed address, the web contact instead
const noMail=contactPublisher({...g,contact:{email:"not an address",url:"https://example.be/contact"}},{issue:"question"});
assert.equal(noMail.channel,"web");assert.equal(noMail.mailto,undefined);assert.equal(noMail.contact.email,null);assert.match(noMail.how_to_send,/example\.be\/contact/);
assert.match(contactPublisher(g,{issue:"spam"}).error,/issue must be one of/);
// a long body still gives a link mail clients accept; the draft keeps the full text
const long=mailtoLink("a@b.be","s","x".repeat(5000));assert.ok(long.href.length<=1900&&long.shortened);
// newlines in the title cannot inject header-like lines into the subject
assert.ok(!/\n/.test(draftMessage({...g,title:"A\nBcc: x@y.z"},{issue:"question"}).subject));

// ---------- the store ----------
let clock=Date.parse("2026-11-16T07:00:00Z");
const db=new DatabaseSync(":memory:");
const exec=(q,...b)=>{const st=db.prepare(q);return /^\s*(SELECT|WITH)/i.test(q)?st.all(...b):(st.run(...b),[])};
const store=new FeedbackStore(exec,()=>clock);
const rep=(n,o={})=>({id:"r"+n,dataset_id:"national:d04b",title:g.title,publisher:g.publisher,contact_email:"opendata.veka@vlaanderen.be",issue:"stale",details:"The update date says 2019, data is from 2026.",
  evidence:[],lang:"nl",reporter_hash:"h1",reporter_email:"citizen@example.be",share_email:false,token_hash:"t"+n,...o});
assert.ok(store.submit(rep(1)).ok);
assert.match(store.submit(rep(2)).error,/already have a report/,"one pending report per reporter, dataset and issue");
assert.ok(store.submit(rep(3,{issue:"units"})).ok);assert.ok(store.submit(rep(4,{issue:"access"})).ok);
assert.match(store.submit(rep(5,{issue:"values"})).error,/limit reached/,"3 a day per reporter");
assert.ok(store.confirm("t1").ok);assert.match(store.confirm("t1").error,/already used/);
assert.ok(store.cancel("t3").ok);
// another person reports the same issue: merged in the digest
assert.equal(store.submit(rep(6,{reporter_hash:"h2",reporter_email:"other@example.be",share_email:true})).similar_reports,1);store.confirm("t6");
// pending reports expire after 48 h
clock+=49*3600e3;assert.match(store.confirm("t4").error,/expired/);store.cleanup();
assert.equal(exec("SELECT COUNT(*) n FROM reports WHERE id='r4'")[0].n,0,"an unconfirmed report is deleted");
const due=store.due();assert.equal(due.length,1);assert.equal(due[0].reports.length,2);
const dg=digestText(due[0].reports,"https://data.vecture.be/feedback/unsubscribe?e=x&s=y","https://data.vecture.be");
assert.match(dg.subject,/2 melding/);assert.match(dg.text,/\(2 meldingen\)/,"merged by dataset and issue");
assert.match(dg.text,/Antwoorden aan: other@example\.be/);assert.ok(!dg.text.includes("citizen@example.be"),"an address is shared only when its owner chose to");
store.markSent("opendata.veka@vlaanderen.be",due[0].reports.map(r=>r.id));
assert.equal(exec("SELECT COUNT(*) n FROM reports WHERE reporter_email IS NOT NULL AND status='sent'")[0].n,0,"reporter addresses are deleted once sent");
assert.deepEqual(store.due(),[],"nothing new");
// at most one digest a week per publisher
store.submit(rep(7,{reporter_hash:"h3",issue:"units"}));store.confirm("t7");assert.deepEqual(store.due(),[]);
clock+=7*24*3600e3;assert.equal(store.due().length,1);
// the public list has no personal data
const open=store.openList();assert.ok(open.length>=1);assert.ok(!JSON.stringify(open).includes("@"));
// an unsubscribed publisher gets nothing and new reports are refused
store.unsubscribe("opendata.veka@vlaanderen.be");assert.deepEqual(store.due(),[]);assert.match(store.submit(rep(8,{reporter_hash:"h9"})).error,/asked not to receive/);
assert.match(store.openList().find(x=>x.issue==="units").status,/opted out/);

// ---------- MCP flow with a fake Durable Object and mail service ----------
const deskDb=new DatabaseSync(":memory:");
const desk=new FeedbackDesk({storage:{sql:{exec:(q,...b)=>{const st=deskDb.prepare(q);return{toArray:()=>/^\s*(SELECT|WITH)/i.test(q)?st.all(...b):(st.run(...b),[])}}}}});
const env={FEEDBACK:{idFromName:()=>"desk",get:()=>({fetch:(u,init)=>desk.fetch(new Request(u,init))})},MAIL_API_KEY:"k",FEEDBACK_MAIL_FROM:"Belgium Data Desk <feedback@vecture.be>",FEEDBACK_SECRET:"s".repeat(40)};
const mails=[];const mailFetch=async(url,init)=>{mails.push(JSON.parse(init.body));return new Response("{}",{status:200})};
assert.equal(feedbackConfig({}).on,false);assert.equal(feedbackConfig(env).on,true);assert.equal(feedbackConfig(env).digest,"hold");
assert.ok(!toolsFor({}).some(t=>t.name==="report_data_issue"),"not offered unless sending is configured");
const offered=toolsFor(env).find(t=>t.name==="report_data_issue");assert.equal(offered.annotations.readOnlyHint,false);
assert.ok(toolsFor({}).find(t=>t.name==="contact_publisher").annotations.readOnlyHint);
const origin="https://data.vecture.be";
assert.match((await reportDataIssue(env,g,{issue:"stale",details:"too short",reporter_email:"me@example.be"},{fetchImpl:mailFetch,origin})).error,/at least 20/);
assert.match((await reportDataIssue(env,g,{issue:"stale",details:"The update date says 2019, data is 2026.",reporter_email:"nope"},{fetchImpl:mailFetch,origin})).error,/own email/);
const ok=await reportDataIssue(env,g,{issue:"stale",details:"The update date says 2019, data is 2026.",reporter_email:"Me@Example.be"},{fetchImpl:mailFetch,origin});
assert.equal(ok.filed,"pending_confirmation");assert.equal(mails.length,1);assert.deepEqual(mails[0].to,["me@example.be"],"the confirmation goes to the reporter, not the publisher");
const token=/confirm\?t=([A-Za-z0-9_-]+)/.exec(mails[0].text)[1];
// the link page does not confirm on GET (mail scanners open links); the POST does
const get=await handleFeedbackHttp(new Request(origin+"/feedback/confirm?t="+token),env);assert.equal(get.status,200);assert.match(await get.text(),/Confirm and send/);
assert.equal(deskDb.prepare("SELECT status FROM reports").get().status,"pending");
const fd=new FormData();fd.set("action","confirm");
assert.match(await (await handleFeedbackHttp(new Request(origin+"/feedback/confirm?t="+token,{method:"POST",body:fd}),env)).text(),/Report confirmed/);
assert.equal(deskDb.prepare("SELECT status FROM reports").get().status,"confirmed");
// a failed confirmation email leaves nothing behind
const before=deskDb.prepare("SELECT COUNT(*) n FROM reports").get().n;
assert.match((await reportDataIssue(env,g,{issue:"units",details:"No unit for OPGEWEKTE_STROOM_PV_PANELEN.",reporter_email:"me@example.be"},{fetchImpl:async()=>new Response("",{status:500}),origin})).error,/nothing was filed/);
assert.equal(deskDb.prepare("SELECT COUNT(*) n FROM reports").get().n,before);
// digests are held by default; with FEEDBACK_DIGEST=send one goes to the declared address with an unsubscribe link
mails.length=0;assert.equal((await runDigest(env,{fetchImpl:mailFetch,origin})).skipped,"digest held");assert.equal(mails.length,0);
const sent=await runDigest({...env,FEEDBACK_DIGEST:"send"},{fetchImpl:mailFetch,origin});
assert.deepEqual(sent.sent,[{to:"opendata.veka@vlaanderen.be",reports:1}]);assert.match(mails[0].headers["List-Unsubscribe"],/feedback\/unsubscribe/);
const unsub=/<(.+)>/.exec(mails[0].headers["List-Unsubscribe"])[1];
assert.match(await (await handleFeedbackHttp(new Request(unsub.replace(/s=[^&]+$/,"s=forged")),env)).text(),/not valid/);
assert.match(await (await handleFeedbackHttp(new Request(unsub,{method:"POST"}),env)).text(),/no more digests/);
const pub=await (await handleFeedbackHttp(new Request(origin+"/feedback/open.json"),env)).json();assert.equal(pub.reports[0].reports,1);assert.ok(!JSON.stringify(pub).includes("example.be"));
assert.equal((await sha256("x")).length,43);assert.ok(LIMITS.pendingHours===48);

console.log(JSON.stringify({ok:true,contact:"draft/mailto/web-fallback",feedback:"limits/confirm/expiry/digest/unsubscribe/mcp"}));
