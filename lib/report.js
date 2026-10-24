// Ежедневный отчёт владельцу: сколько ⚡ потратили пользователи, по нейросетям и провайдерам,
// оплаты и остатки на балансах провайдеров. Приходит в бот в 21:00 (Душанбе) и по команде /report.
import { query } from './db.js';
import { MODELS, TOKEN_USD, GROUP_MARKUP } from './models.js';
import { USD_RATE } from './config.js';

const TZ = 'Asia/Dushanbe';
const KIE_CREDIT_USD = 0.005;              // 1 кредит Kie = $0,005
const LOW_BALANCE_USD = 10;                // ниже этого — предупреждение «пополните»
const PROVIDER_NAMES = { kie: 'Kie.ai', fal: 'fal.ai', atlas: 'Atlas Cloud', replicate: 'Replicate' };

const usd = x => '$' + Number(x || 0).toFixed(2);
const n = x => Number(x || 0);

async function getJson(url, headers) {
  const r = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(8000) });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) throw new Error(`HTTP ${r.status}`);
  return d;
}

// Остатки у провайдеров. Для каждого: { usd, text } или { error }
async function providerBalances() {
  const out = {};
  const jobs = [];
  if (process.env.KIE_API_KEY) {
    jobs.push(getJson('https://api.kie.ai/api/v1/chat/credit', { Authorization: `Bearer ${process.env.KIE_API_KEY}` })
      .then(d => {
        if (Number(d.code) !== 200) throw new Error(d.msg || `код ${d.code}`);
        const credits = n(d.data);
        out.kie = { usd: credits * KIE_CREDIT_USD, text: `${credits.toLocaleString('ru-RU')} кредитов ≈ ${usd(credits * KIE_CREDIT_USD)}` };
      }).catch(e => { out.kie = { error: e.message }; }));
  }
  // Обычный ключ генерации баланс не видит: нужен ключ с правом чтения биллинга (FAL_BILLING_KEY, тип READONLY или BILLING)
  const falKey = process.env.FAL_BILLING_KEY || process.env.FAL_KEY;
  if (falKey) {
    jobs.push(getJson('https://api.fal.ai/v1/account/billing?expand=credits', { Authorization: `Key ${falKey}` })
      .then(d => {
        const b = d.credits && d.credits.current_balance;
        if (b === undefined || b === null) throw new Error('ключ без доступа к балансу');
        out.fal = { usd: n(b), text: usd(b) };
      }).catch(e => { out.fal = { error: /403|401/.test(e.message) ? 'добавьте в Vercel FAL_BILLING_KEY — ключ fal с правом READONLY' : e.message }; }));
  }
  if (process.env.ATLAS_API_KEY) {
    jobs.push(getJson('https://api.atlascloud.ai/public/v1/balance', { Authorization: `Bearer ${process.env.ATLAS_API_KEY}` })
      .then(d => {
        const v = d.available && d.available.value;
        if (v === undefined) throw new Error('нет данных');
        out.atlas = { usd: n(v), text: usd(v) };
      }).catch(e => { out.atlas = { error: e.message }; }));
  }
  if (process.env.REPLICATE_API_TOKEN) out.replicate = { note: 'баланс через API не отдаёт, смотрите replicate.com/account/billing' };
  await Promise.all(jobs);
  return out;
}

// Оценка себестоимости задачи в долларах: у Kie — точно по списанным кредитам, у остальных — по цене модели
function jobCostUsd(row) {
  if (row.provider === 'kie' && row.provider_credits !== null && row.provider_credits !== undefined) {
    return { usd: n(row.provider_credits) * KIE_CREDIT_USD, exact: true };
  }
  const m = MODELS.find(x => x.id === row.model);
  const g = (m && GROUP_MARKUP[m.group]) || 1;
  return { usd: n(row.cost) * TOKEN_USD / g, exact: false };
}

