import crypto from 'crypto';
import { upsertUser } from '../lib/auth.js';
import { sendMessage, openAppKeyboard, webhookSecret, tgCall, isAdmin } from '../lib/bot.js';
import { adminCommand, paymentDecision } from '../lib/adminops.js';

// Вебхук бота: /start, реферальный код из ссылки t.me/HydraAIBot?start=КОД,
// команды администратора и кнопки подтверждения платежей.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('ok');
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(200).send('ok');

  const got = String(req.headers['x-telegram-bot-api-secret-token'] || '');
  const want = webhookSecret();
  const a = Buffer.from(got), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).send('forbidden');

  try {
    const update = req.body || {};

    // --- кнопки под сообщением о платеже (только администратор) ---
    const cq = update.callback_query;
    if (cq) {
      if (!isAdmin(cq.from && cq.from.id)) {
        await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: 'Недостаточно прав', show_alert: true });
        return res.status(200).send('ok');
      }
      const m = /^pay:(ok|no):(\d{1,12})$/.exec(String(cq.data || ''));
      if (m) {
        const out = await paymentDecision(m[1], m[2]);
        await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: out.text, show_alert: true });
        if (out.done && cq.message) {
          await tgCall('editMessageReplyMarkup', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
          await sendMessage(cq.message.chat.id, out.text);
        }
      } else {
        await tgCall('answerCallbackQuery', { callback_query_id: cq.id });
      }
      return res.status(200).send('ok');
    }

    const msg = update.message;
    if (msg && msg.chat && msg.chat.type === 'private' && msg.from && !msg.from.is_bot) {
      const text = String(msg.text || '');

      // --- команды администратора ---
      if (isAdmin(msg.from.id) && /^\/(give|take|user|partner|unpartner|pending|stats|help|admin)\b/i.test(text)) {
        const reply = await adminCommand(text);
        await sendMessage(msg.chat.id, reply);
        return res.status(200).send('ok');
      }

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
