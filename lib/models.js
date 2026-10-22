// Единый каталог моделей Hydra AI Studio.
// Отсюда берут данные и приложение (через /api/models), и сервер (generate/status):
// адреса fal.ai, настройки, параметры запроса и цены в ⚡.
//
// Правило цены: ⚡ = цена fal.ai / TOKEN_USD * наценка группы.
// Группа 1 — без наценки (витрина), 2 — +25%, 3 — +45%.

export const TOKEN_USD = 0.032;
export const GROUP_MARKUP = { 1: 1.0, 2: 1.25, 3: 1.45 };

// ⚡ за секунду / за единицу (дробное число)
const T = (usd, g) => +(usd / TOKEN_USD * GROUP_MARKUP[g]).toFixed(4);
// ⚡ за генерацию (целое, округление вверх, минимум 1)
const I = (usd, g) => Math.max(1, Math.ceil(+T(usd, g).toFixed(6)));

// ---------- Описания полей формы ----------
const ASPECT_LABELS = {
  '1:1': 'Квадрат (1:1)', '16:9': 'Горизонтальное (16:9)', '9:16': 'Вертикальное (9:16)',
  '4:3': 'Горизонтальное (4:3)', '3:4': 'Вертикальное (3:4)', '21:9': 'Ультраширокое (21:9)',
  '3:2': 'Горизонтальное (3:2)', '2:3': 'Вертикальное (2:3)', 'auto': 'Авто', 'adaptive': 'Авто'
};
const A = list => list.map(v => [v, ASPECT_LABELS[v] || v]);
const secs = list => list.map(n => [n, `${n} сек`]);

const F = {
  prompt: (label, max, placeholder, required = true) =>
    ({ key: 'prompt', type: 'prompt', label, max, placeholder, required }),
  select: (key, label, options, def) => ({ key, type: 'select', label, options, default: def }),
  range: (key, label, min, max, step, def, unit = '') =>
    ({ key, type: 'range', label, min, max, step, default: def, unit }),
  check: (key, label, def = true) => ({ key, type: 'checkbox', label, default: def }),
  file: (key, label, accept, required, maxBytes, hint = '') =>
    ({ key, type: 'file', label, accept, required, maxBytes, hint })
};

const START_IMAGE = F.file('image', 'Стартовое изображение (необязательно)', 'image', false, 700 * 1024,
  'Если добавить картинку, видео оживит её');

// ---------- Голоса ----------
const ELEVEN_VOICES = [
  ['Rachel', 'Rachel (жен.)'], ['Aria', 'Aria (жен.)'], ['Sarah', 'Sarah (жен.)'], ['Laura', 'Laura (жен.)'],
  ['Charlotte', 'Charlotte (жен.)'], ['Alice', 'Alice (жен.)'], ['Matilda', 'Matilda (жен.)'],
  ['Jessica', 'Jessica (жен.)'], ['Lily', 'Lily (жен.)'], ['Roger', 'Roger (муж.)'], ['Charlie', 'Charlie (муж.)'],
  ['George', 'George (муж.)'], ['Callum', 'Callum (муж.)'], ['Liam', 'Liam (муж.)'], ['Will', 'Will (муж.)'],
  ['Eric', 'Eric (муж.)'], ['Chris', 'Chris (муж.)'], ['Brian', 'Brian (муж.)'], ['Daniel', 'Daniel (муж.)'],
  ['Bill', 'Bill (муж.)'], ['River', 'River (нейтр.)']
];
const MINIMAX_VOICES = [
  ['Wise_Woman', 'Wise Woman (жен.)'], ['Friendly_Person', 'Friendly Person'], ['Inspirational_girl', 'Inspirational Girl (жен.)'],
  ['Calm_Woman', 'Calm Woman (жен.)'], ['Lively_Girl', 'Lively Girl (жен.)'], ['Lovely_Girl', 'Lovely Girl (жен.)'],
  ['Sweet_Girl_2', 'Sweet Girl (жен.)'], ['Exuberant_Girl', 'Exuberant Girl (жен.)'], ['Abbess', 'Abbess (жен.)'],
  ['Deep_Voice_Man', 'Deep Voice (муж.)'], ['Casual_Guy', 'Casual Guy (муж.)'], ['Patient_Man', 'Patient Man (муж.)'],
  ['Young_Knight', 'Young Knight (муж.)'], ['Determined_Man', 'Determined Man (муж.)'], ['Decent_Boy', 'Decent Boy (муж.)'],
  ['Imposing_Manner', 'Imposing Manner (муж.)'], ['Elegant_Man', 'Elegant Man (муж.)']
];
const TTS_LANGS = [['auto', 'Определять автоматически'], ['ru', 'Русский'], ['en', 'English'], ['tr', 'Türkçe'], ['ar', 'العربية'], ['uz', 'Oʻzbekcha']];
const MM_LANGS = [['auto', 'Определять автоматически'], ['Russian', 'Русский'], ['English', 'English'], ['Turkish', 'Türkçe'], ['Arabic', 'العربية']];

