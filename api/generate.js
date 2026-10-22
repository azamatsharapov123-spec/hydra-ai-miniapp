import { getModel, validateInput, calcCost, buildRequest } from '../lib/models.js';
import { makeToken } from '../lib/jobtoken.js';
import { query } from '../lib/db.js';
import { authUser, sendError } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const { prompt, category, model: modelId, values } = body;

  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) {
    return res.status(500).json({ error: 'FAL_KEY не настроен в переменном окружении Vercel' });
  }

  // Только для пользователей Telegram (подпись initData проверяется на сервере)
  let user;
  try {
    ({ user } = await authUser(req));
  } catch (e) {
    return sendError(res, e);
  }

  // Чат бесплатный: обрабатываем до проверки баланса и ничего не списываем
  if (category === 'chat') {
    try {
      const response = await fetch('https://fal.run/fal-ai/any-llm', {
        method: 'POST',
        headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'google/gemini-1.5-flash', prompt: prompt || 'Привет!' })
      });
      const data = await response.json();
      if (!response.ok) {
        const errorDetail = data.detail ? JSON.stringify(data.detail) : (data.message || 'Ошибка API Fal.ai');
        return res.status(500).json({ error: errorDetail });
      }
      const text = data.output || data.choices?.[0]?.message?.content || 'Здравствуйте! Чем я могу помочь?';
      return res.status(200).json({ success: true, result: { text } });
    } catch (e) {
      return res.status(500).json({ error: 'Ошибка обработки чата' });
    }
  }

  // 1. Модель должна быть в каталоге. Подмены на другую модель больше нет.
  const model = getModel(modelId);
  if (!model) {
    return res.status(400).json({ error: 'Эта модель недоступна' });
  }

  // 2. Проверяем значения формы и считаем цену НА СЕРВЕРЕ (цену из браузера не используем)
  let v, cost;
  try {
    v = validateInput(model, { ...(values || {}), audio_seconds: body.audio_seconds });
    cost = calcCost(model.price, v);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Неверные параметры' });
  }
  if (!Number.isFinite(cost) || cost < 1) {
    return res.status(400).json({ error: 'Не удалось рассчитать стоимость' });
  }

  // 3. Списываем ⚡ одной атомарной операцией (двойная трата невозможна)
  const paid = await query('UPDATE users SET coins = coins - $1 WHERE id = $2 AND coins >= $1 RETURNING coins', [cost, user.id]);
  if (!paid.rows[0]) {
    return res.status(400).json({ error: `Недостаточно токенов: нужно ${cost} ⚡` });
  }
  const refund = () => query('UPDATE users SET coins = coins + $1 WHERE id = $2', [cost, user.id]).catch(() => {});

  // 4. Отправляем задачу в очередь fal.ai (видео делается минуты, ждать ответа в одном запросе нельзя)
  const { endpoint, payload } = buildRequest(model, v);
  try {
    const response = await fetch(`https://queue.fal.run/${endpoint}`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.request_id || !data.status_url || !data.response_url) {
      await refund();
      const detail = data.detail
        ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail))
        : (data.message || `Ошибка fal.ai (${response.status})`);
      return res.status(502).json({ error: detail });
    }

    try {
      await query('INSERT INTO jobs (id, user_id, model, cost) VALUES ($1,$2,$3,$4)', [data.request_id, user.id, model.id, cost]);
    } catch (e) {
      await refund();
      return res.status(500).json({ error: 'Ошибка сервера, ⚡ возвращены' });
    }

    const job = makeToken({ m: model.id, s: data.status_url, r: data.response_url, i: data.request_id, u: String(user.id) });
    return res.status(200).json({
      success: true,
      job,
      cost,
      new_balance: paid.rows[0].coins
    });
  } catch (error) {
    await refund();
    return res.status(500).json({ error: error.message || 'Внутренняя ошибка сервера' });
  }
}
