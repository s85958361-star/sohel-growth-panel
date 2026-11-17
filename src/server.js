
"use strict";

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.set("trust proxy", 1);

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is missing");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL &&
       !process.env.DATABASE_URL.includes("localhost")
       ? { rejectUnauthorized: false } : false
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 86400000
  }
}));

app.use(express.static(path.join(__dirname, "..", "public")));

function safeUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    wallet_cents: u.wallet_cents,
    referral_code: u.referral_code,
    blocked: u.blocked
  };
}

function auth(req, res, next) {
  if (!req.session.user)
    return res.status(401).json({ error: "Please login." });
  next();
}

function admin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin")
    return res.status(403).json({ error: "Admin access required." });
  next();
}

function validAmount(value) {
  const amount = Number(value);
  return Number.isInteger(amount) && amount >= 100 && amount <= 10000000;
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      wallet_cents INTEGER NOT NULL DEFAULT 0,
      blocked BOOLEAN NOT NULL DEFAULT FALSE,
      referral_code TEXT UNIQUE,
      referred_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT DEFAULT '',
      price_cents INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      service_id INTEGER REFERENCES services(id),
      details TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      amount_cents INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      amount_cents INTEGER NOT NULL,
      kind TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      reference TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      amount_cents INTEGER NOT NULL,
      reference TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY,
      referrer_id INTEGER REFERENCES users(id),
      referred_id INTEGER UNIQUE REFERENCES users(id),
      reward_cents INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      discount_percent INTEGER NOT NULL,
      active BOOLEAN DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS support_messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      message TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES users(id);
  `);

  const missingCodes = await pool.query(
    "SELECT id FROM users WHERE referral_code IS NULL"
  );

  for (const u of missingCodes.rows) {
    const code = "SOH" + crypto.randomBytes(4).toString("hex").toUpperCase();
    await pool.query(
      "UPDATE users SET referral_code=$1 WHERE id=$2",
      [code, u.id]
    );
  }

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (email && password) {
    const found = await pool.query(
      "SELECT id FROM users WHERE email=$1",
      [email.toLowerCase()]
    );

    if (!found.rowCount) {
      const hash = await bcrypt.hash(password, 12);
      const code = "SOH" + crypto.randomBytes(4).toString("hex").toUpperCase();

      await pool.query(
        `INSERT INTO users(name,email,password_hash,role,referral_code)
         VALUES($1,$2,$3,'admin',$4)`,
        ["Sohel Admin", email.toLowerCase(), hash, code]
      );
    }
  }

  const services = await pool.query("SELECT id FROM services LIMIT 1");

  if (!services.rowCount) {
    await pool.query(`
      INSERT INTO services(name,category,description,price_cents)
      VALUES
      ('Profile Audit','Social Media','Review and improvement suggestions for your profile',49900),
      ('Content Strategy','Planning','A content plan for your social media account',79900),
      ('Creative Brief','Design','A brief for original social media creatives',29900)
    `);
  }
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, app: "SOHEL GROWTH PANEL" });
});

app.get("/api/me", async (req, res) => {
  if (!req.session.user) return res.json({ user: null });

  const result = await pool.query(
    "SELECT * FROM users WHERE id=$1",
    [req.session.user.id]
  );

  if (!result.rowCount) {
    req.session.destroy(() => {});
    return res.json({ user: null });
  }

  res.json({ user: safeUser(result.rows[0]) });
});

app.post("/api/register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const referral = String(req.body.referral || "").trim().toUpperCase();

    if (name.length < 2 || name.length > 60)
      return res.status(400).json({ error: "Enter a valid name." });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Enter a valid email." });

    if (password.length < 10)
      return res.status(400).json({ error: "Password must be at least 10 characters." });

    let referrerId = null;

    if (referral) {
      const ref = await pool.query(
        "SELECT id FROM users WHERE referral_code=$1",
        [referral]
      );
      if (ref.rowCount) referrerId = ref.rows[0].id;
    }

    const hash = await bcrypt.hash(password, 12);
    const code = "SOH" + crypto.randomBytes(4).toString("hex").toUpperCase();

    const result = await pool.query(
      `INSERT INTO users(name,email,password_hash,referral_code,referred_by)
       VALUES($1,$2,$3,$4,$5)
       RETURNING *`,
      [name, email, hash, code, referrerId]
    );

    const user = result.rows[0];

    if (referrerId) {
      await pool.query(
        "INSERT INTO referrals(referrer_id,referred_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [referrerId, user.id]
      );
    }

    req.session.user = { id: user.id, role: user.role };
    res.json({ user: safeUser(user) });
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "Email already registered." });

    console.error(err);
    res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const result = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    if (!result.rowCount)
      return res.status(401).json({ error: "Invalid email or password." });

    const user = result.rows[0];

    if (user.blocked)
      return res.status(403).json({ error: "This account is blocked. Contact support." });

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match)
      return res.status(401).json({ error: "Invalid email or password." });

    req.session.user = { id: user.id, role: user.role };
    res.json({ user: safeUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

app.get("/api/services", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM services WHERE active=TRUE ORDER BY id DESC"
  );
  res.json({ services: result.rows });
});

app.post("/api/orders", auth, async (req, res) => {
  const client = await pool.connect();

  try {
    const serviceId = Number(req.body.service_id);
    const details = String(req.body.details || "").trim();

    if (!Number.isInteger(serviceId) || !details || details.length > 1000)
      return res.status(400).json({ error: "Enter valid order details." });

    await client.query("BEGIN");

    const service = await client.query(
      "SELECT * FROM services WHERE id=$1 AND active=TRUE",
      [serviceId]
    );

    if (!service.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Service not found." });
    }

    const amount = service.rows[0].price_cents;

    const user = await client.query(
      "SELECT * FROM users WHERE id=$1 FOR UPDATE",
      [req.session.user.id]
    );

    if (!user.rowCount || user.rows[0].blocked) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Account unavailable." });
    }

    if (user.rows[0].wallet_cents < amount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient wallet balance." });
    }

    await client.query(
      "UPDATE users SET wallet_cents=wallet_cents-$1 WHERE id=$2",
      [amount, user.rows[0].id]
    );

    const order = await client.query(
      `INSERT INTO orders(user_id,service_id,details,amount_cents)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [user.rows[0].id, serviceId, details, amount]
    );

    await client.query(
      `INSERT INTO transactions(user_id,amount_cents,kind,status,reference)
       VALUES($1,$2,'order','completed',$3)`,
      [user.rows[0].id, -amount, "Order #" + order.rows[0].id]
    );

    await client.query("COMMIT");
    res.json({ order: order.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Order could not be created." });
  } finally {
    client.release();
  }
});