// ---------- Размеры Seedream (в пикселях) ----------
const SEEDREAM_SIZES = {
  '2k': { '1:1': [2048, 2048], '16:9': [2560, 1440], '9:16': [1440, 2560], '4:3': [2304, 1728], '3:4': [1728, 2304] },
  '4k': { '1:1': [4096, 4096], '16:9': [3840, 2160], '9:16': [2160, 3840], '4:3': [3328, 2496], '3:4': [2496, 3328] }
};
const seedreamBuild = v => {
  const [width, height] = SEEDREAM_SIZES[v.res][v.aspect];
  return { prompt: v.prompt, image_size: { width, height }, num_images: 1 };
};

const FLUX_SIZES = { '1:1': 'square_hd', '4:3': 'landscape_4_3', '16:9': 'landscape_16_9', '3:4': 'portrait_4_3', '9:16': 'portrait_16_9' };

// Цена видео за секунду в ⚡ по разрешениям. usd: число или {on, off} (со звуком / без)
const secTable = (obj, g) => {
  const out = {};
  for (const [res, usd] of Object.entries(obj)) {
    out[res] = typeof usd === 'number' ? T(usd, g) : { on: T(usd.on, g), off: T(usd.off, g) };
  }
  return out;
};

const PROMPT_IMG = F.prompt('Запрос (промпт)', 2000, 'Опишите, что хотите получить...');
const PROMPT_VID = F.prompt('Запрос (промпт)', 2500, 'Опишите сцену, действие и камеру...');

