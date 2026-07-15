const DATA_URL = "data/literary-taxonomy.json";
const MODE = document.body.dataset.atlas || "genres";
const COLORS = ["#ef6a5b", "#6888f6", "#e4b651", "#7d69df", "#4fc7b5", "#85bd5a", "#d76ead", "#56a7dc"];
const VOLUMES = ["必修上", "必修下", "選必上", "選必中", "選必下"];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const FOV = 1400;
const BASE_ZOOM = .56;
const MIN_ZOOM = .32;
const ERAS = [
  { label:"先秦", year:-500 }, { label:"秦漢", year:0 }, { label:"魏晉南北朝", year:400 }, { label:"隋唐", year:750 },
  { label:"兩宋", year:1100 }, { label:"元明清", year:1550 }, { label:"近現代", year:1915 }, { label:"當代", year:2000 },
];
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
const normal = (value) => String(value || "").toLowerCase().replace(/\s+/g, "").replace(/[，。、·《》“”‘’]/g, "");

const data = await fetch(DATA_URL).then((response) => response.json());
const lessonById = Object.fromEntries(data.lessons.map((lesson) => [lesson.id, lesson]));
const genreById = Object.fromEntries(data.genres.map((genre) => [genre.id, genre]));
const canvas = $("#atlas-canvas");
const ctx = canvas.getContext("2d");
const search = $("#atlas-search");
const filters = $("#atlas-filters");
const detail = $("#atlas-detail");
const tooltip = $("#atlas-tooltip");
$("#stat-primary").textContent = MODE === "genres" ? data.stats.genres : data.stats.sourceBooks;

let width = 0;
let height = 0;
let dpr = 1;
let rotY = -.42;
let tilt = -.12;
let targetRotY = rotY;
let targetTilt = tilt;
let zoom = BASE_ZOOM;
let targetZoom = BASE_ZOOM;
let panX = 0;
let panY = 0;
let selected = null;
let hover = null;
let query = "";
let activeFilter = "全部";
let dragging = false;
let moved = 0;
let lastX = 0;
let lastY = 0;
let born = reduceMotion ? 1 : 0;
let hoverX = 0;
let hoverY = 0;
let lastTime = performance.now();
let meteorClock = 0;
const nodes = [];
const edges = [];
const eraAnchors = [];
const stars = [];
const meteors = [];
const pointers = new Map();
let pinchDistance = 0;
const sprites = new Map();

function depthOf(genre) {
  let depth = 0;
  let current = genre;
  while (current?.parent) { depth += 1; current = genreById[current.parent]; }
  return depth;
}

function topAncestor(id) {
  let current = genreById[id];
  while (current?.parent && current.parent !== "root") current = genreById[current.parent];
  return current?.id || id;
}

function spiralPosition(rank, radius = 620) {
  const angle = rank * 2.45 * Math.PI * 2 + .6;
  const distance = (.14 + rank * .86) * radius;
  return { x:Math.cos(angle)*distance, z:Math.sin(angle)*distance, angle, distance };
}

function yearRank(year, minYear, maxYear) {
  return Math.max(0, Math.min(1, (Number(year) - minYear) / Math.max(1, maxYear - minYear)));
}

function buildEraAnchors(minYear, maxYear) {
  eraAnchors.length = 0;
  ERAS.filter((era) => era.year >= minYear && era.year <= maxYear).forEach((era, index) => {
    const point = spiralPosition(yearRank(era.year, minYear, maxYear), 650);
    eraAnchors.push({ ...point, y:-108 + (index % 2) * 28, label:era.label, year:era.year, r:2 });
  });
}

