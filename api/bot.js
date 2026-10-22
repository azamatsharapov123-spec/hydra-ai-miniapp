import crypto from 'crypto';
import { upsertUser } from '../lib/auth.js';
import { sendMessage, openAppKeyboard, webhookSecret } from '../lib/bot.js';

// Вебхук бота: отвечает на /start и принимает реферальный код из ссылки t.me/HydraAIBot?start=КОД
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('ok');
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(200).send('ok');

  const got = String(req.headers['x-telegram-bot-api-secret-token'] || '');
  const want = webhookSecret();
  const a = Buffer.from(got), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).send('forbidden');

  try {
    const msg = (req.body || {}).message;
    if (msg && msg.chat && msg.chat.type === 'private' && msg.from && !msg.from.is_bot) {
      const text = String(msg.text || '');
      const m = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?/);
      if (m) {
        await upsertUser(msg.from, m[1] || '');
        await sendMessage(
          msg.chat.id,
          'Добро пожаловать в Hydra AI Studio! 👋\nСоздавайте изображения, видео, аудио и аватары с помощью нейросетей. Нажмите кнопку ниже, чтобы открыть приложение.',
          openAppKeyboard()
        );
      } else {
        await sendMessage(msg.chat.id, 'Откройте приложение кнопкой ниже 👇', openAppKeyboard());
      }
    }
  } catch (e) {
    console.error('bot error', e);
  }
  return res.status(200).send('ok');
}
