// Провайдеры нейросетей: fal.ai (основной и запасной), Atlas Cloud и Replicate (дешевле на части моделей).
// Каждая генерация идёт по «маршруту»: сначала самый дешёвый провайдер, при ошибке — следующий, последним всегда fal.
// Провайдер участвует, только если его ключ добавлен в Vercel.

export const KEYS = {
  fal: 'FAL_KEY',
  atlas: 'ATLAS_API_KEY',
  replicate: 'REPLICATE_API_TOKEN'
};

// Ссылки на результаты, которые мы принимаем обратно (отправка в чат, фото-референс из истории)
export const RESULT_URL = /^https:\/\/(?:[a-z0-9-]+\.)*(?:fal\.media|public\.blob\.vercel-storage\.com|replicate\.delivery|atlascloud\.ai)\/[\w./%~+-]+$/i;

export const hasKey = p => !!process.env[KEYS[p]];

const NAMES = { fal: 'fal.ai', atlas: 'Atlas Cloud', replicate: 'Replicate' };
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
  return { ok: false, error: 'Неизвестный провайдер' };
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
      const out = Array.isArray(x.outputs) ? x.outputs[0] : (x.output || null);
      const url = typeof out === 'string' ? out : (out && out.url);
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
      const out = Array.isArray(d.output) ? d.output[0] : d.output;
      const url = typeof out === 'string' ? out : (out && out.url);
      return url ? { state: 'done', url } : { state: 'failed', error: 'Модель не вернула результат' };
    }
    if (d.status === 'failed' || d.status === 'canceled') return { state: 'failed', error: errText(d.error || d, 'Ошибка генерации') };
    return { state: d.status === 'starting' ? 'queue' : 'progress' };
  }
  return { state: 'failed', error: 'Неизвестный провайдер' };
}

// Понятный текст для клиента вместо технической ошибки
export function friendlyError(msg) {
  const m = String(msg || '');
  if (/sensitive|flagged|E005|safety|moderat|nsfw|policy|real person|face/i.test(m)) {
    return 'Нейросеть отклонила запрос фильтром безопасности (часто так бывает с фото реальных людей, особенно детей). Попробуйте другое фото, другой запрос или другую модель (Kling, Veo).';
  }
  return m || 'Ошибка генерации';
}

// ---------- Своё хранилище (Vercel Blob) ----------
// Replicate удаляет файлы через час, Atlas — через 14 дней. Копируем результат к себе, если хранилище подключено.
// Новые хранилища Vercel работают без ключа: по ID хранилища и встроенному токену Vercel (OIDC).
// Если что-то пошло не так, отдаём исходную ссылку: генерация не теряется.
export const blobStoreId = () =>
  process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN_STORE_ID ||
  Object.entries(process.env).find(([k, v]) => /BLOB.*_STORE_ID$/.test(k) && v)?.[1] || '';

export const storageReady = () => !!(process.env.BLOB_READ_WRITE_TOKEN || blobStoreId());

export async function keepFile(url, provider, kind, oidcToken) {
  if (provider === 'fal' || !storageReady() || !/^https:\/\//.test(url || '')) return url;
  try {
    const { put } = await import('@vercel/blob');
    const r = await fetch(url);
    if (!r.ok) return url;
    const type = r.headers.get('content-type') || (kind === 'video' ? 'video/mp4' : 'image/png');
    const ext = /mp4|video/.test(type) ? 'mp4' : /webp/.test(type) ? 'webp' : /jpe?g/.test(type) ? 'jpg' : /mpeg|mp3/.test(type) ? 'mp3' : 'png';
    const body = Buffer.from(await r.arrayBuffer());
    const opts = { access: 'public', contentType: type, addRandomSuffix: true };
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      opts.token = process.env.BLOB_READ_WRITE_TOKEN;
    } else {
      opts.storeId = blobStoreId();
      const oidc = oidcToken || process.env.VERCEL_OIDC_TOKEN;
      if (oidc) opts.oidcToken = oidc;
    }
    const blob = await put(`results/${Date.now().toString(36)}.${ext}`, body, opts);
    return blob && blob.url ? blob.url : url;
  } catch (e) {
    console.error('blob copy failed', e && e.message);
    return url;
  }
}
