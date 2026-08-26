import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  isSendEmailAuthExemptMethod,
  isTrustedSendEmailCaller,
  resolveReplyTo,
  sendRawViaResend,
} from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  // Preflight only — never sends mail and never skips POST auth.
  if (isSendEmailAuthExemptMethod(req.method)) {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (
      !isTrustedSendEmailCaller({
        authorizationHeader: req.headers.get("Authorization"),
        serviceRoleKey,
      })
    ) {
      return json({ error: "Forbidden" }, 403);
    }

    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return json({ error: "RESEND_API_KEY not configured" }, 500);
    }

    const body = await req.json();
    const to = typeof body.to === "string" ? body.to.trim() : "";
    const subject = typeof body.subject === "string" ? body.subject : "";
    const html = typeof body.html === "string" ? body.html : "";
    const replyTo = resolveReplyTo({
      override: typeof body.reply_to === "string" ? body.reply_to : null,
      envValue: Deno.env.get("EMAIL_REPLY_TO"),
    });

    if (!to || !subject || !html) {
      return json({ error: "Missing to, subject, or html" }, 400);
    }

    const sent = await sendRawViaResend({
      resendApiKey,
      to,
      subject,
      html,
      replyTo,
    });

    if (!sent.ok) {
      console.error("Resend API error:", sent.error);
      return json({ error: "Failed to send email", detail: sent.error }, 502);
    }

    return json({ success: true, id: sent.id });
  } catch (err) {
    console.error("Unexpected error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
