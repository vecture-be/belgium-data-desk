import { SOURCES as BASE } from "./data.mjs";
import { EXTRA_SOURCES, WORKFLOWS } from "./deep-data.mjs";
import { SOURCE_OVERRIDES, RELATIONSHIPS, QUIZ_OVERRIDES, QUIZ_EXTRA } from "./factcheck-v1.mjs";
import { QUIZ_MODES, CURATED_QUESTIONS, BADGES } from "./quiz-data.mjs";

const SOURCES=[...BASE,...EXTRA_SOURCES].map(s=>({...s,...(SOURCE_OVERRIDES[s.id]||{})}));
const CURATED=[...CURATED_QUESTIONS.map(q=>({...q,...(QUIZ_OVERRIDES[q.id]||{})})),...QUIZ_EXTRA];
const $=(s,r=document)=>r.querySelector(s),esc=(v="")=>String(v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])),by=id=>SOURCES.find(s=>s.id===id);
const progressKey="bdd-quiz-progress-v1";
const defaultProgress=()=>({xp:0,total:0,correct:0,bestStreak:0,mastery:{},seen:{},mistakes:[],runs:0});
let progress=(()=>{try{return Object.assign(defaultProgress(),JSON.parse(localStorage.getItem(progressKey)||"{}"))}catch{return defaultProgress()}})();
let run=null;

function save(){localStorage.setItem(progressKey,JSON.stringify(progress))}
function mastery(category){let m=progress.mastery[category]||{total:0,correct:0};return m.total?Math.round(m.correct/m.total*100):0}
function level(){return Math.floor(progress.xp/250)+1}
function levelXp(){return progress.xp%250}
function rand(seed){let x=Math.sin(seed)*10000;return x-Math.floor(x)}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return Math.abs(h)}
function shuffled(a,seed=Date.now()){return [...a].sort((x,y)=>rand(hash((x.id||x)+seed))-rand(hash((y.id||y)+seed)))}
function optionsFrom(list,correct,seed){
  let others=list.filter(x=>x!==correct),picked=shuffled(others,seed).slice(0,3),all=shuffled([correct,...picked],seed+17);
  return all.map((label,i)=>[String.fromCharCode(65+i),label]);
}
function dynamicQuestions(){
  let qs=[];
  const relationLabels=[...new Set(RELATIONSHIPS.map(r=>r.label))];
  RELATIONSHIPS.forEach((r,i)=>{
    if(r.recordLevel){
      const recordKeys=[...new Set(RELATIONSHIPS.map(x=>x.key))];
      let opts=optionsFrom(recordKeys,r.key,100+i),letter=opts.find(x=>x[1]===r.key)[0];
      qs.push({id:"relkey-"+i,kind:"single",category:"Joins",difficulty:3,prompt:"Which field is the audited record-level relationship between "+by(r.from).name+" and "+by(r.to).name+"?",options:opts,correct:[letter],explanation:r.key+" is the documented record-level identifier relationship here. "+r.caution,sourceId:r.from,why:"Only some graph edges preserve entity identity."});
    }else{
      let opts=optionsFrom(relationLabels,r.label,250+i),letter=opts.find(x=>x[1]===r.label)[0];
      qs.push({id:"reltype-"+i,kind:"single",category:"Semantics",difficulty:3,prompt:"How is the audited relationship between "+by(r.from).name+" and "+by(r.to).name+" classified?",options:opts,correct:[letter],explanation:r.label+": "+r.purpose+". "+r.caution,sourceId:r.from,why:"Relationship type determines whether an edge is a join, an alignment, an aggregation or only context."});
    }
  });
  WORKFLOWS.forEach((w,i)=>{
    let correct=by(w.steps[0][0]).name,names=SOURCES.map(s=>s.name),opts=optionsFrom(names,correct,700+i),letter=opts.find(x=>x[1]===correct)[0];
    qs.push({id:"wf-"+i,kind:"single",category:"Sources",difficulty:2,prompt:'In the workflow "'+w.title+'", which source is the documented first stop?',options:opts,correct:[letter],explanation:correct+" is the first source because the opening step is "+w.steps[0][1].toLowerCase()+".",sourceId:w.steps[0][0],why:"The first source establishes the starting fact; later relationships still need their own semantics checked."});
  });
  return qs;
}
const ALL=[...CURATED,...dynamicQuestions()];
const CATS=["Sources","Joins","Reuse","Geography","Pipelines","Semantics"];

