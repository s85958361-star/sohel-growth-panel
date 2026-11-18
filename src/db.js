
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL सेट नहीं है।');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false'
    ? false
    : { rejectUnauthorized: false }
});

async function query(text, params) {
  return pool.query(text, params);
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) DEFAULT 'user',
      balance NUMERIC(12,2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS services (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT DEFAULT '',
      price NUMERIC(12,2) DEFAULT 0,
      price_per_1000 NUMERIC(12,2) DEFAULT 0,
      external_service_id TEXT,
      provider VARCHAR(30) DEFAULT 'manual',
      min_quantity INTEGER DEFAULT 1,
      max_quantity INTEGER DEFAULT 1000000,
      quick_quantities JSONB DEFAULT '[100,500,1000,5000,10000]',
      delivery_time TEXT DEFAULT 'Provider estimate',
      status VARCHAR(20) DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id),
      service_id BIGINT REFERENCES services(id),
      details TEXT,
      link TEXT,
      quantity INTEGER DEFAULT 0,
      amount NUMERIC(12,2) DEFAULT 0,
      status VARCHAR(30) DEFAULT 'pending',
      fulfilment_mode VARCHAR(30) DEFAULT 'manual',
      external_order_id TEXT,
      provider_status TEXT,
      remains INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wallet_requests (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id),
      amount NUMERIC(12,2) NOT NULL,
      reference TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id),
      type VARCHAR(30) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      reference TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT
    );
  `);

  console.log('Database tables initialized');
}

module.exports = {
  pool,
  query,
  initDb
};
