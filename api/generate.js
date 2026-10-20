export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Промпт не передан' });
  }

  try {
    const response = await fetch('https://fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${process.env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt,
        image_size: 'square_hd',
        num_inference_steps: 4
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || 'Ошибка генерации');
    }

    // Возвращаем ссылку на готовую картинку
    const imageUrl = data.images && data.images[0]?.url;

    return res.status(200).json({ 
      success: true, 
      result: { video: { url: imageUrl } } // чтобы совместимо отображалось в приложении
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
