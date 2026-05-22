import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProfileConfig } from "../types.js";
import { profileDir } from "../storage/md.js";

// ─── Per-contact sent-photo tracking ────────────────────────────────────────

function sentPhotosPath(cfg: ProfileConfig, fromId: number | string): string {
  return path.join(profileDir(cfg.slug), "contacts", String(fromId), "sent_photos.txt");
}

export async function getSentPhotoFilenames(cfg: ProfileConfig, fromId: number | string): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(sentPhotosPath(cfg, fromId), "utf8");
    const names = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    return new Set(names);
  } catch {
    return new Set();
  }
}

/** Стабильный ключ для дедупликации: имя файла или ch:MSGID для канальных записей. */
export function photoEntryKey(photo: PhotoEntry): string {
  if (photo.channelMsgId !== undefined) return `ch:${photo.channelMsgId}`;
  return path.basename(photo.filePath);
}

export async function markPhotoSent(cfg: ProfileConfig, fromId: number | string, photo: PhotoEntry): Promise<void> {
  const p = sentPhotosPath(cfg, fromId);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(p, photoEntryKey(photo) + "\n", "utf8");
}

export async function resetSentPhotos(cfg: ProfileConfig, fromId: number | string): Promise<void> {
  try { await fs.writeFile(sentPhotosPath(cfg, fromId), "", "utf8"); } catch { /* ignore */ }
}

export interface PhotoEntry {
  /** Путь к локальному файлу. Пустая строка если запись канальная (channelMsgId). */
  filePath: string;
  /** ID сообщения в канале cfg.photoChannelId (если запись канальная). */
  channelMsgId?: number;
  tags: string[];
  caption?: string;
}

const PHOTOS_DIR = "photos";
const INDEX_FILE = "photos/index.md";

const DEFAULT_INDEX = `# photo library
# Формат 1 — локальный файл:
#   filename.jpg | tag1,tag2,tag3 | необязательная подпись
#
# Формат 2 — пересылка из канала (нужен photoChannelId в конфиге):
#   123 | tag1,tag2,tag3 | текст под фото в канале
#   (число = ID сообщения в канале-источнике)
#
# Примеры тегов: selfie, face, gym, home, outfit, casual, cute, flirt
# Примеры:
# selfie1.jpg | selfie,face,cute | привет)
# 42 | lingerie,hot | новое фото 🔥
`;

async function photosDir(cfg: ProfileConfig): Promise<string> {
  const dir = path.join(profileDir(cfg.slug), PHOTOS_DIR);
  await fs.mkdir(dir, { recursive: true });
  const indexPath = path.join(profileDir(cfg.slug), INDEX_FILE);
  try {
    await fs.access(indexPath);
  } catch {
    await fs.writeFile(indexPath, DEFAULT_INDEX, "utf8");
  }
  return dir;
}

export async function listPhotos(cfg: ProfileConfig): Promise<PhotoEntry[]> {
  await photosDir(cfg);
  const indexPath = path.join(profileDir(cfg.slug), INDEX_FILE);
  let raw = "";
  try { raw = await fs.readFile(indexPath, "utf8"); } catch { return []; }

  const dir = path.join(profileDir(cfg.slug), PHOTOS_DIR);
  const entries: PhotoEntry[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [source = "", tagsRaw = "", caption] = trimmed.split("|").map(x => x.trim());
    if (!source) continue;

    // Канальная запись: чистое целое число = ID сообщения
    const msgId = /^\d+$/.test(source) ? parseInt(source, 10) : NaN;
    if (!isNaN(msgId)) {
      entries.push({
        filePath: "",
        channelMsgId: msgId,
        tags: tagsRaw ? tagsRaw.split(",").map(x => x.trim()).filter(Boolean) : [],
        caption: caption || undefined,
      });
      continue;
    }

    // Локальный файл
    const filePath = path.join(dir, source);
    try {
      await fs.access(filePath);
    } catch {
      continue;
    }
    entries.push({
      filePath,
      tags: tagsRaw ? tagsRaw.split(",").map(x => x.trim()).filter(Boolean) : [],
      caption: caption || undefined,
    });
  }
  return entries;
}

/**
 * Выбирает фото по настроению/ключевым словам.
 * Если передан `fromId` — исключает уже отправленные этому контакту файлы.
 * Если все подходящие фото уже отправлены — сбрасывает историю и начинает заново.
 */
export async function pickPhoto(cfg: ProfileConfig, mood = "", fromId?: number | string): Promise<PhotoEntry | undefined> {
  const photos = await listPhotos(cfg);
  if (!photos.length) return undefined;
  const q = mood.toLowerCase();
  const tagged = photos.filter(p => p.tags.some(t => q.includes(t.toLowerCase())));
  const pool = tagged.length ? tagged : photos;
  return pickWithDedup(cfg, pool, fromId);
}

/**
 * Выбирает фото по явному тегу.
 * Если передан `fromId` — исключает уже отправленные этому контакту файлы.
 * Если все фото с тегом уже отправлены — сбрасывает историю для этого тега и начинает заново.
 */
export async function pickPhotoByTag(cfg: ProfileConfig, tag: string, fromId?: number | string): Promise<PhotoEntry | undefined> {
  const photos = await listPhotos(cfg);
  if (!photos.length) return undefined;
  const t = tag.trim().toLowerCase();
  const matched = t ? photos.filter(p => p.tags.some(pt => pt.toLowerCase() === t)) : [];
  const pool = matched.length ? matched : photos;
  return pickWithDedup(cfg, pool, fromId);
}

/**
 * Выбирает случайное фото из пула, исключая уже отправленные контакту.
 * Если все отправлены — сбрасывает историю и берёт из полного пула.
 */
async function pickWithDedup(cfg: ProfileConfig, pool: PhotoEntry[], fromId?: number | string): Promise<PhotoEntry | undefined> {
  if (!pool.length) return undefined;
  if (!fromId) return pool[Math.floor(Math.random() * pool.length)];

  const sent = await getSentPhotoFilenames(cfg, fromId);
  const unsent = pool.filter(p => !sent.has(photoEntryKey(p)));

  if (unsent.length > 0) {
    return unsent[Math.floor(Math.random() * unsent.length)];
  }
  // Все фото в пуле уже отправлены этому контакту — возвращаем undefined.
  // Вызывающий код запустит generateOutgoingMediaRefusal.
  return undefined;
}

/** Возвращает уникальные теги из всей библиотеки. */
export async function listPhotoTags(cfg: ProfileConfig): Promise<string[]> {
  const photos = await listPhotos(cfg);
  const tags = new Set<string>();
  for (const p of photos) for (const t of p.tags) tags.add(t);
  return [...tags].sort();
}

const CHANNEL_INDEX_FILE = "photos/channel.md";

export interface ChannelPhotoEntry {
  id: number;
  type: string;
  caption?: string;
}

/**
 * Читает платный контент из photos/channel.md (результат сканирования канала).
 * Используется только для контекста в промпте — NOT для SEND_PHOTO.
 * Формат строки: msgId | type | caption
 */
export async function listChannelPhotos(cfg: ProfileConfig): Promise<ChannelPhotoEntry[]> {
  const filePath = path.join(profileDir(cfg.slug), CHANNEL_INDEX_FILE);
  let raw = "";
  try { raw = await fs.readFile(filePath, "utf8"); } catch { return []; }

  const entries: ChannelPhotoEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("|").map(x => x.trim());
    const id = parseInt(parts[0] ?? "", 10);
    if (isNaN(id)) continue;
    entries.push({
      id,
      type: parts[1] ?? "photo",
      caption: parts[2] || undefined
    });
  }
  return entries;
}
