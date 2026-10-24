# CLAUDE.md

Этот файл задаёт контекст и правила для Claude Code при работе с репозиторием.

## О проекте

**Hydra AI Studio Pro** — Telegram Mini App для генерации контента нейросетями
(изображения, видео, аудио, аватары, чат). Деплоится на **Vercel**. Генерации идут через несколько провайдеров
по цене: Kie.ai (самый дешёвый, `KIE_API_KEY`), Replicate, Atlas Cloud и fal.ai (запасной).

## Маршрут генерации и цены (lib/models.js)

- У модели `price` — цена через fal, у каждого шага `alt` своя `price` и условия `when`
  (декларативные: `in`, `max`, `not`, `noImage`, `noChars`, `noRefs`, `noEnd`, `needsMedia`;
  одинаково понимают сервер `matchWhen` и приложение `clientMatch`).
- `quote(model, v)` → `{ charge, routes }`. Клиент платит фиксированную цену `charge` (поле `sell` модели
  или цена самого дешёвого провайдера) и ничего не доплачивает. В `routes` попадают только серверы,
  на которых генерация окупается даже с партнёрскими 24% (`MIN_TOKEN_TJS`, `MAX_REF_SHARE` в lib/config.js).
- Блогеры: `/partner @name` = 20% + 20%, `/partner @name 15 10` — любые свои проценты.
- История генераций восстанавливается с сервера: GET /api/me?section=history.
- `only: 'kie'` — модель есть только у Kie. Без ключа она скрыта.
- Безлимит: поле `unlim: { tier, when }`, лимиты в `UNLIMITED` (lib/config.js), пакеты `ultra`/`unlimited`.
  Безлимит работает только через Kie.

## Remake, улучшение промпта, фильтры

- Remake (`remake` — Wan 2.2 Animate Replace, `remake-pro` — Kling 3.0 Motion Control, только Kie): цена `videoSec` за секунду ролика.
  Видео загружается из браузера прямо в Vercel Blob по одноразовой ссылке (POST /api/me {action:'upload_url'}, lib/video.js),
  длительность сервер читает сам из MP4/MOV (`probeVideo`). Ссылки Instagram/TikTok/YouTube пока не поддерживаются («скоро»).
- «✨ Улучшить»: POST /api/generate {category:'enhance', prompt, kind}, бесплатно, 30 в день.
- Отказ фильтра (`isPolicyError`): резервные серверы не пробуем, ⚡ сразу возвращаются, в приложении кнопки «Повторить в Kling» и «Сделать карточку».

## Отчёт владельцу (lib/report.js)

- `/report [ДНЕЙ]` в боте и автоматически каждый день в 21:00 по Душанбе (vercel.json → cron `0 16 * * *` UTC →
  /api/admin?action=daily_report, защищён `CRON_SECRET`). На Hobby Vercel запускает cron в пределах часа.
- Остатки: Kie `/api/v1/chat/credit`, fal `/v1/account/billing?expand=credits`, Atlas `/public/v1/balance`; у Replicate API баланса нет.

## Сообщество (lib/community.js)

- Заявки в тренды: POST /api/me {action:'trend_submit'}, модерация кнопками в боте (`tr:*`).
- Конкурсы: команды администратора /contest_new, /contests, /contest, /contest_win, /contest_end, /revenue.
- Данные для приложения: GET /api/me?section=community. Рубрики — `TREND_CATEGORIES` в lib/config.js.
- Лимит Vercel Hobby — 12 функций в api/. Сейчас их ровно 12: новые действия добавляйте в существующие файлы.

## Структура

```
index.html        # Весь фронтенд: разметка, CSS (<style>) и JS (<script>) в одном файле
api/generate.js   # Vercel Serverless Function: POST /api/generate → прокси к fal.ai
README.md
```

Сборки, бандлера, `package.json` и зависимостей нет. Фронтенд — чистый HTML/CSS/JS
без фреймворков, подключается только `telegram-web-app.js`.

## Запуск и деплой

- Локально: `npx vercel dev` (нужен `FAL_KEY` в окружении или в `.env.local`).
  Простой статический сервер не подойдёт — `/api/generate` не заработает.
