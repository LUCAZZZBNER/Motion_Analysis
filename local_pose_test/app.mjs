import {BODY_JOINTS,JOINTS,ANGLES,EDGES,LIMITS,GRID,valid,mirrorWorld,worldAngles,normalizeWorld,resample,resamplePoses,difference,sampleTimes,clipBounds,nearest,toCsv} from "./core.mjs";
import {PoseView3D} from "./pose-view3d.mjs";
const $=id=>document.getElementById(id), COLORS=["#16804d","#df792e"], slots={};
const state={ready:false,busy:false,cancelled:false,worker:null,pair:null,probe:null,memoryExceeded:false,previewRevision:0};
const view3d=new PoseView3D($("skeleton"));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const message=(text,error=false)=>{ $("status").textContent=text; $("status").classList.toggle("error",error); };
const threshold=()=>Number($("threshold").value);
const bodyCount=p=>Object.values(BODY_JOINTS).filter(i=>valid(p[i],threshold())).length;

class Detector {
  constructor(){this.worker=new Worker("/pose-worker.mjs",{type:"module"});this.requests=new Map();this.next=0;
    this.worker.onmessage=({data})=>{const pending=this.requests.get(data.id);if(!pending)return;this.requests.delete(data.id);clearTimeout(pending.timer);data.error?pending.reject(Error(data.error)):pending.resolve(data);};
    this.worker.onerror=event=>{event.preventDefault();this.destroy(Error(event.message||"浏览器无法启动模型，请使用 Chrome 并检查本地运行文件。"));};
  }
  call(type,data={},transfer=[]){return new Promise((resolve,reject)=>{const id=++this.next,timer=setTimeout(()=>this.destroy(Error("本地识别超时，请使用更短的视频或减少每秒识别帧数。")),type==="init"?60000:15000);this.requests.set(id,{resolve,reject,timer});this.worker.postMessage({id,type,...data},transfer);});}
  destroy(error=new DOMException("已停止","AbortError")){for(const p of this.requests.values()){clearTimeout(p.timer);p.reject(error);}this.requests.clear();this.worker.terminate();}
}
function controls(){
  const user=slots.user?.file,target=slots.target?.file;
  $("probe").disabled=!state.ready||!user||state.busy||state.memoryExceeded;
  $("analyze").disabled=!state.ready||!user||!target||state.busy||!state.probe||bodyCount(state.probe.points)<4||state.memoryExceeded;
  $("clear").disabled=state.busy;$("cancel").hidden=!state.busy;
  for(const name of ["user","target"]){for(const key of ["file","start","end","start-range","end-range"]) $(`${name}-${key}`).disabled=state.busy||(key.endsWith("range")&&!slots[name].file);$(`${name}-export`).disabled=state.busy||!state.pair;slots[name].video.controls=!state.busy;}
  for(const id of ["fps","threshold","detail","point-labels","mirror","position","joint","view-mode","show-trail","csv","json"]) $(id).disabled=state.busy;
  for(const input of $("angle-options").querySelectorAll("input"))input.disabled=state.busy;
}
function checkCancelled(){if(state.cancelled)throw new DOMException("已停止","AbortError");}
async function run(action){
  if(state.busy)return;state.busy=true;state.cancelled=false;controls();
  for(const slot of Object.values(slots))slot.video.pause();
  try{await action();}catch(error){message(error.name==="AbortError"?"已停止。可以调整视频后重试。":error.message,true);}
  finally{state.worker?.destroy();state.worker=null;state.busy=false;state.cancelled=false;$("bar").hidden=true;controls();void measureMemory();}
}
function invalidate(resetProbe=true){state.pair=null;view3d.setData(null,{});for(const slot of Object.values(slots)){slot.result=null;slot.lastDrawTime=null;slot.overlay.getContext("2d").clearRect(0,0,slot.overlay.width,slot.overlay.height);}if(resetProbe)state.probe=null;$("results").hidden=true;controls();}
async function waitVideo(video,event,timeout=10000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(Error("视频读取超时，请换用 MP4/H.264 或 WebM 短片。")),timeout);const ok=()=>finish();const bad=()=>finish(Error("浏览器无法解码视频，请换用 MP4/H.264 或 WebM。"));function finish(error){clearTimeout(timer);video.removeEventListener(event,ok);video.removeEventListener("error",bad);error?reject(error):resolve();}video.addEventListener(event,ok,{once:true});video.addEventListener("error",bad,{once:true});});}
async function loadVideo(name,file){
  const slot=slots[name],revision=++slot.revision;invalidate();
  clearTimeout(slot.previewTimer);slot.video.pause();slot.video.removeAttribute("src");slot.video.load();if(slot.url)URL.revokeObjectURL(slot.url);slot.url=null;slot.file=null;
  $(`${name}-info`).textContent="正在读取视频信息……";
  if(!file){$(`${name}-info`).textContent="尚未选择";syncTimeline(name);controls();return;}
  try{
    if(file.size>LIMITS.fileBytes)throw Error("每个视频最多 100 MiB，请先准备较小的短片。");
    if(!/\.(mp4|webm|mov)$/i.test(file.name))throw Error("请选择 MP4、WebM 或浏览器可解码的 MOV 文件。");
    slot.url=URL.createObjectURL(file);slot.video.preload="metadata";
    const loaded=waitVideo(slot.video,"loadedmetadata");slot.video.src=slot.url;await loaded;
    if(revision!==slot.revision)return;
    const {videoWidth:w,videoHeight:h,duration}=slot.video;
    if(!Number.isFinite(duration)||duration<0.3||!w||!h)throw Error("无法读取有效视频时长或分辨率。");
    if(w*h>LIMITS.sourcePixels||Math.max(w,h)>LIMITS.maxSide)throw Error("为控制内存，请准备 720p 或更低分辨率的视频；竖屏 720×1280 也可以。");
    slot.file=file;slot.duration=duration;slot.sourceWidth=w;slot.sourceHeight=h;
    $(`${name}-start`).value="0";$(`${name}-end`).value=String(Math.min(10,duration));
    for(const key of ["start","end"])$(`${name}-${key}`).max=String(duration);
    syncTimeline(name);
    $(`${name}-info`).textContent=`${file.name} · ${w}×${h} · ${duration.toFixed(2)} 秒 · ${(file.size/1024/1024).toFixed(1)} MiB`;
    message("视频已读取。先测试我的视频一帧，确认骨架跟随本人。");
  }catch(error){if(revision!==slot.revision)return;slot.video.removeAttribute("src");slot.video.load();if(slot.url)URL.revokeObjectURL(slot.url);slot.url=null;slot.file=null;$(`${name}-info`).textContent="视频未通过检查";message(error.message,true);}
  syncTimeline(name);controls();
}
function syncTimeline(name){
  const slot=slots[name],duration=slot.file?slot.duration:1,start=slot.file?Number($(`${name}-start`).value):0,end=slot.file?Number($(`${name}-end`).value):0;
  for(const key of ["start","end"]){const slider=$(`${name}-${key}-range`);slider.max=duration;slider.value=key==="start"?start:end;}
  const track=$(`${name}-timeline`);track.style.setProperty("--start",`${start/duration*100}%`);track.style.setProperty("--end",`${end/duration*100}%`);
  if(!slot.file)track.style.setProperty("--playhead","0%");
  $(`${name}-clip-label`).textContent=slot.file?`${start.toFixed(2)} → ${end.toFixed(2)} 秒 · 选取 ${(end-start).toFixed(2)} 秒`:"选择视频后，拖动两个端点选取片段";
}
function editClip(name,key,value){
  const slot=slots[name];if(!slot.file||state.busy)return;
  try{const selected=clipBounds(key==="start"?value:Number($(`${name}-start`).value),key==="end"?value:Number($(`${name}-end`).value),slot.duration,key,Number($("fps").value));
    for(const field of ["start","end"])$(`${name}-${field}`).value=String(Math.round(selected[field]*1000000)/1000000);
    invalidate();syncTimeline(name);slot.video.pause();clearTimeout(slot.previewTimer);slot.previewTimer=setTimeout(()=>{if(slot.file&&!state.busy){slot.video.preload="auto";slot.video.currentTime=Math.min(selected[key],slot.duration-.001);}},70);
  }catch(error){message(error.message,true);}
}
async function seek(video,time){
  checkCancelled();time=Math.min(Math.max(0,time),video.duration-0.001);
  if(video.readyState>=2&&Math.abs(video.currentTime-time)<0.0001)return;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>done(Error("读取采样帧超时，请换用普通 MP4 或 WebM。")),10000);
    const onFrame=()=>{if(video.readyState>=2&&Math.abs(video.currentTime-time)<0.03)done();};
    const onError=()=>done(Error("视频解码失败。"));
    function done(error){clearTimeout(timer);for(const event of ["seeked","loadeddata","canplay"])video.removeEventListener(event,onFrame);video.removeEventListener("error",onError);error?reject(error):resolve();}
    for(const event of ["seeked","loadeddata","canplay"])video.addEventListener(event,onFrame);
    video.addEventListener("error",onError,{once:true});video.preload="auto";video.currentTime=time;onFrame();
  });checkCancelled();
}
function clip(name){const slot=slots[name];if(!slot.file)throw Error("请先选择两段视频。");const start=Number($(`${name}-start`).value),end=Number($(`${name}-end`).value),fps=Number($("fps").value);return {start,end,fps,times:sampleTimes(start,end,fps,slot.duration)};}
function frameCanvas(slot){const factor=Math.min(1,LIMITS.processSide/Math.max(slot.sourceWidth,slot.sourceHeight));const canvas=document.createElement("canvas");canvas.width=Math.max(2,Math.round(slot.sourceWidth*factor));canvas.height=Math.max(2,Math.round(slot.sourceHeight*factor));return canvas;}
async function inferFrame(detector,canvas,slot,time){clearTimeout(slot.previewTimer);await seek(slot.video,time);canvas.getContext("2d").drawImage(slot.video,0,0,canvas.width,canvas.height);const bitmap=await createImageBitmap(canvas);try{checkCancelled();const reply=await detector.call("infer",{bitmap,timestamp:Math.round(time*1000)},[bitmap]);return {points:Array.from({length:33},(_,i)=>Array.from(reply.points.slice(i*3,i*3+3))),worldPoints:Array.from({length:33},(_,i)=>Array.from(reply.worldPoints.slice(i*4,i*4+4)))};}finally{bitmap.close();}}
async function newDetector(){state.worker?.destroy();const detector=new Detector();state.worker=detector;await detector.call("init");checkCancelled();return detector;}
function drawPose(ctx,points,color,thresholdValue,scale=1,ox=0,oy=0){
  const indices=new Set(Object.values($("detail").value==="body"?BODY_JOINTS:JOINTS));
  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;
  for(const [a,b] of EDGES){if(!indices.has(a)||!indices.has(b)||!valid(points[a],thresholdValue)||!valid(points[b],thresholdValue))continue;ctx.beginPath();ctx.moveTo(ox+points[a][0]*scale,oy+points[a][1]*scale);ctx.lineTo(ox+points[b][0]*scale,oy+points[b][1]*scale);ctx.stroke();}
  for(const index of indices){const p=points[index];if(!valid(p,thresholdValue))continue;const x=ox+p[0]*scale,y=oy+p[1]*scale;ctx.beginPath();ctx.arc(x,y,index<11?2:3,0,Math.PI*2);ctx.fill();if($("point-labels").checked)ctx.fillText(String(index),x+5,y-4);}
}
function paintVideo(slot){
  const data=slot.result||((slot.name==="user"&&state.probe)?state.probe:null);if(!data||!slot.file)return;
  const frame=slot.result?slot.result.points[nearest(slot.result.times,slot.video.currentTime)]:state.probe.points;
  const canvas=slot.overlay,dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(slot.video.clientWidth*dpr);canvas.height=Math.round(slot.video.clientHeight*dpr);
  const first=slot.result?data.times[0]:data.time,last=slot.result?data.times.at(-1):data.time;
  if(slot.video.currentTime<first-0.5/data.fps||slot.video.currentTime>last+0.5/data.fps)return;
  const ctx=canvas.getContext("2d"),scale=Math.min(canvas.width/data.width,canvas.height/data.height);ctx.font=`${11*dpr}px sans-serif`;
  drawPose(ctx,frame,COLORS[slot.name==="user"?0:1],threshold(),scale,(canvas.width-data.width*scale)/2,(canvas.height-data.height*scale)/2);
}
async function probe(){await run(async()=>{invalidate();const config=clip("user");message("正在加载本地 Lite 模型，随后识别一帧……");const detector=await newDetector(),slot=slots.user,canvas=frameCanvas(slot),time=config.start;const frame=await inferFrame(detector,canvas,slot,time);state.probe={...frame,width:canvas.width,height:canvas.height,time,fps:config.fps};paintVideo(slot);const count=bodyCount(frame.points);message(count>=4?`一帧测试成功：${count} 个身体关键点通过过滤。确认骨架后，可以分析两段视频。`:"模型已运行，但这一帧没有足够的身体关键点。请调整起点、换清楚的单人视频或降低过滤值。",count<4);});}
async function analyze(){await run(async()=>{
  const configs={user:clip("user"),target:clip("target")};invalidate(false);$("bar").hidden=false;$("bar").value=0;
  const total=configs.user.times.length+configs.target.times.length;let done=0;const pair={};
  for(const name of ["user","target"]){
    const slot=slots[name],config=configs[name],canvas=frameCanvas(slot),points=[],worldPoints=[];
    message(`正在加载${name==="user"?"我的":"参考"}视频的本地模型……`);const detector=await newDetector();
    for(const time of config.times){checkCancelled();const frame=await inferFrame(detector,canvas,slot,time);points.push(frame.points);worldPoints.push(frame.worldPoints);done++;$("bar").value=done/total;message(`正在识别${name==="user"?"我的":"参考"}视频 · ${points.length}/${config.times.length} 帧`);await sleep(0);}
    detector.destroy();state.worker=null;
    const detected=points.filter(p=>bodyCount(p)>=4).length;
    if(detected<2)throw Error(`${name==="user"?"我的":"参考"}视频有效人体帧不足，无法比较。请换清楚的单人全身视频。`);
    pair[name]={...config,points,worldPoints,width:canvas.width,height:canvas.height,detected,fileName:slot.file.name};
  }
  state.pair=pair;for(const name of ["user","target"]){slots[name].result=pair[name];paintVideo(slots[name]);}
  $("results").hidden=false;$("summary").textContent=`我的视频：${pair.user.detected}/${pair.user.points.length} 帧检出身体；参考：${pair.target.detected}/${pair.target.points.length} 帧。比例不代表准确率。骨架来自采样时刻，标注导出为采样无声片段。`;
  refreshCharts();message("两段视频分析完成，所有计算都在本机。可以查看图表或下载结果。");
});}

