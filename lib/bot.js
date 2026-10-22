import crypto from 'crypto';
import { APP_URL } from './config.js';

// Сообщение от бота. Никогда не бросает ошибку: если пользователь не нажимал /start
// или не разрешил сообщения, Telegram откажет, и это нормально.
export async function sendMessage(chatId, text, extra = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, ...extra }),
      signal: AbortSignal.timeout(5000)
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

// То же, что sendMessage, но возвращает message_id отправленного сообщения (или null)
export async function sendMessageId(chatId, text, extra = {}) {
  const r = await tgCall('sendMessage', { chat_id: chatId, text, ...extra });
  return (r && r.ok && r.result && r.result.message_id) || null;
}

export const openAppKeyboard = () => ({
  reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть Hydra AI Studio', web_app: { url: APP_URL } }]] }
});

// Секрет вебхука выводится из токена бота, отдельная переменная не нужна
export function webhookSecret() {
  return crypto.createHash('sha256').update(String(process.env.TELEGRAM_BOT_TOKEN) + ':hydra-webhook').digest('hex').slice(0, 48);
}

// Любой метод Bot API (JSON). Не бросает ошибку, возвращает ответ Telegram или null.
export async function tgCall(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000)
    });
    return await r.json().catch(() => null);
  } catch (e) {
    return null;
  }
}

// Отправка файла (чек) с подписью и кнопками. dataUri: data:image/...;base64,... или data:application/pdf;base64,...
export async function sendFile(chatId, dataUri, filename, caption, extra = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const m = /^data:([a-z0-9.+\/-]+);base64,(.+)$/i.exec(dataUri || '');
  if (!m) return false;
  const mime = m[1].toLowerCase();
  const isImage = mime.startsWith('image/');
  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', caption);
    if (extra.reply_markup) form.append('reply_markup', JSON.stringify(extra.reply_markup));
    form.append(isImage ? 'photo' : 'document', new Blob([Buffer.from(m[2], 'base64')], { type: mime }), filename || (isImage ? 'receipt.jpg' : 'receipt.pdf'));
    const r = await fetch(`https://api.telegram.org/bot${token}/${isImage ? 'sendPhoto' : 'sendDocument'}`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(15000)
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

export const isAdmin = id => !!process.env.ADMIN_CHAT_ID && String(id) === String(process.env.ADMIN_CHAT_ID);
