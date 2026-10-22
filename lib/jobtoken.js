import crypto from 'crypto';

// Подписанный «билет» задачи: приложение получает его при запуске генерации
// и возвращает в /api/status. Подпись не даёт подменить адрес, к которому обращается сервер.
const b64 = s => Buffer.from(s).toString('base64url');

function sign(body) {
  const secret = process.env.FAL_KEY || '';
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

export function makeToken(data) {
  const body = b64(JSON.stringify({ ...data, exp: Date.now() + 60 * 60 * 1000 }));
  return `${body}.${sign(body)}`;
}

export function readToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch (e) {
    return null;
  }
}
