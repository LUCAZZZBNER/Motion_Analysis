import {FilesetResolver,PoseLandmarker} from "./assets/vendor/tasks-vision/vision_bundle.mjs";
let detector=null, canvas=null;
self.onmessage=async({data})=>{
  const {id,type}=data;
  try {
    if(type==="init") {
      const files=await FilesetResolver.forVisionTasks(new URL("./assets/vendor/tasks-vision/wasm",import.meta.url).href,true);
      detector=await PoseLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetPath:new URL("./assets/models/pose_landmarker_lite.task",import.meta.url).href,delegate:"CPU"},
        runningMode:"VIDEO",numPoses:2,outputSegmentationMasks:false,
        minPoseDetectionConfidence:0.5,minPosePresenceConfidence:0.5,minTrackingConfidence:0.5,
      });
      self.postMessage({id,ready:true});
    } else if(type==="infer") {
      if(!detector) throw Error("模型尚未加载。");
      if(data.bitmap.width>480||data.bitmap.height>480) throw Error("处理画面超过轻量限制。");
      if(!canvas) canvas=new OffscreenCanvas(data.bitmap.width,data.bitmap.height);
      canvas.width=data.bitmap.width; canvas.height=data.bitmap.height;
      canvas.getContext("2d").drawImage(data.bitmap,0,0); data.bitmap.close();
      const result=detector.detectForVideo(canvas,data.timestamp);
      try {
        if(result.landmarks.length>1) throw Error("采样画面检测到多个人，请换用单人视频或调整区间。");
        const points=new Float32Array(33*3).fill(NaN),worldPoints=new Float32Array(33*4).fill(NaN);
        const pose=result.landmarks[0];
        if(pose) pose.forEach((p,i)=>{
          points[i*3]=p.x*(canvas.width-1); points[i*3+1]=p.y*(canvas.height-1);
          points[i*3+2]=Math.min(p.visibility??0,p.presence??1);
        });
        const world=result.worldLandmarks[0];
        if(world)world.forEach((p,i)=>{worldPoints[i*4]=p.x;worldPoints[i*4+1]=p.y;worldPoints[i*4+2]=p.z;worldPoints[i*4+3]=Math.min(points[i*3+2],p.visibility??1,p.presence??1);});
        self.postMessage({id,points,worldPoints,poses:result.landmarks.length},[points.buffer,worldPoints.buffer]);
      } finally { result.close(); }
    } else throw Error("未知识别操作。");
  } catch(error) {
    data.bitmap?.close();
    self.postMessage({id,error:error?.message||"本地识别失败。"});
  }
};
