"use strict";const $=id=>document.getElementById(id);const config=window.PHOTO_MAP_CONFIG||{};const ready=Boolean(config.supabaseUrl&&config.supabaseAnonKey&&window.supabase);const db=ready?window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey):null;const map=L.map("map",{zoomControl:false}).setView([31.78,35.22],8);L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}).addTo(map);L.control.zoom({position:"bottomright",zoomInTitle:"התקרב",zoomOutTitle:"התרחק"}).addTo(map);let pictures=[],markers=L.layerGroup().addTo(map),selectedLocation=null,selectedLocationConfirmed=false,selectedUploadFile=null,sourceKind="unknown",captureTime=null,activePhotoId=null;const maxBytes=8*1024*1024;
function notice(message){$("mapNotice").textContent=message;$("mapNotice").hidden=false;}
if(!ready)notice("מצב הדגמה: המפה פעילה, אבל פרסום ושיתוף תמונות יפעלו רק לאחר חיבור מאגר Supabase.");
let captchaWidgetId=null;let captchaToken="";function mountCaptcha(){if(captchaWidgetId!==null||!window.turnstile||!config.turnstileSiteKey)return;captchaWidgetId=window.turnstile.render("#turnstileWidget",{sitekey:config.turnstileSiteKey,callback:token=>{captchaToken=token;}, "expired-callback":()=>{captchaToken="";},"error-callback":()=>{captchaToken="";}});}function openPanel(id){
 const prior=$("uploadPanel").hidden?($("galleryPanel").hidden?null:"galleryPanel"):"uploadPanel";
 if(id==="uploadPanel"){let tries=0;const poll=setInterval(()=>{mountCaptcha();tries++;if(captchaWidgetId!==null||tries>=60)clearInterval(poll);},200);if(!selectedLocation&&!locationRequesting){detectDefaultLocation();}}
 $("galleryPanel").hidden=id!=="galleryPanel";
 $("uploadPanel").hidden=id!=="uploadPanel";
 $("mainContent").inert=Boolean(id);
 document.body.classList.toggle("panelOpen",Boolean(id));
 for(const [button,chosen] of [["mapTab",!id],["cameraTab",id==="uploadPanel"],["galleryTab",id==="galleryPanel"]]){
  $(button).classList.toggle("selected",chosen);
  $(button).setAttribute("aria-pressed",String(chosen));
 }
 if(id && id!==prior){const heading=$(id==="uploadPanel"?"uploadHeading":"galleryHeading");heading.focus({preventScroll:true});}
 if(!id){setTimeout(()=>map.invalidateSize(),100);if(prior)$("mapTab").focus({preventScroll:true});}
}
$("refreshMap").onclick=()=>{
 const formInProgress=Boolean(selectedUploadFile);
 if(formInProgress&&!window.confirm("רענון הדף יבטל את עריכת התמונה הנוכחית. להמשיך?"))return;
 window.location.reload();
};
$("mapTab").onclick=()=>openPanel(null);$("cameraTab").onclick=()=>openPanel("uploadPanel");$("galleryTab").onclick=()=>openPanel("galleryPanel");document.querySelectorAll(".closeSheet").forEach(b=>b.onclick=()=>openPanel(null));

let currentLocationMarker=null, currentAccuracyCircle=null, selectedLocationMarker=null, pickingPosition=false;
let locationRequesting=false;
function locationSummary(){
 const summary=$("locationSummary");
 if(!selectedLocation){summary.textContent="המיקום לא נקבע. ניתן לנסות שוב או לבחור במפה.";return;}
 const accuracy=selectedLocation.accuracy!=null?" · דיוק משוער "+Math.round(selectedLocation.accuracy)+" מטר":"";
 summary.textContent=(selectedLocationConfirmed?"✓ המיקום אושר":"מיקום מוצע — יש לאשר")+accuracy;
 $("confirmSelectedLocation").disabled=selectedLocationConfirmed;
 $("confirmSelectedLocation").textContent=selectedLocationConfirmed?"✓ המיקום אושר":"✓ אישור המיקום";
}
async function detectDefaultLocation(){
 if(locationRequesting||selectedLocation)return;
 locationRequesting=true;
 $("locationSummary").textContent="מאתר את המיקום הנוכחי…";
 try{const p=await getLocation();if(!selectedLocation){setSelectedPosition(p,"המיקום הנוכחי");showCurrentPosition(p);}}
 catch(error){$("locationSummary").textContent="לא הצלחנו לזהות מיקום: "+explainLocationError(error);$("locationOptions").open=true;}
 finally{locationRequesting=false;}
}
$("confirmSelectedLocation").onclick=()=>{
 if(!selectedLocation){$("locationSummary").textContent="בחר מיקום לפני האישור.";return;}
 selectedLocationConfirmed=true;locationSummary();$("locationOptions").open=false;
};
$("changePosition").onclick=()=>{$("locationOptions").open=true;$("locationSummary").textContent="בחר אפשרות לשינוי המיקום ולחץ שוב על אישור המיקום.";};

