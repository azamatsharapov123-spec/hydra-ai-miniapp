import { RESULT_URL as FAL_URL, hasKey, storageReady } from './providers.js';
import { USD_RATE, MAX_REF_SHARE, MIN_TOKEN_TJS } from './config.js';
import { checkVideoUrl } from './video.js';
// Единый каталог моделей Hydra AI Studio.
// Отсюда берут данные и приложение (через /api/models), и сервер (generate/status):
// адреса провайдеров, настройки, параметры запроса и цены в ⚡.
//
// Правило цены: ⚡ = себестоимость у провайдера / TOKEN_USD * наценка группы.
// Безлимит (поле unlim): tier 1 — пакет «Ультра», tier 2 — «Безлимит». Только самые дешёвые модели и только через Kie.
// Группа 1 — флагманы (минимальная наценка), 2 — +25%, 3 — +45%.
//
// У каждой модели есть «маршрут»: список провайдеров. Сначала идёт самый дешёвый (обычно Kie.ai),
// если он не принял задачу или не справился — следующий.
// Клиент платит одну фиксированную цену, которую видит до запуска (поле sell или цена самого дешёвого провайдера).
// Доплат при переходе на резервный сервер нет: в маршрут попадают только те серверы,
// на которых генерация не уходит в минус даже с партнёрскими 24%.
//
// Цены провайдеров сверены с их прайсами 23.10.2026 (Kie: kie.ai/pricing, fal: fal.ai/models).

// Цены подняты до уровня Neuroplace, чтобы хватало на партнёрские 20% + 20% (в худшем случае 24% выручки)
export const TOKEN_USD = 0.026;
export const GROUP_MARKUP = { 1: 1.0, 2: 1.25, 3: 1.45 };

// ⚡ за секунду / за единицу (дробное число)
const T = (usd, g) => +(usd / TOKEN_USD * GROUP_MARKUP[g]).toFixed(4);
// ⚡ за генерацию (целое, округление вверх, минимум 1)
const I = (usd, g) => Math.max(1, Math.ceil(+T(usd, g).toFixed(6)));

// ---------- Описания полей формы ----------
const ASPECT_LABELS = {
  '1:1': 'Квадрат (1:1)', '16:9': 'Горизонтальное (16:9)', '9:16': 'Вертикальное (9:16)',
  '4:3': 'Горизонтальное (4:3)', '3:4': 'Вертикальное (3:4)', '21:9': 'Ультраширокое (21:9)',
  '3:2': 'Горизонтальное (3:2)', '2:3': 'Вертикальное (2:3)', '4:5': 'Вертикальное (4:5)',
  'auto': 'Авто', 'adaptive': 'Авто'
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

const START_IMAGE = F.file('image', 'Начальный кадр (необязательно)', 'image', false, 700 * 1024,
  'Видео начнётся с этой картинки');
// Конечный кадр появляется, когда добавлен начальный
const END_IMAGE = { ...F.file('image_end', 'Конечный кадр (необязательно)', 'image', false, 700 * 1024, 'Видео закончится этой картинкой'), after: 'image' };
// Персонажи: следующее поле появляется, когда заполнено предыдущее; можно выбрать готовую карточку персонажа
const CHAR_KEYS = ['char1', 'char2', 'char3', 'char4'];
const CHARS = (n, tag) => CHAR_KEYS.slice(0, n).map((k, i) => ({
  ...F.file(k, `Персонаж ${i + 1} (необязательно)`, 'image', false, 450 * 1024,
    i === 0 ? `Фото или карточка персонажа. В запросе: ${tag(1)}` : `В запросе: ${tag(i + 1)}`),
  pick: true, ...(i ? { after: CHAR_KEYS[i - 1] } : {})
}));
const TAG_IMAGE = n => `@Image${n}`;
const TAG_ELEMENT = n => `@Element${n}`;
export const charsOf = v => CHAR_KEYS.map(k => v[k]).filter(Boolean);
// Atlas понимает ссылки на фото словами «image 1»
const atlasPrompt = p => String(p || '').replace(/@Image\s*(\d+)/gi, 'image $1');

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
  const [width, height] = SEEDREAM_SIZES[v.res === '1k' ? '2k' : v.res][v.aspect];
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
// Цена за штуку по ключу (разрешению): usd-таблица → ⚡
const unitTable = (obj, g) => {
  const out = {};
  for (const [k, usd] of Object.entries(obj)) out[k] = I(usd, g);
  return out;
};

// Фото-референсы для картинок: лицо персонажа, товар, стиль. Если добавлено хотя бы одно фото,
// запрос уходит на «edit»-адрес модели (model.ref.endpoint) с полем image_urls.
const REF_KEYS = ['ref1', 'ref2', 'ref3', 'ref4'];
const REF_FIELDS = [
  { ...F.file('ref1', 'Фото-референс 1 (необязательно)', 'image', false, 450 * 1024,
    'Человек, товар или образец стиля. В запросе пишите: «человек с фото 1», «товар с фото 2»'), pick: true },
  { ...F.file('ref2', 'Фото-референс 2 (необязательно)', 'image', false, 450 * 1024), after: 'ref1' },
  { ...F.file('ref3', 'Фото-референс 3 (необязательно)', 'image', false, 450 * 1024), after: 'ref2' },
  { ...F.file('ref4', 'Фото-референс 4 (необязательно)', 'image', false, 450 * 1024), after: 'ref3' }
];
export const refsOf = v => REF_KEYS.map(k => v[k]).filter(Boolean);

// Размеры GPT Image 2 (стороны кратны 16)
const GPT_SIZES = {
  '1:1': { width: 1024, height: 1024 }, '2:3': { width: 1024, height: 1536 }, '3:2': { width: 1536, height: 1024 },
  '9:16': { width: 1008, height: 1792 }, '16:9': { width: 1792, height: 1008 },
  '4:3': { width: 1536, height: 1152 }, '3:4': { width: 1152, height: 1536 }
};

// Remake: исходное видео (файл загружается прямо в наше хранилище или прямая ссылка) и фото персонажа
const REMAKE_VIDEO = F.file('video', 'Видео, которое переделываем', 'video', true, 100 * 1024 * 1024,
  'MP4 или MOV до 100 МБ. Человек в кадре должен быть хорошо виден: голова, плечи и тело');
const REMAKE_PHOTO = { ...F.file('char1', 'Фото персонажа', 'image', true, 450 * 1024,
  'Кем заменить человека: ваше фото или карточка персонажа. Лучше в полный рост или по пояс, лицо видно чётко'), pick: true };

const PROMPT_IMG = F.prompt('Запрос (промпт)', 2000, 'Опишите, что хотите получить...');
const PROMPT_VID = F.prompt('Запрос (промпт)', 2500, 'Опишите сцену, действие и камеру...');
const PROMPT_VID_CHARS = F.prompt('Запрос (промпт)', 2500, 'Опишите сцену. Персонажей называйте так: @Image1, @Image2 ...');

const ASP_IMG = ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '3:2', '2:3'];
const kieAspect = a => (a === 'auto' ? 'adaptive' : a);

// ---------- Маршрут Kie.ai ----------
// model: строка или функция от значений формы; build: тело запроса (поле input у Kie);
// price: цена через Kie (той же формы, что цена модели); when: условия, при которых Kie подходит.
const KIE = (model, build, price, when) => ({ provider: 'kie', kind: 'any', model, build, price, ...(when ? { when } : {}) });

// Описание условий маршрута (одинаково понимают сервер и приложение):
// in: { поле: [допустимые значения] }, max: { поле: максимум }, not: { поле: значение },
// noImage / noEnd / noChars / noRefs — без начального/конечного кадра, персонажей, фото-референсов,
// needsMedia — только когда есть кадр или персонажи.
export function matchWhen(w, v) {
  if (!w) return true;
  if (w.in) for (const [k, list] of Object.entries(w.in)) if (!list.map(String).includes(String(v[k]))) return false;
  if (w.max) for (const [k, n] of Object.entries(w.max)) if (Number(v[k]) > n) return false;
  if (w.not) for (const [k, x] of Object.entries(w.not)) if (v[k] === x) return false;
  if (w.noImage && v.image) return false;
  if (w.noEnd && v.image_end) return false;
  if (w.noChars && charsOf(v).length) return false;
  if (w.noRefs && refsOf(v).length) return false;
  if (w.needsMedia && !(v.image || charsOf(v).length)) return false;
  return true;
}

