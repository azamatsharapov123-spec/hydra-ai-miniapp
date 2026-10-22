import { query } from '../../lib/db.js';
import { authUser, sendError } from '../../lib/auth.js';
import { HttpError } from '../../lib/db.js';
import { getPackage } from '../../lib/config.js';
import { getMethod } from '../../lib/paymethods.js';
import { sendMessage, sendFile } from '../../lib/bot.js';

const RECEIPT = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,/i;
const MAX_RECEIPT = 2.5 * 1024 * 1024;

// Пользователь нажал «Я оплатил». Администратору уходит сообщение с кнопками (и чеком, если приложен).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { user } = await authUser(req);
    const body = req.body || {};
    const adminChat = process.env.ADMIN_CHAT_ID;
    if (!adminChat) throw new HttpError(503, 'Оплата переводом пока недоступна.');

    const r = await query('SELECT * FROM payments WHERE id=$1 AND user_id=$2', [body.payment_id, user.id]);
    const pay = r.rows[0];
    if (!pay) throw new HttpError(404, 'Платёж не найден');
    if (pay.status === 'paid') throw new HttpError(400, 'Этот платёж уже подтверждён');
    if (pay.status !== 'pending' && pay.status !== 'review') throw new HttpError(400, 'Этот платёж закрыт. Создайте новый.');
    if (pay.user_paid_at && Date.now() - new Date(pay.user_paid_at).getTime() < 60000) {
      throw new HttpError(429, 'Заявка уже отправлена, подождите минуту');
    }

    let receipt = null;
    if (body.receipt) {
      if (typeof body.receipt !== 'string' || !RECEIPT.test(body.receipt)) throw new HttpError(400, 'Чек: допустимы фото (JPG, PNG, WebP) и PDF');
      if (body.receipt.length * 0.75 > MAX_RECEIPT * 1.05) throw new HttpError(413, 'Файл чека слишком большой');
      receipt = body.receipt;
    }

    const pkg = getPackage(pay.package_id);
    const method = getMethod(pay.method);
    const who = `${user.first_name || '—'}${user.username ? ' @' + user.username : ''} (ID ${user.id})`;
    const caption = [
      `💳 Платёж №${pay.id}`,
      `Пользователь: ${who}`,
      `Пакет: ${pkg ? pkg.name : pay.package_id}, ${pay.coins} ⚡`,
      `Сумма: ${Number(pay.tjs).toFixed(2)} TJS`,
      method ? `Куда переводил: ${method.bank}, ${method.type === 'card' ? 'карта' : 'телефон'} ${method.number}` : '',
      receipt ? '📎 Чек приложен' : 'Чек не приложен'
    ].filter(Boolean).join('\n');
    const extra = { reply_markup: { inline_keyboard: [[
      { text: '✅ Подтвердить', callback_data: `pay:ok:${pay.id}` },
      { text: '❌ Отклонить', callback_data: `pay:no:${pay.id}` }
    ]] } };

    const sent = receipt
      ? await sendFile(adminChat, receipt, String(body.receipt_name || '').slice(0, 60) || undefined, caption, extra)
      : await sendMessage(adminChat, caption, extra);
    if (!sent) throw new HttpError(502, 'Не удалось отправить заявку администратору. Попробуйте ещё раз.');

    await query(`UPDATE payments SET status='review', user_paid_at=now() WHERE id=$1 AND status IN ('pending','review')`, [pay.id]);
    return res.status(200).json({ success: true });
  } catch (e) {
    return sendError(res, e);
  }
}