- Деплой: push в репозиторий → автодеплой Vercel.
- Переменные окружения (Vercel → Settings → Environment Variables):
  - `FAL_KEY` — ключ fal.ai. **Никогда** не коммитить и не выводить в клиентский код.
  - `KIE_API_KEY` — ключ Kie.ai (дешёвый провайдер; без него всё работает через остальных).
  - `ATLAS_API_KEY`, `REPLICATE_API_TOKEN` — необязательные дешёвые провайдеры.
- Тестов и линтера нет. Перед коммитом проверяйте синтаксис:
  `node --check api/generate.js`.

## Архитектура

### Фронтенд (`index.html`)
- Страницы — блоки `.app-page`, переключаются `switchPage(pageId)`; нижняя навигация `.nav-item`.
- Каталог моделей — объект `sortedModels` (категории `image`, `video`, `audio`, `avatar`),
  у каждой модели `id`, `name`, `baseCost`, для видео ещё `maxDur`.
- Стоимость считает `recalculateCost()` (длительность/качество для видео, разрешение для фото),
  результат кладётся в `window.currentCalculatedCost`.
- Генерация: `executeModalGen()` → `fetch('/api/generate')`. Чат: `sendPageChat()`.
- Состояние хранится в `localStorage`: `hydra_user_coins` (баланс), `hydra_history` (история).
- Данные пользователя — из `Telegram.WebApp.initDataUnsafe.user`.
- Тема — CSS-переменные в `:root` (`--bg-color`, `--accent-color` и т.д.); используйте их,
  а не хардкод цветов.

### Бэкенд (`api/generate.js`)
- Принимает только `POST`. Тело: `prompt, model, category, image_url, aspect_ratio,
  duration, quality, format, websearch, audio_mode, voice, cost, user_coins_client`.
- `category === 'chat'` → `fal-ai/any-llm`, бесплатно: обрабатывается до проверки баланса,
  ответ `{ success, result: { text } }`.
- Остальное → эндпоинт из словаря `endpoints[model]` (фолбэк `flux/schnell`),
  ответ `{ success, new_balance, result: { url } }`. Ошибки — `{ error }`.

## Правила разработки

1. **Синхронность моделей.** Добавляя/удаляя модель, меняйте *оба* места:
   `sortedModels` в `index.html` и `endpoints` в `api/generate.js` — `id` должны совпадать.
2. **Контракт API.** Не меняйте формат запроса/ответа `/api/generate` без одновременной
   правки фронтенда.
3. **Язык.** Весь пользовательский интерфейс, сообщения об ошибках и комментарии —
   на русском, как в существующем коде.
4. **Без новых зависимостей и сборки**, пока это не согласовано явно. Сохраняйте
   структуру «один `index.html`»; внешние скрипты — только с проверенных CDN и с фиксированной версией.
5. **Мобильный UI.** Приложение открывается внутри Telegram на телефоне: проверяйте
   вёрстку на узкой ширине, учитывайте нижний отступ под навигацию.
6. **Безопасность.**
   - Секреты — только через `process.env` на сервере.
   - Не вставляйте пользовательский ввод или ответы моделей через `innerHTML` без
     экранирования — используйте `textContent` (как `appendChatBubble`) или `escapeHtml()`;
     ссылки в `href`/`src` пропускайте через `safeUrl()`.
   - Для серверной логики, зависящей от пользователя, валидируйте `Telegram.WebApp.initData`
     (подпись HMAC с токеном бота), а не `initDataUnsafe`.
7. **Стиль кода.** 4 пробела в `index.html`, 2 пробела в `api/generate.js`, одинарные
   кавычки, `async/await`, `const`/`let` (без `var`).
8. **Коммиты** — короткие и осмысленные (не «Update index.html»): что и зачем изменено.

## Известные проблемы / техдолг

- **Баланс доверяется клиенту.** Монеты хранятся в `localStorage`, сервер проверяет
  `user_coins_client`, присланный фронтендом, а `buyPackage()` начисляет токены без оплаты.
  Для продакшена нужны БД (например, Vercel KV/Postgres), проверка `initData` и реальная оплата.
- Многие «маркетинговые» модели отображаются на одни и те же эндпоинты fal.ai
  (`flux/schnell`, `flux/dev`, `kling-video` и др.) — это заглушки.
- `aspect_ratio: '9:16'` маппится в `portrait_16_9` — проверьте актуальные значения
  `image_size` в документации fal.ai.
- При отсутствии URL результата фронтенд подставляет картинку-заглушку с Unsplash.