export const MODELS = [
  // ================= КАРТИНКИ =================
  {
    id: 'nanobanana-pro', category: 'image', name: 'Nano Banana Pro', group: 2,
    desc: 'Флагман Google: фотореализм, точные детали, текст на картинке', tags: ['TOP', 'Фото'],
    endpoint: 'fal-ai/nano-banana-pro', output: 'image',
    ref: { endpoint: 'fal-ai/nano-banana-pro/edit' },
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(ASP_IMG), '1:1'),
      F.select('res', 'Разрешение', [['1K', '1K Standard'], ['2K', '2K HD'], ['4K', '4K Ultra HD']], '1K'), ...REF_FIELDS],
    price: { kind: 'image', table: unitTable({ '1K': 0.15, '2K': 0.15, '4K': 0.30 }, 2) },
    alt: [KIE('nano-banana-pro',
      v => ({ prompt: v.prompt, image_input: refsOf(v), aspect_ratio: v.aspect, resolution: v.res, output_format: 'png' }),
      { kind: 'image', table: unitTable({ '1K': 0.09, '2K': 0.09, '4K': 0.12 }, 2) })],
    build: v => ({ prompt: v.prompt, aspect_ratio: v.aspect, resolution: v.res, num_images: 1, output_format: 'png' })
  },
  {
    id: 'nanobanana-2.1', category: 'image', name: 'Nano Banana 2.1', group: 2, only: 'kie',
    desc: 'Новая версия: быстрая генерация и правка фото, много пропорций', tags: ['New'],
    output: 'image',
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['auto', ...ASP_IMG]), 'auto'),
      F.select('res', 'Разрешение', [['1K', '1K Standard'], ['2K', '2K HD'], ['4K', '4K Ultra HD']], '1K'), ...REF_FIELDS],
    price: { kind: 'image', table: unitTable({ '1K': 0.02, '2K': 0.03, '4K': 0.045 }, 2) },
    unlim: { tier: 2, when: { in: { res: ['1K'] } } },
    alt: [KIE('nano-banana-2-1',
      v => ({ prompt: v.prompt, image_input: refsOf(v), aspect_ratio: v.aspect, resolution: v.res, output_format: 'png' }),
      { kind: 'image', table: unitTable({ '1K': 0.02, '2K': 0.03, '4K': 0.045 }, 2) })],
    build: () => ({})
  },
  {
    id: 'nanobanana-2', category: 'image', name: 'Nano Banana 2', group: 2,
    desc: 'Генерация и редактирование с выбором разрешения', tags: [],
    endpoint: 'fal-ai/nano-banana-2', output: 'image',
    ref: { endpoint: 'fal-ai/nano-banana-2/edit' },
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(ASP_IMG), '1:1'),
      F.select('res', 'Разрешение', [['1K', '1K Standard'], ['2K', '2K HD'], ['4K', '4K Ultra HD']], '1K'), ...REF_FIELDS],
    price: { kind: 'image', table: unitTable({ '1K': 0.08, '2K': 0.12, '4K': 0.16 }, 2) },
    alt: [KIE('nano-banana-2',
      v => ({ prompt: v.prompt, image_input: refsOf(v), aspect_ratio: v.aspect, resolution: v.res, output_format: 'png' }),
      { kind: 'image', table: unitTable({ '1K': 0.04, '2K': 0.06, '4K': 0.09 }, 2) })],
    build: v => ({ prompt: v.prompt, aspect_ratio: v.aspect, resolution: v.res, num_images: 1, output_format: 'png' })
  },
  {
    id: 'nanobanana-1', category: 'image', name: 'Nano Banana', group: 2,
    desc: 'Быстрая генерация и правка изображений', tags: ['Fast'],
    endpoint: 'fal-ai/nano-banana', output: 'image',
    ref: { endpoint: 'fal-ai/nano-banana/edit' },
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(ASP_IMG), '1:1'), ...REF_FIELDS],
    price: { kind: 'flat', tokens: I(0.0398, 2) },
    unlim: { tier: 1 },
    alt: [KIE(v => refsOf(v).length ? 'google/nano-banana-edit' : 'google/nano-banana',
      v => {
        const p = { prompt: v.prompt, output_format: 'png', image_size: v.aspect };
        if (refsOf(v).length) p.image_urls = refsOf(v);
        return p;
      },
      { kind: 'flat', tokens: I(0.02, 2) })],
    build: v => ({ prompt: v.prompt, aspect_ratio: v.aspect, num_images: 1, output_format: 'png' })
  },
  {
    id: 'seedream-5-flash', category: 'image', name: 'Seedream 5 Flash', group: 2, only: 'kie',
    desc: 'Самая быстрая и доступная генерация от ByteDance', tags: ['Fast', 'New'],
    output: 'image',
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']), '1:1'),
      F.select('res', 'Разрешение', [['1K', '1K'], ['1.5K', '1.5K'], ['2K', '2K HD']], '2K'), ...REF_FIELDS],
    price: { kind: 'flat', tokens: I(0.0162, 2) },
    unlim: { tier: 1, when: { in: { res: ['1K', '1.5K', '2K'] } } },
    alt: [KIE(v => refsOf(v).length ? 'seedream/5-flash-image-to-image' : 'seedream/5-flash-text-to-image',
      v => {
        const p = { prompt: v.prompt, aspect_ratio: v.aspect, size: v.res, output_format: 'png' };
        if (refsOf(v).length) p.image_urls = refsOf(v);
        return p;
      },
      { kind: 'flat', tokens: I(0.0162, 2) })],
    build: () => ({})
  },
  {
    id: 'seedream-5-lite', category: 'image', name: 'Seedream 5 Lite', group: 2, only: 'kie',
    desc: 'Быстрая и доступная генерация и правка', tags: [],
    output: 'image',
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']), '1:1'),
      F.select('res', 'Качество', [['basic', 'Обычное (2K)'], ['high', 'Высокое (4K)']], 'basic'), ...REF_FIELDS],
    price: { kind: 'flat', tokens: I(0.0275, 2) },
    alt: [KIE(v => refsOf(v).length ? 'seedream/5-lite-image-to-image' : 'seedream/5-lite-text-to-image',
      v => {
        const p = { prompt: v.prompt, aspect_ratio: v.aspect, quality: v.res, output_format: 'png' };
        if (refsOf(v).length) p.image_urls = refsOf(v);
        return p;
      },
      { kind: 'flat', tokens: I(0.0275, 2) })],
    build: () => ({})
  },
  {
    id: 'seedream-4.5', category: 'image', name: 'Seedream 4.5', group: 2,
    desc: 'Генерация и правка изображений с гибким качеством', tags: [],
    endpoint: 'fal-ai/bytedance/seedream/v4.5/text-to-image', output: 'image',
    ref: { endpoint: 'fal-ai/bytedance/seedream/v4.5/edit' },
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '16:9', '9:16', '4:3', '3:4']), '1:1'),
      F.select('res', 'Разрешение', [['2k', '2K HD'], ['4k', '4K Ultra HD']], '2k'), ...REF_FIELDS],
    price: { kind: 'image', table: unitTable({ '2k': 0.04, '4k': 0.04 }, 2) },
    unlim: { tier: 2, when: { in: { res: ['2k'] } } },
    alt: [KIE(v => refsOf(v).length ? 'seedream/4.5-edit' : 'seedream/4.5-text-to-image',
      v => {
        const p = { prompt: v.prompt, aspect_ratio: v.aspect, quality: v.res === '4k' ? 'high' : 'basic' };
        if (refsOf(v).length) p.image_urls = refsOf(v);
        return p;
      },
      { kind: 'image', table: unitTable({ '2k': 0.0325, '4k': 0.0325 }, 2) })],
    build: seedreamBuild
  },
  {
    id: 'seedream-5pro', category: 'image', name: 'Seedream 5 Pro', group: 2,
    desc: 'Продвинутая генерация от ByteDance', tags: [],
    endpoint: 'bytedance/seedream/v5/pro/text-to-image', output: 'image',
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '16:9', '9:16', '4:3', '3:4']), '1:1'),
      F.select('res', 'Разрешение', [['1k', '1K'], ['2k', '2K HD']], '2k'), ...REF_FIELDS],
    price: { kind: 'image', table: unitTable({ '1k': 0.135, '2k': 0.135 }, 2) },
    alt: [KIE(v => refsOf(v).length ? 'seedream/5-pro-image-to-image' : 'seedream/5-pro-text-to-image',
      v => {
        const p = { prompt: v.prompt, aspect_ratio: v.aspect, quality: v.res === '2k' ? 'high' : 'basic', output_format: 'png' };
        if (refsOf(v).length) p.image_urls = refsOf(v);
        return p;
      },
      { kind: 'image', table: unitTable({ '1k': 0.035, '2k': 0.07 }, 2) })],
    // у fal нет правки фото для этой модели: с фото-референсами работает только Kie
    build: seedreamBuild
  },
  {
    id: 'grok-imagine', category: 'image', name: 'Grok Imagine', group: 2,
    desc: 'Быстрая генерация изображений от xAI', tags: ['Fast'],
    endpoint: 'xai/grok-imagine-image', output: 'image',
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4']), '1:1')],
    price: { kind: 'flat', tokens: 2 },
    unlim: { tier: 2, when: { in: { aspect: ['1:1', '16:9', '9:16', '3:2', '2:3'] } } },
    alt: [KIE('grok-imagine/text-to-image', v => ({ prompt: v.prompt, aspect_ratio: v.aspect }),
      { kind: 'flat', tokens: I(0.02, 2) }, { in: { aspect: ['1:1', '16:9', '9:16', '3:2', '2:3'] } })],
    build: v => ({ prompt: v.prompt, aspect_ratio: v.aspect, num_images: 1, output_format: 'jpeg' })
  },
  {
    id: 'grok-imagine-2', category: 'image', name: 'Grok Imagine 2', group: 2, only: 'kie',
    desc: 'Генерация и правка изображений от xAI, новая версия', tags: ['New'],
    output: 'image',
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '16:9', '9:16', '3:2', '2:3']), '1:1'), ...REF_FIELDS],
    price: { kind: 'flat', tokens: I(0.02, 2) },
    alt: [KIE(v => refsOf(v).length ? 'grok-imagine-image-2-0/image-edit' : 'grok-imagine-image-2-0/text-to-image',
      v => {
        const p = { prompt: v.prompt, aspect_ratio: v.aspect };
        if (refsOf(v).length) p.image_urls = refsOf(v);
        return p;
      },
      { kind: 'flat', tokens: I(0.02, 2) })],
    build: () => ({})
  },
  {
    id: 'flux-2', category: 'image', name: 'FLUX 2', group: 2,
    desc: 'Детализированные картинки от Black Forest Labs', tags: [],
    endpoint: 'fal-ai/flux-2', output: 'image',
    ref: { endpoint: 'fal-ai/flux-2/edit' },
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '16:9', '9:16', '4:3', '3:4']), '1:1'), ...REF_FIELDS],
    // fal берёт $0.012 за мегапиксель результата и ещё $0.012 за каждое фото-референс (дешевле, чем Kie)
    price: { kind: 'flat', tokens: I(0.0126, 2), perRef: 1 },
    build: v => ({ prompt: v.prompt, image_size: FLUX_SIZES[v.aspect], num_images: 1, output_format: 'png' })
  },
  {
    // GPT Image 2 (модель ChatGPT). На Kie цена зависит от разрешения, на fal — от качества.
    id: 'gpt-image-2', category: 'image', name: 'GPT Image 2 (ChatGPT)', group: 2,
    desc: 'Модель ChatGPT: понимает сложные запросы и текст на картинке', tags: ['TOP'],
    endpoint: 'openai/gpt-image-2', output: 'image',
    ref: { endpoint: 'openai/gpt-image-2/edit' },
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']), '1:1'),
      F.select('res', 'Разрешение', [['1K', '1K Standard'], ['2K', '2K HD'], ['4K', '4K Ultra HD']], '1K'),
      F.check('transparent', 'Прозрачный фон (для товаров и стикеров)', false), ...REF_FIELDS],
    price: { kind: 'image', table: unitTable({ '1K': 0.09, '2K': 0.30, '4K': 0.30 }, 2) },
    alt: [
      KIE(v => refsOf(v).length ? 'gpt-image-2-image-to-image' : 'gpt-image-2-text-to-image',
        v => {
          const p = { prompt: v.prompt, aspect_ratio: v.aspect, resolution: v.res, background: v.transparent ? 'transparent' : 'auto' };
          if (refsOf(v).length) p.input_urls = refsOf(v);
          return p;
        },
        { kind: 'image', table: unitTable({ '1K': 0.03, '2K': 0.05, '4K': 0.08 }, 2) },
        // Kie понимает только эти пропорции (3:2 и 2:3 у него превращались в квадрат) — их делают Atlas и fal
        { in: { aspect: ['1:1', '16:9', '9:16', '4:3', '3:4'] } }),
      {
        // Atlas: прозрачный фон и форматы 9:16 / 16:9 — нет
        provider: 'atlas', kind: 'image',
        when: { not: { transparent: true }, in: { aspect: ['1:1', '2:3', '3:2'], res: ['1K'] } },
        model: v => refsOf(v).length ? 'openai/gpt-image-2/edit' : 'openai/gpt-image-2/text-to-image',
        build: v => {
          const p = { prompt: v.prompt, size: { '1:1': '1024x1024', '2:3': '1024x1536', '3:2': '1536x1024' }[v.aspect], quality: 'medium' };
          const refs = refsOf(v);
          if (refs.length) p.images = refs;
          return p;
        }
      }
    ],
    build: v => {
      const p = { prompt: v.prompt, image_size: GPT_SIZES[v.aspect], quality: v.res === '1K' ? 'medium' : 'high', num_images: 1, output_format: 'png' };
      if (v.transparent) p.background = 'transparent';
      return p;
    }
  },
  {
    id: 'gpt-image-2.5', category: 'image', name: 'GPT Image 2.5', group: 2, only: 'kie',
    desc: 'Новейшая модель OpenAI: режимы Flare и Sunburst', tags: ['New'],
    output: 'image',
    fields: [PROMPT_IMG,
      F.select('mode', 'Режим', [['flare', 'Flare — точность и детали'], ['sunburst', 'Sunburst — яркий стиль']], 'flare'),
      F.select('aspect', 'Соотношение сторон', A(['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']), 'auto'),
      F.select('res', 'Разрешение', [['1K', '1K Standard'], ['2K', '2K HD'], ['4K', '4K Ultra HD']], '1K'), ...REF_FIELDS],
    price: { kind: 'image', table: unitTable({ '1K': 0.03, '2K': 0.05, '4K': 0.08 }, 2) },
    alt: [KIE(v => `gpt-image-2-5-${v.mode}-${refsOf(v).length ? 'image-to-image' : 'text-to-image'}`,
      v => {
        const p = { prompt: v.prompt, aspect_ratio: v.aspect, resolution: v.res, background: 'auto' };
        if (refsOf(v).length) p.input_urls = refsOf(v);
        return p;
      },
      { kind: 'image', table: unitTable({ '1K': 0.03, '2K': 0.05, '4K': 0.08 }, 2) })],
    build: () => ({})
  },
  {
    id: 'gpt-image-1.5', category: 'image', name: 'GPT Image 1.5', group: 2, only: 'kie',
    desc: 'Генерация изображений от OpenAI', tags: [],
    output: 'image',
    fields: [PROMPT_IMG, F.select('aspect', 'Соотношение сторон', A(['1:1', '2:3', '3:2']), '1:1'),
      F.select('res', 'Качество', [['medium', 'Среднее'], ['high', 'Высокое']], 'medium'), ...REF_FIELDS],
    price: { kind: 'image', table: unitTable({ medium: 0.02, high: 0.11 }, 2) },
    alt: [KIE(v => refsOf(v).length ? 'gpt-image/1.5-image-to-image' : 'gpt-image/1.5-text-to-image',
      v => {
        const p = { prompt: v.prompt, aspect_ratio: v.aspect, quality: v.res };
        if (refsOf(v).length) p.input_urls = refsOf(v);
        return p;
      },
      { kind: 'image', table: unitTable({ medium: 0.02, high: 0.11 }, 2) })],
    build: () => ({})
  },
  {
    id: 'qwen-edit', category: 'image', name: 'Qwen Image Edit (правка фото)', group: 2,
    desc: 'Меняет фото по текстовому описанию', tags: [],
    endpoint: 'fal-ai/qwen-image-edit', output: 'image',
    fields: [F.file('image', 'Фото, которое нужно изменить', 'image', true, 700 * 1024),
      F.prompt('Что изменить', 1000, 'Например: сделай фон вечерним городом')],
    price: { kind: 'flat', tokens: I(0.03, 2) },
    alt: [KIE('qwen/image-edit', v => ({ prompt: v.prompt, image_url: v.image, image_size: 'square_hd', output_format: 'png' }),
      { kind: 'flat', tokens: I(0.025, 2) })],
    build: v => ({ prompt: v.prompt, image_url: v.image })
  },

  // ================= ВИДЕО =================
  {
    // Seedance 2.5: текст, начальный/конечный кадр или персонажи (@Image1…).
    // Маршрут выбирается по цене: только текст — Replicate (дешевле всех), с фото — Atlas или Kie, последний fal.
    id: 'seedance-2.5', category: 'video', name: 'Seedance 2.5', group: 1,
    desc: 'Лучшая модель для трендов: персонажи, кадры, звук', tags: ['TOP', 'Звук'],
    endpoint: 'bytedance/seedance-2.5/us/text-to-video', output: 'video',
    i2v: { endpoint: 'bytedance/seedance-2.5/image-to-video', field: 'image_url', end: 'end_image_url', omit: [] },
    refs: { endpoint: 'bytedance/seedance-2.5/reference-to-video', field: 'image_urls' },
    fields: [PROMPT_VID_CHARS, START_IMAGE, END_IMAGE, ...CHARS(4, TAG_IMAGE),
      F.select('aspect', 'Соотношение сторон', A(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']), '9:16'),
      F.select('res', 'Качество', [['480p', '480p'], ['720p', '720p HD'], ['1080p', '1080p Full HD']], '480p'),
      F.range('duration', 'Длительность', 4, 30, 1, 5, ' сек'),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ '480p': 0.2205, '720p': 0.473, '1080p': 1.137 }, 1) },
    // Фиксированная цена для клиента (≈ уровень Neuroplace): 480p — 5 ⚡/сек, 720p — 10, 1080p — 26
    sell: { kind: 'second', table: { '480p': 5, '720p': 10, '1080p': 26 } },
    alt: [
      {
        // Replicate: только текст (фото людей там отклоняются), 480p/720p
        provider: 'replicate', kind: 'video', model: 'bytedance/seedance-2.5',
        when: { noImage: true, noChars: true, in: { res: ['480p', '720p'] } },
        price: { kind: 'second', table: secTable({ '480p': 0.1028, '720p': 0.2312 }, 1) },
        build: v => {
          const p = { prompt: v.prompt, duration: v.duration, resolution: v.res, generate_audio: v.sound };
          if (v.aspect !== 'auto') p.aspect_ratio = v.aspect;
          return p;
        }
      },
      {
        // Atlas принимает фото реальных людей, ~$0.134/сек на 480p и 720p
        provider: 'atlas', kind: 'video', when: { in: { res: ['480p', '720p'] } },
        price: { kind: 'second', table: secTable({ '480p': 0.134, '720p': 0.134 }, 1) },
        model: v => charsOf(v).length ? 'bytedance/seedance-2.5/reference-to-video'
          : v.image ? 'bytedance/seedance-2.5/image-to-video' : 'bytedance/seedance-2.5/text-to-video',
        build: v => {
          const base = { duration: v.duration, resolution: v.res, generate_audio: v.sound, watermark: false };
          if (charsOf(v).length) return { ...base, prompt: atlasPrompt(v.prompt), reference_images: charsOf(v), ratio: kieAspect(v.aspect) };
          if (v.image) return { ...base, prompt: v.prompt, image: v.image, ...(v.image_end ? { last_image: v.image_end } : {}) };
          return { ...base, prompt: v.prompt, ratio: kieAspect(v.aspect) };
        }
      },
      KIE('bytedance/seedance-2-5', v => {
        const p = { prompt: v.prompt, generate_audio: v.sound, resolution: v.res, aspect_ratio: kieAspect(v.aspect), duration: v.duration, output_format: 'mp4' };
        if (charsOf(v).length) p.reference_image_urls = charsOf(v);
        else if (v.image) { p.first_frame_url = v.image; if (v.image_end) p.last_frame_url = v.image_end; }
        return p;
      }, { kind: 'second', table: secTable({ '480p': 0.14, '720p': 0.315, '1080p': 0.79 }, 1) })
    ],
    build: v => ({ prompt: v.prompt, resolution: v.res, duration: String(v.duration), aspect_ratio: v.aspect, generate_audio: v.sound })
  },
  {
    // Видео по фото-референсам (персонажи, одежда, места). Фото в запросе называются @Image1, @Image2 …
    // Именно эта модель используется в разделе «Тренды».
    id: 'seedance-2.5-ref', category: 'video', name: 'Seedance 2.5 по фото (персонажи)', group: 1, hidden: true,
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
    // fal за видео по фото: 480p $0.2205/сек, 720p $0.473/сек
    price: { kind: 'second', table: secTable({ '480p': 0.2205, '720p': 0.473, '1080p': 1.137 }, 1) },
    // Фиксированная цена для клиента (≈ уровень Neuroplace): 480p — 5 ⚡/сек, 720p — 10, 1080p — 26
    sell: { kind: 'second', table: { '480p': 5, '720p': 10, '1080p': 26 } },
    alt: [
      {
        provider: 'atlas', kind: 'video', model: 'bytedance/seedance-2.5/reference-to-video', when: { in: { res: ['480p', '720p'] } },
        price: { kind: 'second', table: secTable({ '480p': 0.134, '720p': 0.134 }, 1) },
        build: v => ({
          prompt: v.prompt, reference_images: [v.image1, v.image2, v.image3, v.image4].filter(Boolean),
          duration: v.duration, resolution: v.res, ratio: kieAspect(v.aspect),
          generate_audio: v.sound, watermark: false
        })
      },
      KIE('bytedance/seedance-2-5', v => ({
        prompt: v.prompt, reference_image_urls: [v.image1, v.image2, v.image3, v.image4].filter(Boolean),
        generate_audio: v.sound, resolution: v.res, aspect_ratio: kieAspect(v.aspect), duration: v.duration, output_format: 'mp4'
      }), { kind: 'second', table: secTable({ '480p': 0.14, '720p': 0.315, '1080p': 0.79 }, 1) })
    ],
    build: v => ({
      prompt: v.prompt, resolution: v.res, duration: String(v.duration), aspect_ratio: v.aspect, generate_audio: v.sound,
      image_urls: [v.image1, v.image2, v.image3, v.image4].filter(Boolean)
    })
  },
  {
    id: 'kling-4.0', category: 'video', name: 'Kling 4.0', group: 1, only: 'kie',
    desc: 'Новейший Kling: видео по персонажам и референсам', tags: ['New', 'TOP'],
    output: 'video',
    fields: [F.prompt('Запрос (промпт)', 2500, 'Опишите сцену. Фото называйте так: @image_1, @image_2 ...'), ...CHARS(4, n => `@image_${n}`),
      F.select('aspect', 'Соотношение сторон', A(['auto', '16:9', '9:16', '1:1', '21:9']), '9:16'),
      F.select('res', 'Качество', [['720p', '720p HD'], ['1080p', '1080p Full HD']], '720p'),
      F.select('duration', 'Длительность', secs([5, 10, 15]), 5)],
    price: { kind: 'second', table: secTable({ '720p': 0.1425, '1080p': 0.2125 }, 1) },
    alt: [KIE('kling-4.0/reference-to-video', v => ({
      prompt: v.prompt, duration: v.duration, resolution: v.res, aspect_ratio: v.aspect, image_urls: charsOf(v)
    }), { kind: 'second', table: secTable({ '720p': 0.1425, '1080p': 0.2125 }, 1) })],
    build: () => ({})
  },
  {
    id: 'seedance-2', category: 'video', name: 'Seedance 2.0 Pro', group: 1,
    desc: 'Продвинутая генерация Seedance 2 с референсами', tags: ['Звук'],
    endpoint: 'bytedance/seedance-2.0/text-to-video', output: 'video',
    i2v: { endpoint: 'bytedance/seedance-2.0/image-to-video', field: 'image_url', end: 'end_image_url', omit: [] },
    refs: { endpoint: 'bytedance/seedance-2.0/reference-to-video', field: 'image_urls', max: 9 },
    fields: [PROMPT_VID_CHARS, START_IMAGE, END_IMAGE, ...CHARS(4, TAG_IMAGE),
      F.select('aspect', 'Соотношение сторон', A(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']), '16:9'),
      F.select('res', 'Качество', [['480p', '480p'], ['720p', '720p HD'], ['1080p', '1080p Full HD']], '720p'),
      F.range('duration', 'Длительность', 4, 15, 1, 5, ' сек'),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ '480p': 0.3034, '720p': 0.3034, '1080p': 0.6804 }, 1) },
    alt: [KIE('bytedance/seedance-2', v => {
      const p = { prompt: v.prompt, generate_audio: v.sound, resolution: v.res, aspect_ratio: kieAspect(v.aspect), duration: v.duration };
      if (charsOf(v).length) p.reference_image_urls = charsOf(v);
      else if (v.image) { p.first_frame_url = v.image; if (v.image_end) p.last_frame_url = v.image_end; }
      return p;
    }, { kind: 'second', table: secTable({ '480p': 0.095, '720p': 0.205, '1080p': 0.51 }, 1) })],
    // fal делает только 720p: на 480p и 1080p работает Kie
    build: v => ({ prompt: v.prompt, resolution: '720p', duration: String(v.duration), aspect_ratio: v.aspect, generate_audio: v.sound })
  },
  {
    id: 'seedance-2.0-fast', category: 'video', name: 'Seedance 2.0 Fast', group: 2,
    desc: 'Быстрая версия Seedance 2.0', tags: ['Fast'],
    endpoint: 'bytedance/seedance-2.0/fast/text-to-video', output: 'video',
    i2v: { endpoint: 'bytedance/seedance-2.0/fast/image-to-video', field: 'image_url', end: 'end_image_url', omit: [] },
    refs: { endpoint: 'bytedance/seedance-2.0/fast/reference-to-video', field: 'image_urls', max: 9 },
    fields: [PROMPT_VID_CHARS, START_IMAGE, END_IMAGE, ...CHARS(4, TAG_IMAGE),
      F.select('aspect', 'Соотношение сторон', A(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']), '16:9'),
      F.select('res', 'Качество', [['480p', '480p'], ['720p', '720p HD']], '480p'),
      F.range('duration', 'Длительность', 4, 15, 1, 5, ' сек'),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ '480p': 0.1076, '720p': 0.2419 }, 2) },
    alt: [KIE('bytedance/seedance-2-fast', v => {
      const p = { prompt: v.prompt, generate_audio: v.sound, resolution: v.res, aspect_ratio: kieAspect(v.aspect), duration: v.duration };
      if (charsOf(v).length) p.reference_image_urls = charsOf(v);
      else if (v.image) { p.first_frame_url = v.image; if (v.image_end) p.last_frame_url = v.image_end; }
      return p;
    }, { kind: 'second', table: secTable({ '480p': 0.059, '720p': 0.124 }, 2) })],
    build: v => ({ prompt: v.prompt, resolution: v.res, duration: String(v.duration), aspect_ratio: v.aspect, generate_audio: v.sound })
  },
  {
    id: 'seedance-2.0-mini', category: 'video', name: 'Seedance 2.0 Mini', group: 2,
    desc: 'Самое доступное видео Seedance с референсами', tags: ['Fast'],
    endpoint: 'bytedance/seedance-2.0/mini/text-to-video', output: 'video',
    i2v: { endpoint: 'bytedance/seedance-2.0/mini/image-to-video', field: 'image_url', end: 'end_image_url', omit: [] },
    refs: { endpoint: 'bytedance/seedance-2.0/mini/reference-to-video', field: 'image_urls', max: 9 },
    fields: [PROMPT_VID_CHARS, START_IMAGE, END_IMAGE, ...CHARS(4, TAG_IMAGE),
      F.select('aspect', 'Соотношение сторон', A(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']), '9:16'),
      F.select('res', 'Качество', [['480p', '480p'], ['720p', '720p HD']], '480p'),
      F.range('duration', 'Длительность', 4, 15, 1, 5, ' сек'),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ '480p': 0.0721, '720p': 0.1547 }, 2) },
    unlim: { tier: 1, when: { in: { res: ['480p'] }, max: { duration: 5 } } },
    alt: [
      KIE('bytedance/seedance-2-mini', v => {
        const p = { prompt: v.prompt, generate_audio: v.sound, resolution: v.res, aspect_ratio: kieAspect(v.aspect), duration: v.duration };
        if (charsOf(v).length) p.reference_image_urls = charsOf(v);
        else if (v.image) { p.first_frame_url = v.image; if (v.image_end) p.last_frame_url = v.image_end; }
        return p;
      }, { kind: 'second', table: secTable({ '480p': 0.019, '720p': 0.041 }, 2) }),
      {
        provider: 'atlas', kind: 'video', when: { needsMedia: true },
        model: v => charsOf(v).length ? 'bytedance/seedance-2.0-mini/reference-to-video' : 'bytedance/seedance-2.0-mini/image-to-video',
        build: v => {
          const b = { duration: v.duration, resolution: v.res, generate_audio: v.sound };
          if (charsOf(v).length) return { ...b, prompt: atlasPrompt(v.prompt), reference_images: charsOf(v), ratio: kieAspect(v.aspect) };
          return { ...b, prompt: v.prompt, image: v.image, ...(v.image_end ? { last_image: v.image_end } : {}) };
        }
      }
    ],
    build: v => ({ prompt: v.prompt, resolution: v.res, duration: String(v.duration), aspect_ratio: v.aspect, generate_audio: v.sound })
  },
  // ---------- REMAKE: замена человека в готовом видео ----------
  // Цена — за каждую секунду исходного ролика. Длительность сервер сам читает из файла (lib/video.js).
  {
    // 24.10.2026: у Kie модель Wan Animate Replace падает с «Internal Error» даже на их собственном примере.
    // Скрыта, пока Kie не починит: чтобы включить, уберите hidden.
    id: 'remake', category: 'video', name: 'Remake: замена человека', group: 2, only: 'kie', hidden: true,
    desc: 'Загрузите любое видео и фото — нейросеть поставит вашего персонажа на место человека в ролике. Движения, фон и камера останутся как в оригинале',
    tags: ['New', 'Remake'], output: 'video',
    fields: [REMAKE_VIDEO, REMAKE_PHOTO,
      F.select('res', 'Качество', [['480p', '480p'], ['580p', '580p'], ['720p', '720p HD']], '480p')],
    videoLimits: { min: 2, max: 30 },
    price: { kind: 'videoSec', table: secTable({ '480p': 0.03, '580p': 0.0475, '720p': 0.0625 }, 2) },
    alt: [KIE('wan/2-2-animate-replace',
      v => ({ video_url: v.video, image_url: v.char1, resolution: v.res, nsfw_checker: false }),
      { kind: 'videoSec', table: secTable({ '480p': 0.03, '580p': 0.0475, '720p': 0.0625 }, 2) })],
    build: () => ({})
  },
  {
    id: 'remake-pro', category: 'video', name: 'Remake Pro: повтор движений', group: 2, only: 'kie',
    desc: 'Kling 3.0 Motion Control: персонаж с вашего фото в точности повторяет движения, танец и мимику из видео. Качество до 1080p',
    tags: ['New', 'Remake'], output: 'video',
    fields: [REMAKE_VIDEO, REMAKE_PHOTO,
      F.prompt('Что происходит (необязательно)', 1000, 'Например: девушка танцует в студии, мягкий свет', false),
      F.select('orient', 'Поворот персонажа', [['video', 'Как в видео (ролик до 30 сек)'], ['image', 'Как на фото (ролик до 10 сек)']], 'video'),
      F.select('res', 'Качество', [['720p', '720p HD'], ['1080p', '1080p Full HD']], '720p')],
    videoLimits: { min: 3, max: 30, maxBy: { key: 'orient', value: 'image', max: 10 } },
    price: { kind: 'videoSec', table: secTable({ '720p': 0.10, '1080p': 0.135 }, 2) },
    alt: [KIE('kling-3.0/motion-control',
      v => ({
        prompt: v.prompt || 'The character from the image performs exactly the same movements as the person in the video.',
        input_urls: [v.char1], video_urls: [v.video], mode: v.res, character_orientation: v.orient
      }),
      { kind: 'videoSec', table: secTable({ '720p': 0.10, '1080p': 0.135 }, 2) })],
    build: () => ({})
  },
  {
    id: 'veo-3.1', category: 'video', name: 'Veo 3.1', group: 1,
    desc: 'Кинематографичное видео от Google со звуком', tags: ['TOP', 'Звук'],
    endpoint: 'fal-ai/veo3.1', output: 'video',
    i2v: { endpoint: 'fal-ai/veo3.1/image-to-video', field: 'image_url', omit: [], endWith: { endpoint: 'fal-ai/veo3.1/first-last-frame-to-video', start: 'first_frame_url', end: 'last_frame_url' } },
    fields: [PROMPT_VID, START_IMAGE, END_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16']), '16:9'),
      F.select('res', 'Качество', [['720p', '720p HD'], ['1080p', '1080p Full HD'], ['4k', '4K Ultra HD']], '720p'),
      F.select('duration', 'Длительность', secs([4, 6, 8]), 8),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ '720p': { on: 0.40, off: 0.20 }, '1080p': { on: 0.40, off: 0.20 }, '4k': { on: 0.60, off: 0.40 } }, 1) },
    alt: [KIE('veo-3-1', v => veoKie(v, 'veo3'), { kind: 'image', table: unitTable({ '720p': 1.25, '1080p': 1.275, '4k': 1.85 }, 1) })],
    build: v => ({ prompt: v.prompt, aspect_ratio: v.aspect, duration: `${v.duration}s`, resolution: v.res, generate_audio: v.sound })
  },
  {
    id: 'veo-3-fast', category: 'video', name: 'Veo 3.1 Fast', group: 1,
    desc: 'Быстрое видео Google со звуком', tags: ['Fast', 'Звук'],
    endpoint: 'fal-ai/veo3.1/fast', output: 'video',
    i2v: { endpoint: 'fal-ai/veo3.1/fast/image-to-video', field: 'image_url', omit: [], endWith: { endpoint: 'fal-ai/veo3.1/fast/first-last-frame-to-video', start: 'first_frame_url', end: 'last_frame_url' } },
    fields: [PROMPT_VID, START_IMAGE, END_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16']), '16:9'),
      F.select('res', 'Качество', [['720p', '720p HD'], ['1080p', '1080p Full HD'], ['4k', '4K Ultra HD']], '720p'),
      F.select('duration', 'Длительность', secs([4, 6, 8]), 8),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ '720p': { on: 0.15, off: 0.10 }, '1080p': { on: 0.15, off: 0.10 }, '4k': { on: 0.35, off: 0.30 } }, 1) },
    alt: [KIE('veo-3-1', v => veoKie(v, 'veo3_fast'), { kind: 'image', table: unitTable({ '720p': 0.30, '1080p': 0.325, '4k': 0.90 }, 1) })],
    build: v => ({ prompt: v.prompt, aspect_ratio: v.aspect, duration: `${v.duration}s`, resolution: v.res, generate_audio: v.sound })
  },
  {
    id: 'veo-3.1-lite', category: 'video', name: 'Veo 3.1 Lite', group: 1, only: 'kie',
    desc: 'Самый доступный Veo от Google со звуком', tags: ['New', 'Звук'],
    output: 'video',
    fields: [PROMPT_VID, START_IMAGE, END_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16']), '9:16'),
      F.select('res', 'Качество', [['720p', '720p HD'], ['1080p', '1080p Full HD'], ['4k', '4K Ultra HD']], '720p'),
      F.select('duration', 'Длительность', secs([4, 6, 8]), 8)],
    price: { kind: 'image', table: unitTable({ '720p': 0.15, '1080p': 0.175, '4k': 0.75 }, 1) },
    alt: [KIE('veo-3-1', v => veoKie(v, 'veo3_lite'), { kind: 'image', table: unitTable({ '720p': 0.15, '1080p': 0.175, '4k': 0.75 }, 1) })],
    build: () => ({})
  },
  {
    id: 'kling-3.0', category: 'video', name: 'Kling 3.0', group: 1,
    desc: 'Флагман Kling: персонажи-элементы, кадры, звук', tags: ['TOP'],
    endpoint: 'fal-ai/kling-video/v3/pro/text-to-video', output: 'video',
    i2v: { endpoint: 'fal-ai/kling-video/v3/pro/image-to-video', field: 'start_image_url', end: 'end_image_url', omit: ['aspect_ratio'] },
    // персонажи в Kling 3.0 — это «elements», они работают вместе с начальным кадром
    refs: { combine: true, field: 'elements', max: 3, wrap: list => list.map(u => ({ frontal_image_url: u, reference_image_urls: [u] })) },
    fields: [F.prompt('Запрос (промпт)', 2500, 'Опишите сцену. Персонажей называйте так: @Element1, @Element2 ...'), START_IMAGE, END_IMAGE, ...CHARS(3, TAG_ELEMENT),
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16', '1:1']), '16:9'),
      F.select('res', 'Режим', [['std', 'Standard 720p'], ['pro', 'Pro 1080p'], ['4K', '4K']], 'std'),
      F.range('duration', 'Длительность', 3, 15, 1, 5, ' сек'),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ std: { on: 0.168, off: 0.112 }, pro: { on: 0.168, off: 0.112 }, '4K': { on: 0.42, off: 0.42 } }, 1) },
    alt: [KIE('kling-3.0/video', v => {
      const p = { prompt: v.prompt, sound: v.sound, duration: String(v.duration), aspect_ratio: v.aspect, mode: v.res, multi_shots: false };
      if (v.image) p.image_urls = v.image_end ? [v.image, v.image_end] : [v.image];
      return p;
    }, { kind: 'second', table: secTable({ std: { on: 0.10, off: 0.07 }, pro: { on: 0.135, off: 0.09 }, '4K': { on: 0.335, off: 0.335 } }, 1) }, { noChars: true })],
    build: v => ({ prompt: v.prompt, duration: String(v.duration), aspect_ratio: v.aspect, generate_audio: v.sound })
  },
  {
    id: 'kling-3.0-turbo', category: 'video', name: 'Kling 3.0 Turbo', group: 2,
    desc: 'Быстрая генерация Kling 3.0', tags: ['Fast'],
    only: ['atlas', 'kie'], output: 'video',
    fields: [F.prompt('Запрос (промпт)', 2500, 'Опишите сцену, действие и камеру...'), START_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16', '1:1']), '9:16'),
      F.select('res', 'Качество', [['720p', '720p HD'], ['1080p', '1080p Full HD']], '1080p'),
      F.range('duration', 'Длительность', 3, 15, 1, 5, ' сек')],
    price: { kind: 'second', table: secTable({ '720p': 0.1125, '1080p': 0.1125 }, 2) },
    alt: [
      KIE(v => v.image ? 'kling/v3-turbo-image-to-video' : 'kling/v3-turbo-text-to-video', v => {
        const p = { prompt: v.prompt, duration: String(v.duration), resolution: v.res };
        if (v.image) p.image_urls = [v.image]; else p.aspect_ratio = v.aspect;
        return p;
      }, { kind: 'second', table: secTable({ '720p': 0.09, '1080p': 0.1125 }, 2) }),
      {
        provider: 'atlas', kind: 'video', model: 'kwaivgi/kling-v3.0-turbo/text-to-video', when: { noImage: true },
        price: { kind: 'second', table: secTable({ '720p': 0.095, '1080p': 0.095 }, 2) },
        build: v => ({ prompt: v.prompt, duration: v.duration, aspect_ratio: v.aspect, resolution: v.res })
      }
    ],
    build: () => ({})
  },
  {
    id: 'kling-o3', category: 'video', name: 'Kling O3', group: 2,
    desc: 'Kling Omni: умная раскадровка и звук', tags: [],
    endpoint: 'fal-ai/kling-video/o3/pro/text-to-video', output: 'video',
    i2v: { endpoint: 'fal-ai/kling-video/o3/pro/image-to-video', field: 'image_url', end: 'end_image_url', omit: ['aspect_ratio'] },
    fields: [PROMPT_VID, START_IMAGE, END_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16', '1:1']), '16:9'),
      F.select('res', 'Качество', [['720p', '720p HD'], ['1080p', '1080p Full HD'], ['4k', '4K']], '720p'),
      F.range('duration', 'Длительность', 3, 15, 1, 5, ' сек'),
      F.check('sound', 'Со звуком', false),
      F.check('multishot', 'Умная раскадровка (несколько ракурсов)', false)],
    price: { kind: 'second', table: secTable({ '720p': 0.14, '1080p': 0.14, '4k': 0.42 }, 2) },
    alt: [KIE(v => v.image ? 'kling-3.0-omni/image-to-video' : 'kling-3.0-omni/text-to-video', v => {
      const p = { prompt: v.prompt, duration: v.duration, resolution: v.res, aspect_ratio: v.image ? 'auto' : v.aspect, audio: v.sound, prefer_multi_shots: v.multishot };
      if (v.image) p.image_urls = v.image_end ? [v.image, v.image_end] : [v.image];
      return p;
    }, { kind: 'second', table: secTable({ '720p': { on: 0.09, off: 0.07 }, '1080p': { on: 0.115, off: 0.09 }, '4k': { on: 0.335, off: 0.335 } }, 2) })],
    build: v => ({ prompt: v.prompt, duration: String(v.duration), aspect_ratio: v.aspect })
  },
  {
    id: 'kling-2.6', category: 'video', name: 'Kling 2.6', group: 2,
    desc: 'Генерация видео Kling с опциональным звуком', tags: ['Звук'],
    endpoint: 'fal-ai/kling-video/v2.6/pro/text-to-video', output: 'video',
    i2v: { endpoint: 'fal-ai/kling-video/v2.6/pro/image-to-video', field: 'image_url', alsoField: 'start_image_url', end: 'end_image_url', omit: ['aspect_ratio'] },
    fields: [PROMPT_VID, START_IMAGE, END_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16', '1:1']), '16:9'),
      F.select('res', 'Качество', [['pro', 'Pro']], 'pro'),
      F.select('duration', 'Длительность', secs([5, 10]), 5),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ pro: { on: 0.14, off: 0.07 } }, 2) },
    alt: [KIE(v => v.image ? 'kling-2.6/image-to-video' : 'kling-2.6/text-to-video', v => {
      const p = { prompt: v.prompt, sound: v.sound, duration: String(v.duration) };
      if (v.image) p.image_urls = [v.image]; else p.aspect_ratio = v.aspect;
      return p;
    }, { kind: 'second', table: secTable({ pro: { on: 0.11, off: 0.055 } }, 2) }, { noEnd: true })],
    build: v => ({ prompt: v.prompt, duration: String(v.duration), aspect_ratio: v.aspect, generate_audio: v.sound })
  },
  {
    id: 'kling-turbo-2.5', category: 'video', name: 'Kling Turbo 2.5', group: 2,
    desc: 'Быстрое видео Kling по тексту или кадрам', tags: ['Fast'],
    endpoint: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', output: 'video',
    i2v: { endpoint: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', field: 'image_url', omit: ['aspect_ratio'] },
    fields: [PROMPT_VID, START_IMAGE, END_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16', '1:1']), '16:9'),
      F.select('res', 'Качество', [['pro', 'Pro']], 'pro'),
      F.select('duration', 'Длительность', secs([5, 10]), 5)],
    price: { kind: 'second', table: secTable({ pro: 0.07 }, 2) },
    alt: [KIE(v => v.image ? 'kling/v2-5-turbo-image-to-video-pro' : 'kling/v2-5-turbo-text-to-video-pro', v => {
      const p = { prompt: v.prompt, duration: String(v.duration), cfg_scale: 0.5 };
      if (v.image) { p.image_url = v.image; if (v.image_end) p.tail_image_url = v.image_end; } else p.aspect_ratio = v.aspect;
      return p;
    }, { kind: 'second', table: secTable({ pro: 0.042 }, 2) })],
    build: v => ({ prompt: v.prompt, duration: String(v.duration), aspect_ratio: v.aspect })
  },
  {
    id: 'gemini-omni-1.1', category: 'video', name: 'Gemini Omni 1.1 Flash', group: 2,
    desc: 'Видео Google с кадрами и референсами, до 4K', tags: ['New'],
    endpoint: 'google/gemini-omni-flash/v1.1/text-to-video', output: 'video',
    fields: [PROMPT_VID, START_IMAGE, END_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['16:9', '9:16']), '9:16'),
      F.select('res', 'Качество', [['360p', '360p'], ['720p', '720p HD'], ['1080p', '1080p Full HD'], ['4k', '4K Ultra HD']], '720p'),
      F.select('duration', 'Длительность', secs([4, 6, 8, 10]), 4)],
    price: { kind: 'second', table: secTable({ '360p': 0.03, '720p': 0.10, '1080p': 0.15, '4k': 0.30 }, 2) },
    alt: [KIE('google/gemini-omni-flash-1-1', v => {
      const p = { prompt: v.prompt, duration: String(v.duration), aspect_ratio: v.aspect, resolution: v.res };
      if (v.image) { p.first_frame_url = v.image; if (v.image_end) p.last_frame_url = v.image_end; }
      return p;
    }, {
      kind: 'grid', a: 'res', b: 'duration', table: (() => {
        const std = { 4: I(0.315, 2), 6: I(0.42, 2), 8: I(0.525, 2), 10: I(0.63, 2) };
        return { '360p': std, '720p': std, '1080p': std, '4k': { 4: I(0.735, 2), 6: I(0.84, 2), 8: I(0.945, 2), 10: I(1.05, 2) } };
      })()
    })],
    // на fal кадры не поддерживаются: с кадрами работает только Kie
    build: v => ({ prompt: v.prompt, aspect_ratio: v.aspect, resolution: v.res, duration: v.duration })
  },
  {
    id: 'wan-3.0', category: 'video', name: 'Wan 3.0', group: 2,
    desc: 'Видео Alibaba по тексту и кадрам, со звуком', tags: ['Звук'],
    endpoint: 'alibaba/wan-3.0/text-to-video', output: 'video',
    i2v: { endpoint: 'alibaba/wan-3.0/image-to-video', field: 'image_url', omit: ['aspect_ratio'] },
    fields: [PROMPT_VID, START_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4']), '9:16'),
      F.select('res', 'Качество', [['480p', '480p'], ['720p', '720p HD'], ['1080p', '1080p Full HD']], '720p'),
      F.range('duration', 'Длительность', 3, 15, 1, 5, ' сек'),
      F.check('sound', 'Со звуком', true)],
    price: { kind: 'second', table: secTable({ '480p': 0.05, '720p': 0.10, '1080p': 0.20 }, 2) },
    alt: [KIE('wan/3-0-video', v => {
      const p = { prompt: v.prompt, resolution: v.res.toUpperCase(), aspect_ratio: v.aspect, duration: v.duration, audio: v.sound };
      if (v.image) p.first_frame_url = v.image;
      return p;
    }, { kind: 'second', table: secTable({ '480p': 0.04, '720p': 0.08, '1080p': 0.16 }, 2) })],
    build: v => ({ prompt: v.prompt, resolution: v.res, aspect_ratio: v.aspect, duration: v.duration })
  },
  {
    id: 'hailuo-02', category: 'video', name: 'Hailuo 02', group: 2,
    desc: 'Реалистичное видео MiniMax Hailuo', tags: [],
    endpoint: 'fal-ai/minimax/hailuo-02/standard/text-to-video', output: 'video',
    i2v: { endpoint: 'fal-ai/minimax/hailuo-02/standard/image-to-video', field: 'image_url', omit: [] },
    fields: [PROMPT_VID, START_IMAGE,
      F.select('res', 'Качество', [['768p', '768p HD']], '768p'),
      F.select('duration', 'Длительность', secs([6, 10]), 6),
      F.check('optimize', 'Улучшить запрос автоматически', true)],
    price: { kind: 'second', table: secTable({ '768p': 0.045 }, 2) },
    alt: [KIE(v => v.image ? 'hailuo/02-image-to-video-standard' : 'hailuo/02-text-to-video-standard', v => {
      const p = { prompt: v.prompt, duration: String(v.duration), prompt_optimizer: v.optimize };
      if (v.image) { p.image_url = v.image; p.resolution = '768P'; }
      return p;
    }, { kind: 'second', table: secTable({ '768p': 0.025 }, 2) })],
    build: v => ({ prompt: v.prompt, duration: String(v.duration), prompt_optimizer: v.optimize })
  },
  {
    id: 'sora-2', category: 'video', name: 'Sora 2', group: 2,
    desc: 'Генерация видео Sora 2 от OpenAI', tags: [],
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
    desc: 'Продвинутая генерация Sora 2 Pro от OpenAI', tags: [],
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
    desc: 'Быстрое видео xAI со звуком', tags: ['Fast'],
    endpoint: 'xai/grok-imagine-video/text-to-video', output: 'video',
    i2v: { endpoint: 'xai/grok-imagine-video/image-to-video', field: 'image_url', omit: ['aspect_ratio'] },
    fields: [PROMPT_VID, START_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['9:16', '16:9', '1:1', '3:2', '2:3']), '9:16'),
      F.select('res', 'Качество', [['480p', '480p'], ['720p', '720p HD'], ['1080p', '1080p Full HD']], '480p'),
      F.select('mode', 'Стиль', [['normal', 'Обычный'], ['fun', 'Весёлый']], 'normal'),
      F.range('duration', 'Длительность', 3, 10, 1, 6, ' сек')],
    price: { kind: 'second', table: secTable({ '480p': 0.05, '720p': 0.05, '1080p': 0.05 }, 2) },
    unlim: { tier: 2, when: { in: { res: ['480p'] }, max: { duration: 6 } } },
    alt: [KIE(v => v.image ? 'grok-imagine/image-to-video' : 'grok-imagine/text-to-video', v => {
      const p = { prompt: v.prompt, mode: v.mode, duration: v.image ? String(v.duration) : v.duration, resolution: v.res, aspect_ratio: v.aspect };
      if (v.image) p.image_urls = [v.image];
      return p;
    }, { kind: 'second', table: secTable({ '480p': 0.012, '720p': 0.0225, '1080p': 0.04 }, 2) })],
    // на fal 1080p нет: там уходим на 720p
    build: v => ({ prompt: v.prompt, duration: v.duration, resolution: v.res === '1080p' ? '720p' : v.res, aspect_ratio: v.aspect })
  },
  {
    id: 'grok-video-1.5', category: 'video', name: 'Grok Imagine Video 1.5', group: 2, only: 'kie',
    desc: 'Новая версия видео xAI с синхронным звуком', tags: ['New'],
    output: 'video',
    fields: [PROMPT_VID, START_IMAGE,
      F.select('aspect', 'Соотношение сторон', A(['auto', '9:16', '16:9', '1:1', '3:2', '2:3']), 'auto'),
      F.select('res', 'Качество', [['480p', '480p'], ['720p', '720p HD']], '480p'),
      F.range('duration', 'Длительность', 3, 15, 1, 8, ' сек')],
    price: { kind: 'second', table: secTable({ '480p': 0.012, '720p': 0.0225 }, 2) },
    alt: [KIE('grok-imagine-video-1-5-preview', v => {
      const p = { prompt: v.prompt, aspect_ratio: v.aspect, resolution: v.res, duration: v.duration };
      if (v.image) p.image_urls = [v.image];
      return p;
    }, { kind: 'second', table: secTable({ '480p': 0.012, '720p': 0.0225 }, 2) })],
    build: () => ({})
  },

  // ================= АВАТАРЫ =================
  {
    id: 'kling-avatar-std', category: 'avatar', name: 'Kling Avatar v2 Standard', group: 2,
    desc: 'Оживляет фото: персонаж говорит вашим аудио', tags: [],
    endpoint: 'fal-ai/kling-video/ai-avatar/v2/standard', output: 'video',
    audioLimits: { min: 1, max: 30 },
    fields: [F.file('image', 'Фото персонажа (лицо хорошо видно)', 'image', true, 700 * 1024),
      F.file('audio', 'Аудио с речью (до 30 сек)', 'audio', true, 2200 * 1024, 'mp3, wav, m4a'),
      F.prompt('Описание сцены (необязательно)', 500, 'Например: говорит спокойно, улыбается', false)],
    price: { kind: 'audioSec', rate: T(0.0562, 2) },
    alt: [KIE('kling/ai-avatar-standard', v => ({ image_url: v.image, audio_url: v.audio, prompt: v.prompt || '.' }),
      { kind: 'audioSec', rate: T(0.04, 2) })],
    build: v => ({ image_url: v.image, audio_url: v.audio, prompt: v.prompt || '.' })
  },
  {
    id: 'kling-avatar-pro', category: 'avatar', name: 'Kling Avatar v2 Pro', group: 2,
    desc: 'Аватар в 1080p с точной мимикой', tags: [],
    endpoint: 'fal-ai/kling-video/ai-avatar/v2/pro', output: 'video',
    audioLimits: { min: 1, max: 30 },
    fields: [F.file('image', 'Фото персонажа (лицо хорошо видно)', 'image', true, 700 * 1024),
      F.file('audio', 'Аудио с речью (до 30 сек)', 'audio', true, 2200 * 1024, 'mp3, wav, m4a'),
      F.prompt('Описание сцены (необязательно)', 500, 'Например: говорит спокойно, улыбается', false)],
    price: { kind: 'audioSec', rate: T(0.115, 2) },
    alt: [KIE('kling/ai-avatar-pro', v => ({ image_url: v.image, audio_url: v.audio, prompt: v.prompt || '.' }),
      { kind: 'audioSec', rate: T(0.08, 2) })],
    build: v => ({ image_url: v.image, audio_url: v.audio, prompt: v.prompt || '.' })
  },
  {
    id: 'omnihuman-2', category: 'avatar', name: 'OmniHuman 2.0', group: 2, only: 'kie',
    desc: 'Живой аватар ByteDance: жесты и мимика по аудио', tags: ['New'],
    output: 'video',
    audioLimits: { min: 1, max: 30 },
    fields: [F.file('image', 'Фото персонажа (лицо хорошо видно)', 'image', true, 700 * 1024),
      F.file('audio', 'Аудио с речью (до 30 сек)', 'audio', true, 2200 * 1024, 'mp3, wav, m4a'),
      F.prompt('Описание сцены (необязательно)', 500, 'Например: жестикулирует, говорит уверенно', false)],
    price: { kind: 'audioSec', rate: T(0.07, 2) },
    alt: [KIE('omnihuman-2-0', v => ({ image_urls: [v.image], audio_url: v.audio, prompt: v.prompt || '', enable_watermark: false }),
      { kind: 'audioSec', rate: T(0.07, 2) })],
    build: () => ({})
  },
  {
    id: 'multi-talk', category: 'avatar', name: 'MultiTalk (диалог двух героев)', group: 2,
    desc: 'Два персонажа на одном фото разговаривают', tags: [],
    endpoint: 'fal-ai/ai-avatar/multi', output: 'video',
    fields: [F.file('image', 'Фото (один или два человека)', 'image', true, 700 * 1024),
      F.file('audio', 'Голос героя 1', 'audio', true, 1200 * 1024, 'mp3, wav, m4a'),
      F.file('audio2', 'Голос героя 2 (необязательно)', 'audio', false, 1200 * 1024, 'mp3, wav, m4a'),
      F.prompt('Описание сцены', 500, 'Например: двое разговаривают в кафе'),
      F.select('res', 'Качество', [['480p', '480p'], ['720p', '720p HD']], '480p'),
      F.select('frames', 'Длина ролика', [[81, 'короткий'], [129, 'длиннее']], 81)],
    // Цена за ролик целиком (fal.ai считает по кадрам: 81 кадр — базовая цена, больше — ×1.25; 720p — ×2).
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
    id: 'suno-v6', category: 'audio', name: 'Suno V6 (песня)', group: 2, only: 'kie',
    desc: 'Готовая песня с вокалом по описанию или вашему тексту', tags: ['New', 'Музыка'],
    output: 'audio',
    fields: [
      F.select('mode', 'Режим', [['auto', 'Авто: песня по описанию'], ['custom', 'Свой текст песни']], 'auto'),
      F.prompt('Описание или текст песни', 3000, 'Авто: «весёлая песня про Душанбе, поп». Свой текст: куплеты и припев'),
      { key: 'style', type: 'text', label: 'Стиль (для своего текста, необязательно)', max: 200, placeholder: 'Например: pop, female vocal, upbeat' },
      F.select('voice', 'Голос', [['f', 'Женский'], ['m', 'Мужской']], 'f'),
      F.check('instrumental', 'Без слов (только музыка)', false)],
    price: { kind: 'flat', tokens: I(0.06, 2) },
    alt: [KIE('ai-music-api/generate', v => {
      const custom = v.mode === 'custom';
      const p = { model: 'V6', custom_mode: custom, instrumental: v.instrumental, prompt: v.prompt, vocal_gender: v.voice };
      if (custom) { p.style = v.style || 'pop'; p.title = 'Hydra'; }
      return p;
    }, { kind: 'flat', tokens: I(0.06, 2) })],
    build: () => ({})
  },
  {
    id: 'elevenlabs-v3', category: 'audio', name: 'ElevenLabs v3 (озвучка текста)', group: 2,
    desc: 'Реалистичная озвучка текста, версия v3', tags: [],
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
    desc: 'Многоязычная озвучка с настройкой скорости', tags: [],
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
    desc: 'Быстрая и недорогая озвучка', tags: ['Fast'],
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
    desc: 'Озвучка диалога двумя голосами', tags: [],
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
    desc: 'Озвучка студийного качества', tags: [],
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
    desc: 'Быстрая озвучка MiniMax', tags: ['Fast'],
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
    desc: 'Песня в стиле вашего образца', tags: ['Музыка'],
    endpoint: 'fal-ai/minimax-music', output: 'audio',
    audioLimits: { min: 15, max: 300 },
    fields: [F.prompt('Текст песни (до 600 символов)', 600, '[Verse]\nТекст куплета...\n[Chorus]\nТекст припева...'),
      F.file('audio', 'Образец песни (mp3/wav, больше 15 сек)', 'audio', true, 2500 * 1024, 'Песня с вокалом, по ней задаётся стиль')],
    price: { kind: 'flat', tokens: I(0.03, 2) },
    build: v => ({ prompt: v.prompt, reference_audio_url: v.audio })
  }
];

