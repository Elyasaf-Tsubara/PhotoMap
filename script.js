"use strict";const $=id=>document.getElementById(id);const config=window.PHOTO_MAP_CONFIG||{};const ready=Boolean(config.supabaseUrl&&config.supabaseAnonKey&&window.supabase);const db=ready?window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey):null;const map=L.map("map",{zoomControl:false}).setView([31.78,35.22],8);L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);L.control.zoom({position:"topleft"}).addTo(map);let pictures=[],markers=L.layerGroup().addTo(map),selectedLocation=null,previewURL=null;const maxBytes=8*1024*1024;
function notice(message){$("mapNotice").textContent=message;$("mapNotice").hidden=false;}
if(!ready)notice("מצב הדגמה: המפה פעילה, אבל פרסום ושיתוף תמונות יפעלו רק לאחר חיבור מאגר Supabase.");
let captchaWidgetId=null;let captchaToken="";function mountCaptcha(){if(captchaWidgetId!==null||!window.turnstile||!config.turnstileSiteKey)return;captchaWidgetId=window.turnstile.render("#turnstileWidget",{sitekey:config.turnstileSiteKey,callback:token=>{captchaToken=token;}, "expired-callback":()=>{captchaToken="";},"error-callback":()=>{captchaToken="";}});}function openPanel(id){if(id==="uploadPanel"){mountCaptcha();setTimeout(mountCaptcha,600);}$("galleryPanel").hidden=id!=="galleryPanel";$("uploadPanel").hidden=id!=="uploadPanel";$("mapTab").classList.toggle("selected",!id);$("cameraTab").classList.toggle("selected",id==="uploadPanel");$("galleryTab").classList.toggle("selected",id==="galleryPanel");if(!id)setTimeout(()=>map.invalidateSize(),100);}
$("mapTab").onclick=()=>openPanel(null);$("cameraTab").onclick=()=>openPanel("uploadPanel");$("galleryTab").onclick=()=>openPanel("galleryPanel");document.querySelectorAll(".closeSheet").forEach(b=>b.onclick=()=>openPanel(null));

let currentLocationMarker=null, currentAccuracyCircle=null, selectedLocationMarker=null, pickingPosition=false;
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
function setSelectedPosition(p,source){
  selectedLocation={lat:p.lat,lng:p.lng,accuracy:p.accuracy??null};
  if(!selectedLocationMarker){
    selectedLocationMarker=L.marker([p.lat,p.lng],{draggable:true,autoPan:true,title:"גרור אותי כדי לדייק את מיקום התמונה"}).addTo(map);
    selectedLocationMarker.on("dragend",()=>{
      const point=selectedLocationMarker.getLatLng();
      selectedLocation={lat:point.lat,lng:point.lng,accuracy:null};
      updateSelectedPositionText("מיקום מדויק ידנית");
    });
    selectedLocationMarker.bindTooltip("אפשר לגרור אותי כדי לדייק",{direction:"top"});
  }else{
    selectedLocationMarker.setLatLng([p.lat,p.lng]);
  }
  map.setView([p.lat,p.lng],Math.max(map.getZoom(),15));
  updateSelectedPositionText(source);
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
    selectedLocation=null;
    if(selectedLocationMarker){map.removeLayer(selectedLocationMarker);selectedLocationMarker=null;}
    $("positionText").textContent="לא נבחר מיקום. אפשר לקבל GPS או לבחור נקודה במפה.";
  }
  pickingPosition=false;
  $("pickerBanner").hidden=true;
  openPanel("uploadPanel");
};
map.on("click",e=>{
  if(!pickingPosition)return;
  setSelectedPosition({lat:e.latlng.lat,lng:e.latlng.lng,accuracy:null},"מיקום ידני במפה");
});
$("photoFile").onchange=()=>{if(previewURL)URL.revokeObjectURL(previewURL);const f=$("photoFile").files[0];if(!f)return;if(!f.type.startsWith("image/")||f.size>maxBytes){$("uploadStatus").textContent="בחר תמונה מסוג נתמך עד 8MB";$("photoFile").value="";return;}previewURL=URL.createObjectURL(f);$("preview").src=previewURL;$("preview").hidden=false;};
function publicImageUrl(photo){return photo.image_url||"";}
function openPicture(p){$("largePhoto").src=publicImageUrl(p);$("largeTitle").textContent=p.title;$("largeDetails").textContent=new Date(p.created_at).toLocaleString("he-IL");$("reportPhoto").onclick=()=>{const subject=encodeURIComponent("דיווח על תמונה "+p.id);location.href="mailto:"+(config.reportEmail||"")+"?subject="+subject;};$("reportPhoto").hidden=!config.reportEmail;$("photoDialog").showModal();}
$("closePhoto").onclick=()=>$("photoDialog").close();
function drawPictures(){markers.clearLayers();$("gallery").replaceChildren();for(const p of pictures){const url=publicImageUrl(p.image_path),img=document.createElement("img");img.src=url;img.alt=p.title;img.className="photoMarker";const marker=L.marker([p.latitude,p.longitude],{icon:L.divIcon({html:img.outerHTML,className:"",iconSize:[44,44],iconAnchor:[22,22]})}).addTo(markers);marker.on("click",()=>openPicture(p));const tile=document.createElement("button");tile.className="tile";const pic=document.createElement("img");pic.src=url;pic.loading="lazy";pic.alt=p.title;const title=document.createElement("span");title.textContent=p.title;tile.append(pic,title);tile.onclick=()=>{openPanel(null);map.setView([p.latitude,p.longitude],16);openPicture(p);};$("gallery").append(tile);}$("photoCount").textContent=pictures.length+" תמונות במפה";}
async function loadPictures(){
 if(!ready){$("photoCount").textContent="מפה לדוגמה";return;}
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
$("uploadForm").onsubmit=async e=>{e.preventDefault();const file=$("photoFile").files[0],title=$("photoTitle").value.trim(),status=$("uploadStatus");if(!ready){status.textContent="יש לחבר את Supabase לפני העלאת תמונות.";return;}if(!file||!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>maxBytes){status.textContent="בחר תמונת JPEG, PNG או WebP עד 8MB";return;}if(!selectedLocation){status.textContent="יש לבחור מיקום לפני הפרסום.";return;}if(!$("locationConsent").checked){status.textContent="יש לאשר פרסום תמונה ומיקום.";return;}if(!captchaToken){status.textContent="יש להשלים בדיקת אבטחה.";mountCaptcha();return;}const button=$("publish");button.disabled=true;status.textContent="מעלה תמונה...";try{const form=new FormData();form.append("photo",file);form.append("title",title);form.append("latitude",String(selectedLocation.lat));form.append("longitude",String(selectedLocation.lng));form.append("captchaToken",captchaToken);const response=await fetch(config.supabaseUrl+"/functions/v1/upload-photo",{method:"POST",headers:{"apikey":config.supabaseAnonKey},body:form});const responseText=await response.text();let data;try{data=JSON.parse(responseText);}catch{throw Error("HTTP "+response.status+": השרת החזיר תשובה לא צפויה");}if(!response.ok||!data.success)throw Error("HTTP "+response.status+": "+(data.error||data.message||"Upload failed"));status.textContent="התמונה נשלחה לבדיקה ותופיע במפה לאחר אישור."; $("uploadForm").reset();selectedLocation=null;$("preview").hidden=true;}catch(error){status.textContent="העלאה נכשלה: "+error.message;}finally{button.disabled=false;captchaToken="";if(window.turnstile&&captchaWidgetId!==null)window.turnstile.reset(captchaWidgetId);}};loadPictures();