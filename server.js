require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || (IS_PRODUCTION ? "" : "local-development-only-secret-change-before-deploying");
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "admin@flynext.pk").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);

if (IS_PRODUCTION) {
  const missing = [];
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) missing.push("JWT_SECRET (at least 32 characters)");
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) missing.push("ADMIN_PASSWORD (at least 12 characters)");
  if (missing.length) {
    console.error("Production configuration incomplete: " + missing.join(", "));
    process.exit(1);
  }
}

if (IS_PRODUCTION) app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  pool.on("error", err => console.error("Unexpected PostgreSQL pool error:", err.message));
}

const memory = { users: [], leads: [], messages: [] };
if (!pool && !IS_PRODUCTION) {
  memory.leads = [
    { id: 1, customer_name: "Demo Customer", channel: "WhatsApp", category: "Fresh Ticket", route: "PEW-JED", message: "Need fare and availability for tomorrow", status: "New", assigned_to: "Admin", created_at: new Date().toISOString() },
    { id: 2, customer_name: "Travel Agent", channel: "Facebook", category: "Reissue", route: "DOH-PEW", message: "Please check date change charges", status: "Contacted", assigned_to: "Admin", created_at: new Date().toISOString() }
  ];
  if (ADMIN_PASSWORD) memory.users.push({
    id: 1, name: "Admin", email: ADMIN_EMAIL,
    passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 12), role: "admin"
  });
}

async function db(query, params = []) {
  if (!pool) return null;
  return (await pool.query(query, params)).rows;
}

async function initDb() {
  if (!pool) return;
  await pool.query(
    "CREATE TABLE IF NOT EXISTS users (" +
    "id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, " +
    "password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'agent', created_at TIMESTAMPTZ DEFAULT NOW());" +
    "CREATE TABLE IF NOT EXISTS leads (" +
    "id SERIAL PRIMARY KEY, customer_name TEXT NOT NULL, channel TEXT NOT NULL, category TEXT NOT NULL, " +
    "route TEXT DEFAULT '', message TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'New', " +
    "assigned_to TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());" +
    "CREATE TABLE IF NOT EXISTS messages (" +
    "id SERIAL PRIMARY KEY, lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE, " +
    "direction TEXT NOT NULL, channel TEXT NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());"
  );
  const count = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  if (count.rows[0].count === 0) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await pool.query(
      "INSERT INTO users(name, email, password_hash, role) VALUES($1, $2, $3, $4)",
      ["Admin", ADMIN_EMAIL, hash, "admin"]
    );
    console.log("Initial admin account created from environment configuration.");
  }
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const categories = ["Fresh Ticket", "Reissue", "Date Change", "Sector Change", "Fare", "Availability", "Refund"];
const statuses = ["New", "Contacted", "Quote", "Won", "Lost"];
const channels = ["WhatsApp", "Facebook", "Instagram", "TikTok", "YouTube", "Manual"];

// Basic per-process protection against repeated password guessing.
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
function loginRateLimit(req, res, next) {
  const now = Date.now();
  for (const [key, entry] of loginAttempts) if (entry.resetAt <= now) loginAttempts.delete(key);
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const entry = loginAttempts.get(key);
  if (entry && entry.count >= LOGIN_MAX_ATTEMPTS && entry.resetAt > now) {
    res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ error: "Too many login attempts. Try again in 15 minutes." });
  }
  req.loginRateKey = key;
  next();
}
function recordFailedLogin(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else entry.count += 1;
}

app.get("/api/health", (req, res) => res.json({
  ok: true,
  app: "Fly Next Social Hub",
  database: !!pool,
  environment: IS_PRODUCTION ? "production" : "development"
}));

app.post("/api/auth/login", loginRateLimit, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password || email.length > 254 || password.length > 1024) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const user = pool
    ? (await db("SELECT id, name, email, password_hash, role FROM users WHERE email = $1", [email]))[0]
    : memory.users.find(item => item.email === email);
  const hash = user ? (user.password_hash || user.passwordHash) : "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid";
  const matches = await bcrypt.compare(password, hash).catch(() => false);
  if (!user || !matches) {
    recordFailedLogin(req.loginRateKey);
    return res.status(401).json({ error: "Invalid email or password" });
  }

  loginAttempts.delete(req.loginRateKey);
  const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
  return res.json({ token: jwt.sign(safeUser, JWT_SECRET, { expiresIn: "12h", issuer: "fly-next-social-hub", audience: "fly-next-social-hub-users" }), user: safeUser });
}));

app.get("/api/dashboard", auth, asyncHandler(async (req, res) => {
  const leads = pool ? await db("SELECT * FROM leads ORDER BY created_at DESC") : memory.leads;
  res.json({ stats: Object.fromEntries(statuses.map(status => [status, leads.filter(lead => lead.status === status).length])), total: leads.length, recent: leads.slice(0, 8) });
}));

app.get("/api/leads", auth, asyncHandler(async (req, res) => {
  const { status, category, channel, q } = req.query;
  let leads = pool ? await db("SELECT * FROM leads ORDER BY created_at DESC") : memory.leads;
  leads = leads.filter(lead =>
    (!status || lead.status === status) &&
    (!category || lead.category === category) &&
    (!channel || lead.channel === channel) &&
    (!q || JSON.stringify(lead).toLowerCase().includes(String(q).slice(0, 200).toLowerCase()))
  );
  res.json(leads);
}));

