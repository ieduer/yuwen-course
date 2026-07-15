const PROGRESS_KEY = "yw-matrix-progress-v2";
const taxonomy = await fetch("data/literary-taxonomy.json").then((response) => response.json());
let progress = {};
try { progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}"); } catch { progress = {}; }
const genreById = Object.fromEntries(taxonomy.genres.map((genre) => [genre.id, genre]));
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const COLORS = { classical:"#e5b754", poetry:"#d76ead", fiction:"#ef6a5b", drama:"#7d69df", journalism:"#56a7dc", argument:"#4fc7b5", science:"#85bd5a", "unit-intro":"#9ba7ce", "unit-task":"#6888f6" };

const TRACKS = {
  classical:{context:10,vocabulary:20,read:10,authorQuestion:10,revision:15,structure:20,evaluation:5,wordCreation:10},
  poetry:{context:10,vocabulary:15,authorQuestion:10,read:10,revision:15,structure:20,evaluation:10,wordCreation:10},
  fiction:{context:10,vocabulary:15,authorQuestion:10,read:10,revision:15,structure:20,evaluation:10,wordCreation:10},
  drama:{context:10,vocabulary:15,authorQuestion:10,read:10,revision:15,structure:20,evaluation:10,wordCreation:10},
  journalism:{context:10,vocabulary:15,authorQuestion:10,read:10,revision:15,structure:20,evaluation:10,wordCreation:10},
  argument:{context:10,vocabulary:15,authorQuestion:10,read:10,revision:15,structure:20,evaluation:10,wordCreation:10},
  science:{context:10,vocabulary:15,authorQuestion:10,read:10,revision:15,structure:20,evaluation:10,wordCreation:10},
  "unit-intro":{context:20,read:20,authorQuestion:20,structure:25,evaluation:15},
  "unit-task":{context:15,read:15,authorQuestion:20,revision:15,structure:25,evaluation:10},
};

function modeOf(lesson) {
  if (["whole-book","language-activity","review"].includes(lesson.mode)) return "unit-task";
  if (["speech-letter","modern-prose"].includes(lesson.mode)) return "argument";
  return TRACKS[lesson.mode] ? lesson.mode : "argument";
}
function done(value,key){ return key==="read"||key==="context" ? value===true||Boolean(value?.done) : Boolean(value?.done); }
function percent(lesson,record){ return Object.entries(TRACKS[modeOf(lesson)]).reduce((sum,[key,weight])=>sum+(done(record?.[key],key)?weight:0),0); }

function mergeRemote(items){ items.forEach((item)=>{if(!item?.itemKey||!item?.meta?.checkpoints)return;progress[item.itemKey]={...(progress[item.itemKey]||{}),...item.meta.checkpoints,remoteProgressPercent:Number(item.progressPercent||0)};});localStorage.setItem(PROGRESS_KEY,JSON.stringify(progress)); }

function renderValues(){
  const values=taxonomy.lessons.map((lesson)=>({lesson,value:progress[lesson.id]?.evaluation})).filter((item)=>item.value?.rating).sort((a,b)=>b.value.rating-a.value.rating);
  $("#value-chart").innerHTML=values.length?values.map(({lesson,value})=>`<a class="value-row" href="./#${esc(lesson.id)}" target="_blank" rel="noopener noreferrer" title="${esc(value.reason||"")}"><strong>${esc(lesson.title)}</strong><span class="value-track" style="--value:${Number(value.rating)/5*100}%"></span><em>${esc(value.rating)} / 5</em></a>`).join(""):`<p class="empty">尚無評價</p>`;
}

function renderMastery(){
  const groups=new Map();
  taxonomy.lessons.forEach((lesson)=>{const record=progress[lesson.id];if(!record)return;const mode=modeOf(lesson);const group=groups.get(mode)||{total:0,count:0,label:genreById[lesson.genres[0]]?.label||mode};group.total+=percent(lesson,record);group.count+=1;groups.set(mode,group);});
  $("#mastery-chart").innerHTML=groups.size?[...groups.values()].sort((a,b)=>b.total/b.count-a.total/a.count).map((group)=>{const score=Math.round(group.total/group.count);return `<div class="mastery-item" style="--mastery:${score}%"><span>${esc(group.label)}</span><strong>${score}<small>%</small></strong><i></i><small>${group.count} 篇</small></div>`;}).join(""):`<p class="empty">尚無記錄</p>`;
}