export const MODELS = [
  // ================= КАРТИНКИ =================
  {
    id: 'nanobanana-pro', category: 'image', name: 'Nano Banana Pro', group: 2,
    endpoint: 'fal-ai/nano-banana-pro', output: 'image',
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '3:2', '2:3']), '1:1'),
      F.select('res', 'Разрешение', [['1K', '1K Standard'], ['2K', '2K HD'], ['4K', '4K Ultra HD']], '1K')],
    price: { kind: 'image', table: { '1K': 5, '2K': 5, '4K': 12 } },
    build: v => ({ prompt: v.prompt, aspect_ratio: v.aspect, resolution: v.res, num_images: 1, output_format: 'png' })
  },
  {
    id: 'nanobanana-2', category: 'image', name: 'Nano Banana 2', group: 2,
    endpoint: 'fal-ai/nano-banana-2', output: 'image',
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '3:2', '2:3']), '1:1'),
      F.select('res', 'Разрешение', [['1K', '1K Standard'], ['2K', '2K HD'], ['4K', '4K Ultra HD']], '1K')],
    price: { kind: 'image', table: { '1K': I(0.08, 2), '2K': I(0.12, 2), '4K': I(0.16, 2) } },
    build: v => ({ prompt: v.prompt, aspect_ratio: v.aspect, resolution: v.res, num_images: 1, output_format: 'png' })
  },
  {
    id: 'nanobanana-1', category: 'image', name: 'Nano Banana 1', group: 2,
    endpoint: 'fal-ai/nano-banana', output: 'image',
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '3:2', '2:3']), '1:1')],
    price: { kind: 'flat', tokens: I(0.0398, 2) },
    build: v => ({ prompt: v.prompt, aspect_ratio: v.aspect, num_images: 1, output_format: 'png' })
  },
  {
    id: 'seedream-4.5', category: 'image', name: 'Seedream 4.5', group: 2,
    endpoint: 'fal-ai/bytedance/seedream/v4.5/text-to-image', output: 'image',
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '16:9', '9:16', '4:3', '3:4']), '1:1'),
      F.select('res', 'Разрешение', [['2k', '2K HD'], ['4k', '4K Ultra HD']], '2k')],
    price: { kind: 'image', table: { '2k': I(0.04, 2), '4k': I(0.04, 2) } },
    build: seedreamBuild
  },
  {
    id: 'seedream-5pro', category: 'image', name: 'Seedream 5 Pro', group: 2,
    endpoint: 'bytedance/seedream/v5/pro/text-to-image', output: 'image',
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '16:9', '9:16', '4:3', '3:4']), '1:1'),
      F.select('res', 'Разрешение', [['2k', '2K HD']], '2k')],
    price: { kind: 'image', table: { '2k': I(0.135, 2) } },
    build: seedreamBuild
  },
  {
    id: 'grok-imagine', category: 'image', name: 'Grok Imagine', group: 2,
    endpoint: 'xai/grok-imagine-image', output: 'image',
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']), '1:1')],
    price: { kind: 'flat', tokens: 2 },
    build: v => ({ prompt: v.prompt, aspect_ratio: v.aspect, num_images: 1, output_format: 'jpeg' })
  },
  {
    id: 'flux-2', category: 'image', name: 'FLUX 2', group: 2,
    endpoint: 'fal-ai/flux-2', output: 'image',
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '16:9', '9:16', '4:3', '3:4']), '1:1')],
    price: { kind: 'flat', tokens: I(0.0126, 2) },
    build: v => ({ prompt: v.prompt, image_size: FLUX_SIZES[v.aspect], num_images: 1, output_format: 'png' })
  },
  {
    id: 'qwen-edit', category: 'image', name: 'Qwen Image Edit (правка фото)', group: 2,
    endpoint: 'fal-ai/qwen-image-edit', output: 'image',
    fields: [F.file('image', 'Фото, которое нужно изменить', 'image', true, 700 * 1024),
      F.prompt('Что изменить', 1000, 'Например: сделай фон вечерним городом')],
    price: { kind: 'flat', tokens: I(0.03, 2) },
    build: v => ({ prompt: v.prompt, image_url: v.image })
  },

  // ================= ВИДЕО =================
  {
    id: 'seedance-2.5', category: 'video', name: 'Seedance 2.5', group: 1,
    endpoint: 'bytedance/seedance-2.5/us/text-to-video', output: 'video',
    i2v: { endpoint: 'bytedance/seedance-2.5/us/image-to-video', field: 'image_url', omit: ['aspect_ratio'] },
    fields: [PROMPT_VID, START_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']), '16:9'),
      F.select('res', 'Качество', [['480p', '480p'], ['720p', '720p HD'], ['1080p', '1080p Full HD']], '480p'),
      F.range('duration', 'Длительность', 4, 30, 1, 5, ' сек'),
      F.check('sound', 'Со звуком', true)],
    // Цены в ⚡ за секунду. Себестоимость fal за сек: 480p $0.2646, 720p $0.5676, 1080p $1.396.
    // 480p = 6.4 ⚡/сек (32 ⚡ за 5 сек): примерно точка безубыточности при партнёрских 20%.
    // 720p и 1080p — на ~10% выше цены конкурента (378 и 948 ⚡ за 30 сек)
    price: { kind: 'second', table: { '480p': 6.4, '720p': 14, '1080p': 35 } },
    build: v => ({ prompt: v.prompt, resolution: v.res, duration: String(v.duration), aspect_ratio: v.aspect, generate_audio: v.sound })
  },
  {
    // Видео по фото-референсам (персонажи, одежда, места). Фото в запросе называются @Image1, @Image2 …
    // Именно эта модель используется в разделе «Тренды». fal берёт за такое видео меньше, чем за текст-в-видео
    // через /us/ (480p $0.2205/сек, 720p $0.473/сек), поэтому цены в ⚡ те же, а запас больше.
    id: 'seedance-2.5-ref', category: 'video', name: 'Seedance 2.5 по фото (персонажи)', group: 1,
    endpoint: 'bytedance/seedance-2.5/reference-to-video', output: 'video',
    fields: [
      F.prompt('Запрос (промпт)', 2500, 'Опишите сцену. Фото называйте так: @Image1, @Image2 ...'),
      F.file('image1', 'Фото 1 (в запросе: @Image1)', 'image', true, 450 * 1024, 'Персонаж, человек или предмет'),
      F.file('image2', 'Фото 2 (@Image2), необязательно', 'image', false, 450 * 1024),
      F.file('image3', 'Фото 3 (@Image3), необязательно', 'image', false, 450 * 1024),
      F.file('image4', 'Фото 4 (@Image4), необязательно', 'image', false, 450 * 1024),
      F.select('aspect', 'Соотношение сторон', A(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']), '9:16'),
      F.select('res', 'Качество', [['480p', '480p'], ['720p', '720p HD'], ['1080p', '1080p Full HD']], '480p'),
      F.range('duration', 'Длительность', 4, 30, 1, 5, ' сек'),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: { '480p': 6.4, '720p': 14, '1080p': 35 } },
    build: v => ({
      prompt: v.prompt, resolution: v.res, duration: String(v.duration), aspect_ratio: v.aspect, generate_audio: v.sound,
      image_urls: [v.image1, v.image2, v.image3, v.image4].filter(Boolean)
    })
  },
  {
    id: 'seedance-2', category: 'video', name: 'Seedance 2.0 Pro', group: 1,
    endpoint: 'bytedance/seedance-2.0/text-to-video', output: 'video',
    fields: [PROMPT_VID,
      F.select('aspect', 'Соотношение сторон', A(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']), '16:9'),
      F.select('res', 'Качество', [['720p', '720p HD']], '720p'),
      F.range('duration', 'Длительность', 4, 15, 1, 5, ' сек'),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ '720p': 0.3034 }, 1) },
    build: v => ({ prompt: v.prompt, resolution: v.res, duration: String(v.duration), aspect_ratio: v.aspect, generate_audio: v.sound })
  },
  {
    id: 'seedance-2.0-fast', category: 'video', name: 'Seedance 2.0 Fast', group: 2,
    endpoint: 'bytedance/seedance-2.0/fast/text-to-video', output: 'video',
    fields: [PROMPT_VID,
      F.select('aspect', 'Соотношение сторон', A(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']), '16:9'),
      F.select('res', 'Качество', [['480p', '480p'], ['720p', '720p HD']], '480p'),
      F.range('duration', 'Длительность', 4, 15, 1, 5, ' сек'),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ '480p': 0.1076, '720p': 0.2419 }, 2) },
    build: v => ({ prompt: v.prompt, resolution: v.res, duration: String(v.duration), aspect_ratio: v.aspect, generate_audio: v.sound })
  },
  {
    id: 'seedance-2.0-mini', category: 'video', name: 'Seedance 2.0 Mini', group: 2,
    endpoint: 'bytedance/seedance-2.0/mini/text-to-video', output: 'video',
    fields: [PROMPT_VID,
      F.select('aspect', 'Соотношение сторон', A(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']), '16:9'),
      F.select('res', 'Качество', [['480p', '480p'], ['720p', '720p HD']], '480p'),
      F.range('duration', 'Длительность', 4, 15, 1, 5, ' сек'),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ '480p': 0.0721, '720p': 0.1547 }, 2) },
    build: v => ({ prompt: v.prompt, resolution: v.res, duration: String(v.duration), aspect_ratio: v.aspect, generate_audio: v.sound })
  },
  {
    id: 'veo-3.1', category: 'video', name: 'Veo 3.1', group: 1,
    endpoint: 'fal-ai/veo3.1', output: 'video',
    i2v: { endpoint: 'fal-ai/veo3.1/image-to-video', field: 'image_url', omit: [] },
    fields: [PROMPT_VID, START_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16']), '16:9'),
      F.select('res', 'Качество', [['720p', '720p HD'], ['1080p', '1080p Full HD'], ['4k', '4K Ultra HD']], '720p'),
      F.select('duration', 'Длительность', secs([4, 6, 8]), 4),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ '720p': { on: 0.40, off: 0.20 }, '1080p': { on: 0.40, off: 0.20 }, '4k': { on: 0.60, off: 0.40 } }, 1) },
    build: v => ({ prompt: v.prompt, aspect_ratio: v.aspect, duration: `${v.duration}s`, resolution: v.res, generate_audio: v.sound })
  },
  {
    id: 'veo-3-fast', category: 'video', name: 'Veo 3.1 Fast', group: 1,
    endpoint: 'fal-ai/veo3.1/fast', output: 'video',
    i2v: { endpoint: 'fal-ai/veo3.1/fast/image-to-video', field: 'image_url', omit: [] },
    fields: [PROMPT_VID, START_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16']), '16:9'),
      F.select('res', 'Качество', [['720p', '720p HD'], ['1080p', '1080p Full HD'], ['4k', '4K Ultra HD']], '720p'),
      F.select('duration', 'Длительность', secs([4, 6, 8]), 4),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ '720p': { on: 0.15, off: 0.10 }, '1080p': { on: 0.15, off: 0.10 }, '4k': { on: 0.35, off: 0.30 } }, 1) },
    build: v => ({ prompt: v.prompt, aspect_ratio: v.aspect, duration: `${v.duration}s`, resolution: v.res, generate_audio: v.sound })
  },
  {
    id: 'kling-3.0', category: 'video', name: 'Kling 3.0', group: 1,
    endpoint: 'fal-ai/kling-video/v3/pro/text-to-video', output: 'video',
    i2v: { endpoint: 'fal-ai/kling-video/v3/pro/image-to-video', field: 'start_image_url', omit: ['aspect_ratio'] },
    fields: [PROMPT_VID, START_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16', '1:1']), '16:9'),
      F.select('res', 'Качество', [['pro', 'Pro']], 'pro'),
      F.range('duration', 'Длительность', 3, 15, 1, 5, ' сек'),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ pro: { on: 0.168, off: 0.112 } }, 1) },
    build: v => ({ prompt: v.prompt, duration: String(v.duration), aspect_ratio: v.aspect, generate_audio: v.sound })
  },
  {
    id: 'kling-o3', category: 'video', name: 'Kling O3', group: 2,
    endpoint: 'fal-ai/kling-video/o3/pro/text-to-video', output: 'video',
    fields: [PROMPT_VID,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16', '1:1']), '16:9'),
      F.select('res', 'Качество', [['pro', 'Pro']], 'pro'),
      F.range('duration', 'Длительность', 3, 15, 1, 5, ' сек')],
    price: { kind: 'second', table: secTable({ pro: 0.14 }, 2) },
    build: v => ({ prompt: v.prompt, duration: String(v.duration), aspect_ratio: v.aspect })
  },
  {
    id: 'kling-2.6', category: 'video', name: 'Kling 2.6', group: 2,
    endpoint: 'fal-ai/kling-video/v2.6/pro/text-to-video', output: 'video',
    i2v: { endpoint: 'fal-ai/kling-video/v2.6/pro/image-to-video', field: 'image_url', omit: ['aspect_ratio'] },
    fields: [PROMPT_VID, START_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16', '1:1']), '16:9'),
      F.select('res', 'Качество', [['pro', 'Pro']], 'pro'),
      F.select('duration', 'Длительность', secs([5, 10]), 5),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ pro: { on: 0.14, off: 0.07 } }, 2) },
    build: v => ({ prompt: v.prompt, duration: String(v.duration), aspect_ratio: v.aspect, generate_audio: v.sound })
  },
  {
    id: 'kling-turbo-2.5', category: 'video', name: 'Kling Turbo 2.5', group: 2,
    endpoint: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', output: 'video',
    i2v: { endpoint: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', field: 'image_url', omit: ['aspect_ratio'] },
    fields: [PROMPT_VID, START_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16', '1:1']), '16:9'),
      F.select('res', 'Качество', [['pro', 'Pro']], 'pro'),
      F.select('duration', 'Длительность', secs([5, 10]), 5)],
    price: { kind: 'second', table: secTable({ pro: 0.07 }, 2) },
    build: v => ({ prompt: v.prompt, duration: String(v.duration), aspect_ratio: v.aspect })
  },
  {
    id: 'gemini-omni-1.1', category: 'video', name: 'Gemini Omni 1.1', group: 2,
    endpoint: 'google/gemini-omni-flash/v1.1/text-to-video', output: 'video',
    fields: [PROMPT_VID,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16']), '16:9'),
      F.select('res', 'Качество', [['360p', '360p'], ['720p', '720p HD'], ['1080p', '1080p Full HD'], ['4k', '4K Ultra HD']], '720p'),
      F.range('duration', 'Длительность', 4, 10, 1, 5, ' сек')],
    price: { kind: 'second', table: secTable({ '360p': 0.03, '720p': 0.10, '1080p': 0.15, '4k': 0.30 }, 2) },
    build: v => ({ prompt: v.prompt, aspect_ratio: v.aspect, resolution: v.res, duration: v.duration })
  },
  {
    id: 'wan-3.0', category: 'video', name: 'Wan 3.0', group: 2,
    endpoint: 'alibaba/wan-3.0/text-to-video', output: 'video',
    i2v: { endpoint: 'alibaba/wan-3.0/image-to-video', field: 'image_url', omit: ['aspect_ratio'] },
    fields: [PROMPT_VID, START_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4']), '16:9'),
      F.select('res', 'Качество', [['480p', '480p'], ['720p', '720p HD'], ['1080p', '1080p Full HD']], '720p'),
      F.range('duration', 'Длительность', 3, 15, 1, 5, ' сек')],
    price: { kind: 'second', table: secTable({ '480p': 0.05, '720p': 0.10, '1080p': 0.20 }, 2) },
    build: v => ({ prompt: v.prompt, resolution: v.res, aspect_ratio: v.aspect, duration: v.duration })
  },
  {
    id: 'hailuo-02', category: 'video', name: 'Hailuo 02', group: 2,
    endpoint: 'fal-ai/minimax/hailuo-02/standard/text-to-video', output: 'video',
    i2v: { endpoint: 'fal-ai/minimax/hailuo-02/standard/image-to-video', field: 'image_url', omit: [] },
    fields: [PROMPT_VID, START_IMAGE,
      F.select('res', 'Качество', [['768p', '768p HD']], '768p'),
      F.select('duration', 'Длительность', secs([6, 10]), 6)],
    price: { kind: 'second', table: secTable({ '768p': 0.045 }, 2) },
    build: v => ({ prompt: v.prompt, duration: String(v.duration) })
  },
  {
    id: 'sora-2', category: 'video', name: 'Sora 2', group: 2,
    endpoint: 'fal-ai/sora-2/text-to-video', output: 'video',
    i2v: { endpoint: 'fal-ai/sora-2/image-to-video', field: 'image_url', omit: [] },
    fields: [PROMPT_VID, START_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16']), '16:9'),
      F.select('res', 'Качество', [['720p', '720p HD']], '720p'),
      F.select('duration', 'Длительность', secs([4, 8, 12]), 4)],
    price: { kind: 'second', table: secTable({ '720p': 0.10 }, 2) },
    build: v => ({ prompt: v.prompt, duration: v.duration, aspect_ratio: v.aspect, resolution: v.res })
  },
  {
    id: 'sora-2-pro', category: 'video', name: 'Sora 2 Pro', group: 2,
    endpoint: 'fal-ai/sora-2/text-to-video/pro', output: 'video',
    i2v: { endpoint: 'fal-ai/sora-2/image-to-video/pro', field: 'image_url', omit: [] },
    fields: [PROMPT_VID, START_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16']), '16:9'),
      F.select('res', 'Качество', [['720p', '720p HD'], ['1080p', '1080p Full HD']], '720p'),
      F.select('duration', 'Длительность', secs([4, 8, 12]), 4)],
    price: { kind: 'second', table: secTable({ '720p': 0.30, '1080p': 0.50 }, 2) },
    build: v => ({ prompt: v.prompt, duration: v.duration, aspect_ratio: v.aspect, resolution: v.res })
  },
  {
    id: 'grok-video', category: 'video', name: 'Grok Imagine Video', group: 2,
    endpoint: 'xai/grok-imagine-video/text-to-video', output: 'video',
    i2v: { endpoint: 'xai/grok-imagine-video/image-to-video', field: 'image_url', omit: ['aspect_ratio'] },
    fields: [PROMPT_VID, START_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16', '1:1', '4:3', '3:4']), '16:9'),
      F.select('res', 'Качество', [['480p', '480p'], ['720p', '720p HD']], '720p'),
      F.range('duration', 'Длительность', 3, 10, 1, 6, ' сек')],
    price: { kind: 'second', table: secTable({ '480p': 0.05, '720p': 0.05 }, 2) },
    build: v => ({ prompt: v.prompt, duration: v.duration, resolution: v.res, aspect_ratio: v.aspect })
  },

  // ================= АВАТАРЫ =================
  {
    id: 'kling-avatar-std', category: 'avatar', name: 'Kling Avatar v2 Standard', group: 2,
    endpoint: 'fal-ai/kling-video/ai-avatar/v2/standard', output: 'video',
    audioLimits: { min: 1, max: 30 },
    fields: [F.file('image', 'Фото персонажа (лицо хорошо видно)', 'image', true, 700 * 1024),
      F.file('audio', 'Аудио с речью (до 30 сек)', 'audio', true, 2200 * 1024, 'mp3, wav, m4a'),
      F.prompt('Описание сцены (необязательно)', 500, 'Например: говорит спокойно, улыбается', false)],
    price: { kind: 'audioSec', rate: T(0.0562, 2) },
    build: v => ({ image_url: v.image, audio_url: v.audio, prompt: v.prompt || '.' })
  },
  {
    id: 'kling-avatar-pro', category: 'avatar', name: 'Kling Avatar v2 Pro', group: 2,
    endpoint: 'fal-ai/kling-video/ai-avatar/v2/pro', output: 'video',
    audioLimits: { min: 1, max: 30 },
    fields: [F.file('image', 'Фото персонажа (лицо хорошо видно)', 'image', true, 700 * 1024),
      F.file('audio', 'Аудио с речью (до 30 сек)', 'audio', true, 2200 * 1024, 'mp3, wav, m4a'),
      F.prompt('Описание сцены (необязательно)', 500, 'Например: говорит спокойно, улыбается', false)],
    price: { kind: 'audioSec', rate: T(0.115, 2) },
    build: v => ({ image_url: v.image, audio_url: v.audio, prompt: v.prompt || '.' })
  },
  {
    id: 'multi-talk', category: 'avatar', name: 'MultiTalk (диалог двух героев)', group: 2,
    endpoint: 'fal-ai/ai-avatar/multi', output: 'video',
    fields: [F.file('image', 'Фото (один или два человека)', 'image', true, 700 * 1024),
      F.file('audio', 'Голос героя 1', 'audio', true, 1200 * 1024, 'mp3, wav, m4a'),
      F.file('audio2', 'Голос героя 2 (необязательно)', 'audio', false, 1200 * 1024, 'mp3, wav, m4a'),
      F.prompt('Описание сцены', 500, 'Например: двое разговаривают в кафе'),
      F.select('res', 'Качество', [['480p', '480p'], ['720p', '720p HD']], '480p'),
      F.select('frames', 'Длина ролика', [[81, 'короткий'], [129, 'длиннее']], 81)],
    // Цена за ролик целиком (fal.ai считает по кадрам: 81 кадр — базовая цена, больше — ×1.25; 720p — ×2).
    // Расчёт консервативный (16 кадров/сек), сверьте после первых генераций.
    price: {
      kind: 'frames', table: {
        '480p': { 81: I(1.01, 2), 129: I(2.01, 2) },
        '720p': { 81: I(2.02, 2), 129: I(4.02, 2) }
      }
    },
    build: v => {
      const p = { prompt: v.prompt, image_url: v.image, first_audio_url: v.audio, num_frames: Number(v.frames), resolution: v.res };
      if (v.audio2) p.second_audio_url = v.audio2; else p.use_only_first_audio = true;
      return p;
    }
  },

  // ================= АУДИО =================
  {
    id: 'elevenlabs-v3', category: 'audio', name: 'ElevenLabs v3 (озвучка текста)', group: 2,
    endpoint: 'fal-ai/elevenlabs/tts/eleven-v3', output: 'audio',
    fields: [F.prompt('Текст для озвучки', 2500, 'Введите текст, который нужно озвучить...'),
      F.select('voice', 'Голос', ELEVEN_VOICES, 'Rachel'),
      F.select('stability', 'Стиль', [['0', 'Выразительный'], ['0.5', 'Естественный'], ['1', 'Ровный и стабильный']], '0.5'),
      F.select('language', 'Язык', TTS_LANGS, 'auto')],
    price: { kind: 'chars', rate: T(0.10, 2) },
    build: v => {
      const p = { text: v.prompt, voice: v.voice, stability: Number(v.stability) };
      if (v.language !== 'auto') p.language_code = v.language;
      return p;
    }
  },
  {
    id: 'elevenlabs-multi', category: 'audio', name: 'ElevenLabs Multilingual v2', group: 2,
    endpoint: 'fal-ai/elevenlabs/tts/multilingual-v2', output: 'audio',
    fields: [F.prompt('Текст для озвучки', 2500, 'Введите текст, который нужно озвучить...'),
      F.select('voice', 'Голос', ELEVEN_VOICES, 'Rachel'),
      F.range('stability', 'Стабильность голоса', 0, 1, 0.1, 0.5),
      F.range('speed', 'Скорость речи', 0.7, 1.2, 0.1, 1),
      F.select('language', 'Язык', TTS_LANGS, 'auto')],
    price: { kind: 'chars', rate: T(0.10, 2) },
    build: v => {
      const p = { text: v.prompt, voice: v.voice, stability: Number(v.stability), speed: Number(v.speed) };
      if (v.language !== 'auto') p.language_code = v.language;
      return p;
    }
  },
  {
    id: 'elevenlabs-turbo', category: 'audio', name: 'ElevenLabs Turbo v2.5', group: 2,
    endpoint: 'fal-ai/elevenlabs/tts/turbo-v2.5', output: 'audio',
    fields: [F.prompt('Текст для озвучки', 2500, 'Введите текст, который нужно озвучить...'),
      F.select('voice', 'Голос', ELEVEN_VOICES, 'Rachel'),
      F.range('stability', 'Стабильность голоса', 0, 1, 0.1, 0.5),
      F.range('speed', 'Скорость речи', 0.7, 1.2, 0.1, 1),
      F.select('language', 'Язык', TTS_LANGS, 'auto')],
    price: { kind: 'chars', rate: T(0.05, 2) },
    build: v => {
      const p = { text: v.prompt, voice: v.voice, stability: Number(v.stability), speed: Number(v.speed) };
      if (v.language !== 'auto') p.language_code = v.language;
      return p;
    }
  },
  {
    id: 'elevenlabs-dialog', category: 'audio', name: 'ElevenLabs Диалог (2 голоса)', group: 2,
    endpoint: 'fal-ai/elevenlabs/text-to-dialogue/eleven-v3', output: 'audio',
    fields: [F.select('voice', 'Голос 1', ELEVEN_VOICES, 'Rachel'),
      F.select('voice2', 'Голос 2', ELEVEN_VOICES, 'Roger'),
      F.prompt('Реплики (каждая с новой строки, в начале 1: или 2:)', 2500, '1: Привет, как дела?\n2: Отлично, спасибо!'),
      F.select('stability', 'Стиль', [['0', 'Выразительный'], ['0.5', 'Естественный'], ['1', 'Ровный и стабильный']], '0.5')],
    price: { kind: 'chars', rate: T(0.10, 2) },
    build: v => {
      const inputs = [];
      let cur = v.voice;
      for (const raw of v.prompt.split('\n')) {
        let line = raw.trim();
        if (!line) continue;
        const m = line.match(/^([12])\s*[:.)]\s*(.*)$/);
        if (m) { cur = m[1] === '1' ? v.voice : v.voice2; line = m[2]; }
        if (line) inputs.push({ text: line, voice: cur });
      }
      return { inputs, stability: Number(v.stability) };
    }
  },
  {
    id: 'minimax-speech-hd', category: 'audio', name: 'MiniMax Speech 2.8 HD', group: 2,
    endpoint: 'fal-ai/minimax/speech-2.8-hd', output: 'audio',
    fields: [F.prompt('Текст для озвучки', 2500, 'Введите текст, который нужно озвучить...'),
      F.select('voice', 'Голос', MINIMAX_VOICES, 'Wise_Woman'),
      F.range('speed', 'Скорость речи', 0.5, 2, 0.1, 1),
      F.select('language', 'Язык', MM_LANGS, 'auto')],
    price: { kind: 'chars', rate: T(0.10, 2) },
    build: v => {
      const p = { prompt: v.prompt, output_format: 'url', voice_setting: { voice_id: v.voice, speed: Number(v.speed) } };
      if (v.language !== 'auto') p.language_boost = v.language;
      return p;
    }
  },
  {
    id: 'minimax-speech-turbo', category: 'audio', name: 'MiniMax Speech 2.8 Turbo', group: 2,
    endpoint: 'fal-ai/minimax/speech-2.8-turbo', output: 'audio',
    fields: [F.prompt('Текст для озвучки', 2500, 'Введите текст, который нужно озвучить...'),
      F.select('voice', 'Голос', MINIMAX_VOICES, 'Wise_Woman'),
      F.range('speed', 'Скорость речи', 0.5, 2, 0.1, 1),
      F.select('language', 'Язык', MM_LANGS, 'auto')],
    price: { kind: 'chars', rate: T(0.06, 2) },
    build: v => {
      const p = { prompt: v.prompt, output_format: 'url', voice_setting: { voice_id: v.voice, speed: Number(v.speed) } };
      if (v.language !== 'auto') p.language_boost = v.language;
      return p;
    }
  },
  {
    id: 'minimax-music', category: 'audio', name: 'MiniMax Music (песня по образцу)', group: 2,
    endpoint: 'fal-ai/minimax-music', output: 'audio',
    audioLimits: { min: 15, max: 300 },
    fields: [F.prompt('Текст песни (до 600 символов)', 600, '[Verse]\nТекст куплета...\n[Chorus]\nТекст припева...'),
      F.file('audio', 'Образец песни (mp3/wav, больше 15 сек)', 'audio', true, 2500 * 1024, 'Песня с вокалом, по ней задаётся стиль')],
    price: { kind: 'flat', tokens: I(0.03, 2) },
    build: v => ({ prompt: v.prompt, reference_audio_url: v.audio })
  }
];

