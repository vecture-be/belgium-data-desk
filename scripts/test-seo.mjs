import assert from "node:assert/strict";
import { validateSite } from "./validate-seo-site.mjs";
import { buildSeoSite, detectLang, injectHome, selectDatasets, slugify, DEFAULT_ORIGIN, MAX_DATASET_TITLE, MAX_DESC, MAX_TITLE } from "./build-seo-pages.mjs";

const ORIGIN="https://seo.example";
const d=(format,url)=>({format,url,name:format});
const mk=(i,over={})=>({id:"national:"+i,title:"Population by municipality "+i,provider:"Statbel",description:"Number of inhabitants per municipality, based on the national register. ".repeat(2),dataKind:"dataset",topic:"population",
  licenseFamily:"open",license:"CC BY",tier:"ready",probe:{at:"2026-10-02",n:1,ok:1,mm:0,cors:1},officialUrl:"https://statbel.example/p"+i,frequency:"ANNUAL",updatedAt:"2026-05-01",formats:["CSV"],distributions:[d("CSV","https://statbel.example/p"+i+".csv")],...over});
const items=[
  ...Array.from({length:8},(_,i)=>mk(i)),
  mk(100,{title:"Bevolking per gemeente en per geslacht",description:"Aantal inwoners per gemeente, op basis van het rijksregister van de bevolking voor het hele land.",provider:"Statbel"}),
  mk(101,{title:"Qualité de l'air dans les communes de Wallonie",description:"Mesures de la qualité de l'air dans les communes de Wallonie, pour la période en cours.",provider:"ISSeP",topic:"environment"}),
  mk(102,{title:"Hospital stays by diagnosis",description:"Anonymous hospital stays by diagnosis group and region for the reporting year. ".repeat(2),provider:"FPS Health",topic:"health",licenseFamily:"non-commercial",license:"CC BY-NC"}),
  mk(103,{title:"Thin record",description:"short",provider:"X"}),                                  // too little text: no page
  mk(104,{title:"Map layer",dataKind:"map-service",provider:"NGI"}),                              // not a dataset: no page
  mk(105,{title:"Broken link dataset",tier:"broken",provider:"Y"}),                               // broken: no page
  ...Array.from({length:6},(_,i)=>mk(200+i,{title:"Census table "+i+" per sector",seriesId:"series:census",provider:"Statbel Census"})),
  mk(300,{title:"Population by municipality 0",id:"national:dup"}),                               // same publisher+title as record 0
  mk(400,{title:"Curated register of enterprises and establishments",provider:"FPS Economy",curated:true,topic:"economy",licenseFamily:"unknown",license:"",probe:undefined,tier:"download"})
];
const FIX_IDS=items.map(i=>i.id);void FIX_IDS;

// language of a record's own text
assert.equal(detectLang("Bevolking per gemeente en per geslacht"),"nl");
assert.equal(detectLang("Qualité de l'air dans les communes de Wallonie"),"fr");
assert.equal(detectLang("Hospital stays by diagnosis and region"),"en");
assert.equal(slugify("Qualité de l'air — Wallonië!"),"qualite-de-l-air-wallonie");

// selection: thin / non-dataset / broken / duplicate records are excluded and series are capped
const sel=selectDatasets(items);
const titles=sel.map(s=>s.title);
assert.ok(!titles.includes("Thin record")&&!titles.includes("Map layer")&&!titles.includes("Broken link dataset"));
assert.equal(titles.filter(t=>t==="Population by municipality 0").length,1,"same publisher+title appears once");
assert.equal(sel.filter(s=>s.it.seriesId==="series:census").length,3,"series members capped at 3 pages");
assert.equal(sel[0].it.curated,true,"hand-reviewed records come first");

const site=buildSeoSite(items,{origin:ORIGIN,generatedAt:"2026-10-02T08:00:00Z",minPublisherPages:3});
const files=site.files;
assert.deepEqual(validateSite(files,ORIGIN),[],"generated site passes structural validation");
const html=[...files].filter(([p])=>p.endsWith(".html"));
assert.ok(html.length>30,"expected many pages, got "+html.length);

