import { query, tx, HttpError } from './db.js';
import { getPackage, refTier, nextTier, pct } from './config.js';
import { sendMessage } from './bot.js';

const money = x => Math.round(x * 100) / 100;

// Добавки к сумме перевода в дирамах: 0,05 … 0,50 (максимум 50 дирам).
// У каждого открытого платежа на один пакет своя добавка, поэтому по сумме в банке
// видно, кто именно заплатил. В учёте (выручка, бонусы) используется цена пакета без добавки.
export const EXTRA_DIRAMS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

export function pickExtra(usedDirams, rnd = Math.random) {
  const used = new Set(usedDirams);
  const free = EXTRA_DIRAMS.filter(d => !used.has(d));
  if (free.length) return free[Math.floor(rnd() * free.length)];
  // все 10 заняты: берём самую редкую добавку
  const count = d => usedDirams.filter(x => x === d).length;
  const min = Math.min(...EXTRA_DIRAMS.map(count));
  const rare = EXTRA_DIRAMS.filter(d => count(d) === min);
  return rare[Math.floor(rnd() * rare.length)];
}

export async function createPayment(userId, packageId, provider = 'manual', providerRef = null, method = null) {
  const pkg = getPackage(packageId);
  if (!pkg) throw new HttpError(400, 'Неизвестный пакет');
  return tx(async c => {
    // не даём двум одновременным платежам выбрать одну и ту же добавку
    await c.query('SELECT pg_advisory_xact_lock(727002)');
    const open = await c.query(
      `SELECT ROUND((pay_amount - tjs) * 100)::int AS d FROM payments
       WHERE tjs = $1 AND pay_amount IS NOT NULL AND status IN ('pending','review')
         AND created_at > now() - interval '72 hours'`,
      [pkg.tjs]
    );
    const extra = pickExtra(open.rows.map(r => Number(r.d)));
    const amount = Math.round(pkg.tjs * 100 + extra) / 100;
    const r = await c.query(
      `INSERT INTO payments (user_id, package_id, tjs, coins, provider, provider_ref, method, pay_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [userId, pkg.id, pkg.tjs, pkg.tokens, provider, providerRef, method, amount]
    );
    return r.rows[0];
  });
}

// Сумма, которую должен перевести клиент (для старых платежей без добавки — цена пакета)
export const payAmount = p => Number(p.pay_amount ?? p.tjs);

// Зачисляет оплаченный платёж. Безопасно вызывать повторно: второй вызов ничего не делает.
// Это та функция, которую вызовет вебхук банка после подтверждения оплаты.
export async function creditPayment(paymentId) {
  const notes = [];
  const result = await tx(async c => {
    const p = await c.query(
      `UPDATE payments SET status='paid', paid_at=now() WHERE id=$1 AND status IN ('pending','review') RETURNING *`,
      [paymentId]
    );
    if (!p.rows[0]) return { already: true };
    const pay = p.rows[0];
    const tjs = Number(pay.tjs);

    const u = await c.query(
      'UPDATE users SET coins=coins+$1 WHERE id=$2 RETURNING id, first_name, username, referrer_id, coins',
      [pay.coins, pay.user_id]
    );
    const payer = u.rows[0];
    notes.push([payer.id, `✅ Баланс пополнен: +${pay.coins} ⚡\nТеперь у вас ${payer.coins} ⚡`]);

    const bonuses = [];
    // Бонус получает тот, кто пригласил плательщика.
    // Обычный пользователь: процент по ступени (число платящих приглашённых).
    // Партнёр-блогер: личный процент (partner_rate1), и ещё partner_rate2 от бонуса его приглашённого.
    if (payer.referrer_id) {
      const ru = (await c.query('SELECT id, referrer_id, partner_rate1 FROM users WHERE id=$1', [payer.referrer_id])).rows[0];
      let rate, paying = null;
      if (ru.partner_rate1 !== null) {
        rate = Number(ru.partner_rate1);
      } else {
        const cnt = await c.query(
          `SELECT COUNT(DISTINCT p.user_id) AS n
           FROM payments p JOIN users u ON u.id = p.user_id
           WHERE u.referrer_id = $1 AND p.status = 'paid'`,
          [ru.id]
        );
        paying = Number(cnt.rows[0].n);
        rate = refTier(paying).rate;
      }
      const a1 = money(tjs * rate);
      if (a1 > 0) {
        await c.query(
          `INSERT INTO referral_earnings (payment_id, beneficiary_id, from_user_id, level, amount_tjs)
           VALUES ($1,$2,$3,1,$4)`,
          [pay.id, ru.id, payer.id, a1]
        );
        const b = await c.query('UPDATE users SET ref_balance=ref_balance+$1 WHERE id=$2 RETURNING ref_balance', [a1, ru.id]);
        bonuses.push({ level: 1, user: ru.id, amount: a1, rate, paying });
        let text = `💰 Вам начислено ${a1.toFixed(2)} TJS: ${pct(rate)}% с пополнения вашего приглашённого.\nПартнёрский баланс: ${Number(b.rows[0].ref_balance).toFixed(2)} TJS`;
        const nt = paying === null ? null : nextTier(paying);
        if (nt && nt.rate > rate && nt.min - paying <= 3) {
          text += `\n\nЕщё ${nt.min - paying} платящих приглашённых, и ваш процент вырастет до ${pct(nt.rate)}%.`;
        }
        notes.push([ru.id, text]);

        // 2-й уровень: только для партнёров-блогеров. Платит компания сверху.
        if (ru.referrer_id) {
          const pu = (await c.query('SELECT id, partner_rate2 FROM users WHERE id=$1', [ru.referrer_id])).rows[0];
          if (pu && pu.partner_rate2 !== null) {
            const r2 = Number(pu.partner_rate2);
            const a2 = money(a1 * r2);
            if (a2 > 0) {
              await c.query(
                `INSERT INTO referral_earnings (payment_id, beneficiary_id, from_user_id, level, amount_tjs)
                 VALUES ($1,$2,$3,2,$4)`,
                [pay.id, pu.id, payer.id, a2]
              );
              const b2 = await c.query('UPDATE users SET ref_balance=ref_balance+$1 WHERE id=$2 RETURNING ref_balance', [a2, pu.id]);
              bonuses.push({ level: 2, user: pu.id, amount: a2, rate: r2 });
              notes.push([pu.id, `💰 Вам начислено ${a2.toFixed(2)} TJS: ${pct(r2)}% от бонуса вашего приглашённого партнёра.\nПартнёрский баланс: ${Number(b2.rows[0].ref_balance).toFixed(2)} TJS`]);
            }
          }
        }
      }
    }
    return { already: false, payment: pay, bonuses };
  });

  // уведомления отправляем уже после сохранения в базе
  for (const [uid, text] of notes) await sendMessage(uid, text);
  return result;
}
