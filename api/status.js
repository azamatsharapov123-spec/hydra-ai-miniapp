import { getModel, extractUrl, buildRoutes } from '../lib/models.js';
import { readToken } from '../lib/jobtoken.js';
import { query } from '../lib/db.js';
import { authUser, sendError } from '../lib/auth.js';
import { submit, poll, keepFile, friendlyError, checkMoneyError } from '../lib/providers.js';

// Копирование готового видео в своё хранилище может занять несколько секунд
export const config = { maxDuration: 60 };

const ALLOWED_HOST = 'queue.fal.run';

function okUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname === ALLOWED_HOST;
  } catch (e) {
    return false;
  }
}

// Возврат ⚡ за неудавшуюся задачу. Срабатывает один раз, повтор ничего не меняет.
async function refundJob(jobId, userId) {
  const j = await query(
    `UPDATE jobs SET status='refunded', input=NULL WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING cost`,
    [jobId, userId]
  );
  if (j.rows[0]) {
    const u = await query('UPDATE users SET coins=coins+$1 WHERE id=$2 RETURNING coins', [j.rows[0].cost, userId]);
    return u.rows[0].coins;
  }
  const u = await query('SELECT coins FROM users WHERE id=$1', [userId]);
  return u.rows[0].coins;
}

const SHOWN = { queue: 'IN_QUEUE', progress: 'IN_PROGRESS' };

// Первый провайдер не справился: пробуем следующий из маршрута. true — задача ушла дальше.
async function tryNext(row, model, userId) {
  if (!row.input || row.route === null || row.route === undefined) return false;
  // «захватываем» переключение, чтобы два одновременных запроса не отправили задачу дважды
  const claim = await query(
    `UPDATE jobs SET provider='switching' WHERE id=$1 AND user_id=$2 AND status='pending' AND provider=$3 AND route=$4 RETURNING id`,
    [row.id, userId, row.provider, row.route]
  );
  if (!claim.rows[0]) return true;   // переключение уже делает другой запрос
  let routes = [];
  try { routes = buildRoutes(model, row.input); } catch (e) { routes = []; }
  for (let i = row.route + 1; i < routes.length; i++) {
    let sub;
    try { sub = await submit(routes[i]); } catch (e) { sub = { ok: false, error: e.message }; }
    if (sub.ok) {
      const more = i < routes.length - 1;
      await query(
        `UPDATE jobs SET provider=$2, ext=$3, route=$4, input=CASE WHEN $5 THEN input ELSE NULL END WHERE id=$1`,
        [row.id, routes[i].provider, JSON.stringify(sub.ref), i, more]
      );
      console.error('fallback', model.id, row.provider, '->', routes[i].provider);
      return true;
    }
    console.error('fallback submit failed', routes[i].provider, model.id, sub.error);
    await checkMoneyError(routes[i].provider, sub.error);
  }
  return false;
}

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
  if (!job || job.u !== String(user.id)) {
    return res.status(400).json({ status: 'FAILED', error: 'Неверная или просроченная задача' });
  }
  const model = getModel(job.m);
  if (!model) return res.status(400).json({ status: 'FAILED', error: 'Модель недоступна' });
  const extract = data => extractUrl(model, data);
  const giveup = req.query?.giveup === '1';

  try {
    // ----- задачи, запущенные до обновления (только fal) -----
    if (!job.j) {
      if (!okUrl(job.s) || !okUrl(job.r) || !job.i) return res.status(400).json({ status: 'FAILED', error: 'Неверная или просроченная задача' });
      const st = await poll('fal', { s: job.s, r: job.r }, extract);
      if (st.state === 'done') {
        await query(`UPDATE jobs SET status='done' WHERE id=$1 AND user_id=$2 AND status='pending'`, [job.i, user.id]);
        return res.status(200).json({ status: 'COMPLETED', url: st.url });
      }
      if (st.state === 'failed' || giveup) {
        const balance = await refundJob(job.i, user.id);
        return res.status(200).json({ status: 'FAILED', error: giveup ? 'Генерация заняла слишком много времени' : friendlyError(st.error), balance });
      }
      return res.status(200).json({ status: SHOWN[st.state], position: st.position ?? null });
    }

    // ----- задачи с маршрутом по провайдерам -----
    const r = await query('SELECT * FROM jobs WHERE id=$1 AND user_id=$2', [job.j, user.id]);
    const row = r.rows[0];
    if (row) {
      // JSONB обычно приходит объектом; на всякий случай разбираем строку
      for (const k of ['ext', 'input']) if (typeof row[k] === 'string') { try { row[k] = JSON.parse(row[k]); } catch (e) { row[k] = null; } }
    }
    if (!row) return res.status(400).json({ status: 'FAILED', error: 'Задача не найдена' });
    if (row.status === 'done' && row.result_url) return res.status(200).json({ status: 'COMPLETED', url: row.result_url });
    if (row.status !== 'pending') {
      const balance = await refundJob(row.id, user.id);
      return res.status(200).json({ status: 'FAILED', error: 'Генерация не удалась, ⚡ возвращены', balance });
    }
    if (row.provider === 'switching') return res.status(200).json({ status: 'IN_QUEUE', position: null });

    const st = await poll(row.provider, row.ext || {}, extract);

    if (st.state === 'done') {
      const url = await keepFile(st.url, row.provider, model.output, req.headers['x-vercel-oidc-token']);
      await query(`UPDATE jobs SET status='done', result_url=$3, input=NULL WHERE id=$1 AND user_id=$2 AND status='pending'`, [row.id, user.id, url]);
      return res.status(200).json({ status: 'COMPLETED', url });
    }

    if (st.state === 'failed') {
      console.error('job failed', row.provider, model.id, st.error);
      if (!giveup && await tryNext(row, model, user.id)) {
        return res.status(200).json({ status: 'IN_QUEUE', position: null });
      }
      const balance = await refundJob(row.id, user.id);
      return res.status(200).json({ status: 'FAILED', error: friendlyError(st.error), balance });
    }

    if (giveup) {
      const balance = await refundJob(row.id, user.id);
      return res.status(200).json({ status: 'FAILED', error: 'Генерация заняла слишком много времени', balance });
    }
    return res.status(200).json({ status: SHOWN[st.state] || 'IN_PROGRESS', position: st.position ?? null });
  } catch (e) {
    // сеть моргнула — приложение просто спросит ещё раз
    console.error('status error', e && e.message);
    return res.status(200).json({ status: 'IN_PROGRESS', position: null });
  }
}
