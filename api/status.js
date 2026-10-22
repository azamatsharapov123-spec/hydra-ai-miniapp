import { getModel, extractUrl } from '../lib/models.js';
import { readToken } from '../lib/jobtoken.js';

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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) return res.status(500).json({ error: 'FAL_KEY не настроен' });

  const job = readToken(req.query?.t);
  if (!job || !okUrl(job.s) || !okUrl(job.r)) {
    return res.status(400).json({ status: 'FAILED', error: 'Неверная или просроченная задача' });
  }
  const model = getModel(job.m);
  if (!model) return res.status(400).json({ status: 'FAILED', error: 'Модель недоступна' });

  const headers = { 'Authorization': `Key ${FAL_KEY}` };

  try {
    const sr = await fetch(job.s, { headers });
    const st = await sr.json().catch(() => ({}));
    if (!sr.ok) {
      return res.status(200).json({ status: 'FAILED', error: errText(st, `Ошибка статуса (${sr.status})`) });
    }

    if (st.status !== 'COMPLETED') {
      return res.status(200).json({
        status: st.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'IN_QUEUE',
        position: typeof st.queue_position === 'number' ? st.queue_position : null
      });
    }

    const rr = await fetch(job.r, { headers });
    const data = await rr.json().catch(() => ({}));
    if (!rr.ok) {
      return res.status(200).json({ status: 'FAILED', error: errText(data, `Ошибка генерации (${rr.status})`) });
    }

    const url = extractUrl(model, data);
    if (!url) {
      return res.status(200).json({ status: 'FAILED', error: 'Модель не вернула результат' });
    }
    return res.status(200).json({ status: 'COMPLETED', url });
  } catch (e) {
    // сеть моргнула — приложение просто спросит ещё раз
    return res.status(200).json({ status: 'IN_PROGRESS', position: null });
  }
}
