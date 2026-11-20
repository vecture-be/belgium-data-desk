// Compact production gate for existing full-file cards and MCP index integrity.
// The normal catalogue sanity checks remain responsible for publisher-data quality.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {idShard,DOC_CHUNK} from "../mcp-server.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const cardsDir=path.join(root,"public","cards"),summaryPath=path.join(cardsDir,"summary.json");
const fullPath=path.join(root,".cache","full-check.jsonl");
const prod=process.env.REQUIRE_FULL_FILE_PROFILE==="1";
if(prod&&(!fs.existsSync(fullPath)||fs.statSync(fullPath).size===0))
  throw Error("Production version gate: full-file profile cache is missing or empty; restore full-check-state before deploying.");

if(!fs.existsSync(summaryPath)){
  if(prod||fs.existsSync(fullPath)||fs.existsSync(path.join(root,".cache","link-probe.jsonl")))
    throw Error("Dataset card summary missing while profiles exist.");
  console.log("[cards-gate] no profiles in checkout; skipped local bootstrap");
}else{
  const summary=JSON.parse(fs.readFileSync(summaryPath,"utf8")),problems=[];
  const fail=(id,msg)=>{if(problems.length<30)problems.push(id+": "+msg)};
  const idxDir=path.join(root,"public","mcp","i"),docDir=path.join(root,"public","mcp","d");
  const idCache=new Map(),docCache=new Map();
  const load=(folder,key,cache)=>{
    if(!cache.has(key))cache.set(key,JSON.parse(fs.readFileSync(path.join(folder,key+".json"),"utf8")));
    return cache.get(key);
  };
  let count=0,whole=0,checkedIndex=0;
  const seen=new Set();
  for(const file of fs.readdirSync(cardsDir).filter(f=>/^[a-f0-9]{2}\\.json$/.test(f))){
    const shard=JSON.parse(fs.readFileSync(path.join(cardsDir,file),"utf8"));
    for(const [id,card] of Object.entries(shard)){
      count++;
      if(seen.has(id))fail(id,"duplicate card identity");
      seen.add(id);
      if(card?.id!==id||idShard(id)!==file.slice(0,2))fail(id,"card identity/shard mismatch");
      if(card?.file?.rows_exact)whole++;
      // Guard against publishing an internally inconsistent measured observation.
      if(card?.file?.rows_exact&&(!card.file.sha256||!Number.isSafeInteger(card.file.rows)||card.file.rows<0))
        fail(id,"invalid whole-file fingerprint or row count");
      try{
        const pos=load(idxDir,idShard(id),idCache)[id];
        if(!Number.isSafeInteger(pos)||pos<0){fail(id,"missing from MCP id index");continue}
        const doc=load(docDir,String(Math.floor(pos/DOC_CHUNK)),docCache)[pos%DOC_CHUNK];
        if(doc?.id!==id)fail(id,"MCP document identity mismatch");
        else checkedIndex++;
      }catch(e){fail(id,"unreadable MCP index: "+e.message)}
    }
  }
  if(count!==summary.cards||whole!==summary.whole_file)
    fail("summary","card count or whole-file count differs from actual shards");
  if(prod){
    const min=Number(process.env.MIN_FULL_FILE_CARDS||1);
    if(!Number.isSafeInteger(min)||min<1)fail("configuration","invalid MIN_FULL_FILE_CARDS");
    else if(whole<min)fail("coverage","only "+whole+" whole-file cards, minimum "+min);
  }
  if(problems.length)throw Error("Card release gate failed:\\n"+problems.join("\\n"));
  console.log("[cards-gate] PASS",JSON.stringify({cards:count,whole_file:whole,index_verified:checkedIndex}));
}
