import crypto from 'crypto';

// Сколько живёт initData после выдачи Telegram (сутки)
const MAX_AUTH_AGE_SEC = 24 * 60 * 60;

// Проверка подписи Telegram.WebApp.initData:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// Возвращает объект пользователя или null, если подпись неверна или данные устарели.
export function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(expectedHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = parseInt(params.get('auth_date'), 10);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SEC) return null;

  try {
    const user = JSON.parse(params.get('user'));
    return user && user.id ? user : null;
  } catch (e) {
    return null;
  }
}

// Достаёт и проверяет пользователя из заголовка X-Telegram-Init-Data
export function getTelegramUser(req) {
  return verifyInitData(req.headers['x-telegram-init-data'], process.env.TELEGRAM_BOT_TOKEN);
}
