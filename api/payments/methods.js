import { authUser, sendError } from '../../lib/auth.js';
import { publicMethods } from '../../lib/paymethods.js';

// Список банков и способов (карта / телефон), которые мы принимаем. Сами номера показываются после выбора.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await authUser(req);
    const methods = process.env.ADMIN_CHAT_ID ? publicMethods() : [];
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ methods });
  } catch (e) {
    return sendError(res, e);
  }
}
