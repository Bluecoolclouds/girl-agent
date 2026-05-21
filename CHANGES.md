# Журнал изменений

Каждый раздел — одна функция. Для каждого файла указано: что добавлено (+), что удалено (−), что заменено (~), и на каких строках.

---

## 5. Уведомления владельцу при прогреве контакта

Когда контакт переходит на более тёплую стадию (direction = "up"), бот отправляет Telegram-сообщение на указанный `notifyOwnerId`. Если `notifyOwnerId` не задан — используется `ownerId`. Если оба пустые — уведомлений нет.

**Формат уведомления:**
```
🔔 girl-agent: смена стадии
Профиль: Кристина (кристина)
Контакт ID: 123456789
прогревается 🌡 → тёплый 🔥
Причина: interest+trust threshold reached
Интерес: 45 | Доверие: 30 | Влечение: 20
```

---

### `girl-agent-src/src/types.ts`

**Строка 142** — добавлено новое поле после `ownerId`:

```ts
// ДОБАВЛЕНО:
/** Telegram ID для уведомлений о прогреве контактов. Если не задан — уведомления не отправляются. */
notifyOwnerId?: number;
```

---

### `girl-agent-src/src/storage/md.ts`

**Строка 98** — в `readConfig()`, добавлена нормализация при чтении:

```ts
// ДОБАВЛЕНО (после строки с ownerId):
const notifyOwnerId = normalizeOwnerId(parsed.notifyOwnerId);
```

**Строка 108** — в `readConfig()`, добавлено в возвращаемый объект:

```ts
// ДОБАВЛЕНО в return { ... }:
notifyOwnerId,
```

**Строки 120–126** — `writeConfig()` переписан для сохранения `notifyOwnerId`:

```diff
- const ownerId = normalizeOwnerId(cfg.ownerId ?? process.env.GIRL_AGENT_OWNER_ID);
- const normalized = ownerId === undefined
-   ? { ...cfg, ownerId: undefined, ignoreTendency: ... }
-   : { ...cfg, ownerId, ignoreTendency: ... };
+ const ownerId = normalizeOwnerId(cfg.ownerId ?? process.env.GIRL_AGENT_OWNER_ID);
+ const notifyOwnerId = normalizeOwnerId(cfg.notifyOwnerId);
+ const normalized = {
+   ...cfg,
+   ownerId: ownerId ?? undefined,
+   notifyOwnerId: notifyOwnerId ?? undefined,
+   ignoreTendency: normalizeIgnoreTendency(cfg.ignoreTendency),
+ };
```

---

### `girl-agent-src/src/webui/routes/profiles.ts`

**Строка 87** — в PATCH `/api/profiles/:slug` добавлена обработка поля:

```ts
// ДОБАВЛЕНО (после строки с ownerId):
if (incoming.notifyOwnerId !== undefined) merged.notifyOwnerId = normalizeOwnerId(incoming.notifyOwnerId);
```

---

### `girl-agent-src/src/engine/runtime.ts`

**Строки 1603–1605** — в `checkStageTransition()`, после логирования перехода добавлен вызов уведомления:

```ts
// ДОБАВЛЕНО (после appendSessionLog):
if (decision.direction === "up") {
  await this.sendOwnerStageNotification(fromId, oldStage, decision.next, rel.score, decision.reason).catch(() => {});
}
```

**Строки 1609–1639** — добавлен новый приватный метод (после закрывающей скобки `checkStageTransition`):

