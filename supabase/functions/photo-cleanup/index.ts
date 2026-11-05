import { createClient } from "npm:@supabase/supabase-js@2.95.0";
const reply=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{
 status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
});
const sha256=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,"0")).join("");
const MAX_PER_RUN=100;
type Candidate={
 photo_id:string;image_path:string;created_at:string;status:string;
 file_bytes:number|string;total_used_bytes:number|string;
 quota_bytes:number|string;threshold_fraction:number|string;
};
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 if(Number(req.headers.get("content-length")||0)>1024)return reply({error:"Request too large"},413);
 const token=req.headers.get("x-photomap-cleanup-key")||"";
 if(!/^[a-f0-9]{64}$/.test(token))return reply({error:"Unauthorized"},401);
 const url=Deno.env.get("SUPABASE_URL");
 const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||
  JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default;
 if(!url||!key)return reply({error:"Unavailable"},503);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const config=await db.from("photo_cleanup_config")
  .select("secret_hash,quota_bytes,threshold_fraction").eq("single_row",true).single();
 if(config.error||!config.data)return reply({error:"Configuration unavailable"},503);
 const hashed=await sha256(token);
 if(hashed!==config.data.secret_hash)return reply({error:"Unauthorized"},401);
 let dryRun=false;
 try{const body=await req.json();dryRun=body?.dryRun===true;}
 catch{return reply({error:"Invalid request body"},400);}
 const inventory=await db.rpc("photomap_cleanup_inventory");
 if(inventory.error){
  console.error("cleanup inventory error",inventory.error.code);
  return reply({error:"Inventory unavailable"},503);
 }
 const rows=(inventory.data||[]) as Candidate[];
 const total=rows.length?Number(rows[0].total_used_bytes):0;
 const quota=Number(config.data.quota_bytes);
 const fraction=Number(config.data.threshold_fraction);
 const threshold=Math.floor(quota*fraction);
 if(!Number.isSafeInteger(total)||!Number.isSafeInteger(quota)||quota<=0||!Number.isFinite(fraction)||
    fraction<=0||fraction>1)return reply({error:"Invalid storage accounting"},503);
 const now=Date.now(),cutoff=now-60*24*60*60*1000;
 let projected=total;
 const choices:Array<{photo:Candidate;reason:"age"|"pressure"}>=[];
 for(const p of rows){
  if(Date.parse(p.created_at)<=cutoff){
   choices.push({photo:p,reason:"age"});
   projected=Math.max(0,projected-Number(p.file_bytes||0));
  }
 }
 for(const p of rows){
  if(projected<threshold)break;
  if(choices.some(c=>c.photo.photo_id===p.photo_id))continue;
  choices.push({photo:p,reason:"pressure"});
  projected=Math.max(0,projected-Number(p.file_bytes||0));
 }
 if(dryRun)return reply({
  dryRun:true,photoRecordsScanned:rows.length,usedBytes:total,quotaBytes:quota,
  thresholdBytes:threshold,candidates:choices.length,aged:choices.filter(c=>c.reason==="age").length,
  pressure:choices.filter(c=>c.reason==="pressure").length,noFilesRemoved:true
 });
 let deleted=0,failed=0,reclaimed=0,aged=0,pressure=0;
 const run=await db.from("photo_cleanup_runs").insert({status:"running"}).select("id").single();
 if(run.error||!run.data)return reply({error:"Could not record cleanup"},503);
 for(const choice of choices.slice(0,MAX_PER_RUN)){
  const {photo,reason}=choice;
  try{
   const item=await db.from("photos").select("id,image_path,created_at").eq("id",photo.photo_id).maybeSingle();
   if(item.error)throw Error("Could not recheck image");
   if(!item.data||item.data.image_path!==photo.image_path)continue;
   if(reason==="age"&&Date.parse(item.data.created_at)>cutoff)continue;
   const removed=await db.storage.from("photos").remove([photo.image_path]);
   if(removed.error)throw Error("Storage deletion failed");
   const erased=await db.from("photos").delete().eq("id",photo.photo_id)
    .eq("image_path",photo.image_path).select("id").maybeSingle();
   if(erased.error)throw Error("Database deletion failed");
   if(!erased.data)continue;
   deleted++;
   reclaimed+=Math.max(0,Number(photo.file_bytes)||0);
   if(reason==="age")aged++;else pressure++;
  }catch(e){
   failed++;
   console.error("cleanup deletion error",photo.photo_id,e instanceof Error?e.message:"unknown");
  }
 }
 const status=failed>0?(deleted>0?"partial":"failed"):"completed";
 const notes=choices.length>MAX_PER_RUN?"More candidates remain for the next scheduled run":null;
 const updated=await db.from("photo_cleanup_runs").update({
  ended_at:new Date().toISOString(),status,deleted_count:deleted,bytes_reclaimed:reclaimed,
  aged_deleted:aged,pressure_deleted:pressure,failure_count:failed,notes
 }).eq("id",run.data.id);
 if(updated.error)console.error("cleanup audit update",updated.error.code);
 return reply({success:failed===0,status,deleted,ageDeleted:aged,pressureDeleted:pressure,
  failed,bytesReclaimed:reclaimed,remainingCandidates:Math.max(0,choices.length-MAX_PER_RUN)});
});