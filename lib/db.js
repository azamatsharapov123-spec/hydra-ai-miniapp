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
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ext JSONB;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS route SMALLINT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS input JSONB;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS result_url TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS partner_rate1 NUMERIC(5,4);
ALTER TABLE users ADD COLUMN IF NOT EXISTS partner_rate2 NUMERIC(5,4);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS user_paid_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS pay_amount NUMERIC(12,2);

ALTER TABLE users ADD COLUMN IF NOT EXISTS support_handoff_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS daily_usage (
  user_id BIGINT NOT NULL,
  kind    TEXT NOT NULL,
  day     DATE NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind, day)
);

CREATE TABLE IF NOT EXISTS support_messages (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_user_idx ON support_messages(user_id, id);

CREATE TABLE IF NOT EXISTS support_map (
  tg_msg_id  BIGINT PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Безлимит (пакеты «Ультра» и «Безлимит»): уровень и дата окончания
ALTER TABLE users ADD COLUMN IF NOT EXISTS unlim_tier SMALLINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS unlim_until TIMESTAMPTZ;
-- задача по безлимиту (какой дневной лимит вернуть при неудаче), настройки без файлов (для заявки в тренды),
-- сколько кредитов списал Kie (для учёта себестоимости)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS unl TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS params JSONB;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS provider_credits NUMERIC(12,2);
CREATE INDEX IF NOT EXISTS jobs_result_idx ON jobs(user_id, result_url);

-- Заявки пользователей в тренды и одобренные тренды от пользователей
CREATE TABLE IF NOT EXISTS trend_submissions (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id),
  job_id       TEXT,
  url          TEXT NOT NULL,
  kind         TEXT NOT NULL,
  model        TEXT,
  prompt       TEXT,
  params       JSONB,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS trend_sub_status_idx ON trend_submissions(status, id);
CREATE UNIQUE INDEX IF NOT EXISTS trend_sub_url_idx ON trend_submissions(user_id, url);

-- Конкурсы и розыгрыши призового фонда
CREATE TABLE IF NOT EXISTS contests (
  id         BIGSERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  prize_tjs  NUMERIC(12,2) NOT NULL,
  rules      TEXT NOT NULL,
  ends_at    TIMESTAMPTZ NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contest_entries (
  id         BIGSERIAL PRIMARY KEY,
  contest_id BIGINT NOT NULL REFERENCES contests(id),
  user_id    BIGINT NOT NULL REFERENCES users(id),
  link       TEXT NOT NULL,
  note       TEXT,
  place      SMALLINT,
  prize_tjs  NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contest_id, user_id)
);

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
