// Длинное видео для моделей, которые принимают ролик только до N секунд (Remake Hydra AI — до 15 сек).
// Задача идёт в три этапа, все на fal.ai:
//   1) cut   — режем исходник на равные части (каждая ≤ segMax сек),
//   2) edit  — обрабатываем все части параллельно с теми же фото лиц,
//   3) merge — склеиваем результаты в один ролик.
// Состояние хранится в jobs.ext, задача в БД помечена provider='chain'. Каждый опрос /api/status
// проверяет текущий этап и, когда он готов, запускает следующий.
import { submit, poll } from './providers.js';
import { query } from './db.js';

const TRIM = 'fal-ai/workflow-utilities/trim-video';
const MERGE = 'fal-ai/ffmpeg-api/merge-videos';
const videoOf = d => (d && d.video && d.video.url) || null;

export const needsChain = (model, v) => !!(model.chain && v.video_seconds > model.chain.segMax);

// Равные части: 40 сек → 3 по 13,3 сек. Последняя часть заканчивается чуть раньше конца, чтобы не выйти за край.
export function planSegments(seconds, segMax) {
  const n = Math.ceil(seconds / segMax);
  const len = seconds / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const start = +(i * len).toFixed(2);
    const end = i === n - 1 ? +Math.max(start + 3, seconds - 0.05).toFixed(2) : +((i + 1) * len).toFixed(2);
    out.push([start, end]);
  }
  return out;
}

async function submitAll(reqs) {
  const subs = await Promise.all(reqs.map(r => submit({ provider: 'fal', endpoint: r.endpoint, payload: r.payload })
    .catch(e => ({ ok: false, error: e.message }))));
  const bad = subs.find(s => !s.ok);
  if (bad) return { ok: false, error: bad.error };
  return { ok: true, refs: subs.map(s => s.ref) };
}

// Запуск: режем исходник. Возвращает { ok, ref } — ref кладётся в jobs.ext
export async function startChain(model, v, exactSeconds) {
  // запас 0,5 сек: нарезка может дать кусок чуть длиннее заказанного, а нейросеть строго не берёт больше segMax
  const segs = planSegments(exactSeconds || v.video_seconds, model.chain.segMax - 0.5);
  const sub = await submitAll(segs.map(([start_time, end_time]) => ({
    endpoint: TRIM, payload: { video_url: v.video, start_time, end_time }
  })));
  if (!sub.ok) return sub;
  return { ok: true, ref: { stage: 'cut', segs, jobs: sub.refs } };
}

// Опрос всех задач этапа. state: done (urls), failed (error) или progress
async function pollAll(refs) {
  const st = await Promise.all(refs.map(r => poll('fal', r, videoOf)));
  const failed = st.find(s => s.state === 'failed');
  if (failed) return { state: 'failed', error: failed.error };
  if (st.every(s => s.state === 'done')) return { state: 'done', urls: st.map(s => s.url) };
  return { state: st.some(s => s.state === 'progress') ? 'progress' : 'queue' };
}

// Следующий этап запускает только один запрос: «захватываем» задачу сменой provider на 'switching'
async function claim(row) {
  const r = await query(
    `UPDATE jobs SET provider='switching' WHERE id=$1 AND status='pending' AND provider='chain' AND ext->>'stage'=$2 RETURNING id`,
    [row.id, row.ext.stage]
  );
  return !!r.rows[0];
}
const release = (row, ext) => query(`UPDATE jobs SET provider='chain', ext=$2 WHERE id=$1 AND provider='switching'`, [row.id, JSON.stringify(ext)]);
// при ошибке запуска этапа возвращаем provider, чтобы refundJob всё вернул
const unclaim = row => query(`UPDATE jobs SET provider='chain' WHERE id=$1 AND provider='switching'`, [row.id]);

// Один шаг. Возвращает { state: 'queue'|'progress'|'done'|'failed', url?, error?, step? }
export async function advanceChain(row, model) {
  const ext = row.ext || {};
  const n = (ext.segs || []).length;
  const st = await pollAll(ext.jobs || []);
  if (st.state === 'failed') return { state: 'failed', error: st.error };
  const step = { cut: 1, edit: 2, merge: 3 }[ext.stage] || 1;
  if (st.state !== 'done') return { state: st.state, step, parts: n };

  if (ext.stage === 'merge') return { state: 'done', url: st.urls[0] };

  if (!row.input) return { state: 'failed', error: 'Задача устарела, ⚡ возвращены' };
  if (!(await claim(row))) return { state: 'progress', step, parts: n };   // следующий этап уже запускает другой запрос

  let sub, next;
  if (ext.stage === 'cut') {
    sub = await submitAll(st.urls.map(url => ({ endpoint: model.endpoint, payload: model.build({ ...row.input, video: url }) })));
    next = 'edit';
  } else {
    sub = await submitAll([{ endpoint: MERGE, payload: { video_urls: st.urls, resolution_aspect_ratio_video_index: 0 } }]);
    next = 'merge';
  }
  if (!sub.ok) {
    await unclaim(row);
    return { state: 'failed', error: sub.error };
  }
  await release(row, { stage: next, segs: ext.segs, jobs: sub.refs });
  return { state: 'progress', step: step + 1, parts: n };
}
