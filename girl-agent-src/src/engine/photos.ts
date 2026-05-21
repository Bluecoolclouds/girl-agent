import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProfileConfig } from "../types.js";
import { profileDir } from "../storage/md.js";

export interface PhotoEntry {
  filePath: string;
  tags: string[];
  caption?: string;
}

const PHOTOS_DIR = "photos";
const INDEX_FILE = "photos/index.md";

const DEFAULT_INDEX = `# photo library
# Формат: filename.jpg | tag1,tag2,tag3 | необязательная подпись
# Примеры тегов: selfie, face, gym, home, outfit, casual, cute, flirt
# Пример:
# selfie1.jpg | selfie,face,cute | привет)
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
    const [filename = "", tagsRaw = "", caption] = trimmed.split("|").map(x => x.trim());
    if (!filename) continue;
    const filePath = path.join(dir, filename);
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

export async function pickPhoto(cfg: ProfileConfig, mood = ""): Promise<PhotoEntry | undefined> {
  const photos = await listPhotos(cfg);
  if (!photos.length) return undefined;
  const q = mood.toLowerCase();
  const tagged = photos.filter(p => p.tags.some(t => q.includes(t.toLowerCase())));
  const pool = tagged.length ? tagged : photos;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Выбирает фото по явному тегу. Если тег не совпал — берём любое из библиотеки. */
export async function pickPhotoByTag(cfg: ProfileConfig, tag: string): Promise<PhotoEntry | undefined> {
  const photos = await listPhotos(cfg);
  if (!photos.length) return undefined;
  const t = tag.trim().toLowerCase();
  const matched = t ? photos.filter(p => p.tags.some(pt => pt.toLowerCase() === t)) : [];
  const pool = matched.length ? matched : photos;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Возвращает уникальные теги из всей библиотеки. */
export async function listPhotoTags(cfg: ProfileConfig): Promise<string[]> {
  const photos = await listPhotos(cfg);
  const tags = new Set<string>();
  for (const p of photos) for (const t of p.tags) tags.add(t);
  return [...tags].sort();
}
