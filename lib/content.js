import crypto from 'crypto';
import { query } from './db.js';
import { getModel, validateInput, quote, extractUrl } from './models.js';
import { submit, poll, keepFile, checkMoneyError } from './providers.js';
import { tgCall, sendMessage } from './bot.js';

// Контент для своих соцсетей: владелец запускает генерации без списания ⚡,
// готовые файлы бот присылает ему в чат (оттуда их удобно скачать и выложить).
//   /api/admin?key=CONTENT_KEY&action=content_gen&model=...&prompt=...&v_aspect=9:16&caption=...
//   /api/admin?key=CONTENT_KEY&action=content_check

const owner = () => process.env.ADMIN_CHAT_ID;

export async function contentGen(q, extra = {}) {
  const chat = owner();
  if (!chat) throw new Error('ADMIN_CHAT_ID не настроен');
  const model = getModel(q.model);
  if (!model) throw new Error('Модель недоступна');
  const values = { prompt: q.prompt, ...(q.values || {}) };
  for (const [k, x] of Object.entries(q)) if (k.startsWith('v_')) values[k.slice(2)] = x;
  const v = validateInput(model, values);
  const { routes } = quote(model, v);
  if (!routes.length) throw new Error('Нет доступного сервера для этих настроек');

  let sub = null, used = -1, lastErr = '';
  for (let i = 0; i < routes.length; i++) {
    try { sub = await submit(routes[i]); } catch (e) { sub = { ok: false, error: e.message }; }
    if (sub.ok) { used = i; break; }
    lastErr = sub.error;
    await checkMoneyError(routes[i].provider, sub.error);
  }
  if (used < 0) return { ok: false, error: lastErr };

  const id = 'c' + crypto.randomBytes(12).toString('base64url');
  const params = {
    content: true,
    caption: String(q.caption || '').slice(0, 1000),
    aspect: v.aspect, res: v.res, duration: v.duration,
    ...(extra.tag ? { tag: String(extra.tag).slice(0, 80) } : {}),
    ...(extra.silent ? { silent: true } : {})
  };
  await query(
    `INSERT INTO jobs (id, user_id, model, cost, provider, ext, route, params) VALUES ($1,$2,$3,0,$4,$5,$6,$7)`,
    [id, chat, model.id, routes[used].provider, JSON.stringify(sub.ref), used, JSON.stringify(params)]
  );
  return { ok: true, id, model: model.id, provider: routes[used].provider };
}

async function deliver(chat, kind, url, caption) {
  const tries = kind === 'video'
    ? [['sendVideo', 'video', { supports_streaming: true }], ['sendDocument', 'document', {}]]
    : [['sendDocument', 'document', {}], ['sendPhoto', 'photo', {}]];
  for (const [method, field, extra] of tries) {
    const r = await tgCall(method, { chat_id: chat, [field]: url, caption, ...extra });
    if (r && r.ok) return true;
  }
  return sendMessage(chat, `${caption}\n\nФайл: ${url}`);
}

async function checkOne(row, chat, oidcToken) {
  for (const k of ['ext', 'params']) if (typeof row[k] === 'string') { try { row[k] = JSON.parse(row[k]); } catch (e) { row[k] = {}; } }
  const model = getModel(row.model);
  const tag = row.params?.tag;
  if (!model) { await query(`UPDATE jobs SET status='failed' WHERE id=$1`, [row.id]); return { id: row.id, tag, state: 'failed' }; }
  let st;
  try { st = await poll(row.provider, row.ext || {}, d => extractUrl(model, d)); } catch (e) { st = { state: 'progress' }; }
  if (st.state === 'done') {
    const url = await keepFile(st.url, row.provider, model.output, oidcToken);
    const upd = await query(`UPDATE jobs SET status='done', result_url=$2 WHERE id=$1 AND status='pending' RETURNING id`, [row.id, url]);
    if (!upd.rows[0]) return { id: row.id, tag, state: 'done' };
    const sent = row.params?.silent ? false
      : await deliver(chat, model.output === 'video' ? 'video' : 'image', url, row.params?.caption || 'Hydra AI Studio');
    return { id: row.id, tag, state: 'done', sent, url };
  }
  if (st.state === 'failed') {
    await query(`UPDATE jobs SET status='failed' WHERE id=$1 AND status='pending'`, [row.id]);
    if (!row.params?.silent) await sendMessage(chat, `⚠️ Не получилось: ${(row.params?.caption || row.model).slice(0, 80)}\n${String(st.error || '').slice(0, 300)}`);
    return { id: row.id, tag, state: 'failed', error: String(st.error || '').slice(0, 300) };
  }
  return { id: row.id, tag, state: st.state, model: row.model };
}

