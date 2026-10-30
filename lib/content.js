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

export async function contentGen(q) {
  const chat = owner();
  if (!chat) throw new Error('ADMIN_CHAT_ID не настроен');
  const model = getModel(q.model);
  if (!model) throw new Error('Модель недоступна');
  const values = { prompt: q.prompt };
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
    aspect: v.aspect, res: v.res, duration: v.duration
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

export async function contentCheck(oidcToken) {
  const chat = owner();
  if (!chat) throw new Error('ADMIN_CHAT_ID не настроен');
  const r = await query(
    `SELECT * FROM jobs WHERE user_id=$1 AND status='pending' AND params->>'content'='true' ORDER BY created_at LIMIT 6`, [chat]);
  const out = [];
  for (const row of r.rows) {
    for (const k of ['ext', 'params']) if (typeof row[k] === 'string') { try { row[k] = JSON.parse(row[k]); } catch (e) { row[k] = {}; } }
    const model = getModel(row.model);
    if (!model) { await query(`UPDATE jobs SET status='failed' WHERE id=$1`, [row.id]); continue; }
    let st;
    try { st = await poll(row.provider, row.ext || {}, d => extractUrl(model, d)); } catch (e) { st = { state: 'progress' }; }
    if (st.state === 'done') {
      const url = await keepFile(st.url, row.provider, model.output, oidcToken);
      const upd = await query(`UPDATE jobs SET status='done', result_url=$2 WHERE id=$1 AND status='pending' RETURNING id`, [row.id, url]);
      if (upd.rows[0]) {
        const sent = await deliver(chat, model.output === 'video' ? 'video' : 'image', url, row.params?.caption || 'Hydra AI Studio');
        out.push({ id: row.id, state: 'done', sent, url });
      }
    } else if (st.state === 'failed') {
      await query(`UPDATE jobs SET status='failed' WHERE id=$1 AND status='pending'`, [row.id]);
      await sendMessage(chat, `⚠️ Не получилось: ${(row.params?.caption || row.model).slice(0, 80)}\n${String(st.error || '').slice(0, 300)}`);
      out.push({ id: row.id, state: 'failed', error: String(st.error || '').slice(0, 300) });
    } else {
      out.push({ id: row.id, state: st.state, model: row.model });
    }
  }
  return { pending_checked: r.rows.length, items: out };
}
