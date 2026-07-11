// Supabase Edge Function: submit-score
// Validates a score server-side, then writes it with the service role (which
// bypasses RLS). The browser can no longer write best_score directly, so a
// fake score posted from the console is rejected here.
//
// Deploy: Supabase dashboard → Edge Functions → create "submit-score" → paste
// this → Deploy. Keep "Verify JWT" ON (default) so only signed-in users call it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CELLS = 400;                 // 20 x 20 board
const MAX_SCORE = CELLS - 2;       // a snake physically can't score more
const MIN_MS_PER_POINT = 50;       // generous floor: catches "instant" fake scores

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    // Who is calling? (verified against their JWT)
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "not signed in" }, 401);

    const { score, durationMs } = await req.json();

    // ---- validation ----
    if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
      return json({ error: "invalid score" }, 400);
    }
    if (typeof durationMs !== "number" || durationMs < score * MIN_MS_PER_POINT) {
      return json({ error: "implausible run" }, 400);
    }

    // ---- write with admin rights, but only if it's a genuine new best ----
    const admin = createClient(url, service);
    const { data, error } = await admin
      .from("profiles")
      .update({ best_score: score, updated_at: new Date().toISOString() })
      .eq("id", user.id)
      .lt("best_score", score)     // never lowers an existing best
      .select("best_score")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, best: data?.best_score ?? null });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
