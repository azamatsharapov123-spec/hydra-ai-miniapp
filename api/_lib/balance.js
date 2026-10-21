// Баланс пользователей в Upstash Redis через REST API (без npm-зависимостей).
// Vercel Marketplace (Upstash) создаёт KV_REST_API_URL / KV_REST_API_TOKEN,
// при ручном подключении — UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// Стартовый баланс нового пользователя
export const INITIAL_BALANCE = 10;

// Создаёт баланс, если его нет, и возвращает текущее значение
const GET_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1], 'NX')
return tonumber(redis.call('GET', KEYS[1]))
`;

// Атомарно проверяет и списывает: {1, новый баланс} или {0, текущий баланс}
const SPEND_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[2], 'NX')
local balance = tonumber(redis.call('GET', KEYS[1]))
local cost = tonumber(ARGV[1])
if balance < cost then return {0, balance} end
return {1, redis.call('DECRBY', KEYS[1], cost)}
`;

export function isBalanceStoreConfigured() {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}

async function redis(command) {
  const response = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command)
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || 'Ошибка базы данных');
  }
  return data.result;
}

const balanceKey = (userId) => `balance:${userId}`;

export async function getBalance(userId) {
  return redis(['EVAL', GET_SCRIPT, '1', balanceKey(userId), String(INITIAL_BALANCE)]);
}

export async function spendBalance(userId, cost) {
  const [ok, balance] = await redis(['EVAL', SPEND_SCRIPT, '1', balanceKey(userId), String(cost), String(INITIAL_BALANCE)]);
  return { ok: ok === 1, balance };
}

export async function refundBalance(userId, cost) {
  return redis(['INCRBY', balanceKey(userId), String(cost)]);
}
