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

export const openAppKeyboard = () => ({
  reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть Hydra AI Studio', web_app: { url: APP_URL } }]] }
});

// Секрет вебхука выводится из токена бота, отдельная переменная не нужна
export function webhookSecret() {
  return crypto.createHash('sha256').update(String(process.env.TELEGRAM_BOT_TOKEN) + ':hydra-webhook').digest('hex').slice(0, 48);
}
