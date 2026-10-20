export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, model, category, aspect_ratio, duration, resolution, image_url, audio_url } = req.body;

  if (!prompt && !image_url) {
    return res.status(400).json({ error: 'Промпт или входной медиафайл обязателен' });
  }

  // Динамическая карта эндпоинтов Fal.ai
  const endpoints = {
    // Изображения
    'flux-pro': 'https://fal.run/fal-ai/flux-pro/v1.1',
    'flux-schnell': 'https://fal.run/fal-ai/flux/schnell',
    'seedream-5': 'https://fal.run/fal-ai/seedream-5.0/pro',

    // Видео
    'kling-3.0': 'https://fal.run/fal-ai/kling-video/v3/pro/text-to-video',
    'wan-3.0': 'https://fal.run/fal-ai/wan/v3/text-to-video',

    // Аватары & Lipsync
    'kling-avatar': 'https://fal.run/fal-ai/kling-avatar/v1',
    'live-portrait': 'https://fal.run/fal-ai/live-portrait',

    // Аудио
    'elevenlabs': 'https://fal.run/fal-ai/elevenlabs/tts',
    'minimax-tts': 'https://fal.run/fal-ai/minimax/speech-02-hd',

    // 3D
    'trellis-2': 'https://fal.run/fal-ai/trellis-2'
  };

  const targetEndpoint = endpoints[model] || endpoints['flux-schnell'];

  // Формируем уникальный payload под конкретную модель
  let bodyData = { prompt };

  if (aspect_ratio) bodyData.aspect_ratio = aspect_ratio;
  if (duration) bodyData.duration = `${duration}`;
  if (resolution) bodyData.resolution = resolution === '4k' ? '2160p' : resolution;
  if (image_url) {
    bodyData.image_url = image_url;
    bodyData.source_image_url = image_url;
  }
  if (audio_url) bodyData.audio_url = audio_url;

  try {
    const response = await fetch(targetEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${process.env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyData)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || 'Ошибка при вызове Fal.ai API');
    }

    const resultUrl = data.images?.[0]?.url || data.video?.url || data.audio_url?.url || data.model_mesh?.url || data.url;

    return res.status(200).json({
      success: true,
      result: { url: resultUrl }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