```ts
// ДОБАВЛЕНО — новый метод класса Runtime:
private async sendOwnerStageNotification(
  contactId: number,
  oldStage: string,
  newStage: string,
  score: import("../types.js").RelationshipScore,
  reason: string
): Promise<void> {
  const notifyId = this.cfg.notifyOwnerId ?? this.cfg.ownerId;
  if (!notifyId) return;
  const STAGE_LABELS: Record<string, string> = {
    "met-irl-got-tg": "познакомились",
    "tg-given-cold": "холодный ❄️",
    "tg-given-warming": "прогревается 🌡",
    "convinced": "тёплый 🔥",
    "first-date-done": "горячий 💰",
    "dating-early": "покупатель 💳",
    "dating-stable": "постоянный ⭐",
    "long-term": "VIP 👑",
    "dumped": "заблокирован ❌",
  };
  const label = (s: string) => STAGE_LABELS[s] ?? s;
  const text = [
    `🔔 girl-agent: смена стадии`,
    `Профиль: ${this.cfg.name} (${this.cfg.slug})`,
    `Контакт ID: ${contactId}`,
    `${label(oldStage)} → ${label(newStage)}`,
    `Причина: ${reason}`,
    `Интерес: ${score.interest} | Доверие: ${score.trust} | Влечение: ${score.attraction}`,
  ].join("\n");
  await this.tg.sendText(notifyId, text).catch(() => {});
}
```

---

### `artifacts/girl-agent/src/lib/api.ts`

**Строка 20** — добавлено в интерфейс `ProfileConfig` (после `ownerId`):

```ts
// ДОБАВЛЕНО:
notifyOwnerId?: number;
```

---

### `artifacts/girl-agent/src/pages/ConfigurationPage.tsx`

**Строки 179–183** — добавлен новый блок после поля Owner ID:

```tsx
// ДОБАВЛЕНО (после </div> блока Owner ID):
<div className="form-row">
  <label>Notify ID (уведомления о прогреве)</label>
  <input
    className="input"
    type="number"
    value={merged.notifyOwnerId ?? ""}
    onChange={e => pf("notifyOwnerId", Number(e.target.value) || undefined)}
    placeholder="Telegram ID для уведомлений — если пусто, уведомления выключены"
  />
  <div className="hint">
    Когда контакт переходит на более тёплую стадию — бот пришлёт уведомление на этот ID.
    Если оставить пустым — уведомления выключены.
  </div>
</div>
```

---

## 8. Цитата на конкретное сообщение ([REPLY_TO])

LLM теперь может ответить с цитатой на последнее сообщение юзера — как кнопка «Ответить» в Telegram. Только для userbot режима. LLM решает сам когда использовать.

---

### `girl-agent-src/src/telegram/index.ts`

**Строка 63** — расширена сигнатура `sendText`:
```diff
- sendText(chatId: number | string, text: string): Promise<number | undefined>;
+ sendText(chatId: number | string, text: string, replyToMessageId?: number): Promise<number | undefined>;
```

---

### `girl-agent-src/src/telegram/userbot.ts`

**Строка 290** — `sendMessage` теперь принимает `replyTo`:
```diff
- async sendText(chatId, text) {
-   const msg = await client.sendMessage(peer, { message: text });
+ async sendText(chatId, text, replyToMessageId) {
+   const msg = await client.sendMessage(peer, {
+     message: text,
+     ...(replyToMessageId ? { replyTo: replyToMessageId } : {}),
+   });
```

---

### `girl-agent-src/src/telegram/bot.ts`

**Строка 81** — `sendMessage` Bot API принимает `reply_parameters`:
```diff
- async sendText(chatId, text) {
+ async sendText(chatId, text, replyToMessageId) {
+   const replyParams = replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {};
    ...
-   const msg = await bot.api.sendMessage(chatId as number, text);
+   const msg = await bot.api.sendMessage(chatId as number, text, replyParams as any);
```

---

### `girl-agent-src/src/engine/runtime.ts`

**Строка 351** — `sendBubbles` принимает `replyToMessageId?`:
```diff
- private async sendBubbles(..., typing = true): Promise<string[]>
+ private async sendBubbles(..., typing = true, replyToMessageId?: number): Promise<string[]>
```