function buildGenreGraph() {
  const visible = [...data.genres];
  const roots = ["poetry", "prose", "fiction", "drama", "journalism", "learning"];
  const branches = new Map();
  roots.forEach((id, index) => branches.set(id, index));
  const chronological = visible.filter((genre) => genre.id !== "root").sort((a,b)=>(a.year||1900)-(b.year||1900)||depthOf(a)-depthOf(b)||a.label.localeCompare(b.label,"zh"));
  const minYear = Math.min(...chronological.map((genre) => genre.year || 1900));
  const maxYear = Math.max(...chronological.map((genre) => genre.year || 1900));
  buildEraAnchors(minYear, maxYear);
  visible.forEach((genre, index) => {
    const depth = depthOf(genre);
    const top = topAncestor(genre.id);
    const branchIndex = branches.has(top) ? branches.get(top) : index % roots.length;
    const rankIndex = Math.max(0, chronological.findIndex((item) => item.id === genre.id));
    const rank = genre.id === "root" ? 0 : rankIndex / Math.max(1, chronological.length - 1);
    const point = genre.id === "root" ? { x:0,z:0 } : spiralPosition(rank);
    const lane = (branchIndex - (roots.length - 1) / 2) * 34;
    nodes.push({
      id: genre.id, type: "genre", label: genre.label,
      x: point.x,
      y: genre.id === "root" ? 0 : lane + (depth - 1.5) * 13,
      z: point.z,
      r: genre.id === "root" ? 30 : 7 + Math.sqrt(genre.count) * 2.5,
      color: COLORS[branchIndex % COLORS.length], count: genre.count, source: genre,
      depth, order: index / Math.max(1, visible.length - 1),
    });
  });
  const map = Object.fromEntries(nodes.map((node) => [node.id, node]));
  nodes.forEach((node) => { const parent = map[node.source.parent]; if (parent) edges.push({ from: parent, to: node }); });
}

function buildBookGraph() {
  const root = { id:"books-root", type:"root", label:"五冊教材", x:0, y:0, z:0, r:31, color:"#f0d68c", count:data.stats.sourceBooks, source:{}, order:0 };
  nodes.push(root);
  const volumeNodes = VOLUMES.map((label, index) => {
    const angle = index / VOLUMES.length * Math.PI * 2 - Math.PI / 2;
    return { id:`volume:${label}`, type:"volume", label, x:Math.cos(angle)*185, y:(index-2)*34, z:Math.sin(angle)*185, r:18, color:COLORS[index], count:data.lessons.filter((lesson) => lesson.blockTitle === label).length, source:{label}, order:.02 + index*.01 };
  });
  nodes.push(...volumeNodes);
  volumeNodes.forEach((node) => edges.push({ from:root, to:node }));
  const sortedBooks = [...data.books].sort((a,b)=>(a.year||1900)-(b.year||1900)||a.title.localeCompare(b.title,"zh"));
  const minYear = Math.min(...sortedBooks.map((book) => book.year || 1900));
  const maxYear = Math.max(...sortedBooks.map((book) => book.year || 1900));
  buildEraAnchors(minYear, maxYear);
  sortedBooks.forEach((book, index) => {
    const rank = index / Math.max(1, sortedBooks.length - 1);
    const point = spiralPosition(rank, 660);
    const lessonVolumes = [...new Set(book.lessonIds.map((id) => lessonById[id]?.blockTitle).filter(Boolean))];
    const primaryIndex = Math.max(0, VOLUMES.indexOf(lessonVolumes[0]));
    const node = { id:`book:${book.title}`, type:"book", label:book.title, x:point.x, y:(primaryIndex-2)*31, z:point.z, r:6+Math.sqrt(book.lessonIds.length)*3, color:COLORS[primaryIndex], count:book.lessonIds.length, volumes:lessonVolumes, source:book, order:.1 + index/sortedBooks.length*.9 };
    nodes.push(node);
    lessonVolumes.forEach((volume) => { const anchor = volumeNodes[VOLUMES.indexOf(volume)]; if (anchor) edges.push({ from:anchor, to:node }); });
  });
  const bookNodes = Object.fromEntries(nodes.filter((node) => node.type === "book").map((node) => [node.label,node]));
  nodes.filter((node) => node.type === "book").forEach((node) => (node.source.relatedTitles || []).forEach((title) => {
    const target = bookNodes[title];
    if (target && node.label.localeCompare(target.label,"zh") < 0) edges.push({ from:node, to:target, relation:true });
  }));
}

if (MODE === "genres") buildGenreGraph(); else buildBookGraph();
nodes.forEach((node, index) => {
  node.phase = (index * 137.5) % (Math.PI * 2);
  node.tw = .6 + ((index * 31) % 40) / 100;
  node.alpha = 0;
});

