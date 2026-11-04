"use strict";
const $=id=>document.getElementById(id);
const cfg=window.PHOTO_MAP_CONFIG||{};
const ADMIN="photomap.support@gmail.com";
// Only Supabase session tokens are retained; the user's password is never stored by this application.
const REMEMBER_KEY="photomap-admin-remember";
let remember=true;
try{remember=localStorage.getItem(REMEMBER_KEY)!=="no";}catch{remember=false;}
const sessionStorageAdapter={
 getItem(key){try{return (remember?localStorage:sessionStorage).getItem(key);}catch{return null;}},
 setItem(key,value){
  try{
   (remember?localStorage:sessionStorage).setItem(key,value);
   (remember?sessionStorage:localStorage).removeItem(key);
  }catch{ /* Private browsing may restrict persistence. */ }
 },
 removeItem(key){try{localStorage.removeItem(key);}catch{}try{sessionStorage.removeItem(key);}catch{}}
};
const client=window.supabase?.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{
 auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:sessionStorageAdapter}
});
$("rememberDevice").checked=remember;
let photos=[],reports=[],comments=[],section="photos",loading=false;
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
  }else if(section==="reports"){
   const result=await request("GET","?type=reports");reports=result.reports||[];
   renderReports();
  }else{
   const result=await request("GET","?type=comments");comments=result.comments||[];
   renderAdminComments();
  }
  status("הנתונים עודכנו ב־"+new Date().toLocaleTimeString("he-IL"));
 }catch(err){status("שגיאה: "+err.message,true);}
 finally{loading=false;$("reload").disabled=false;}
}
function switchSection(next){
 section=next;
 $("photosSection").hidden=next!=="photos";
 $("reportsSection").hidden=next!=="reports";
 $("commentsSection").hidden=next!=="comments";
 for(const [id,active] of [["photosTab",next==="photos"],["reportsTab",next==="reports"],["commentsTab",next==="comments"]]){
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
async function decideReport(report,decision){
 const removing=decision==="remove_report_photo";
 const photoName=report.photo_title||"התמונה המשויכת";
 const question=removing
  ? "להסיר מהאתר ולמחוק מהאחסון את התמונה ״"+photoName+"״? הפעולה בלתי הפיכה ואין אפשרות לשחזר את הקובץ."
  : "להשאיר באתר את התמונה ״"+photoName+"״ ולסגור את בקשת ההסרה ללא מחיקה?";
 if(!confirm(question))return;
 const buttons=$("reportList").querySelectorAll("button");
 buttons.forEach(button=>button.disabled=true);
 status(removing?"מסיר תמונה וסוגר פנייה...":"משאיר תמונה וסוגר פנייה...");
 try{
  const result=await request("POST","",{action:decision,reportId:report.id});
  reports=reports.map(r=>r.id===report.id
   ?{...r,status:result.report_status,photo_status:result.photo_status}
   :r);
  if(removing)photos=photos.map(p=>p.id===report.photo_id?{...p,status:"rejected",image_url:null}:p);
  renderReports();
  status(removing?"התמונה הוסרה מהפרסום ומהאחסון. הפנייה סומנה כטופלה.":"התמונה נשארה באתר. בקשת ההסרה נסגרה ללא מחיקה.");
 }catch(err){
  status("הפעולה לא הושלמה: "+err.message+". יש לרענן ולבדוק שוב.",true);
  await refresh();
 }
}
function renderReports(){
 const list=$("reportList");clear(list);
 if(!reports.length){list.append(element("p","muted","אין דיווחים במערכת."));return;}
 for(const r of reports){
  const card=element("article","reportCard");
  const title=r.photo_id?(r.photo_title||"תמונה לא זמינה"):"פנייה כללית (ללא תמונה)";
  add(card,
   element("h3","",reasons[r.reason]||r.reason),
   element("p","meta",date(r.created_at)+" · "+({new:"חדשה",in_review:"בטיפול",resolved:"טופלה",rejected:"נסגרה ללא הסרה"})[r.status]),
   element("p","reportPhotoTitle","שם התמונה: "+title),
   element("p","reportText",r.details),
   element("p","meta","דוא״ל: "+(r.contact_email||"לא נמסר")));
  const actions=element("div","actions");
  const open=["new","in_review"].includes(r.status);
  if(open){
   if(r.photo_id&&r.photo_status){
    actions.append(actionButton("הסר תמונה",()=>decideReport(r,"remove_report_photo"),"danger"));
    if(r.photo_status!=="rejected")actions.append(actionButton("השאר תמונה",()=>decideReport(r,"keep_report_photo"),"ghost"));
   }else if(r.photo_id){
    actions.append(element("p","muted","התמונה לא נמצאה. יש לטפל בפנייה ידנית."));
   }
   if(r.status==="new")actions.append(actionButton("בטיפול",()=>setReport(r,"in_review"),"ghost"));
   if(!r.photo_id)actions.append(actionButton("סמן כטופל",()=>setReport(r,"resolved")));
  }else{
   actions.append(element("span","tag",r.status==="resolved"?"טופל — התמונה הוסרה / הפנייה נסגרה":"נסגרה ללא הסרת תמונה"));
  }
  card.append(actions);list.append(card);
 }
}
async function moderateComment(comment,next){
 if(!confirm((next==="approved"?"לאשר ולפרסם":"לדחות")+" את התגובה של "+comment.display_name+"?"))return;
 try{
  const result=await request("POST","",{action:"comment_status",commentId:comment.id,status:next});
  comments=comments.map(c=>c.id===comment.id?{...c,status:result.status}:c);
  renderAdminComments();
  status(next==="approved"?"התגובה אושרה ותופיע לציבור.":"התגובה נדחתה.");
 }catch(error){status("לא ניתן לעדכן תגובה: "+error.message,true);}
}
function renderAdminComments(){
 const list=$("adminCommentsList");clear(list);
 const pending=comments.filter(c=>c.status==="pending");
 if(!pending.length){list.append(element("p","muted","אין תגובות שממתינות לאישור."));return;}
 for(const c of pending){
  const card=element("article","reportCard");
  add(card,element("h3","",c.photo_title),
   element("p","meta","מאת: "+c.display_name+" · "+date(c.created_at)),
   element("p","reportText",c.body));
  const actions=element("div","actions");
  actions.append(actionButton("אשר תגובה",()=>moderateComment(c,"approved")));
  actions.append(actionButton("דחה תגובה",()=>moderateComment(c,"rejected"),"danger"));
  card.append(actions);list.append(card);
 }
}
$("loginForm").onsubmit=async event=>{
 event.preventDefault();
 if(!client)return status("החיבור לשרת אינו זמין",true,"loginStatus");
 remember=$("rememberDevice").checked;
 try{localStorage.setItem(REMEMBER_KEY,remember?"yes":"no");}catch{}
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
$("logout").onclick=async()=>{await client.auth.signOut({scope:"local"});location.reload();};
$("reload").onclick=refresh;
$("photosTab").onclick=()=>switchSection("photos");
$("reportsTab").onclick=()=>switchSection("reports");
$("commentsTab").onclick=()=>switchSection("comments");
$("photoFilter").onchange=renderPhotos;
if(client){
 client.auth.onAuthStateChange((event)=>{if(event==="SIGNED_IN"||event==="SIGNED_OUT")setTimeout(authenticate,0);});
 authenticate();
}else status("ספריית האימות לא נטענה.",true,"loginStatus");