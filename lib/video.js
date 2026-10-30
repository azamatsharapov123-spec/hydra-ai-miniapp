// Видео для Remake: проверка ссылки, длительность ролика и ссылка для загрузки файла прямо в наше хранилище.
import { blobStoreId } from './providers.js';

export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;   // 100 МБ — лимит Kie для видео
const SOON_HOSTS = /(^|\.)(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|vk\.com|vkvideo\.ru|likee\.video|facebook\.com|fb\.watch)$/i;

// Ссылка на видео: только https, без IP-адресов и внутренних имён. Бросает ошибку с понятным текстом.
export function checkVideoUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2000) throw new Error('Неверная ссылка на видео');
  let u;
  try { u = new URL(raw.trim()); } catch (e) { throw new Error('Неверная ссылка на видео'); }
  if (u.protocol !== 'https:') throw new Error('Нужна ссылка, которая начинается с https://');
  const h = u.hostname.toLowerCase();
  if (SOON_HOSTS.test(h)) throw new Error('Ссылки из Instagram, TikTok и YouTube появятся скоро. Пока скачайте ролик и загрузите файлом.');
  if (u.port || u.username || u.password || !h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') ||
      /(^|\.)(localhost|local|internal)$/.test(h)) {
    throw new Error('Неверная ссылка на видео');
  }
  return u.toString();
}

// Читает кусок файла по ссылке (Range), не больше limit байт. Возвращает { buf, total }.
async function readPart(url, start, end, limit) {
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
  if (!r.ok && r.status !== 206) throw new Error(`HTTP ${r.status}`);
  const cr = r.headers.get('content-range');
  const total = cr && /\/(\d+)$/.test(cr) ? Number(cr.match(/\/(\d+)$/)[1])
    : (r.status === 200 ? Number(r.headers.get('content-length')) || 0 : 0);
  const reader = r.body.getReader();
  const parts = [];
  let got = 0;
  while (got < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
  }
  reader.cancel().catch(() => {});
  return { buf: Buffer.concat(parts.map(p => Buffer.from(p))).subarray(0, limit), total, ranged: r.status === 206 };
}

// Ищет атом mvhd в MP4/MOV и считает длительность в секундах
function mvhdSeconds(buf) {
  let i = buf.indexOf('mvhd');
  while (i >= 0) {
    const p = i + 4;
    if (p + 32 <= buf.length) {
      const ver = buf[p];
      let scale, dur;
      if (ver === 1 && p + 36 <= buf.length) {
        scale = buf.readUInt32BE(p + 20);
        dur = Number(buf.readBigUInt64BE(p + 24));
      } else if (ver === 0) {
        scale = buf.readUInt32BE(p + 12);
        dur = buf.readUInt32BE(p + 16);
      }
      if (scale > 0 && dur > 0) {
        const s = dur / scale;
        if (s > 0 && s < 36000) return s;
      }
    }
    i = buf.indexOf('mvhd', i + 4);
  }
  return null;
}

// Длительность видео по ссылке (MP4/MOV). null — прочитать не удалось.
export async function probeVideo(url) {
  const HEAD = 512 * 1024, TAIL = 3 * 1024 * 1024;
  const first = await readPart(url, 0, HEAD - 1, HEAD);
  if (first.total > VIDEO_MAX_BYTES) throw new Error('Видео больше 100 МБ');
  const s = mvhdSeconds(first.buf);
  if (s) return { seconds: s, bytes: first.total };
  // у видео с телефона (особенно iPhone) описание ролика лежит в конце файла
  if (first.ranged && first.total > HEAD) {
    const from = Math.max(HEAD, first.total - TAIL);
    const last = await readPart(url, from, first.total - 1, TAIL);
    const s2 = mvhdSeconds(last.buf);
    if (s2) return { seconds: s2, bytes: first.total };
  }
  return null;
}

// Ссылка, по которой приложение само загружает видео в наше хранилище (Vercel Blob), минуя лимит 4,5 МБ на запрос.
export async function videoUploadUrl(userId, contentType, size, oidcToken) {
  const storeId = blobStoreId();
  if (!storeId && !process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Хранилище не подключено');
  if (!/^video\/[\w.+-]+$/i.test(contentType || '')) throw new Error('Нужен видеофайл (MP4 или MOV)');
  if (!(size > 0) || size > VIDEO_MAX_BYTES) throw new Error('Видео должно быть не больше 100 МБ');
  const { issueSignedToken, presignUrl } = await import('@vercel/blob');
  const ext = /quicktime/i.test(contentType) ? 'mov' : /webm/i.test(contentType) ? 'webm' : 'mp4';
  const rnd = Math.random().toString(36).slice(2, 10);
  const pathname = `remake/${String(userId).replace(/\W/g, '')}/${Date.now().toString(36)}${rnd}.${ext}`;
  const validUntil = Date.now() + 20 * 60 * 1000;
  const auth = process.env.BLOB_READ_WRITE_TOKEN
    ? { token: process.env.BLOB_READ_WRITE_TOKEN }
    : { storeId, ...(oidcToken || process.env.VERCEL_OIDC_TOKEN ? { oidcToken: oidcToken || process.env.VERCEL_OIDC_TOKEN } : {}) };
  const signed = await issueSignedToken({
    ...auth, pathname, operations: ['put'], validUntil,
    maximumSizeInBytes: VIDEO_MAX_BYTES, allowedContentTypes: ['video/*']
  });
  const { presignedUrl } = await presignUrl(signed, {
    operation: 'put', access: 'public', pathname, validUntil,
    maximumSizeInBytes: VIDEO_MAX_BYTES, allowedContentTypes: ['video/*']
  });
  // id хранилища нужен браузеру в заголовке запроса; он записан в первой части токена
  let sid = '';
  try {
    const seg = signed.delegationToken.split('.')[0];
    sid = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')).storeId || '';
  } catch (e) { sid = ''; }
  return { url: presignedUrl, storeId: sid || String(storeId).replace(/^store_/, ''), pathname };
}

// Исходный ролик, который пользователь загрузил для Remake, после завершения задачи больше не нужен:
// удаляем его, иначе хранилище (1 ГБ на Hobby) быстро забивается. Чужие и внешние ссылки не трогаем.
export async function dropSource(url, oidcToken) {
  try {
    if (typeof url !== 'string' || !/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/remake\//i.test(url)) return;
    const { del } = await import('@vercel/blob');
    const auth = process.env.BLOB_READ_WRITE_TOKEN
      ? { token: process.env.BLOB_READ_WRITE_TOKEN }
      : { storeId: blobStoreId(), ...((oidcToken || process.env.VERCEL_OIDC_TOKEN) ? { oidcToken: oidcToken || process.env.VERCEL_OIDC_TOKEN } : {}) };
    await del(url, auth);
  } catch (e) { console.error('drop source', e && e.message); }
}
