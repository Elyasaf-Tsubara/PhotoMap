"use strict";
const $=id=>document.getElementById(id);
const cfg=window.PHOTO_MAP_CONFIG||{};
const params=new URLSearchParams(location.search);
const initialPhoto=params.get("photo");
if(initialPhoto&&/^[0-9a-f-]{36}$/i.test(initialPhoto))$("reportPhotoId").value=initialPhoto;
let token="",widget=null,attempts=0;
function renderCaptcha(){
 if(widget!==null||!window.turnstile||!cfg.turnstileSiteKey)return;
 widget=window.turnstile.render("#reportCaptcha",{sitekey:cfg.turnstileSiteKey,callback:t=>{token=t;},"expired-callback":()=>{token="";},"error-callback":()=>{token="";}});
}
const captchaInterval=setInterval(()=>{renderCaptcha();attempts++;if(widget!==null||attempts>80)clearInterval(captchaInterval);},180);
$("reportForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const result=$("reportResult"),button=$("sendReport");
 if(!cfg.supabaseUrl||!token){result.textContent="נדרש להשלים בדיקת אבטחה ולנסות שוב.";return;}
 button.disabled=true;result.textContent="שולח פנייה...";
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch(cfg.supabaseUrl+"/functions/v1/report-photo",{method:"POST",headers:{"Content-Type":"application/json","apikey":cfg.supabaseAnonKey},signal:controller.signal,body:JSON.stringify({
   photoId:$("reportPhotoId").value.trim(),
   reason:$("reportReason").value,
   details:$("reportDetails").value.trim(),
   contactEmail:$("reportEmail").value.trim(),
   captchaToken:token
  })});
  const data=await response.json();
  if(!response.ok||!data.success)throw Error(data.error||"שליחת הפנייה נכשלה");
  result.textContent="הפנייה נשמרה בהצלחה. מספר אסמכתה: "+data.receipt+". מומלץ לשמור את המספר.";
  $("reportForm").reset();
 }catch(error){result.textContent="לא הצלחנו לשלוח: "+(error.name==="AbortError"?"הבקשה ארכה זמן רב מדי":error.message);}
 finally{clearTimeout(timer);button.disabled=false;token="";if(window.turnstile&&widget!==null)window.turnstile.reset(widget);}
});