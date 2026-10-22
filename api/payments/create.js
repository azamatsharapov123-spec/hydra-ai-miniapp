import { authUser, sendError } from '../../lib/auth.js';
import { HttpError } from '../../lib/db.js';
import { getPackage } from '../../lib/config.js';

// Заглушка: оплата картой подключится после открытия счёта ИП и выбора эквайринга.
// Когда банк будет выбран, здесь создаётся платёж (createPayment) и возвращается payment_url,
// а вебхук банка вызывает creditPayment(id) из lib/payments.js.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await authUser(req);
    const pkg = getPackage((req.body || {}).package_id);
    if (!pkg) throw new HttpError(400, 'Неизвестный пакет');
    return res.status(503).json({ error: 'Оплата банковской картой скоро будет доступна.' });
  } catch (e) {
    return sendError(res, e);
  }
}