function buildSprites() {
  [...new Set(nodes.map((node) => node.color))].forEach((color) => {
    const size = 64;
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const brush = sprite.getContext("2d");
    const glow = brush.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    glow.addColorStop(0, `${color}e6`);
    glow.addColorStop(.25, `${color}58`);
    glow.addColorStop(1, `${color}00`);
    brush.fillStyle = glow;
    brush.fillRect(0, 0, size, size);
    sprites.set(color, sprite);
  });
}

buildSprites();
filters.innerHTML = ["全部", ...VOLUMES].map((label) => `<button type="button" data-filter="${label}" class="${label === "全部" ? "active" : ""}">${label}</button>`).join("");

function lessonsForNode(node) {
  if (node.type === "book") return node.source.lessonIds.map((id) => lessonById[id]).filter(Boolean);
  if (node.type === "volume") return data.lessons.filter((lesson) => lesson.blockTitle === node.label);
  if (node.type === "genre") {
    const descendants = new Set([node.id]);
    let changed = true;
    while (changed) { changed = false; data.genres.forEach((genre) => { if (genre.parent && descendants.has(genre.parent) && !descendants.has(genre.id)) { descendants.add(genre.id); changed = true; } }); }
    return data.lessons.filter((lesson) => lesson.genres.some((id) => descendants.has(id)));
  }
  return data.lessons;
}

function nodeMatches(node) {
  const lessons = lessonsForNode(node);
  if (activeFilter !== "全部" && !lessons.some((lesson) => lesson.blockTitle === activeFilter)) return false;
  if (!query) return true;
  return normal([node.label, node.source.description, node.source.detail, node.source.era, ...lessons.flatMap((lesson) => [lesson.title, ...(lesson.authors || []).map((author) => author.name)])].join(" ")).includes(normal(query));
}

function resize() {
  width = innerWidth; height = innerHeight; dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
  stars.length = 0;
  const count = Math.round(Math.min(420, Math.max(140, width*height/5200)));
  for (let i=0;i<count;i+=1) stars.push({ x:Math.random()*width, y:Math.random()*height, z:Math.random(), a:.15+Math.random()*.7, r:.35+Math.random()*1.25, phase:Math.random()*Math.PI*2 });
}

function project(node) {
  const cy=Math.cos(rotY), sy=Math.sin(rotY), ct=Math.cos(tilt), st=Math.sin(tilt);
  const x=node.x*cy+node.z*sy;
  const z=-node.x*sy+node.z*cy;
  const y2=node.y*ct-z*st;
  const z2=node.y*st+z*ct;
  const scale=Math.min(width/1120,height/900)*zoom;
  const perspective=Math.max(.08,Math.min(4,FOV/Math.max(FOV*.12,FOV+z2*scale*1.6)));
  return {
    x:width/2+panX+x*scale*perspective,
    y:height*.56+panY+y2*scale*perspective,
    r:node.r*perspective*Math.min(1.5,Math.max(.68,zoom)),
    depth:z2,
    perspective,
  };
}

function connected(node) { return new Set(edges.flatMap((edge) => edge.from===node?[edge.to]:edge.to===node?[edge.from]:[])); }

function drawStars(time) {
  stars.forEach((star) => {
    const twinkle=.45+.55*Math.sin(time*.0007+star.phase);
    ctx.globalAlpha=star.a*twinkle;
    ctx.fillStyle=star.z>.72?"#f5d88a":"#c7d4ff";
    ctx.beginPath(); ctx.arc(star.x,star.y,star.r*(.7+star.z),0,Math.PI*2); ctx.fill();
  });
  ctx.globalAlpha=1;
  meteors.forEach((meteor) => {
    const gradient=ctx.createLinearGradient(meteor.x,meteor.y,meteor.x-meteor.vx*.09,meteor.y-meteor.vy*.09);
    gradient.addColorStop(0,"rgba(255,242,195,.88)"); gradient.addColorStop(1,"rgba(255,255,255,0)");
    ctx.strokeStyle=gradient; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(meteor.x,meteor.y); ctx.lineTo(meteor.x-meteor.vx*.09,meteor.y-meteor.vy*.09); ctx.stroke();
  });
}

