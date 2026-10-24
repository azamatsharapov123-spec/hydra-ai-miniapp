import { query } from '../lib/db.js';
import { authUser, sendError } from '../lib/auth.js';
import { WITHDRAW_MIN, refLink, refTier, nextTier, REF_TIERS, UNLIMITED } from '../lib/config.js';
import { communityData, submitTrend, joinContest } from '../lib/community.js';
import { quotaLeft, takeQuota, giveBack } from '../lib/limits.js';
import { videoUploadUrl } from '../lib/video.js';
import { MODELS } from '../lib/models.js';

// GET  /api/me                   — профиль, баланс, партнёрка, безлимит
// GET  /api/me?section=community — тренды пользователей, конкурсы, мои заявки
// POST /api/me {action:'trend_submit' | 'contest_join' | 'upload_url', ...}
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { user, isNew } = await authUser(req);
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.action === 'trend_submit') return res.status(200).json({ ok: true, ...(await submitTrend(user, b)) });
      if (b.action === 'contest_join') return res.status(200).json(await joinContest(user, b));
      // Remake: ссылка для загрузки видео прямо в наше хранилище (файл не проходит через сервер)
      if (b.action === 'upload_url') {
        const q = await takeQuota(user.id, 'upload', 60);
        if (!q.ok) return res.status(429).json({ error: 'Слишком много загрузок за сегодня. Попробуйте завтра.' });
        try {
          return res.status(200).json(await videoUploadUrl(user.id, String(b.type || ''), Number(b.size), req.headers['x-vercel-oidc-token']));
        } catch (e) {
          console.error('upload url', e && e.message);
          await giveBack(user.id, 'upload');
          return res.status(400).json({ error: /МБ|видеофайл/.test(e.message) ? e.message : 'Загрузка видео сейчас недоступна. Вставьте прямую ссылку на видео (.mp4)' });
        }
      }
      return res.status(400).json({ error: 'Неизвестное действие' });
    }
    if (req.query && req.query.section === 'community') {
      return res.status(200).json(await communityData(user));
    }
    // История генераций с сервера: не теряется при смене телефона или очистке Telegram
    if (req.query && req.query.section === 'history') {
      const r = await query(
        `SELECT model, result_url, params, created_at FROM jobs
         WHERE user_id=$1 AND status='done' AND result_url IS NOT NULL AND created_at > now() - interval '60 days'
         ORDER BY created_at DESC LIMIT 100`, [user.id]);
      return res.status(200).json({
        items: r.rows.map(j => {
          const m = MODELS.find(x => x.id === j.model);
          const p = (typeof j.params === 'string' ? JSON.parse(j.params) : j.params) || {};
          return {
            url: j.result_url, model: m ? m.name : j.model, modelId: j.model,
            category: m ? m.category : 'image', prompt: typeof p.prompt === 'string' ? p.prompt.slice(0, 2500) : '',
            ts: new Date(j.created_at).getTime()
          };
        })
      });
    }

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
      `SELECT id, COALESCE(pay_amount, tjs) AS tjs, coins, status FROM payments
       WHERE user_id=$1 AND created_at > now() - interval '30 days' ORDER BY id DESC LIMIT 5`, [user.id]);
    const until = user.unlim_until ? new Date(user.unlim_until) : null;
    const ut = until && until > new Date() ? Number(user.unlim_tier) || 0 : 0;
    let unlimited = null;
    if (ut && UNLIMITED[ut]) {
      const caps = UNLIMITED[ut].caps;
      unlimited = {
        tier: ut, name: UNLIMITED[ut].name, until: until.toISOString(),
        left: { image: await quotaLeft(user.id, 'unl_image', caps.image), video: await quotaLeft(user.id, 'unl_video', caps.video) },
        caps
      };
    }
    return res.status(200).json({
      id: String(user.id),
      unlimited,
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
