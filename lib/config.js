// Общие настройки. Всё, что можно менять без правки кода, берётся из переменных Vercel.
export const BOT_USERNAME = process.env.BOT_USERNAME || 'HydraAIBot';
export const APP_SHORT_NAME = process.env.APP_SHORT_NAME || 'studio';
export const APP_URL = process.env.APP_URL || 'https://hydra-ai-miniapp.vercel.app';

export const SIGNUP_COINS = 5;         // ⚡ новому пользователю
export const WITHDRAW_MIN = 100;       // TJS, от какой суммы доступен вывод
// Партнёрский процент растёт вместе с числом ПЛАТЯЩИХ приглашённых (тех, кто хотя бы раз пополнил баланс).
// Второго уровня нет. Менять ступени можно здесь.
export const REF_TIERS = [
  { min: 0,  rate: 0.05 },
  { min: 20,  rate: 0.10 },
  { min: 50,  rate: 0.15 },
  { min: 100, rate: 0.20 }
];
export const refTier = payingCount => {
  let t = REF_TIERS[0];
  for (const x of REF_TIERS) if (payingCount >= x.min) t = x;
  return t;
};
export const nextTier = payingCount => REF_TIERS.find(x => x.min > payingCount) || null;
export const REF_RATE_MAX = REF_TIERS[REF_TIERS.length - 1].rate;
export const pct = x => String(Math.round(x * 1000) / 10).replace('.', ',');

// Пакеты пополнения. Цена и количество ⚡ определяются ТОЛЬКО здесь (на сервере).
export const PACKAGES = [
  { id: 'trial',    name: 'Пробный',  tokens: 36,  tjs: 20 },
  { id: 'start',    name: 'Старт',    tokens: 92,  tjs: 50 },
  { id: 'standard', name: 'Стандарт', tokens: 188, tjs: 100 },
  { id: 'pro',      name: 'Про',      tokens: 475, tjs: 250 },
  { id: 'max',      name: 'Макс',     tokens: 960, tjs: 500 }
];
export const getPackage = id => PACKAGES.find(p => p.id === id) || null;

export const refLink = code => `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=${code}`;
