// Провайдеры нейросетей: Kie.ai (самый дешёвый), Replicate и Atlas Cloud (дешевле на части моделей) и fal.ai (запасной).
// Каждая генерация идёт по «маршруту»: сначала самый дешёвый провайдер, при ошибке — следующий, последним всегда fal.
// Провайдер участвует, только если его ключ добавлен в Vercel.

export const KEYS = {
  fal: 'FAL_KEY',
  atlas: 'ATLAS_API_KEY',
  replicate: 'REPLICATE_API_TOKEN',
  kie: 'KIE_API_KEY'
};

// Ссылки на результаты, которые мы принимаем обратно (отправка в чат, фото-референс из истории)
export const RESULT_URL = /^https:\/\/(?:[a-z0-9-]+\.)*(?:fal\.media|public\.blob\.vercel-storage\.com|replicate\.delivery|atlascloud\.ai|aiquickdraw\.com|redpandaai\.co|kie\.ai)\/[\w./%~+-]+$/i;

export const hasKey = p => !!process.env[KEYS[p]];

const NAMES = { fal: 'fal.ai', atlas: 'Atlas Cloud', replicate: 'Replicate', kie: 'Kie.ai' };
const lastAlert = {};
// Если у провайдера закончились деньги или ключ неверный — пишем администратору в бот (не чаще раза в 30 минут)
export async function checkMoneyError(provider, msg) {
  if (!/balance|credit|insufficient|exhausted|payment|billing|quota|unauthori|invalid api key|locked|402|401|403/i.test(String(msg || ''))) return;
  const chat = process.env.ADMIN_CHAT_ID;
  if (!chat || Date.now() - (lastAlert[provider] || 0) < 30 * 60 * 1000) return;
  lastAlert[provider] = Date.now();
  try {
    const { sendMessage } = await import('./bot.js');
    await sendMessage(chat, `⚠️ ${NAMES[provider] || provider}: генерации не проходят — похоже, закончился баланс или неверный ключ.\nОтвет сервиса: ${String(msg).slice(0, 200)}\n\nПока проблема не решена, генерации идут через другие платформы (если они подключены).`);
  } catch (e) { /* уведомление не критично */ }
}

const ATLAS = 'https://api.atlascloud.ai/api/v1/model';
const REPLICATE = 'https://api.replicate.com/v1';
const KIE = 'https://api.kie.ai/api/v1';
const KIE_UPLOAD = 'https://kieai.redpandaai.co/api/file-base64-upload';

function errText(data, fallback) {
  if (!data) return fallback;
  if (typeof data === 'string') return data.slice(0, 300);
  if (typeof data.detail === 'string') return data.detail;
  if (data.detail) return JSON.stringify(data.detail).slice(0, 300);
  if (data.data && data.data.error) return String(data.data.error).slice(0, 300);
  if (typeof data.error === 'string') return data.error;
  if (data.error) return JSON.stringify(data.error).slice(0, 300);
  return data.message || data.msg || fallback;
}

async function readJson(r) {
  if (typeof r.text !== 'function') return r.json().catch(() => ({}));
  const t = await r.text().catch(() => '');
  try { return JSON.parse(t); } catch (e) { return t ? { message: t.slice(0, 300) } : {}; }
}

const retryable = code => code === 429 || code === 502 || code === 503 || code === 504;

// ---------- Отправка задачи. Возвращает { ok, ref } или { ok:false, error } ----------
export async function submit(route) {
  const p = route.provider;
  if (p === 'fal') {
    const r = await fetch(`https://queue.fal.run/${route.endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(route.payload)
    });
    const d = await readJson(r);
    if (!r.ok || !d.request_id || !d.status_url || !d.response_url) return { ok: false, error: errText(d, `Ошибка fal.ai (${r.status})`) };
    if (!/^https:\/\/queue\.fal\.run\//.test(d.status_url) || !/^https:\/\/queue\.fal\.run\//.test(d.response_url)) return { ok: false, error: 'fal.ai вернул неожиданный адрес' };
    return { ok: true, ref: { id: d.request_id, s: d.status_url, r: d.response_url } };
  }
  if (p === 'atlas') {
    const r = await fetch(`${ATLAS}/${route.kind === 'image' ? 'generateImage' : 'generateVideo'}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.ATLAS_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: route.model, ...route.payload })
    });
    const d = await readJson(r);
    const id = d && d.data && d.data.id;
    if (!r.ok || !id) return { ok: false, error: errText(d, `Ошибка Atlas (${r.status})`) };
    return { ok: true, ref: { id: String(id) } };
  }
  if (p === 'replicate') {
    const r = await fetch(`${REPLICATE}/models/${route.model}/predictions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: route.payload })
    });
    const d = await readJson(r);
    if (!r.ok || !d.id) return { ok: false, error: errText(d, `Ошибка Replicate (${r.status})`) };
    return { ok: true, ref: { id: String(d.id) } };
  }
  if (p === 'kie') {
    let input;
    try {
      input = await kieUploads(route.payload);
    } catch (e) {
      return { ok: false, error: e.message || 'Kie.ai: не удалось загрузить файл' };
    }
    const r = await fetch(`${KIE}/jobs/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: route.model, input })
    });
    const d = await readJson(r);
    const id = d && d.data && d.data.taskId;
    // Kie отвечает HTTP 200 даже при ошибке: смотрим поле code
    if (!r.ok || !id || (d.code !== undefined && Number(d.code) !== 200)) {
      return { ok: false, error: `Kie.ai (${d.code || r.status}): ${errText(d, 'ошибка')}` };
    }
    return { ok: true, ref: { id: String(id) } };
  }
  return { ok: false, error: 'Неизвестный провайдер' };
}

