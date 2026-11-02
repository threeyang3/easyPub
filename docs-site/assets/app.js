const menu=document.querySelector("#menu");
const sidebar=document.querySelector("#sidebar");
menu?.addEventListener("click",()=>{const open=sidebar?.classList.toggle("open");menu.setAttribute("aria-expanded",String(!!open));});
document.querySelectorAll("#sidebar nav a").forEach(a=>a.addEventListener("click",()=>sidebar?.classList.remove("open")));
const search=document.querySelector("#search");
search?.addEventListener("input",()=>{
  const q=search.value.trim().toLocaleLowerCase();
  const candidates=document.querySelectorAll("main section, .docs-main h2, .docs-main h3, .docs-main p, .docs-main li, .docs-main .guide-card");
  candidates.forEach(el=>{const hay=(el.innerText||"").toLocaleLowerCase()+" "+(el.dataset.search||"").toLocaleLowerCase();el.hidden=!!q&&!hay.includes(q);});
});
const navLinks=[...document.querySelectorAll("#sidebar nav a")];
const hashLinks=navLinks.filter(a=>a.getAttribute("href")?.startsWith("#"));
const sections=hashLinks.map(a=>document.getElementById(a.getAttribute("href").slice(1))).filter(Boolean);
if("IntersectionObserver"in window&&sections.length){
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(entry.isIntersecting)hashLinks.forEach(a=>a.classList.toggle("active",a.hash==="#"+entry.target.id));
  }),{rootMargin:"-15% 0px -70% 0px"});
  sections.forEach(section=>observer.observe(section));
}
navLinks.forEach(a=>{
  try{if(new URL(a.href,location.href).pathname===location.pathname)a.classList.add("active");}catch{}
});
document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();search?.focus();}});
