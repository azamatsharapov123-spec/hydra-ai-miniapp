import { query } from './db.js';

// Суточный счётчик сообщений. День меняется в полночь по Душанбе.
const TODAY = `(now() AT TIME ZONE 'Asia/Dushanbe')::date`;

// Занимает одно сообщение из лимита. Атомарно: два запроса одновременно не обойдут лимит.
export async function takeQuota(userId, kind, limit) {
  const r = await query(
    `INSERT INTO daily_usage (user_id, kind, day, n) VALUES ($1,$2,${TODAY},1)
     ON CONFLICT (user_id, kind, day) DO UPDATE SET n = daily_usage.n + 1 WHERE daily_usage.n < $3
     RETURNING n`,
    [userId, kind, limit]
  );
  return r.rows[0] ? { ok: true, left: limit - r.rows[0].n } : { ok: false, left: 0 };
}

// Возвращает сообщение, если ответить не удалось по нашей вине
export async function giveBack(userId, kind) {
  await query(`UPDATE daily_usage SET n = GREATEST(n - 1, 0) WHERE user_id=$1 AND kind=$2 AND day=${TODAY}`, [userId, kind]).catch(() => {});
}

export async function quotaLeft(userId, kind, limit) {
  const r = await query(`SELECT n FROM daily_usage WHERE user_id=$1 AND kind=$2 AND day=${TODAY}`, [userId, kind]);
  return Math.max(0, limit - (r.rows[0] ? r.rows[0].n : 0));
}