function draw(time) {
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height); drawStars(time);
  const t=Math.min(1,born);
  const related=selected?connected(selected):new Set();
  const projected=new Map(nodes.map((node)=>[node,project(node)]));
  eraAnchors.forEach((anchor) => {
    const p=project(anchor);
    ctx.globalAlpha=.45;
    ctx.strokeStyle="rgba(231,188,88,.38)";
    ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle="rgba(231,210,157,.82)";
    ctx.font=`650 11px ${getComputedStyle(document.documentElement).getPropertyValue("--serif")}`;
    ctx.textAlign="center";
    ctx.fillText(anchor.label,p.x,p.y-9);
  });
  ctx.globalAlpha=1;
  edges.forEach((edge) => {
    if ((edge.to.order||0)>t) return;
    const a=projected.get(edge.from), b=projected.get(edge.to);
    const focused=selected&&(edge.from===selected||edge.to===selected);
    const hovered=hover&&(edge.from===hover||edge.to===hover);
    const fade=Math.min(edge.from.alpha||0,edge.to.alpha||0);
    const depth=(a.perspective+b.perspective)/2;
    const alpha=(focused?.56:hovered?.34:selected?.025:(edge.relation?.075:.11))*fade*(.35+.65*depth*depth);
    if(alpha<.006)return;
    ctx.strokeStyle=focused?`rgba(232,197,121,${alpha})`:`rgba(185,198,238,${alpha})`;
    ctx.lineWidth=focused?1.45:(edge.relation?.62:.82); ctx.setLineDash(edge.relation?[3,5]:[]); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();ctx.setLineDash([]);
  });
  ctx.globalCompositeOperation="lighter";
  [...nodes].sort((a,b)=>projected.get(a).perspective-projected.get(b).perspective).forEach((node) => {
    if ((node.order||0)>t) return;
    const p=projected.get(node); const match=nodeMatches(node); const active=node===selected||node===hover; const lineage=!selected||node===selected||related.has(node);
    node.alpha+=(((match&&lineage)?1:.12)-node.alpha)*.08;
    const twinkle=reduceMotion?1:.82+.18*Math.sin(time*.0011*node.tw+node.phase*3);
    const alpha=node.alpha*twinkle*Math.min(1,born*1.18)*(.5+.5*Math.min(1,p.perspective*p.perspective));
    const radius=p.r*(active?1.5:1)*(.5+.5*Math.min(1,born*1.18));
    const glowR=radius*(active?9:5.5);
    ctx.globalAlpha=alpha*(active?.94:.58);
    const sprite=sprites.get(node.color);
    if(sprite)ctx.drawImage(sprite,p.x-glowR,p.y-glowR,glowR*2,glowR*2);
    ctx.globalAlpha=alpha;
    ctx.fillStyle=active?"#fdf6e3":node.color;
    ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();
  });
  ctx.globalCompositeOperation="source-over";
  [selected,hover].forEach((node)=>{if(!node)return;const p=projected.get(node);const r=p.r*1.5;ctx.globalAlpha=1;ctx.strokeStyle=node===selected?"rgba(240,230,203,.95)":"rgba(240,230,203,.5)";ctx.lineWidth=node===selected?1.6:1.1;ctx.beginPath();ctx.arc(p.x,p.y,r+4,0,Math.PI*2);ctx.stroke();if(node===selected){ctx.strokeStyle="rgba(217,180,92,.4)";ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,r+8.5,0,Math.PI*2);ctx.stroke();}});
  const labels=[];
  nodes.forEach((node)=>{const p=projected.get(node);const active=node===selected||node===hover;const match=nodeMatches(node);const major=node.type==="root"||node.type==="volume"||node.depth<=1||node.count>=10;const eligible=active||major||(query&&match)||(zoom>1.55&&node.count>=3)||(zoom>2.15);if(!eligible||(!match&&!active))return;labels.push({node,p,active,priority:active?1e6:(major?1000:100)+p.perspective});});
  labels.sort((a,b)=>b.priority-a.priority);
  const placed=[];ctx.textAlign="center";
  labels.forEach(({node,p,active})=>{const alpha=Math.min(1,node.alpha)*(active?1:.78);if(alpha<.12)return;const size=(active?14:12.5)*Math.max(.85,Math.min(1.15,p.perspective));ctx.font=`${active?650:520} ${size}px ${getComputedStyle(document.documentElement).getPropertyValue("--serif")}`;const textWidth=ctx.measureText(node.label).width;const cy=p.y-p.r-8;const rect={x:p.x-textWidth/2-3,y:cy-size,w:textWidth+6,h:size+5};if(!active&&placed.some((other)=>!(rect.x>other.x+other.w||rect.x+rect.w<other.x||rect.y>other.y+other.h||rect.y+rect.h<other.y)))return;placed.push(rect);ctx.globalAlpha=alpha;ctx.fillStyle=active?"#fff":"rgba(230,236,255,.9)";ctx.shadowColor="rgba(3,5,12,.95)";ctx.shadowBlur=6;ctx.fillText(node.label,p.x,cy);ctx.shadowBlur=0;});
  ctx.globalAlpha=1;
}