**Строка 384** — только первый пузырь отправляется с цитатой:
```ts
// ДОБАВЛЕНО:
const replyId = i === 0 ? replyToMessageId : undefined;
const messageId = await this.tg.sendText(chatId, text, replyId);
```

**Строка 1461** — `parseToolMarkers` возвращает флаг `replyTo`:
```diff
- private parseToolMarkers(reply: string): { cleanedReply: string; actions: string[] }
+ private parseToolMarkers(reply: string): { cleanedReply: string; actions: string[]; replyTo: boolean }
  // REPLY_TO добавлен в KNOWN, отфильтровывается из actions, возвращается как boolean
```

**Строка 943** — в `generateAndSend()` парсится и применяется `replyTo`:
```ts
// ДОБАВЛЕНО:
const { cleanedReply, actions, replyTo } = ...parseToolMarkers(reply)...;
const replyToMessageId = replyTo && incoming?.messageId ? incoming.messageId : undefined;
const sent = await this.sendBubbles(chatId, bubbles, hist, scope, tick.typing, replyToMessageId);
```

---

### `girl-agent-src/src/engine/prompt.ts`

**Строки 306** — добавлен маркер в список доступных действий:
```
// ДОБАВЛЕНО в # ДОСТУПНЫЕ ДЕЙСТВИЯ (userbot):
- [REPLY_TO] — ответить с цитатой на его последнее сообщение (как кнопка «ответить» в тг).
  Используй редко и натурально: несколько сообщений подряд / хочешь выделить фразу / прошло время.
```

---

## 7. Emoji-реакции записываются в историю диалога

Раньше реакции обрабатывались тихо (настроение, react-back) но не попадали в историю диалога. LLM не знал о реакции и говорил «не видела». Теперь каждая реакция записывается как синтетическая запись в историю.

---

### `girl-agent-src/src/engine/runtime.ts`

**Строки 1763–1769** — в `handleEmojiReaction()`, после логирования, добавлено:
```ts
// ДОБАВЛЕНО (только для не-removed реакций):
if (!m.emojiReaction.removed) {
  const targetSnippet = herLastMessageText ? ` на твоё сообщение: "${herLastMessageText.slice(0, 80)}"` : "";
  const histEntry = `(поставил реакцию ${m.emojiReaction.emoji}${targetSnippet})`;
  hist.push({ role: "user", content: histEntry, ts: Date.now() });
  this.histories.set(key, hist);
}
```

---

### `girl-agent-src/src/engine/prompt.ts`

**После секции "РЕАКЦИИ И ЭДИТЫ"** — добавлена инструкция:
```
// ДОБАВЛЕНО:
# СОБЫТИЯ В ИСТОРИИ ДИАЛОГА
Если в истории есть строка "(поставил реакцию X на твоё сообщение: ...)" — это реальное событие.
Ты её видела. Не говори "не видела". Реагируй по persona/stage.
```

---

## 6. Bugfix: старые media-маршруты в profiles.ts перекрывали media.ts

`profiles.ts` содержал устаревший блок маршрутов для `/photos` зарегистрированный раньше `media.ts`. Роутер хватал первый совпавший — GET возвращал `{files, index}` вместо `{photos}`, POST шёл на `/photos/upload` (бинарный, не base64). Медиатека в WebUI показывала пустой список.

---

### `girl-agent-src/src/webui/routes/profiles.ts`

**Строки 347–412** — удалён весь блок «Фото-библиотека»:
```diff
- // Фото-библиотека
- r.get("/api/profiles/:slug/photos", ...)    // возвращал {files, index}
- r.post("/api/profiles/:slug/photos/upload", ...) // бинарный upload через хедер
- r.put("/api/profiles/:slug/photos/index", ...)   // raw index edit
- r.delete("/api/profiles/:slug/photos/:filename", ...) // только jpg/png/webp
```

Все эти маршруты теперь обрабатывает `media.ts` с правильным форматом и поддержкой видео.

---

