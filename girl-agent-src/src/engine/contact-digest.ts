import type { LLMClient } from "../llm/index.js";
import type { ProfileConfig } from "../types.js";
import type { TgAdapter } from "../telegram/index.js";
import { readMd, writeMd } from "../storage/md.js";

const DIGEST_FRESH_MS = 24 * 60 * 60 * 1000; // 24 часа
const HISTORY_LIMIT = 100;

function digestPath(fromId: number): string {
  return `memory/contacts/${fromId}-digest.md`;
}

function isDigestFresh(raw: string): boolean {
  const m = raw.match(/<!--generated:(.+?)-->/);
  if (!m) return false;
  const ts = Date.parse(m[1] ?? "");
  return !isNaN(ts) && Date.now() - ts < DIGEST_FRESH_MS;
}

/** Генерирует LLM-выжимку по истории переписки с конкретным контактом */
async function generateDigest(
  llm: LLMClient,
  agentName: string,
  fromId: number,
  turns: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const transcript = turns
    .slice(-60)
    .map(t => `${t.role === "user" ? "он" : agentName}: ${t.content}`)
    .join("\n");

  const raw = await llm.chat(
    [
      {
        role: "system",
        content: `Ты аналитик переписки. По транскрипту диалога составь короткую выжимку (5-10 пунктов) — что важно знать девушке перед тем как продолжить общение с этим человеком. Пиши как внутренние заметки, коротко.`
      },
      {
        role: "user",
        content: `chatId: ${fromId}\n\nТранскрипт (от старых к новым):\n${transcript}\n\nВыжимка:`
      }
    ],
    { temperature: 0.4, maxTokens: 600 }
  );
  return raw.trim();
}

/**
 * Скачивает историю чата через TG, генерирует LLM-выжимку и кешует на 24ч.
 * Тихий no-op если fetchChatHistory недоступен или история пустая.
 */
export async function ensureContactDigest(
  llm: LLMClient,
  cfg: ProfileConfig,
  fromId: number,
  tg: TgAdapter
): Promise<void> {
  try {
    const existing = await readMd(cfg.slug, digestPath(fromId));
    if (existing.trim() && isDigestFresh(existing)) return;

    if (!tg.fetchChatHistory) return;

    const turns = await tg.fetchChatHistory(fromId, HISTORY_LIMIT);
    if (turns.length < 8) return;

    const digest = await generateDigest(llm, cfg.name, fromId, turns);
    if (!digest) return;

    await writeMd(
      cfg.slug,
      digestPath(fromId),
      `<!--generated:${new Date().toISOString()}-->\n${digest}\n`
    );
  } catch { /* тихий no-op */ }
}

/** Читает закешированную выжимку (без метаданных) */
export async function readContactDigest(cfg: ProfileConfig, fromId: number): Promise<string> {
  try {
    const raw = await readMd(cfg.slug, digestPath(fromId));
    return raw.replace(/<!--.*?-->/gs, "").trim();
  } catch { return ""; }
}