function renderWords(){
  const words=taxonomy.lessons.map((lesson)=>({lesson,value:progress[lesson.id]?.wordCreation})).filter((item)=>item.value?.done&&item.value.word);
  $("#word-chart").innerHTML=words.length?words.map(({lesson,value},index)=>`<button type="button" data-lesson="${esc(lesson.id)}" data-word="${esc(value.word)}" data-creation="${esc(value.creation)}" style="--size:${1+(index%5)*.17}rem;--opacity:${.62+(index%4)*.1}">${esc(value.word)}</button>`).join(""):`<p class="empty">尚無新詞</p>`;
  $("#word-chart").querySelectorAll("button").forEach((button)=>button.addEventListener("click",()=>{$("#word-title").textContent=button.dataset.word;$("#word-creation").textContent=button.dataset.creation;$("#word-lesson").href=`./#${button.dataset.lesson}`;$("#word-dialog").showModal();}));
}

const canvas=$("#insight-canvas");
const ctx=canvas.getContext("2d");
const tooltip=$("#insight-tooltip");
const FOV=1400;
let width=0,height=0,dpr=1,rotY=.55,tilt=-.24,targetRotY=rotY,targetTilt=tilt,zoom=.78,targetZoom=.78,panX=0,panY=0,hover=null,selected=null,last=performance.now(),grow=reduceMotion?1:0,meteor=null,nextMeteor=performance.now()+2500;
const stars=[];
let orbitNodes=[];
let orbitEdges=[];
const sprites=new Map();

function buildOrbit(){
  const records=taxonomy.lessons.filter((lesson)=>progress[lesson.id]&&Object.keys(progress[lesson.id]).length);
  orbitNodes=records.map((lesson,index)=>{
    const y=1-(index/(Math.max(1,records.length-1)))*2;
    const radius=Math.sqrt(Math.max(0,1-y*y));
    const theta=index*2.3999632297;
    const score=percent(lesson,progress[lesson.id]);
    return {i:index,lesson,x:Math.cos(theta)*radius*330,y:y*260,z:Math.sin(theta)*radius*330,r:3.4+Math.sqrt(Math.max(1,score))*.72,rating:Number(progress[lesson.id]?.evaluation?.rating||0),score,color:COLORS[modeOf(lesson)]||"#9ba7ce",mode:modeOf(lesson),alpha:0,phase:(index*137.5)%6.2832,tw:.6+((index*31)%40)/100,ap:index/Math.max(1,records.length-1)};
  });
  orbitEdges=[];
  const previousByMode=new Map();
  orbitNodes.forEach((node,index)=>{if(index)orbitEdges.push([orbitNodes[index-1],node]);const previous=previousByMode.get(node.mode);if(previous&&previous!==orbitNodes[index-1])orbitEdges.push([previous,node]);previousByMode.set(node.mode,node);});
  [...new Set(orbitNodes.map((node)=>node.color))].forEach((color)=>{if(sprites.has(color))return;const sprite=document.createElement("canvas");sprite.width=sprite.height=64;const brush=sprite.getContext("2d");const glow=brush.createRadialGradient(32,32,0,32,32,32);glow.addColorStop(0,`${color}e6`);glow.addColorStop(.25,`${color}58`);glow.addColorStop(1,`${color}00`);brush.fillStyle=glow;brush.fillRect(0,0,64,64);sprites.set(color,sprite);});
  $("#orbit-summary").textContent=records.length?`${records.length} 篇 · ${orbitEdges.length} 條閱讀連線`:"尚無閱讀軌跡";
}

