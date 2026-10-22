import { tx } from '../lib/db.js';
import { authUser, sendError } from '../lib/auth.js';
import { HttpError } from '../lib/db.js';
import { WITHDRAW_MIN } from '../lib/config.js';
import { sendMessage } from '../lib/bot.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { user } = await authUser(req);
    const details = String((req.body || {}).details || '').trim();
    if (details.length < 4 || details.length > 200) {
      throw new HttpError(400, 'Укажите реквизиты для выплаты (номер карты или телефона)');
    }

    const w = await tx(async c => {
      const b = await c.query('SELECT ref_balance FROM users WHERE id=$1 FOR UPDATE', [user.id]);
      const amount = Number(b.rows[0].ref_balance);
      if (amount < WITHDRAW_MIN) throw new HttpError(400, `Вывод доступен от ${WITHDRAW_MIN} TJS`);
      await c.query('UPDATE users SET ref_balance=0 WHERE id=$1', [user.id]);
      const r = await c.query(
        'INSERT INTO withdrawals (user_id, amount_tjs, details) VALUES ($1,$2,$3) RETURNING id, amount_tjs',
        [user.id, amount, details]
      );
      return r.rows[0];
    });

    const adminChat = process.env.ADMIN_CHAT_ID;
    if (adminChat) {
      await sendMessage(adminChat, `💸 Заявка на вывод #${w.id}\n${Number(w.amount_tjs).toFixed(2)} TJS\nПользователь: ${user.first_name || ''} (ID ${user.id})\nРеквизиты: ${details}`);
    }
    await sendMessage(user.id, `✅ Заявка на вывод ${Number(w.amount_tjs).toFixed(2)} TJS принята. Выплата будет произведена в ближайшее время.`);
    return res.status(200).json({ success: true, id: w.id, amount: Number(w.amount_tjs) });
  } catch (e) {
    return sendError(res, e);
  }
}