function unlockedBadges(){
  return BADGES.filter(b=>b.totalCorrect?progress.correct>=b.totalCorrect:((progress.mastery[b.category]?.total||0)>=b.min&&mastery(b.category)>=b.threshold));
}
function lobby(){
  run=null;
  let acc=progress.total?Math.round(progress.correct/progress.total*100):0,badges=unlockedBadges(),mistakes=progress.mistakes.length;
  $("#quizApp").innerHTML='<div class="quiz-dashboard"><div class="quiz-level"><span>LEVEL '+level()+'</span><b>'+progress.xp+' XP</b><div class="xp-track"><i style="width:'+(levelXp()/250*100)+'%"></i></div><small>'+(250-levelXp())+' XP to next level</small></div><div class="quiz-stat"><b>'+progress.correct+'</b><span>correct</span></div><div class="quiz-stat"><b>'+acc+'%</b><span>accuracy</span></div><div class="quiz-stat"><b>'+progress.bestStreak+'</b><span>best streak</span></div></div>'+
  '<div class="quiz-two-col"><section><div class="quiz-section-title"><h2>Choose a quiz</h2></div><div class="mode-grid">'+QUIZ_MODES.map(m=>{let locked=m.id==="boss"&&progress.total<10,disabled=m.id==="review"&&!mistakes;return'<button class="mode-card '+m.tone+'" data-mode="'+m.id+'" '+(locked||disabled?"disabled":"")+'><span class="mode-icon">'+m.icon+'</span><b>'+esc(m.name)+'</b><small>'+esc(m.subtitle)+'</small><em>'+(locked?"Unlock after 10 answers":disabled?"No mistakes to review":"Start →")+'</em></button>'}).join("")+'</div></section>'+
  '<aside class="mastery-panel"><div class="quiz-section-title"><h2>Results by topic</h2></div><div class="mastery-list">'+CATS.map(c=>{let m=progress.mastery[c]||{total:0,correct:0},pct=mastery(c);return'<div class="mastery-row"><div><b>'+c+'</b><small>'+m.correct+'/'+m.total+'</small></div><div class="mastery-track"><i style="width:'+pct+'%"></i></div><strong>'+pct+'%</strong></div>'}).join("")+'</div><div class="badge-row">'+BADGES.map(b=>'<div class="quiz-badge '+(badges.some(x=>x.id===b.id)?"earned":"")+'" title="'+esc(b.description)+'"><span>'+b.mark+'</span><b>'+esc(b.name)+'</b></div>').join("")+'</div></aside></div>'+
  '<div class="quiz-footer-note">Quick Drill prioritises topics you have answered less accurately, and each answer includes an explanation.</div>';
}

