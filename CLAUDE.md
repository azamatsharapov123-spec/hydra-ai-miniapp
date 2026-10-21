# CLAUDE.md

Этот файл задаёт контекст и правила для Claude Code при работе с репозиторием.

## О проекте

**Hydra AI Studio Pro** — Telegram Mini App для генерации контента нейросетями
(изображения, видео, аудио, аватары, чат). Деплоится на **Vercel**; все запросы
к моделям идут через [fal.ai](https://fal.ai).

## Структура

```
index.html            # Весь фронтенд: разметка, CSS (<style>) и JS (<script>) в одном файле
api/generate.js       # POST /api/generate → списание баланса + прокси к fal.ai
api/balance.js        # GET /api/balance → текущий баланс пользователя
api/_lib/models.js    # Каталог моделей на сервере (эндпоинт, цена) и calculateCost()
api/_lib/balance.js   # Баланс в Upstash Redis через REST (атомарные Lua-скрипты)
api/_lib/telegram.js  # Проверка подписи Telegram initData
README.md
```

Сборки, бандлера, `package.json` и зависимостей нет. Фронтенд — чистый HTML/CSS/JS
без фреймворков, подключается только `telegram-web-app.js`.

## Запуск и деплой

- Локально: `npx vercel dev` (переменные окружения — в `.env.local`).
  Простой статический сервер не подойдёт — `/api/generate` не заработает.
- Деплой: push в репозиторий → автодеплой Vercel.
- Переменные окружения (Vercel → Settings → Environment Variables):
  - `FAL_KEY` — ключ fal.ai.
  - `TELEGRAM_BOT_TOKEN` — токен бота, нужен для проверки подписи `initData`.
  - `KV_REST_API_URL` / `KV_REST_API_TOKEN` — Upstash Redis (создаются автоматически при
    подключении Upstash в Vercel → Storage; также поддерживаются `UPSTASH_REDIS_REST_URL` /
    `UPSTASH_REDIS_REST_TOKEN`).
  - Секреты **никогда** не коммитить и не выводить в клиентский код.
- Файлы в `api/_lib/` начинаются с `_`, поэтому Vercel не публикует их как эндпоинты.
- Тестов и линтера нет. Перед коммитом проверяйте синтаксис:
  `node --input-type=module --check < api/generate.js` (и так же для остальных файлов в `api/`).

## Архитектура

### Фронтенд (`index.html`)
- Страницы — блоки `.app-page`, переключаются `switchPage(pageId)`; нижняя навигация `.nav-item`.
- Каталог моделей — объект `sortedModels` (категории `image`, `video`, `audio`, `avatar`),
  у каждой модели `id`, `name`, `baseCost`, для видео ещё `maxDur`.
- `recalculateCost()` показывает цену в интерфейсе (длительность/качество для видео, разрешение
  для фото). Это только подсказка — списывается цена, посчитанная сервером.
- Генерация: `executeModalGen()` → `fetch('/api/generate')`. Чат: `sendPageChat()`.
- Баланс загружает `loadBalance()` из `/api/balance`; `userCoins` — лишь копия для отображения.
- Все запросы к API идут с заголовком `X-Telegram-Init-Data` (`apiHeaders()`).
- В `localStorage` хранится только история (`hydra_history`).
- `initDataUnsafe.user` используется только для отображения имени и аватара.
- Покупка токенов (`buyPackage`) отключена до подключения реальной оплаты.
- Тема — CSS-переменные в `:root` (`--bg-color`, `--accent-color` и т.д.); используйте их,
  а не хардкод цветов.

### Бэкенд
- Пользователь определяется **только** по проверенному `initData` (`getTelegramUser`);
  без валидной подписи — `401`.
- Баланс — ключ `balance:<telegramId>` в Redis; новый пользователь получает `INITIAL_BALANCE` (10).
- `POST /api/generate`, тело: `prompt, model, category, image_url, aspect_ratio, duration,
  quality, resolution, format, websearch, audio_mode, voice`.
  - `category === 'chat'` → `fal-ai/any-llm`, бесплатно, ответ `{ success, result: { text } }`.
  - Иначе: модель из `MODELS` (неизвестная → `400`), цена из `calculateCost()`, атомарное
    списание `spendBalance()` (не хватает → `402` с `balance`), вызов fal.ai.
    При ошибке fal.ai или пустом результате токены возвращаются (`refundBalance`).
  - Успех: `{ success, new_balance, cost, result: { url } }`; ошибка: `{ error, balance? }`.
- `GET /api/balance` → `{ success, balance }`.

## Правила разработки

1. **Синхронность моделей.** Добавляя/удаляя модель или меняя цену, правьте *оба* места:
   `sortedModels` в `index.html` и `MODELS` в `api/_lib/models.js` — `id` и `baseCost`
   должны совпадать. Формулу цены меняйте и в `recalculateCost()`, и в `calculateCost()`.
2. **Баланс — только на сервере.** Никогда не принимайте от клиента цену, баланс или
   идентификатор пользователя; любые изменения баланса — через функции `api/_lib/balance.js`.
3. **Контракт API.** Не меняйте формат запроса/ответа `/api/generate` без одновременной
   правки фронтенда.
4. **Язык.** Весь пользовательский интерфейс, сообщения об ошибках и комментарии —
   на русском, как в существующем коде.
5. **Без новых зависимостей и сборки**, пока это не согласовано явно. Сохраняйте
   структуру «один `index.html`»; внешние скрипты — только с проверенных CDN и с фиксированной версией.
6. **Мобильный UI.** Приложение открывается внутри Telegram на телефоне: проверяйте
   вёрстку на узкой ширине, учитывайте нижний отступ под навигацию.
7. **Безопасность.**
   - Секреты — только через `process.env` на сервере.
   - Не вставляйте пользовательский ввод или ответы моделей через `innerHTML` без
     экранирования — используйте `textContent` (как `appendChatBubble`) или `escapeHtml()`;
     ссылки в `href`/`src` пропускайте через `safeUrl()`.
   - Новые эндпоинты, зависящие от пользователя, обязаны вызывать `getTelegramUser(req)`;
     `initDataUnsafe` на сервере не используется.
8. **Стиль кода.** 4 пробела в `index.html`, 2 пробела в `api/generate.js`, одинарные
   кавычки, `async/await`, `const`/`let` (без `var`).
9. **Коммиты** — короткие и осмысленные (не «Update index.html»): что и зачем изменено.

## Известные проблемы / техдолг

- **Нет оплаты.** Покупка токенов отключена; нужна реальная оплата (например, Telegram Stars
  с вебхуком бота), начисление — только на сервере после `successful_payment`.
- Чат бесплатный, но требует авторизации; ограничения частоты запросов (rate limit) нет.
- Многие «маркетинговые» модели отображаются на одни и те же эндпоинты fal.ai
  (`flux/schnell`, `flux/dev`, `kling-video` и др.) — это заглушки.
- `aspect_ratio: '9:16'` маппится в `portrait_16_9` — проверьте актуальные значения
  `image_size` в документации fal.ai.