function explainLocationError(error){
  if(!window.isSecureContext)return "מיקום זמין רק באתר מאובטח (HTTPS).";
  if(error&&error.code===1)return "הרשאת מיקום חסומה. לחץ על הסמל שליד כתובת האתר ואפשר Location, ובדוק ששירותי המיקום במכשיר פועלים.";
  if(error&&error.code===2)return "המכשיר לא הצליח לאתר מיקום. ודא ששירותי המיקום במערכת ההפעלה פועלים, או בחר נקודה ידנית במפה.";
  if(error&&error.code===3)return "החיפוש אחר המיקום ארך יותר מדי זמן. נסה שוב או בחר נקודה במפה.";
  return error&&error.message?error.message:"לא ניתן לקבל את המיקום מהמכשיר.";
}
function positionAttempt(highAccuracy,timeout){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(new Error("הדפדפן לא תומך בשירותי מיקום"));return;}
    navigator.geolocation.getCurrentPosition(
      pos=>resolve({lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy}),
      reject,{enableHighAccuracy:highAccuracy,timeout,maximumAge:60000}
    );
  });
}
async function getLocation(){
  if(!window.isSecureContext)throw new Error("יש לפתוח את האתר דרך HTTPS כדי להשתמש במיקום.");
  try{return await positionAttempt(true,12000);}
  catch(error){if(error&&error.code===3)return await positionAttempt(false,10000);throw error;}
}
function showCurrentPosition(p){
  if(currentLocationMarker)map.removeLayer(currentLocationMarker);
  if(currentAccuracyCircle)map.removeLayer(currentAccuracyCircle);
  currentLocationMarker=L.circleMarker([p.lat,p.lng],{radius:9,weight:3,color:"#ffffff",fillColor:"#0e8ee7",fillOpacity:1}).addTo(map);
  currentAccuracyCircle=L.circle([p.lat,p.lng],{radius:Math.max(1,p.accuracy||1),color:"#0e8ee7",weight:1,fillOpacity:0.08}).addTo(map);
  map.setView([p.lat,p.lng],Math.max(map.getZoom(),15));
}
function updateSelectedPositionText(source){
  if(!selectedLocation)return;
  const p=selectedLocation;
  const accuracy=p.accuracy==null?"":(" (דיוק GPS משוער: "+Math.round(p.accuracy)+" מטר)");
  $("positionText").textContent="נבחר "+source+": "+p.lat.toFixed(6)+", "+p.lng.toFixed(6)+accuracy+". ניתן לדייק על המפה לפני הפרסום.";
}

function displayPublishPosition(){
 const box=$("publicationPreview");if(!box)return;
 if(!selectedLocation){box.textContent="בחר מיקום כדי לראות איזה מיקום יפורסם.";return;}
 const exact=$("preciseLocation").checked;
 const lat=exact?selectedLocation.lat:Number(selectedLocation.lat.toFixed(3));
 const lng=exact?selectedLocation.lng:Number(selectedLocation.lng.toFixed(3));
 box.textContent=(exact?"מיקום מדויק: ":"מיקום מקורב (ברירת מחדל): ")+lat.toFixed(exact?6:3)+", "+lng.toFixed(exact?6:3)+". הנקודה תהיה גלויה רק אם התמונה תאושר.";
}
$("preciseLocation").addEventListener("change",displayPublishPosition);
$("applyCoordinates").addEventListener("click",()=>{
 const latRaw=$("manualLat").value.trim(),lngRaw=$("manualLng").value.trim();
 const lat=Number(latRaw),lng=Number(lngRaw);
 if(!latRaw||!lngRaw||!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat>90||lng < -180||lng>180){
  $("coordinatesMessage").textContent="יש להזין מספרים תקינים. קו רוחב בין מינוס 90 ל־90 וקו אורך בין מינוס 180 ל־180.";
  return;
 }
 setSelectedPosition({lat,lng,accuracy:null},"קואורדינטות שהוזנו");
 $("coordinatesMessage").textContent="המיקום עודכן. אפשר להמשיך לשליחת התמונה.";
});
for(const name of ["manualLat","manualLng"]){$(name).addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();$("applyCoordinates").click();}});}
document.addEventListener("keydown",event=>{
 if(event.key!=="Escape"||$("photoDialog").open)return;
 if(pickingPosition){event.preventDefault();$("cancelPick").click();}
 else if(!$("uploadPanel").hidden||!$("galleryPanel").hidden){event.preventDefault();openPanel(null);}
});