## 1. Per-contact relationship (отношения per-контакт)

Раньше у всего профиля был один файл `relationship.md`. Теперь у каждого контакта свой файл в `data/<slug>/contacts/<fromId>/relationship.md`. Общий файл сохраняется как fallback для WebUI и headless-режима.

---

### `girl-agent-src/src/storage/md.ts`

**Строки 187–214**

```diff
- export async function readRelationship(slug: string): Promise<RelationshipState>
+ export async function readRelationship(slug: string, fromId?: number): Promise<RelationshipState>

  // В начале тела функции:
+ const file = fromId != null ? contactRelFile(fromId) : "relationship.md";
- const raw = await readMd(slug, "relationship.md");
+ const raw = await readMd(slug, file);
```

```diff
- export async function writeRelationship(slug: string, state: RelationshipState): Promise<void>
+ export async function writeRelationship(slug: string, state: RelationshipState, fromId?: number): Promise<void>

+ const file = fromId != null ? contactRelFile(fromId) : "relationship.md";
- await writeMd(slug, "relationship.md", body);
+ await writeMd(slug, file, body);
```

Добавлена вспомогательная функция (перед `readRelationship`):
```ts
function contactRelFile(fromId: number): string {
  return `contacts/${fromId}/relationship.md`;
}
```

---

### Файлы где обновлены call sites (добавлен второй аргумент `fromId`)

Во всех этих файлах вызовы `readRelationship(slug)` / `writeRelationship(slug, state)` заменены на `readRelationship(slug, fromId)` / `writeRelationship(slug, state, fromId)` там, где есть `fromId` из входящего сообщения.

| Файл | Примечание |
|------|-----------|
| `girl-agent-src/src/engine/runtime.ts` | `handleIncoming`, `reflect`, в нескольких местах где есть `chatId`/`fromId` |
| `girl-agent-src/src/engine/headless.ts` | headless-режим, используется slug без fromId (fallback) |
| `girl-agent-src/src/engine/prompt.ts` | читает relationship для системного промпта |
| `girl-agent-src/src/engine/behavior-tick.ts` | тик поведения, читает/пишет stage |
| `girl-agent-src/src/engine/reflect.ts` | рефлексия после диалога |
| `girl-agent-src/src/engine/agenda.ts` | повестка дня агента |
| `girl-agent-src/src/webui/routes/profiles.ts` | WebUI API `/api/profiles/:slug/relationship` — без fromId (общий) |
| `girl-agent-src/src/webui/websocket.ts` | WebSocket статус — без fromId (общий) |

---

## 2. Quota exhaustion (офлайн при исчерпании баланса)

Когда LLM возвращает ошибку `quota / billing / 401 / 403`, бот полностью уходит в офлайн. Сбросить только через `:resume` (`:reset` не сбрасывает).

---

### `girl-agent-src/src/engine/security.ts`

**Строки 92–100** — добавлена новая экспортируемая функция:

```ts
// ДОБАВЛЕНО после isTechnicalError():
export function isQuotaExhaustedError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();
  return /quota|balance|billing|insufficient_quota|credit|credits|401|403|unauthorized|forbidden/.test(msg);
}
```

---

### `girl-agent-src/src/engine/runtime.ts`

**Строка 26** — добавлен импорт:
```diff
- import { looksLikeJailbreak, sanitizeModelReply, silentErrorLabel } from "./security.js";
+ import { isQuotaExhaustedError, looksLikeJailbreak, sanitizeModelReply, silentErrorLabel } from "./security.js";
```

**Строка 74** — новое поле класса Runtime:
```ts
// ДОБАВЛЕНО (после `private paused = false;`):
/** Установлен когда API вернул quota/billing/auth ошибку. Сбрасывается через :resume. */
private quotaExhausted = false;
```

**Строка 165** — изменён метод `resume()`:
```diff
- resume() { this.paused = false; }
+ resume() { this.paused = false; this.quotaExhausted = false; }
```

