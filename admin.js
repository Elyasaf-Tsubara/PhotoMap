"use strict";
const $=id=>document.getElementById(id);
const cfg=window.PHOTO_MAP_CONFIG||{};
const ADMIN="photomap.support@gmail.com";
const client=window.supabase?.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
let photos=[],reports=[],section="photos",loading=false;
function status(message,bad=false,where="adminStatus"){
 const element=$(where);element.textContent=message;element.classList.toggle("error",bad);
}
function element(name,cls,txt){
 const n=document.createElement(name);if(cls)n.className=cls;if(txt!==undefined)n.textContent=String(txt);return n;
}
function clear(node){node.replaceChildren();}
function add(parent,...nodes){for(const node of nodes)parent.append(node);return parent;}
function actionButton(label,callback,cls=""){
 const b=element("button",cls,label);b.type="button";b.onclick=callback;return b;
}
const date=text=>{try{return new Date(text).toLocaleString("he-IL");}catch{return "";}}
async function request(method,query="",data=null){
 const {data:authData,error:authErr}=await client.auth.getSession();
 if(authErr||!authData.session?.access_token)throw Error("ההתחברות פגה. יש להתחבר מחדש.");
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
 try{
  const response=await fetch(cfg.supabaseUrl+"/functions/v1/admin-moderation"+query,{
   method,headers:{"apikey":cfg.supabaseAnonKey,"Authorization":"Bearer "+authData.session.access_token,...(data?{"Content-Type":"application/json"}:{})},
   body:data?JSON.stringify(data):undefined,signal:controller.signal
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(payload.error||"השרת החזיר שגיאה "+response.status);
  return payload;
 }finally{clearTimeout(timer);}
}
async function authenticate(){
 if(!client){status("תצורת האתר חסרה. יש לנסות שוב מאוחר יותר.",true,"loginStatus");return;}
 const {data}=await client.auth.getSession();
 if(!data.session){$("loginView").hidden=false;$("adminView").hidden=true;return;}
 try{
  await request("GET","?type=session");
  $("loginView").hidden=true;$("adminView").hidden=false;
  await refresh();
 }catch(err){
  $("loginView").hidden=false;$("adminView").hidden=true;
  status(err.message,true,"loginStatus");
 }
}
async function refresh(){
 if(loading)return;loading=true;
 status("טוען נתונים...");
 $("reload").disabled=true;
 try{
  if(section==="photos"){
   const result=await request("GET","?type=photos");photos=result.photos||[];
   renderPhotos();
  }else{
   const result=await request("GET","?type=reports");reports=result.reports||[];
   renderReports();
  }
  status("הנתונים עודכנו ב־"+new Date().toLocaleTimeString("he-IL"));
 }catch(err){status("שגיאה: "+err.message,true);}
 finally{loading=false;$("reload").disabled=false;}
}
function switchSection(next){
 section=next;
 $("photosSection").hidden=next!=="photos";
 $("reportsSection").hidden=next!=="reports";
 for(const [id,active] of [["photosTab",next==="photos"],["reportsTab",next==="reports"]]){
  $(id).classList.toggle("active",active);$(id).setAttribute("aria-pressed",String(active));
 }
 refresh();
}
function renderPhotos(){
 const stats=$("photoStats");clear(stats);
 for(const [key,label] of [["pending","ממתינות"],["approved","מאושרות"],["rejected","נדחו"]]){
  const box=element("div","stat"),count=element("strong","",photos.filter(p=>p.status===key).length);
  add(box,count,element("span","",label));stats.append(box);
 }
 const list=$("photoList");clear(list);
 const show=$("photoFilter").value;
 const filtered=photos.filter(p=>show==="all"||p.status===show);
 if(!filtered.length){list.append(element("p","muted","אין תמונות להצגה בסטטוס שנבחר."));return;}
 for(const p of filtered){
  const card=element("article","photoCard"),media=p.image_url?element("img"):element("div","emptyImg","תמונה אינה זמינה");
  if(p.image_url){media.src=p.image_url;media.loading="lazy";media.alt="תמונה לבדיקה: "+p.title;}
  const name=element("h3","",p.title);
  const time=element("p","meta","תאריך: "+date(p.created_at));
  const coords=element("p","meta","מיקום: "+Number(p.latitude).toFixed(5)+", "+Number(p.longitude).toFixed(5));
  const tags=element("div","tags");
  tags.append(element("span","tag",({pending:"ממתינה",approved:"מאושרת",rejected:"נדחתה"})[p.status]||p.status));
  if(p.legacy)tags.append(element("span","tag warn","העלאה ישנה — תעבור ניקוי לפני אישור"));
  const buttons=element("div","actions");
  if(p.status==="pending"){
   buttons.append(actionButton("אשר ופרסם",()=>moderate(p,"approve")));
   buttons.append(actionButton("דחה",()=>moderate(p,"reject"),"danger"));
  }
  add(card,media,name,time,coords,tags,buttons);list.append(card);
 }
}
async function moderate(photo,action){
 const approve=action==="approve";
 const question=approve
 ? "לאשר ולפרסם את התמונה לציבור לאחר ניקוי מטא־נתונים? בדקת זכויות, פרטיות, אנשים ומיקום?"
 : "לדחות את התמונה? היא לא תופיע במפה.";
 if(!window.confirm(question))return;
 status(approve?"מעבד את התמונה ומאשר...":"דוחה תמונה...");
 const buttons=$("photoList").querySelectorAll("button");buttons.forEach(x=>x.disabled=true);
 try{
  const result=await request("POST","",{action,photoId:photo.id});
  status(result.status==="approved"?"התמונה עובדה מחדש, אושרה ותופיע במפה.":"התמונה נדחתה.");
  photos=photos.map(p=>p.id===photo.id?{...p,status:result.status}:p);
  renderPhotos();
 }catch(err){status("הפעולה נכשלה: "+err.message,true);renderPhotos();}
}
const reasons={privacy:"פרטיות",copyright:"זכויות יוצרים",harmful:"תוכן פוגעני",incorrect_location:"מיקום שגוי",delete_request:"בקשת מחיקה",other:"אחר"};
async function setReport(report,next){
 if(!confirm("לעדכן את מצב הדיווח ל־"+next+"?"))return;
 try{
  const result=await request("POST","",{action:"report_status",reportId:report.id,status:next});
  reports=reports.map(r=>r.id===report.id?{...r,status:result.status}:r);
  renderReports();status("מצב הדיווח עודכן.");
 }catch(err){status("לא ניתן לעדכן דיווח: "+err.message,true);}
}
function renderReports(){
 const list=$("reportList");clear(list);
 if(!reports.length){list.append(element("p","muted","אין דיווחים במערכת."));return;}
 for(const r of reports){
  const card=element("article","reportCard");
  add(card,element("h3","",reasons[r.reason]||r.reason),
   element("p","meta",date(r.created_at)+" · "+r.status),
   element("p","reportText",r.details),
   element("p","meta","תמונה: "+(r.photo_id||"פנייה כללית")),
   element("p","meta","דוא״ל: "+(r.contact_email||"לא נמסר")));
  const actions=element("div","actions");
  if(r.status!=="in_review")actions.append(actionButton("בטיפול",()=>setReport(r,"in_review"),"ghost"));
  if(r.status!=="resolved")actions.append(actionButton("טופל",()=>setReport(r,"resolved")));
  if(r.status!=="rejected")actions.append(actionButton("סגור ללא טיפול",()=>setReport(r,"rejected"),"danger"));
  card.append(actions);list.append(card);
 }
}
$("loginForm").onsubmit=async event=>{
 event.preventDefault();
 if(!client)return status("החיבור לשרת אינו זמין",true,"loginStatus");
 const password=$("adminPassword").value;
 if(password.length<8)return status("יש להזין סיסמת מנהל באורך שמונה תווים לפחות.",true,"loginStatus");
 $("loginButton").disabled=true;status("מאמת הרשאות...",false,"loginStatus");
 try{
  const {error}=await client.auth.signInWithPassword({email:ADMIN,password});
  if(error)throw error;
  $("adminPassword").value="";
  await authenticate();
 }catch(err){status("ההתחברות נכשלה: "+err.message,true,"loginStatus");}
 finally{$("loginButton").disabled=false;}
};
$("magicForm").onsubmit=async event=>{
 event.preventDefault();
 if(!client)return status("החיבור לשרת אינו זמין",true,"loginStatus");
 $("magicButton").disabled=true;status("שולח קישור...",false,"loginStatus");
 try{
  const {error}=await client.auth.signInWithOtp({email:ADMIN,options:{emailRedirectTo:location.origin+"/admin.html",shouldCreateUser:false}});
  if(error)throw error;
  status("אם משלוח מיילים והפניות הוגדרו ב־Supabase, יישלח קישור. בדוק את תיבת PhotoMap.",false,"loginStatus");
 }catch(err){status("שליחת הקישור נכשלה: "+err.message,true,"loginStatus");}
 finally{$("magicButton").disabled=false;}
};
$("otpForm").onsubmit=async event=>{
 event.preventDefault();
 const otp=$("otpCode").value.trim();
 if(!/^[0-9]{6,8}$/.test(otp)){status("הזן קוד בן 6–8 ספרות.",true,"loginStatus");return;}
 try{
  const {error}=await client.auth.verifyOtp({email:ADMIN,token:otp,type:"email"});
  if(error)throw error;
  await authenticate();
 }catch(err){status("אימות הקוד נכשל: "+err.message,true,"loginStatus");}
};
$("logout").onclick=async()=>{await client.auth.signOut();location.reload();};
$("reload").onclick=refresh;
$("photosTab").onclick=()=>switchSection("photos");
$("reportsTab").onclick=()=>switchSection("reports");
$("photoFilter").onchange=renderPhotos;
if(client){
 client.auth.onAuthStateChange((event)=>{if(event==="SIGNED_IN"||event==="SIGNED_OUT")setTimeout(authenticate,0);});
 authenticate();
}else status("ספריית האימות לא נטענה.",true,"loginStatus");