export async function contentCheck(oidcToken, limit = 6) {
  const chat = owner();
  if (!chat) throw new Error('ADMIN_CHAT_ID не настроен');
  const n = Math.min(20, Math.max(1, Number(limit) || 6));
  const r = await query(
    `SELECT * FROM jobs WHERE user_id=$1 AND status='pending' AND params->>'content'='true' ORDER BY created_at LIMIT $2`, [chat, n]);
  const items = [];
  // параллельно по 5, чтобы уложиться во время функции
  for (let i = 0; i < r.rows.length; i += 5) {
    items.push(...await Promise.all(r.rows.slice(i, i + 5).map(row => checkOne(row, chat, oidcToken).catch(e => ({ id: row.id, state: 'error', error: e.message })))));
  }
  const left = await query(`SELECT COUNT(*)::int AS n FROM jobs WHERE user_id=$1 AND status='pending' AND params->>'content'='true'`, [chat]);
  return { pending_checked: r.rows.length, pending_left: left.rows[0].n, items };
}

// Пакетная генерация: список задач берём из JSON-файла на sozanda.com (GET-запросом длинный список не передать)
//   /api/admin?key=CONTENT_KEY&action=content_batch&src=https://sozanda.com/...json&offset=0&limit=25
export async function contentBatch(q) {
  const src = String(q.src || '');
  if (!/^https:\/\/(www\.)?sozanda\.com\/[\w./-]+\.json$/.test(src)) throw new Error('src: только JSON-файл на sozanda.com');
  const r = await fetch(src, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Не удалось загрузить список: ' + r.status);
  const list = await r.json();
  if (!Array.isArray(list)) throw new Error('Нужен JSON-массив');
  const off = Math.max(0, Number(q.offset) || 0);
  const lim = Math.min(30, Math.max(1, Number(q.limit) || 20));
  const part = list.slice(off, off + lim);
  // уже запущенные или готовые метки не повторяем
  const have = await query(
    `SELECT params->>'tag' AS tag FROM jobs WHERE user_id=$1 AND params->>'content'='true' AND status IN ('pending','done') AND params->>'tag' = ANY($2)`,
    [owner(), part.map(it => String(it.tag || ''))]);
  const skip = new Set(have.rows.map(r => r.tag));
  // по одной задаче с паузой: не упираемся в лимит частоты провайдера и не мешаем клиентам
  const started = Date.now();
  const out = [];
  let stopAt = null;
  for (let i = 0; i < part.length; i++) {
    const it = part[i];
    if (skip.has(it.tag)) { out.push({ tag: it.tag, ok: true, skipped: true }); continue; }
    if (Date.now() - started > 45000) { stopAt = off + i; break; }
    let x;
    try {
      x = await contentGen({ model: it.model, prompt: it.prompt, values: it.values, caption: it.caption }, { tag: it.tag, silent: q.silent !== '0' });
    } catch (e) { x = { ok: false, error: e.message }; }
    out.push({ tag: it.tag, ok: x.ok, error: x.error });
    if (!x.ok && /429|frequency|too many/i.test(String(x.error))) { stopAt = off + i + 1; break; }
    await new Promise(r => setTimeout(r, 1500));
  }
  const end = stopAt ?? off + part.length;
  return {
    total: list.length, from: off,
    queued: out.filter(x => x.ok && !x.skipped).length, skipped: out.filter(x => x.skipped).length,
    next: end < list.length ? end : null,
    failed: out.filter(x => !x.ok)
  };
}

// Готовые результаты по префиксу метки (tag)
export async function contentList(q) {
  const chat = owner();
  const prefix = String(q.tag || '').slice(0, 60);
  if (!prefix) throw new Error('tag обязателен');
  const r = await query(
    `SELECT params->>'tag' AS tag, status, result_url AS url FROM jobs
     WHERE user_id=$1 AND params->>'content'='true' AND params->>'tag' LIKE $2 ORDER BY created_at`, [chat, prefix.replace(/[%_]/g, '') + '%']);
  return { count: r.rows.length, items: r.rows };
}

// Диагностика для владельца: последние задачи модели (без ссылок на файлы пользователя)
export async function contentJobs(q) {
  const m = String(q.model || 'remake-face').slice(0, 40);
  const n = Math.min(+q.limit || 5, 20);
  const r = await query(
    `SELECT id, model, cost, status, provider, route, created_at, ext, input, result_url IS NOT NULL AS has_result
       FROM jobs WHERE model=$1 ORDER BY created_at DESC LIMIT $2`, [m, n]);
  return {
    jobs: r.rows.map(j => {
      const i = j.input || {};
      return {
        id: j.id, cost: j.cost, status: j.status, provider: j.provider, route: j.route, created: j.created_at,
        stage: j.ext && j.ext.stage, segs: j.ext && j.ext.segs,
        input_keys: Object.keys(i), seconds: i.video_seconds,
        faces: ['char1', 'char2', 'char3'].filter(k => i[k]).length, prompt: i.prompt || '', has_result: j.has_result
      };
    })
  };
}

// Диагностика загрузки видео: сервер сам берёт ссылку и отправляет по ней тестовые байты, как это делает приложение
export async function contentUptest(q, oidcToken) {
  const { videoUploadUrl } = await import('./video.js');
  const type = String(q.type || 'video/mp4');
  const d = await videoUploadUrl(1, type, 2048, oidcToken);
  const out = { storeId: d.storeId, host: new URL(d.url).host, tries: [] };
  const variants = {
    app: { 'x-vercel-blob-access': 'public', 'x-content-type': type, 'x-api-version': '13', 'x-vercel-blob-store-id': d.storeId },
    plain: { 'x-content-type': type }
  };
  for (const [name, h] of Object.entries(variants)) {
    const dd = name === 'app' ? d : await videoUploadUrl(1, type, 2048, oidcToken);
    try {
      const r = await fetch(dd.url, { method: 'PUT', headers: h, body: Buffer.alloc(2048) });
      out.tries.push({ name, status: r.status, body: (await r.text()).slice(0, 300) });
    } catch (e) { out.tries.push({ name, error: String(e.message || e) }); }
  }
  return out;
}

// Что лежит в хранилище Blob и сколько места занимает (лимит Hobby — 1 ГБ).
// &prune=remake&hours=N удаляет загруженные для Remake исходники старше N часов (результаты не трогает).
export async function contentBlobs(q, oidcToken) {
  const { list, del } = await import('@vercel/blob');
  const { blobStoreId } = await import('./providers.js');
  const auth = process.env.BLOB_READ_WRITE_TOKEN
    ? { token: process.env.BLOB_READ_WRITE_TOKEN }
    : { storeId: blobStoreId(), ...((oidcToken || process.env.VERCEL_OIDC_TOKEN) ? { oidcToken: oidcToken || process.env.VERCEL_OIDC_TOKEN } : {}) };
  const all = [];
  let cursor;
  do {
    const r = await list({ ...auth, limit: 1000, cursor });
    all.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor && all.length < 20000);
  const groups = {};
  for (const b of all) {
    const g = b.pathname.split('/')[0];
    const x = groups[g] || (groups[g] = { files: 0, mb: 0 });
    x.files++; x.mb += b.size / 1048576;
  }
  for (const g of Object.values(groups)) g.mb = Math.round(g.mb * 10) / 10;
  const out = { total_files: all.length, total_mb: Math.round(all.reduce((s, b) => s + b.size, 0) / 104857.6) / 10, groups };
  if (q.top) {
    out.top = all.slice().sort((a, b) => b.size - a.size).slice(0, Math.min(+q.top || 20, 60))
      .map(b => ({ p: b.pathname, mb: Math.round(b.size / 10485.76) / 100, at: b.uploadedAt }));
  }
  if (q.prune === 'remake') {
    const hours = Math.max(0.5, Number(q.hours) || 24);
    const old = all.filter(b => b.pathname.startsWith('remake/') && Date.now() - new Date(b.uploadedAt).getTime() > hours * 3600e3);
    for (let i = 0; i < old.length; i += 100) await del(old.slice(i, i + 100).map(b => b.url), auth);
    out.deleted = { files: old.length, mb: Math.round(old.reduce((s, b) => s + b.size, 0) / 104857.6) / 10 };
  }
  return out;
}
