# Changes — всё что сделали сегодня

---

## Изменение 1 — Фикс инфляции mood scoring

**Файл:** `girl-agent-src/src/engine/behavior-tick.ts`  
**Строки:** 389–407 (новая функция) + 214, 271 (call sites)

**Проблема:** LLM возвращал дельты настроения вроде `annoyance: 99`, `cringe: 99` — без ограничений они сразу загоняли отношения в крайности.

**Решение:** Добавлена функция `sanitizeMoodDelta()` — hard-clamp всех значений перед записью:

```typescript
function sanitizeMoodDelta(
  delta: Partial<Record<string, number>>,
  isAcquaintance: boolean
): Partial<Record<string, number>> {
  const keys = ["interest", "trust", "attraction", "annoyance", "cringe"];
  for (const key of keys) {
    if (isAcquaintance && (key === "annoyance" || key === "cringe")) {
      result[key] = clamp(raw, -5, 5);   // acquaintance — жёстче
    } else {
      result[key] = clamp(raw, -10, 10); // primary — стандарт
    }
  }
}
```

| Scope | annoyance / cringe | остальные (interest, trust, attraction) |
|-------|-------------------|----------------------------------------|
| Acquaintance/подписчик | ±5 за одно сообщение | ±10 |
| Primary (owner) | ±10 | ±10 |

Call sites:
- **Строка 214** — jailbreak-тик: `moodDelta: sanitizeMoodDelta(result.moodDelta || { annoyance: 3 }, !!ctx.isAcquaintance)`
- **Строка 271** — основной behavior-тик: `moodDelta: sanitizeMoodDelta(parsed.moodDelta || {}, !!ctx.isAcquaintance)`

---

## Изменение 2 — TTL-эвикция in-memory историй чатов

**Файл:** `girl-agent-src/src/engine/runtime.ts`

**Проблема:** `this.histories` и 12 сопутствующих Map накапливали записи по всем чатам за всё время работы процесса. При 200+ активных подписчиках RAM росла бесконечно.

### 2а. Таймер в `start()` — строки 156–158

```typescript
// TTL-эвикция in-memory истории чатов — очищаем чаты неактивные >90 минут.
setInterval(() => this.evictStaleHistories(), 15 * 60 * 1000).unref?.();
```

Запускается каждые 15 минут.

### 2б. Метод `evictStaleHistories()` — строки 311–339

Логика:
- Перебирает все ключи `this.histories` (ключ = `String(chatId)`)
- **Пропускает** чаты с активным `pendingReplyTimers` (агент ещё не ответил)
- `lastActivity = max(lastUserMsgTs, lastHerReplyTs)` — если > 0 и старше 90 минут → вычищает из 12 Map:

| Map | Что хранит |
|-----|-----------|
| `histories` | буфер диалога (ConversationTurn[]) |
| `lastUserMsgTs` | ts последнего сообщения пользователя |
| `lastHerReplyTs` | ts последнего ответа агента |
| `exchangeCount` | счётчик обменов |
| `incomingMsgIds` | ID входящих (дедупликация) |
| `lastDecision` | последний DecisionSnapshot |
| `lastEmojiReactionByKey` | последняя emoji-реакция |
| `incomingSeq` | порядковый номер входящего |
| `lastSentByChat` | ID последнего отправленного сообщения |
| `pendingReplyIncoming` | входящие для отложенного ответа |
| `pendingReplySeq` | sequence отложенного ответа |
| `pendingReplyDueAt` | когда сработает отложенный ответ |

`stageStats` **не трогается** — она хранит статистику по stage-ам (ключ = имя stage, не chatId).

При эвикции эмитит событие в WebUI: `history-evict: очищено N неактивных чатов из памяти`.

---

## Изменение 3 — Лимиты восстановления истории при старте

**Файл:** `girl-agent-src/src/engine/runtime.ts`  
**Метод:** `historyFor()` — строки 298–309

**Было:**
```typescript
private async historyFor(key, fromId, restore = false) {
  const restored = restore
    ? await readRecentSessionTurns(..., 80)  // только primary, 80 turn-ов
    : [];                                     // acquaintance — вообще ничего
```

**Стало:**
```typescript
private async historyFor(key, fromId, isPrimary = false) {
  const limit = isPrimary ? 40 : 20;          // primary: 40, acquaintance: 20
  const restored = await readRecentSessionTurns(..., limit);  // всегда восстанавливаем
```

| Тип чата | Было | Стало |
|----------|------|-------|
| Primary (owner) | 80 turn-ов | 40 turn-ов |
| Acquaintance/подписчик | 0 (не восстанавливался) | 20 turn-ов |

Acquaintance теперь тоже получает контекст при первом обращении после рестарта, но с жёстким ограничением в 20 turn-ов.

---

## Что НЕ трогалось

- `sessions/` — daily summaries (выжимки дней) на диске — **остаются**
- `contacts/[fromId]/cross-chat.md` — долгосрочная персональная память — **остаётся**
- mood-файлы, memory-файлы агента — **остаются**
- Логика промпта, поведенческих тиков, LLM вызовов — **не менялась**
- `stageStats` — статистика переходов между stage-ами — **не трогалась**

---

## Что обсудили но не меняли (только объяснения)

- **Город/детали собеседника** — уже пишутся в `contacts/[fromId]/cross-chat.md` через `recordInteractionMemory()`
- **Фото из канала** — работает только в userbot-режиме при заданном `photoChannelId`; в bot-режиме Telegram API не позволяет пересылать из приватных каналов
- **Rate limiting** — LLM semaphore=5 (параллельных вызовов), Telegram использует `retryDelay` при 429. Очередь не ограничена сверху (возможная проблема при 200+ чатах одновременно)
- **Старые сообщения** — в bot-режиме `drops_pending_updates=true` при старте, поэтому старые сообщения намеренно игнорируются; в userbot-режиме нет явного catch-up механизма