app.post("/api/leads", auth, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const customerName = String(body.customer_name || "").trim();
  if (!customerName) return res.status(400).json({ error: "Customer or agent name is required." });
  if (customerName.length > 160) return res.status(400).json({ error: "Name must be 160 characters or fewer." });
  const channel = channels.includes(body.channel) ? body.channel : "Manual";
  const category = categories.includes(body.category) ? body.category : "Fresh Ticket";
  const route = String(body.route || "").trim().slice(0, 80);
  const message = String(body.message || "").trim().slice(0, 3000);
  const lead = { customer_name: customerName, channel, category, route, message, status: "New", assigned_to: String(req.user.name || "Admin").slice(0, 120) };

  if (pool) {
    const rows = await db(
      "INSERT INTO leads(customer_name, channel, category, route, message, status, assigned_to) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [lead.customer_name, lead.channel, lead.category, lead.route, lead.message, lead.status, lead.assigned_to]
    );
    return res.status(201).json(rows[0]);
  }
  lead.id = Math.max(0, ...memory.leads.map(item => item.id)) + 1;
  lead.created_at = new Date().toISOString();
  memory.leads.unshift(lead);
  res.status(201).json(lead);
}));

app.patch("/api/leads/:id", auth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid lead ID." });
  const body = req.body || {};
  if (body.status !== undefined && !statuses.includes(body.status)) return res.status(400).json({ error: "Invalid status." });
  if (body.category !== undefined && !categories.includes(body.category)) return res.status(400).json({ error: "Invalid category." });
  const assignedTo = body.assigned_to === undefined ? undefined : String(body.assigned_to).trim().slice(0, 120);

  if (pool) {
    const rows = await db(
      "UPDATE leads SET status=COALESCE($1,status), category=COALESCE($2,category), assigned_to=COALESCE($3,assigned_to), updated_at=NOW() WHERE id=$4 RETURNING *",
      [body.status ?? null, body.category ?? null, assignedTo ?? null, id]
    );
    return rows[0] ? res.json(rows[0]) : res.status(404).json({ error: "Lead not found" });
  }

  const lead = memory.leads.find(item => item.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (body.status !== undefined) lead.status = body.status;
  if (body.category !== undefined) lead.category = body.category;
  if (assignedTo !== undefined) lead.assigned_to = assignedTo;
  lead.updated_at = new Date().toISOString();
  res.json(lead);
}));

app.get("/api/leads/:id/messages", auth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid lead ID." });
  res.json(pool ? await db("SELECT * FROM messages WHERE lead_id=$1 ORDER BY created_at", [id]) : memory.messages.filter(item => item.lead_id === id));
}));

app.post("/api/leads/:id/messages", auth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const body = String(req.body?.body || "").trim();
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid lead ID." });
  if (!body) return res.status(400).json({ error: "Message is required" });
  if (body.length > 3000) return res.status(400).json({ error: "Message must be 3000 characters or fewer." });

  if (pool) {
    const rows = await db(
      "INSERT INTO messages(lead_id, direction, channel, body) SELECT $1, 'outbound', channel, $2 FROM leads WHERE id=$1 RETURNING *",
      [id, body]
    );
    if (!rows[0]) return res.status(404).json({ error: "Lead not found" });
    await db("UPDATE leads SET status='Contacted', updated_at=NOW() WHERE id=$1", [id]);
    return res.status(201).json(rows[0]);
  }

  const lead = memory.leads.find(item => item.id === id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  const message = { id: memory.messages.length + 1, lead_id: id, direction: "outbound", channel: lead.channel, body, created_at: new Date().toISOString() };
  memory.messages.push(message);
  lead.status = "Contacted";
  lead.updated_at = new Date().toISOString();
  res.status(201).json(message);
}));

app.get("/api/meta/status", auth, (req, res) => res.json({
  whatsapp: !!process.env.WHATSAPP_ACCESS_TOKEN,
  facebook: !!process.env.META_ACCESS_TOKEN,
  instagram: !!process.env.META_ACCESS_TOKEN,
  tiktok: !!process.env.TIKTOK_ACCESS_TOKEN,
  youtube: !!process.env.YOUTUBE_ACCESS_TOKEN
}));

app.get("/webhooks/meta", (req, res) => {
  const mode = req.query["hub.mode"];
  const verifyToken = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && process.env.META_VERIFY_TOKEN && verifyToken === process.env.META_VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});
app.post("/webhooks/meta", (req, res) => res.status(501).json({ error: "Webhook receipt is not connected to lead ingestion yet." }));

app.use("/api", (req, res) => res.status(404).json({ error: "API endpoint not found." }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.use((err, req, res, next) => {
  console.error("Request failed:", err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error." });
});

initDb()
  .then(() => app.listen(PORT, () => console.log("Fly Next Social Hub running on port " + PORT)))
  .catch(error => {
    console.error("Startup/database initialization failed:", error.message);
    process.exit(1);
  });
