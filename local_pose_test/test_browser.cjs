// Run with an existing Playwright installation: NODE_PATH=... node test_browser.cjs.
// No test dependency or browser is downloaded by this file.
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const dir=path.join(__dirname,'.test');fs.mkdirSync(dir,{recursive:true});
const base='http://127.0.0.1:8000';
(async()=>{
  const browser=await chromium.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
  const page=await context.newPage(),errors=[],remote=[],consoleLines=[],memory=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>consoleLines.push(`${m.type()}: ${m.text()}`));
  context.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(base))remote.push(r.url());});
  let timer;
  async function mem(){try{const cdp=await browser.newBrowserCDPSession();const info=await cdp.send('SystemInfo.getProcessInfo');await cdp.detach();const ids=info.processInfo.map(p=>p.id).join(',');const output=execFileSync('powershell.exe',['-NoProfile','-Command',`(Get-Process -Id ${ids} -ErrorAction SilentlyContinue | Measure-Object -Property WorkingSet64 -Sum).Sum`],{encoding:'utf8',windowsHide:true});memory.push(Number(output.trim()));}catch{}}
  try{
    await page.goto(base);await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('资源就绪'));
    await page.screenshot({path:path.join(dir,'initial.png'),fullPage:true});
    const headers=(await context.request.get(base+'/pose-worker.mjs')).headers();assert.match(headers['content-type'],/javascript/);
    assert.equal((await context.request.get(base+'/app.py')).status(),404);
    assert.equal((await context.request.get(base+'/assets/')).status(),404);
    assert.equal((await context.request.post(base+'/upload',{data:'test'})).status(),501);
    const status=await (await context.request.get(base+'/api/status')).json();assert.equal(status.cloud_inference,false);
    assert.equal((await context.request.get(base+'/assets/vendor/%2e%2e/%2e%2e/app.py')).status(),404);
    timer=setInterval(()=>void mem(),1500);
    // Exercise the actual model: no person in a generated frame must return missing landmarks.
    const real=await page.evaluate(async()=>{
      const worker=new Worker('/pose-worker.mjs',{type:'module'});let id=0;
      const call=(type,data={},transfer=[])=>new Promise((resolve,reject)=>{const next=++id,timer=setTimeout(()=>reject(Error('Worker test timeout')),60000);worker.onmessage=({data})=>{if(data.id!==next)return;clearTimeout(timer);data.error?reject(Error(data.error)):resolve(data);};worker.onerror=e=>reject(Error(e.message));worker.postMessage({id:next,type,...data},transfer);});
      try{await call('init');const canvas=document.createElement('canvas');canvas.width=480;canvas.height=270;const ctx=canvas.getContext('2d');ctx.fillStyle='#dfe5e0';ctx.fillRect(0,0,480,270);let reply;
        for(let i=0;i<160;i++){const bitmap=await createImageBitmap(canvas);reply=await call('infer',{bitmap,timestamp:i*125},[bitmap]);}
        return {poses:reply.poses,missing:[...reply.points].every(Number.isNaN),length:reply.points.length,worldMissing:[...reply.worldPoints].every(Number.isNaN),worldLength:reply.worldPoints.length};
      }finally{worker.terminate();}
    });assert.deepEqual(real,{poses:0,missing:true,length:99,worldMissing:true,worldLength:132});await mem();console.log('Real CPU model:',real);
    // Generate a short input locally. No media is fetched from the internet.
    const fixture=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');
      const mime=['video/mp4;codecs=avc1.42001E','video/webm;codecs=vp8'].find(t=>MediaRecorder.isTypeSupported(t));
      document.body.append(canvas);ctx.fillStyle='#edf2ee';ctx.fillRect(0,0,320,240);
      const stream=canvas.captureStream(0),track=stream.getVideoTracks()[0],recorder=new MediaRecorder(stream,{mimeType:mime}),chunks=[];
      recorder.ondataavailable=e=>chunks.push(e.data);const stopped=new Promise(r=>recorder.onstop=r),started=new Promise(r=>recorder.onstart=r);recorder.start(500);await started;
      for(let i=0;i<20;i++){ctx.fillStyle='#edf2ee';ctx.fillRect(0,0,320,240);ctx.fillStyle='#687c6e';ctx.fillRect(50+i,80,40,40);track.requestFrame();await new Promise(r=>setTimeout(r,100));}
      recorder.stop();await stopped;stream.getTracks().forEach(t=>t.stop());canvas.remove();return {mime,bytes:[...new Uint8Array(await new Blob(chunks).arrayBuffer())]};
    });const videoPath=path.join(dir,fixture.mime.startsWith('video/mp4')?'blank.mp4':'blank.webm');fs.writeFileSync(videoPath,Buffer.from(fixture.bytes));
    await page.locator('#user-file').setInputFiles(videoPath);await page.waitForFunction(()=>!document.querySelector('#probe').disabled);await page.locator('#probe').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('模型已运行'),{},{timeout:60000});assert.equal(await page.locator('#analyze').isDisabled(),true);console.log('Real uploaded-video probe:',await page.locator('#status').innerText());
    // Deterministic landmarks validate the comparison UI independently of model accuracy.
    await context.addInitScript(()=>{
      const RealWorker=window.Worker;window.Worker=class{
        constructor(url,options){if(!String(url).endsWith('pose-worker.mjs'))return new RealWorker(url,options);this.dead=false;}
        postMessage(data){if(this.dead)return;setTimeout(()=>{if(this.dead)return;let reply={id:data.id,ready:true};if(data.type==='infer'){const p=new Float32Array(99).fill(NaN),t=data.timestamp/1000;
          const pts={0:[160,40],2:[151,38],3:[146,38],4:[166,38],5:[169,38],6:[174,38],7:[140,44],8:[180,44],9:[155,50],10:[165,50],11:[130,70],12:[190,70],13:[110,95],14:[210,95],15:[95,120],16:[225+10*Math.sin(t*4),120],17:[88,130],18:[232,130],19:[85,127],20:[235,127],21:[92,122],22:[228,122],23:[140,130],24:[180,130],25:[140,175],26:[180,175],27:[140,220],28:[180,220],29:[140,222],30:[180,222],31:[130,225],32:[190,225]};
          const world=new Float32Array(132).fill(NaN);
          for(const [j,[x,y]] of Object.entries(pts)){if(window.__poseFixtureHeadOnly&&Number(j)>10)continue;const i=Number(j);p[i*3]=x;p[i*3+1]=y;p[i*3+2]=.95;world[i*4]=(x-160)/100;world[i*4+1]=(y-130)/100;world[i*4+2]=i===16?.15*Math.sin(t*4):i===25?.1:i===27?.2:0;world[i*4+3]=.95;}data.bitmap.close();reply={id:data.id,points:p,worldPoints:world};}
          this.onmessage?.({data:reply});},10);}
        terminate(){this.dead=true;}
      };
    });await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('资源就绪'));
    await page.locator('#user-file').setInputFiles(videoPath);await page.locator('#target-file').setInputFiles(videoPath);await page.waitForFunction(()=>!document.querySelector('#probe').disabled&&document.querySelector('#target-info').textContent.includes('320×240'));
    // Drag the actual native endpoint thumb, then verify numeric/slider/preview synchronization.
    const timeline=await page.locator('#user-timeline').boundingBox();await page.mouse.move(timeline.x+9,timeline.y+18);await page.mouse.down();await page.mouse.move(timeline.x+timeline.width*.2,timeline.y+18,{steps:8});await page.mouse.up();
    const chosenStart=Number(await page.locator('#user-start').inputValue());assert.ok(chosenStart>.1);await page.waitForFunction(start=>Math.abs(document.querySelector('#user-video').currentTime-start)<.04,chosenStart);
    assert.ok(Math.abs(Number(await page.locator('#user-start-range').inputValue())-chosenStart)<.02);
    const duration=await page.locator('#target-video').evaluate(v=>v.duration);await page.locator('#target-end-range').fill(String(Math.floor(duration*.8*100)/100));await page.locator('#target-end-range').dispatchEvent('input');assert.ok(Number(await page.locator('#target-end').inputValue())<duration);
    await page.locator('#user-start').fill('0');await page.locator('#user-start').dispatchEvent('change');
    await page.evaluate(()=>{const arc=CanvasRenderingContext2D.prototype.arc;window.__drawnPoints=[];CanvasRenderingContext2D.prototype.arc=function(...args){if(this.canvas.id==='user-overlay')window.__drawnPoints.push(args[0]);return arc.apply(this,args);};});
    await page.locator('#probe').click();await page.waitForFunction(()=>!document.querySelector('#analyze').disabled);
    assert.equal(await page.locator('#joint option').count(),33);assert.equal(await page.evaluate(()=>window.__drawnPoints.length),32);
    await page.evaluate(()=>window.__drawnPoints=[]);await page.locator('#detail').selectOption('body');assert.equal(await page.evaluate(()=>window.__drawnPoints.length),12);
    await page.evaluate(()=>window.__drawnPoints=[]);await page.locator('#detail').selectOption('all');assert.equal(await page.evaluate(()=>window.__drawnPoints.length),32);await page.locator('#point-labels').check();
    await page.evaluate(()=>window.__poseFixtureHeadOnly=true);await page.locator('#probe').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('模型已运行'));assert.equal(await page.locator('#analyze').isDisabled(),true);
    await page.evaluate(()=>window.__poseFixtureHeadOnly=false);await page.locator('#probe').click();await page.waitForFunction(()=>!document.querySelector('#analyze').disabled);
    await page.locator('#analyze').click();await page.locator('#cancel').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已停止'));assert.equal(await page.locator('#results').isVisible(),false);
    await page.locator('#analyze').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('分析完成'));
    assert.equal(await page.locator('#angle-table tr').count(),2);assert.equal(await page.locator('#angle-table tr').first().locator('td').nth(1).innerText(),'0.00');
    assert.equal(await page.locator('#angle-charts svg').count(),2);assert.ok(await page.locator('#trajectory-chart path').count());
    await page.locator('#mirror').check();await page.locator('#mirror').uncheck();await page.locator('#joint').selectOption('29');assert.ok(await page.locator('#trajectory-chart path').evaluateAll(paths=>paths.every(p=>p.getAttribute('d').length>0)));assert.equal(await page.locator('#z-chart svg').count(),1);
    await page.locator('#skeleton').scrollIntoViewIfNeeded();const orbit=await page.locator('#skeleton').boundingBox();await page.waitForTimeout(60);const yaw=await page.locator('#skeleton').getAttribute('data-yaw');const canvasBefore=await page.locator('#skeleton').evaluate(c=>c.toDataURL());await page.mouse.move(orbit.x+orbit.width*.45,orbit.y+orbit.height*.4);await page.mouse.down();await page.mouse.move(orbit.x+orbit.width*.65,orbit.y+orbit.height*.55,{steps:10});await page.mouse.up();await page.waitForTimeout(100);assert.notEqual(await page.locator('#skeleton').getAttribute('data-yaw'),yaw);assert.notEqual(await page.locator('#skeleton').evaluate(c=>c.toDataURL()),canvasBefore);
    await page.mouse.wheel(0,-200);await page.waitForTimeout(80);assert.ok(Number(await page.locator('#skeleton').getAttribute('data-zoom'))>1);await page.locator('#view-top').click();await page.waitForTimeout(80);assert.ok(Number(await page.locator('#skeleton').getAttribute('data-pitch'))>1.5);await page.locator('#view-side').click();await page.locator('#view-mode').selectOption('separate');await page.locator('#show-trail').check();await page.locator('#view-reset').click();
    await page.locator('#position').fill('70');await page.locator('#position').dispatchEvent('input');
    const csvPromise=page.waitForEvent('download');await page.locator('#csv').click();const csv=await csvPromise;await csv.saveAs(path.join(dir,'comparison.csv'));assert.equal(fs.readFileSync(path.join(dir,'comparison.csv'),'utf8').split('\r\n').length,102);assert.match(fs.readFileSync(path.join(dir,'comparison.csv'),'utf8'),/左脚跟.*z_torso_unit/);
    const jsonPromise=page.waitForEvent('download');await page.locator('#json').click();const json=await jsonPromise;await json.saveAs(path.join(dir,'landmarks.json'));const parsed=JSON.parse(fs.readFileSync(path.join(dir,'landmarks.json'),'utf8'));assert.equal(parsed.user.points[0].length,33);assert.equal(parsed.user.points[0][1][0],null);assert.equal(parsed.landmarkNames['29'],'左脚跟');assert.equal(parsed.user.worldPoints[0].length,33);assert.equal(parsed.user.worldPoints[0][16].length,4);assert.equal(parsed.worldColumns[2],'z_m');assert.equal(parsed.schemaVersion,2);
    await page.screenshot({path:path.join(dir,'comparison.png'),fullPage:true});
    const videoPromise=page.waitForEvent('download');await page.locator('#user-export').click();const video=await videoPromise;const exported=path.join(dir,video.suggestedFilename());await video.saveAs(exported);assert.ok(fs.statSync(exported).size>1000);
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('片段已生成'));
    const encodedBytes=fs.readFileSync(exported).toString('base64');const decoded=await page.evaluate(async bytes=>{const video=document.createElement('video'),url=URL.createObjectURL(new Blob([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],{type:'video/mp4'}));video.src=url;try{await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(Error('Cannot decode annotated video'));});return {duration:video.duration,width:video.videoWidth,height:video.videoHeight};}finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}},encodedBytes);assert.equal(decoded.width,320);assert.equal(decoded.height,240);assert.ok(decoded.duration>0);
    await page.locator('#clear').click();assert.equal(await page.locator('#results').isVisible(),false);
    // Mobile layout has no horizontal overflow.
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);await mem();
    const report={real_model:real,real_model_frames:160,real_uploaded_video_probe:true,clip_handle_drag:true,three_dimensional_rotation_zoom_and_views:true,comparison_ui:'deterministic XYZ landmark fixture; not a human accuracy test',csv_json_annotated_video:true,annotated_video_decoded:decoded,cancellation:true,external_requests:remote,console:consoleLines,page_errors:errors,chrome_working_set_peak_bytes:Math.max(...memory),memory_samples:memory};fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(report,null,2));console.log('Browser checks passed; Chrome sampled peak MB:',report.chrome_working_set_peak_bytes/1e6);
  }catch(e){console.log('Console:',consoleLines);await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true});throw e;}
  finally{clearInterval(timer);await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
