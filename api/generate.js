export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, model, category, resolution, duration, sound } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Промпт не передан' });
  }

  const endpoints = {
    // Видео
    'kling-3.0-pro': 'https://fal.run/fal-ai/kling-video/v3/pro/text-to-video',
    'seedance-2.5': 'https://fal.run/fal-ai/bytedance/seedance-2.5/image-to-video',
    'wan-3.0': 'https://fal.run/fal-ai/wan/v3/text-to-video',

    // Картинки
    'flux-schnell': 'https://fal.run/fal-ai/flux/schnell',
    'flux-pro': 'https://fal.run/fal-ai/flux-pro/v1.1',

    // 3D, Аватары, Аудио
    'trellis-2': 'https://fal.run/fal-ai/trellis-2',
    'multi-talk': 'https://fal.run/fal-ai/ai-avatar/single-text',
    'minimax-speech': 'https://fal.run/fal-ai/minimax/speech-02-hd'
  };

  const targetEndpoint = endpoints[model] || endpoints['flux-schnell'];

  let bodyData = { prompt };

  if (category === 'video') {
    bodyData.duration = `${duration || 5}`;
    bodyData.aspect_ratio = '16:9';
    // Настройка тумблера звука
    bodyData.generate_audio = sound;
    bodyData.enable_audio = sound;

    if (resolution) {
      bodyData.resolution = resolution === '4k' ? '2160p' : resolution;
    }
  }

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
      throw new Error(data.detail || 'Ошибка при генерации нейросетью');
    }

    const mediaUrl = data.images?.[0]?.url || data.video?.url || data.audio_url?.url || data.model_mesh?.url || data.url;

    return res.status(200).json({
      success: true,
      result: { url: mediaUrl }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
