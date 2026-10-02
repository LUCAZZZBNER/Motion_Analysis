import {EDGES} from './core.mjs';
const COLORS=['#16804d','#df792e'],finite=p=>p?.length===3&&p.every(Number.isFinite);
// True XYZ geometry projected through a shared orbit camera; no rendering dependency.
export function rotate3D([x,y,z],yaw,pitch){const xx=x*Math.cos(yaw)+z*Math.sin(yaw),zz=-x*Math.sin(yaw)+z*Math.cos(yaw);return [xx,y*Math.cos(pitch)-zz*Math.sin(pitch),y*Math.sin(pitch)+zz*Math.cos(pitch)];}
export class PoseView3D{
  constructor(canvas){
    this.canvas=canvas;this.poses=null;this.position=50;this.options={indices:[],labels:false,joint:16,trail:false,separate:false};this.radius=2;this.floor=-1.5;this.frame=null;this.reset();
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',e=>{if(this.drag)return;e.preventDefault();canvas.focus();canvas.setPointerCapture(e.pointerId);this.drag={id:e.pointerId,x:e.clientX,y:e.clientY,pan:e.shiftKey||e.button===2};});
    canvas.addEventListener('pointermove',e=>{const d=this.drag;if(!d||d.id!==e.pointerId)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;d.x=e.clientX;d.y=e.clientY;if(d.pan){this.panX+=dx;this.panY+=dy;}else{this.yaw+=dx*.009;this.pitch=Math.max(-Math.PI/2,Math.min(Math.PI/2,this.pitch+dy*.009));}this.schedule();});
    const end=e=>{if(this.drag?.id===e.pointerId){this.drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}};
    for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,end);
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=Math.max(.35,Math.min(3,this.zoom*Math.exp(-e.deltaY*.001)));this.schedule();},{passive:false});
    canvas.addEventListener('dblclick',()=>this.reset());
    canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','+','-'].includes(e.key)){e.preventDefault();if(e.key==='Home')return this.reset();if(e.key==='ArrowLeft')this.yaw-=.15;if(e.key==='ArrowRight')this.yaw+=.15;if(e.key==='ArrowUp')this.pitch=Math.min(Math.PI/2,this.pitch+.15);if(e.key==='ArrowDown')this.pitch=Math.max(-Math.PI/2,this.pitch-.15);if(e.key==='+')this.zoom=Math.min(3,this.zoom*1.1);if(e.key==='-')this.zoom=Math.max(.35,this.zoom/1.1);this.schedule();}});
    this.observer=new ResizeObserver(()=>this.schedule());this.observer.observe(canvas);
  }
  reset(){this.yaw=-.3;this.pitch=.12;this.zoom=1;this.panX=0;this.panY=0;this.schedule();}
  preset(name){this.yaw=name==='side'?Math.PI/2:0;this.pitch=name==='top'?Math.PI/2:0;this.panX=this.panY=0;this.zoom=1;this.schedule();}
  setData(poses,options){this.poses=poses;this.options={...this.options,...options};const points=poses?.flat(2).filter(finite)||[];this.radius=Math.max(2,...points.map(p=>Math.hypot(...p)));this.floor=points.length?Math.min(...points.map(p=>p[1])):-1.5;this.schedule();}
  setPosition(position){this.position=position;this.schedule();}
  schedule(){if(this.frame!==null)return;this.frame=requestAnimationFrame(()=>{this.frame=null;this.draw();});}
  project(p,offset=0){const [x,y,z]=rotate3D([p[0]+offset,p[1],p[2]],this.yaw,this.pitch),depth=this.distance-z;if(depth<.12)return null;return [this.w/2+this.panX+x*this.focal/depth,this.h/2+this.panY-y*this.focal/depth,z];}
  draw(){
    const canvas=this.canvas,w=canvas.clientWidth;if(!w)return;this.w=w;this.h=Math.max(270,w*.54);const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(this.h*dpr);
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,this.h);this.distance=Math.max(5,this.radius*2.5+(this.options.separate?3:0))/this.zoom;this.focal=Math.min(w,this.h)*1.35;
    canvas.dataset.yaw=this.yaw.toFixed(4);canvas.dataset.pitch=this.pitch.toFixed(4);canvas.dataset.zoom=this.zoom.toFixed(4);
    ctx.lineCap='round';ctx.lineJoin='round';ctx.font='12px "Microsoft YaHei",sans-serif';
    const line=(a,b,color,width=1)=>{if(!a||!b)return;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();};
    for(let i=-3;i<=3;i++){line(this.project([i,this.floor,-3]),this.project([i,this.floor,3]),'#dfe7df');line(this.project([-3,this.floor,i]),this.project([3,this.floor,i]),'#dfe7df');}
    const segments=[],dots=[],indices=new Set(this.options.indices);let visible=[0,0];
    for(const [n,sequence] of (this.poses||[]).entries()){
      const pose=sequence[this.position],offset=this.options.separate?(n?1.9:-1.9):0;if(!pose)continue;
      if(this.options.trail){let previous=null;for(const frame of sequence){const p=frame[this.options.joint],current=finite(p)?this.project(p,offset):null;if(previous&&current)segments.push({a:previous,b:current,z:(previous[2]+current[2])/2,n,trail:true});previous=current;}}
      for(const [a,b] of EDGES){if(!indices.has(a)||!indices.has(b)||!finite(pose[a])||!finite(pose[b]))continue;const pa=this.project(pose[a],offset),pb=this.project(pose[b],offset);if(pa&&pb)segments.push({a:pa,b:pb,z:(pa[2]+pb[2])/2,n,small:a<11||a>28||b>28});}
      for(const i of indices){if(!finite(pose[i]))continue;const p=this.project(pose[i],offset);if(p){dots.push({p,n,i});visible[n]++;}}
    }
    for(const s of segments.sort((a,b)=>a.z-b.z)){ctx.globalAlpha=s.trail?.4:.72;line(s.a,s.b,COLORS[s.n],s.trail?1.5:s.small?2.5:5);}
    ctx.globalAlpha=1;for(const {p,n,i} of dots.sort((a,b)=>a.p[2]-b.p[2])){ctx.fillStyle=COLORS[n];ctx.beginPath();ctx.arc(p[0],p[1],i<11?2:3.5,0,Math.PI*2);ctx.fill();if(this.options.labels)ctx.fillText(String(i),p[0]+5,p[1]-4);}
    // Orientation triad rotates with the same camera, independent of pan and zoom.
    for(const [p,label,color] of [[[1,0,0],'X','#b5534c'],[[0,1,0],'Y','#16804d'],[[0,0,1],'Z','#5174af']]){const r=rotate3D(p,this.yaw,this.pitch),a=[45,this.h-45],b=[45+r[0]*27,this.h-45-r[1]*27];line(a,b,color,2);ctx.fillStyle=color;ctx.fillText(label,b[0]+4,b[1]-3);}
    ctx.fillStyle='#546456';ctx.fillText('绿色：我  /  橙色：参考 · 3D',16,25);
    if(!visible.every(Boolean))ctx.fillText('当前进度有姿态缺失，或肩髋点不足；不补造深度。',16,this.h-13);
  }
  dispose(){this.observer.disconnect();if(this.frame!==null)cancelAnimationFrame(this.frame);}
}