app.get("/api/orders", auth, async (req, res) => {
  const result = await pool.query(
    `SELECT o.*,s.name AS service_name
     FROM orders o LEFT JOIN services s ON s.id=o.service_id
     WHERE o.user_id=$1 ORDER BY o.id DESC`,
    [req.session.user.id]
  );
  res.json({ orders: result.rows });
});

app.get("/api/transactions", auth, async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM transactions WHERE user_id=$1 ORDER BY id DESC",
    [req.session.user.id]
  );
  res.json({ transactions: result.rows });
});

app.post("/api/payments/request", auth, async (req, res) => {
  const amount = Number(req.body.amount);
  const reference = String(req.body.reference || "").trim();

  if (!validAmount(amount))
    return res.status(400).json({ error: "Amount must be between ₹100 and ₹100000." });

  if (reference.length < 6 || reference.length > 100)
    return res.status(400).json({ error: "Enter a valid payment reference." });

  const duplicate = await pool.query(
    "SELECT id FROM payments WHERE reference=$1",
    [reference]
  );

  if (duplicate.rowCount)
    return res.status(409).json({ error: "This reference has already been submitted." });

  const result = await pool.query(
    `INSERT INTO payments(user_id,amount_cents,reference)
     VALUES($1,$2,$3) RETURNING id,status`,
    [req.session.user.id, Math.round(amount * 100), reference]
  );

  res.json({ payment: result.rows[0], message: "Request submitted for admin verification." });
});

app.get("/api/payments", auth, async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM payments WHERE user_id=$1 ORDER BY id DESC",
    [req.session.user.id]
  );
  res.json({ payments: result.rows });
});

app.get("/api/referrals", auth, async (req, res) => {
  const result = await pool.query(
    `SELECT r.id,r.reward_cents,r.created_at,u.name AS referred_name
     FROM referrals r JOIN users u ON u.id=r.referred_id
     WHERE r.referrer_id=$1 ORDER BY r.id DESC`,
    [req.session.user.id]
  );

  res.json({ referrals: result.rows });
});

app.post("/api/support", auth, async (req, res) => {
  const message = String(req.body.message || "").trim();

  if (message.length < 5 || message.length > 2000)
    return res.status(400).json({ error: "Message must be 5–2000 characters." });

  await pool.query(
    "INSERT INTO support_messages(user_id,message) VALUES($1,$2)",
    [req.session.user.id, message]
  );

  res.json({ ok: true, message: "Support message sent." });
});

// ADMIN ROUTES

app.get("/api/admin/summary", auth, admin, async (req, res) => {
  const [users, orders, payments, revenue] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS count FROM users"),
    pool.query("SELECT COUNT(*)::int AS count FROM orders"),
    pool.query("SELECT COUNT(*)::int AS count FROM payments WHERE status='pending'"),
    pool.query("SELECT COALESCE(SUM(amount_cents),0)::int AS total FROM transactions WHERE kind='order'")
  ]);

  res.json({
    users: users.rows[0].count,
    orders: orders.rows[0].count,
    pending_payments: payments.rows[0].count,
    order_total_cents: revenue.rows[0].total
  });
});

app.get("/api/admin/users", auth, admin, async (req, res) => {
  const result = await pool.query(
    `SELECT id,name,email,role,wallet_cents,blocked,referral_code,created_at
     FROM users ORDER BY id DESC`
  );
  res.json({ users: result.rows });
});