**Строка 571** — в `onlineHeartbeatTick()` добавлена проверка:
```diff
- if (this.paused || !this.tg?.updateOnlineStatus) return;
+ if (this.paused || this.quotaExhausted || !this.tg?.updateOnlineStatus) return;
```

**Строки 601, 916–921** — в `handleIncoming()` добавлена проверка и обработчик ошибки:
```ts
// В начале handleIncoming — ранний выход:
if (this.quotaExhausted) return;

// В catch-блоке после вызова llm.chat():
if (isQuotaExhaustedError(e)) {
  this.quotaExhausted = true;
  this.emit("event", { type: "error", text: `quota-exhausted: баланс/токены исчерпаны — бот ушёл в офлайн. Пополни баланс и выполни :resume` });
  if (this.tg?.updateOnlineStatus) await this.tg.updateOnlineStatus(false).catch(() => {});
  return;
}
```

---

### `artifacts/girl-agent/src/pages/LogsPage.tsx`

**Строка 107** — добавлена кнопка `:resume` рядом с существующими командами (:status, :why, :wake, :debug):

```tsx
// ДОБАВЛЕНО в панель команд (между :debug и :reset):
<button className="btn tiny" onClick={() => void runCommand(activeSlug, "resume")}>:resume</button>
```

---

## 3. Media library (медиатека)

Новая страница для загрузки и управления фото/видео. Файлы хранятся в `data/<slug>/photos/`, индекс в `data/<slug>/photos/index.md` (формат: `filename | tag1,tag2 | caption`).

---

### `girl-agent-src/src/webui/routes/media.ts` — НОВЫЙ ФАЙЛ

Полный список эндпоинтов:

| Метод | URL | Описание |
|-------|-----|----------|
| `GET` | `/api/profiles/:slug/photos` | Список всех файлов с тегами, подписями, URL |
| `GET` | `/api/profiles/:slug/photos/file/:filename` | Отдаёт бинарный файл (с MIME-типом) |
| `POST` | `/api/profiles/:slug/photos` | Загрузка (base64 JSON: `{ filename, data, mimeType, tags[], caption }`) |
| `PUT` | `/api/profiles/:slug/photos/:filename` | Обновление тегов и/или подписи |
| `DELETE` | `/api/profiles/:slug/photos/:filename` | Удаление файла + строки из индекса |

---

### `girl-agent-src/src/webui/server.ts`

**Строка 16** — добавлен импорт:
```ts
// ДОБАВЛЕНО:
import { registerMediaRoutes } from "./routes/media.js";
```

**Строка 90** — в `buildRouter()` добавлена регистрация:
```ts
// ДОБАВЛЕНО внутри buildRouter() после других registerXxxRoutes():
registerMediaRoutes(r);
```

---

### `girl-agent-src/src/webui/http.ts`

**Строка 88** — увеличен лимит тела запроса с 32 МБ до 150 МБ (для загрузки видео):

```diff
- if (len > 32 * 1024 * 1024) {
+ if (len > 150 * 1024 * 1024) {
```

---

### `artifacts/girl-agent/src/lib/api.ts`

**Строки 237–257** — добавлены 4 метода и интерфейс (в конце объекта `api`, перед закрывающей `}`):

```ts
// ДОБАВЛЕНО:
async listPhotos(slug: string) {
  return req<{ photos: PhotoEntry[] }>("GET", `/api/profiles/${encodeURIComponent(slug)}/photos`);
},
async uploadPhoto(slug: string, payload: { filename: string; data: string; mimeType: string; tags: string[]; caption: string }) {
  return req<{ ok: true; filename: string }>("POST", `/api/profiles/${encodeURIComponent(slug)}/photos`, payload);
},
async updatePhoto(slug: string, filename: string, payload: { tags?: string[]; caption?: string }) {
  return req<{ ok: true }>("PUT", `/api/profiles/${encodeURIComponent(slug)}/photos/${encodeURIComponent(filename)}`, payload);
},
async deletePhoto(slug: string, filename: string) {
  return req<{ ok: true }>("DELETE", `/api/profiles/${encodeURIComponent(slug)}/photos/${encodeURIComponent(filename)}`);
},

// ДОБАВЛЕНО после объекта api:
export interface PhotoEntry {
  filename: string;
  tags: string[];
  caption: string;
  url: string;
  isVideo: boolean;
}
```

