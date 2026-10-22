import pg from 'pg';

let pool = null;
let ready = null;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new HttpError(500, 'DATABASE_URL не настроен');
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 8000
    });
    pool.on('error', () => {});
  }
  return pool;
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          BIGINT PRIMARY KEY,
  first_name  TEXT,
  username    TEXT,
  ref_code    TEXT UNIQUE NOT NULL,
  referrer_id BIGINT REFERENCES users(id),
  coins       INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  ref_balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (ref_balance >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_referrer_idx ON users(referrer_id);

CREATE TABLE IF NOT EXISTS payments (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id),
  package_id   TEXT NOT NULL,
  tjs          NUMERIC(12,2) NOT NULL,
  coins        INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  provider     TEXT NOT NULL DEFAULT 'manual',
  provider_ref TEXT UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS referral_earnings (
  id             BIGSERIAL PRIMARY KEY,
  payment_id     BIGINT NOT NULL REFERENCES payments(id),
  beneficiary_id BIGINT NOT NULL REFERENCES users(id),
  from_user_id   BIGINT NOT NULL REFERENCES users(id),
  level          SMALLINT NOT NULL,
  amount_tjs     NUMERIC(12,2) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_id, level)
);
CREATE INDEX IF NOT EXISTS earnings_benef_idx ON referral_earnings(beneficiary_id);

CREATE TABLE IF NOT EXISTS jobs (
  id         TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id),
  model      TEXT,
  cost       INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_user_idx ON jobs(user_id, status);

CREATE TABLE IF NOT EXISTS withdrawals (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id),
  amount_tjs   NUMERIC(12,2) NOT NULL,
  details      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
`;

async function init() {
  if (!ready) {
    ready = (async () => {
      const c = await getPool().connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(727001)');
        await c.query(SCHEMA);
        await c.query('COMMIT');
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch (_) {}
        throw e;
      } finally {
        c.release();
      }
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}

export async function query(text, params) {
  await init();
  return getPool().query(text, params);
}

export async function tx(fn) {
  await init();
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    c.release();
  }
}