app.patch("/api/admin/users/:id/block", auth, admin, async (req, res) => {
  const id = Number(req.params.id);
  const blocked = Boolean(req.body.blocked);

  if (!Number.isInteger(id) || id === req.session.user.id)
    return res.status(400).json({ error: "Invalid user." });

  const result = await pool.query(
    "UPDATE users SET blocked=$1 WHERE id=$2 AND role<>'admin' RETURNING id,blocked",
    [blocked, id]
  );

  if (!result.rowCount)
    return res.status(404).json({ error: "User not found." });

  res.json({ user: result.rows[0] });
});

app.post("/api/admin/services", auth, admin, async (req, res) => {
  const name = String(req.body.name || "").trim();
  const category = String(req.body.category || "").trim();
  const description = String(req.body.description || "").trim();
  const price = Number(req.body.price);

  if (!name || !category || !Number.isFinite(price) || price < 0 || price > 100000)
    return res.status(400).json({ error: "Enter valid service details." });

  const result = await pool.query(
    `INSERT INTO services(name,category,description,price_cents)
     VALUES($1,$2,$3,$4) RETURNING *`,
    [name, category, description, Math.round(price * 100)]
  );

  res.json({ service: result.rows[0] });
});

app.patch("/api/admin/services/:id", auth, admin, async (req, res) => {
  const id = Number(req.params.id);
  const active = Boolean(req.body.active);

  const result = await pool.query(
    "UPDATE services SET active=$1 WHERE id=$2 RETURNING *",
    [active, id]
  );

  if (!result.rowCount)
    return res.status(404).json({ error: "Service not found." });

  res.json({ service: result.rows[0] });
});

app.get("/api/admin/orders", auth, admin, async (req, res) => {
  const result = await pool.query(
    `SELECT o.*,u.name AS user_name,u.email,s.name AS service_name
     FROM orders o
     JOIN users u ON u.id=o.user_id
     LEFT JOIN services s ON s.id=o.service_id
     ORDER BY o.id DESC`
  );
  res.json({ orders: result.rows });
});

app.patch("/api/admin/orders/:id", auth, admin, async (req, res) => {
  const status = String(req.body.status || "");
  const allowed = ["pending", "processing", "completed", "cancelled"];

  if (!allowed.includes(status))
    return res.status(400).json({ error: "Invalid status." });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const order = await client.query(
      "SELECT * FROM orders WHERE id=$1 FOR UPDATE",
      [Number(req.params.id)]
    );

    if (!order.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Order not found." });
    }

    const oldStatus = order.rows[0].status;

    if (oldStatus === "cancelled" && status !== "cancelled") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Cancelled orders cannot be reopened." });
    }

    if (status === "cancelled" && oldStatus !== "cancelled") {
      await client.query(
        "UPDATE users SET wallet_cents=wallet_cents+$1 WHERE id=$2",
        [order.rows[0].amount_cents, order.rows[0].user_id]
      );

      await client.query(
        `INSERT INTO transactions(user_id,amount_cents,kind,status,reference)
         VALUES($1,$2,'refund','completed',$3)`,
        [order.rows[0].user_id, order.rows[0].amount_cents, "Order #" + order.rows[0].id]
      );
    }

    await client.query(
      "UPDATE orders SET status=$1 WHERE id=$2",
      [status, order.rows[0].id]
    );

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Could not update order." });
  } finally {
    client.release();
  }
});

app.post("/api/admin/wallet-adjust", auth, admin, async (req, res) => {
  const userId = Number(req.body.user_id);
  const amount = Number(req.body.amount);
  const note = String(req.body.note || "Admin adjustment").slice(0, 150);

  if (!Number.isInteger(userId) || !Number.isFinite(amount) ||
      amount === 0 || Math.abs(amount) > 100000)
    return res.status(400).json({ error: "Invalid adjustment." });

  const cents = Math.round(amount * 100);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const user = await client.query(
      "SELECT wallet_cents FROM users WHERE id=$1 FOR UPDATE",
      [userId]
    );

    if (!user.rowCount || user.rows[0].wallet_cents + cents < 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "User not found or insufficient balance." });
    }

    await client.query(
      "UPDATE users SET wallet_cents=wallet_cents+$1 WHERE id=$2",
      [cents, userId]
    );

    await client.query(
      `INSERT INTO transactions(user_id,amount_cents,kind,status,reference)
       VALUES($1,$2,'admin_adjustment','completed',$3)`,
      [userId, cents, note]
    );

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Wallet adjustment failed." });
  } finally {
    client.release();
  }
});

app.get("/api/admin/payments", auth, admin, async (req, res) => {
  const result = await pool.query(
    `SELECT p.*,u.name AS user_name,u.email
     FROM payments p JOIN users u ON u.id=p.user_id
     ORDER BY p.id DESC`
  );
  res.json({ payments: result.rows });
});

app.patch("/api/admin/payment
