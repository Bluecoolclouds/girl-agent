# Журнал изменений

Каждый раздел — одна функция. Для каждого файла указано: что добавлено (+), что удалено (−), что заменено (~), и на каких строках.

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
