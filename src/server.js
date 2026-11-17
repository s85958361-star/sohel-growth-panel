require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const path = require("path");

const app = express();
app.set("trust proxy", 1);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
    ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-only-change-me",
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 86400000 }
}));
app.use(express.static(path.join(__dirname, "..", "public")));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer',
      wallet_cents INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      description TEXT DEFAULT '', price_cents INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
      service_id INTEGER REFERENCES services(id), details TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', amount_cents INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
      amount_cents INTEGER NOT NULL, kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', reference TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY, referrer_id INTEGER REFERENCES users(id),
      referred_id INTEGER UNIQUE REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    const found = await pool.query("SELECT id FROM users WHERE email=$1", [email.toLowerCase()]);
    if (!found.rowCount) {
      const hash = await bcrypt.hash(password, 12);
      await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin')",
        ["Sohel Admin", email.toLowerCase(), hash]);
      console.log("Initial admin created. Change its password after first login.");
    }
  }
  const count = await pool.query("SELECT COUNT(*)::int AS n FROM services");
  if (count.rows[0].n === 0) {
    await pool.query(
      "INSERT INTO services(name,category,description,price_cents) VALUES ($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12)",
      ["Content Strategy Session","Consulting","Plan a compliant content calendar.",1500,
       "Profile Audit","Consulting","Review profile clarity, bio and public branding.",1000,
       "Creative Brief","Content","Prepare a brief for original social content.",800]
    );
  }
}

function auth(req,res,next) {
  if (!req.session.user) return res.status(401).json({ error: "Please log in." });
  next();
}
function admin(req,res,next) {
  if (!req.session.user || req.session.user.role !== "admin") return res.status(403).json({ error: "Admin access required." });
  next();
}
const safeUser = u => ({ id:u.id, name:u.name, email:u.email, role:u.role, wallet_cents:u.wallet_cents });

app.get("/api/health", (req,res) => res.json({ ok:true, app:"Sohel Growth Panel" }));
app.get("/api/me", (req,res) => res.json({ user:req.session.user || null }));