function resize(){width=innerWidth;height=innerHeight;dpr=Math.min(devicePixelRatio||1,2);canvas.width=width*dpr;canvas.height=height*dpr;stars.length=0;for(let i=0;i<Math.min(360,Math.max(150,width*height/6000));i+=1)stars.push({x:Math.random()*width,y:Math.random()*height,a:.12+Math.random()*.6,r:.3+Math.random()*1.2,p:Math.random()*6.28});}
function project(node){const cy=Math.cos(rotY),sy=Math.sin(rotY),ct=Math.cos(tilt),st=Math.sin(tilt),x=node.x*cy+node.z*sy,z=-node.x*sy+node.z*cy,y2=node.y*ct-z*st,z2=node.y*st+z*ct,scale=Math.min(width/1120,height/900)*zoom,p=Math.max(.08,Math.min(4,FOV/Math.max(FOV*.12,FOV+z2*scale*1.6)));return{x:width/2+panX+x*scale*p,y:height*.5+panY+y2*scale*p,r:node.r*p*Math.min(1.5,Math.max(.68,zoom)),p,z:z2};}
function pick(x,y){let result=null,best=18*18;orbitNodes.forEach((node)=>{const p=project(node),dx=x-p.x,dy=y-p.y,d=dx*dx+dy*dy;if(d<Math.max(11,p.r+6)**2&&d<best){best=d;result=node;}});return result;}
function drawMeteor(time){if(reduceMotion||width<500)return;if(!meteor&&time>nextMeteor){const fromLeft=Math.random()<.5;meteor={x0:fromLeft?-40:width+40,y0:height*(.06+Math.random()*.3),dx:(fromLeft?1:-1)*(.9+Math.random()*.5),dy:.22+Math.random()*.18,len:130+Math.random()*90,t0:time,dur:1300+Math.random()*500};}if(!meteor)return;const p=(time-meteor.t0)/meteor.dur;if(p>=1){meteor=null;nextMeteor=time+7000+Math.random()*9000;return;}const travel=(width+220)*p,hx=meteor.x0+meteor.dx*travel,hy=meteor.y0+meteor.dy*travel*Math.abs(meteor.dx),tx=hx-meteor.dx*meteor.len,ty=hy-meteor.dy*meteor.len*Math.abs(meteor.dx),fade=Math.sin(Math.PI*p)*.75,gradient=ctx.createLinearGradient(tx,ty,hx,hy);gradient.addColorStop(0,"rgba(240,230,203,0)");gradient.addColorStop(1,`rgba(240,230,203,${fade})`);ctx.globalCompositeOperation="lighter";ctx.strokeStyle=gradient;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(hx,hy);ctx.stroke();ctx.fillStyle=`rgba(253,246,227,${fade})`;ctx.beginPath();ctx.arc(hx,hy,1.6,0,6.2832);ctx.fill();ctx.globalCompositeOperation="source-over";}
function draw(time){ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);stars.forEach((star)=>{ctx.globalAlpha=star.a*(.55+.45*Math.sin(time*.0006+star.p));ctx.fillStyle="#d9e0ff";ctx.beginPath();ctx.arc(star.x,star.y,star.r,0,6.2832);ctx.fill();});const projected=new Map(orbitNodes.map((node)=>[node,project(node)]));ctx.globalCompositeOperation="source-over";orbitEdges.forEach(([from,to])=>{const a=projected.get(from),b=projected.get(to),focused=selected&&(from===selected||to===selected),alpha=(focused?.5:selected?.02:.1)*Math.min(from.alpha,to.alpha)*(.35+.65*((a.p+b.p)/2)**2);if(alpha<.006)return;ctx.strokeStyle=focused?`rgba(232,197,121,${alpha})`:`rgba(185,198,238,${alpha})`;ctx.lineWidth=focused?1.4:.8;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();});ctx.globalCompositeOperation="lighter";[...orbitNodes].sort((a,b)=>projected.get(a).p-projected.get(b).p).forEach((node)=>{const p=projected.get(node),active=node===hover||node===selected,born=Math.max(0,Math.min(1,(grow-node.ap)/.08));if(!born)return;node.alpha+=(1-node.alpha)*.08;const twinkle=reduceMotion?1:.82+.18*Math.sin(time*.0011*node.tw+node.phase*3),alpha=node.alpha*twinkle*born*(.5+.5*Math.min(1,p.p*p.p)),radius=p.r*(active?1.5:1)*(.5+.5*born),glowR=radius*(active?9:5.5),sprite=sprites.get(node.color);ctx.globalAlpha=alpha*(active?.95:.56);if(sprite)ctx.drawImage(sprite,p.x-glowR,p.y-glowR,glowR*2,glowR*2);ctx.globalAlpha=alpha;ctx.fillStyle=active?"#fdf6e3":node.rating>=4?"#f4cf6b":node.color;ctx.beginPath();ctx.arc(p.x,p.y,radius,0,6.2832);ctx.fill();});ctx.globalCompositeOperation="source-over";[selected,hover].forEach((node)=>{if(!node)return;const p=projected.get(node),r=p.r*1.5;ctx.globalAlpha=1;ctx.strokeStyle=node===selected?"rgba(240,230,203,.95)":"rgba(240,230,203,.5)";ctx.lineWidth=node===selected?1.6:1.1;ctx.beginPath();ctx.arc(p.x,p.y,r+4,0,6.2832);ctx.stroke();});const candidates=orbitNodes.filter((node)=>node===hover||node===selected||node.score>=80||(zoom>1.55&&node.score>=50)).map((node)=>({node,p:projected.get(node),hot:node===hover||node===selected,priority:node===hover||node===selected?1e6:node.score+projected.get(node).p})).sort((a,b)=>b.priority-a.priority),placed=[];ctx.textAlign="center";candidates.forEach(({node,p,hot})=>{const size=(hot?14:12)*Math.max(.85,Math.min(1.15,p.p));ctx.font=`${hot?650:520} ${size}px Songti TC,serif`;const w=ctx.measureText(node.lesson.title).width,cy=p.y-p.r-8,rect={x:p.x-w/2-3,y:cy-size,w:w+6,h:size+5};if(!hot&&placed.some((other)=>!(rect.x>other.x+other.w||rect.x+rect.w<other.x||rect.y>other.y+other.h||rect.y+rect.h<other.y)))return;placed.push(rect);ctx.globalAlpha=hot?1:.72;ctx.fillStyle=hot?"#fff":"rgba(230,236,255,.9)";ctx.shadowColor="rgba(3,5,12,.95)";ctx.shadowBlur=6;ctx.fillText(node.lesson.title,p.x,cy);ctx.shadowBlur=0;});drawMeteor(time);ctx.globalAlpha=1;}
function frame(time){const dt=Math.min(32,time-last);last=time;if(!reduceMotion)grow=Math.min(1.02,grow+dt/2800*1.02);if(!reduceMotion&&!hover&&!selected)targetRotY+=dt*.00016;rotY+=(targetRotY-rotY)*.09;tilt+=(targetTilt-tilt)*.09;zoom+=(targetZoom-zoom)*.1;draw(time);requestAnimationFrame(frame);}
function showTip(node,x,y){if(!node){tooltip.hidden=true;return;}tooltip.innerHTML=`<strong>${esc(node.lesson.title)}</strong><span>${node.score}% · ${node.rating?`${node.rating}/5`:"未評價"}</span>`;tooltip.style.left=`${Math.min(width-210,x+16)}px`;tooltip.style.top=`${Math.min(height-70,y+16)}px`;tooltip.hidden=false;}
function focus(node){selected=node;const candidate=Math.atan2(-node.x,node.z||1);let best=candidate,bestDepth=Infinity;[candidate,candidate+Math.PI].forEach((rotation)=>{const z=-node.x*Math.sin(rotation)+node.z*Math.cos(rotation);if(z<bestDepth){bestDepth=z;best=rotation;}});targetRotY=best;targetTilt=-.12;targetZoom=Math.max(targetZoom,1.25);panX=0;panY=0;}
let dragging=false,panning=false,moved=0,lastX=0,lastY=0,pinchDistance=0;
const pointers=new Map();
canvas.addEventListener("pointerdown",(event)=>{canvas.setPointerCapture?.(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});dragging=event.button!==2;panning=event.button===2;moved=0;lastX=event.clientX;lastY=event.clientY;});
canvas.addEventListener("pointermove",(event)=>{if(pointers.has(event.pointerId))pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pointers.size===2){const [a,b]=[...pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(pinchDistance)targetZoom=Math.max(.5,Math.min(3.4,targetZoom*distance/pinchDistance));pinchDistance=distance;return;}if(dragging||panning){const dx=event.clientX-lastX,dy=event.clientY-lastY;moved+=Math.abs(dx)+Math.abs(dy);if(panning||event.shiftKey){panX+=dx;panY+=dy;}else{targetRotY+=dx*.005;targetTilt=Math.max(-1.1,Math.min(1.1,targetTilt-dy*.004));}lastX=event.clientX;lastY=event.clientY;return;}hover=pick(event.clientX,event.clientY);showTip(hover,event.clientX,event.clientY);canvas.style.cursor=hover?"pointer":"grab";});
canvas.addEventListener("pointerup",(event)=>{const wasSingle=pointers.size===1;pointers.delete(event.pointerId);if(pointers.size<2)pinchDistance=0;if(wasSingle&&moved<6){const node=pick(event.clientX,event.clientY);if(node===selected)window.open(`./#${node.lesson.id}`,"_blank","noopener,noreferrer");else if(node){focus(node);showTip(node,event.clientX,event.clientY);}else{selected=null;targetZoom=.78;}}if(!pointers.size){dragging=false;panning=false;}});
canvas.addEventListener("pointercancel",(event)=>{pointers.delete(event.pointerId);pinchDistance=0;dragging=false;panning=false;});canvas.addEventListener("pointerleave",()=>{if(!dragging&&!panning){hover=null;tooltip.hidden=true;}});canvas.addEventListener("wheel",(event)=>{event.preventDefault();targetZoom=Math.max(.42,Math.min(3.4,targetZoom*Math.exp(-event.deltaY*.0016)));},{passive:false});canvas.addEventListener("dblclick",()=>{selected=null;targetRotY=.55;targetTilt=-.24;targetZoom=.78;panX=0;panY=0;});canvas.addEventListener("contextmenu",(event)=>event.preventDefault());

