import { query } from '../../lib/db.js';
import { authUser, sendError } from '../../lib/auth.js';
import { HttpError } from '../../lib/db.js';
import { getPackage } from '../../lib/config.js';
import { getMethod } from '../../lib/paymethods.js';
import { createPayment } from '../../lib/payments.js';

// Ручная оплата: создаём платёж и показываем реквизиты. Деньги засчитываются только
// после того, как администратор подтвердит поступление кнопкой в Telegram.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { user } = await authUser(req);
    const body = req.body || {};
    const pkg = getPackage(body.package_id);
    if (!pkg) throw new HttpError(400, 'Неизвестный пакет');
    const method = getMethod(body.method_id);
    if (!method || !process.env.ADMIN_CHAT_ID) {
      throw new HttpError(503, 'Оплата переводом пока недоступна. Попробуйте позже.');
    }

    const open = await query(
      `SELECT COUNT(*) AS n FROM payments
       WHERE user_id=$1 AND status IN ('pending','review') AND created_at > now() - interval '48 hours'`,
      [user.id]
    );
    if (Number(open.rows[0].n) >= 3) {
      throw new HttpError(429, 'У вас уже есть неподтверждённые платежи. Дождитесь подтверждения или напишите администратору.');
    }

    const pay = await createPayment(user.id, pkg.id, 'manual', null, method.id);
    return res.status(200).json({
      success: true,
      payment: {
        id: pay.id,
        tjs: Number(pay.tjs),
        coins: pay.coins,
        package: pkg.name,
        method: { bank: method.bank, type: method.type, number: method.number, holder: method.holder }
      }
    });
  } catch (e) {
    return sendError(res, e);
  }
}
