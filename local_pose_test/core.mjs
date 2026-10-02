// Geometry and comparison use 2D pixels, then fixed torso units; never quality scores.
export const BODY_JOINTS = {"左肩":11,"右肩":12,"左肘":13,"右肘":14,"左腕":15,"右腕":16,"左髋":23,"右髋":24,"左膝":25,"右膝":26,"左踝":27,"右踝":28};
export const JOINTS = {...BODY_JOINTS,"鼻子":0,"左眼内侧":1,"左眼":2,"左眼外侧":3,"右眼内侧":4,"右眼":5,"右眼外侧":6,"左耳":7,"右耳":8,"左嘴角":9,"右嘴角":10,"左小指（粗略）":17,"右小指（粗略）":18,"左食指（粗略）":19,"右食指（粗略）":20,"左拇指（粗略）":21,"右拇指（粗略）":22,"左脚跟":29,"右脚跟":30,"左前脚掌":31,"右前脚掌":32};
export const ANGLES = {"左膝内角":[23,25,27],"右膝内角":[24,26,28],"左髋近似内角":[11,23,25],"右髋近似内角":[12,24,26],"左肘内角":[11,13,15],"右肘内角":[12,14,16],"左肩内角":[13,11,23],"右肩内角":[14,12,24]};
export const EDGES = [[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],[11,12],[11,13],[13,15],[12,14],[14,16],[15,17],[17,19],[15,19],[15,21],[16,18],[18,20],[16,20],[16,22],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32]];
export const LIMITS = Object.freeze({fileBytes:100*1024*1024, sourcePixels:1280*720, maxSide:1280, clipSeconds:20, samples:160, processSide:480, memoryBytes:1_000_000_000});
const PAIRS = [[1,4],[2,5],[3,6],[7,8],[9,10],...Array.from({length:11},(_,i)=>[11+2*i,12+2*i])];
export const GRID = Array.from({length:101},(_,i)=>i/100);
export function valid(point, threshold=0.5) { return !!point && point.every(Number.isFinite) && point[2]>=threshold; }
export function median(values) { const a=values.filter(Number.isFinite).sort((x,y)=>x-y); return a.length ? (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2 : NaN; }
export function angle(a,b,c) {
  if (![a,b,c].every(p=>p?.slice(0,2).every(Number.isFinite))) return NaN;
  const u=[a[0]-b[0],a[1]-b[1]], v=[c[0]-b[0],c[1]-b[1]], d=Math.hypot(...u)*Math.hypot(...v);
  return d>1e-8 ? Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/d)))*180/Math.PI : NaN;
}
export function angleSeries(points,threshold) {
  return Object.fromEntries(Object.entries(ANGLES).map(([name,ids])=>[name,points.map(p=>ids.every(i=>valid(p[i],threshold)) ? angle(...ids.map(i=>p[i])) : NaN)]));
}
export function mirrorPoints(points,width) {
  return points.map(frame=>{ const p=frame.map(v=>[width-1-v[0],v[1],v[2]]); for(const [l,r] of PAIRS) [p[l],p[r]]=[p[r],p[l]]; return p; });
}
export function normalize(points,threshold,origin="pelvis") {
  if(!["pelvis","first_pelvis"].includes(origin)) throw Error("未知轨迹坐标方式。");
  const centre=(p,a,b)=>valid(p[a],threshold)&&valid(p[b],threshold) ? [(p[a][0]+p[b][0])/2,(p[a][1]+p[b][1])/2] : [NaN,NaN];
  const hips=points.map(p=>centre(p,23,24)), shoulders=points.map(p=>centre(p,11,12));
  const scale=median(hips.map((h,i)=>Math.hypot(h[0]-shoulders[i][0],h[1]-shoulders[i][1])).filter(x=>x>1e-6));
  const first=hips.find(h=>h.every(Number.isFinite)) || [NaN,NaN];
  return points.map((p,i)=>p.map(v=>{
    const base=origin==="first_pelvis" ? first : hips[i];
    return valid(v,threshold)&&Number.isFinite(scale)&&base.every(Number.isFinite) ? [(v[0]-base[0])/scale,-(v[1]-base[1])/scale] : [NaN,NaN];
  }));
}
export function progress(times) {
  if(times.length<2 || times.some((t,i)=>!Number.isFinite(t)||(i&&t<=times[i-1]))) throw Error("需要至少两个递增的采样时间。");
  return times.map(t=>(t-times[0])/(times.at(-1)-times[0]));
}
export function resample(times,values,grid=GRID,maxGap) {
  if(times.length!==values.length) throw Error("采样时间与数据长度不同。");
  const x=progress(times), span=times.at(-1)-times[0];
  const gap=maxGap??Math.max(1.5*median(x.slice(1).map((t,i)=>t-x[i])),0.4/span);
  const pairs=x.map((t,i)=>[t,values[i]]).filter(p=>Number.isFinite(p[1]));
  let r=0;
  return grid.map(q=>{
    while(r<pairs.length && pairs[r][0]<q-1e-9) r++;
    if(r<pairs.length && Math.abs(pairs[r][0]-q)<1e-9) return pairs[r][1];
    if(r && Math.abs(pairs[r-1][0]-q)<1e-9) return pairs[r-1][1];
    if(r && r<pairs.length && pairs[r][0]-pairs[r-1][0]<=gap+1e-9) {
      const [a,b]=[pairs[r-1],pairs[r]]; return a[1]+(b[1]-a[1])*(q-a[0])/(b[0]-a[0]);
    }
    return NaN;
  });
}
export function resamplePoses(times,poses) {
  const dimensions=poses[0]?.[0]?.length||3;
  const columns=Array.from({length:33},(_,j)=>Array.from({length:dimensions},(_,k)=>resample(times,poses.map(p=>p[j][k]))));
  return GRID.map((_,i)=>columns.map(p=>p.map(axis=>axis[i])));
}
export function validWorld(p,threshold=.5){return p?.length===4&&p.every(Number.isFinite)&&p[3]>=threshold;}
export function mirrorWorld(points){return points.map(frame=>{const p=frame.map(([x,y,z,c])=>[-x,y,z,c]);for(const [l,r] of PAIRS)[p[l],p[r]]=[p[r],p[l]];return p;});}
export function angle3D(a,b,c){
  if(![a,b,c].every(p=>p?.slice(0,3).length===3&&p.slice(0,3).every(Number.isFinite)))return NaN;
  const u=a.slice(0,3).map((v,i)=>v-b[i]),v=c.slice(0,3).map((v,i)=>v-b[i]),d=Math.hypot(...u)*Math.hypot(...v);
  return d>1e-10?Math.acos(Math.max(-1,Math.min(1,u.reduce((sum,x,i)=>sum+x*v[i],0)/d)))*180/Math.PI:NaN;
}
export function worldAngles(points,threshold){return Object.fromEntries(Object.entries(ANGLES).map(([name,ids])=>[name,points.map(p=>ids.every(i=>validWorld(p[i],threshold))?angle3D(...ids.map(i=>p[i])):NaN)]));}
export function normalizeWorld(points,threshold){
  const centre=(p,a,b)=>validWorld(p[a],threshold)&&validWorld(p[b],threshold)?[0,1,2].map(k=>(p[a][k]+p[b][k])/2):[NaN,NaN,NaN];
  const hips=points.map(p=>centre(p,23,24)),shoulders=points.map(p=>centre(p,11,12));
  const scale=median(hips.map((h,i)=>Math.hypot(...h.map((v,k)=>v-shoulders[i][k]))).filter(x=>x>1e-6));
  return points.map((p,i)=>p.map(v=>validWorld(v,threshold)&&Number.isFinite(scale)&&hips[i].every(Number.isFinite)?[(v[0]-hips[i][0])/scale,-(v[1]-hips[i][1])/scale,-(v[2]-hips[i][2])/scale]:[NaN,NaN,NaN]));
}
export function clipBounds(start,end,duration,changed,fps){
  if(![start,end,duration,fps].every(Number.isFinite)||duration<.3)throw Error("请填写有效时间。");
  const gap=Math.min(duration,Math.max(.3,1/fps+.01));
  if(changed==="start"){start=Math.max(0,Math.min(start,duration-gap));end=Math.max(start+gap,Math.min(end,start+LIMITS.clipSeconds,duration));}
  else{end=Math.max(gap,Math.min(end,duration));start=Math.min(end-gap,Math.max(start,0,end-LIMITS.clipSeconds));}
  return {start,end};
}
export function difference(a,b) {
  const pairs=a.map((v,i)=>[v,b[i]]).filter(p=>p.every(Number.isFinite));
  return {mean:pairs.length ? pairs.reduce((s,[x,y])=>s+Math.abs(x-y),0)/pairs.length : null,coverage:a.length ? pairs.length/a.length : 0};
}
export function sampleTimes(start,end,fps,duration) {
  if(![start,end,duration,fps].every(Number.isFinite)||start<0||end>duration+1e-6||end-start<0.3-1e-6||end-start>LIMITS.clipSeconds+1e-6||![2,4,8].includes(fps)) throw Error("每段请选择 0.3–20 秒，每秒识别 2、4 或 8 帧。");
  const count=Math.ceil((end-start)*fps-1e-9);
  if(count<2 || count>LIMITS.samples) throw Error("区间至少需要两帧，每段最多 160 帧。");
  return Array.from({length:count},(_,i)=>start+i/fps);
}
export function nearest(times,time) { return times.reduce((best,t,i)=>Math.abs(t-time)<Math.abs(times[best]-time)?i:best,0); }
export function toCsv(columns) {
  const cell=v=>typeof v==="number" ? (Number.isFinite(v)?String(v):"") : '"'+String(v).replaceAll('"','""')+'"';
  const names=Object.keys(columns), count=columns[names[0]]?.length||0;
  return "\uFEFF"+[names.map(cell).join(","),...Array.from({length:count},(_,i)=>names.map(k=>cell(columns[k][i])).join(","))].join("\r\n");
}