app.post("/api/register", async (req,res) => {
  try {
    const { name,email,password } = req.body;
    if (!name || !email || !password || password.length < 10) return res.status(400).json({error:"Name, email and a password of at least 10 characters are required."});
    const hash = await bcrypt.hash(password,12);
    const result = await pool.query("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING *",
      [name.trim(),email.trim().toLowerCase(),hash]);
    req.session.user = safeUser(result.rows[0]);
    res.json({user:req.session.user});
  } catch(e) { res.status(400).json({error:e.code==="23505"?"Email already registered.":"Could not create account."}); }
});
app.post("/api/login", async (req,res) => {
  const {email,password} = req.body;
  const result = await pool.query("SELECT * FROM users WHERE email=$1",[String(email||"").toLowerCase()]);
  const u = result.rows[0];
  if (!u || !(await bcrypt.compare(password||"",u.password_hash))) return res.status(401).json({error:"Invalid email or password."});
  req.session.user = safeUser(u);
  res.json({user:req.session.user});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get("/api/services", async (req,res) => {
  const r = await pool.query("SELECT id,name,category,description,price_cents FROM services WHERE active=TRUE ORDER BY id DESC");
  res.json(r.rows);
});
app.post("/api/orders",auth,async(req,res)=>{
  const {service_id,details}=req.body;
  if(!details || String(details).trim().length<3) return res.status(400).json({error:"Please provide order details."});
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const s=await client.query("SELECT * FROM services WHERE id=$1 AND active=TRUE",[service_id]);
    if(!s.rowCount) throw new Error("Service not found.");
    const price=s.rows[0].price_cents;
    const u=await client.query("SELECT wallet_cents FROM users WHERE id=$1 FOR UPDATE",[req.session.user.id]);
    if(u.rows[0].wallet_cents<price) throw new Error("Insufficient wallet balance. Contact admin to arrange a verified payment.");
    await client.query("UPDATE users SET wallet_cents=wallet_cents-$1 WHERE id=$2",[price,req.session.user.id]);
    const o=await client.query("INSERT INTO orders(user_id,service_id,details,amount_cents) VALUES($1,$2,$3,$4) RETURNING *",
      [req.session.user.id,service_id,String(details).trim(),price]);
    await client.query("INSERT INTO transactions(user_id,amount_cents,kind,status,reference) VALUES($1,$2,'order_debit','completed',$3)",
      [req.session.user.id,-price,"Order #"+o.rows[0].id]);
    await client.query("COMMIT");
    res.json({order:o.rows[0]});
  } catch(e){ await client.query("ROLLBACK"); res.status(400).json({error:e.message}); }
  finally{client.release();}
});
app.get("/api/orders",auth,async(req,res)=>{
  const q=req.session.user.role==="admin"
    ? "SELECT o.*,u.email,s.name AS service_name FROM orders o JOIN users u ON u.id=o.user_id JOIN services s ON s.id=o.service_id ORDER BY o.id DESC"
    : "SELECT o.*,s.name AS service_name FROM orders o JOIN services s ON s.id=o.service_id WHERE o.user_id=$1 ORDER BY o.id DESC";
  const r=await pool.query(q,req.session.user.role==="admin"?[]:[req.session.user.id]); res.json(r.rows);
});
app.get("/api/transactions",auth,async(req,res)=>{
  const r=await pool.query("SELECT * FROM transactions WHERE user_id=$1 ORDER BY id DESC",[req.session.user.id]); res.json(r.rows);
});
app.get("/api/admin/users",admin,async(req,res)=>res.json((await pool.query("SELECT id,name,email,role,wallet_cents,created_at FROM users ORDER BY id DESC")).rows));
app.post("/api/admin/services",admin,async(req,res)=>{
  const {name,category,description,price_cents}=req.body;
  if(!name||!category||!Number.isInteger(Number(price_cents))||Number(price_cents)<0) return res.status(400).json({error:"Valid name, category and price are required."});
  const r=await pool.query("INSERT INTO services(name,category,description,price_cents) VALUES($1,$2,$3,$4) RETURNING *",
    [name,category,description||"",Number(price_cents)]);
  res.json(r.rows[0]);
});
app.patch("/api/admin/orders/:id",admin,async(req,res)=>{
  const allowed=["pending","processing","completed","cancelled"];
  if(!allowed.includes(req.body.status)) return res.status(400).json({error:"Invalid status."});
  const r=await pool.query("UPDATE orders SET status=$1 WHERE id=$2 RETURNING *",[req.body.status,req.params.id]);
  if(!r.rowCount) return res.status(404).json({error:"Order not found."});
  res.json(r.rows[0]);
});
app.post("/api/admin/wallet-adjust",admin,async(req,res)=>{
  const userId=Number(req.body.user_id), amount=Number(req.body.amount_cents);
  if(!Number.isInteger(userId)||!Number.isInteger(amount)||amount===0) return res.status(400).json({error:"Enter a user ID and non-zero integer amount in paise."});
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    const u=await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[userId]);
    if(!u.rowCount) throw new Error("User not found.");
    if(amount<0){const b=await c.query("SELECT wallet_cents FROM users WHERE id=$1",[userId]);if(b.rows[0].wallet_cents < -amount) throw new Error("Adjustment exceeds wallet balance.");}
    await c.query("UPDATE users SET wallet_cents=wallet_cents+$1 WHERE id=$2",[amount,userId]);
    await c.query("INSERT INTO transactions(user_id,amount_cents,kind,status,reference) VALUES($1,$2,'admin_adjustment','completed','Admin adjustment')",[userId,amount]);
    await c.query("COMMIT");res.json({ok:true});
  }catch(e){await c.query("ROLLBACK");res.status(400).json({error:e.message});}finally{c.release();}
});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"..","public","index.html")));

const port=process.env.PORT||10000;
initDb().then(()=>app.listen(port,()=>console.log(`Sohel Growth Panel running on ${port}`)))
  .catch(e=>{console.error("Startup failed:",e);process.exit(1);});