// Veo 3.1 через Kie: один адрес, уровень (Quality / Fast / Lite) задаётся полем input.model
function veoKie(v, tier) {
  const p = { prompt: v.prompt, model: tier, aspect_ratio: v.aspect, resolution: v.res, duration: Number(v.duration) };
  if (v.image) {
    p.generation_type = 'FIRST_AND_LAST_FRAMES_2_VIDEO';
    p.image_urls = v.image_end ? [v.image, v.image_end] : [v.image];
  } else {
    p.generation_type = 'TEXT_2_VIDEO';
  }
  return p;
}

// ---------- Утилиты ----------
const onlyList = m => (m.only ? (Array.isArray(m.only) ? m.only : [m.only]) : null);

export const modelAvailable = m => {
  const only = onlyList(m);
  return !only || only.some(p => hasKey(p));
};

export function getModel(id) {
  const m = MODELS.find(x => x.id === id);
  return m && modelAvailable(m) ? m : null;
}

export function calcCost(p, v) {
  const base = baseCost(p, v);
  return p.perRef ? base + p.perRef * refsOf(v).length : base;
}

function baseCost(p, v) {
  const ceil = x => Math.max(1, Math.ceil(+x.toFixed(6)));
  switch (p.kind) {
    case 'image': return p.table[v.res];
    case 'flat': return p.tokens;
    case 'second': {
      const r = p.table[v.res];
      if (r === undefined) return undefined;
      const rate = typeof r === 'number' ? r : (v.sound ? r.on : r.off);
      return ceil(rate * v.duration);
    }
    case 'chars': return ceil(String(v.prompt || '').length / 1000 * p.rate);
    case 'audioSec': return ceil(p.rate * v.audio_seconds);
    case 'videoSec': {
      const r = p.table[v.res];
      if (r === undefined || !v.video_seconds) return undefined;
      return ceil(r * v.video_seconds);
    }
    case 'frames': return p.table[v.res][v.frames];
    case 'grid': return p.table[v[p.a]] ? p.table[v[p.a]][v[p.b]] : undefined;
    default: throw new Error('Неизвестный тип цены');
  }
}

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
      case 'text': {
        const s = typeof raw === 'string' ? raw.trim().slice(0, f.max) : '';
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
        if (f.accept === 'video') {
          v[f.key] = checkVideoUrl(raw);   // видео приходит только ссылкой (файл загружен в наше хранилище)
          break;
        }
        if (typeof raw === 'string' && f.accept === 'image' && raw.length < 600 && FAL_URL.test(raw)) {
          v[f.key] = raw;   // картинка, сделанная в нашем приложении (хранится у нас или у провайдера)
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
  if (model.videoLimits) {
    const lim = model.videoLimits;
    const sec = Number(src.video_seconds);
    const max = lim.maxBy && v[lim.maxBy.key] === lim.maxBy.value ? lim.maxBy.max : lim.max;
    if (!Number.isFinite(sec) || sec <= 0) throw new Error('Не удалось определить длительность видео');
    if (sec < lim.min) throw new Error(`Видео слишком короткое (минимум ${lim.min} сек)`);
    if (sec > max + 0.5) throw new Error(`Видео слишком длинное: максимум ${max} сек. Обрежьте ролик и загрузите снова`);
    v.video_seconds = Math.max(1, Math.ceil(sec - 0.1));
  }
  checkMedia(model, v);
  return v;
}

// Адрес и тело запроса к fal.ai
export function buildRequest(model, v) {
  const refs = model.ref ? refsOf(v) : [];
  if (refs.length) {
    const payload = model.build(v);
    payload.image_urls = refs;
    for (const k of model.ref.omit || []) delete payload[k];
    return { endpoint: model.ref.endpoint, payload };
  }
  const chars = model.refs ? charsOf(v) : [];
  if (chars.length && !model.refs.combine) {
    const payload = model.build(v);
    payload[model.refs.field] = model.refs.wrap ? model.refs.wrap(chars) : chars;
    for (const k of model.refs.omit || []) delete payload[k];
    return { endpoint: model.refs.endpoint, payload };
  }
  const useI2V = !!(v.image && model.i2v);
  const payload = model.build(v);
  let endpoint = model.endpoint;
  if (useI2V) {
    const i = model.i2v;
    for (const k of i.omit || []) delete payload[k];
    if (v.image_end && i.endWith) {
      endpoint = i.endWith.endpoint;
      payload[i.endWith.start] = v.image;
      payload[i.endWith.end] = v.image_end;
    } else {
      endpoint = i.endpoint;
      payload[i.field] = v.image;
      if (i.alsoField) payload[i.alsoField] = v.image;
      if (v.image_end && i.end) payload[i.end] = v.image_end;
    }
    if (chars.length && model.refs && model.refs.combine) {
      payload[model.refs.field] = model.refs.wrap ? model.refs.wrap(chars) : chars;
    }
  }
  return { endpoint, payload };
}

// Совместимость фото в одном запросе. Бросает понятную ошибку до списания ⚡.
export function checkMedia(model, v) {
  const chars = charsOf(v);
  if (v.image_end && !v.image) throw new Error('Конечный кадр работает вместе с начальным: добавьте начальный кадр');
  if (chars.length && model.refs) {
    if (model.refs.combine && !v.image) throw new Error('Персонажи в этой модели работают вместе с начальным кадром: добавьте его');
    if (!model.refs.combine && (v.image || v.image_end)) throw new Error('Персонажей нельзя совмещать с начальным и конечным кадром. Оставьте что-то одно: кадры или персонажей');
    if (model.refs.max && chars.length > model.refs.max) throw new Error(`Не больше ${model.refs.max} персонажей`);
  }
  if (model.id === 'kling-4.0' && !chars.length) throw new Error('Добавьте хотя бы одного персонажа или фото-референс');
}

// fal умеет не всё, что умеет Kie: такие сочетания идут только через Kie
const FAL_LIMITS = {
  'seedream-5pro': { noRefs: true },
  'gemini-omni-1.1': { noImage: true },
  'seedance-2': { in: { res: ['480p', '720p'] } },
  'grok-video': { in: { res: ['480p', '720p'] } },
  'kling-o3': { in: { res: ['720p', '1080p'] } },
  'kling-3.0': { in: { res: ['std', 'pro'] } }
};
function falSupports(model, v) {
  if (model.only) return false;
  return matchWhen(FAL_LIMITS[model.id], v);
}

// Провайдер участвует в маршруте, если есть ключ и (для Replicate) подключено своё хранилище
const routeReady = p => hasKey(p) && !(p === 'replicate' && !storageReady());

// Себестоимость шага маршрута в долларах (оценка сверху: цена шага в ⚡ округлена вверх)
const routeUsd = (model, tokens) => tokens * TOKEN_USD / GROUP_MARKUP[model.group];
// Сколько долларов можно потратить на генерацию за charge ⚡, чтобы не уйти в минус
const budgetUsd = charge => charge * MIN_TOKEN_TJS / USD_RATE * (1 - MAX_REF_SHARE);

// Все подходящие провайдеры (без проверки бюджета), отсортированные по цене
function rawRoutes(model, v) {
  const out = [];
  for (const a of model.alt || []) {
    if (!routeReady(a.provider)) continue;
    if (!matchWhen(a.when, v)) continue;
    const cost = calcCost(a.price || model.price, v);
    if (!Number.isFinite(cost) || cost < 1) continue;
    out.push({ provider: a.provider, kind: a.kind, model: typeof a.model === 'function' ? a.model(v) : a.model, payload: a.build(v), cost });
  }
  if (falSupports(model, v) && hasKey('fal')) {
    const cost = calcCost(model.price, v);
    if (Number.isFinite(cost) && cost >= 1) {
      const { endpoint, payload } = buildRequest(model, v);
      out.push({ provider: 'fal', endpoint, payload, cost });
    }
  }
  // устойчивая сортировка: при равной цене сохраняется порядок из каталога (fal остаётся последним)
  return out.map((r, i) => ({ r, i })).sort((a, b) => a.r.cost - b.r.cost || a.i - b.i).map(x => x.r);
}

// Цена для клиента и маршрут. charge — сколько ⚡ спишется (и больше не изменится),
// routes — серверы по порядку, на которых эта генерация окупается.
export function quote(model, v) {
  const all = rawRoutes(model, v);
  if (!all.length) return { charge: undefined, routes: [] };
  const charge = model.sell ? calcCost(model.sell, v) : all[0].cost;
  if (!Number.isFinite(charge) || charge < 1) return { charge: undefined, routes: [] };
  const limit = budgetUsd(charge);
  const routes = all.filter(r => routeUsd(model, r.cost) <= limit + 1e-9);
  return { charge, routes };
}

// Совместимость: маршрут без цены
export const buildRoutes = (model, v) => quote(model, v).routes;

// Шаги маршрута без запроса — для показа цены в приложении (функции и адреса не отдаём)
function publicRoutes(model) {
  const out = [];
  for (const a of model.alt || []) {
    if (!routeReady(a.provider)) continue;
    out.push({ p: a.provider, price: a.price || model.price, when: a.when || null });
  }
  if (!model.only && hasKey('fal')) out.push({ p: 'fal', price: model.price, when: FAL_LIMITS[model.id] || null });
  return out;
}

// Цена, которую справка поддержки называет основной (первый доступный провайдер)
export function primaryPrice(model) {
  if (model.sell) return model.sell;
  const r = publicRoutes(model);
  if (!r.length) return model.price;
  return r.slice().sort((a, b) => (a.p === 'fal') - (b.p === 'fal'))[0].price;
}

// Подходит ли генерация под безлимит. Безлимит работает только через Kie (самую низкую себестоимость).
export function unlimitedFor(model, v, tier) {
  if (!model.unlim || !tier || tier < model.unlim.tier || !hasKey('kie')) return false;
  return matchWhen(model.unlim.when, v);
}

// Что отдаём приложению (без адресов и функций)
export function publicCatalog() {
  return MODELS.filter(m => modelAvailable(m) && !m.hidden).map(m => ({
    id: m.id, category: m.category, name: m.name,
    desc: m.desc || '', tags: m.tags || [],
    fields: m.fields, price: m.price, sell: m.sell || null,
    routes: publicRoutes(m),
    unlim: m.unlim && hasKey('kie') ? { tier: m.unlim.tier, when: m.unlim.when || null } : null,
    audioLimits: m.audioLimits || null,
    videoLimits: m.videoLimits || null
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
