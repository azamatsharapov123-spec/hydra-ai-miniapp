import { authUser, sendError } from '../lib/auth.js';
import { HttpError } from '../lib/db.js';
import { takeQuota } from '../lib/limits.js';
import { tgCall, sendMessage } from '../lib/bot.js';

// Скачивание файла и отправка в Telegram может занять несколько секунд
export const config = { maxDuration: 40 };

// Результат хранится на fal.media. Отправляем только такие ссылки.
const FAL_URL = /^https:\/\/(?:[a-z0-9-]+\.)*fal\.media\/[\w./%~+-]+$/i;
const MAX_UPLOAD = 45 * 1024 * 1024;   // лимит Telegram на загрузку ботом — 50 МБ
const SEND_LIMIT = 40;                 // отправок в чат в сутки на человека

const METHODS = {
  image: ['sendPhoto', 'photo'],
  video: ['sendVideo', 'video'],
  avatar: ['sendVideo', 'video'],
  audio: ['sendAudio', 'audio']
};

// Просит Telegram самому скачать файл по ссылке (так быстрее всего); если не вышло, скачиваем и загружаем сами
async function deliver(chatId, method, field, url, caption, extra) {
  const r = await tgCall(method, { chat_id: chatId, [field]: url, caption, ...extra });
  if (r && r.ok) return { ok: true };
  if (r && (r.error_code === 403 || r.error_code === 400 && /chat not found|blocked|deactivated/i.test(r.description || ''))) {
    return { ok: false, noChat: true };
  }
  // запасной путь: загрузка файла самим сервером
  const token = process.env.TELEGRAM_BOT_TOKEN;
  try {
    const f = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!f.ok) return { ok: false };
    const len = Number(f.headers.get('content-length') || 0);
    if (len > MAX_UPLOAD) return { ok: false, tooBig: true };
    const buf = Buffer.from(await f.arrayBuffer());
    if (buf.length > MAX_UPLOAD) return { ok: false, tooBig: true };
    const mime = f.headers.get('content-type') || 'application/octet-stream';
    const name = (new URL(url).pathname.split('/').pop() || 'file').slice(-60);
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption);
    for (const [k, v] of Object.entries(extra || {})) form.append(k, String(v));
    form.append(field, new Blob([buf], { type: mime }), name);
    const up = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(25000) });
    const j = await up.json().catch(() => null);
    return { ok: !!(j && j.ok), noChat: !!(j && j.error_code === 403) };
  } catch (e) {
    return { ok: false };
  }
}

// Приложение просит прислать результат в чат с ботом: оттуда файл сохраняется в галерею в оригинальном качестве
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { user } = await authUser(req);
    const { url, category, as_file } = req.body || {};
    if (typeof url !== 'string' || !FAL_URL.test(url)) throw new HttpError(400, 'Неверная ссылка на файл');
    if (!METHODS[category]) throw new HttpError(400, 'Неизвестный тип файла');
    const q = await takeQuota(user.id, 'send', SEND_LIMIT);
    if (!q.ok) throw new HttpError(429, 'Слишком много отправок за сегодня. Попробуйте завтра.');

    const caption = 'Сделано в Hydra AI Studio';
    let out;
    if (category === 'image' && as_file) {
      out = await deliver(user.id, 'sendDocument', 'document', url, caption, {});
    } else {
      const [method, field] = METHODS[category];
      const extra = (method === 'sendVideo') ? { supports_streaming: true } : {};
      out = await deliver(user.id, method, field, url, caption, extra);
      // фото больше лимита Telegram отправляем файлом
      if (!out.ok && !out.noChat && category === 'image') out = await deliver(user.id, 'sendDocument', 'document', url, caption, {});
    }
    if (out.ok) return res.status(200).json({ success: true });
    if (out.noChat) throw new HttpError(409, 'Бот не может написать вам первым. Откройте чат с ботом, нажмите /start и повторите.');
    // не получилось отправить файл: хотя бы пришлём ссылку
    const sent = await sendMessage(user.id, `Ваш файл: ${url}`);
    if (sent) return res.status(200).json({ success: true, link_only: true });
    throw new HttpError(502, 'Не удалось отправить файл. Попробуйте ещё раз.');
  } catch (e) {
    return sendError(res, e);
  }
}