// Kie принимает только ссылки. Фото и аудио, присланные из приложения (data:...), сначала загружаем к ним.
// Загрузка разных файлов идёт параллельно; ссылки (https) отправляются как есть.
async function kieUploadOne(dataUri, i) {
  const m = /^data:([a-z0-9.+\/-]+);base64,/i.exec(dataUri);
  const mime = m ? m[1].toLowerCase() : 'application/octet-stream';
  const ext = /png/.test(mime) ? 'png' : /jpe?g/.test(mime) ? 'jpg' : /webp/.test(mime) ? 'webp'
    : /wav/.test(mime) ? 'wav' : /mp4|m4a|aac/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /audio|mpeg|mp3/.test(mime) ? 'mp3' : 'bin';
  const r = await fetch(KIE_UPLOAD, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Data: dataUri, uploadPath: 'hydra', fileName: `h${Date.now().toString(36)}${i}.${ext}` })
  });
  const d = await readJson(r);
  const x = (d && d.data) || {};
  const url = x.downloadUrl || x.fileUrl || x.url;
  if (!r.ok || !url) throw new Error(`Kie.ai: не удалось загрузить файл (${errText(d, String(r.status))})`);
  return url;
}

async function kieUploads(payload) {
  const jobs = [];
  let n = 0;
  const walk = v => {
    if (typeof v === 'string') {
      if (!/^data:/i.test(v)) return v;
      const p = kieUploadOne(v, n++);
      jobs.push(p);
      return p;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  const tree = walk(payload);
  await Promise.all(jobs);
  const resolve = async v => {
    if (v && typeof v.then === 'function') return await v;
    if (Array.isArray(v)) return Promise.all(v.map(resolve));
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = await resolve(x);
      return o;
    }
    return v;
  };
  return resolve(tree);
}

// Первая ссылка на результат в ответе Kie (картинки, видео, музыка Suno — у них разные поля)
function kieResultUrl(d) {
  let res = d.resultJson;
  if (typeof res === 'string') { try { res = JSON.parse(res); } catch (e) { res = null; } }
  const cands = [];
  const add = x => { if (typeof x === 'string' && /^https:\/\//.test(x)) cands.push(x); };
  if (res && typeof res === 'object') {
    for (const k of ['resultUrls', 'result_urls']) if (Array.isArray(res[k])) res[k].forEach(add);
    if (res.data && Array.isArray(res.data.result_urls)) res.data.result_urls.forEach(add);
    if (res.resultObject && Array.isArray(res.resultObject.data)) res.resultObject.data.forEach(t => add(t && t.audio_url));
  }
  const tracks = d.response && d.response.data;
  if (Array.isArray(tracks)) tracks.forEach(t => add(t && (t.audio_url || t.audioUrl)));
  return cands[0] || null;
}

// Результат может прийти ссылкой, data-URI или «голым» base64 (так GPT Image иногда отдаёт картинку)
function pickOutput(out) {
  if (Array.isArray(out)) out = out[0];
  if (out && typeof out === 'object') out = out.url || out.uri || out.image || out.b64_json || out.data || null;
  if (typeof out !== 'string' || !out) return null;
  const v = out.trim();
  if (/^https?:\/\//i.test(v) || /^data:/i.test(v)) return v;
  if (v.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(v.slice(0, 400))) {
    const kind = v.startsWith('iVBOR') ? 'image/png' : v.startsWith('/9j/') ? 'image/jpeg' : v.startsWith('UklGR') ? 'image/webp' : 'video/mp4';
    return `data:${kind};base64,${v.replace(/\s+/g, '')}`;
  }
  return null;
}

// ---------- Проверка задачи ----------
// Возвращает { state: 'queue'|'progress'|'done'|'failed', url?, error?, position? }
export async function poll(provider, ref, extract) {
  if (provider === 'fal') {
    const h = { Authorization: `Key ${process.env.FAL_KEY}` };
    const sr = await fetch(ref.s, { headers: h });
    const st = await readJson(sr);
    if (!sr.ok) {
      if (retryable(sr.status)) return { state: 'progress' };
      return { state: 'failed', error: errText(st, `Ошибка статуса (${sr.status})`) };
    }
    if (st.status !== 'COMPLETED') {
      return { state: st.status === 'IN_PROGRESS' ? 'progress' : 'queue', position: typeof st.queue_position === 'number' ? st.queue_position : null };
    }
    const rr = await fetch(ref.r, { headers: h });
    const data = await readJson(rr);
    if (!rr.ok) {
      if (retryable(rr.status)) return { state: 'progress' };
      return { state: 'failed', error: errText(data, `Ошибка генерации (${rr.status})`) };
    }
    const url = extract(data);
    return url ? { state: 'done', url } : { state: 'failed', error: 'Модель не вернула результат' };
  }
  if (provider === 'atlas') {
    const r = await fetch(`${ATLAS}/prediction/${encodeURIComponent(ref.id)}`, { headers: { Authorization: `Bearer ${process.env.ATLAS_API_KEY}` } });
    const d = await readJson(r);
    if (!r.ok) {
      if (retryable(r.status)) return { state: 'progress' };
      return { state: 'failed', error: errText(d, `Ошибка Atlas (${r.status})`) };
    }
    const x = d.data || {};
    const s = String(x.status || '').toLowerCase();
    if (s === 'completed' || s === 'succeeded' || s === 'success') {
      const url = pickOutput(x.outputs !== undefined ? x.outputs : x.output);
      if (url) console.error('atlas output', url.slice(0, 90));
      return url ? { state: 'done', url } : { state: 'failed', error: 'Модель не вернула результат' };
    }
    if (s === 'failed' || s === 'error' || s === 'canceled' || s === 'cancelled') return { state: 'failed', error: errText(x.error || d, 'Ошибка генерации') };
    return { state: s === 'created' || s === 'queued' || s === 'pending' ? 'queue' : 'progress' };
  }
  if (provider === 'replicate') {
    const r = await fetch(`${REPLICATE}/predictions/${encodeURIComponent(ref.id)}`, { headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` } });
    const d = await readJson(r);
    if (!r.ok) {
      if (retryable(r.status)) return { state: 'progress' };
      return { state: 'failed', error: errText(d, `Ошибка Replicate (${r.status})`) };
    }
    if (d.status === 'succeeded') {
      const url = pickOutput(d.output);
      return url ? { state: 'done', url } : { state: 'failed', error: 'Модель не вернула результат' };
    }
    if (d.status === 'failed' || d.status === 'canceled') return { state: 'failed', error: errText(d.error || d, 'Ошибка генерации') };
    return { state: d.status === 'starting' ? 'queue' : 'progress' };
  }
  if (provider === 'kie') {
    const r = await fetch(`${KIE}/jobs/recordInfo?taskId=${encodeURIComponent(ref.id)}`, { headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}` } });
    const d = await readJson(r);
    if (!r.ok) {
      if (retryable(r.status)) return { state: 'progress' };
      return { state: 'failed', error: errText(d, `Ошибка Kie.ai (${r.status})`) };
    }
    const x = (d && d.data) || null;
    if (!x) {
      if (retryable(Number(d && d.code)) || Number(d && d.code) === 455) return { state: 'progress' };
      return { state: 'failed', error: errText(d, 'Kie.ai: задача не найдена') };
    }
    const s = String(x.state || '').toLowerCase();
    if (s === 'success') {
      const url = kieResultUrl(x);
      return url ? { state: 'done', url, credits: Number(x.creditsConsumed) || null } : { state: 'failed', error: 'Модель не вернула результат' };
    }
    if (s === 'fail') return { state: 'failed', error: x.failMsg || x.failCode || 'Ошибка генерации' };
    return { state: s === 'generating' ? 'progress' : 'queue' };
  }
  return { state: 'failed', error: 'Неизвестный провайдер' };
}

// Понятный текст для клиента вместо технической ошибки
export function friendlyError(msg) {
  const m = String(msg || '');
  if (/sensitive|flagged|E005|safety|moderat|nsfw|policy|real person|face/i.test(m)) {
    return 'Нейросеть отклонила запрос фильтром безопасности (часто так бывает с фото реальных людей, особенно детей). Попробуйте другое фото, другой запрос или другую модель (Kling, Veo).';
  }
  // слишком много запросов одновременно или нет денег у провайдера: клиенту — понятный текст, ⚡ уже возвращены
  if (/\b429\b|too many|rate limit|\b402\b|insufficient|credits/i.test(m)) {
    return 'Сервер сейчас перегружен. ⚡ возвращены, попробуйте через минуту.';
  }
  return m || 'Ошибка генерации';
}

// ---------- Своё хранилище (Vercel Blob) ----------
// Replicate удаляет файлы через час, Kie — через 1–14 дней, Atlas — через 14 дней. Копируем результат к себе, если хранилище подключено.
// Новые хранилища Vercel работают без ключа: по ID хранилища и встроенному токену Vercel (OIDC).
// Если что-то пошло не так, отдаём исходную ссылку: генерация не теряется.
export const blobStoreId = () =>
  process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN_STORE_ID ||
  Object.entries(process.env).find(([k, v]) => /BLOB.*_STORE_ID$/.test(k) && v)?.[1] || '';

// Хранилище есть всегда: сначала Vercel Blob (если подключён), запасной вариант — хранилище fal (по FAL_KEY)
export const storageReady = () => !!(process.env.BLOB_READ_WRITE_TOKEN || blobStoreId() || process.env.FAL_KEY);

let blobBroken = false;   // Blob однажды не сработал в этом экземпляре — дальше сразу в fal

async function toBlob(body, type, ext, oidcToken) {
  if (blobBroken || !(process.env.BLOB_READ_WRITE_TOKEN || blobStoreId())) return null;
  try {
    const { put } = await import('@vercel/blob');
    const opts = { access: 'public', contentType: type, addRandomSuffix: true };
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      opts.token = process.env.BLOB_READ_WRITE_TOKEN;
    } else {
      opts.storeId = blobStoreId();
      const oidc = oidcToken || process.env.VERCEL_OIDC_TOKEN;
      if (oidc) opts.oidcToken = oidc;
    }
    const blob = await put(`results/${Date.now().toString(36)}.${ext}`, body, opts);
    return blob && blob.url ? blob.url : null;
  } catch (e) {
    blobBroken = true;
    console.error('blob copy failed', e && e.message);
    return null;
  }
}

// Загрузка в хранилище fal: сначала получаем адрес для загрузки, потом кладём файл
async function toFal(body, type, ext) {
  const key = process.env.FAL_KEY;
  if (!key) return null;
  for (const base of ['https://rest.alpha.fal.ai', 'https://rest.fal.ai']) {
    try {
      const r = await fetch(`${base}/storage/upload/initiate?storage_type=fal-cdn-v3`, {
        method: 'POST',
        headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_type: type, file_name: `hydra.${ext}` })
      });
      const d = await readJson(r);
      if (!r.ok || !d.upload_url || !d.file_url) { console.error('fal storage initiate', r.status, errText(d, '')); continue; }
      const up = await fetch(d.upload_url, { method: 'PUT', headers: { 'Content-Type': type }, body });
      if (!up.ok) { console.error('fal storage put', up.status); continue; }
      return d.file_url;
    } catch (e) {
      console.error('fal storage failed', e && e.message);
    }
  }
  return null;
}

export async function keepFile(url, provider, kind, oidcToken) {
  if (provider === 'fal' || !storageReady() || !/^(https:\/\/|data:)/.test(url || '')) return url;
  try {
    const r = await fetch(url);
    if (!r.ok) return url;
    const type = (r.headers.get('content-type') || '').split(';')[0] || (kind === 'video' ? 'video/mp4' : 'image/png');
    const ext = /mp4|video/.test(type) ? 'mp4' : /wav/.test(type) ? 'wav' : /webp/.test(type) ? 'webp' : /jpe?g/.test(type) ? 'jpg' : /mpeg|mp3/.test(type) ? 'mp3' : 'png';
    const body = Buffer.from(await r.arrayBuffer());
    const saved = (await toBlob(body, type, ext, oidcToken)) || (await toFal(body, type, ext));
    if (saved) console.error('result saved', saved.slice(0, 60));
    return saved || url;
  } catch (e) {
    console.error('keep file failed', e && e.message);
    return url;
  }
}
