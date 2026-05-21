/**
 * channel-scan.ts — сканирует photoChannelId через TgAdapter
 * и дописывает новые фото/видео в photos/index.md профиля.
 * Вызывается автоматически при старте Runtime (в фоне).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProfileConfig } from "../types.js";
import type { TgAdapter } from "../telegram/index.js";
import { profileDir } from "../storage/md.js";

const INDEX_FILE = "photos/index.md";
const SCAN_LIMIT = 200;

export async function scanChannelPhotos(
  cfg: ProfileConfig,
  tg: TgAdapter
): Promise<{ added: number; skipped: number }> {
  const channelId = cfg.photoChannelId;
  if (!channelId || !tg.iterChannelMedia) return { added: 0, skipped: 0 };

  const indexPath = path.join(profileDir(cfg.slug), INDEX_FILE);

  // Читаем уже существующие ID чтобы не дублировать
  let existing = "";
  try { existing = await fs.readFile(indexPath, "utf8"); } catch { /* нет файла */ }
  const existingIds = new Set<number>();
  for (const line of existing.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const first = trimmed.split("|")[0]?.trim() ?? "";
    const id = parseInt(first, 10);
    if (!isNaN(id)) existingIds.add(id);
  }

  const newLines: string[] = [];
  let skipped = 0;

  for await (const item of tg.iterChannelMedia(channelId, SCAN_LIMIT)) {
    if (existingIds.has(item.id)) { skipped++; continue; }
    newLines.push(item.caption
      ? `${item.id} | ${item.type} | ${item.caption}`
      : `${item.id} | ${item.type}`);
  }

  if (newLines.length > 0) {
    await fs.mkdir(path.join(profileDir(cfg.slug), "photos"), { recursive: true });
    await fs.appendFile(indexPath, "\n" + newLines.join("\n") + "\n", "utf8");
  }

  return { added: newLines.length, skipped };
}