function render(){renderValues();renderMastery();renderWords();buildOrbit();}
async function hydrate(){const deadline=Date.now()+6000;while(!window.BdfzIdentity&&Date.now()<deadline)await new Promise((resolve)=>setTimeout(resolve,120));const identity=window.BdfzIdentity;if(!identity)return;if(identity.buildAuthUrl)$("#auth-link").href=identity.buildAuthUrl(location.href);const session=await identity.getSession?.().catch(()=>null);if(!session?.authenticated)return;$("#sync-status").textContent="已連接 User Center · 顯示跨設備記錄";$("#auth-link").textContent="查看我的帳戶 ↗";const payload=await identity.api?.("/api/progress?site=yw").catch(()=>null);const items=Array.isArray(payload?.items)?payload.items:Array.isArray(payload)?payload:[];mergeRemote(items);render();}

function enforceNewTabLinks(root=document){const links=root.matches?.("a[href]")?[root]:[...root.querySelectorAll("a[href]")];links.forEach((link)=>{if(link.hasAttribute("data-same-tab")){link.removeAttribute("target");link.removeAttribute("rel");return;}link.target="_blank";link.rel="noopener noreferrer";});}
enforceNewTabLinks();
new MutationObserver((mutations)=>mutations.forEach((mutation)=>mutation.addedNodes.forEach((node)=>{if(node.nodeType===Node.ELEMENT_NODE)enforceNewTabLinks(node);}))).observe(document.body,{childList:true,subtree:true});
resize();render();addEventListener("resize",resize);requestAnimationFrame(frame);void hydrate();
