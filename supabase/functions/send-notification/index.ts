import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!
const ADMIN_EMAIL = "ljhiyh@gmail.com"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { type, data } = body

    let subject = ""
    let html = ""

    switch (type) {
      case "access_request": {
        const { email } = data
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
        const { email, calendarName, requestedRole } = data
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
        return json({ error: "Unknown notification type" }, 400)
    }

    // Send via Resend
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
      return json({ error: "Email send failed", details: result }, 500)
    }

    return json({ ok: true, id: result.id })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
