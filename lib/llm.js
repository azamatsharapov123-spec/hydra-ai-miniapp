import { LLM_MODEL } from './config.js';

// Текстовая нейросеть через fal.ai (endpoint openrouter/router, оплата по факту токенов).
// Бросает ошибку, если ответа нет: вызывающий код решает, что делать дальше.
export async function askLLM({ system, prompt, maxTokens = 600, temperature = 0.4 }) {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY не настроен');
  const r = await fetch('https://fal.run/openrouter/router', {
    method: 'POST',
    headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      system_prompt: system,
      prompt,
      max_tokens: maxTokens,
      temperature,
      reasoning: false
    }),
    signal: AbortSignal.timeout(25000)
  });
  const d = await r.json().catch(() => ({}));
  const text = typeof d.output === 'string' ? d.output.trim() : '';
  if (!r.ok || d.error || !text) {
    const why = d.error || (d.detail ? JSON.stringify(d.detail).slice(0, 200) : `HTTP ${r.status}`);
    throw new Error('LLM: ' + why);
  }
  return text;
}
