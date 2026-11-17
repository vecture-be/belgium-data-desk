// Main menu groups: "Publishers" covers the list and the connections map, "Guides" covers workflows, compare and the quiz.
// The app highlights the tab whose data-view matches exactly; this also highlights the group's main tab.
const sync=()=>{
  const view=document.querySelector("main .view:not([hidden])")?.dataset.view;if(!view)return;
  for(const t of document.querySelectorAll(".mainnav .nav-tab[data-views]"))t.classList.toggle("active",t.dataset.views.split(" ").includes(view));
};
document.addEventListener("click",e=>{if(e.target.closest(".nav-tab,[data-view],button"))requestAnimationFrame(sync)});
new MutationObserver(sync).observe(document.querySelector("main"),{attributes:true,subtree:true,attributeFilter:["hidden"]});
sync();
