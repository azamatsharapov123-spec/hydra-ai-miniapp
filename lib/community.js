import { query, HttpError } from './db.js';
import { sendMessage, tgCall } from './bot.js';
import { TREND_CATEGORIES, trendCategory } from './config.js';

// ===== Тренды от пользователей =====
// Клиент отправляет свою генерацию в тренды и сам выбирает рубрику.
// Администратор в боте одобряет (оставляет рубрику или меняет) или отклоняет.

const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export async function submitTrend(user, body) {
  const url = String(body.url || '');
  const title = clean(body.title, 60);
  const category = String(body.category || '');
  const prompt = clean(body.prompt, 2500);
  if (!/^https:\/\//.test(url) || url.length > 600) throw new HttpError(400, 'Неверная ссылка на результат');
  if (title.length < 3) throw new HttpError(400, 'Придумайте название тренда (от 3 символов)');
  if (!trendCategory(category) || category === 'community') throw new HttpError(400, 'Выберите рубрику');

  // Отправить можно только свой результат, сделанный в приложении
  const j = await query(
    `SELECT id, model, params FROM jobs WHERE user_id=$1 AND result_url=$2 AND status='done' ORDER BY created_at DESC LIMIT 1`,
    [user.id, url]
  );
  const job = j.rows[0];
  if (!job) throw new HttpError(400, 'Можно отправить только результат, созданный в Hydra AI Studio за последние недели');

  const recent = await query(
    `SELECT COUNT(*) AS n FROM trend_submissions WHERE user_id=$1 AND created_at > now() - interval '1 day'`, [user.id]);
  if (Number(recent.rows[0].n) >= 5) throw new HttpError(429, 'Не больше 5 заявок в сутки');

  const kind = /\.(mp4|mov|webm)(\?|$)/i.test(url) || /video/.test(String(job.model)) ? 'video' : 'image';
  let ins;
  try {
    ins = await query(
      `INSERT INTO trend_submissions (user_id, job_id, url, kind, model, prompt, params, title, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [user.id, job.id, url, kind, job.model, prompt, job.params ? JSON.stringify(job.params) : null, title, category]
    );
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Этот результат уже отправлен в тренды');
    throw e;
  }
  const id = ins.rows[0].id;
  await notifyAdminTrend(id);
  return { id };
}

const catName = id => (trendCategory(id) || { name: id }).name;
const who = u => `${u.first_name || '—'}${u.username ? ' @' + u.username : ''} (ID ${u.id})`;

function trendKeyboard(id) {
  return {
    inline_keyboard: [
      [{ text: '✅ Одобрить в эту рубрику', callback_data: `tr:ok:${id}` }],
      [{ text: '📂 Сменить рубрику', callback_data: `tr:cat:${id}` }, { text: '❌ Отклонить', callback_data: `tr:no:${id}` }]
    ]
  };
}

async function notifyAdminTrend(id) {
  const chat = process.env.ADMIN_CHAT_ID;
  if (!chat) return;
  const r = await query(
    `SELECT s.*, u.first_name, u.username FROM trend_submissions s JOIN users u ON u.id=s.user_id WHERE s.id=$1`, [id]);
  const s = r.rows[0];
  if (!s) return;
  const caption = `⭐ Заявка в тренды №${s.id}\nОт: ${who({ id: s.user_id, first_name: s.first_name, username: s.username })}\nНазвание: ${s.title}\nРубрика: ${catName(s.category)}\nМодель: ${s.model}\n\nПромпт: ${String(s.prompt || '—').slice(0, 700)}`;
  const method = s.kind === 'video' ? 'sendVideo' : 'sendPhoto';
  const sent = await tgCall(method, { chat_id: chat, [s.kind === 'video' ? 'video' : 'photo']: s.url, caption: caption.slice(0, 1000), reply_markup: trendKeyboard(s.id) });
  if (!sent || !sent.ok) await sendMessage(chat, caption + `\n\nФайл: ${s.url}`, { reply_markup: trendKeyboard(s.id) });
}

// Кнопки администратора под заявкой. Возвращает { text, keyboard? , done }
export async function trendDecision(action, id, catIdx) {
  const r = await query('SELECT * FROM trend_submissions WHERE id=$1', [id]);
  const s = r.rows[0];
  if (!s) return { text: 'Заявка не найдена', done: true };
  if (s.status !== 'pending' && action !== 'cat') return { text: `Заявка №${id} уже обработана`, done: true };

  if (action === 'cat') {
    const rows = [];
    const cats = TREND_CATEGORIES.filter(c => c.id !== 'community');
    for (let i = 0; i < cats.length; i += 2) {
      rows.push(cats.slice(i, i + 2).map(c => ({ text: c.name, callback_data: `tr:set:${id}:${TREND_CATEGORIES.indexOf(c)}` })));
    }
    rows.push([{ text: '⬅️ Назад', callback_data: `tr:back:${id}` }]);
    return { text: 'Выберите рубрику', keyboard: { inline_keyboard: rows } };
  }
  if (action === 'back') return { text: 'Готово', keyboard: trendKeyboard(id) };

  if (action === 'no') {
    await query(`UPDATE trend_submissions SET status='rejected', decided_at=now() WHERE id=$1 AND status='pending'`, [id]);
    await sendMessage(s.user_id, `Спасибо за заявку «${s.title}»! В этот раз она не попала в тренды. Попробуйте отправить другой результат 🙌`);
    return { text: `❌ Заявка №${id} отклонена`, done: true };
  }

  let category = s.category;
  if (action === 'set') {
    const c = TREND_CATEGORIES[Number(catIdx)];
    if (!c) return { text: 'Неизвестная рубрика', done: false };
    category = c.id;
  }
  const upd = await query(
    `UPDATE trend_submissions SET status='approved', category=$2, decided_at=now() WHERE id=$1 AND status='pending' RETURNING id`,
    [id, category]);
  if (!upd.rows[0]) return { text: `Заявка №${id} уже обработана`, done: true };
  await sendMessage(s.user_id, `🎉 Ваш тренд «${s.title}» опубликован в рубрике «${catName(category)}»! Теперь его увидят все пользователи Hydra AI Studio.`);
  return { text: `✅ Заявка №${id} опубликована в «${catName(category)}»`, done: true };
}

// Одобренные тренды пользователей — в том же формате, что тренды из trends.json
async function approvedTrends() {
  const r = await query(
    `SELECT s.id, s.url, s.kind, s.model, s.prompt, s.params, s.title, s.category, u.first_name
     FROM trend_submissions s JOIN users u ON u.id=s.user_id
     WHERE s.status='approved' ORDER BY s.decided_at DESC LIMIT 200`);
  return r.rows.map(s => {
    const p = (typeof s.params === 'string' ? JSON.parse(s.params) : s.params) || {};
    const n = Math.min(4, Number(p.chars) || 0);
    const values = {};
    for (const k of ['aspect', 'res', 'duration', 'sound', 'mode']) if (p[k] !== undefined) values[k] = p[k];
    const slotKeys = s.model === 'seedance-2.5-ref' ? ['image1', 'image2', 'image3', 'image4'] : ['char1', 'char2', 'char3', 'char4'];
    return {
      id: 'u' + s.id, title: s.title, model: s.model, prompt: s.prompt || '',
      video: s.kind === 'video' ? s.url : '', image: s.kind === 'image' ? s.url : '',
      categories: [s.category, 'community'], author: s.first_name || '',
      values, slots: slotKeys.slice(0, n).map((k, i) => ({ key: k, label: 'Персонаж ' + (i + 1) }))
    };
  });
}

// ===== Конкурсы =====
async function contestsFor(userId) {
  const r = await query(
    `SELECT c.*, (SELECT COUNT(*) FROM contest_entries e WHERE e.contest_id=c.id) AS entries,
            (SELECT link FROM contest_entries e WHERE e.contest_id=c.id AND e.user_id=$1) AS my_link
     FROM contests c
     WHERE c.status='active' OR c.ends_at > now() - interval '14 days'
     ORDER BY c.status='active' DESC, c.ends_at DESC LIMIT 6`, [userId]);
  const out = [];
  for (const c of r.rows) {
    let winners = [];
    if (c.status === 'finished') {
      const w = await query(
        `SELECT e.place, e.prize_tjs, u.first_name FROM contest_entries e JOIN users u ON u.id=e.user_id
         WHERE e.contest_id=$1 AND e.place IS NOT NULL ORDER BY e.place LIMIT 10`, [c.id]);
      winners = w.rows.map(x => ({ place: x.place, prize: Number(x.prize_tjs) || 0, name: x.first_name || 'Участник' }));
    }
    out.push({
      id: Number(c.id), title: c.title, prize: Number(c.prize_tjs), rules: c.rules,
      ends_at: c.ends_at, status: c.status === 'active' && new Date(c.ends_at) < new Date() ? 'judging' : c.status,
      entries: Number(c.entries), joined: !!c.my_link, winners
    });
  }
  return out;
}

export async function joinContest(user, body) {
  const id = parseInt(body.contest_id, 10);
  const link = String(body.link || '').trim();
  const note = clean(body.note, 300);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Конкурс не найден');
  if (!/^https:\/\/[^\s<>"']{6,400}$/.test(link)) throw new HttpError(400, 'Вставьте ссылку на ваш пост или видео (https://...)');
  const c = await query(`SELECT * FROM contests WHERE id=$1`, [id]);
  const ct = c.rows[0];
  if (!ct || ct.status !== 'active' || new Date(ct.ends_at) < new Date()) throw new HttpError(400, 'Приём заявок на этот конкурс закрыт');
  await query(
    `INSERT INTO contest_entries (contest_id, user_id, link, note) VALUES ($1,$2,$3,$4)
     ON CONFLICT (contest_id, user_id) DO UPDATE SET link=EXCLUDED.link, note=EXCLUDED.note`,
    [id, user.id, link, note]);
  return { ok: true };
}

export async function communityData(user) {
  const [trends, contests, mine] = await Promise.all([
    approvedTrends(),
    contestsFor(user.id),
    query(`SELECT id, title, status, category FROM trend_submissions WHERE user_id=$1 ORDER BY id DESC LIMIT 10`, [user.id])
  ]);
  return {
    categories: TREND_CATEGORIES,
    trends,
    contests,
    my_submissions: mine.rows.map(x => ({ id: Number(x.id), title: x.title, status: x.status, category: x.category }))
  };
}

// ===== Команды администратора для конкурсов и трендов =====
const money = x => Number(x || 0).toFixed(2);

export const COMMUNITY_HELP = `Тренды и конкурсы:
/trends — заявки в тренды, которые ждут решения
/untrend N — убрать опубликованный тренд №N
/revenue [ДНЕЙ] — выручка за период (по умолчанию 30 дней) и подсказка по призовому фонду
/contest_new Название | Приз TJS | Дней | Условия — запустить конкурс
/contests — конкурсы и число участников
/contest N — участники конкурса №N со ссылками
/contest_win N УЧАСТНИК МЕСТО ПРИЗ — назначить победителя (УЧАСТНИК — ID или @username)
/contest_end N — завершить конкурс и сообщить итоги участникам`;

export async function communityCommand(cmd, args, raw) {
  if (cmd === '/trends') {
    const r = await query(`SELECT id, title, category, user_id FROM trend_submissions WHERE status='pending' ORDER BY id LIMIT 20`);
    if (!r.rows.length) return 'Новых заявок в тренды нет.';
    for (const s of r.rows) await notifyAdminTrend(s.id);
    return `Заявок: ${r.rows.length}. Отправил их выше с кнопками.`;
  }

  if (cmd === '/untrend') {
    const id = parseInt(args[0], 10);
    const r = await query(`UPDATE trend_submissions SET status='removed' WHERE id=$1 AND status='approved' RETURNING title`, [id]);
    return r.rows[0] ? `Тренд «${r.rows[0].title}» убран.` : 'Опубликованный тренд с таким номером не найден.';
  }

  if (cmd === '/revenue') {
    const days = Math.min(365, Math.max(1, parseInt(args[0], 10) || 30));
    const r = await query(`SELECT
      (SELECT COALESCE(SUM(tjs),0) FROM payments WHERE status='paid' AND paid_at > now() - ($1 || ' days')::interval) AS revenue,
      (SELECT COUNT(*) FROM payments WHERE status='paid' AND paid_at > now() - ($1 || ' days')::interval) AS n,
      (SELECT COALESCE(SUM(amount_tjs),0) FROM referral_earnings WHERE created_at > now() - ($1 || ' days')::interval) AS refs,
      (SELECT COALESCE(SUM(provider_credits),0) FROM jobs WHERE provider='kie' AND created_at > now() - ($1 || ' days')::interval) AS kie_credits,
      (SELECT COALESCE(SUM(prize_tjs),0) FROM contests WHERE created_at > now() - ($1 || ' days')::interval) AS prizes`, [String(days)]);
    const s = r.rows[0];
    const rev = Number(s.revenue);
    const kieUsd = Number(s.kie_credits) * 0.005;
    return `За ${days} дн.:\nВыручка: ${money(rev)} TJS (${s.n} оплат)\nПартнёрам начислено: ${money(s.refs)} TJS\nKie.ai потратил: ${Number(s.kie_credits)} кредитов ≈ $${kieUsd.toFixed(2)} (≈ ${money(kieUsd * 10)} TJS)\nПризы конкурсов: ${money(s.prizes)} TJS\n\nПодсказка: призовой фонд 5–10% выручки = ${money(rev * 0.05)}–${money(rev * 0.1)} TJS. Расходы fal.ai, Atlas и Replicate смотрите в их кабинетах.`;
  }

  if (cmd === '/contest_new') {
    const body = raw.replace(/^\/contest_new(@\w+)?\s*/i, '');
    const parts = body.split('|').map(x => x.trim());
    const [title, prizeRaw, daysRaw, ...rest] = parts;
    const prize = Number(String(prizeRaw || '').replace(',', '.'));
    const days = parseInt(daysRaw, 10);
    const rules = rest.join(' | ').trim();
    if (!title || !Number.isFinite(prize) || prize <= 0 || !Number.isInteger(days) || days < 1 || days > 60 || rules.length < 10) {
      return 'Пример:\n/contest_new Лучшее видео октября | 500 | 7 | Сделайте видео в Hydra AI Studio, опубликуйте в Instagram или TikTok с отметкой @hydra и пришлите ссылку. Победят 3 видео с наибольшим числом просмотров: 250, 150 и 100 TJS.';
    }
    const r = await query(`INSERT INTO contests (title, prize_tjs, rules, ends_at) VALUES ($1,$2,$3, now() + ($4 || ' days')::interval) RETURNING id, ends_at`,
      [title.slice(0, 80), prize, rules.slice(0, 1500), String(days)]);
    return `🏆 Конкурс №${r.rows[0].id} запущен до ${new Date(r.rows[0].ends_at).toLocaleString('ru-RU', { timeZone: 'Asia/Dushanbe' })}.\nОн уже виден в приложении на главной и во вкладке «Тренды». Расскажите о нём в своём канале.`;
  }

  if (cmd === '/contests') {
    const r = await query(`SELECT c.id, c.title, c.prize_tjs, c.status, c.ends_at, (SELECT COUNT(*) FROM contest_entries e WHERE e.contest_id=c.id) AS n FROM contests c ORDER BY id DESC LIMIT 10`);
    if (!r.rows.length) return 'Конкурсов пока не было. /contest_new — запустить.';
    return r.rows.map(c => `№${c.id} «${c.title}»: приз ${money(c.prize_tjs)} TJS, участников ${c.n}, ${c.status === 'finished' ? 'завершён' : new Date(c.ends_at) < new Date() ? 'приём заявок закрыт, выберите победителей' : 'идёт до ' + new Date(c.ends_at).toLocaleDateString('ru-RU', { timeZone: 'Asia/Dushanbe' })}`).join('\n');
  }

  if (cmd === '/contest') {
    const id = parseInt(args[0], 10);
    const r = await query(
      `SELECT e.id, e.user_id, e.link, e.note, e.place, u.first_name, u.username FROM contest_entries e JOIN users u ON u.id=e.user_id
       WHERE e.contest_id=$1 ORDER BY e.id LIMIT 60`, [id]);
    if (!r.rows.length) return 'Участников пока нет (или такого конкурса нет).';
    return `Участники конкурса №${id}:\n` + r.rows.map(e => `• ${who({ id: e.user_id, first_name: e.first_name, username: e.username })}${e.place ? ` — 🏅 ${e.place} место` : ''}\n  ${e.link}${e.note ? `\n  ${e.note}` : ''}`).join('\n');
  }

  if (cmd === '/contest_win') {
    const id = parseInt(args[0], 10);
    const place = parseInt(args[2], 10);
    const prize = Number(String(args[3] || '').replace(',', '.'));
    const { findUser } = await import('./adminops.js');
    const u = await findUser(args[1]);
    if (!u || !Number.isInteger(id) || !Number.isInteger(place) || place < 1 || place > 20 || !Number.isFinite(prize) || prize < 0) {
      return 'Пример: /contest_win 3 @username 1 250 (конкурс, участник, место, приз в TJS)';
    }
    const r = await query(`UPDATE contest_entries SET place=$3, prize_tjs=$4 WHERE contest_id=$1 AND user_id=$2 RETURNING id`, [id, u.id, place, prize]);
    if (!r.rows[0]) return 'Этот пользователь не участвовал в конкурсе.';
    return `🏅 ${who(u)}: ${place} место, приз ${money(prize)} TJS. Когда назначите всех, завершите конкурс: /contest_end ${id}`;
  }

  if (cmd === '/contest_end') {
    const id = parseInt(args[0], 10);
    const c = await query(`UPDATE contests SET status='finished' WHERE id=$1 AND status='active' RETURNING title`, [id]);
    if (!c.rows[0]) return 'Активный конкурс с таким номером не найден.';
    const e = await query(`SELECT user_id, place, prize_tjs FROM contest_entries WHERE contest_id=$1`, [id]);
    const winners = e.rows.filter(x => x.place).sort((a, b) => a.place - b.place);
    // сообщения отправляем пачками, чтобы уложиться во время ответа бота
    for (let i = 0; i < e.rows.length; i += 15) {
      await Promise.all(e.rows.slice(i, i + 15).map(x => sendMessage(x.user_id, x.place
        ? `🏆 Поздравляем! Вы заняли ${x.place} место в конкурсе «${c.rows[0].title}». Приз: ${money(x.prize_tjs)} TJS. Администратор свяжется с вами для выплаты.`
        : `Конкурс «${c.rows[0].title}» завершён. Спасибо за участие! Итоги — в приложении. Следующий конкурс уже скоро 🔥`)));
    }
    return `Конкурс №${id} завершён. Победителей: ${winners.length}. Участникам отправлены сообщения. Выплатите призы и отметьте это у себя.`;
  }

  return null;
}
