import type { LLMClient } from "../llm/index.js";
import type { ProfileConfig } from "../types.js";
import { readMd, writeMd, listSessionDays, readSessionLog, parseSessionLogTurns } from "../storage/md.js";

const DIGEST_FRESH_MS = 24 * 60 * 60 * 1000; // 24 часа

function digestPath(fromId: number): string {
  return `memory/contacts/${fromId}-digest.md`;
}

function isDigestFresh(raw: string): boolean {
  const m = raw.match(/<!--generated:(.+?)-->/);
  if (!m) return false;
  const ts = Date.parse(m[1] ?? "");
  return !isNaN(ts) && Date.now() - ts < DIGEST_FRESH_MS;
}

/** Читает все логи (не только последние 4 дня) для конкретного chatId */
async function readAllTurnsForContact(
  slug: string,
  fromId: number,
  limit = 80
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const allDays = await listSessionDays(slug);
  if (!allDays.length) return [];
  const raws = await Promise.all(allDays.map(d => readSessionLog(slug, d)));
  const combined = raws.join("\n");
  return parseSessionLogTurns(combined, fromId, limit);
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
 * Если история чата пустая или очень короткая — сканирует все логи,
 * генерирует LLM-выжимку и кешует её на 24ч в memory/contacts/{chatId}-digest.md.
 * Тихий no-op если истории нет вообще.
 */
export async function ensureContactDigest(
  llm: LLMClient,
  cfg: ProfileConfig,
  fromId: number
): Promise<void> {
  try {
    const existing = await readMd(cfg.slug, digestPath(fromId));
    if (existing.trim() && isDigestFresh(existing)) return;

    const turns = await readAllTurnsForContact(cfg.slug, fromId);
    if (turns.length < 8) return;

    const digest = await generateDigest(llm, cfg.name, fromId, turns);
    if (!digest) return;

    await writeMd(
      cfg.slug,
      digestPath(fromId),
      `<!--generated:${new Date().toISOString()}-->\n${digest}\n`
    );
  } catch { /* tихий no-op */ }
}

/** Читает закешированную выжимку (без метаданных) */
export async function readContactDigest(cfg: ProfileConfig, fromId: number): Promise<string> {
  try {
    const raw = await readMd(cfg.slug, digestPath(fromId));
    return raw.replace(/<!--.*?-->/gs, "").trim();
  } catch { return ""; }
}
