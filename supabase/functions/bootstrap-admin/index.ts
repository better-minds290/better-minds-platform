
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
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const email = "dinhxuanloc123456@gmail.com";
    const password = "Admin@123456";
    const full_name = "Đinh Xuân Lộc";
    const role = "admin";

    // Check if user already exists
    const { data: existingUsers } = await supabaseClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find((u: { email?: string }) => u.email === email);

    let userId: string;
    let action: string;

    if (existingUser) {
      userId = existingUser.id;

      // Reset password AND update user_metadata to ensure role is correct
      const { error: updateError } = await supabaseClient.auth.admin.updateUserById(
        userId,
        { password, email_confirm: true, user_metadata: { full_name, role } }
      );

      if (updateError) {
        console.error("Password reset error:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to reset password: " + updateError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      action = "reset";
      console.log("Admin user already existed. Password reset, metadata updated, and profile role set to admin.");
    } else {
      const { data: newUser, error: createError } = await supabaseClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name,
          role,
        },
      });

      if (createError) {
        return new Response(
          JSON.stringify({ error: createError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      userId = newUser.user.id;
      action = "created";
    }

    // Always upsert the profile with correct admin role
    const { error: profileError } = await supabaseClient
      .from("profiles")
      .upsert({
        id: userId,
        full_name,
        role,
        email,
      }, { onConflict: "id" });

    if (profileError) {
      console.error("Profile upsert error:", profileError);
      return new Response(
        JSON.stringify({ error: "Failed to set admin role on profile: " + profileError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        action,
        message: action === "created"
          ? "Admin account created successfully"
          : "Admin account already existed. Password has been reset, metadata synced, and role is now admin.",
        user: {
          id: userId,
          email,
          role,
          full_name,
        },
        loginInfo: {
          email,
          password,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
