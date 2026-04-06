import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Extract token
    const authHeader = req.headers.get("authorization") || ""
    const token = authHeader.replace(/^Bearer\s+/i, "").trim()
    if (!token || !token.startsWith("mtsk_")) {
      return json({ error: "Missing or invalid API token. Use: Authorization: Bearer mtsk_..." }, 401)
    }

    // Hash token for DB lookup
    const tokenHash = await sha256(token)
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // Validate token
    const { data: tokenRec } = await supabase
      .from("api_tokens")
      .select("user_id, expires_at")
      .eq("token_hash", tokenHash)
      .eq("is_active", true)
      .single()

    if (!tokenRec) {
      return json({ error: "Invalid or revoked token" }, 401)
    }

    // Check expiry
    if (tokenRec.expires_at && new Date(tokenRec.expires_at) < new Date()) {
      return json({ error: "Token expired" }, 401)
    }

    const userId = tokenRec.user_id

    // Update last_used_at
    supabase.from("api_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("token_hash", tokenHash).then(() => {})

    // Parse body
    let body: Record<string, unknown> = {}
    if (req.method === "POST") {
      try { body = await req.json() } catch { body = {} }
    }

    const action = (body.action as string) || "list"

    switch (action) {
      case "list": {
        const q = supabase.from("tasks").select("*")
          .eq("user_id", userId).eq("archived", false)
          .is("shared_calendar_id", null)
          .order("created_at", { ascending: false })
        if (body.category) q.eq("category", body.category as string)
        if (body.completed !== undefined) q.eq("completed", body.completed as boolean)
        if (body.limit) q.limit(body.limit as number)
        const { data, error } = await q
        if (error) return json({ error: error.message }, 400)
        return json({ tasks: data, count: data?.length || 0 })
      }

      case "create": {
        if (!body.text) return json({ error: "text is required" }, 400)
        const now = new Date().toISOString()
        const { data, error } = await supabase.from("tasks").insert({
          id: crypto.randomUUID(),
          text: body.text,
          description: (body.description as string) || "",
          category: (body.category as string) || "work",
          completed: false, archived: false,
          due_date: (body.dueDate as string) || now.split("T")[0],
          due_time: (body.dueTime as string) || null,
          subtasks: (body.subtasks as unknown[]) || [],
          user_id: userId,
          created_at: now, updated_at: now,
        }).select().single()
        if (error) return json({ error: error.message }, 400)
        return json({ task: data, message: "Task created" }, 201)
      }

      case "update": {
        if (!body.id) return json({ error: "id is required" }, 400)
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
        for (const k of ["text", "description", "category", "completed", "subtasks"]) {
          if (body[k] !== undefined) updates[k] = body[k]
        }
        if (body.dueDate !== undefined) updates.due_date = body.dueDate
        if (body.dueTime !== undefined) updates.due_time = body.dueTime
        const { data, error } = await supabase.from("tasks")
          .update(updates).eq("id", body.id).eq("user_id", userId).select().single()
        if (error) return json({ error: error.message }, 400)
        return json({ task: data, message: "Task updated" })
      }

      case "delete": {
        if (!body.id) return json({ error: "id is required" }, 400)
        const { error } = await supabase.from("tasks")
          .delete().eq("id", body.id).eq("user_id", userId)
        if (error) return json({ error: error.message }, 400)
        return json({ message: "Task deleted" })
      }

      case "toggle": {
        if (!body.id) return json({ error: "id is required" }, 400)
        const { data: t } = await supabase.from("tasks")
          .select("completed").eq("id", body.id).eq("user_id", userId).single()
        if (!t) return json({ error: "Task not found" }, 404)
        const { data, error } = await supabase.from("tasks")
          .update({ completed: !t.completed, updated_at: new Date().toISOString() })
          .eq("id", body.id).eq("user_id", userId).select().single()
        if (error) return json({ error: error.message }, 400)
        return json({ task: data, message: `Task ${data.completed ? "completed" : "uncompleted"}` })
      }

      default:
        return json({ error: `Unknown action: ${action}`, actions: ["list", "create", "update", "delete", "toggle"] }, 400)
    }
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

async function sha256(msg: string): Promise<string> {
  const data = new TextEncoder().encode(msg)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("")
}
