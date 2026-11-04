"use strict";
(() => {
 const $=id=>document.getElementById(id);
 const originals=document.createElement("canvas"), source=originals.getContext("2d",{willReadFrequently:false});
 const canvas=$("editCanvas"),ctx=canvas.getContext("2d",{willReadFrequently:false});
 const state={ready:false,detected:false,fallback:false,loading:false,ops:[],redo:[],mode:"brush",active:null,faces:0,serial:0};
 let detectorPromise=null;
 const msg=(value,bad=false)=>{const el=$("editorStatus");el.textContent=value;el.classList.toggle("error",bad);};
 const changed=()=>{const el=$("editorCount");el.textContent=state.faces+" פנים טושטשו אוטומטית · "+state.ops.length+" פעולות ידניות/אוטומטיות";};
 const hasManualMasks=()=>state.ops.some(op=>op.kind==="rect"||op.kind==="stroke");
 const manuallyReviewed=()=>state.fallback&&hasManualMasks()&&$("manualReviewConsent").checked;
 const canUpload=()=>state.ready&&!state.loading&&(state.detected||manuallyReviewed());
 const enable=()=>{$("publish").disabled=!canUpload();$("blurUndo").disabled=!state.ops.some(op=>op.kind!=="face");$("blurRedo").disabled=!state.redo.length;$("blurReset").disabled=!state.ops.length;};
 const fit=(value,min,max)=>Math.min(max,Math.max(min,value));
 function pixelate(x,y,w,h,round=false){
  x=fit(Math.round(x),0,canvas.width);y=fit(Math.round(y),0,canvas.height);
  w=Math.min(Math.ceil(w),canvas.width-x);h=Math.min(Math.ceil(h),canvas.height-y);
  if(w<=0||h<=0)return;
  const tiny=document.createElement("canvas");
  const block=Math.max(10,Math.round(Math.min(w,h)/7));
  tiny.width=Math.max(1,Math.ceil(w/block));tiny.height=Math.max(1,Math.ceil(h/block));
  const small=tiny.getContext("2d");
  small.drawImage(originals,x,y,w,h,0,0,tiny.width,tiny.height);
  ctx.save();ctx.beginPath();
  if(round)ctx.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,2*Math.PI);
  else ctx.rect(x,y,w,h);
  ctx.clip();ctx.imageSmoothingEnabled=false;
  ctx.drawImage(tiny,0,0,tiny.width,tiny.height,x,y,w,h);
  ctx.restore();
 }
 function paintStroke(pts,radius){
  for(let i=0;i<pts.length;i++){
   if(i===0){pixelate(pts[i].x-radius,pts[i].y-radius,radius*2,radius*2,true);continue;}
   const p=pts[i-1],q=pts[i],dist=Math.hypot(q.x-p.x,q.y-p.y),steps=Math.max(1,Math.ceil(dist/(radius*.42)));
   for(let j=1;j<=steps;j++){const t=j/steps;pixelate(p.x+(q.x-p.x)*t-radius,p.y+(q.y-p.y)*t-radius,radius*2,radius*2,true);}
  }
 }
 function draw(){
  if(!state.ready)return;
  canvas.width=originals.width;canvas.height=originals.height;
  ctx.drawImage(originals,0,0);
  for(const op of state.ops){
   if(op.kind==="rect"||op.kind==="face")pixelate(op.x,op.y,op.w,op.h,op.kind==="face");
   else if(op.kind==="stroke")paintStroke(op.points,op.radius);
  }
  if(state.active?.kind==="stroke")paintStroke(state.active.points,state.active.radius);
  if(state.active?.kind==="rect"){
   const r=rectFromPoints(state.active.start,state.active.end);
   ctx.save();ctx.strokeStyle="#00f5da";ctx.lineWidth=Math.max(2,canvas.width/500);
   ctx.setLineDash([12,8]);ctx.strokeRect(r.x,r.y,r.w,r.h);ctx.restore();
  }
  changed();enable();
 }
 function rectFromPoints(a,b){return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)};}
 const point=e=>{const b=canvas.getBoundingClientRect();return {x:fit((e.clientX-b.left)/b.width*canvas.width,0,canvas.width),y:fit((e.clientY-b.top)/b.height*canvas.height,0,canvas.height)};};
 function commit(op){state.ops.push(op);state.redo=[];draw();}
 canvas.addEventListener("pointerdown",e=>{
  if(!state.ready||state.loading)return;
  e.preventDefault();canvas.setPointerCapture(e.pointerId);
  const p=point(e);
  if(state.mode==="brush")state.active={kind:"stroke",points:[p],radius:Number($("brushSize").value)*canvas.width/1000};
  else state.active={kind:"rect",start:p,end:p};
  draw();
 });
 canvas.addEventListener("pointermove",e=>{
  if(!state.active)return;e.preventDefault();const p=point(e);
  if(state.active.kind==="stroke")state.active.points.push(p);else state.active.end=p;
  draw();
 });
 function finish(e){if(!state.active)return;e.preventDefault();
  const op=state.active;state.active=null;
  if(op.kind==="rect"){
   const r=rectFromPoints(op.start,op.end);
   if(r.w>4&&r.h>4)commit({kind:"rect",...r});else draw();
  }else commit(op);
 }
 canvas.addEventListener("pointerup",finish);
 canvas.addEventListener("pointercancel",()=>{state.active=null;draw();});
 $("blurUndo").onclick=()=>{const i=state.ops.findLastIndex(op=>op.kind!=="face");if(i>=0)state.redo.push(...state.ops.splice(i,1));draw();};
 $("blurRedo").onclick=()=>{if(state.redo.length)state.ops.push(state.redo.pop());draw();};
 $("blurReset").onclick=()=>{
  if(!confirm("לבטל את כל אזורי הטשטוש, כולל הפנים שזוהו? זיהוי הפנים ירוץ שוב לפני שתוכל להעלות."))return;
  state.ops=[];state.redo=[];state.detected=false;state.faces=0;draw();detectFaces();
 };
 const setMode=mode=>{state.mode=mode;
  for(const [id,value] of [["blurBrush","brush"],["blurRectangle","rect"]]){
   $(id).classList.toggle("selected",value===mode);$(id).setAttribute("aria-pressed",String(value===mode));
  }
 };
 $("blurBrush").onclick=()=>setMode("brush");$("blurRectangle").onclick=()=>setMode("rect");
 $("blurDetect").onclick=()=>detectFaces();
 $("manualReviewConsent").onchange=()=>{enable();if(manuallyReviewed())msg("הבדיקה הידנית אושרה. התמונה תעבור גם אישור מנהל לפני פרסום.");};
 $("brushSize").oninput=()=>{$("brushValue").textContent=$("brushSize").value;};
 async function getDetector(){
  if(!detectorPromise)detectorPromise=(async()=>{
   const {FilesetResolver,FaceDetector}=await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs");
   const files=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm");
   return FaceDetector.createFromOptions(files,{
    baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",delegate:"CPU"},
    runningMode:"IMAGE",minDetectionConfidence:.36
   });
  })().catch(error=>{detectorPromise=null;throw error;});
  return detectorPromise;
 }
 async function detectFaces(){
  if(!state.ready||state.loading)return;
  const version=state.serial;state.loading=true;state.detected=false;state.fallback=false;$("manualReviewFallback").hidden=true;$("manualReviewConsent").checked=false;enable();
  msg("מזהה פנים במכשיר שלך... התמונה אינה נשלחת לשירות זיהוי.");
  try{
   const detector=await getDetector();
   if(version!==state.serial)return;
   const result=detector.detect(originals);
   if(version!==state.serial)return;
   // Re-run detection replaces previous automatically generated masks, never manual edits.
   state.ops=state.ops.filter(op=>op.kind!=="face");
   state.faces=0;
   for(const d of result.detections||[]){
    const b=d.boundingBox;if(!b)continue;
    const pad=.25, x=Math.max(0,b.originX-b.width*pad),y=Math.max(0,b.originY-b.height*pad);
    const right=Math.min(canvas.width,b.originX+b.width*(1+pad)),bottom=Math.min(canvas.height,b.originY+b.height*(1+pad));
    if(right>x&&bottom>y){state.ops.unshift({kind:"face",x,y,w:right-x,h:bottom-y});state.faces++;}
   }
   state.detected=true;state.fallback=false;state.redo=[];draw();
   msg(state.faces
    ?"טושטשו אוטומטית "+state.faces+" פנים. בדוק שלא פספסנו פנים, לוחיות רישוי או פרטים מזהים."
    :"לא זוהו פנים בתמונה. בדוק בעצמך והוסף טשטוש ידני היכן שצריך.");
  }catch(error){
   if(version!==state.serial)return;
   state.detected=false;
   state.fallback=true;
   $("manualReviewFallback").hidden=false;
   msg("לא הצלחנו להפעיל זיהוי פנים אוטומטי. אפשר לנסות שוב, או לטשטש ידנית את כל הפנים והפרטים המזהים ולאשר את הבדיקה הידנית. עדיין נדרש אישור מנהל לפרסום.",true);
   console.warn("PhotoMap face model unavailable",error?.name||"error");
  }finally{if(version===state.serial){state.loading=false;draw();}}
 }
 async function load(file){
  const version=++state.serial;state.ready=false;state.detected=false;state.fallback=false;state.loading=true;
  $("manualReviewFallback").hidden=true;$("manualReviewConsent").checked=false;
  state.faces=0;state.ops=[];state.redo=[];$("editorPanel").hidden=false;enable();
  msg("פותח תמונה ומכין עורך טשטוש...");
  let bitmap=null,url=null;
  try{
   if(!file||!file.type.startsWith("image/")||file.size>8*1024*1024)throw Error("בחר תמונה תקינה עד 8MB");
   if("createImageBitmap" in window){try{bitmap=await createImageBitmap(file,{imageOrientation:"from-image"});}catch{}}
   let image=bitmap;
   if(!image){
    url=URL.createObjectURL(file);const img=new Image();
    image=await new Promise((resolve,reject)=>{img.onload=()=>resolve(img);img.onerror=()=>reject(Error("אי אפשר לקרוא את התמונה"));img.src=url;});
   }
   if(version!==state.serial)return;
   const w=image.width||image.naturalWidth,h=image.height||image.naturalHeight;
   if(!w||!h||w*h>65000000)throw Error("התמונה גדולה מדי לעיבוד");
   const scale=Math.min(1,1920/Math.max(w,h));
   originals.width=Math.max(1,Math.round(w*scale));originals.height=Math.max(1,Math.round(h*scale));
   source.fillStyle="#fff";source.fillRect(0,0,originals.width,originals.height);
   source.drawImage(image,0,0,originals.width,originals.height);
   state.ready=true;draw();
   // Detect only after the decoding phase is complete.
  }catch(error){if(version===state.serial){state.ready=false;msg("לא ניתן לפתוח את התמונה: "+error.message,true);}}
  finally{if(bitmap?.close)bitmap.close();if(url)URL.revokeObjectURL(url);
   if(version===state.serial){state.loading=false;enable();}}
  if(version===state.serial&&state.ready)await detectFaces();
 }
 function reset(){
  state.serial++;state.ready=false;state.detected=false;state.fallback=false;state.loading=false;
  $("manualReviewFallback").hidden=true;$("manualReviewConsent").checked=false;
  state.ops=[];state.redo=[];state.active=null;state.faces=0;
  $("editorPanel").hidden=true;msg("");changed();enable();
 }
 async function exportBlob(){
  if(!canUpload())throw Error("יש להשלים זיהוי פנים או לטשטש ידנית ולאשר את בדיקת הפרטיות לפני העלאה");
  if(state.active)throw Error("סיים את פעולת הטשטוש לפני העלאה");
  draw();
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error("יצוא תמונה נכשל")),"image/jpeg",.83));
  if(blob.size>8*1024*1024)throw Error("התמונה המטושטשת גדולה מ־8MB");
  return blob;
 }
 reset();
 window.PhotoMapEditor={load,reset,exportBlob,isReady:canUpload};
})();