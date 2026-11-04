import { createClient } from "npm:@supabase/supabase-js@2";
const ORIGIN = "https://indoornavigation.pages.dev";
const headers = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type",
  "Vary": "Origin",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8"
};
const output = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "GET") return output({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const publishable = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default
      || Deno.env.get("SUPABASE_ANON_KEY");
    const secret = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default
      || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !publishable || !secret) return output({ error: "Feed not configured" }, 503);
    // This client uses the public role and its SELECT RLS policy, not an admin role.
    const reader = createClient(url, publishable, { auth: { persistSession: false } });
    const admin = createClient(url, secret, { auth: { persistSession: false } });
    const { data, error } = await reader.from("photos")
      .select("id,title,image_path,latitude,longitude,created_at,captured_at,source_kind")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    const results = await Promise.all((data || []).map(async (photo) => {
      const { data: signed, error: signError } = await admin.storage.from("photos")
        .createSignedUrl(photo.image_path, 3600);
      if (signError || !signed?.signedUrl) return null;
      const { image_path: _path, ...safe } = photo;
      return { ...safe, image_url: signed.signedUrl };
    }));
    return output({ photos: results.filter(Boolean) });
  } catch (err) {
    console.error("photo-feed:", err);
    return output({ error: "Unable to load approved photos" }, 500);
  }
});