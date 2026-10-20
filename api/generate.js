export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, resolution } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Промпт не передан' });
  }

  try {
    const response = await fetch('https://fal.run/fal-ai/bytedance/seedance-2.5/image-to-video', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${process.env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt,
        resolution: resolution === '1080p' ? '1080p' : '720p',
        enable_audio: true
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || 'Ошибка генерации на стороне Fal.ai');
    }

    return res.status(200).json({ success: true, result: data });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, resolution } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Промпт не передан' });
  }

  try {
    const response = await fetch('https://fal.run/fal-ai/bytedance/seedance-2.5/image-to-video', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${process.env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt,
        resolution: resolution === '1080p' ? '1080p' : '720p',
        enable_audio: true
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || 'Ошибка генерации на стороне Fal.ai');
    }

    return res.status(200).json({ success: true, result: data });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
