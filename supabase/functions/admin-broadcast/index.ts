import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(authHeader);
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();

    if (!profile || profile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Only admins can broadcast" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { title, message, target_role } = body;

    if (!title || !message) {
      return new Response(JSON.stringify({ success: false, error: "Thiếu title hoặc message" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build query to get target users
    let query = supabaseAdmin.from("profiles").select("id");
    if (target_role === "learners") {
      query = query.eq("role", "learner");
    } else if (target_role === "teachers") {
      query = query.in("role", ["vietnamese_teacher", "foreign_teacher"]);
    }
    // target_role === "all" → no filter, send to everyone

    const { data: users, error: userErr } = await query;

    if (userErr) {
      return new Response(JSON.stringify({ success: false, error: "Không thể lấy danh sách người dùng" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!users || users.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "Không có người dùng nào để gửi" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const notifications = users.map((u: { id: string }) => ({
      user_id: u.id,
      type: "system",
      title,
      message,
      is_read: false,
    }));

    // Insert in batches to avoid payload limit
    const batchSize = 100;
    let inserted = 0;

    for (let i = 0; i < notifications.length; i += batchSize) {
      const batch = notifications.slice(i, i + batchSize);
      const { error: insertErr } = await supabaseAdmin
        .from("notifications")
        .insert(batch);

      if (insertErr) {
        console.error("Batch insert error:", insertErr);
        return new Response(JSON.stringify({ success: false, error: `Lỗi khi gửi thông báo: ${insertErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      inserted += batch.length;
    }

    return new Response(
      JSON.stringify({ success: true, message: `Đã gửi thông báo đến ${inserted} người dùng!`, count: inserted }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Broadcast error:", err);
    return new Response(JSON.stringify({ success: false, error: "Lỗi máy chủ" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});