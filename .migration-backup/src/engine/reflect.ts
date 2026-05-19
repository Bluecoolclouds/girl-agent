import type { LLMClient } from "../llm/index.js";
import type { ProfileConfig, RelationshipScore } from "../types.js";
import { appendMd, readRelationship, writeRelationship } from "../storage/md.js";
import type { ConflictState } from "./conflict.js";

export function applyMoodDelta(score: RelationshipScore, delta: Partial<RelationshipScore>): RelationshipScore {
  return {
    interest: clamp(score.interest + (delta.interest ?? 0)),
    trust: clamp(score.trust + (delta.trust ?? 0)),
    attraction: clamp(score.attraction + (delta.attraction ?? 0)),
    annoyance: clamp(score.annoyance + (delta.annoyance ?? 0)),
    cringe: clamp(score.cringe + (delta.cringe ?? 0))
  };
}

function clamp(n: number, lo = -100, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

const REFLECT_SYS = `Ты — журналист, ведущий дневник девушки. По недавнему обмену сообщениями обнови её внутреннее отношение к парню. Кратко.`;

export async function maybeReflect(
  llm: LLMClient,
  cfg: ProfileConfig,
  recent: { role: "user" | "assistant"; content: string }[],
  conflict: ConflictState | null = null
): Promise<void> {
  if (recent.length < 6) return;
  const transcript = recent.slice(-12).map(m => `${m.role === "user" ? "он" : cfg.name}: ${m.content}`).join("\n");

  const conflictNote = conflict && conflict.level > 0
    ? `\n\nВАЖНО: у неё сейчас КОНФЛИКТ с ним (level ${conflict.level}, причина: "${conflict.reason ?? "—"}"). Это влияет на её рефлексию:\n- Level 1: лёгкая обида — чуть более критична к его словам\n- Level 2: серьёзная обида — более негативная рефлексия, фокус на недостатках\n- Level 3+: сильный конфликт — очень негативная рефлексия, может думать что "всё зря"\n- Отрази это в feelingShift и newFacts.`
    : "";

  try {
    const raw = await llm.chat(
      [
        { role: "system", content: REFLECT_SYS },
        {
          role: "user",
          content: `Имя: ${cfg.name}, ${cfg.age} лет. Стадия: ${cfg.stage}.${conflictNote}
Последние сообщения:
${transcript}

Верни JSON:
{
  "newFacts": ["короткие факты о нём, которые стоит запомнить"],
  "feelingShift": "1-2 предложения о том как поменялось её отношение",
  "stageHint": "оставить как есть | повысить | понизить | dumped"
}`
        }
      ],
      { temperature: 0.6, maxTokens: 3500, json: true }
    );
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.newFacts) && parsed.newFacts.length) {
      await appendMd(cfg.slug, "memory/long-term.md",
        `\n\n## ${new Date().toISOString().slice(0, 16)}\n` + parsed.newFacts.map((f: string) => `- ${f}`).join("\n"));
    }
    if (parsed.feelingShift) {
      const rel = await readRelationship(cfg.slug);
      const note = `\n\n## ${new Date().toISOString().slice(0, 16)}\n${parsed.feelingShift}`;
      await writeRelationship(cfg.slug, { ...rel, notes: (rel.notes || "") + note });
    }
  } catch {
    /* swallow */
  }
}