// days — за сколько суток (1 = сегодня по Душанбе)
export async function buildReport(days = 1) {
  const d = Math.min(31, Math.max(1, parseInt(days, 10) || 1));
  const since = `date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}' - interval '${d - 1} days'`;

  const [jobsR, sumR, balances] = await Promise.all([
    query(`SELECT model, provider, status, cost, unl, provider_credits FROM jobs WHERE created_at >= ${since}`),
    query(`SELECT
      (SELECT COUNT(*) FROM users WHERE created_at >= ${since}) AS new_users,
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(DISTINCT user_id) FROM jobs WHERE created_at >= ${since}) AS active,
      (SELECT COUNT(*) FROM payments WHERE status='paid' AND paid_at >= ${since}) AS pays,
      (SELECT COALESCE(SUM(COALESCE(pay_amount, tjs)),0) FROM payments WHERE status='paid' AND paid_at >= ${since}) AS revenue,
      (SELECT COALESCE(SUM(coins),0) FROM payments WHERE status='paid' AND paid_at >= ${since}) AS sold,
      (SELECT COALESCE(SUM(amount_tjs),0) FROM referral_earnings WHERE created_at >= ${since}) AS refs,
      (SELECT COALESCE(SUM(coins),0) FROM users) AS coins_left,
      (SELECT COALESCE(SUM(ref_balance),0) FROM users) AS owed`),
    providerBalances().catch(() => ({}))
  ]);
  const s = sumR.rows[0];

  // По нейросетям и провайдерам
  const byModel = {}, byProv = {};
  let spent = 0, gens = 0, refunded = 0, refundedCoins = 0, unl = 0, pending = 0, costUsd = 0, approx = false;
  for (const j of jobsR.rows) {
    if (j.status === 'refunded') { refunded++; refundedCoins += n(j.cost); continue; }
    if (j.status === 'pending') pending++;
    gens++;
    spent += n(j.cost);
    if (j.unl) unl++;
    const m = MODELS.find(x => x.id === j.model);
    const name = m ? m.name : j.model;
    const bm = byModel[name] || (byModel[name] = { n: 0, coins: 0 });
    bm.n++; bm.coins += n(j.cost);
    const c = jobCostUsd(j);
    if (!c.exact) approx = true;
    costUsd += c.usd;
    const p = j.provider === 'switching' ? 'kie' : j.provider;
    const bp = byProv[p] || (byProv[p] = { n: 0, usd: 0, credits: 0 });
    bp.n++; bp.usd += c.usd; bp.credits += n(j.provider_credits);
  }

  const today = new Date().toLocaleDateString('ru-RU', { timeZone: TZ });
  const L = [];
  L.push(d === 1 ? `📊 Отчёт Hydra за ${today}` : `📊 Отчёт Hydra за ${d} дн. (по ${today})`);
  L.push('');
  L.push(`👥 Новых пользователей: ${s.new_users} (всего ${s.users}), генерировали: ${s.active}`);
  L.push(`💰 Оплат: ${s.pays} на ${n(s.revenue).toFixed(2)} TJS (продано ${n(s.sold)} ⚡)`);
  L.push(`🤝 Партнёрам начислено: ${n(s.refs).toFixed(2)} TJS`);
  L.push('');
  L.push(`⚡ Потрачено пользователями: ${spent} ⚡ за ${gens} генераций${unl ? `, из них по безлимиту ${unl}` : ''}${pending ? `, ещё идут ${pending}` : ''}`);
  if (refunded) L.push(`↩️ Не получились и вернулись: ${refunded} (${refundedCoins} ⚡)`);
  L.push(`💸 Себестоимость у провайдеров: ${approx ? '≈ ' : ''}${usd(costUsd)} (≈ ${(costUsd * USD_RATE).toFixed(2)} TJS)`);

  const models = Object.entries(byModel).sort((a, b) => b[1].coins - a[1].coins || b[1].n - a[1].n);
  if (models.length) {
    L.push('');
    L.push('🧠 По нейросетям:');
    for (const [name, v] of models.slice(0, 15)) L.push(`• ${name}: ${v.n} шт., ${v.coins} ⚡`);
    if (models.length > 15) L.push(`• и ещё ${models.length - 15} моделей`);
  }

  const provs = Object.entries(byProv).sort((a, b) => b[1].usd - a[1].usd);
  if (provs.length) {
    L.push('');
    L.push('🛰 По платформам (расход):');
    for (const [p, v] of provs) {
      L.push(`• ${PROVIDER_NAMES[p] || p}: ${v.n} задач, ${p === 'kie' && v.credits ? `${v.credits} кредитов ≈ ${usd(v.usd)}` : `≈ ${usd(v.usd)}`}`);
    }
  }

  L.push('');
  L.push('🏦 Остаток на балансах платформ:');
  const order = ['kie', 'fal', 'atlas', 'replicate'];
  let warn = [];
  for (const p of order) {
    const b = balances[p];
    if (!b) continue;
    if (b.note) { L.push(`• ${PROVIDER_NAMES[p]}: ${b.note}`); continue; }
    if (b.error) { L.push(`• ${PROVIDER_NAMES[p]}: не удалось узнать (${b.error})`); continue; }
    L.push(`• ${PROVIDER_NAMES[p]}: ${b.text}`);
    if (b.usd < LOW_BALANCE_USD) warn.push(PROVIDER_NAMES[p]);
  }
  L.push('');
  L.push(`🪙 На балансах пользователей: ${n(s.coins_left)} ⚡ (обязательства перед клиентами)`);
  L.push(`🏧 Партнёрам к выплате всего: ${n(s.owed).toFixed(2)} TJS`);
  if (warn.length) {
    L.push('');
    L.push(`⚠️ Пора пополнить: ${warn.join(', ')} — осталось меньше ${usd(LOW_BALANCE_USD)}.`);
  }
  return L.join('\n');
}
