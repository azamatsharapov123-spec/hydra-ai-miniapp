import { query } from '../lib/db.js';
import { authUser, sendError } from '../lib/auth.js';
import { WITHDRAW_MIN, refLink, refTier, nextTier, REF_TIERS } from '../lib/config.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { user, isNew } = await authUser(req);

    // Задачи, которые зависли больше 70 минут (результат уже не получить), возвращают ⚡
    const fix = await query(
      `WITH s AS (
         UPDATE jobs SET status='refunded'
         WHERE user_id=$1 AND status='pending' AND created_at < now() - interval '70 minutes'
         RETURNING cost)
       UPDATE users SET coins = coins + COALESCE((SELECT SUM(cost) FROM s), 0)
       WHERE id=$1 RETURNING coins`,
      [user.id]
    );
    const coins = fix.rows[0].coins;

    const st = await query(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE referrer_id=$1) AS l1,
         (SELECT COUNT(DISTINCT p.user_id) FROM payments p JOIN users u ON u.id=p.user_id
            WHERE u.referrer_id=$1 AND p.status='paid') AS paying,
         (SELECT COALESCE(SUM(amount_tjs),0) FROM referral_earnings WHERE beneficiary_id=$1) AS earned,
         (SELECT ref_balance FROM users WHERE id=$1) AS balance,
         (SELECT partner_rate1 FROM users WHERE id=$1) AS p1,
         (SELECT partner_rate2 FROM users WHERE id=$1) AS p2,
         (SELECT COALESCE(SUM(amount_tjs),0) FROM withdrawals WHERE user_id=$1 AND status='pending') AS pending_wd`,
      [user.id]
    );
    const s = st.rows[0];
    const paying = Number(s.paying);
    const isPartner = s.p1 !== null;
    const tier = isPartner ? { rate: Number(s.p1) } : refTier(paying);
    const nt = isPartner ? null : nextTier(paying);
    const pays = await query(
      `SELECT id, tjs, coins, status FROM payments
       WHERE user_id=$1 AND created_at > now() - interval '30 days' ORDER BY id DESC LIMIT 5`, [user.id]);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      id: String(user.id),
      coins,
      is_new: isNew,
      ref_code: user.ref_code,
      ref_link: refLink(user.ref_code),
      ref_balance: Number(s.balance),
      ref_earned: Number(s.earned),
      ref_l1: Number(s.l1),
      ref_paying: paying,
      ref_partner: isPartner ? { rate1: Number(s.p1), rate2: s.p2 === null ? null : Number(s.p2) } : null,
      payments: pays.rows.map(p => ({ id: p.id, tjs: Number(p.tjs), coins: p.coins, status: p.status })),
      ref_rate: tier.rate,
      ref_next: nt ? { at: nt.min, rate: nt.rate } : null,
      ref_tiers: isPartner ? null : REF_TIERS,
      withdraw_pending: Number(s.pending_wd),
      withdraw_min: WITHDRAW_MIN
    });
  } catch (e) {
    return sendError(res, e);
  }
}
