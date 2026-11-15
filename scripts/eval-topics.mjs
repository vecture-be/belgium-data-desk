// Topic accuracy against hand-labelled real records (eval-relevance/topics.json): which reader-facing topic a dataset belongs to.
//   node scripts/eval-topics.mjs [--min 0.8] [--misses]
// Each entry is a real catalogue record (title, publisher, declared EU themes and keywords) with the topic a person chose.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { topicOf } from "../public/dataset-taxonomy-v1.mjs";

const file=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../eval-relevance/topics.json");
const set=JSON.parse(fs.readFileSync(file,"utf8"));
const arg=process.argv.indexOf("--min"),min=arg>0?Number(process.argv[arg+1]):0;
const misses=[],confusion={};
for(const x of set){const got=topicOf(x);if(got!==x.expect){misses.push({...x,got});const k=x.expect+" -> "+got;confusion[k]=(confusion[k]||0)+1}}
const acc=(set.length-misses.length)/set.length;
if(process.argv.includes("--misses"))for(const m of misses)console.log("  "+m.expect.padEnd(12)+" got "+m.got.padEnd(12)+m.title.slice(0,70));
console.log("Topic accuracy: "+(set.length-misses.length)+"/"+set.length+" ("+Math.round(acc*1000)/10+" %); most common confusions: "+Object.entries(confusion).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>k+" ×"+v).join(", "));
if(acc<min){console.error("below the minimum of "+min);process.exit(1)}
