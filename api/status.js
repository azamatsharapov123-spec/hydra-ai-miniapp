import { getModel, extractUrl } from '../lib/models.js';
import { readToken } from '../lib/jobtoken.js';
import { query } from '../lib/db.js';
import { authUser, sendError } from '../lib/auth.js';

const ALLOWED_HOST = 'queue.fal.run';

function okUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname === ALLOWED_HOST;
  } catch (e) {
    return false;
  }
}

function errText(data, fallback) {
  if (!data) return fallback;
  if (typeof data.detail === 'string') return data.detail;
  if (data.detail) return JSON.stringify(data.detail);
  return data.message || data.error || fallback;
}

// Возврат ⚡ за неудавшуюся задачу. Срабатывает один раз, повтор ничего не меняет.
async function refundJob(jobId, userId) {
  const j = await query(
    `UPDATE jobs SET status='refunded' WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING cost`,
    [jobId, userId]
  );
  if (j.rows[0]) {
    const u = await query('UPDATE users SET coins=coins+$1 WHERE id=$2 RETURNING coins', [j.rows[0].cost, userId]);
    return u.rows[0].coins;
  }
  const u = await query('SELECT coins FROM users WHERE id=$1', [userId]);
  return u.rows[0].coins;
}

const retryable = code => code === 429 || code === 502 || code === 503 || code === 504;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) return res.status(500).json({ error: 'FAL_KEY не настроен' });

  let user;
  try {
    ({ user } = await authUser(req));
  } catch (e) {
    return sendError(res, e);
  }

  const job = readToken(req.query?.t);
  if (!job || !okUrl(job.s) || !okUrl(job.r) || !job.i || job.u !== String(user.id)) {
    return res.status(400).json({ status: 'FAILED', error: 'Неверная или просроченная задача' });
  }
  const model = getModel(job.m);
  if (!model) return res.status(400).json({ status: 'FAILED', error: 'Модель недоступна' });

  const headers = { 'Authorization': `Key ${FAL_KEY}` };

  try {
    const sr = await fetch(job.s, { headers });
    const st = await sr.json().catch(() => ({}));
    if (!sr.ok) {
      if (retryable(sr.status)) return res.status(200).json({ status: 'IN_PROGRESS', position: null });
      const balance = await refundJob(job.i, user.id);
      return res.status(200).json({ status: 'FAILED', error: errText(st, `Ошибка статуса (${sr.status})`), balance });
    }

    if (st.status !== 'COMPLETED') {
      // приложение перестало ждать (слишком долго): возвращаем ⚡
      if (req.query?.giveup === '1') {
        const balance = await refundJob(job.i, user.id);
        return res.status(200).json({ status: 'FAILED', error: 'Генерация заняла слишком много времени', balance });
      }
      return res.status(200).json({
        status: st.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'IN_QUEUE',
        position: typeof st.queue_position === 'number' ? st.queue_position : null
      });
    }

    const rr = await fetch(job.r, { headers });
    const data = await rr.json().catch(() => ({}));
    if (!rr.ok) {
      if (retryable(rr.status)) return res.status(200).json({ status: 'IN_PROGRESS', position: null });
      const balance = await refundJob(job.i, user.id);
      return res.status(200).json({ status: 'FAILED', error: errText(data, `Ошибка генерации (${rr.status})`), balance });
    }

    const url = extractUrl(model, data);
    if (!url) {
      const balance = await refundJob(job.i, user.id);
      return res.status(200).json({ status: 'FAILED', error: 'Модель не вернула результат', balance });
    }
    await query(`UPDATE jobs SET status='done' WHERE id=$1 AND user_id=$2 AND status='pending'`, [job.i, user.id]);
    return res.status(200).json({ status: 'COMPLETED', url });
  } catch (e) {
    // сеть моргнула — приложение просто спросит ещё раз
    return res.status(200).json({ status: 'IN_PROGRESS', position: null });
  }
}