function animate(time) {
  const dt=Math.min(32,time-lastTime); lastTime=time;
  if (!reduceMotion && !dragging && !hover && !selected) targetRotY+=dt*.00010;
  rotY+=(targetRotY-rotY)*.075; tilt+=(targetTilt-tilt)*.075; zoom+=(targetZoom-zoom)*.09;
  if (!reduceMotion && born<1.02) born+=.007;
  meteorClock+=dt;
  if (!reduceMotion && meteorClock>1900+Math.random()*3300) { meteorClock=0; meteors.push({x:width*(.35+Math.random()*.65),y:-30,vx:420+Math.random()*240,vy:540+Math.random()*260,life:1}); }
  meteors.forEach((meteor)=>{ meteor.x-=meteor.vx*dt/1000; meteor.y+=meteor.vy*dt/1000; meteor.life-=dt/1150; });
  for(let i=meteors.length-1;i>=0;i-=1) if(meteors[i].life<=0||meteors[i].y>height+100) meteors.splice(i,1);
  draw(time); requestAnimationFrame(animate);
}

function pick(x,y) {
  let result=null, best=30*30;
  nodes.forEach((node)=>{ if(!nodeMatches(node))return; const p=project(node); const dx=p.x-x,dy=p.y-y,d=dx*dx+dy*dy,r=Math.max(13,p.r+8); if(d<=r*r&&d<best){best=d;result=node;} });
  return result;
}

function showTooltip(node,x,y) {
  if(!node){ tooltip.hidden=true; return; }
  tooltip.innerHTML=`<strong>${esc(node.label)}</strong><span>${esc(node.source.era||"")} · ${node.count||lessonsForNode(node).length} 個關聯篇目</span>`;
  tooltip.style.left=`${Math.min(width-180,x+16)}px`; tooltip.style.top=`${Math.min(height-70,y+16)}px`; tooltip.hidden=false;
}

function openDetail(node) {
  selected=node;
  const candidate=Math.atan2(-node.x,node.z||1);
  let best=candidate,bestDepth=Infinity;
  [candidate,candidate+Math.PI].forEach((rotation)=>{const z=-node.x*Math.sin(rotation)+node.z*Math.cos(rotation);if(z<bestDepth){bestDepth=z;best=rotation;}});
  targetRotY=best;targetTilt=-.12;targetZoom=Math.max(targetZoom,1.18);panX=0;panY=0;
  const lessons=lessonsForNode(node).filter((lesson)=>activeFilter==="全部"||lesson.blockTitle===activeFilter);
  $("#detail-kicker").textContent=node.type==="book"?`書目 · ${node.source.era || "跨時代"}`:node.type==="volume"?"教材冊別":`文體 · ${node.source.era || "跨時代"} · ${lessons.length} 篇`;
  $("#detail-title").textContent=node.label;
  const relationNames=(node.source.relatedIds||[]).map((id)=>genreById[id]?.label).filter(Boolean);
  const relatedBooks=node.source.relatedTitles||[];
  const authorities=node.source.authorityLinks||[];
  const description=node.source.detail||node.source.description||`${node.label}共收錄 ${lessons.length} 個有效目錄項。`;
  $("#detail-description").innerHTML=`<p>${esc(description)}</p>${relationNames.length||relatedBooks.length?`<div class="detail-relations"><span>關係</span>${[...relationNames,...relatedBooks].slice(0,8).map((label)=>`<b>${esc(label)}</b>`).join("")}</div>`:""}${authorities.length?`<div class="detail-authorities"><span>可信連結</span>${authorities.map((link)=>`<a href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(link.label)} ↗</a>`).join("")}</div>`:""}`;
  $("#detail-lessons").innerHTML=lessons.length?lessons.slice(0,80).map((lesson)=>`<a href="./#${esc(lesson.id)}" target="_blank" rel="noopener noreferrer"><span>${esc(lesson.blockTitle)}</span><b>${esc(lesson.title)}</b><small>p${lesson.page||"—"}</small></a>`).join(""):`<p class="detail-empty">這個篩選下沒有篇目。</p>`;
  detail.hidden=false;
}

