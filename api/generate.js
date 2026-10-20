export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    prompt,
    model,
    category,
    image_url,
    start_image_url,
    end_image_url,
    aspect_ratio,
    duration,
    quality,
    enable_audio,
    voice
  } = req.body;

  const FAL_KEY = process.env.FAL_KEY;

  if (!FAL_KEY) {
    return res.status(500).json({ error: 'FAL_KEY не настроен в переменном окружении Vercel' });
  }

  // 1. Бесплатный AI Чат (Gemini Flash)
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
      return res.status(200).json({ success: true, result: { text } });
    } catch (e) {
      return res.status(500).json({ error: 'Ошибка обработки чата' });
    }
  }

  // 2. Полная карта эндпоинтов Fal.ai (Без VeoSeeBot Remake)
  const endpoints = {
    // Картинки
    'nanobanana-pro': 'https://fal.run/fal-ai/nano-banana-pro',
    'nanobanana-2.1': 'https://fal.run/fal-ai/nano-banana-2.1',
    'nanobanana-1': 'https://fal.run/fal-ai/nano-banana-1',
    'nanobanana-2k': 'https://fal.run/fal-ai/nano-banana-2k',
    'nanobanana-2f': 'https://fal.run/fal-ai/nano-banana-2f',
    'qwen-edit': 'https://fal.run/fal-ai/qwen-image-edit',
    'grok-imagine': 'https://fal.run/fal-ai/grok-imagine',
    'seedream-5pro': 'https://fal.run/fal-ai/seedream-5.0/pro',
    'seedream-1': 'https://fal.run/fal-ai/seedream-1',
    'seedream-4.5': 'https://fal.run/fal-ai/seedream-4.5',
    'seedream-5lite': 'https://fal.run/fal-ai/seedream-5-lite',
    'grok-imagine-2': 'https://fal.run/fal-ai/grok-imagine-2',
    'gpt-image-2.5': 'https://fal.run/fal-ai/gpt-image-2.5',
    'gpt-image-1.5': 'https://fal.run/fal-ai/gpt-image-1.5',
    'gpt-image-2': 'https://fal.run/fal-ai/gpt-image-2',

    // Видео
    'seedance-2.5': 'https://fal.run/fal-ai/bytedance/seedance-2.5/image-to-video',
    'gemini-omni': 'https://fal.run/fal-ai/gemini-omni',
    'gemini-omni-1.1': 'https://fal.run/fal-ai/gemini-omni-1.1',
    'veo-3.1': 'https://fal.run/fal-ai/veo-3.1',
    'veo-3-fast': 'https://fal.run/fal-ai/veo-3-fast',
    'grok-video-1.5': 'https://fal.run/fal-ai/grok-imagine-video/v1.5',
    'kling-3.0': 'https://fal.run/fal-ai/kling-video/v3/pro/text-to-video',
    'kling-3.0-mc': 'https://fal.run/fal-ai/kling-3.0-motion-control',
    'kling-3.0-turbo': 'https://fal.run/fal-ai/kling-3.0-turbo',
    'kling-o3': 'https://fal.run/fal-ai/kling-o3',
    'kling-o1': 'https://fal.run/fal-ai/kling-o1',
    'kling-v1-avatar': 'https://fal.run/fal-ai/kling-v1-avatar',
    'kling-2.6-mc-k': 'https://fal.run/fal-ai/kling-2.6-mc-k',
    'kling-2.6-mc-f': 'https://fal.run/fal-ai/kling-2.6-mc-f',
    'kling-2.6': 'https://fal.run/fal-ai/kling-2.6',
    'kling-turbo-2.5': 'https://fal.run/fal-ai/kling-turbo-2.5',
    'kling-2.1': 'https://fal.run/fal-ai/kling-2.1',
    'wan-3.0': 'https://fal.run/fal-ai/wan/v3/text-to-video',
    'wan-2.6': 'https://fal.run/fal-ai/wan-2.6',
    'wan-2.5': 'https://fal.run/fal-ai/wan-2.5',
    'seedance-2': 'https://fal.run/fal-ai/seedance-2',
    'seedance-2.0-mini': 'https://fal.run/fal-ai/seedance-2.0-mini',
    'sora-2': 'https://fal.run/fal-ai/sora-2',
    'sora-2-pro-f': 'https://fal.run/fal-ai/sora-2-pro-f',
    'runway': 'https://fal.run/fal-ai/runway',
    'topaz': 'https://fal.run/fal-ai/topaz',
    'hailuo-02': 'https://fal.run/fal-ai/hailuo-02',

    // Аудио
    'suno-v5': 'https://fal.run/fal-ai/suno/v5',
    'suno-5.5': 'https://fal.run/fal-ai/suno/v5.5',
    'elevenlabs-v3': 'https://fal.run/fal-ai/elevenlabs/tts/v3',
    'elevenlabs-multi': 'https://fal.run/fal-ai/elevenlabs/tts/multilingual-v2',
    'elevenlabs-turbo': 'https://fal.run/fal-ai/elevenlabs/tts/turbo-2.5',
    'elevenlabs-dialog': 'https://fal.run/fal-ai/elevenlabs/dialog',
    'elevenlabs-speech': 'https://fal.run/fal-ai/elevenlabs/asr',

    // Аватары
    'multi-talk': 'https://fal.run/fal-ai/ai-avatar/single-text',
    'live-portrait': 'https://fal.run/fal-ai/live-portrait'
  };

  const targetEndpoint = endpoints[model] || endpoints['nanobanana-pro'];

  // 3. Формирование тела запроса (Payload) для Fal.ai
  const payload = { prompt };

  if (aspect_ratio) payload.aspect_ratio = aspect_ratio;
  if (image_url) payload.image_url = image_url;
  if (start_image_url) payload.start_image_url = start_image_url;
  if (end_image_url) payload.end_image_url = end_image_url;
  if (duration) payload.duration = parseInt(duration, 10);
  if (quality) payload.quality = quality;
  if (typeof enable_audio === 'boolean') payload.enable_audio = enable_audio;
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
      throw new Error(data.detail || data.message || 'Ошибка API генерации Fal.ai');
    }

    const mediaUrl =
      data.images?.[0]?.url ||
      data.video?.url ||
      data.audio_url?.url ||
      data.audio?.url ||
      data.url;

    return res.status(200).json({
      success: true,
      result: { url: mediaUrl }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
