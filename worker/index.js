import { Client } from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHmac, timingSafeEqual, createHash } from "node:crypto";

const CATEGORIES = ["Fresh Ticket", "Reissue", "Date Change", "Sector Change", "Fare", "Availability", "Refund"];
const STATUSES = ["New", "Contacted", "Quote", "Won", "Lost"];
const CHANNELS = ["WhatsApp", "Facebook", "Instagram", "TikTok", "YouTube", "Manual"];
const ISSUER = "fly-next-social-hub";
const AUDIENCE = "fly-next-social-hub-users";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
function sign(user, env) {
  return jwt.sign(safeUser(user), env.JWT_SECRET, { expiresIn: "12h", issuer: ISSUER, audience: AUDIENCE });
}
function getUser(request, env) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  try { return jwt.verify(header.slice(7), env.JWT_SECRET, { issuer: ISSUER, audience: AUDIENCE }); }
  catch { return null; }
}
async function body(request) {
  try { return await request.json(); } catch { return {}; }
}
async function withDb(env, fn) {
  if (!env.HYPERDRIVE?.connectionString) throw new Error("Database binding is not configured.");
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}
function verifyMeta(request, raw, env) {
  const secret = env.META_APP_SECRET;
  const signature = request.headers.get("x-hub-signature-256") || "";
  if (!secret || !signature.startsWith("sha256=")) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(raw).digest("hex"));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function extractMeta(payload) {
  const out = [];
  if (payload?.object === "whatsapp_business_account") {
    for (const entry of payload.entry || []) for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = new Map((value.contacts || []).map(c => [c.wa_id, c.profile?.name || c.wa_id]));
      for (const m of value.messages || []) {
        const text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "";
        if (m.from && text) out.push({ id: m.id, name: contacts.get(m.from) || m.from, channel: "WhatsApp", text });
      }
    }
  } else {
    const channel = payload?.object === "instagram" ? "Instagram" : "Facebook";
    for (const entry of payload?.entry || []) for (const event of entry.messaging || []) {
      const text = event.message?.text || "";
      if (event.sender?.id && text && !event.message?.is_echo) out.push({ id: event.message?.mid, name: event.sender.id, channel, text });
    }
  }
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === "GET" && path === "/api/health") {
      try {
        await withDb(env, c => c.query("SELECT 1"));
        return json({ ok: true, app: "Fly Next Social Hub", database: true, persistence: "postgresql", environment: "production" });
      } catch {
        return json({ ok: false, app: "Fly Next Social Hub", database: false, persistence: "unavailable", environment: "production" }, 503);
      }
    }
    if (method === "GET" && path === "/webhooks/meta") {
      const q = url.searchParams;
      if (!env.META_VERIFY_TOKEN) return new Response("Webhook verification is not configured.", { status: 503 });
      if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === env.META_VERIFY_TOKEN) return new Response(q.get("hub.challenge") || "");
      return new Response("Forbidden", { status: 403 });
    }
    if (method === "POST" && path === "/webhooks/meta") {
      const raw = await request.arrayBuffer();
      const bytes = new Uint8Array(raw);
      if (!verifyMeta(request, bytes, env)) return json({ error: "Invalid webhook signature." }, 401);
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      const events = extractMeta(payload);
      if (!events.length) return json({ received: true, created: 0 });
      try {
        const created = await withDb(env, async c => {
          await c.query("BEGIN");
          try {
            let count = 0;
            for (const item of events) {
              const id = item.id || createHash("sha256").update([item.channel, item.name, item.text].join("|")).digest("hex");
              const accepted = await c.query("INSERT INTO webhook_events(provider,event_id) VALUES('meta',$1) ON CONFLICT(provider,event_id) DO NOTHING RETURNING id", [id]);
              if (!accepted.rowCount) continue;
              const lead = await c.query("INSERT INTO leads(customer_name,channel,category,route,message,status,assigned_to) VALUES($1,$2,'Fresh Ticket','',$3,'New','Admin') RETURNING id", [String(item.name).slice(0,160), item.channel, String(item.text).slice(0,3000)]);
              await c.query("INSERT INTO messages(lead_id,direction,channel,body) VALUES($1,'inbound',$2,$3)", [lead.rows[0].id, item.channel, String(item.text).slice(0,3000)]);
              count++;
            }
            await c.query("COMMIT");
            return count;
          } catch (e) { await c.query("ROLLBACK"); throw e; }
        });
        return json({ received: true, created });
      } catch (e) { return json({ error: "Webhook storage failed." }, 500); }
    }

    if (!path.startsWith("/api/")) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("Fly Next Social Hub assets are not configured.", { status: 404 });
    }

    if (method === "POST" && path === "/api/auth/login") {
      const data = await body(request);
      const email = String(data.email || "").trim().toLowerCase();
      const password = String(data.password || "");
      if (!email || !password || email.length > 254 || password.length > 1024) return json({ error: "Email and password are required." }, 400);
      try {
        const user = await withDb(env, async c => (await c.query("SELECT id,name,email,password_hash,role FROM users WHERE email=$1", [email])).rows[0]);
        const dummy = "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid";
        const valid = await bcrypt.compare(password, user?.password_hash || dummy).catch(() => false);
        if (!user || !valid) return json({ error: "Invalid email or password." }, 401);
        return json({ token: sign(user, env), user: safeUser(user) });
      } catch { return json({ error: "Login service is temporarily unavailable." }, 503); }
    }

    const user = getUser(request, env);
    if (!user) return json({ error: "Unauthorized" }, 401);

    try {
      return await withDb(env, async c => {
        if (method === "GET" && path === "/api/auth/me") return json({ user: safeUser(user) });
        if (method === "GET" && path === "/api/dashboard") {
          const rows = (await c.query("SELECT * FROM leads ORDER BY created_at DESC")).rows;
          return json({ stats: Object.fromEntries(STATUSES.map(s => [s, rows.filter(x => x.status === s).length])), total: rows.length, recent: rows.slice(0,8) });
        }
        if (method === "GET" && path === "/api/leads") {
          const q = url.searchParams;
          const values = [], where = [];
          for (const [key,col] of [["status","status"],["category","category"],["channel","channel"]]) {
            const v = q.get(key); if (v) { values.push(v); where.push(col+"=$"+values.length); }
          }
          const search = q.get("q");
          if (search) { values.push("%"+search.slice(0,200)+"%"); where.push("(customer_name ILIKE $"+values.length+" OR route ILIKE $"+values.length+" OR message ILIKE $"+values.length+")"); }
          const rows = (await c.query("SELECT * FROM leads "+(where.length ? "WHERE "+where.join(" AND ") : "")+" ORDER BY created_at DESC",values)).rows;
          return json(rows);
        }
        if (method === "POST" && path === "/api/leads") {
          const d = await body(request), name = String(d.customer_name || "").trim();
          if (!name) return json({ error: "Customer or agent name is required." },400);
          if (name.length > 160) return json({ error: "Name must be 160 characters or fewer." },400);
          const channel = CHANNELS.includes(d.channel) ? d.channel : "Manual";
          const category = CATEGORIES.includes(d.category) ? d.category : "Fresh Ticket";
          const row = (await c.query("INSERT INTO leads(customer_name,channel,category,route,message,status,assigned_to) VALUES($1,$2,$3,$4,$5,'New',$6) RETURNING *",[name,channel,category,String(d.route||"").slice(0,80),String(d.message||"").slice(0,3000),String(user.name||"Admin").slice(0,120)])).rows[0];
          return json(row,201);
        }
        const leadMatch = path.match(/^\/api\/leads\/(\d+)$/);
        if (method === "PATCH" && leadMatch) {
          const d=await body(request), id=Number(leadMatch[1]);
          if (d.status !== undefined && !STATUSES.includes(d.status)) return json({error:"Invalid status."},400);
          if (d.category !== undefined && !CATEGORIES.includes(d.category)) return json({error:"Invalid category."},400);
          const row=(await c.query("UPDATE leads SET status=COALESCE($1,status),category=COALESCE($2,category),assigned_to=COALESCE($3,assigned_to),updated_at=NOW() WHERE id=$4 RETURNING *",[d.status??null,d.category??null,d.assigned_to===undefined?null:String(d.assigned_to).slice(0,120),id])).rows[0];
          return row ? json(row) : json({error:"Lead not found"},404);
        }
        const msgMatch=path.match(/^\/api\/leads\/(\d+)\/messages$/);
        if (msgMatch && method === "GET") {
          const rows=(await c.query("SELECT * FROM messages WHERE lead_id=$1 ORDER BY created_at",[Number(msgMatch[1])])).rows;
          return json(rows);
        }
        if (msgMatch && method === "POST") {
          const id=Number(msgMatch[1]), d=await body(request), text=String(d.body||"").trim();
          if (!text || text.length>3000) return json({error:"Message is required and must be 3000 characters or fewer."},400);
          const row=(await c.query("INSERT INTO messages(lead_id,direction,channel,body) SELECT $1,'outbound',channel,$2 FROM leads WHERE id=$1 RETURNING *",[id,text])).rows[0];
          if (!row) return json({error:"Lead not found"},404);
          await c.query("UPDATE leads SET status='Contacted',updated_at=NOW() WHERE id=$1",[id]);
          return json(row,201);
        }
        if (method === "GET" && path === "/api/airline-updates") {
          const airline=(url.searchParams.get("airline")||"").toUpperCase(), category=url.searchParams.get("category")||"";
          const limit=Math.min(100,Math.max(1,Number(url.searchParams.get("limit"))||50)), values=[], where=[];
          if (["QR","EY","SV"].includes(airline)){values.push(airline);where.push("airline_code=$"+values.length);}
          if(category){values.push(category);where.push("category=$"+values.length);}
          values.push(limit);
          const updates=(await c.query("SELECT id,airline_code,category,headline,summary,source_url,source_name,source_published_at,first_seen_at,verification_status FROM airline_updates "+(where.length?"WHERE "+where.join(" AND "):"")+" ORDER BY COALESCE(source_published_at,first_seen_at) DESC LIMIT $"+values.length,values)).rows;
          const sources=(await c.query("SELECT airline_code,source_name,source_url,source_type,enabled,last_checked_at,last_success_at,last_error FROM airline_update_sources WHERE enabled=TRUE ORDER BY airline_code,source_name")).rows;
          return json({updates,sources});
        }
        if (method === "GET" && path === "/api/meta/status") return json({whatsapp:!!env.WHATSAPP_ACCESS_TOKEN,facebook:!!env.META_ACCESS_TOKEN,instagram:!!env.META_ACCESS_TOKEN,tiktok:!!env.TIKTOK_ACCESS_TOKEN,youtube:!!env.YOUTUBE_ACCESS_TOKEN});
        return json({error:"API endpoint not found."},404);
      });
    } catch (e) {
      console.error("Fly Next API error:", e?.message || "unknown");
      return json({ error: "Internal server error." }, 500);
    }
  }
};