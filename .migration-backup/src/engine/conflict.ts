// Длинные конфликты. Когда юзер реально достал / накосячил, она может уйти в офлайн на дни.
// Хранится в data/<slug>/conflict.json. Влияет на behavior-tick (sets coldUntil → ignore).

import { promises as fs } from "node:fs";
import path from "node:path";
import { profileDir, ensureProfile, appendMd } from "../storage/md.js";
import type { RelationshipScore } from "../types.js";

export interface ConflictState {
  /** ISO время до которого она "молчит" — игнор, не отвечает. */
  coldUntil?: string;
  /** Уровень: 0=нет, 1=обиделась на час, 2=обижена сутки, 3=серьёзный конфликт несколько дней, 4=на грани разрыва */
  level: 0 | 1 | 2 | 3 | 4;
  /** Что именно её зацепило. Кратко. */
  reason?: string;
  /** ISO начала конфликта */
  since?: string;
  /** Лог инцидентов */
  history: { ts: string; note: string; deltaLevel: number }[];
}

const empty: ConflictState = { level: 0, history: [] };

export async function readConflict(slug: string): Promise<ConflictState> {
  try {
    const raw = await fs.readFile(path.join(profileDir(slug), "conflict.json"), "utf8");
    const parsed = JSON.parse(raw);
    return { ...empty, ...parsed, history: parsed.history ?? [] };
  } catch { return { ...empty, history: [] }; }
}

export async function writeConflict(slug: string, c: ConflictState): Promise<void> {
  await ensureProfile(slug);
  await fs.writeFile(path.join(profileDir(slug), "conflict.json"), JSON.stringify(c, null, 2), "utf8");
}

/** Текущее состояние конфликта (с учётом истечения cold-периода) */
export function activeConflict(c: ConflictState, now = new Date()): { active: boolean; coldActive: boolean } {
  const cold = c.coldUntil ? new Date(c.coldUntil).getTime() > now.getTime() : false;
  return { active: c.level > 0, coldActive: cold };
}

/** Решает по mood-delta + сообщению нужно ли поднять/опустить уровень конфликта */
export function escalateFromMood(
  current: ConflictState,
  delta: Partial<RelationshipScore>,
  score: RelationshipScore,
  incomingText: string
): ConflictState {
  const ann = delta.annoyance ?? 0;
  const cr = delta.cringe ?? 0;
  const interestDrop = -(delta.interest ?? 0);
  const trigger = ann + cr + interestDrop;

  let newLevel = current.level;
  let coldHours = 0;
  let bumpReason: string | undefined;

  if (trigger >= 25 || score.annoyance > 70) { newLevel = Math.max(newLevel, 3) as ConflictState["level"]; coldHours = 24 + Math.random() * 24; bumpReason = "сильный негатив"; }
  else if (trigger >= 15) { newLevel = Math.max(newLevel, 2) as ConflictState["level"]; coldHours = 4 + Math.random() * 12; bumpReason = "обижена"; }
  else if (trigger >= 8) { newLevel = Math.max(newLevel, 1) as ConflictState["level"]; coldHours = 0.5 + Math.random() * 2; bumpReason = "немного дуется"; }

  if (score.annoyance > 85 && score.cringe > 70 && score.interest < -30) {
    newLevel = 4;
    coldHours = Math.max(coldHours, 48 + Math.random() * 48);
    bumpReason = "на грани разрыва";
  }

  if (newLevel === current.level && newLevel === 0) return current;

  const next: ConflictState = { ...current };
  if (newLevel > current.level) {
    next.level = newLevel as ConflictState["level"];
    next.since = next.since ?? new Date().toISOString();
    next.reason = bumpReason ?? next.reason;
    if (coldHours > 0) {
      const until = new Date(Date.now() + coldHours * 3600_000);
      // если уже есть более длинный cold — оставляем больший
      const existing = current.coldUntil ? new Date(current.coldUntil).getTime() : 0;
      next.coldUntil = until.getTime() > existing ? until.toISOString() : current.coldUntil;
    }
    next.history = [...(current.history ?? []), {
      ts: new Date().toISOString(),
      note: `level ${current.level}→${newLevel}: ${bumpReason} | "${incomingText.slice(0, 60)}"`,
      deltaLevel: newLevel - current.level
    }];
  }
  return next;
}

/** При очень милом сообщении — снижаем уровень конфликта (помириться) */
export function softenFromMood(
  current: ConflictState,
  delta: Partial<RelationshipScore>
): ConflictState {
  if (current.level === 0) return current;
  const positive = (delta.attraction ?? 0) + (delta.trust ?? 0) + (delta.interest ?? 0);
  if (positive < 12) return current;

  const next: ConflictState = { ...current };
  next.level = Math.max(0, current.level - 1) as ConflictState["level"];
  if (next.level === 0) {
    next.coldUntil = undefined;
    next.since = undefined;
    next.reason = undefined;
  } else if (next.coldUntil) {
    // сократим cold вдвое
    const remaining = new Date(next.coldUntil).getTime() - Date.now();
    if (remaining > 0) next.coldUntil = new Date(Date.now() + remaining / 2).toISOString();
  }
  next.history = [...(current.history ?? []), {
    ts: new Date().toISOString(),
    note: `softened to level ${next.level} (positive ${positive})`,
    deltaLevel: next.level - current.level
  }];
  return next;
}

export function conflictPromptFragment(c: ConflictState, now = new Date()): string {
  const { active, coldActive } = activeConflict(c, now);
  if (!active) return "";
  const lines: string[] = [
    `# КОНФЛИКТ (level ${c.level})`,
    `Причина: ${c.reason ?? "—"}. Идёт с ${c.since ?? "недавно"}.`
  ];
  if (coldActive) {
    const until = c.coldUntil ? new Date(c.coldUntil) : null;
    const hoursLeft = until ? Math.max(0, Math.round((until.getTime() - now.getTime()) / 3600_000)) : 0;
    lines.push(`Ты СЕЙЧАС в режиме молчания. Осталось ~${hoursLeft}ч игнора.`);
    if (c.level >= 3) {
      lines.push(`На сообщения отвечай очень редко, сухо: ".", "и?", "ну?", "что". Никаких смайликов, скобок ")" нет вообще. Можно вообще игнорить.`);
    } else {
      lines.push(`Отвечаешь сухо, односложно. Нет ")", нет "пхпх", никакого тепла.`);
    }
    lines.push(`Простить можешь только если ОН реально извинится по существу — не "ну прости" а реально объяснит. Тогда оттаешь медленно, не сразу.`);
  } else {
    lines.push(`Cold-период истёк, но осадочек остался. Будь сдержаннее обычного.`);
  }
  return lines.join("\n");
}

/** При reset чистим конфликт */
export async function clearConflict(slug: string): Promise<void> {
  await writeConflict(slug, { level: 0, history: [] });
}

/** Логируем конфликт в memory/long-term (для долгосрочного хендлинга после reset/ремонта) */
export async function logConflictToMemory(slug: string, c: ConflictState): Promise<void> {
  if (c.level === 0 || !c.history.length) return;
  const last = c.history[c.history.length - 1];
  if (!last) return;
  await appendMd(slug, "memory/conflicts.md",
    `\n\n## ${last.ts}\n- level: ${c.level}\n- reason: ${c.reason ?? "?"}\n- note: ${last.note}\n`);
}
