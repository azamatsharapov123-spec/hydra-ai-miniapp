export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, model, category } = req.body;

  // Бесплатный AI Чат
  if (category === 'chat') {
    try {
      const response = await fetch('https://fal.run/fal-ai/any-llm', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${process.env.FAL_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-1.5-flash',
          prompt: prompt
        })
      });

      const data = await response.json();
      const text = data.output || data.choices?.[0]?.message?.content || "Здравствуйте! Какую задачу решить?";
      return res.status(200).json({ success: true, result: { text } });
    } catch (e) {
      return res.status(500).json({ error: "Ошибка бесплатного чата" });
    }
  }

  // Маршруты ко всем нейросетям Fal.ai
  const endpoints = {
    // Картинки
    'nano-banana-pro': 'https://fal.run/fal-ai/nano-banana-pro',
    'flux-pro': 'https://fal.run/fal-ai/flux-pro/v1.1',
    'flux-3': 'https://fal.run/fal-ai/flux-3',
    'seedream-5': 'https://fal.run/fal-ai/seedream-5.0/pro',
    'ideogram-4': 'https://fal.run/fal-ai/ideogram/v4',
    'recraft-v3': 'https://fal.run/fal-ai/recraft-v3',
    'sd-3.5': 'https://fal.run/fal-ai/stable-diffusion-v35-large',
    'flux-schnell': 'https://fal.run/fal-ai/flux/schnell',

    // Видео
    'seedance-2.5': 'https://fal.run/fal-ai/bytedance/seedance-2.5/image-to-video',
    'kling-3.0-pro': 'https://fal.run/fal-ai/kling-video/v3/pro/text-to-video',
    'kling-3.0-std': 'https://fal.run/fal-ai/kling-video/v3/standard/text-to-video',
    'minimax-h3': 'https://fal.run/fal-ai/minimax/h3-max',
    'grok-video-1.5': 'https://fal.run/fal-ai/grok-imagine-video/v1.5',
    'wan-3.0': 'https://fal.run/fal-ai/wan/v3/text-to-video',
    'luma-v2': 'https://fal.run/fal-ai/luma-dream-machine/v2',
    'pixverse-v6': 'https://fal.run/fal-ai/pixverse/v6',

    // Аватары, Аудио, 3D
    'multi-talk': 'https://fal.run/fal-ai/ai-avatar/single-text',
    'live-portrait': 'https://fal.run/fal-ai/live-portrait',
    'sadtalker': 'https://fal.run/fal-ai/sadtalker',
    'suno-v4': 'https://fal.run/fal-ai/suno/v4',
    'sonilo-music': 'https://fal.run/fal-ai/sonilo/v1.1/text-to-music',
    'minimax-speech': 'https://fal.run/fal-ai/minimax/speech-02-hd',
    'elevenlabs': 'https://fal.run/fal-ai/elevenlabs/tts',
    'gemini-tts': 'https://fal.run/fal-ai/gemini-3.1-flash-tts',
    'hunyuan-3d': 'https://fal.run/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d',
    'trellis-2': 'https://fal.run/fal-ai/trellis-2',
    'tripo-3.1': 'https://fal.run/tripo3d/h3.1/text-to-3d'
  };

  const targetEndpoint = endpoints[model] || endpoints['nano-banana-pro'];

  try {
    const response = await fetch(targetEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${process.env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt })
    });

    const data = await response.json();
    const mediaUrl = data.images?.[0]?.url || data.video?.url || data.audio_url?.url || data.model_mesh?.url || data.url;

    return res.status(200).json({ success: true, result: { url: mediaUrl } });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