// ---------- Утилиты ----------
export function getModel(id) {
  return MODELS.find(m => m.id === id) || null;
}

export function calcCost(p, v) {
  const ceil = x => Math.max(1, Math.ceil(+x.toFixed(6)));
  switch (p.kind) {
    case 'image': return p.table[v.res];
    case 'flat': return p.tokens;
    case 'second': {
      const r = p.table[v.res];
      const rate = typeof r === 'number' ? r : (v.sound ? r.on : r.off);
      return ceil(rate * v.duration);
    }
    case 'chars': return ceil(String(v.prompt || '').length / 1000 * p.rate);
    case 'audioSec': return ceil(p.rate * v.audio_seconds);
    case 'frames': return p.table[v.res][v.frames];
    default: throw new Error('Неизвестный тип цены');
  }
}

const FAL_URL = /^https:\/\/(?:[a-z0-9-]+\.)*fal\.media\/[\w./%~+-]+$/i;
const DATA_URI = { image: /^data:image\/[a-z0-9.+-]+;base64,/i, audio: /^data:(audio|video)\/[a-z0-9.+-]+;base64,/i };

// Проверяет и приводит значения формы к безопасному виду. Бросает Error с понятным текстом.
export function validateInput(model, input) {
  const src = (input && typeof input === 'object') ? input : {};
  const v = {};
  for (const f of model.fields) {
    const raw = src[f.key];
    switch (f.type) {
      case 'prompt': {
        const s = typeof raw === 'string' ? raw.trim() : '';
        if (!s && f.required) throw new Error('Введите запрос');
        if (s.length > f.max) throw new Error(`Слишком длинный текст (максимум ${f.max} символов)`);
        v[f.key] = s;
        break;
      }
      case 'select': {
        if (raw === undefined || raw === null || raw === '') { v[f.key] = String(f.default); break; }
        if (!f.options.some(o => String(o[0]) === String(raw))) throw new Error(`Недопустимое значение: ${f.label}`);
        v[f.key] = String(raw);
        break;
      }
      case 'range': {
        let n = Number(raw);
        if (raw === undefined || raw === null || raw === '' || !Number.isFinite(n)) n = f.default;
        n = Math.min(f.max, Math.max(f.min, n));
        n = f.min + Math.round((n - f.min) / f.step) * f.step;
        v[f.key] = +n.toFixed(4);
        break;
      }
      case 'checkbox': {
        v[f.key] = (raw === undefined || raw === null) ? !!f.default : (raw === true || raw === 'true');
        break;
      }
      case 'file': {
        if (!raw) {
          if (f.required) throw new Error(`Добавьте файл: ${f.label}`);
          break;
        }
        if (typeof raw === 'string' && f.accept === 'image' && raw.length < 600 && FAL_URL.test(raw)) {
          v[f.key] = raw;   // картинка, сделанная в нашем приложении (хранится на fal.media)
          break;
        }
        if (typeof raw !== 'string' || !DATA_URI[f.accept].test(raw)) throw new Error(`Неверный файл: ${f.label}`);
        if (raw.length * 0.75 > f.maxBytes * 1.05) throw new Error(`Файл слишком большой: ${f.label}`);
        v[f.key] = raw;
        break;
      }
    }
  }
  // числовые значения из select (длительность, кадры)
  for (const f of model.fields) {
    if (f.type === 'select' && (f.key === 'duration' || f.key === 'frames')) v[f.key] = Number(v[f.key]);
  }
  if (model.audioLimits || model.price.kind === 'audioSec') {
    const lim = model.audioLimits || { min: 1, max: 60 };
    const sec = Number(src.audio_seconds);
    if (!Number.isFinite(sec) || sec < lim.min) throw new Error(`Аудио слишком короткое (минимум ${lim.min} сек)`);
    if (sec > lim.max) throw new Error(`Аудио слишком длинное (максимум ${lim.max} сек)`);
    v.audio_seconds = Math.ceil(sec);
  }
  return v;
}

// Адрес и тело запроса к fal.ai
export function buildRequest(model, v) {
  const useI2V = !!(v.image && model.i2v);
  const payload = model.build(v);
  if (useI2V) {
    payload[model.i2v.field] = v.image;
    for (const k of model.i2v.omit || []) delete payload[k];
  }
  return { endpoint: useI2V ? model.i2v.endpoint : model.endpoint, payload };
}

// Что отдаём приложению (без адресов и функций)
export function publicCatalog() {
  return MODELS.map(m => ({
    id: m.id, category: m.category, name: m.name,
    fields: m.fields, price: m.price,
    audioLimits: m.audioLimits || null
  }));
}

// Достаёт ссылку на результат из ответа fal.ai
export function extractUrl(model, data) {
  if (!data || typeof data !== 'object') return null;
  if (model.output === 'image') return data.images?.[0]?.url || data.image?.url || null;
  if (model.output === 'video') return data.video?.url || null;
  if (model.output === 'audio') return data.audio?.url || data.audio_url || null;
  return null;
}
