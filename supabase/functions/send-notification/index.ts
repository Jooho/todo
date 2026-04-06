import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
const ADMIN_EMAIL = "ljhiyh@gmail.com"

const ALLOWED_ORIGINS = [
  "https://jooho.github.io",
  "http://localhost:8000",
  "http://localhost:5500",
]

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || ""
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Verify JWT — only authenticated users can send notifications
    const authHeader = req.headers.get("authorization") || ""
    const token = authHeader.replace(/^Bearer\s+/i, "").trim()
    if (!token) {
      return json({ error: "Authentication required" }, 401, corsHeaders)
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return json({ error: "Invalid or expired token" }, 401, corsHeaders)
    }

    // Rate limit: max 5 notifications per user per minute (in-memory)
    const userId = user.id
    const now = Date.now()
    const key = `rate_${userId}`
    const rateData = (globalThis as any)[key] || { count: 0, resetAt: 0 }
    if (now > rateData.resetAt) {
      rateData.count = 0
      rateData.resetAt = now + 60000
    }
    if (rateData.count >= 5) {
      return json({ error: "Too many notifications. Try again later." }, 429, corsHeaders)
    }
    rateData.count++;
    (globalThis as any)[key] = rateData

    const body = await req.json()
    const { type, data } = body

    // Sanitize email input
    const sanitize = (s: string) => s.replace(/[<>&"']/g, c => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
    }[c] || c))

    let subject = ""
    let html = ""

    switch (type) {
      case "access_request": {
        const email = sanitize(data.email || "")
        if (!email) return json({ error: "email required" }, 400, corsHeaders)
        subject = `[Todo App] New access request from ${email}`
        html = `
          <h2>New Access Request</h2>
          <p><strong>${email}</strong> is requesting access to your Todo App.</p>
          <p>Go to <a href="https://jooho.github.io/todo/">Settings → User Management</a> to approve or reject.</p>
          <hr>
          <p style="color:#888;font-size:12px;">This is an automated notification from Todo Manager.</p>
        `
        break
      }

      case "calendar_request": {
        const email = sanitize(data.email || "")
        const calendarName = sanitize(data.calendarName || "")
        const requestedRole = sanitize(data.requestedRole || "viewer")
        if (!email) return json({ error: "email required" }, 400, corsHeaders)
        subject = `[Todo App] ${email} requests ${requestedRole} access to "${calendarName}"`
        html = `
          <h2>Calendar Access Request</h2>
          <p><strong>${email}</strong> is requesting <strong>${requestedRole}</strong> access to calendar "<strong>${calendarName}</strong>".</p>
          <p>Go to <a href="https://jooho.github.io/todo/">the calendar settings</a> to approve or reject.</p>
          <hr>
          <p style="color:#888;font-size:12px;">This is an automated notification from Todo Manager.</p>
        `
        break
      }

      default:
        return json({ error: "Unknown notification type" }, 400, corsHeaders)
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Todo App <onboarding@resend.dev>",
        to: [ADMIN_EMAIL],
        subject,
        html,
      }),
    })

    const result = await res.json()
    if (!res.ok) {
      return json({ error: "Email send failed" }, 500, corsHeaders)
    }

    return json({ ok: true }, 200, corsHeaders)
  } catch (e) {
    return json({ error: "Internal error" }, 500, corsHeaders)
  }
})

function json(data: unknown, status = 200, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