// every page: title, description, canonical, language, one h1, parsable JSON-LD
const urlOfFile=rel=>ORIGIN+"/"+rel.replace(/index\.html$/,"");
const info=new Map(),titlesSeen=new Map();
const unesc=s=>s&&s.replace(/&quot;/g,"\"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
const attr=(h,re)=>unesc((h.match(re)||[])[1]);
for(const [rel,h] of html){
  const title=attr(h,/<title>([^<]*)<\/title>/),desc=attr(h,/<meta name="description" content="([^"]*)"/),canon=attr(h,/<link rel="canonical" href="([^"]*)"/);
  const maxT=rel.startsWith("datasets/")?MAX_DATASET_TITLE:MAX_TITLE;
  assert.ok(title&&title.length<=maxT,rel+": title length "+(title||"").length+" > "+maxT);
  assert.ok(desc&&desc.length>=50&&desc.length<=MAX_DESC+5,rel+": description length "+(desc||"").length);
  assert.equal(canon,urlOfFile(rel),rel+": canonical equals its own URL");
  assert.match(h,/^<!doctype html><html lang="(en|nl|fr)">/,rel+": lang attribute");
  assert.equal((h.match(/<h1>/g)||[]).length,1,rel+": exactly one h1");
  assert.ok(/<meta name="viewport"/.test(h)&&/property="og:image"/.test(h)&&/name="twitter:card"/.test(h),rel+": viewport/og/twitter");
  const lds=[...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>JSON.parse(m[1].replace(/\\u003c/g,"<")));
  assert.ok(lds.length>=1,rel+": has structured data");
  assert.ok(lds.some(o=>o["@type"]==="BreadcrumbList"||o["@type"]==="WebSite"),rel+": breadcrumb or website data");
  const alts=[...h.matchAll(/<link rel="alternate" hreflang="([a-z-]+)" href="([^"]*)"/g)].map(m=>[m[1],m[2]]);
  info.set(canon,{rel,title,alts,lds});
  titlesSeen.set(title,(titlesSeen.get(title)||[]).concat(rel));
}
for(const [t,rels] of titlesSeen)assert.equal(rels.length,1,"duplicate <title> '"+t+"' on "+rels.join(", "));

// dataset pages carry valid schema.org Dataset data
const dsPages=html.filter(([p])=>p.startsWith("datasets/"));
assert.equal(dsPages.length,sel.length);
for(const [rel] of dsPages){
  const ds=info.get(urlOfFile(rel)).lds.find(o=>o["@type"]==="Dataset");
  assert.ok(ds&&ds.name&&ds.description&&ds.url&&ds.creator?.name&&ds.includedInDataCatalog,rel+": Dataset JSON-LD complete");
  assert.ok(ds.distribution?.every(x=>x.contentUrl.startsWith("https://")),rel+": https distributions only");
}
const dutch=dsPages.find(([,h])=>h.includes("Bevolking per gemeente en per geslacht"));
assert.match(dutch[1],/<html lang="nl">/);assert.match(dutch[1],/Uitgever/,"dataset page chrome follows the record's language");
const lic=info.get(urlOfFile(dsPages.find(([,h])=>h.includes("CC BY</dd>")||h.includes("CC BY<br>"))[0])).lds.find(o=>o["@type"]==="Dataset");
assert.equal(lic.license,"https://creativecommons.org/licenses/by/4.0/");

// hreflang: complete, reciprocal, includes x-default
for(const [canon,pg] of info){
  if(!pg.alts.length)continue;
  const langs=pg.alts.map(a=>a[0]);
  if(pg.rel.startsWith("datasets/")){assert.equal(langs.length,2,pg.rel+": one language + x-default");assert.ok(langs.includes("x-default"));continue}
  assert.deepEqual([...langs].sort(),["en","fr","nl","x-default"],pg.rel+": hreflang set");
  assert.ok(pg.alts.some(a=>a[1]===canon),pg.rel+": lists itself");
  for(const [l,href] of pg.alts){
    if(l==="x-default"||href===ORIGIN+"/")continue;
    const back=info.get(href);assert.ok(back,pg.rel+": alternate "+href+" exists");
    assert.ok(back.alts.some(a=>a[1]===canon),pg.rel+": alternate "+href+" links back");
  }
}

// internal links resolve to generated files or known app routes
const known=new Set([ORIGIN+"/",ORIGIN+"/privacy",ORIGIN+"/terms",ORIGIN+"/mcp"]);
for(const [rel,h] of html){
  for(const m of h.matchAll(/<a [^>]*href="([^"]+)"/g)){
    const href=m[1].replace(/&amp;/g,"&");
    if(!href.startsWith(ORIGIN)||known.has(href)||href.startsWith(ORIGIN+"/?dataset="))continue;
    assert.ok(info.has(href),rel+": broken internal link "+href);
  }
}

// sitemaps list only pages that exist (plus the app root) and cover every dataset page
const sm=files.get("sitemap.xml");assert.match(sm,/<sitemapindex/);
const locs=name=>[...files.get(name).matchAll(/<loc>([^<]*)<\/loc>/g)].map(m=>m[1]);
const core=locs("sitemap-core.xml"),dsLocs=locs("sitemap-datasets-1.xml");
for(const u of [...core,...dsLocs])assert.ok(u===ORIGIN+"/"||info.has(u),"sitemap URL has no page: "+u);
assert.equal(dsLocs.length,sel.length);
assert.match(files.get("sitemap-core.xml"),/xhtml:link rel="alternate" hreflang="nl"/);
assert.match(files.get("robots.txt"),/Sitemap: https:\/\/seo\.example\/sitemap\.xml/);assert.match(files.get("robots.txt"),/Disallow: \/mcp/);
assert.ok(files.has("llms.txt")&&files.has(".seo-managed"));

// topic hubs exist in all three languages with translated slugs
for(const p of ["topics/population/index.html","nl/themas/bevolking/index.html","fr/themes/population/index.html","nl/verbinden/index.html","fr/connecter/index.html","nl/index.html","fr/index.html","connect/index.html"])assert.ok(files.has(p),"missing "+p);
assert.match(files.get("fr/index.html"),/FAQPage/);

// the English landing page (the app) is enriched idempotently
const shell='<!doctype html><html lang="en"><head><title>x</title></head><body><main></main><footer class="page-footer">f</footer></body></html>';
const block=site.homeBlock();
const once=injectHome(shell,block,{origin:ORIGIN}),twice=injectHome(once,block,{origin:ORIGIN});
assert.equal(once,twice,"injection is idempotent");
assert.match(once,/hreflang="nl"/);assert.match(once,/FAQPage/);assert.match(once,/id="seo-about"/);assert.match(once,/href="https:\/\/seo\.example\/topics\/population\/"/);

assert.equal(DEFAULT_ORIGIN.startsWith("https://"),true);
console.log(JSON.stringify({ok:true,pages:html.length,datasetPages:dsPages.length,files:files.size}));
