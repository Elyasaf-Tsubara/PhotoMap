import { createClient } from "npm:@supabase/supabase-js@2.95.0";
const ORIGIN="https://indoornavigation.pages.dev";
const cors={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"apikey,authorization,content-type","Vary":"Origin","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:cors});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean=(v:string)=>v.normalize("NFKC").replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g,"").trim();
const moderate=(v:string)=>{
 const lower=clean(v).toLowerCase().replace(/[\s._\-!@#$%^&*()+={}\[\]\\|~\x60;:'",<>?\/]+/g,"");
 const blocked=["זונה","שרמוט","בןזונה","בתזונה","מניאק","תמות","נאצי","כוסאמק","fuck","bitch","nigger","kill yourself","porn","nude"];
 return blocked.some(t=>lower.includes(t.replace(/\s+/g,"")));
};
Deno.serve(async(req:Request)=>{
 if(req.headers.get("origin")!==ORIGIN)return json({error:"Forbidden origin"},403);
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(!["GET","POST"].includes(req.method))return json({error:"Method not allowed"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL");
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default;
  if(!url||!key)return json({error:"Service unavailable"},503);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  if(req.method==="GET"){
   const photoId=new URL(req.url).searchParams.get("photoId")||"";
   if(!uuid.test(photoId))return json({error:"Invalid photo id"},400);
   const photo=await db.from("photos").select("id").eq("id",photoId).eq("status","approved").maybeSingle();
   if(photo.error||!photo.data)return json({error:"Photo not available"},404);
   const r=await db.from("photo_comments").select("id,display_name,body,created_at").eq("photo_id",photoId).eq("status","approved").order("created_at",{ascending:true}).limit(50);
   if(r.error)return json({error:"Comments not available"},503);
   return json({comments:r.data||[]});
  }
  if(Number(req.headers.get("content-length")||0)>4000)return json({error:"Request too large"},413);
  const body=await req.json();
  const photoId=String(body.photoId||"");
  const name=clean(String(body.name||""));
  const message=clean(String(body.message||""));
  const token=String(body.captchaToken||"");
  if(!uuid.test(photoId)||name.length<2||name.length>35||message.length<3||message.length>500)return json({error:"Invalid comment"},400);
  if(/[<>]/.test(name)||/[\u0000-\u001F]/.test(name+message)||/(?:https?:\/\/|www\.|@\w+\.)/i.test(message))return json({error:"Comment contains unsupported links or symbols"},400);
  if(moderate(name)||moderate(message))return json({error:"Comment blocked by safety filter"},422);
  if(!token)return json({error:"Verification required"},403);
  const secret=Deno.env.get("TURNSTILE_SECRET_KEY");
  if(!secret)return json({error:"Verification unavailable"},503);
  const ip=(req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")||"unknown").split(",")[0].trim();
  const verify=new FormData();verify.append("secret",secret);verify.append("response",token);
  if(ip!=="unknown")verify.append("remoteip",ip);
  const result=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",body:verify});
  const checked=await result.json();
  if(!checked.success||checked.hostname!=="indoornavigation.pages.dev")return json({error:"Verification failed"},403);
  const photo=await db.from("photos").select("id").eq("id",photoId).eq("status","approved").maybeSingle();
  if(photo.error||!photo.data)return json({error:"Photo not available"},404);
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(new Date().toISOString().slice(0,10)+":"+secret+":"+ip))),v=>v.toString(16).padStart(2,"0")).join("");
  const reserved=await db.rpc("reserve_photo_comment_slot",{p_identity:fingerprint});
  if(reserved.error||!reserved.data)return json({error:"Daily comment limit reached"},429);
  const saved=await db.from("photo_comments").insert({photo_id:photoId,display_name:name,body:message,status:"pending"}).select("id").single();
  if(saved.error){console.error("comment-insert",saved.error.code);return json({error:"Could not save comment"},500);}
  return json({success:true,moderation:"pending",receipt:saved.data.id});
 }catch(err){console.error("comment-service",err instanceof Error?err.name:"error");return json({error:"Comments temporarily unavailable"},500);}
});