function setSelectedPosition(p,source){
  selectedLocation={lat:p.lat,lng:p.lng,accuracy:p.accuracy??null};
  selectedLocationConfirmed=false;locationSummary();
  if(!selectedLocationMarker){
    selectedLocationMarker=L.marker([p.lat,p.lng],{draggable:true,autoPan:true,title:"גרור אותי כדי לדייק את מיקום התמונה"}).addTo(map);
    selectedLocationMarker.on("dragend",()=>{
      const point=selectedLocationMarker.getLatLng();
      selectedLocation={lat:point.lat,lng:point.lng,accuracy:null};
      selectedLocationConfirmed=false;locationSummary();
      updateSelectedPositionText("מיקום מדויק ידנית");
      $("manualLat").value=point.lat.toFixed(6);$("manualLng").value=point.lng.toFixed(6);
      displayPublishPosition();
    });
    selectedLocationMarker.bindTooltip("אפשר לגרור אותי כדי לדייק",{direction:"top"});
  }else{
    selectedLocationMarker.setLatLng([p.lat,p.lng]);
  }
  map.setView([p.lat,p.lng],Math.max(map.getZoom(),15));
  updateSelectedPositionText(source);
  $("manualLat").value=p.lat.toFixed(6);
  $("manualLng").value=p.lng.toFixed(6);
  displayPublishPosition();
}
$("locate").onclick=async()=>{
  const btn=$("locate"),original=btn.textContent;
  btn.disabled=true;btn.textContent="מאתר...";
  try{const p=await getLocation();showCurrentPosition(p);btn.title="דיוק משוער: "+Math.round(p.accuracy)+" מטר";if(!$("mapNotice").hidden&&$("mapNotice").textContent.startsWith("מיקום:"))$("mapNotice").hidden=true;}
  catch(error){notice("מיקום: "+explainLocationError(error));}
  finally{btn.disabled=false;btn.textContent=original;}
};
$("getPosition").onclick=async()=>{
  const btn=$("getPosition");
  btn.disabled=true;$("positionText").textContent="מאתר את המיקום שלך... ייתכן שהדפדפן יבקש הרשאה.";
  try{const p=await getLocation();setSelectedPosition(p,"המיקום הנוכחי");showCurrentPosition(p);}
  catch(error){$("positionText").textContent=explainLocationError(error)+" אפשר גם ללחוץ על 'בחר במפה'.";}
  finally{btn.disabled=false;}
};
let positionBeforePicker=null;
$("pickPosition").onclick=()=>{
  positionBeforePicker=selectedLocation?{...selectedLocation}:null;
  pickingPosition=true;
  $("pickerBanner").hidden=false;
  openPanel(null);
  setTimeout(()=>{
    map.invalidateSize();
    if(selectedLocation)map.setView([selectedLocation.lat,selectedLocation.lng],Math.max(map.getZoom(),18));
  },100);
};
$("finishPick").onclick=()=>{
  if(!selectedLocation){
    notice("לחץ על המפה כדי לבחור את מיקום התמונה.");
    return;
  }
  pickingPosition=false;
  $("pickerBanner").hidden=true;
  openPanel("uploadPanel");
};
$("cancelPick").onclick=()=>{
  if(positionBeforePicker){
    setSelectedPosition(positionBeforePicker,"המיקום הקודם");
  }else{
    selectedLocation=null;selectedLocationConfirmed=false;locationSummary();
    if(selectedLocationMarker){map.removeLayer(selectedLocationMarker);selectedLocationMarker=null;}
    $("positionText").textContent="לא נבחר מיקום. אפשר לקבל GPS או לבחור נקודה במפה.";displayPublishPosition();
  }
  pickingPosition=false;
  $("pickerBanner").hidden=true;
  openPanel("uploadPanel");
};
map.on("click",e=>{
  if(!pickingPosition)return;
  setSelectedPosition({lat:e.latlng.lat,lng:e.latlng.lng,accuracy:null},"מיקום ידני במפה");
});
async function exifDate(file){
 if(file.type!=="image/jpeg")return null;
 try{
  const b=await file.slice(0,128000).arrayBuffer(),v=new DataView(b);
  if(v.getUint16(0)!==0xffd8)return null;let cursor=2;
  while(cursor+4<b.byteLength){
   if(v.getUint8(cursor)!==255)break;
   const mark=v.getUint8(cursor+1);if(mark===0xda||mark===0xd9)break;
   const len=v.getUint16(cursor+2);
   if(mark===0xe1&&len>=14&&cursor+len+2<=b.byteLength
     &&v.getUint32(cursor+4)===0x45786966&&v.getUint16(cursor+8)===0){
    const base=cursor+10,le=v.getUint16(base)===0x4949;
    if(!le&&v.getUint16(base)!==0x4d4d)break;
    const u16=p=>v.getUint16(p,le),u32=p=>v.getUint32(p,le);
    function getTags(off){
     const pos=base+off;if(pos<base||pos+2>=b.byteLength)return {};
     const count=Math.min(100,u16(pos)),tags={};
     for(let i=0;i<count;i++){
      const e=pos+2+12*i;if(e+12>b.byteLength)break;
      tags[u16(e)]={type:u16(e+2),count:u32(e+4),value:u32(e+8)};
     }
     return tags;
    }
    const first=getTags(u32(base+4));
    const exif=first[0x8769]?getTags(first[0x8769].value):{};
    const tag=exif[0x9003]||first[0x0132];if(!tag||tag.type!==2||tag.count<19||tag.count>40)break;
    const p=base+tag.value;if(p<0||p+tag.count>b.byteLength)break;
    const str=Array.from(new Uint8Array(b,p,tag.count)).map(c=>String.fromCharCode(c)).join("").replace(/\0/g,"");
    const m=/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(str);
    if(!m)break;const parts=m.slice(1).map(Number);
    const d=new Date(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]);
    if(d.getFullYear()===parts[0]&&d.getMonth()===parts[1]-1&&d.getDate()===parts[2]&&d.getTime()<=Date.now()+3600000&&d.getFullYear()>=2000)return d.toISOString();
   }
   if(len<2)break;cursor+=2+len;
  }
 }catch{}
 return null;
}
async function chooseFile(input,kind){
 const file=input.files[0],status=$("uploadStatus");
 if(!file)return;
 selectedUploadFile=null;sourceKind=kind;captureTime=null;
 $("photoFile").value=input===$("photoFile")?input.value:"";
 if(input!==$("cameraFile"))$("cameraFile").value="";
 if(!file.type.startsWith("image/")||file.size>maxBytes){status.textContent="בחר תמונה מסוג נתמך עד 8MB";input.value="";window.PhotoMapEditor?.reset();return;}
 if(!window.PhotoMapEditor){status.textContent="עורך טשטוש לא נטען. רענן את הדף.";return;}
 selectedUploadFile=file;
 $("fileSelection").textContent=kind==="camera"?"תמונה חדשה מהמצלמה":"תמונה שנבחרה מהטלפון";
 captureTime=await exifDate(file);
 try{await window.PhotoMapEditor.load(file);}
 catch(error){status.textContent="עיבוד התמונה נכשל: "+error.message;}
}
$("photoFile").onchange=()=>chooseFile($("photoFile"),"library");
$("cameraFile").onchange=()=>chooseFile($("cameraFile"),"camera");
function publicImageUrl(photo){return photo.image_url||"";}
function openPicture(p){$("largePhoto").src=publicImageUrl(p);$("largeTitle").textContent=p.title;$("largeDetails").textContent=new Date(p.created_at).toLocaleString("he-IL");$("reportPhoto").href="report.html?photo="+encodeURIComponent(p.id);$("photoDialog").showModal();}
$("closePhoto").onclick=()=>$("photoDialog").close();
function drawPictures(){markers.clearLayers();$("gallery").replaceChildren();if(!pictures.length){const msg=document.createElement("p");msg.textContent="עדיין אין תמונות מאושרות להצגה.";msg.setAttribute("role","status");$("gallery").append(msg);}for(const p of pictures){const url=publicImageUrl(p),img=document.createElement("img");img.src=url;img.alt=p.title;img.className="photoMarker";const marker=L.marker([p.latitude,p.longitude],{keyboard:true,title:"תמונה: "+p.title,alt:"תמונה: "+p.title,icon:L.divIcon({html:img.outerHTML,className:"",iconSize:[44,44],iconAnchor:[22,22]})}).addTo(markers);marker.on("click",()=>openPicture(p));const tile=document.createElement("button");tile.type="button";tile.className="tile";tile.setAttribute("aria-label","פתח תמונה: "+p.title);const pic=document.createElement("img");pic.src=url;pic.loading="lazy";pic.alt="";const title=document.createElement("span");title.textContent=p.title;tile.append(pic,title);tile.onclick=()=>{openPanel(null);map.setView([p.latitude,p.longitude],16);openPicture(p);};$("gallery").append(tile);}$("photoCount").textContent=pictures.length+" תמונות במפה";}
async function loadPictures(){
 if(!ready){$("photoCount").textContent="מפה לדוגמה";return;}
 $("mapNotice").hidden=true;
 $("photoCount").textContent="טוען תמונות...";
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);
 try{
   const response=await fetch(config.supabaseUrl+"/functions/v1/photo-feed",{method:"GET",headers:{"apikey":config.supabaseAnonKey},signal:controller.signal});
   const data=await response.json();
   if(!response.ok||!Array.isArray(data.photos))throw new Error(data.error||"שגיאה בטעינת תמונות");
   pictures=data.photos.filter(p=>p.image_url&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
   drawPictures();
 }catch(error){$("photoCount").textContent="התמונות לא נטענו";notice("לא הצלחנו לטעון תמונות כרגע: "+(error.name==="AbortError"?"זמן ההמתנה הסתיים":error.message));}
 finally{clearTimeout(timeout);}
}
$("uploadForm").onsubmit=async e=>{
 e.preventDefault();
 const file=selectedUploadFile,title=$("photoTitle").value.trim(),status=$("uploadStatus");
 if(!window.PhotoMapEditor?.isReady()){status.textContent="בחר תמונה והשלם את בדיקת הפנים והטשטוש לפני השליחה.";return;}
 if(!ready){status.textContent="חיבור לשרת עדיין אינו זמין";return;}
 if(!file){status.textContent="יש לבחור תמונה";return;}
 if(!selectedLocation||!selectedLocationConfirmed){status.textContent="יש ללחוץ על אישור המיקום לפני השליחה";return;}
 if(!$("adultConsent").checked||!$("rightsConsent").checked||!$("locationConsent").checked){status.textContent="יש לאשר גיל, זכויות ומדיניות פרטיות";return;}
 if(!captchaToken){status.textContent="יש להשלים בדיקת אבטחה";mountCaptcha();return;}
 const button=$("publish");
 button.disabled=true;status.textContent="מכין את התמונה ומסיר מידע נסתר...";
 try{
  if(!window.PhotoMapEditor?.isReady())throw Error("יש להשלים זיהוי פנים וטשטוש לפני העלאה");
  const cleaned=await window.PhotoMapEditor.exportBlob();
  const precise=$("preciseLocation").checked;
  const latitude=precise?selectedLocation.lat:Number(selectedLocation.lat.toFixed(3));
  const longitude=precise?selectedLocation.lng:Number(selectedLocation.lng.toFixed(3));
  const form=new FormData();
  form.append("photo",cleaned,"photomap.jpg");form.append("title",title);
  form.append("latitude",String(latitude));form.append("longitude",String(longitude));
  form.append("confirmRights","yes");form.append("confirmLocation","yes");form.append("adult","yes");
  form.append("captchaToken",captchaToken);
  form.append("sourceKind",sourceKind);
  if(captureTime)form.append("capturedAt",captureTime);
  status.textContent="שולח תמונה לבדיקה...";
  const response=await fetch(config.supabaseUrl+"/functions/v1/upload-photo-secure",{method:"POST",headers:{"apikey":config.supabaseAnonKey},body:form});
  const raw=await response.text();let data={};
  try{data=JSON.parse(raw);}catch{throw Error("השרת החזיר תשובה לא צפויה (HTTP "+response.status+")");}
  if(!response.ok||!data.success)throw Error("HTTP "+response.status+": "+(data.error||"Upload failed"));
  status.textContent="התמונה התקבלה ונשמרה לבדיקה. היא תופיע במפה רק לאחר אישור.";
  $("uploadForm").reset();window.PhotoMapEditor.reset();selectedLocation=null;selectedLocationConfirmed=false;selectedUploadFile=null;captureTime=null;sourceKind="unknown";locationSummary();$("fileSelection").textContent="בחר תמונה קיימת או צלם חדשה";
  if(selectedLocationMarker){map.removeLayer(selectedLocationMarker);selectedLocationMarker=null;}
  displayPublishPosition();
 }catch(error){status.textContent="העלאה נכשלה: "+error.message;}
 finally{button.disabled=false;captchaToken="";if(window.turnstile&&captchaWidgetId!==null)window.turnstile.reset(captchaWidgetId);}
};loadPictures();