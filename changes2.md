# Changes — Task #1: Evict stale chat histories from memory

**Файл:** `girl-agent-src/src/engine/runtime.ts`

---

## 1. Таймер TTL-эвикции — строка 156–158

```typescript
// TTL-эвикция in-memory истории чатов — очищаем чаты неактивные >90 минут.
// Без этого Map растёт бесконечно при большом числе подписчиков.
setInterval(() => this.evictStaleHistories(), 15 * 60 * 1000).unref?.();
```

Добавлено в метод `start()`, после уже существующего таймера обрезки `sentMessages`.
Запускается каждые 15 минут, вызывает `evictStaleHistories()`.

---

## 2. Метод `evictStaleHistories()` — строки 311–339

Новый приватный метод. Логика:

- Перебирает все ключи в `this.histories` (ключ = `String(chatId)`)
- **Пропускает** чаты, у которых есть активный `pendingReplyTimers` (агент ещё собирается ответить)
- Считает `lastActivity = max(lastUserMsgTs, lastHerReplyTs)` для этого ключа
- Если `lastActivity > 0` и время больше 90 минут назад — удаляет ключ из 12 Map:

| Map | Что хранит |
|-----|-----------|
| `histories` | буфер диалога (ConversationTurn[]) |
| `lastUserMsgTs` | timestamp последнего сообщения пользователя |
| `lastHerReplyTs` | timestamp последнего ответа агента |
| `exchangeCount` | счётчик обменов в чате |
| `incomingMsgIds` | ID входящих сообщений (дедупликация) |
| `lastDecision` | последний DecisionSnapshot |
| `lastEmojiReactionByKey` | последняя emoji-реакция |
| `incomingSeq` | порядковый номер входящего |
| `lastSentByChat` | ID последнего отправленного сообщения |
| `pendingReplyIncoming` | накопленные входящие для отложенного ответа |
| `pendingReplySeq` | sequence для отложенного ответа |
| `pendingReplyDueAt` | когда должен сработать отложенный ответ |

- `stageStats` **не трогается** — она хранит статистику по stage-ам (ключ = название stage, не chatId)
- При наличии эвиктированных чатов — эмитит событие `info` в WebUI: `history-evict: очищено N неактивных чатов из памяти`

---

## 3. Метод `historyFor()` — строки 298–309

**Было:**
```typescript
private async historyFor(key: string, fromId?: number, restore = false): Promise<ConversationTurn[]> {
  const restored = restore ? await readRecentSessionTurns(this.cfg.slug, this.cfg.tz, fromId, 80) : [];
```

**Стало:**
```typescript
private async historyFor(key: string, fromId?: number, isPrimary = false): Promise<ConversationTurn[]> {
  const limit = isPrimary ? 40 : 20;
  const restored = await readRecentSessionTurns(this.cfg.slug, this.cfg.tz, fromId, limit);
```

Изменения:
- Параметр `restore` переименован в `isPrimary` (семантика та же — вызывается с `isPrimary` на единственном call-site, строка ~704)
- Лимит восстановления теперь зависит от типа чата:
  - **Primary (owner):** 40 turn-ов (было 80)
  - **Acquaintance/подписчик:** 20 turn-ов (было 0 — теперь восстанавливается, но с жёстким ограничением)
- История теперь восстанавливается для **всех** чатов при первом обращении (раньше для acquaintance не восстанавливалась совсем)

---

## Что НЕ трогалось

- `sessions/` — daily summaries (выжимки дней) на диске
- `contacts/[fromId]/cross-chat.md` — долгосрочная персональная память
- mood-файлы, memory-файлы агента
- `stageStats` — статистика по stage-ам (не per-chat)
- Логика промпта, поведенческие тики, mood scoring