function selectedAngles(){return [...$("angle-options").querySelectorAll("input:checked")].map(input=>input.value);}
function compared(){const pair=state.pair;if(!pair)return null;const tp=$("mirror").checked?mirrorWorld(pair.target.worldPoints):pair.target.worldPoints;return {pair,tp,ua:worldAngles(pair.user.worldPoints,threshold()),ta:worldAngles(tp,threshold())};}
function drawSkeleton(){const position=Number($("position").value);$("position-label").value=position+"%";view3d.setPosition(position);}
const NS="http://www.w3.org/2000/svg";
function svgElement(tag,attrs,text){const element=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attrs||{}))element.setAttribute(key,String(value));if(text!==undefined)element.textContent=text;return element;}
function chart(container,title,series,{xLabel="动作进度（%）",yLabel="内角（°）",yRange=null,trajectory=false}={}){
  container.replaceChildren();const box=document.createElement("div");box.className="chart";const heading=document.createElement("p");heading.className="chart-title";heading.textContent=title;box.append(heading);
  const svg=svgElement("svg",{viewBox:"0 0 540 285",role:"img","aria-label":title});const xs=series.flatMap(s=>s.x.filter(Number.isFinite)),ys=series.flatMap(s=>s.y.filter(Number.isFinite));
  let xmin=trajectory&&xs.length?Math.min(...xs):0,xmax=trajectory&&xs.length?Math.max(...xs):100,ymin=yRange?.[0]??(ys.length?Math.min(...ys):0),ymax=yRange?.[1]??(ys.length?Math.max(...ys):1);
  if(xmax-xmin<1e-6){xmin-=0.5;xmax+=0.5;}if(ymax-ymin<1e-6){ymin-=0.5;ymax+=0.5;}
  if(!yRange){const pad=(ymax-ymin)*0.08;ymin-=pad;ymax+=pad;}
  if(trajectory){const xp=(xmax-xmin)*0.08;xmin-=xp;xmax+=xp;const range=Math.max((xmax-xmin)/455,(ymax-ymin)/210);const xm=(xmin+xmax)/2,ym=(ymin+ymax)/2;xmin=xm-range*455/2;xmax=xm+range*455/2;ymin=ym-range*210/2;ymax=ym+range*210/2;}
  const px=x=>60+(x-xmin)/(xmax-xmin)*455,py=y=>235-(y-ymin)/(ymax-ymin)*210;
  for(let i=0;i<=4;i++){const y=ymin+(ymax-ymin)*i/4;svg.append(svgElement("line",{x1:60,y1:py(y),x2:515,y2:py(y),stroke:"#e6ece6"}));svg.append(svgElement("text",{x:52,y:py(y)+4,"text-anchor":"end",fill:"#6b786c","font-size":11},y.toFixed(trajectory||ymax-ymin<5?2:0)));const x=xmin+(xmax-xmin)*i/4;svg.append(svgElement("text",{x:px(x),y:255,"text-anchor":"middle",fill:"#6b786c","font-size":11},x.toFixed(trajectory?2:0)));}
  svg.append(svgElement("text",{x:288,y:279,"text-anchor":"middle",fill:"#6b786c","font-size":11},xLabel));svg.append(svgElement("text",{x:10,y:12,fill:"#6b786c","font-size":10},yLabel));
  for(const [index,s] of series.entries()){let path="",open=false;for(let i=0;i<s.x.length;i++){if(!Number.isFinite(s.x[i])||!Number.isFinite(s.y[i])){open=false;continue;}path+=(open?"L":"M")+px(s.x[i]).toFixed(2)+","+py(s.y[i]).toFixed(2);open=true;if(trajectory&&i%10===0)svg.append(svgElement("circle",{cx:px(s.x[i]),cy:py(s.y[i]),r:2,fill:s.color||COLORS[index]}));}svg.append(svgElement("path",{d:path,fill:"none",stroke:s.color||COLORS[index],"stroke-width":2}));}
  if(!ys.length)svg.append(svgElement("text",{x:285,y:135,"text-anchor":"middle",fill:"#79867a","font-size":14},"此指标没有可用数据"));
  box.append(svg);const legend=document.createElement("div");legend.className="legend";for(const [index,s] of series.entries()){const label=document.createElement("span");label.textContent=(index===0?"● ":"● ")+s.name;label.style.color=s.color||COLORS[index];legend.append(label);}box.append(legend);container.append(box);
}
function refreshCharts(){
  const data=compared();if(!data)return;const {pair,tp,ua,ta}=data;const grid=GRID.map(x=>100*x);$("angle-charts").replaceChildren();$("angle-table").replaceChildren();const differences=[];
  for(const name of selectedAngles()){
    const u=resample(pair.user.times,ua[name]),t=resample(pair.target.times,ta[name]),diff=difference(u,t),row=document.createElement("tr");for(const value of [name,diff.mean===null?"—":diff.mean.toFixed(2),`${(diff.coverage*100).toFixed(0)}%`]){const cell=document.createElement("td");cell.textContent=value;row.append(cell);}$("angle-table").append(row);
    const container=document.createElement("div");$("angle-charts").append(container);chart(container,name,[{name:"我",x:grid,y:u},{name:"参考",x:grid,y:t}],{yRange:[0,180]});differences.push({name: name+"绝对差",x:grid,y:u.map((v,i)=>Math.abs(v-t[i])),color:COLORS[differences.length%2]});
  }
  chart($("difference-chart"),"与参考的角度差异",differences,{yRange:[0,Math.max(1,...differences.flatMap(s=>s.y.filter(Number.isFinite)))]});
  const joint=Number($("joint").value),un=normalizeWorld(pair.user.worldPoints,threshold()),tn=normalizeWorld(tp,threshold());
  const xy=[pair.user,pair.target].map((result,i)=>[0,1,2].map(k=>resample(result.times,(i?tn:un).map(p=>p[joint][k]))));
  chart($("trajectory-chart"),$("joint").selectedOptions[0].textContent+" · 三维轨迹的 XY 投影",xy.map((p,i)=>({name:i?"参考":"我",x:p[0],y:p[1]})),{trajectory:true,xLabel:"X（躯干长度单位）",yLabel:"Y 向上（躯干长度单位）"});
  for(const [axis,id] of [[0,"x-chart"],[1,"y-chart"],[2,"z-chart"]])chart($(id),["X","Y","Z"][axis]+" 运动曲线",xy.map((p,i)=>({name:i?"参考":"我",x:grid,y:p[axis]})),{yLabel:"躯干长度单位"});
  view3d.setData([resamplePoses(pair.user.times,un),resamplePoses(pair.target.times,tn)],{indices:Object.values($("detail").value==="body"?BODY_JOINTS:JOINTS),labels:$("point-labels").checked,joint,trail:$("show-trail").checked,separate:$("view-mode").value==="separate"});
  drawSkeleton();for(const slot of Object.values(slots))paintVideo(slot);
}
function download(blob,name){const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function exportCsv(){const {pair,tp,ua,ta}=compared(),columns={progress_percent:GRID.map(x=>x*100)};for(const name of selectedAngles()){columns[`my_3d_${name}_deg`]=resample(pair.user.times,ua[name]);columns[`target_3d_${name}_deg`]=resample(pair.target.times,ta[name]);}for(const [name,result,poses] of [["my",pair.user,pair.user.worldPoints],["target",pair.target,tp]]){const n=normalizeWorld(poses,threshold()),j=Number($("joint").value);for(const k of [0,1,2])columns[`${name}_${$("joint").selectedOptions[0].textContent}_${["x","y","z"][k]}_torso_unit`]=resample(result.times,n.map(p=>p[j][k]));}download(new Blob([toCsv(columns)],{type:"text/csv;charset=utf-8"}),"pose_comparison_3d.csv");}
async function exportVideo(name){await run(async()=>{
  if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream)throw Error("此浏览器不支持标注视频导出，可下载关键点 JSON / CSV。");
  const result=state.pair[name],slot=slots[name],canvas=frameCanvas(slot),ctx=canvas.getContext("2d"),stream=canvas.captureStream(0),track=stream.getVideoTracks()[0];
  if(!track.requestFrame){track.stop();throw Error("此浏览器不支持逐帧导出，请使用 Chrome。");}
  const mime=["video/mp4;codecs=avc1.42001E","video/webm;codecs=vp8","video/webm"].find(t=>MediaRecorder.isTypeSupported(t));if(!mime){track.stop();throw Error("浏览器没有可用的视频编码格式。");}
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:700000}),chunks=[];let bytes=0,recordError=null;
  recorder.ondataavailable=event=>{bytes+=event.data.size;if(bytes>32*1024*1024){recordError=Error("导出超过 32 MiB 限制，请缩短区间。");state.cancelled=true;}else if(event.data.size)chunks.push(event.data);};
  recorder.onerror=event=>{recordError=event.error||Error("视频编码失败。");};
  const stopped=new Promise(resolve=>recorder.onstop=resolve);
  $("bar").hidden=false;let started=false;
  try{recorder.start(1000);started=true;for(let i=0;i<result.times.length;i++){checkCancelled();if(recordError)throw recordError;await seek(slot.video,result.times[i]);ctx.drawImage(slot.video,0,0,canvas.width,canvas.height);ctx.font="10px sans-serif";drawPose(ctx,result.points[i],COLORS[name==="user"?0:1],threshold());ctx.fillStyle="white";ctx.fillText(`t=${(result.times[i]-result.start).toFixed(2)}s`,10,18);track.requestFrame();$("bar").value=(i+1)/result.times.length;message(`正在导出${name==="user"?"我的":"参考"}标注片段 · ${i+1}/${result.times.length}（采样无声视频）`);await sleep(1000/result.fps);}}
  finally{if(recorder.state!=="inactive")recorder.stop();if(started)await stopped;for(const t of stream.getTracks())t.stop();}
  checkCancelled();if(recordError)throw recordError;const blob=new Blob(chunks,{type:mime});if(blob.size<1000)throw Error("浏览器未生成有效视频，请下载关键点结果或换用 Chrome 重试。");download(blob,`${name}_pose.${mime.startsWith("video/mp4")?"mp4":"webm"}`);message("标注片段已生成，浏览器会保存下载文件。片段无声，时长按采样帧率生成。");
});}