function eligible(mode){
  if(mode==="scenario")return CURATED.filter(q=>q.difficulty>=2);
  if(mode==="joins")return ALL.filter(q=>q.category==="Joins"||q.id.startsWith("id-"));
  if(mode==="hard")return ALL.filter(q=>q.difficulty===3);
  if(mode==="mistakes"){let ids=new Set(progress.mistakes);return ALL.filter(q=>ids.has(q.id))}
  return ALL;
}
function pickQuestions(mode,count){
  let pool=eligible(mode),seed=mode==="daily"?hash(new Date().toISOString().slice(0,10)):Date.now();
  if(mode==="daily")return shuffled(pool,seed).slice(0,count);
  if(mode==="mistakes")return shuffled(pool,seed).slice(0,Math.min(count,pool.length));
  // adaptive weight: repeat each low-mastery category question slightly more often, then de-dupe after sort
  let sorted=[...pool].sort((a,b)=>{
    let ma=mastery(a.category),mb=mastery(b.category),ua=progress.seen[a.id]||0,ub=progress.seen[b.id]||0;
    return (ma+ua*5+rand(hash(a.id+seed))*12)-(mb+ub*5+rand(hash(b.id+seed))*12);
  });
  return sorted.slice(0,Math.min(count,sorted.length));
}
function start(modeId){
  let m=QUIZ_MODES.find(x=>x.id===modeId);if(!m)return;
  let qs=pickQuestions(m.filter,m.count);if(!qs.length)return lobby();
  run={mode:m,index:0,questions:qs,selected:new Set(),answered:false,score:0,xp:0,streak:0,maxStreak:0,lives:m.id==="boss"?3:null};
  renderQuestion();
}
function optionMarkup(q){
  return q.options.map((o,i)=>'<button class="quiz-option" data-answer="'+o[0]+'"><span>'+o[0]+'</span><b>'+esc(o[1])+'</b><kbd>'+(i+1)+'</kbd></button>').join("");
}
function renderQuestion(){
  let q=run.questions[run.index],multi=q.kind==="multi";
  $("#quizApp").innerHTML='<div class="game-shell"><header class="game-head"><button class="quiz-quit">← Exit</button><div class="game-mode"><span>'+esc(run.mode.name)+'</span><b>'+(run.index+1)+' / '+run.questions.length+'</b></div><div class="game-live"><span>XP +'+run.xp+'</span><span>🔥 '+run.streak+'</span>'+(run.lives!==null?'<span>♥ '+run.lives+'</span>':"")+'</div></header><div class="game-progress"><i style="width:'+(run.index/run.questions.length*100)+'%"></i></div><main class="question-card"><div class="question-meta"><span>'+esc(q.category)+'</span><span>'+("●".repeat(q.difficulty)+"○".repeat(3-q.difficulty))+'</span></div><h2>'+esc(q.prompt)+'</h2>'+(multi?'<p class="multi-note">Select every correct answer, then submit.</p>':"")+'<div class="quiz-options">'+optionMarkup(q)+'</div><div class="quiz-actions"><button class="hint-btn">Need a nudge?</button>'+(multi?'<button class="primary quiz-submit" disabled>Submit answer</button>':"")+'</div><div class="hint-box" hidden>'+esc(hintFor(q))+'</div><div class="answer-feedback" hidden></div></main></div>';
}
function hintFor(q){
  const hints={
    Sources:"Think about the role of the system: discovery, canonical registry, domain authority or technical feed.",
    Joins:"Ask which identifier survives across both sides of the relationship.",
    Reuse:"Separate 'a human can view it' from 'a pipeline may reuse it'.",
    Geography:"Check both identity and coordinate/boundary context.",
    Pipelines:"Think about reproducibility, machine access and metadata that future runs need.",
    Semantics:"A technically possible join does not automatically make two concepts equivalent."
  };return hints[q.category]||"Look for the answer that preserves provenance and canonical identity.";
}
function choose(value){
  if(!run||run.answered)return;let q=run.questions[run.index];
  if(q.kind==="multi"){
    run.selected.has(value)?run.selected.delete(value):run.selected.add(value);
    document.querySelectorAll(".quiz-option").forEach(x=>x.classList.toggle("selected",run.selected.has(x.dataset.answer)));
    $(".quiz-submit").disabled=!run.selected.size;
  }else{run.selected=new Set([value]);submit()}
}
function submit(){
  if(!run||run.answered)return;let q=run.questions[run.index],chosen=[...run.selected].sort(),correct=[...q.correct].sort(),ok=chosen.length===correct.length&&chosen.every((x,i)=>x===correct[i]);run.answered=true;
  progress.total++;progress.seen[q.id]=(progress.seen[q.id]||0)+1;progress.mastery[q.category]=progress.mastery[q.category]||{total:0,correct:0};progress.mastery[q.category].total++;
  let gained=0;
  if(ok){
    progress.correct++;progress.mastery[q.category].correct++;run.score++;run.streak++;run.maxStreak=Math.max(run.maxStreak,run.streak);progress.bestStreak=Math.max(progress.bestStreak,run.streak);
    gained=10+q.difficulty*5+Math.min(15,(run.streak-1)*3)+(q.kind==="multi"?5:0);run.xp+=gained;progress.xp+=gained;progress.mistakes=progress.mistakes.filter(id=>id!==q.id);
  }else{
    run.streak=0;if(!progress.mistakes.includes(q.id))progress.mistakes.unshift(q.id);progress.mistakes=progress.mistakes.slice(0,30);
    if(run.lives!==null)run.lives--;
  }
  save();
  document.dispatchEvent(new CustomEvent("bdd:quiz-result",{detail:{correct:ok,category:q.category,streak:run.streak,xp:gained}}));
  document.querySelectorAll(".quiz-option").forEach(x=>{let v=x.dataset.answer;if(q.correct.includes(v))x.classList.add("correct");else if(run.selected.has(v))x.classList.add("wrong");x.disabled=true});
  let fb=$(".answer-feedback");fb.hidden=false;fb.innerHTML='<div class="feedback-top '+(ok?"good":"bad")+'"><b>'+(ok?"Correct · +"+gained+" XP":"Incorrect")+'</b><span>'+esc(q.category)+' mastery '+mastery(q.category)+'%</span></div><p>'+esc(q.explanation)+'</p><div class="why-box"><b>Practical implication</b><span>'+esc(q.why||"This distinction prevents fragile integrations.")+'</span></div>'+(q.sourceId?'<button data-detail="'+q.sourceId+'" class="source-peek">Open '+esc(by(q.sourceId)?.name||"source")+' ↗</button>':"")+'<button class="primary next-question">'+(run.index===run.questions.length-1||run.lives===0?"Finish run":"Next question →")+"</button>";
}
function next(){
  if(!run||!run.answered)return;
  if(run.lives===0||run.index===run.questions.length-1)return finish();
  run.index++;run.selected.clear();run.answered=false;renderQuestion();
}
function finish(){
  progress.runs++;save();let pct=Math.round(run.score/run.questions.length*100),bossFail=run.lives===0,grade=pct>=90?"Architect":pct>=75?"Pathfinder":pct>=55?"Operator":"Apprentice";
  $("#quizApp").innerHTML='<div class="run-summary"><span>'+(bossFail?"BOSS RUN ENDED":"RUN COMPLETE")+'</span><h2>'+grade+'</h2><div class="summary-score"><strong>'+run.score+'/'+run.questions.length+'</strong><div><b>'+pct+'% accuracy</b><small>+'+run.xp+' XP · max streak '+run.maxStreak+'</small></div></div><div class="summary-bars">'+CATS.map(c=>'<div><span>'+c+'</span><i><b style="width:'+mastery(c)+'%"></b></i><strong>'+mastery(c)+'%</strong></div>').join("")+'</div><div class="summary-actions"><button class="primary play-again" data-mode="'+run.mode.id+'">Run again</button><button class="back-lobby">Back to quiz modes</button></div></div>';
}

function bind(){
  document.addEventListener("click",e=>{
    let m=e.target.closest("[data-mode]");if(m)start(m.dataset.mode);
    let a=e.target.closest("[data-answer]");if(a)choose(a.dataset.answer);
    if(e.target.closest(".quiz-submit"))submit();
    let n=e.target.closest(".next-question");if(n)next();
    let q=e.target.closest(".quiz-quit,.back-lobby");if(q)lobby();
    let r=e.target.closest(".play-again");if(r)start(r.dataset.mode);
    let h=e.target.closest(".hint-btn");if(h){let box=$(".hint-box");box.hidden=!box.hidden;h.textContent=box.hidden?"Need a nudge?":"Hide hint"}
  });
  document.addEventListener("keydown",e=>{
    if(!run||run.answered)return;
    if(["1","2","3","4"].includes(e.key)){let q=run.questions[run.index],o=q.options[Number(e.key)-1];if(o)choose(o[0])}
    if(e.key==="Enter"&&run.questions[run.index].kind==="multi"&&run.selected.size)submit();
  });
}
bind();lobby();