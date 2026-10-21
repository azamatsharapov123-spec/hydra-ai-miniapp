import { getTelegramUser } from './_lib/telegram.js';
import { isBalanceStoreConfigured, spendBalance, refundBalance } from './_lib/balance.js';
import { MODELS, calculateCost, clampDuration } from './_lib/models.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    prompt,
    model,
    category,
    image_url,
    aspect_ratio,
    duration,
    quality,
    resolution,
    format,
    websearch,
    audio_mode,
    voice
  } = req.body;

  const FAL_KEY = process.env.FAL_KEY;

  if (!FAL_KEY) {
    return res.status(500).json({ error: 'FAL_KEY не настроен в переменном окружении Vercel' });
  }

  if (!isBalanceStoreConfigured()) {
    return res.status(500).json({ error: 'База данных баланса не настроена в переменных окружения Vercel' });
  }

  // Пользователь определяется только по подписанному Telegram initData
  const user = getTelegramUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Откройте приложение через Telegram' });
  }

  // Чат бесплатный: баланс не проверяем и ничего не списываем
  if (category === 'chat') {
    try {
      const response = await fetch('https://fal.run/fal-ai/any-llm', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${FAL_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-1.5-flash',
          prompt: prompt || 'Привет!'
        })
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

  const modelInfo = MODELS[model];
  if (!modelInfo) {
    return res.status(400).json({ error: 'Неизвестная модель' });
  }

  // Цену считает сервер — значение от клиента не используется
  const generationCost = calculateCost(modelInfo, { duration, quality, resolution });

  let spend;
  try {
    spend = await spendBalance(user.id, generationCost);
  } catch (e) {
    return res.status(500).json({ error: 'Не удалось проверить баланс' });
  }

  if (!spend.ok) {
    return res.status(402).json({
      error: `Недостаточно токенов: требуется ${generationCost} ⚡, на балансе ${spend.balance} ⚡`,
      balance: spend.balance
    });
  }

  const payload = { prompt };
  if (aspect_ratio) payload.image_size = aspect_ratio === '16:9' ? 'landscape_16_9' : (aspect_ratio === '9:16' ? 'portrait_16_9' : 'square');
  if (image_url) payload.image_url = image_url;
  if (modelInfo.category === 'video') payload.duration = String(clampDuration(modelInfo, duration));
  if (quality) payload.quality = quality;
  if (format) payload.output_format = format;
  if (typeof websearch === 'boolean') payload.web_search = websearch;
  if (audio_mode) payload.audio_mode = audio_mode;
  if (voice) payload.voice = voice;

  // При любой ошибке генерации возвращаем списанные токены
  const failWithRefund = async (status, error) => {
    let balance;
    try {
      balance = await refundBalance(user.id, generationCost);
    } catch (e) {
      balance = undefined;
    }
    return res.status(status).json({ error, balance });
  };

  try {
    const response = await fetch(modelInfo.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      const errorDetail = data.detail ? JSON.stringify(data.detail) : (data.message || 'Ошибка API Fal.ai');
      return failWithRefund(500, errorDetail);
    }

    // Всевозможные варианты путей к медиафайлу в ответах разных моделей Fal.ai
    const mediaUrl =
      data.images?.[0]?.url ||
      data.image?.url ||
      data.video?.url ||
      data.audio_url?.url ||
      data.audio?.url ||
      data.url ||
      (typeof data.output === 'string' && data.output.startsWith('http') ? data.output : null);

    if (!mediaUrl) {
      return failWithRefund(500, 'Модель не вернула результат');
    }

    return res.status(200).json({
      success: true,
      new_balance: spend.balance,
      cost: generationCost,
      result: { url: mediaUrl }
    });
  } catch (error) {
    return failWithRefund(500, error.message || 'Внутренняя ошибка сервера');
  }
}
