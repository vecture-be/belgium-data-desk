// Structural validation of a generated site (Map of relative path -> content). Used by the unit test and as a gate in the build:
// a deploy must never ship pages with missing canonicals, broken hreflang reciprocity, duplicate titles or dead internal links.
import { MAX_DATASET_TITLE, MAX_DESC, MAX_TITLE } from "./build-seo-pages.mjs";

const unesc=s=>s&&s.replace(/&quot;/g,'"').replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
const attr=(h,re)=>unesc((h.match(re)||[])[1]);

export function validateSite(files,origin,{extraKnown=[]}={}){
  const problems=[],add=(rel,msg)=>problems.push(rel+": "+msg);
  const html=[...files].filter(([p])=>p.endsWith(".html"));
  const urlOfFile=rel=>origin+"/"+rel.replace(/index\.html$/,"");
  const info=new Map(),titles=new Map();
  for(const [rel,h] of html){
    const title=attr(h,/<title>([^<]*)<\/title>/),desc=attr(h,/<meta name="description" content="([^"]*)"/),canon=attr(h,/<link rel="canonical" href="([^"]*)"/);
    const maxTitle=rel.startsWith("datasets/")?MAX_DATASET_TITLE:MAX_TITLE;
    if(!title||title.length>maxTitle)add(rel,"title missing or longer than "+maxTitle+" ("+(title||"").length+")");
    if(!desc||desc.length<50||desc.length>MAX_DESC+5)add(rel,"description length "+(desc||"").length);
    if(canon!==urlOfFile(rel))add(rel,"canonical "+canon+" is not its own URL");
    if(!/^<!doctype html><html lang="(en|nl|fr)">/.test(h))add(rel,"missing lang attribute");
    if((h.match(/<h1>/g)||[]).length!==1)add(rel,"needs exactly one h1");
    if(!/<meta name="viewport"/.test(h)||!/property="og:image"/.test(h))add(rel,"missing viewport or og:image");
    const lds=[];
    for(const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)){try{lds.push(JSON.parse(m[1].replace(/\\u003c/g,"<")))}catch{add(rel,"invalid JSON-LD")}}
    if(!lds.length)add(rel,"no structured data");
    const alts=[...h.matchAll(/<link rel="alternate" hreflang="([a-z-]+)" href="([^"]*)"/g)].map(m=>[m[1],m[2]]);
    info.set(canon,{rel,alts,lds});
    titles.set(title,(titles.get(title)||[]).concat(rel));
    if(rel.startsWith("datasets/")){
      // data services (APIs, LDES streams) are described as schema.org Service, datasets as Dataset
      const ds=lds.find(o=>o["@type"]==="Dataset"),svc=lds.find(o=>o["@type"]==="Service");
      if(svc&&!ds){if(!(svc.name&&svc.description&&svc.url&&svc.provider?.name))add(rel,"incomplete Service JSON-LD")}
      else if(!(ds&&ds.name&&ds.description&&ds.url&&ds.creator?.name&&ds.includedInDataCatalog))add(rel,"incomplete Dataset JSON-LD");
      else if(ds.distribution&&!ds.distribution.every(x=>/^https:\/\//.test(x.contentUrl)))add(rel,"non-https distribution in JSON-LD");
    }
  }
  for(const [t,rels] of titles)if(rels.length>1)add(rels.join(" & "),"duplicate <title> \""+t+"\"");
  for(const [canon,pg] of info){
    if(!pg.alts.length)continue;
    const langs=pg.alts.map(a=>a[0]);
    if(pg.rel.startsWith("datasets/")){if(langs.length!==2||!langs.includes("x-default"))add(pg.rel,"dataset hreflang must be its language + x-default");continue}
    if([...langs].sort().join()!=="en,fr,nl,x-default")add(pg.rel,"hreflang set incomplete: "+langs.join(","));
    if(!pg.alts.some(a=>a[1]===canon))add(pg.rel,"hreflang does not list itself");
    for(const [l,href] of pg.alts){
      if(l==="x-default"||href===origin+"/")continue;
      const back=info.get(href);
      if(!back)add(pg.rel,"hreflang target does not exist: "+href);
      else if(!back.alts.some(a=>a[1]===canon))add(pg.rel,"hreflang target does not link back: "+href);
    }
  }
  const known=new Set([origin+"/",origin+"/privacy",origin+"/terms",origin+"/mcp",...extraKnown]);
  for(const [rel,h] of html){
    for(const m of h.matchAll(/<a [^>]*href="([^"]+)"/g)){
      const href=m[1].replace(/&amp;/g,"&");
      if(!href.startsWith(origin)||known.has(href)||href.startsWith(origin+"/?dataset="))continue;
      if(!info.has(href))add(rel,"broken internal link "+href);
    }
  }
  for(const name of [...files.keys()].filter(k=>/^sitemap-.*\.xml$/.test(k))){
    for(const m of files.get(name).matchAll(/<loc>([^<]*)<\/loc>/g))if(m[1]!==origin+"/"&&!info.has(m[1]))add(name,"sitemap URL has no page: "+m[1]);
  }
  if(!files.has("sitemap.xml")||!files.has("robots.txt"))add("site","sitemap.xml and robots.txt required");
  return problems;
}
