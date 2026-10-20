export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, model, category } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Промпт не передан' });
  }

  // Карта эндпоинтов Fal.ai под каждую модель
  const endpoints = {
    'flux-schnell': 'https://fal.run/fal-ai/flux/schnell',
    'flux-pro': 'https://fal.run/fal-ai/flux-pro/v1.1',
    'recraft-v3': 'https://fal.run/fal-ai/recraft-v3',
    'ideogram-v2': 'https://fal.run/fal-ai/ideogram/v2',
    'seedance-2.5': 'https://fal.run/fal-ai/bytedance/seedance-2.5/image-to-video',
    'kling-1.5': 'https://fal.run/fal-ai/kling-video/v1.5/standard/text-to-video',
    'wan-2.1': 'https://fal.run/fal-ai/wan/v2.1/text-to-video'
  };

  const targetEndpoint = endpoints[model] || endpoints['flux-schnell'];

  try {
    const response = await fetch(targetEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${process.env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt,
        enable_audio: true
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || 'Ошибка при генерации в нейросети');
    }

    // Универсальное извлечение URL медиа-файла
    const mediaUrl = data.images?.[0]?.url || data.video?.url || data.video_url || data.url;

    return res.status(200).json({ 
      success: true, 
      result: { url: mediaUrl } 
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
