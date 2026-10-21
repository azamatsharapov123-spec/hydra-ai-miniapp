// Единственный источник правды о моделях на сервере: эндпоинт fal.ai и цена.
// id и baseCost должны совпадать с sortedModels в index.html.
export const MODELS = {
  // image
  'nanobanana-pro': { category: 'image', baseCost: 4, endpoint: 'https://fal.run/fal-ai/flux/schnell' },
  'nanobanana-2.1': { category: 'image', baseCost: 2, endpoint: 'https://fal.run/fal-ai/flux/dev' },
  'nanobanana-1': { category: 'image', baseCost: 1, endpoint: 'https://fal.run/fal-ai/flux/schnell' },
  'nanobanana-2k': { category: 'image', baseCost: 2, endpoint: 'https://fal.run/fal-ai/flux/schnell' },
  'nanobanana-2f': { category: 'image', baseCost: 3, endpoint: 'https://fal.run/fal-ai/flux/dev' },
  'qwen-edit': { category: 'image', baseCost: 1, endpoint: 'https://fal.run/fal-ai/flux/schnell' },
  'grok-imagine': { category: 'image', baseCost: 2, endpoint: 'https://fal.run/fal-ai/flux/schnell' },
  'seedream-5pro': { category: 'image', baseCost: 2, endpoint: 'https://fal.run/fal-ai/flux/dev' },
  'seedream-1': { category: 'image', baseCost: 1, endpoint: 'https://fal.run/fal-ai/flux/schnell' },
  'seedream-4.5': { category: 'image', baseCost: 2, endpoint: 'https://fal.run/fal-ai/flux/dev' },
  'seedream-5lite': { category: 'image', baseCost: 1, endpoint: 'https://fal.run/fal-ai/flux/schnell' },
  'grok-imagine-2': { category: 'image', baseCost: 3, endpoint: 'https://fal.run/fal-ai/flux/dev' },
  'gpt-image-2.5': { category: 'image', baseCost: 1, endpoint: 'https://fal.run/fal-ai/flux/dev' },
  'gpt-image-1.5': { category: 'image', baseCost: 1, endpoint: 'https://fal.run/fal-ai/flux/schnell' },
  'gpt-image-2': { category: 'image', baseCost: 2, endpoint: 'https://fal.run/fal-ai/flux/dev' },
  // video
  'seedance-2.5': { category: 'video', baseCost: 28, maxDur: 30, endpoint: 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video' },
  'gemini-omni': { category: 'video', baseCost: 18, maxDur: 15, endpoint: 'https://fal.run/fal-ai/kling-video/v1/text-to-video' },
  'gemini-omni-1.1': { category: 'video', baseCost: 22, maxDur: 15, endpoint: 'https://fal.run/fal-ai/kling-video/v1/text-to-video' },
  'veo-3.1': { category: 'video', baseCost: 12, maxDur: 10, endpoint: 'https://fal.run/fal-ai/minimax/video-01/text-to-video' },
  'veo-3-fast': { category: 'video', baseCost: 9, maxDur: 10, endpoint: 'https://fal.run/fal-ai/minimax/video-01/text-to-video' },
  'grok-video-1.5': { category: 'video', baseCost: 15, maxDur: 10, endpoint: 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video' },
  'kling-3.0': { category: 'video', baseCost: 20, maxDur: 15, endpoint: 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video' },
  'kling-3.0-mc': { category: 'video', baseCost: 25, maxDur: 15, endpoint: 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video' },
  'kling-3.0-turbo': { category: 'video', baseCost: 11, maxDur: 10, endpoint: 'https://fal.run/fal-ai/kling-video/v1.5/standard/text-to-video' },
  'kling-o3': { category: 'video', baseCost: 19, maxDur: 15, endpoint: 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video' },
  'kling-o1': { category: 'video', baseCost: 16, maxDur: 10, endpoint: 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video' },
  'kling-v1-avatar': { category: 'video', baseCost: 14, maxDur: 10, endpoint: 'https://fal.run/fal-ai/kling-video/v1/text-to-video' },
  'kling-2.6-mc-k': { category: 'video', baseCost: 15, maxDur: 10, endpoint: 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video' },
  'kling-2.6-mc-f': { category: 'video', baseCost: 15, maxDur: 10, endpoint: 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video' },
  'kling-2.6': { category: 'video', baseCost: 12, maxDur: 10, endpoint: 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video' },
  'kling-turbo-2.5': { category: 'video', baseCost: 8, maxDur: 10, endpoint: 'https://fal.run/fal-ai/kling-video/v1.5/standard/text-to-video' },
  'kling-2.1': { category: 'video', baseCost: 10, maxDur: 10, endpoint: 'https://fal.run/fal-ai/kling-video/v1/text-to-video' },
  'wan-3.0': { category: 'video', baseCost: 8, maxDur: 10, endpoint: 'https://fal.run/fal-ai/minimax/video-01/text-to-video' },
  'wan-2.6': { category: 'video', baseCost: 6, maxDur: 10, endpoint: 'https://fal.run/fal-ai/minimax/video-01/text-to-video' },
  'wan-2.5': { category: 'video', baseCost: 5, maxDur: 10, endpoint: 'https://fal.run/fal-ai/minimax/video-01/text-to-video' },
  'seedance-2': { category: 'video', baseCost: 20, maxDur: 15, endpoint: 'https://fal.run/fal-ai/kling-video/v1.5/pro/text-to-video' },
  'seedance-2.0-mini': { category: 'video', baseCost: 10, maxDur: 10, endpoint: 'https://fal.run/fal-ai/kling-video/v1.5/standard/text-to-video' },
  'sora-2': { category: 'video', baseCost: 18, maxDur: 15, endpoint: 'https://fal.run/fal-ai/luma-dream-machine/text-to-video' },
  'sora-2-pro-f': { category: 'video', baseCost: 24, maxDur: 15, endpoint: 'https://fal.run/fal-ai/luma-dream-machine/text-to-video' },
  'runway': { category: 'video', baseCost: 6, maxDur: 10, endpoint: 'https://fal.run/fal-ai/runway-gen3/alpha/text-to-video' },
  'topaz': { category: 'video', baseCost: 5, maxDur: 10, endpoint: 'https://fal.run/fal-ai/topaz-video-upscale' },
  'hailuo-02': { category: 'video', baseCost: 10, maxDur: 10, endpoint: 'https://fal.run/fal-ai/minimax/video-01/text-to-video' },
  // audio
  'suno-v5': { category: 'audio', baseCost: 3, endpoint: 'https://fal.run/fal-ai/suno-music' },
  'suno-5.5': { category: 'audio', baseCost: 4, endpoint: 'https://fal.run/fal-ai/suno-music' },
  'elevenlabs-v3': { category: 'audio', baseCost: 10, endpoint: 'https://fal.run/fal-ai/elevenlabs/tts' },
  'elevenlabs-multi': { category: 'audio', baseCost: 8, endpoint: 'https://fal.run/fal-ai/elevenlabs/tts' },
  'elevenlabs-turbo': { category: 'audio', baseCost: 5, endpoint: 'https://fal.run/fal-ai/elevenlabs/tts' },
  'elevenlabs-dialog': { category: 'audio', baseCost: 12, endpoint: 'https://fal.run/fal-ai/elevenlabs/tts' },
  'elevenlabs-speech': { category: 'audio', baseCost: 15, endpoint: 'https://fal.run/fal-ai/elevenlabs/tts' },
  // avatar
  'multi-talk': { category: 'avatar', baseCost: 15, endpoint: 'https://fal.run/fal-ai/live-portrait' },
  'live-portrait': { category: 'avatar', baseCost: 10, endpoint: 'https://fal.run/fal-ai/live-portrait' }
};

const MIN_VIDEO_DURATION = 4;

// Повторяет recalculateCost() из index.html, но на сервере — клиентской цене не доверяем
export function calculateCost(model, { duration, quality, resolution } = {}) {
  let cost = model.baseCost;

  if (model.category === 'video') {
    cost = Math.round((model.baseCost / 5) * clampDuration(model, duration));
    if (quality === '1080p') cost += 2;
    if (quality === '2160p') cost += 5;
  } else if (model.category === 'image') {
    if (resolution === '2k') cost += 1;
    if (resolution === '4k') cost += 2;
  }

  return cost;
}

export function clampDuration(model, duration) {
  const value = parseInt(duration, 10) || 5;
  const max = model.maxDur || value;
  return Math.min(Math.max(value, MIN_VIDEO_DURATION), max);
}
