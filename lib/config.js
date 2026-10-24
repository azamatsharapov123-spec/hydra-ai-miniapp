// Общие настройки. Всё, что можно менять без правки кода, берётся из переменных Vercel.
export const BOT_USERNAME = process.env.BOT_USERNAME || 'HydraAIBot';
export const APP_SHORT_NAME = process.env.APP_SHORT_NAME || 'studio';
export const APP_URL = process.env.APP_URL || 'https://hydra-ai-miniapp.vercel.app';

export const SIGNUP_COINS = 5;         // ⚡ новому пользователю
export const WITHDRAW_MIN = 100;

// Суточные лимиты сообщений (сбрасываются в полночь по времени Душанбе, UTC+5).
// Каждый ответ ИИ стоит доли цента, лимит защищает от злоупотреблений.
export const CHAT_DAILY_LIMIT = 15;     // «Чат AI» (бесплатный чат)
export const SUPPORT_DAILY_LIMIT = 30;  // вопросы в поддержку (ИИ отвечает первым)
export const SUPPORT_FWD_LIMIT = 60;    // сообщения администратору, когда он уже подключился к диалогу
export const HANDOFF_HOURS = 24;        // сколько часов диалог ведёт администратор, а не ИИ
export const LLM_MODEL = process.env.LLM_MODEL || 'google/gemini-2.5-flash';       // TJS, от какой суммы доступен вывод
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
// Чем больше пакет, тем дешевле 1 ⚡. unlimited: пакет включает безлимит уровня tier на days дней.
export const PACKAGES = [
  { id: 'trial',     name: 'Пробный',  tokens: 30,   tjs: 20 },
  { id: 'start',     name: 'Старт',    tokens: 80,   tjs: 50 },
  { id: 'standard',  name: 'Стандарт', tokens: 170,  tjs: 100 },
  { id: 'pro',       name: 'Про',      tokens: 440,  tjs: 250 },
  { id: 'max',       name: 'Макс',     tokens: 920,  tjs: 500 },
  { id: 'ultra',     name: 'Ультра',   tokens: 1920, tjs: 1000, unlimited: { tier: 1, days: 30 } },
  { id: 'unlimited', name: 'Безлимит', tokens: 5800, tjs: 3000, unlimited: { tier: 2, days: 30 } }
];
export const getPackage = id => PACKAGES.find(p => p.id === id) || null;

// Защита от убытка. Цена генерации фиксируется до запуска и потом не меняется.
// Резервный (более дорогой) сервер используется, только если даже после него мы не уходим в минус:
// выручка за ⚡ в самом выгодном для клиента пакете, курс и максимальная доля партнёров (20% + 20% от 20% = 24%).
export const USD_RATE = 10;                 // 1 $ = 10 TJS, как в приложении
export const MAX_REF_SHARE = 0.24;
export const MIN_TOKEN_TJS = Math.min(...PACKAGES.map(p => p.tjs / p.tokens));

// Безлимит: дневные лимиты на генерации без списания ⚡ (защита от злоупотреблений и перерасхода).
// Какие модели входят в безлимит, указано в каталоге моделей (поле unlim).
// Проверено на худшем случае: клиент каждый день выбирает весь лимит, тратит все ⚡ пакета на флагманы,
// а пригласившие получают 20% + 20% от бонуса — пакет всё равно остаётся в плюсе.
export const UNLIMITED = {
  1: { name: 'Ультра',   caps: { image: 20, video: 2 } },
  2: { name: 'Безлимит', caps: { image: 40, video: 4 } }
};

export const refLink = code => `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=${code}`;

// Категории трендов. Порядок здесь = порядок рубрик в приложении. id не меняйте: по ним хранятся тренды.
export const TREND_CATEGORIES = [
  { id: 'million',   name: '🔥 Тренды на миллион' },
  { id: 'new',       name: '✨ Новинки недели' },
  { id: 'bloggers',  name: '📱 Тренды блогеров' },
  { id: 'community', name: '⭐ От пользователей' },
  { id: 'navruz',    name: '🌷 Навруз' },
  { id: 'wedding',   name: '💍 Свадьба' },
  { id: 'eid',       name: '🌙 Ид и Курбан' },
  { id: 'grad',      name: '🎓 Выпускной' },
  { id: 'birthday',  name: '🎂 День рождения' },
  { id: 'love',      name: '❤️ Love story' },
  { id: 'auto',      name: '🏎 Авто' },
  { id: 'hijab',     name: '🧕 Покрытые' },
  { id: 'women',     name: '👩 Девушкам' },
  { id: 'men',       name: '👨 Мужчинам' },
  { id: 'kids',      name: '🧒 Детям' },
  { id: 'tajik',     name: '🇹🇯 Таджикистан' },
  { id: 'cinema',    name: '🎬 Как в кино' },
  { id: 'humor',     name: '😂 Юмор и мемы' },
  { id: 'sport',     name: '⚽ Спорт' },
  { id: 'travel',    name: '✈️ Путешествия' },
  { id: 'business',  name: '🛍 Для бизнеса' },
  { id: 'photo',     name: '📸 Фотосессии' }
];
export const trendCategory = id => TREND_CATEGORIES.find(c => c.id === id) || null;
