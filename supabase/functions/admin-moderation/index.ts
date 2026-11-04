import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { Image } from "jsr:@matmen/imagescript@3.13.1";

const ORIGIN="https://indoornavigation.pages.dev";
const ADMIN_EMAIL="photomap.support@gmail.com";
const LEGACY_CUTOFF=Date.parse("2026-11-04T18:45:15Z");
const cors={
 "Access-Control-Allow-Origin":ORIGIN,
 "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
 "Access-Control-Allow-Headers":"authorization,apikey,content-type",
 "Vary":"Origin",
 "Cache-Control":"no-store",
 "Content-Type":"application/json;charset=utf-8"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async(req:Request)=>{
 if(req.headers.get("origin")!==ORIGIN)return json({error:"Forbidden origin"},403);
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="GET"&&req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const jwt=(req.headers.get("authorization")||"").match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
  if(!jwt)return json({error:"Authentication required"},401);
  const url=Deno.env.get("SUPABASE_URL");
  const pub=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}").default||Deno.env.get("SUPABASE_ANON_KEY");
  const secret=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!pub||!secret)return json({error:"Server configuration unavailable"},503);
  const auth=createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false}});
  const identity=await auth.auth.getUser(jwt);
  const user=identity.data.user;
  if(identity.error||!user)return json({error:"Invalid session"},401);
  if(user.email?.toLowerCase()!==ADMIN_EMAIL||!user.email_confirmed_at)
   return json({error:"Not an administrator"},403);
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  if(req.method==="GET"){
   const type=new URL(req.url).searchParams.get("type")||"photos";
   if(type==="session")return json({authenticated:true,email:ADMIN_EMAIL});
   if(type==="photos"){
    const {data,error}=await admin.from("photos")
      .select("id,title,image_path,latitude,longitude,status,created_at")
      .order("created_at",{ascending:false}).limit(100);
    if(error){console.error("moderation list",error.code);return json({error:"Could not list photos"},500);}
    const photos=await Promise.all((data||[]).map(async photo=>{
     const legacy=Date.parse(photo.created_at)<LEGACY_CUTOFF;
     const signed=await admin.storage.from("photos").createSignedUrl(photo.image_path,600);
     return {
       id:photo.id,title:photo.title,latitude:photo.latitude,longitude:photo.longitude,
       status:photo.status,created_at:photo.created_at,legacy,
       image_url:signed.error?null:signed.data?.signedUrl||null
     };
    }));
    return json({photos});
   }
   if(type==="reports"){
    const {data,error}=await admin.from("photo_reports")
      .select("id,photo_id,reason,details,contact_email,status,created_at")
      .order("created_at",{ascending:false}).limit(100);
    if(error){console.error("moderation reports",error.code);return json({error:"Could not list reports"},500);}
    return json({reports:data||[]});
   }
   return json({error:"Unknown list type"},400);
  }
  if(Number(req.headers.get("content-length")||0)>2000)return json({error:"Request too large"},413);
  const body=await req.json();
  const action=String(body.action||"");
  const photoId=String(body.photoId||"");
  if(action==="approve"||action==="reject"){
   if(!UUID.test(photoId))return json({error:"Invalid photo id"},400);
   const one=await admin.from("photos").select("id,title,image_path,status,created_at")
     .eq("id",photoId).maybeSingle();
   if(one.error)return json({error:"Could not access photo"},500);
   if(!one.data)return json({error:"Photo not found"},404);
   if(one.data.status!=="pending")return json({error:"Only pending photos can be moderated"},409);
   if(action==="reject"){
    const updated=await admin.from("photos").update({status:"rejected"})
      .eq("id",photoId).eq("status","pending").select("id").maybeSingle();
    if(updated.error||!updated.data)return json({error:"Photo was changed; refresh"},409);
    return json({success:true,status:"rejected"});
   }
   // Re-encode EVERY image on approval, including historical uploads, to remove metadata.
   const downloaded=await admin.storage.from("photos").download(one.data.image_path);
   if(downloaded.error||!downloaded.data)return json({error:"Image missing in private storage"},422);
   if(downloaded.data.size>8*1024*1024)return json({error:"Image too large to process"},422);
   let clean:Uint8Array;
   try{
    const bytes=new Uint8Array(await downloaded.data.arrayBuffer());
    const image=await Image.decode(bytes);
    if(!image.width||!image.height||image.width*image.height>25000000)throw new Error("Invalid dimensions");
    if(image.width>1920||image.height>1920)image.contain(1920,1920);
    clean=await image.encodeJPEG({quality:82});
    if(clean.byteLength>8*1024*1024)throw new Error("Image still too large");
   }catch(error){console.error("Moderation image decode",error instanceof Error?error.name:"error");return json({error:"Failed to safely clean image; cannot approve"},422);}
   const newPath=crypto.randomUUID()+".jpg";
   const saved=await admin.storage.from("photos").upload(newPath,clean,{contentType:"image/jpeg",upsert:false});
   if(saved.error)return json({error:"Could not save sanitized image"},500);
   const updated=await admin.from("photos").update({status:"approved",image_path:newPath})
     .eq("id",photoId).eq("status","pending").select("id").maybeSingle();
   if(updated.error||!updated.data){
    await admin.storage.from("photos").remove([newPath]);
    return json({error:"Photo was changed; refresh"},409);
   }
   const oldRemoved=await admin.storage.from("photos").remove([one.data.image_path]);
   if(oldRemoved.error)console.error("Could not remove previous private copy:",oldRemoved.error.message);
   return json({success:true,status:"approved",sanitized:true});
  }
  if(action==="report_status"){
   const reportId=String(body.reportId||"");
   const status=String(body.status||"");
   if(!UUID.test(reportId)||!["in_review","resolved","rejected"].includes(status))return json({error:"Invalid report update"},400);
   const result=await admin.from("photo_reports").update({status}).eq("id",reportId).select("id").maybeSingle();
   if(result.error||!result.data)return json({error:"Could not update report"},500);
   return json({success:true,status});
  }
  return json({error:"Unknown action"},400);
 }catch(error){
  console.error("Admin moderation",error instanceof Error?error.name:"unknown");
  return json({error:"Service temporarily unavailable"},500);
 }
});