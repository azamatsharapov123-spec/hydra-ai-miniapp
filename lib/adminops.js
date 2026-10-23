import { query } from './db.js';
import { sendMessage, tgCall } from './bot.js';
import { creditPayment } from './payments.js';
import { getPackage, pct } from './config.js';
import { returnToAI } from './support.js';
import { communityCommand, COMMUNITY_HELP } from './community.js';

// Ищет пользователя по числовому ID или по @username
export async function findUser(arg) {
  const a = String(arg || '').trim();
  if (!a) return null;
  if (/^\d{3,15}$/.test(a)) {
    const r = await query('SELECT * FROM users WHERE id=$1', [a]);
    return r.rows[0] || null;
  }
  const name = a.replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{3,64}$/.test(name)) return null;
  const r = await query('SELECT * FROM users WHERE lower(username)=lower($1) ORDER BY created_at LIMIT 1', [name]);
  return r.rows[0] || null;
}

const num = x => Number(String(x || '').replace(',', '.'));
const label = u => `${u.first_name || '—'}${u.username ? ' @' + u.username : ''} (ID ${u.id})`;

const HELP = `Команды администратора:
/give ПОЛЬЗОВАТЕЛЬ N — добавить N ⚡
/take ПОЛЬЗОВАТЕЛЬ N — убрать N ⚡ (ниже нуля не уйдёт)
/user ПОЛЬЗОВАТЕЛЬ — баланс и статистика
/partner ПОЛЬЗОВАТЕЛЬ P1 [P2] — особые условия блогера: P1% с пополнений приглашённых и P2% от бонуса его приглашённого
/unpartner ПОЛЬЗОВАТЕЛЬ — вернуть обычные ступени
/refs ПОЛЬЗОВАТЕЛЬ — кого он пригласил и кто из них платил
/setref ПЛАТЕЛЬЩИК ПРИГЛАСИВШИЙ — привязать вручную (если пригласившего ещё нет; бонусы за прошлые оплаты не начисляются)
/pending — платежи, которые ждут подтверждения
/ai ПОЛЬЗОВАТЕЛЬ — вернуть диалог поддержки ИИ-помощнику (по умолчанию он снова отвечает сам через 24 ч после вашего последнего сообщения)
Чтобы ответить клиенту в поддержке, нажмите «Ответить» на сообщение о его вопросе.
/stats — сводка
ПОЛЬЗОВАТЕЛЬ — это числовой ID или @username (человек должен хотя бы раз открыть приложение).

/unlim ПОЛЬЗОВАТЕЛЬ УРОВЕНЬ ДНЕЙ — выдать безлимит вручную (уровень 1 — Ультра, 2 — Безлимит; 0 — отключить)

` + COMMUNITY_HELP;

