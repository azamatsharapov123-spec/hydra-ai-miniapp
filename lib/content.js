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
  const lim = Math.min(30, Math.max(1, Number(q.limit) || 25));
  const part = list.slice(off, off + lim);
  const out = [];
  for (let i = 0; i < part.length; i += 6) {
    out.push(...await Promise.all(part.slice(i, i + 6).map(it =>
      contentGen({ model: it.model, prompt: it.prompt, values: it.values, caption: it.caption }, { tag: it.tag, silent: q.silent !== '0' })
        .then(x => ({ tag: it.tag, ok: x.ok, error: x.error }))
        .catch(e => ({ tag: it.tag, ok: false, error: e.message })))));
  }
  return { total: list.length, from: off, queued: out.filter(x => x.ok).length, next: off + part.length < list.length ? off + part.length : null, failed: out.filter(x => !x.ok) };
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