let measuring=false;
async function measureMemory(){
  if(measuring)return;measuring=true;
  try{let bytes=null,kind="";if(performance.measureUserAgentSpecificMemory){bytes=(await performance.measureUserAgentSpecificMemory()).bytes;kind="页面及其模型线程归因内存";}else if(performance.memory){bytes=performance.memory.usedJSHeapSize;kind="JavaScript 堆（不含全部模型及浏览器开销）";}if(bytes!==null){$("memory-info").textContent=`${kind}：${(bytes/1024/1024).toFixed(1)} MiB。总运行内存上限 1 GB，完整进程占用请在任务管理器核对。`;if(bytes>LIMITS.memoryBytes*0.9){state.memoryExceeded=true;state.cancelled=true;state.worker?.destroy();message("内存读数接近上限，已停止处理。请清空视频或关闭页面后重试。",true);controls();}}}
  catch{$("memory-info").textContent="当前浏览器不提供完整页面内存读数，请用任务管理器检查 1 GB 上限。";}finally{measuring=false;}
}
for(const name of ["user","target"]){
  const slot=slots[name]={name,video:$(`${name}-video`),overlay:$(`${name}-overlay`),file:null,url:null,result:null,revision:0};
  slot.video.parentElement.insertAdjacentHTML("afterend",`<div class="clip-picker"><p id="${name}-clip-label" class="muted">选择视频后，拖动两个端点选取片段</p><div class="clip-timeline" id="${name}-timeline"><div class="clip-track"></div><span class="clip-playhead"></span><input id="${name}-start-range" type="range" min="0" max="1" step="0.01" value="0" aria-label="${name==="user"?"我的":"参考"}视频开始时间" disabled><input id="${name}-end-range" type="range" min="0" max="1" step="0.01" value="0" aria-label="${name==="user"?"我的":"参考"}视频结束时间" disabled></div><div class="clip-key"><span>绿色端点：开始</span><span>橙色端点：结束</span></div></div>`);
  $(`${name}-file`).addEventListener("change",event=>void loadVideo(name,event.target.files[0]));
  for(const key of ["start","end"]){$(`${name}-${key}`).addEventListener("change",e=>editClip(name,key,Number(e.target.value)));$(`${name}-${key}-range`).addEventListener("input",e=>editClip(name,key,Number(e.target.value)));}
  const timeline=$(`${name}-timeline`);
  timeline.addEventListener("pointerdown",event=>{if(event.target.tagName==="INPUT"||!slot.file||state.busy)return;event.preventDefault();const rect=timeline.getBoundingClientRect(),time=(event.clientX-rect.left)/rect.width*slot.duration,start=Number($(`${name}-start`).value),end=Number($(`${name}-end`).value);slot.rangeDrag={id:event.pointerId,key:Math.abs(time-start)<Math.abs(time-end)?"start":"end"};timeline.setPointerCapture(event.pointerId);editClip(name,slot.rangeDrag.key,time);});
  timeline.addEventListener("pointermove",event=>{if(slot.rangeDrag?.id!==event.pointerId)return;const rect=timeline.getBoundingClientRect();editClip(name,slot.rangeDrag.key,(event.clientX-rect.left)/rect.width*slot.duration);});
  for(const event of ["pointerup","pointercancel","lostpointercapture"])timeline.addEventListener(event,e=>{if(slot.rangeDrag?.id===e.pointerId){slot.rangeDrag=null;if(timeline.hasPointerCapture(e.pointerId))timeline.releasePointerCapture(e.pointerId);}});
  for(const event of ["timeupdate","seeked"])slot.video.addEventListener(event,()=>timeline.style.setProperty("--playhead",`${slot.file?slot.video.currentTime/slot.duration*100:0}%`));
  slot.video.addEventListener("seeked",()=>paintVideo(slot));slot.video.addEventListener("play",()=>{const tick=()=>{paintVideo(slot);if(!slot.video.paused)requestAnimationFrame(tick);};tick();});
  $(`${name}-export`).addEventListener("click",()=>void exportVideo(name));
}
for(const name of Object.keys(ANGLES)){const label=document.createElement("label"),input=document.createElement("input");input.type="checkbox";input.value=name;input.checked=name.includes("膝");input.addEventListener("change",refreshCharts);label.append(input,document.createTextNode(" "+name));$("angle-options").append(label);}
for(const [name,index] of Object.entries(JOINTS)){const option=new Option(`${name} · ${index}`,String(index));$("joint").append(option);}$("joint").value="16";
for(const id of ["detail","point-labels","mirror","joint","view-mode","show-trail","threshold"])$(id).addEventListener("change",()=>{refreshCharts();for(const slot of Object.values(slots))paintVideo(slot);controls();});
for(const name of ["front","side","top"])$("view-"+name).addEventListener("click",()=>view3d.preset(name));$("view-reset").addEventListener("click",()=>view3d.reset());
$("fps").addEventListener("change",()=>{invalidate();for(const name of ["user","target"])if(slots[name].file)editClip(name,"end",Number($(`${name}-end`).value));});
$("position").addEventListener("input",()=>{drawSkeleton();const revision=++state.previewRevision;void(async()=>{if(!state.pair)return;const q=Number($("position").value)/100;for(const name of ["user","target"]){if(revision!==state.previewRevision||state.busy)return;const result=state.pair[name];try{await seek(slots[name].video,result.times[0]+q*(result.times.at(-1)-result.times[0]));}catch{}paintVideo(slots[name]);}})();});
$("probe").addEventListener("click",()=>void probe());$("analyze").addEventListener("click",()=>void analyze());
$("cancel").addEventListener("click",()=>{state.cancelled=true;state.worker?.destroy();});
$("clear").addEventListener("click",()=>{invalidate();state.memoryExceeded=false;for(const name of ["user","target"]){$(`${name}-file`).value="";void loadVideo(name,null);}$("summary").textContent="已释放视频与结果。选择新视频后可以继续。";message("已清空视频和识别结果。");});
$("csv").addEventListener("click",exportCsv);$("json").addEventListener("click",()=>{download(new Blob([JSON.stringify({schemaVersion:2,model:"MediaPipe Pose Landmarker Lite",runtimeVersion:"1.0.1",coordinateSpace:"model_estimated_world_xyz_meters_hip_origin",worldColumns:["x_m","y_m","z_m","min_visibility_presence"],worldDisplayTransform:"hip-centred fixed torso units; Y and Z negated",imageCoordinateSpace:"image_2d_pixels",landmarkNames:Object.fromEntries(Object.entries(JOINTS).map(([name,index])=>[index,name])),columns:["x_px","y_px","min_visibility_presence"],missingValue:null,mirrorApplied:false,...state.pair},null,2)],{type:"application/json"}),"pose_landmarks_3d.json");});
window.addEventListener("resize",()=>{for(const slot of Object.values(slots))paintVideo(slot);});
window.addEventListener("beforeunload",()=>{state.worker?.destroy();view3d.dispose();for(const slot of Object.values(slots)){clearTimeout(slot.previewTimer);if(slot.url)URL.revokeObjectURL(slot.url);}});
controls();
try{const response=await fetch("/api/status"),info=await response.json();state.ready=info.ready;$("resource-info").textContent=`当前项目文件 ${(info.project_bytes/1024/1024).toFixed(2)} MiB · 本地运行库 ${info.runtime_version||"缺失"} · 硬盘上限 5 GB`;message(info.ready?"本地资源就绪。选择视频后，先测试一帧。":"本地资源缺失、版本不匹配或项目超过磁盘上限，请检查资源目录。",!info.ready);controls();}catch{message("无法连接本地启动服务，请运行 start.ps1，不要直接双击 HTML。",true);}
setInterval(()=>void measureMemory(),15000);