---

### `artifacts/girl-agent/src/pages/MediaPage.tsx` — НОВЫЙ ФАЙЛ

Компонент `MediaPage` (экспортируется) + внутренний компонент `MediaCard`.

Ключевые части:
- `TAGS_PRESET` — массив строк-тегов (selfie, cute, flirt, hot, tease, video…)
- `fileToBase64(file)` — конвертирует File в base64 строку
- `MediaCard` — карточка одного файла: превью, редактирование тегов/подписи, удаление
- `MediaPage` — страница: загрузка через drag-and-drop или клик, сетка карточек, кнопка выбора файлов

---

### `artifacts/girl-agent/src/App.tsx`

**Строка 15** — добавлен импорт:
```ts
// ДОБАВЛЕНО:
import { MediaPage } from "./pages/MediaPage";
```

**Строка 52** — добавлен рендер страницы в таб-роутер:
```tsx
// ДОБАВЛЕНО (среди других {tab === "xxx" && <XxxPage />}):
{tab === "media" && <MediaPage />}
```

Тип `Tab` в `store.ts` — добавлено значение `"media"`:
```diff
- type Tab = "logs" | "relationship" | "config" | "memory" | "addons" | "assistant" | "diagnostics"
+ type Tab = "logs" | "relationship" | "config" | "memory" | "addons" | "assistant" | "diagnostics" | "media"
```

---

### `artifacts/girl-agent/src/components/Sidebar.tsx`

**Строка 11** — добавлен пункт меню в массив навигации:
```ts
// ДОБАВЛЕНО (между "memory" и "addons"):
{ id: "media", label: "Медиатека", icon: "◈" },
```

---

### `artifacts/girl-agent/src/styles.css`

Добавлены стили для медиастраницы (в конец файла):

```css
/* ДОБАВЛЕНО: */
.media-grid { ... }           /* сетка карточек */
.media-card { ... }           /* карточка файла */
.media-thumb { ... }          /* превью изображения/видео */
.media-video-badge { ... }    /* значок ▶ на видео */
.media-filename { ... }       /* имя файла под превью */
.media-tags { ... }           /* строка тегов */
.media-tag { ... }            /* один тег */
.media-dropzone { ... }       /* зона drag-and-drop при пустой библиотеке */
.media-dropzone-icon { ... }
.media-dropzone-title { ... }
.media-dropzone-hint { ... }
.media-actions { ... }        /* кнопки сохранить/отмена в форме редактирования */
.media-upload-bar { ... }     /* строка прогресса загрузки */
```

---

## 4. Bugfix: MediaPage crash (TypeError: photos.length of undefined)

**Симптом:** при переходе на вкладку Медиатека — `TypeError: Cannot read properties of undefined (reading 'length')` на строке 225.

**Причина:** `api.listPhotos()` при 502 или нестандартном ответе бэкенда могла вернуть объект без поля `photos`. Вызов `setPhotos(r.photos)` записывал `undefined` в стейт, перетирая начальный `[]`.

---

### `artifacts/girl-agent/src/pages/MediaPage.tsx`

**Строка 148** (~внутри `load()` callback):
```diff
- setPhotos(r.photos);
+ setPhotos(Array.isArray(r?.photos) ? r.photos : []);
```

**Строка 225** (~в JSX return):
```diff
- ) : photos.length === 0 ? (
+ ) : (photos ?? []).length === 0 ? (
```
