// Generate crawlable static pages for search engines: multilingual landing, topic and publisher pages, one page per well-evidenced
// dataset (schema.org Dataset JSON-LD), sitemaps with hreflang alternates, robots.txt and llms.txt.
//   node scripts/build-seo-pages.mjs [--origin https://example.org]     (run after the catalogue + MCP index are built)
// buildSeoSite() is pure (returns a Map of relative file path -> content) so it can be tested on fixtures.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { LANGS, LOCALE, PATHS, SITE, T, TOPIC_I18N } from "./seo-i18n.mjs";
import { scopeOf, TOPIC_LABELS, topicOf } from "../public/dataset-taxonomy-v1.mjs";
import { ldesCapability } from "../public/dataset-ldes-v1.mjs";
import { LICENSE_URLS, normalizeLicense } from "../public/dataset-licence-v1.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url)),pub=path.resolve(__dirname,"../public");
export const DEFAULT_ORIGIN="https://data.vecture.be";
export const MAX_TITLE=60,MAX_DATASET_TITLE=110,MAX_DESC=155;

const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const clean=s=>String(s??"").replace(/\s+/g," ").trim();
const stripHtml=s=>{let t=String(s??"");for(let i=0;i<2;i++)t=t.replace(/&nbsp;/g," ").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&").replace(/<[^>]*>/g," ");return clean(t);};
const sentenceCase=s=>s?s.charAt(0).toUpperCase()+s.slice(1):s;
const hash6=s=>createHash("sha1").update(String(s)).digest("hex").slice(0,6);
export const slugify=s=>String(s??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
function cut(s,max){
  s=clean(s);if(s.length<=max)return s;
  const t=s.slice(0,max-1),i=t.lastIndexOf(" ");
  return(i>max*0.6?t.slice(0,i):t).replace(/[\s,;:–—-]+$/,"")+"…";
}
const fmt=(tpl,vars)=>tpl.replace(/\{(\w+)\}/g,(_,k)=>vars[k]??"");

/* ---------- language of a record's own text ---------- */
const STOP={
  nl:["de","het","een","van","voor","en","op","in","per","met","naar","bij","aan","gemeente","gemeenten","kaart","gegevens","aantal","jaar"],
  fr:["le","la","les","des","du","de","et","pour","par","sur","dans","un","une","aux","commune","communes","carte","données","nombre","année"],
  en:["the","of","and","for","by","in","to","with","from","per","data","number","map","statistics","by"]
};
export function detectLang(text){
  const words=String(text||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").split(/[^a-z]+/).filter(Boolean);
  const score={nl:0,fr:0,en:0};
  for(const w of words)for(const l of Object.keys(STOP))if(STOP[l].some(s=>s.normalize("NFKD").replace(/[\u0300-\u036f]/g,"")===w))score[l]++;
  const best=Object.entries(score).sort((a,b)=>b[1]-a[1]);
  return best[0][1]>0&&best[0][1]>best[1][1]?best[0][0]:"en";
}

/* ---------- page shell ---------- */
const CSS=":root{--bg:#fbfaf6;--fg:#15171a;--mut:#5c6370;--line:#d9d6cc;--acc:#1f4fd1;--card:#fff}@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#ecebe6;--mut:#a0a6b2;--line:#2c3038;--acc:#8fb0ff;--card:#1b1e24}}"+
"*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}a{color:var(--acc)}"+
"header,main,footer{max-width:900px;margin:0 auto;padding:0 16px}header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;padding-top:14px;padding-bottom:10px;border-bottom:1px solid var(--line)}"+
"header b a{color:inherit;text-decoration:none}nav{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:.92rem}nav a.cur{font-weight:700}.lang a{margin-left:8px;font-size:.85rem}"+
"main{padding-top:20px;padding-bottom:40px}h1{font-size:1.75rem;line-height:1.25;margin:.2em 0 .4em}h2{font-size:1.2rem;margin:1.6em 0 .5em}.mut{color:var(--mut)}.crumbs{font-size:.85rem;color:var(--mut)}.crumbs a{color:inherit}"+
"dl{display:grid;grid-template-columns:minmax(120px,200px) 1fr;gap:6px 14px;margin:12px 0}dt{color:var(--mut)}dd{margin:0}ul.list{list-style:none;padding:0;margin:0}ul.list li{padding:10px 0;border-bottom:1px solid var(--line)}ul.list small{display:block;color:var(--mut)}"+
".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;padding:0;list-style:none}.grid li{border:1px solid var(--line);background:var(--card);padding:10px 12px}.grid small{display:block;color:var(--mut)}"+
".btn{display:inline-block;border:1px solid var(--acc);padding:8px 14px;text-decoration:none;font-weight:650;margin:6px 8px 6px 0}.note{border-left:3px solid var(--line);padding:2px 12px;color:var(--mut);margin:16px 0}"+
"footer{padding-top:16px;padding-bottom:32px;border-top:1px solid var(--line);font-size:.85rem;color:var(--mut)}.site-progress-note{display:block;margin:8px 0;font-size:.8rem;color:var(--mut)}pre{overflow:auto;padding:10px;border:1px solid var(--line);background:var(--card)}details{margin:8px 0}summary{cursor:pointer;font-weight:650}";

function head({lang,title,desc,canonical,alternates,origin,type="website",jsonld=[],robots="index,follow,max-snippet:-1,max-image-preview:large"}){
  const alts=(alternates||[]).map(a=>'<link rel="alternate" hreflang="'+a.lang+'" href="'+esc(a.href)+'">').join("");
  const ogAlt=(alternates||[]).filter(a=>a.lang!==lang&&a.lang!=="x-default").map(a=>'<meta property="og:locale:alternate" content="'+LOCALE[a.lang]+'">').join("");
  const ld=jsonld.map(o=>'<script type="application/ld+json">'+JSON.stringify(o).replace(/</g,"\\u003c")+"</script>").join("");
  return'<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><meta name="description" content="'+esc(desc)+'">'+
    '<meta name="robots" content="'+robots+'"><link rel="canonical" href="'+esc(canonical)+'">'+alts+
    '<meta property="og:site_name" content="'+SITE+'"><meta property="og:type" content="'+type+'"><meta property="og:title" content="'+esc(title)+'"><meta property="og:description" content="'+esc(desc)+'">'+
    '<meta property="og:url" content="'+esc(canonical)+'"><meta property="og:locale" content="'+LOCALE[lang]+'">'+ogAlt+'<meta property="og:image" content="'+origin+'/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'+
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="'+esc(title)+'"><meta name="twitter:description" content="'+esc(desc)+'"><meta name="twitter:image" content="'+origin+'/og.png">'+
    '<meta name="theme-color" content="#14161a"><style>'+CSS+'</style>'+ld;
}

const urlFor=(origin,p)=>origin+"/"+p.replace(/^\/+/,"");
function sectionUrl(origin,kind,lang,slug){
  const base=PATHS[kind][lang];
  return urlFor(origin,(base?base+"/":"")+(slug?slug+"/":""));
}
function homeUrl(origin,lang){const b=PATHS.home[lang];return b?urlFor(origin,b+"/"):origin+"/"}

function layout({lang,t,origin,cur,body,switcher}){
  const nav=[["home",homeUrl(origin,lang),t.nav.home],["topics",sectionUrl(origin,"topics",lang),t.nav.topics],["publishers",sectionUrl(origin,"publishers",lang),t.nav.publishers],["connect",sectionUrl(origin,"connect",lang),t.nav.connect]]
    .map(([k,h,l])=>'<a href="'+esc(h)+'"'+(k===cur?' class="cur"':"")+'>'+esc(l)+'</a>').join("");
  const sw=(switcher||[]).map(a=>'<a href="'+esc(a.href)+'" hreflang="'+a.lang+'" lang="'+a.lang+'">'+T[a.lang].lang+'</a>').join("");
  return'<body><header><b><a href="'+esc(homeUrl(origin,lang))+'">'+SITE+'</a></b><nav>'+nav+'<a href="'+esc(origin+"/")+'">'+esc(t.nav.app)+'</a></nav>'+(sw?'<span class="lang">'+sw+'</span>':"")+'</header><main>'+body+'</main>'+
    '<footer>'+esc(t.footer)+'<span class="site-progress-note">'+esc(t.progressNote)+' <a href="mailto:info@vecture.be">info@vecture.be</a>.</span> <a href="'+origin+'/privacy">'+esc(t.privacy)+'</a> · <a href="'+origin+'/terms">'+esc(t.terms)+'</a></footer></body>';
}
const page=(lang,headHtml,bodyHtml)=>'<!doctype html><html lang="'+lang+'"><head>'+headHtml+'</head>'+bodyHtml+'</html>\n';
const crumbsLd=(items)=>({"@context":"https://schema.org","@type":"BreadcrumbList",itemListElement:items.map((c,i)=>({"@type":"ListItem",position:i+1,name:c[0],item:c[1]}))});
const crumbsHtml=items=>'<p class="crumbs">'+items.map((c,i)=>i<items.length-1?'<a href="'+esc(c[1])+'">'+esc(c[0])+'</a>':esc(c[0])).join(" › ")+"</p>";

/* ---------- selection of datasets that deserve their own page ---------- */
export function selectDatasets(items,{limit=4000,perPublisher=120,perSeries=3}={}){
  const open=f=>f==="open"||f==="open-sharealike";
  const scored=[];
  for(const it of items){
    if(scopeOf(it)!=="datasets"||it.tier==="broken")continue;
    const title=clean(it.title),desc=sentenceCase(stripHtml(it.description));
    if(title.length<8||(!it.curated&&desc.length<60))continue;
    const lic=it.licenseFamily?it.licenseFamily:normalizeLicense(it.licenseUri||it.license).family;
    const score=(it.curated?100:0)+(it.tier==="ready"?30:0)+(open(lic)?20:0)+(desc.length>=200?10:0)+((it.fields||[]).length?5:0)+(it.contactEmail||it.contactUrl?3:0);
    scored.push({it,score,lic,desc,title});
  }
  scored.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title));
  const byPub=new Map(),bySeries=new Map(),seen=new Set(),out=[];
  for(const s of scored){
    const key=(s.it.provider+"|"+s.title).toLowerCase();
    if(seen.has(key))continue;
    const pc=byPub.get(s.it.provider)||0;if(pc>=perPublisher)continue;
    if(s.it.seriesId){const sc=bySeries.get(s.it.seriesId)||0;if(sc>=perSeries)continue;bySeries.set(s.it.seriesId,sc+1)}
    seen.add(key);byPub.set(s.it.provider,pc+1);out.push(s);if(out.length>=limit)break;
  }
  return out;
}

const licenceGroupOf=f=>f==="open"||f==="open-sharealike"?"open":f==="non-commercial"||f==="no-derivatives"?"restricted":f==="custom"?"custom":"unknown";

/* ---------- the site ---------- */
export function buildSeoSite(items,{origin=DEFAULT_ORIGIN,generatedAt=null,linksCheckedAt=null,datasetLimit=4000,perPublisher=120,hubListSize=60,minPublisherPages=5}={}){
  origin=origin.replace(/\/$/,"");
  const files=new Map(),today=(generatedAt||new Date().toISOString()).slice(0,10);
  const selected=selectDatasets(items,{limit:datasetLimit,perPublisher});
  const used=new Set(),usedTitles=new Set(),records=[];
  for(const s of selected){
    let slug=(slugify(s.title).slice(0,70).replace(/-+$/,"")||"dataset")+"-"+hash6(s.it.id);
    while(used.has(slug))slug+="x";used.add(slug);
    const topic=s.it.topic||topicOf(s.it),lang=detectLang(s.title+" "+s.desc);
    records.push({...s,slug,topic,lang,url:urlFor(origin,"datasets/"+slug+"/"),pubSlug:slugify(s.it.provider)||"publisher"});
  }
  const byTopic=new Map(),byPub=new Map();
  for(const r of records){(byTopic.get(r.topic)||byTopic.set(r.topic,[]).get(r.topic)).push(r);(byPub.get(r.it.provider)||byPub.set(r.it.provider,[]).get(r.it.provider)).push(r)}
  const topicCounts=new Map(items.filter(i=>scopeOf(i)==="datasets").reduce((m,i)=>m.set(i.topic||topicOf(i),(m.get(i.topic||topicOf(i))||0)+1),new Map()));
  const pubList=[...byPub].filter(([,v])=>v.length>=minPublisherPages).sort((a,b)=>b[1].length-a[1].length);
  const pubSlugs=new Map(pubList.map(([name])=>[name,slugify(name)||"publisher-"+hash6(name)]));
  const topicIds=Object.keys(TOPIC_I18N).filter(id=>byTopic.has(id));

  const topicSlug=(id,lang)=>TOPIC_I18N[id][lang][1];
  const topicName=(id,lang)=>TOPIC_I18N[id][lang][0];
  const topicHref=(id,lang)=>sectionUrl(origin,"topics",lang,topicSlug(id,lang));
  const pubHref=(name,lang)=>sectionUrl(origin,"publishers",lang,pubSlugs.get(name));
  const alt=(pathsByLang)=>[...LANGS.map(l=>({lang:l,href:pathsByLang[l]})),{lang:"x-default",href:pathsByLang.en}];
  const put=(rel,html)=>files.set(rel,html);

  const dsListItem=(r,lang)=>{
    const t=T[lang];
    return'<li><a href="'+esc(r.url)+'">'+esc(r.title)+'</a><small>'+esc(r.it.provider)+' · '+esc(t.ds.licenceGroup[licenceGroupOf(r.lic)].split(" — ")[0])+(r.it.tier==="ready"?" · ✓":"")+'</small></li>';
  };

  /* dataset pages */
  const topicRank=new Map();for(const [id,list] of byTopic)topicRank.set(id,list);
  for(const r of records){
    const lang=r.lang,t=T[lang],it=r.it,desc=r.desc||"";
    const topic=r.topic,pubName=it.provider,licName=it.license||normalizeLicense(it.licenseUri||it.license).label||"";
    const group=licenceGroupOf(r.lic);
    // Dataset titles stay descriptive (engines index the whole title; only the snippet is cut) and must be unique across near-identical records.
    const pubShort=pubName.split(" — ")[0].split(" - ")[0];
    let title=(r.title+" – "+pubShort).length<=MAX_DATASET_TITLE?r.title+" – "+pubShort:cut(r.title,MAX_DATASET_TITLE);
    if(usedTitles.has(title))title=cut(r.title,MAX_DATASET_TITLE-10)+" ["+r.slug.slice(-6)+"]";
    usedTitles.add(title);
    const descMeta=cut((desc?desc+" ":"")+t.ds.metaTail,MAX_DESC);
    const dists=(it.distributions||[]).filter(d=>d?.url&&/^https:/i.test(d.url)).slice(0,4);
    const ldes=ldesCapability(it),dataService=it.dataKind==="data-service";
    const pr=it.probe,cycle=it.frequency&&t.ds.cycles[String(it.frequency).toUpperCase()];
    const updated=(it.dataProcessedAt||it.updatedAt||"").slice(0,10);
    const related=(byTopic.get(topic)||[]).filter(x=>x!==r).slice(0,5),more=(byPub.get(pubName)||[]).filter(x=>x!==r).slice(0,4);
    const licUrl=LICENSE_URLS[normalizeLicense(it.licenseUri||it.license).id]||"";
    const crumbs=[[SITE,homeUrl(origin,lang)],[topicName(topic,lang),topicHref(topic,lang)],[r.title,r.url]];
    const ld={"@context":"https://schema.org","@type":dataService?"Service":"Dataset",name:r.title,description:cut(desc||r.title+" — "+t.ds.metaTail,500),url:r.url,identifier:it.id,inLanguage:lang,isAccessibleForFree:true,
      ...(dataService?{serviceType:ldes.status==="publisher_declared"?"Linked Data Event Stream":"Data service",
        provider:{"@type":"Organization",name:pubName},
        ...(ldes.endpoints[0]?{serviceUrl:ldes.endpoints[0].url}:{})}:
        {creator:{"@type":"Organization",name:pubName},publisher:{"@type":"Organization",name:pubName},
         spatialCoverage:it.geoCoverage||"Belgium",includedInDataCatalog:{"@type":"DataCatalog",name:SITE,url:origin+"/"}}),
      keywords:[topicName(topic,lang),pubName,"Belgium","open data"],
      ...(updated?{dateModified:updated}:{}),...(licUrl?{license:licUrl}:{}),
      ...(it.officialUrl&&/^https?:/.test(it.officialUrl)?{sameAs:it.officialUrl}:{}),
      ...(!dataService&&dists.length?{distribution:dists.map(f=>({"@type":"DataDownload",
        ...(f.format?{encodingFormat:String(f.format).replace(/^https?:\/\/.*\//,"")}:{}),contentUrl:f.url}))}:{})};
    const rows=[
      [t.ds.publisher,'<a href="'+esc(pubSlugs.has(pubName)?pubHref(pubName,lang):"#")+'">'+esc(pubName)+"</a>"],
      [t.ds.licence,esc(licName||"—")+'<br><small class="mut">'+esc(t.ds.licenceGroup[group])+"</small>"],
      [t.ds.topic,'<a href="'+esc(topicHref(topic,lang))+'">'+esc(topicName(topic,lang))+"</a>"],
      [t.ds.kind,esc(dataService?(ldes.status==="publisher_declared"?"LDES data service":"Data service"):(t.ds.kinds[it.dataKind||"dataset"]||""))],
      ...(updated?[[t.ds.updated,esc(updated)]]:[]),...(cycle?[[t.ds.cycle,esc(cycle)]]:[]),
      ...((it.formats||[]).length?[[t.ds.formats,esc((it.formats||[]).slice(0,6).map(f=>String(f).replace(/^https?:\/\/.*\//,"")).join(", "))]]:[]),
      ...(it.contactEmail||it.contactUrl?[[t.ds.contact,esc(it.contactUrl||it.contactEmail)]]:[])
    ].map(([k,v])=>"<dt>"+esc(k)+"</dt><dd>"+v+"</dd>").join("");
    const cols=(it.fields||[]).slice(0,30).map(f=>f.name||f.label).filter(Boolean);
    const body=layout({lang,t,origin,cur:"",switcher:null,body:
      crumbsHtml(crumbs)+"<h1>"+esc(r.title)+"</h1>"+(desc?"<p>"+esc(cut(desc,600))+"</p>":"")+
      "<dl>"+rows+"</dl>"+
      '<p><a class="btn" href="'+esc(origin+"/?dataset="+encodeURIComponent(it.id))+'">'+esc(t.ds.openDesk)+'</a><span class="mut">'+esc(t.ds.openDeskHint)+"</span></p>"+
      (it.officialUrl&&/^https?:/.test(it.officialUrl)?'<p><a href="'+esc(it.officialUrl)+'" rel="noopener nofollow">'+esc(t.ds.official)+" ↗</a></p>":"")+
      (ldes.endpoints.length?'<h2>Published Linked Data Event Stream (LDES)</h2><p>This is an event stream endpoint, not a file download. A compatible client follows its linked fragments to synchronize versions. Current uptime, event freshness and history completeness are not verified by this catalogue.</p><ul class="list">'+ldes.endpoints.map(e=>'<li><a href="'+esc(e.url)+'" rel="noopener noreferrer">Publisher LDES endpoint ↗</a></li>').join("")+'</ul>':"")+
      '<p class="note">'+esc(pr&&pr.n?fmt(t.ds.linkOk,{date:pr.at,ok:pr.ok,n:pr.n}):t.ds.linkNone)+" "+esc(t.ds.notVerified)+"</p>"+
      (cols.length?"<h2>"+esc(t.ds.columns)+"</h2><p>"+esc(cols.join(", "))+"</p>":"")+
      (related.length?"<h2>"+esc(t.ds.related)+'</h2><ul class="list">'+related.map(x=>dsListItem(x,lang)).join("")+"</ul>":"")+
      (more.length?"<h2>"+esc(t.ds.moreBy)+'</h2><ul class="list">'+more.map(x=>dsListItem(x,lang)).join("")+"</ul>":"")});
    put("datasets/"+r.slug+"/index.html",page(lang,head({lang,title,desc:descMeta,canonical:r.url,alternates:[{lang,href:r.url},{lang:"x-default",href:r.url}],origin,type:"article",jsonld:[ld,crumbsLd(crumbs)]}),body));
  }

  /* topic hubs, publisher hubs, indexes, landing and connect pages in every language */
  for(const lang of LANGS){
    const t=T[lang];
    const topicsAlt=alt(Object.fromEntries(LANGS.map(l=>[l,sectionUrl(origin,"topics",l)])));
    const switcher=a=>a.filter(x=>x.lang!=="x-default");
    // topics index
    {
      const canon=sectionUrl(origin,"topics",lang),crumbs=[[SITE,homeUrl(origin,lang)],[t.nav.topics,canon]];
      const body=layout({lang,t,origin,cur:"topics",switcher:switcher(topicsAlt),body:crumbsHtml(crumbs)+"<h1>"+esc(t.topicsH1)+'</h1><p class="mut">'+esc(t.topicsLead)+'</p><ul class="grid">'+
        topicIds.map(id=>'<li><a href="'+esc(topicHref(id,lang))+'">'+esc(topicName(id,lang))+"</a><small>"+esc(TOPIC_I18N[id].d[lang])+"</small></li>").join("")+"</ul>"});
      put((PATHS.topics[lang]+"/index.html"),page(lang,head({lang,title:cut(t.topicsH1+" | "+SITE,MAX_TITLE),desc:cut(t.topicsLead+" "+t.siteDesc,MAX_DESC),canonical:canon,alternates:topicsAlt,origin,jsonld:[crumbsLd(crumbs)]}),body));
    }
    // topic hubs
    for(const id of topicIds){
      const list=byTopic.get(id),canon=topicHref(id,lang),name=topicName(id,lang);
      const a=alt(Object.fromEntries(LANGS.map(l=>[l,topicHref(id,l)])));
      const crumbs=[[SITE,homeUrl(origin,lang)],[t.nav.topics,sectionUrl(origin,"topics",lang)],[name,canon]];
      const shown=list.slice(0,hubListSize),total=topicCounts.get(id)||list.length;
      const ld={"@context":"https://schema.org","@type":"CollectionPage",name:fmt(t.topicH1,{topic:name}),description:TOPIC_I18N[id].d[lang],url:canon,inLanguage:lang,
        mainEntity:{"@type":"ItemList",numberOfItems:shown.length,itemListElement:shown.map((r,i)=>({"@type":"ListItem",position:i+1,url:r.url,name:r.title}))}};
      const body=layout({lang,t,origin,cur:"topics",switcher:switcher(a),body:crumbsHtml(crumbs)+"<h1>"+esc(fmt(t.topicH1,{topic:name}))+'</h1><p class="mut">'+esc(fmt(t.topicLead,{desc:TOPIC_I18N[id].d[lang]}))+"</p>"+
        '<p class="mut">'+esc(fmt(t.showing,{n:shown.length,total:total.toLocaleString("en-US").replace(/,/g,lang==="en"?",":"."),}))+'. <a href="'+esc(origin+"/")+'">'+esc(fmt(t.seeAll,{total:total.toLocaleString("en-US").replace(/,/g,lang==="en"?",":".")}))+"</a></p>"+
        '<ul class="list">'+shown.map(r=>dsListItem(r,lang)).join("")+"</ul>"});
      put(PATHS.topics[lang]+"/"+topicSlug(id,lang)+"/index.html",page(lang,head({lang,title:cut(fmt(t.topicH1,{topic:name}),MAX_TITLE),desc:cut(TOPIC_I18N[id].d[lang]+" "+t.ds.metaTail,MAX_DESC),canonical:canon,alternates:a,origin,jsonld:[ld,crumbsLd(crumbs)]}),body));
    }
    // publishers index + hubs
    {
      const pa=alt(Object.fromEntries(LANGS.map(l=>[l,sectionUrl(origin,"publishers",l)])));
      const canon=sectionUrl(origin,"publishers",lang),crumbs=[[SITE,homeUrl(origin,lang)],[t.nav.publishers,canon]];
      const body=layout({lang,t,origin,cur:"publishers",switcher:switcher(pa),body:crumbsHtml(crumbs)+"<h1>"+esc(t.pubsH1)+'</h1><p class="mut">'+esc(t.pubsLead)+'</p><ul class="grid">'+
        pubList.map(([name,list])=>'<li><a href="'+esc(pubHref(name,lang))+'">'+esc(name)+"</a><small>"+list.length+"</small></li>").join("")+"</ul>"});
      put(PATHS.publishers[lang]+"/index.html",page(lang,head({lang,title:cut(t.pubsH1+" | "+SITE,MAX_TITLE),desc:cut(t.pubsLead+" "+t.siteDesc,MAX_DESC),canonical:canon,alternates:pa,origin,jsonld:[crumbsLd(crumbs)]}),body));
      for(const [name,list] of pubList){
        const slug=pubSlugs.get(name),c=pubHref(name,lang),a=alt(Object.fromEntries(LANGS.map(l=>[l,pubHref(name,l)])));
        const cr=[[SITE,homeUrl(origin,lang)],[t.nav.publishers,canon],[name,c]],shown=list.slice(0,80);
        const ld={"@context":"https://schema.org","@type":"CollectionPage",name:fmt(t.pubH1,{publisher:name}),url:c,inLanguage:lang,about:{"@type":"Organization",name},
          mainEntity:{"@type":"ItemList",numberOfItems:shown.length,itemListElement:shown.map((r,i)=>({"@type":"ListItem",position:i+1,url:r.url,name:r.title}))}};
        const b=layout({lang,t,origin,cur:"publishers",switcher:switcher(a),body:crumbsHtml(cr)+"<h1>"+esc(fmt(t.pubH1,{publisher:name}))+'</h1><p class="mut">'+esc(fmt(t.pubLead,{n:list.length,publisher:name}))+'</p><ul class="list">'+shown.map(r=>dsListItem(r,lang)).join("")+"</ul>"});
        put(PATHS.publishers[lang]+"/"+slug+"/index.html",page(lang,head({lang,title:cut(fmt(t.pubH1,{publisher:name}),MAX_TITLE),desc:cut(fmt(t.pubLead,{n:list.length,publisher:name}),MAX_DESC),canonical:c,alternates:a,origin,jsonld:[ld,crumbsLd(cr)]}),b));
      }
    }
    // connect page
    {
      const ca=alt(Object.fromEntries(LANGS.map(l=>[l,sectionUrl(origin,"connect",l)]))),canon=sectionUrl(origin,"connect",lang),c=t.connect,addr=origin+"/mcp";
      const crumbs=[[SITE,homeUrl(origin,lang)],[t.nav.connect,canon]];
      const ld={"@context":"https://schema.org","@type":"WebPage",name:c.title,description:c.desc,url:canon,inLanguage:lang,isPartOf:{"@type":"WebSite",name:SITE,url:origin+"/"}};
      const body=layout({lang,t,origin,cur:"connect",switcher:switcher(ca),body:crumbsHtml(crumbs)+"<h1>"+esc(c.h1)+'</h1><p class="mut">'+esc(c.lead)+"</p>"+
        "<h2>"+esc(c.addr)+"</h2><pre>"+esc(addr)+'</pre><p class="mut">'+esc(c.addrNote)+"</p>"+
        "<h2>"+esc(c.claude)+"</h2><ul>"+c.claudeSteps.map(s=>"<li>"+esc(s)+"</li>").join("")+"</ul><pre>claude mcp add --transport http belgium-open-data "+esc(addr)+"</pre>"+
        "<h2>"+esc(c.chatgpt)+"</h2><ul>"+c.chatgptSteps.map(s=>"<li>"+esc(s)+"</li>").join("")+"</ul>"+
        "<h2>"+esc(c.other)+"</h2><p>"+esc(c.otherText)+"</p>"+
        "<h2>"+esc(c.asks)+"</h2><ul>"+c.prompts.map(s=>"<li>“"+esc(s)+"”</li>").join("")+"</ul>"+
        "<h2>"+esc(c.trust)+"</h2><ul>"+c.trustItems.map(s=>"<li>"+esc(s)+"</li>").join("")+"</ul>"+
        "<h2>"+esc(c.tools)+"</h2><ul>"+[["catalogue_overview","catalogue_overview"],["search_datasets","search_datasets"],["get_dataset","get_dataset"],["preview_dataset","preview_dataset"],["subsurface_at_location","subsurface_at_location"],["get_subsurface_record","get_subsurface_record"],["search_subsurface","search_subsurface"],["belgian_statistics","belgian_statistics"],["air_quality","air_quality"],["flood_risk","flood_risk"],["search_fetch","search</code> / <code>fetch"]].map(([k,label])=>"<li><code>"+label+"</code>: "+esc(c.toolItems[k])+"</li>").join("")+"</ul>"+
        "<h2>"+esc(c.help)+"</h2><ul>"+c.helpItems.map(s=>"<li>"+esc(s)+"</li>").join("")+"</ul>"+
        "<h2>"+esc(c.support)+'</h2><p>'+esc(c.supportText).replace("info@vecture.be",'<a href="mailto:info@vecture.be">info@vecture.be</a>')+' <a href="'+esc(origin)+'/privacy">'+esc(t.privacy)+'</a> · <a href="'+esc(origin)+'/terms">'+esc(t.terms)+"</a></p>"});
      put(PATHS.connect[lang]+"/index.html",page(lang,head({lang,title:cut(c.title,MAX_TITLE),desc:cut(c.desc,MAX_DESC),canonical:canon,alternates:ca,origin,jsonld:[ld,crumbsLd(crumbs)]}),body));
    }
    // landing pages for nl / fr (the English landing page is the app at "/", enriched by injectHome)
    if(lang!=="en"){
      const ha=alt(Object.fromEntries(LANGS.map(l=>[l,homeUrl(origin,l)]))),canon=homeUrl(origin,lang);
      const ld=[{"@context":"https://schema.org","@type":"WebSite",name:SITE,url:canon,inLanguage:lang,description:t.siteDesc},
        {"@context":"https://schema.org","@type":"DataCatalog",name:SITE,url:canon,description:t.siteDesc,inLanguage:lang,spatialCoverage:"Belgium",license:"https://creativecommons.org/licenses/by/4.0/"},
        {"@context":"https://schema.org","@type":"FAQPage",mainEntity:t.faq.map(([q,a])=>({"@type":"Question",name:q,acceptedAnswer:{"@type":"Answer",text:a}}))}];
      const body=layout({lang,t,origin,cur:"home",switcher:switcher(ha),body:homeBody({lang,t,origin,topicIds,topicName,topicHref,pubList,pubHref,topicCounts})});
      put(PATHS.home[lang]+"/index.html",page(lang,head({lang,title:cut(t.siteTitle,MAX_TITLE),desc:cut(t.siteDesc,MAX_DESC),canonical:canon,alternates:ha,origin,jsonld:ld}),body));
    }
  }

  /* sitemaps */
  const xml=s=>esc(s),alts=a=>a.map(x=>'<xhtml:link rel="alternate" hreflang="'+x.lang+'" href="'+xml(x.href)+'"/>').join("");
  const core=[];
  const addCore=(pathsByLang)=>{const a=alt(pathsByLang);for(const l of LANGS)core.push('<url><loc>'+xml(pathsByLang[l])+'</loc><lastmod>'+today+'</lastmod>'+alts(a)+'</url>')};
  addCore(Object.fromEntries(LANGS.map(l=>[l,homeUrl(origin,l)])));
  addCore(Object.fromEntries(LANGS.map(l=>[l,sectionUrl(origin,"topics",l)])));
  addCore(Object.fromEntries(LANGS.map(l=>[l,sectionUrl(origin,"publishers",l)])));
  addCore(Object.fromEntries(LANGS.map(l=>[l,sectionUrl(origin,"connect",l)])));
  for(const id of topicIds)addCore(Object.fromEntries(LANGS.map(l=>[l,topicHref(id,l)])));
  for(const [name] of pubList)addCore(Object.fromEntries(LANGS.map(l=>[l,pubHref(name,l)])));
  const ns='xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"';
  put("sitemap-core.xml",'<?xml version="1.0" encoding="UTF-8"?>\n<urlset '+ns+'>\n'+core.join("\n")+"\n</urlset>\n");
  const dsUrls=records.map(r=>'<url><loc>'+xml(r.url)+'</loc><lastmod>'+((r.it.dataProcessedAt||r.it.updatedAt||"").slice(0,10)||today)+'</lastmod></url>');
  const chunks=Math.max(1,Math.ceil(dsUrls.length/10000));
  for(let i=0;i<chunks;i++)put("sitemap-datasets-"+(i+1)+".xml",'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+dsUrls.slice(i*10000,(i+1)*10000).join("\n")+"\n</urlset>\n");
  const sub=["sitemap-core.xml",...Array.from({length:chunks},(_,i)=>"sitemap-datasets-"+(i+1)+".xml")];
  put("sitemap.xml",'<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+sub.map(s=>"<sitemap><loc>"+xml(origin+"/"+s)+"</loc><lastmod>"+today+"</lastmod></sitemap>").join("\n")+"\n</sitemapindex>\n");
  put("robots.txt","User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /mcp\n\nSitemap: "+origin+"/sitemap.xml\n");
  put("llms.txt","# "+SITE+"\n\n> Free, searchable catalogue of about 21,700 Belgian open datasets with licence, update-cycle and link-check evidence. Available in English, Dutch and French. Read-only MCP server for AI assistants.\n\n"+
    "## Key pages\n- ["+T.en.nav.topics+"]("+sectionUrl(origin,"topics","en")+"): datasets by topic\n- ["+T.en.nav.publishers+"]("+sectionUrl(origin,"publishers","en")+"): datasets by publisher\n- [Use with AI]("+sectionUrl(origin,"connect","en")+"): connect ChatGPT or Claude (MCP: "+origin+"/mcp)\n- [Nederlands]("+homeUrl(origin,"nl")+") · [Français]("+homeUrl(origin,"fr")+")\n\n"+
    "## Notes\nResults describe catalogue metadata and link checks, not the correctness of data. Datasets belong to their publishers; licences vary.\n");
  put(".seo-managed","generated by scripts/build-seo-pages.mjs — sitemap.xml and robots.txt are managed here, not by search-console prepare\n");
  return{files,stats:{datasetPages:records.length,topics:topicIds.length,publishers:pubList.length,langs:LANGS.length,files:files.size},records,topicIds,pubList,homeBlock:()=>homeInjection({origin,topicIds,topicName,topicHref,pubList,pubHref,topicCounts,alternates:alt(Object.fromEntries(LANGS.map(l=>[l,homeUrl(origin,l)])))})};
}

function homeBody({lang,t,origin,topicIds,topicName,topicHref,pubList,pubHref,topicCounts}){
  return"<h1>"+esc(t.h1Home)+'</h1><p class="mut">'+esc(t.lead)+'</p><p><a class="btn" href="'+esc(origin+"/")+'">'+esc(t.nav.app)+'</a><a class="btn" href="'+esc(sectionUrl(origin,"connect",lang))+'">'+esc(t.nav.connect)+"</a></p>"+
    "<ul>"+t.homePoints.map(p=>"<li>"+esc(p)+"</li>").join("")+"</ul>"+
    "<h2>"+esc(t.browseTopics)+'</h2><ul class="grid">'+topicIds.map(id=>'<li><a href="'+esc(topicHref(id,lang))+'">'+esc(topicName(id,lang))+"</a><small>"+esc(TOPIC_I18N[id].d[lang])+"</small></li>").join("")+"</ul>"+
    "<h2>"+esc(t.topPublishers)+'</h2><ul class="grid">'+pubList.slice(0,12).map(([n,l])=>'<li><a href="'+esc(pubHref(n,lang))+'">'+esc(n)+"</a><small>"+l.length+"</small></li>").join("")+'</ul><p><a href="'+esc(sectionUrl(origin,"publishers",lang))+'">'+esc(t.browsePublishers)+" →</a></p>"+
    "<h2>"+esc(t.faqTitle)+"</h2>"+t.faq.map(([q,a])=>"<details><summary>"+esc(q)+"</summary><p>"+esc(a)+"</p></details>").join("");
}

/** Crawlable content + hreflang + structured data for the English landing page, which is the interactive app at "/". */
function homeInjection({origin,topicIds,topicName,topicHref,pubList,pubHref,topicCounts,alternates}){
  const t=T.en,lang="en";
  const headBlock=alternates.map(a=>'<link rel="alternate" hreflang="'+a.lang+'" href="'+esc(a.href)+'">').join("")+
    [{"@context":"https://schema.org","@type":"WebSite",name:SITE,url:origin+"/",inLanguage:["en","nl","fr"],description:t.siteDesc},
     {"@context":"https://schema.org","@type":"DataCatalog",name:SITE,url:origin+"/",description:t.siteDesc,spatialCoverage:"Belgium",inLanguage:["en","nl","fr"]},
     {"@context":"https://schema.org","@type":"FAQPage",mainEntity:t.faq.map(([q,a])=>({"@type":"Question",name:q,acceptedAnswer:{"@type":"Answer",text:a}}))}]
    .map(o=>'<script type="application/ld+json">'+JSON.stringify(o).replace(/</g,"\\u003c")+"</script>").join("");
  const bodyBlock='<details id="seo-about" style="max-width:900px;margin:24px auto;padding:0 16px"><summary style="cursor:pointer;font-weight:650">'+esc(t.h1Home)+' — '+esc(t.nav.topics)+', '+esc(t.nav.publishers)+', FAQ</summary><h2>'+esc(t.h1Home)+"</h2><p>"+esc(t.lead)+"</p><ul>"+t.homePoints.map(p=>"<li>"+esc(p)+"</li>").join("")+"</ul>"+
    "<h3>"+esc(t.browseTopics)+"</h3><ul>"+topicIds.map(id=>'<li><a href="'+esc(topicHref(id,"en"))+'">'+esc(topicName(id,"en"))+"</a></li>").join("")+"</ul>"+
    "<h3>"+esc(t.topPublishers)+"</h3><ul>"+pubList.slice(0,12).map(([n])=>'<li><a href="'+esc(pubHref(n,"en"))+'">'+esc(n)+"</a></li>").join("")+'</ul><p><a href="'+esc(sectionUrl(origin,"publishers","en"))+'">'+esc(t.browsePublishers)+'</a> · <a href="'+esc(sectionUrl(origin,"connect","en"))+'">'+esc(t.nav.connect)+'</a> · <a href="'+esc(homeUrl(origin,"nl"))+'" hreflang="nl" lang="nl">Nederlands</a> · <a href="'+esc(homeUrl(origin,"fr"))+'" hreflang="fr" lang="fr">Français</a></p>'+
    "<h3>"+esc(t.faqTitle)+"</h3>"+t.faq.map(([q,a])=>"<details><summary>"+esc(q)+"</summary><p>"+esc(a)+"</p></details>").join("")+"</details>";
  return{headBlock,bodyBlock};
}

/** Idempotently inject the English landing content between marker comments in index.html. */
export function injectHome(html,block,{origin=DEFAULT_ORIGIN}={}){
  const wrap=(name,content)=>"<!--seo:"+name+"-->"+content+"<!--/seo:"+name+"-->";
  const replace=(src,name,content)=>{
    const re=new RegExp("<!--seo:"+name+"-->[\\s\\S]*?<!--/seo:"+name+"-->");
    return re.test(src)?src.replace(re,()=>wrap(name,content)):null;
  };
  let out=replace(html,"head",block.headBlock);
  if(out===null)out=html.replace("</head>",()=>wrap("head",block.headBlock)+"</head>");
  let out2=replace(out,"home",block.bodyBlock);
  if(out2===null)out2=out.replace(/(<footer class="page-footer">)/,(m)=>wrap("home",block.bodyBlock)+m);
  return out2;
}

function main(){
  const args=process.argv.slice(2),oi=args.indexOf("--origin"),origin=(oi>=0?args[oi+1]:process.env.SITE_ORIGIN)||DEFAULT_ORIGIN;
  return import("./lib-catalogue.mjs").then(async({loadCatalogueItems})=>{
    const {items,generatedAt,linksCheckedAt}=await loadCatalogueItems(pub);
    const site=buildSeoSite(items,{origin,generatedAt,linksCheckedAt});
    const {validateSite}=await import("./validate-seo-site.mjs");
    const problems=validateSite(site.files,origin);
    if(problems.length){console.error("[seo] "+problems.length+" structural problems; refusing to write pages:\n  "+problems.slice(0,25).join("\n  "));process.exit(1)}
    // everything below is generated: start from a clean slate so removed datasets do not leave stale pages
    for(const d of ["datasets","topics","publishers","connect","nl","fr"])fs.rmSync(path.join(pub,d),{recursive:true,force:true});
    for(const [rel,content] of site.files){const f=path.join(pub,rel);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,content)}
    const indexPath=path.join(pub,"index.html");
    fs.writeFileSync(indexPath,injectHome(fs.readFileSync(indexPath,"utf8"),site.homeBlock(),{origin}));
    // the English connect page is generated; the hand-written connect.html is superseded (it served /connect)
    fs.rmSync(path.join(pub,"connect.html"),{force:true});
    console.log("[seo] "+site.stats.datasetPages+" dataset pages, "+site.stats.topics+" topics, "+site.stats.publishers+" publishers x "+site.stats.langs+" languages, "+site.stats.files+" files; origin "+origin);
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exit(1)});