// Команды администратора из чата с ботом. Возвращает текст ответа.
export async function adminCommand(text) {
  const [cmdRaw, ...args] = text.trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@\w+$/, '');

  if (cmd === '/help' || cmd === '/admin') return HELP;

  const community = await communityCommand(cmd, args, text);
  if (community !== null) return community;

  if (cmd === '/unlim') {
    const u = await findUser(args[0]);
    const tier = parseInt(args[1], 10);
    const days = parseInt(args[2], 10);
    if (!u || ![0, 1, 2].includes(tier) || (tier && (!Number.isInteger(days) || days < 1 || days > 365))) {
      return 'Пример: /unlim @username 1 30 (уровень 1 — Ультра, 2 — Безлимит; /unlim @username 0 — отключить)';
    }
    if (!tier) {
      await query('UPDATE users SET unlim_tier=NULL, unlim_until=NULL WHERE id=$1', [u.id]);
      return `Безлимит у ${label(u)} отключён.`;
    }
    const r = await query(`UPDATE users SET unlim_tier=$2, unlim_until=GREATEST(COALESCE(unlim_until, now()), now()) + ($3 || ' days')::interval WHERE id=$1 RETURNING unlim_until`, [u.id, tier, String(days)]);
    const till = new Date(r.rows[0].unlim_until).toLocaleDateString('ru-RU', { timeZone: 'Asia/Dushanbe' });
    await sendMessage(u.id, `♾ Вам подключён безлимит до ${till}. Модели со значком ∞ генерируются без списания ⚡.`);
    return `Готово: у ${label(u)} безлимит уровня ${tier} до ${till}.`;
  }

  if (cmd === '/stats') {
    const r = await query(`SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM payments WHERE status='paid') AS payments,
      (SELECT COALESCE(SUM(tjs),0) FROM payments WHERE status='paid') AS revenue,
      (SELECT COALESCE(SUM(ref_balance),0) FROM users) AS owed,
      (SELECT COUNT(*) FROM payments WHERE status='review') AS review,
      (SELECT COUNT(*) FROM withdrawals WHERE status='pending') AS wd`);
    const s = r.rows[0];
    return `Пользователей: ${s.users}\nОплат: ${s.payments} на ${Number(s.revenue).toFixed(2)} TJS\nПартнёрам к выплате: ${Number(s.owed).toFixed(2)} TJS\nЖдут подтверждения: ${s.review}\nЗаявок на вывод: ${s.wd}`;
  }

  if (cmd === '/ai') {
    const u = await findUser(args[0]);
    if (!u) return 'Пользователь не найден. Нужен числовой ID или @username.';
    await returnToAI(u.id);
    return `🤖 Диалог поддержки с ${label(u)} снова ведёт ИИ-помощник.`;
  }

  if (cmd === '/pending') {
    const r = await query(
      `SELECT p.id, COALESCE(p.pay_amount, p.tjs) AS tjs, p.coins, p.status, u.first_name, u.username, u.id AS uid
       FROM payments p JOIN users u ON u.id=p.user_id
       WHERE p.status IN ('review','pending') AND p.created_at > now() - interval '3 days'
       ORDER BY p.id DESC LIMIT 15`);
    if (!r.rows.length) return 'Ожидающих платежей нет.';
    return r.rows.map(p => `№${p.id}: ${Number(p.tjs).toFixed(2)} TJS, ${p.coins} ⚡, ${label({ id: p.uid, first_name: p.first_name, username: p.username })}, ${p.status === 'review' ? 'ждёт подтверждения' : 'ещё не нажал «Я оплатил»'}`).join('\n')
      + '\n\nПодтвердить можно кнопками в сообщении о платеже.';
  }

  if (cmd === '/setref') {
    const u = await findUser(args[0]);
    const r = await findUser(args[1]);
    if (!u || !r) return 'Пример: /setref 123456789 987654321 (сначала плательщик, потом пригласивший)';
    if (String(u.id) === String(r.id)) return 'Нельзя пригласить самого себя.';
    if (u.referrer_id) return `У ${label(u)} уже есть пригласивший: ${u.referrer_id}. Менять нельзя.`;
    if (String(r.referrer_id) === String(u.id)) return 'Нельзя: этот человек сам приглашён плательщиком (получится круг).';
    const upd = await query('UPDATE users SET referrer_id=$2 WHERE id=$1 AND referrer_id IS NULL RETURNING id', [u.id, r.id]);
    if (!upd.rows[0]) return 'Не получилось: пригласивший уже записан.';
    return `Готово: ${label(u)} теперь приглашённый ${label(r)}. Бонусы пойдут со следующих оплат. За прошлые оплаты при желании начислите вручную.`;
  }

  if (cmd === '/refs') {
    const u = await findUser(args[0]);
    if (!u) return 'Пользователь не найден. Нужен числовой ID или @username.';
    const r = await query(
      `SELECT x.id, x.first_name, x.username, x.created_at,
              COUNT(p.id) FILTER (WHERE p.status='paid') AS n,
              COALESCE(SUM(p.tjs) FILTER (WHERE p.status='paid'),0) AS sum,
              COUNT(p.id) FILTER (WHERE p.status='review') AS rev
       FROM users x LEFT JOIN payments p ON p.user_id=x.id
       WHERE x.referrer_id=$1 GROUP BY x.id ORDER BY x.created_at DESC LIMIT 30`, [u.id]);
    if (!r.rows.length) return `${label(u)} пока никого не пригласил.`;
    return `Приглашённые ${label(u)} (последние ${r.rows.length}):\n` + r.rows.map(x =>
      `• ${label(x)}: ${Number(x.n) ? `оплат ${x.n} на ${Number(x.sum).toFixed(2)} TJS` : 'оплат нет'}${Number(x.rev) ? `, ждёт подтверждения: ${x.rev}` : ''}`).join('\n');
  }

  if (['/give', '/take', '/user', '/partner', '/unpartner'].includes(cmd)) {
    const u = await findUser(args[0]);
    if (!u) return 'Пользователь не найден. Укажите числовой ID или @username (он должен хотя бы раз открыть приложение).';

    if (cmd === '/user') {
      const st = await query(
        `SELECT (SELECT COUNT(*) FROM users WHERE referrer_id=$1) AS invited,
                (SELECT COUNT(DISTINCT p.user_id) FROM payments p JOIN users x ON x.id=p.user_id WHERE x.referrer_id=$1 AND p.status='paid') AS paying,
                (SELECT COALESCE(SUM(tjs),0) FROM payments WHERE user_id=$1 AND status='paid') AS spent,
                (SELECT COALESCE(SUM(amount_tjs),0) FROM referral_earnings WHERE beneficiary_id=$1) AS earned`, [u.id]);
      const s = st.rows[0];
      const partner = u.partner_rate1 !== null
        ? `ПАРТНЁР: ${pct(Number(u.partner_rate1))}%` + (u.partner_rate2 !== null ? ` + ${pct(Number(u.partner_rate2))}% от бонуса приглашённого` : '')
        : 'обычные ступени';
      return `${label(u)}\nБаланс: ${u.coins} ⚡\nПополнил на: ${Number(s.spent).toFixed(2)} TJS\nПриглашено: ${s.invited}, платящих: ${s.paying}\nПартнёрский баланс: ${Number(u.ref_balance).toFixed(2)} TJS (заработано ${Number(s.earned).toFixed(2)})\nУсловия: ${partner}\nПригласил: ${u.referrer_id || '—'}`;
    }

    if (cmd === '/give' || cmd === '/take') {
      const n = Math.floor(num(args[1]));
      if (!Number.isFinite(n) || n < 1 || n > 100000) return 'Укажите количество ⚡ от 1 до 100000. Пример: /give @name 50';
      if (cmd === '/give') {
        const r = await query('UPDATE users SET coins=coins+$1 WHERE id=$2 RETURNING coins', [n, u.id]);
        await sendMessage(u.id, `🎁 Вам начислено ${n} ⚡. Теперь у вас ${r.rows[0].coins} ⚡`);
        return `Добавлено ${n} ⚡. Теперь у ${label(u)}: ${r.rows[0].coins} ⚡`;
      }
      const r = await query('UPDATE users SET coins=GREATEST(coins-$1,0) WHERE id=$2 RETURNING coins', [n, u.id]);
      return `Списание выполнено. Теперь у ${label(u)}: ${r.rows[0].coins} ⚡ (было ${u.coins})`;
    }

    if (cmd === '/partner') {
      const r1 = num(args[1]);
      const r2 = args[2] === undefined ? null : num(args[2]);
      if (!Number.isFinite(r1) || r1 <= 0 || r1 > 50 || (r2 !== null && (!Number.isFinite(r2) || r2 < 0 || r2 > 50))) {
        return 'Укажите проценты от 1 до 50. Пример: /partner @name 15 15 (15% с пополнений приглашённых и 15% от бонуса его приглашённого)';
      }
      await query('UPDATE users SET partner_rate1=$1, partner_rate2=$2 WHERE id=$3', [r1 / 100, r2 === null || r2 === 0 ? null : r2 / 100, u.id]);
      await sendMessage(u.id, `🤝 Вам подключены партнёрские условия: ${pct(r1 / 100)}% с пополнений ваших приглашённых${r2 ? ` и ${pct(r2 / 100)}% от бонуса, который получают приглашённые вами партнёры` : ''}.`);
      return `Готово: ${label(u)} теперь партнёр — ${pct(r1 / 100)}%${r2 ? ` + ${pct(r2 / 100)}% от бонуса приглашённого` : ''}.`;
    }

    if (cmd === '/unpartner') {
      await query('UPDATE users SET partner_rate1=NULL, partner_rate2=NULL WHERE id=$1', [u.id]);
      return `${label(u)} снова на обычных ступенях.`;
    }
  }

  return 'Не понял команду. /help — список команд.';
}

// Нажатие кнопок «Подтвердить / Отклонить» под сообщением о платеже
export async function paymentDecision(action, paymentId) {
  if (action === 'ok') {
    const out = await creditPayment(paymentId);
    if (out.already) return { text: 'Этот платёж уже обработан.', done: false };
    return { text: `✅ Платёж №${paymentId} подтверждён: +${out.payment.coins} ⚡ зачислено.`, done: true };
  }
  const r = await query(
    `UPDATE payments SET status='rejected' WHERE id=$1 AND status IN ('pending','review') RETURNING user_id, COALESCE(pay_amount, tjs) AS tjs`,
    [paymentId]
  );
  if (!r.rows[0]) return { text: 'Этот платёж уже обработан.', done: false };
  await sendMessage(r.rows[0].user_id, `❌ Платёж №${paymentId} на ${Number(r.rows[0].tjs).toFixed(2)} TJS не подтверждён. Если вы переводили деньги, свяжитесь с администратором и приложите чек.`);
  return { text: `❌ Платёж №${paymentId} отклонён.`, done: true };
}

export { tgCall, getPackage };
