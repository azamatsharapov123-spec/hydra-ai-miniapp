import { getTelegramUser } from './_lib/telegram.js';
import { getBalance, isBalanceStoreConfigured } from './_lib/balance.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isBalanceStoreConfigured()) {
    return res.status(500).json({ error: 'База данных баланса не настроена в переменных окружения Vercel' });
  }

  const user = getTelegramUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Откройте приложение через Telegram' });
  }

  try {
    const balance = await getBalance(user.id);
    return res.status(200).json({ success: true, balance });
  } catch (e) {
    return res.status(500).json({ error: 'Не удалось получить баланс' });
  }
}
