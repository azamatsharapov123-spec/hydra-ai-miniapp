import crypto from 'crypto';
import { query, HttpError } from './db.js';
import { SIGNUP_COINS, REF_TIERS, pct } from './config.js';
import { sendMessage } from './bot.js';

const REF_GRACE_HOURS = 24;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

// Проверка подписи Telegram (initData). Подделать без токена бота нельзя.
export function verifyInitData(initData, botToken, maxAgeSec = 24 * 3600) {
  if (!initData || typeof initData !== 'string' || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(check).digest('hex');
  const a = Buffer.from(calc);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = parseInt(params.get('auth_date'), 10);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    if (!user || !user.id) return null;
    return { user, startParam: params.get('start_param') || '' };
  } catch (e) {
    return null;
  }
}

function displayName(u) {
  return [u.first_name, u.username ? `@${u.username}` : ''].filter(Boolean).join(' ') || `ID ${u.id}`;
}

// Находит пользователя или регистрирует нового. Пригласившего можно указать только при регистрации.
export async function upsertUser(tgUser, code) {
  const id = tgUser.id;
  const first = (tgUser.first_name || '').slice(0, 100);
  const uname = (tgUser.username || '').slice(0, 64);

  const clean = String(code || '').trim().toUpperCase();
  const validCode = /^[A-Z0-9]{6,12}$/.test(clean);

  const ex = await query('SELECT * FROM users WHERE id=$1', [id]);
  if (ex.rows[0]) {
    const u = ex.rows[0];
    if (u.first_name !== first || (u.username || '') !== uname) {
      await query('UPDATE users SET first_name=$2, username=$3 WHERE id=$1', [id, first, uname]);
      u.first_name = first; u.username = uname;
    }
    // Льготные 24 часа: человек уже открыл бота сам, а потом перешёл по реферальной ссылке.
    // Привязываем, если пригласившего ещё нет и оплат ещё не было.
    if (validCode && !u.referrer_id && Date.now() - new Date(u.created_at).getTime() < REF_GRACE_HOURS * 3600e3) {
      const r = await query('SELECT id FROM users WHERE ref_code=$1 AND id<>$2 AND (referrer_id IS NULL OR referrer_id<>$2)', [clean, id]);
      if (r.rows[0]) {
        const upd = await query(
          `UPDATE users SET referrer_id=$2 WHERE id=$1 AND referrer_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM payments WHERE user_id=$1 AND status='paid')
           RETURNING referrer_id`, [id, r.rows[0].id]);
        if (upd.rows[0]) {
          u.referrer_id = upd.rows[0].referrer_id;
          await sendMessage(u.referrer_id,
            `🎉 По вашей ссылке зарегистрировался новый пользователь.\nВы будете получать ${pct(REF_TIERS[0].rate)}% и больше с каждого его пополнения: процент растёт с числом платящих приглашённых.`);
        }
      }
    }
    return { user: u, isNew: false };
  }

  let referrerId = null;
  if (validCode) {
    const r = await query('SELECT id FROM users WHERE ref_code=$1', [clean]);
    if (r.rows[0] && String(r.rows[0].id) !== String(id)) referrerId = r.rows[0].id;
  }

  for (let i = 0; i < 6; i++) {
    try {
      const ins = await query(
        `INSERT INTO users (id, first_name, username, ref_code, referrer_id, coins)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING *`,
        [id, first, uname, newCode(), referrerId, SIGNUP_COINS]
      );
      if (!ins.rows[0]) {
        const again = await query('SELECT * FROM users WHERE id=$1', [id]);
        return { user: again.rows[0], isNew: false };
      }
      if (referrerId) {
        await sendMessage(
          referrerId,
          `🎉 По вашей ссылке зарегистрировался новый пользователь.\nВы будете получать ${pct(REF_TIERS[0].rate)}% и больше с каждого его пополнения: процент растёт с числом платящих приглашённых.`
        );
      }
      return { user: ins.rows[0], isNew: true };
    } catch (e) {
      if (e.code === '23505') continue; // случайный код уже занят, пробуем другой
      throw e;
    }
  }
  throw new HttpError(500, 'Не удалось создать пользователя');
}

// Проверяет, кто вызывает API. Приложение присылает initData в заголовке X-Init-Data.
export async function authUser(req) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new HttpError(500, 'TELEGRAM_BOT_TOKEN не настроен в Vercel');
  const v = verifyInitData(req.headers['x-init-data'], token);
  if (!v) throw new HttpError(401, 'Откройте приложение через Telegram');
  const { user, isNew } = await upsertUser(v.user, v.startParam);
  return { user, isNew, tgUser: v.user };
}

export function sendError(res, e) {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
  console.error(e);
  return res.status(500).json({ error: 'Ошибка сервера' });
}