function resetView(){ panX=0;panY=0;targetZoom=BASE_ZOOM;targetRotY=-.42;targetTilt=-.12;selected=null;hover=null;detail.hidden=true;tooltip.hidden=true; }

function applyInitialLocation(){ const initial=new URLSearchParams(location.search).get("q")?.trim()||""; if(initial){query=initial;search.value=initial;const match=nodes.find((node)=>normal(node.label)===normal(initial))||nodes.find((node)=>normal(node.label).includes(normal(initial)));if(match)openDetail(match);} const hash=decodeURIComponent(location.hash.slice(1));if(hash&&MODE==="genres"){const match=nodes.find((node)=>node.id===hash);if(match)openDetail(match);} }

canvas.addEventListener("pointerdown",(event)=>{canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});dragging=true;moved=0;lastX=event.clientX;lastY=event.clientY;canvas.classList.add("dragging");});
canvas.addEventListener("pointermove",(event)=>{hoverX=event.clientX;hoverY=event.clientY;if(pointers.has(event.pointerId))pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(dragging){if(pointers.size===2){const [a,b]=[...pointers.values()];const distance=Math.hypot(a.x-b.x,a.y-b.y);if(pinchDistance)targetZoom=Math.max(MIN_ZOOM,Math.min(2.5,targetZoom*distance/pinchDistance));pinchDistance=distance;}else{const dx=event.clientX-lastX,dy=event.clientY-lastY;moved+=Math.abs(dx)+Math.abs(dy);if(event.shiftKey||event.button===2){panX+=dx;panY+=dy;}else{targetRotY+=dx*.006;targetTilt=Math.max(-1.05,Math.min(1.05,targetTilt+dy*.004));}lastX=event.clientX;lastY=event.clientY;}return;}hover=pick(event.clientX,event.clientY);showTooltip(hover,event.clientX,event.clientY);canvas.style.cursor=hover?"pointer":"grab";});
function pointerEnd(event){pointers.delete(event.pointerId);pinchDistance=0;if(!pointers.size){dragging=false;canvas.classList.remove("dragging");if(moved<8){const node=pick(event.clientX,event.clientY);if(node)openDetail(node);}}}
canvas.addEventListener("pointerup",pointerEnd);canvas.addEventListener("pointercancel",pointerEnd);canvas.addEventListener("pointerleave",()=>{if(!dragging){hover=null;tooltip.hidden=true;}});
canvas.addEventListener("wheel",(event)=>{event.preventDefault();targetZoom=Math.max(MIN_ZOOM,Math.min(2.5,targetZoom*Math.exp(-event.deltaY*.001)));},{passive:false});
canvas.addEventListener("dblclick",resetView);canvas.addEventListener("contextmenu",(event)=>event.preventDefault());
search.addEventListener("input",()=>{query=search.value.trim();selected=null;detail.hidden=true;});
filters.addEventListener("click",(event)=>{const button=event.target.closest("[data-filter]");if(!button)return;activeFilter=button.dataset.filter;filters.querySelectorAll("button").forEach((item)=>item.classList.toggle("active",item===button));selected=null;detail.hidden=true;});
$("#detail-close").addEventListener("click",()=>{selected=null;detail.hidden=true;});
addEventListener("resize",resize);
function enforceNewTabLinks(root=document){const links=root.matches?.("a[href]")?[root]:[...root.querySelectorAll("a[href]")];links.forEach((link)=>{if(link.hasAttribute("data-same-tab")){link.removeAttribute("target");link.removeAttribute("rel");return;}link.target="_blank";link.rel="noopener noreferrer";});}
enforceNewTabLinks();
new MutationObserver((mutations)=>mutations.forEach((mutation)=>mutation.addedNodes.forEach((node)=>{if(node.nodeType===Node.ELEMENT_NODE)enforceNewTabLinks(node);}))).observe(document.body,{childList:true,subtree:true});
resize();applyInitialLocation();requestAnimationFrame(animate);
