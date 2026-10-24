import crypto from 'crypto';
import { query, tx } from '../lib/db.js';
import { createPayment, creditPayment } from '../lib/payments.js';
import { webhookSecret, sendMessage } from '../lib/bot.js';
import { getPackage } from '../lib/config.js';
import { buildReport } from '../lib/report.js';

const sha = s => crypto.createHash('sha256').update(String(s)).digest();

// Служебная страница владельца. Открывается в браузере:
//   /api/admin?key=ВАШ_ADMIN_SECRET&action=...
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Ежедневный отчёт по расписанию Vercel Cron (vercel.json): Vercel присылает заголовок с CRON_SECRET
  const cron = process.env.CRON_SECRET;
  if (req.query?.action === 'daily_report' && cron && cron.length >= 16) {
    const auth = String(req.headers.authorization || '');
    if (auth.length === cron.length + 7 && crypto.timingSafeEqual(Buffer.from(auth), Buffer.from('Bearer ' + cron))) {
      try {
        const text = await buildReport(1);
        const ok = await sendMessage(process.env.ADMIN_CHAT_ID, text);
        return res.json({ ok });
      } catch (e) {
        console.error('daily report', e && e.message);
        await sendMessage(process.env.ADMIN_CHAT_ID, 'Не получилось собрать ежедневный отчёт: ' + (e && e.message)).catch(() => {});
        return res.status(500).json({ error: 'report failed' });
      }
    }
  }
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length < 12) return res.status(503).json({ error: 'ADMIN_SECRET не настроен (нужно минимум 12 символов)' });
  const key = req.query?.key || req.headers['x-admin-key'] || '';
  if (!crypto.timingSafeEqual(sha(key), sha(secret))) return res.status(403).json({ error: 'forbidden' });

  const q = req.query || {};
  const action = q.action || 'help';
  try {
    if (action === 'help') {
      return res.json({
        actions: {
          setwebhook: 'подключить бота (один раз)',
          webhookinfo: 'состояние вебхука',
          stats: 'сводка',
          user: 'user=ID — данные пользователя',
          topup: 'user=ID&package=trial|start|standard|pro|max|ultra|unlimited — зачислить как оплаченный платёж (с реферальными бонусами)',
          gift: 'user=ID&coins=N — просто добавить ⚡ без бонусов',
          withdrawals: 'список заявок на вывод',
          withdrawal_done: 'id=N — отметить выплаченной',
          withdrawal_reject: 'id=N — отклонить и вернуть сумму на партнёрский баланс'
        }
      });
    }

    if (action === 'setwebhook' || action === 'webhookinfo') {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN не настроен' });
      if (action === 'webhookinfo') {
        const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
        const d = await r.json();
        return res.json({ ok: d.ok, url: d.result?.url, pending: d.result?.pending_update_count, last_error: d.result?.last_error_message });
      }
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const url = `https://${host}/api/bot`;
      const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, secret_token: webhookSecret(), allowed_updates: ['message', 'callback_query'], drop_pending_updates: true })
      });
      const d = await r.json();
      return res.json({ ok: d.ok, description: d.description, webhook_url: url });
    }

    if (action === 'stats') {
      const r = await query(`SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM payments WHERE status='paid') AS payments,
        (SELECT COALESCE(SUM(tjs),0) FROM payments WHERE status='paid') AS revenue_tjs,
        (SELECT COALESCE(SUM(amount_tjs),0) FROM referral_earnings) AS ref_total_tjs,
        (SELECT COALESCE(SUM(ref_balance),0) FROM users) AS ref_owed_tjs,
        (SELECT COUNT(*) FROM withdrawals WHERE status='pending') AS pending_withdrawals`);
      return res.json(r.rows[0]);
    }

    if (action === 'user') {
      const r = await query('SELECT * FROM users WHERE id=$1', [q.user]);
      return res.json(r.rows[0] || { error: 'не найден' });
    }

    if (action === 'topup') {
      const u = await query('SELECT id FROM users WHERE id=$1', [q.user]);
      if (!u.rows[0]) return res.status(404).json({ error: 'Пользователь не найден (он должен хотя бы раз открыть приложение)' });
      if (!getPackage(q.package)) return res.status(400).json({ error: 'Неизвестный пакет' });
      const pay = await createPayment(u.rows[0].id, q.package, 'manual');
      const out = await creditPayment(pay.id);
      return res.json({ ok: true, payment_id: pay.id, bonuses: out.bonuses });
    }

    if (action === 'gift') {
      const n = parseInt(q.coins, 10);
      if (!Number.isInteger(n) || n < 1 || n > 100000) return res.status(400).json({ error: 'coins: от 1 до 100000' });
      const r = await query('UPDATE users SET coins=coins+$1 WHERE id=$2 RETURNING coins', [n, q.user]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Пользователь не найден' });
      await sendMessage(q.user, `🎁 Вам начислено ${n} ⚡`);
      return res.json({ ok: true, coins: r.rows[0].coins });
    }

    if (action === 'withdrawals') {
      const r = await query(
        `SELECT w.id, w.user_id, u.first_name, u.username, w.amount_tjs, w.details, w.status, w.created_at
         FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 50`);
      return res.json(r.rows);
    }

    if (action === 'withdrawal_done' || action === 'withdrawal_reject') {
      const out = await tx(async c => {
        const w = await c.query(
          `UPDATE withdrawals SET status=$2, processed_at=now() WHERE id=$1 AND status='pending' RETURNING *`,
          [q.id, action === 'withdrawal_done' ? 'paid' : 'rejected']
        );
        if (!w.rows[0]) return null;
        if (action === 'withdrawal_reject') {
          await c.query('UPDATE users SET ref_balance=ref_balance+$1 WHERE id=$2', [w.rows[0].amount_tjs, w.rows[0].user_id]);
        }
        return w.rows[0];
      });
      if (!out) return res.status(404).json({ error: 'Заявка не найдена или уже обработана' });
      await sendMessage(out.user_id, action === 'withdrawal_done'
        ? `✅ Выплата ${Number(out.amount_tjs).toFixed(2)} TJS отправлена.`
        : `❌ Заявка на вывод отклонена, ${Number(out.amount_tjs).toFixed(2)} TJS возвращены на партнёрский баланс.`);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'неизвестное действие' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
