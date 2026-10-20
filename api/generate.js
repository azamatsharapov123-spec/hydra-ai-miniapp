export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, model, category, resolution, duration, refUrl } = req.body;

  if (!prompt && !refUrl) {
    return res.status(400).json({ error: 'Передайте текстовый запрос или ссылку на референс' });
  }

  // Карта всех поддерживаемых моделей Fal.ai
  const endpoints = {
    // Картинки
    'flux-schnell': 'https://fal.run/fal-ai/flux/schnell',
    'flux-pro': 'https://fal.run/fal-ai/flux-pro/v1.1',
    'recraft-v3': 'https://fal.run/fal-ai/recraft-v3',
    'ideogram-v2': 'https://fal.run/fal-ai/ideogram/v2',
    
    // Видео
    'kling-3.0': 'https://fal.run/fal-ai/kling-video/v3/pro/text-to-video',
    'wan-3.0': 'https://fal.run/fal-ai/wan/v3/text-to-video',
    'seedance-2.5': 'https://fal.run/fal-ai/bytedance/seedance-2.5/image-to-video',

    // 3D Модели
    'trellis-2': 'https://fal.run/fal-ai/trellis-2',
    'hunyuan-3d': 'https://fal.run/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d',

    // Аватары
    'multi-talk': 'https://fal.run/fal-ai/ai-avatar/single-text',
    'live-portrait': 'https://fal.run/fal-ai/live-portrait',

    // Аудио и Чат
    'suno-v4': 'https://fal.run/fal-ai/suno/v4',
    'elevenlabs': 'https://fal.run/fal-ai/elevenlabs/tts',
    'gpt-4o': 'https://fal.run/fal-ai/any-llm',
    'claude-sonnet': 'https://fal.run/fal-ai/any-llm'
  };

  const targetEndpoint = endpoints[model] || endpoints['flux-schnell'];

  // Формируем payload для Fal.ai
  let bodyData = {};

  if (prompt) {
    bodyData.prompt = prompt;
  }

  // Передача референс-картинки, если клиент прикрепил ссылку
  if (refUrl) {
    bodyData.image_url = refUrl;
    bodyData.input_image_url = refUrl;
  }

  // Специфичные настройки для видео
  if (category === 'video') {
    bodyData.duration = `${duration || 5}`;
    bodyData.aspect_ratio = '16:9';
    bodyData.generate_audio = true;
    bodyData.enable_audio = true;
    if (resolution) {
      bodyData.resolution = resolution === '4k' ? '2160p' : resolution;
    }
    // Если передан референс для видео, переключаем на image-to-video
    if (refUrl) {
      bodyData.image_url = refUrl;
    }
  } 
  // Специфичные настройки для аватаров
  else if (category === 'avatar') {
    bodyData.text = prompt;
    if (refUrl) bodyData.image_url = refUrl;
  } 
  // Текстовый чат
  else if (category === 'chat') {
    bodyData.model = model === 'claude-sonnet' ? 'anthropic/claude-3.5-sonnet' : 'openai/gpt-4o';
  } 
  // Озвучка ElevenLabs
  else if (model === 'elevenlabs') {
    bodyData = { text: prompt };
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
      throw new Error(data.detail || 'Ошибка при обработке запроса нейросетью');
    }

    // Универсальный разбор ответа (картинка, видео, аудио или текст)
    const mediaUrl = data.images?.[0]?.url || data.video?.url || data.model_mesh?.url || data.audio_url?.url || data.audio?.url || data.url;
    const textResult = data.output || data.text || data.choices?.[0]?.message?.content;

    return res.status(200).json({ 
      success: true, 
      result: { 
        url: mediaUrl,
        text: textResult
      } 
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
