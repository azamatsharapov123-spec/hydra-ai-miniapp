import { query, tx, HttpError } from './db.js';
import { getPackage, REF_RATE_L1, REF_RATE_L2, pct } from './config.js';
import { sendMessage } from './bot.js';

const money = x => Math.round(x * 100) / 100;

export async function createPayment(userId, packageId, provider = 'manual', providerRef = null) {
  const pkg = getPackage(packageId);
  if (!pkg) throw new HttpError(400, 'Неизвестный пакет');
  const r = await query(
    `INSERT INTO payments (user_id, package_id, tjs, coins, provider, provider_ref)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [userId, pkg.id, pkg.tjs, pkg.tokens, provider, providerRef]
  );
  return r.rows[0];
}

// Зачисляет оплаченный платёж. Безопасно вызывать повторно: второй вызов ничего не делает.
// Это та функция, которую вызовет вебхук банка после подтверждения оплаты.
export async function creditPayment(paymentId) {
  const notes = [];
  const result = await tx(async c => {
    const p = await c.query(
      `UPDATE payments SET status='paid', paid_at=now() WHERE id=$1 AND status='pending' RETURNING *`,
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
    // 1-й уровень: тот, кто пригласил плательщика, получает 15% от суммы
    if (payer.referrer_id) {
      const a1 = money(tjs * REF_RATE_L1);
      if (a1 > 0) {
        await c.query(
          `INSERT INTO referral_earnings (payment_id, beneficiary_id, from_user_id, level, amount_tjs)
           VALUES ($1,$2,$3,1,$4)`,
          [pay.id, payer.referrer_id, payer.id, a1]
        );
        const b = await c.query(
          'UPDATE users SET ref_balance=ref_balance+$1 WHERE id=$2 RETURNING id, referrer_id, ref_balance',
          [a1, payer.referrer_id]
        );
        const l1 = b.rows[0];
        bonuses.push({ level: 1, user: l1.id, amount: a1 });
        notes.push([l1.id, `💰 Вам начислено ${a1.toFixed(2)} TJS: ${pct(REF_RATE_L1)}% с пополнения вашего приглашённого.\nПартнёрский баланс: ${Number(l1.ref_balance).toFixed(2)} TJS`]);

        // 2-й уровень: пригласивший его получает 20% от этого бонуса (3% от суммы), платит компания
        if (l1.referrer_id) {
          const a2 = money(a1 * REF_RATE_L2);
          if (a2 > 0) {
            await c.query(
              `INSERT INTO referral_earnings (payment_id, beneficiary_id, from_user_id, level, amount_tjs)
               VALUES ($1,$2,$3,2,$4)`,
              [pay.id, l1.referrer_id, payer.id, a2]
            );
            const b2 = await c.query(
              'UPDATE users SET ref_balance=ref_balance+$1 WHERE id=$2 RETURNING id, ref_balance',
              [a2, l1.referrer_id]
            );
            bonuses.push({ level: 2, user: b2.rows[0].id, amount: a2 });
            notes.push([b2.rows[0].id, `💰 Вам начислено ${a2.toFixed(2)} TJS: ${pct(REF_RATE_L1 * REF_RATE_L2)}% с пополнения пользователя из вашей сети.\nПартнёрский баланс: ${Number(b2.rows[0].ref_balance).toFixed(2)} TJS`]);
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
