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
    format,
    websearch,
    audio_mode,
    voice,
    cost,
    user_coins_client
  } = req.body;

  const FAL_KEY = process.env.FAL_KEY;

  if (!FAL_KEY) {
    return res.status(500).json({ error: 'FAL_KEY не настроен в переменном окружении Vercel' });
  }

  const generationCost = parseInt(cost, 10) || 5;
  let currentBalance = parseInt(user_coins_client, 10);

  if (isNaN(currentBalance) || currentBalance < generationCost) {
    return res.status(400).json({ error: 'Недостаточно токенов на балансе для генерации' });
  }

  currentBalance -= generationCost;

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
      const text = data.output || data.choices?.[0]?.message?.content || 'Здравствуйте! Чем я могу помочь?';
      return res.status(200).json({ success: true, new_balance: currentBalance, result: { text } });
    } catch (e) {
      return res.status(500).json({ error: 'Ошибка обработки чата' });
    }
  }

  const endpoints = {
    'nanobanana-pro': 'https://fal.run/fal-ai/flux/schnell',
    'nanobanana-2.1': 'https://fal.run/fal-ai/flux/dev',
    'nanobanana-1': 'https://fal.run/fal-ai/flux/schnell',
    'nanobanana-2k': 'https://fal.run/fal-ai/flux/schnell',
    'nanobanana-2f': 'https://fal.run/fal-ai/flux/dev',
    'qwen-edit': 'https://fal.run/fal-ai/flux/schnell',
    'grok-imagine': 'https://fal.run/fal-ai/flux/schnell',
    'seedream-5pro': 'https://fal.run/fal-ai/flux/dev',
    'seedream-1': 'https://fal.run/fal-ai/flux/schnell',
    'seedream-4.5': 'https://fal.run/fal-ai/flux/dev',
    'seedream-5lite': 'https://fal.run/fal-ai/flux/schnell',
    'grok-imagine-2': 'https://fal.run/fal-ai/flux/dev',
    'gpt-image-2.5': 'https://fal.run/fal-ai/flux/dev',
    'gpt-image-1.5': 'https://fal.run/fal-ai/flux/schnell',
    'gpt-image-2': 'https://fal.run/fal-ai/flux/dev',

    'seedance-2.5': 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video',
    'gemini-omni': 'https://fal.run/fal-ai/kling-video/v1/text-to-video',
    'gemini-omni-1.1': 'https://fal.run/fal-ai/kling-video/v1/text-to-video',
    'veo-3.1': 'https://fal.run/fal-ai/minimax/video-01/text-to-video',
    'veo-3-fast': 'https://fal.run/fal-ai/minimax/video-01/text-to-video',
    'grok-video-1.5': 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video',
    'kling-3.0': 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video',
    'kling-3.0-mc': 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video',
    'kling-3.0-turbo': 'https://fal.run/fal-ai/kling-video/v1.5/standard/text-to-video',
    'kling-o3': 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video',
    'kling-o1': 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video',
    'kling-v1-avatar': 'https://fal.run/fal-ai/kling-video/v1/text-to-video',
    'kling-2.6-mc-k': 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video',
    'kling-2.6-mc-f': 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video',
    'kling-2.6': 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video',
    'kling-turbo-2.5': 'https://fal.run/fal-ai/kling-video/v1.5/standard/text-to-video',
    'kling-2.1': 'https://fal.run/fal-ai/kling-video/v1/text-to-video',
    'wan-3.0': 'https://fal.run/fal-ai/minimax/video-01/text-to-video',
    'wan-2.6': 'https://fal.run/fal-ai/minimax/video-01/text-to-video',
    'wan-2.5': 'https://fal.run/fal-ai/minimax/video-01/text-to-video',
    'seedance-2': 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video',
    'seedance-2.0-mini': 'https://fal.run/fal-ai/kling-video/v1.5/standard/text-to-video',
    'sora-2': 'https://fal.run/fal-ai/luma-dream-machine/text-to-video',
    'sora-2-pro-f': 'https://fal.run/fal-ai/luma-dream-machine/text-to-video',
    'runway': 'https://fal.run/fal-ai/runway-gen3/alpha/text-to-video',
    'topaz': 'https://fal.run/fal-ai/topaz-video-upscale',
    'hailuo-02': 'https://fal.run/fal-ai/minimax/video-01/text-to-video',

    'suno-v5': 'https://fal.run/fal-ai/suno-music',
    'suno-5.5': 'https://fal.run/fal-ai/suno-music',
    'elevenlabs-v3': 'https://fal.run/fal-ai/elevenlabs/tts',
    'elevenlabs-multi': 'https://fal.run/fal-ai/elevenlabs/tts',
    'elevenlabs-turbo': 'https://fal.run/fal-ai/elevenlabs/tts',
    'elevenlabs-dialog': 'https://fal.run/fal-ai/elevenlabs/tts',
    'elevenlabs-speech': 'https://fal.run/fal-ai/elevenlabs/tts',

    'multi-talk': 'https://fal.run/fal-ai/live-portrait',
    'live-portrait': 'https://fal.run/fal-ai/live-portrait'
  };

  const targetEndpoint = endpoints[model] || 'https://fal.run/fal-ai/flux/schnell';

  // Формируем чистый Payload под требования API
  const payload = { prompt };
  if (aspect_ratio) payload.image_size = aspect_ratio === '16:9' ? 'landscape_16_9' : (aspect_ratio === '9:16' ? 'portrait_16_9' : 'square');
  if (image_url) payload.image_url = image_url;
  if (duration) payload.duration = String(duration);
  if (quality) payload.quality = quality;
  if (format) payload.output_format = format;
  if (typeof websearch === 'boolean') payload.web_search = websearch;
  if (audio_mode) payload.audio_mode = audio_mode;
  if (voice) payload.voice = voice;

  try {
    const response = await fetch(targetEndpoint, {
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
      return res.status(500).json({ error: errorDetail });
    }

    const mediaUrl =
      data.images?.[0]?.url ||
      data.video?.url ||
      data.audio_url?.url ||
      data.audio?.url ||
      data.url;

    return res.status(200).json({
      success: true,
      new_balance: currentBalance,
      result: { url: mediaUrl }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Внутренняя ошибка сервера' });
  }
}
