import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { Image } from "jsr:@matmen/imagescript@3.13.1";
const ORIGIN="https://indoornavigation.pages.dev",LIMIT=8*1024*1024;
const cors={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"apikey, authorization, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const answer=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const valid=(a:Uint8Array,m:string)=>m==="image/jpeg"?a.length>3&&a[0]===255&&a[1]===216&&a[2]===255:m==="image/png"?[137,80,78,71,13,10,26,10].every((n,i)=>a[i]===n):m==="image/webp"?String.fromCharCode(...a.slice(0,4))==="RIFF"&&String.fromCharCode(...a.slice(8,12))==="WEBP":false;
Deno.serve(async(req:Request)=>{
 if(req.headers.get("origin")!==ORIGIN)return answer({error:"Origin not allowed"},403);
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST")return answer({error:"Method not allowed"},405);
 const captchaSecret=Deno.env.get("TURNSTILE_SECRET_KEY");
 if(!captchaSecret)return answer({error:"Uploads are not configured"},503);
 if(Number(req.headers.get("content-length")||0)>LIMIT+20000)return answer({error:"File too large"},413);
 try{
 const form=await req.formData(),file=form.get("photo"),title=String(form.get("title")||"").trim();
 const latText=form.get("latitude"),lngText=form.get("longitude"),lat=Number(latText),lng=Number(lngText),token=String(form.get("captchaToken")||"");
 if(!(file instanceof File)||!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size<100||file.size>LIMIT)return answer({error:"Invalid image"},400);
 if(!title||title.length>80||latText===null||lngText===null||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return answer({error:"Invalid details"},400);
 if(form.get("confirmRights")!=="yes"||form.get("confirmLocation")!=="yes"||form.get("adult")!=="yes")return answer({error:"Consent and age confirmations required"},400);
 if(!token)return answer({error:"CAPTCHA required"},403);
 const ip=(req.headers.get("x-forwarded-for")||req.headers.get("cf-connecting-ip")||"unknown").split(",")[0].trim();
 const verifyForm=new FormData();verifyForm.append("secret",captchaSecret);verifyForm.append("response",token);if(ip!=="unknown")verifyForm.append("remoteip",ip);
 const check=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",body:verifyForm});
 const outcome=await check.json();
 if(!outcome.success||outcome.hostname!=="indoornavigation.pages.dev")return answer({error:"CAPTCHA verification failed"},403);
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default;
 if(!url||!key)return answer({error:"Upload service not configured"},503);
 const admin=createClient(url,key,{auth:{persistSession:false}});
 const hashed=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(new Date().toISOString().slice(0,10)+":"+captchaSecret+":"+ip));
 const fingerprint=Array.from(new Uint8Array(hashed),n=>n.toString(16).padStart(2,"0")).join("");
 const quota=await admin.rpc("reserve_photo_upload_slot",{p_identity:fingerprint});
 if(quota.error){console.error("quota",quota.error.code);return answer({error:"Rate check failed"},503);}
 if(!quota.data)return answer({error:"Daily upload limit reached"},429);
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(!valid(bytes,file.type))return answer({error:"Invalid image signature"},400);
 let cleaned:Uint8Array;
 try{
   const img=await Image.decode(bytes);
   if(!img.width||!img.height||img.width*img.height>25000000)return answer({error:"Image resolution too large"},413);
   if(img.width>1920||img.height>1920)img.contain(1920,1920);
   cleaned=await img.encodeJPEG({quality:82});
 }catch(err){console.error("image-clean",err instanceof Error?err.name:"decode");return answer({error:"Could not safely process this image"},422);}
 if(cleaned.byteLength>LIMIT)return answer({error:"Image exceeds size limit"},413);
 const path=crypto.randomUUID()+".jpg";
 const upload=await admin.storage.from("photos").upload(path,cleaned,{contentType:"image/jpeg",upsert:false});
 if(upload.error){console.error("storage",upload.error.message);return answer({error:"Storage temporarily unavailable"},500);}
 const saved=await admin.from("photos").insert({title,image_path:path,latitude:lat,longitude:lng,status:"pending"});
 if(saved.error){console.error("db",saved.error.code);await admin.storage.from("photos").remove([path]);return answer({error:"Could not save photo"},500);}
 return answer({success:true,message:"Photo submitted for review"});
 }catch(err){console.error("upload-photo-secure",err instanceof Error?err.name:"unknown");return answer({error:"Upload unavailable"},500);}
});