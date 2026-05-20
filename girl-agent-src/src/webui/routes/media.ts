import { Router, HttpError } from "../http.js";
import { profileDir, readConfig } from "../../storage/md.js";
import { listPhotos } from "../../engine/photos.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import type http from "node:http";

const PHOTOS_DIR = "photos";
const INDEX_FILE = "photos/index.md";

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function extFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
    "image/webp": ".webp", "video/mp4": ".mp4", "video/quicktime": ".mov",
    "video/webm": ".webm",
  };
  return map[mimeType] ?? "";
}

function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4",
    ".mov": "video/quicktime", ".webm": "video/webm",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

async function readIndex(slug: string): Promise<string> {
  try { return await fs.readFile(path.join(profileDir(slug), INDEX_FILE), "utf8"); }
  catch { return ""; }
}

async function writeIndex(slug: string, content: string): Promise<void> {
  const p = path.join(profileDir(slug), INDEX_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, "utf8");
}

async function appendToIndex(slug: string, filename: string, tags: string[], caption: string): Promise<void> {
  let raw = await readIndex(slug);
  if (!raw) raw = "# photo library\n# Формат: filename | tag1,tag2 | подпись\n";
  const lines = raw.split(/\r?\n/).filter(l => l.split("|")[0]?.trim() !== filename);
  lines.push(`${filename} | ${tags.join(",")} | ${caption}`);
  await writeIndex(slug, lines.join("\n") + "\n");
}

async function updateIndexEntry(slug: string, filename: string, tags?: string[], caption?: string): Promise<void> {
  const raw = await readIndex(slug);
  const lines = raw.split(/\r?\n/).map(l => {
    const parts = l.split("|").map(x => x.trim());
    if (parts[0] !== filename) return l;
    return `${filename} | ${tags !== undefined ? tags.join(",") : (parts[1] ?? "")} | ${caption !== undefined ? caption : (parts[2] ?? "")}`;
  });
  await writeIndex(slug, lines.join("\n"));
}

async function removeFromIndex(slug: string, filename: string): Promise<void> {
  const raw = await readIndex(slug);
  const lines = raw.split(/\r?\n/).filter(l => l.split("|")[0]?.trim() !== filename);
  await writeIndex(slug, lines.join("\n") + "\n");
}

export function registerMediaRoutes(r: Router): void {
  r.get("/api/profiles/:slug/photos", async ({ params }) => {
    const cfg = await readConfig(params.slug);
    if (!cfg) throw new HttpError(404, "profile not found");
    const photos = await listPhotos(cfg);
    return {
      photos: photos.map(p => ({
        filename: path.basename(p.filePath),
        tags: p.tags,
        caption: p.caption ?? "",
        url: `/api/profiles/${encodeURIComponent(params.slug)}/photos/file/${encodeURIComponent(path.basename(p.filePath))}`,
        isVideo: /\.(mp4|mov|webm)$/i.test(p.filePath),
      }))
    };
  });

  r.get("/api/profiles/:slug/photos/file/:filename", async ({ params, res }) => {
    const safe = sanitizeFilename(params.filename);
    if (!safe) throw new HttpError(400, "invalid filename");
    const filePath = path.join(profileDir(params.slug), PHOTOS_DIR, safe);
    let data: Buffer;
    try { data = await fs.readFile(filePath); }
    catch { throw new HttpError(404, "file not found"); }
    const mime = mimeFromExt(path.extname(safe));
    (res as http.ServerResponse).writeHead(200, {
      "Content-Type": mime,
      "Content-Length": data.length,
      "Cache-Control": "private, max-age=3600",
    });
    (res as http.ServerResponse).end(data);
  });

  r.post("/api/profiles/:slug/photos", async ({ params, body }) => {
    const cfg = await readConfig(params.slug);
    if (!cfg) throw new HttpError(404, "profile not found");
    const { filename, data: base64, mimeType, tags = [], caption = "" } = body as {
      filename?: string; data: string; mimeType: string;
      tags?: string[]; caption?: string;
    };
    if (!base64 || !mimeType) throw new HttpError(400, "data and mimeType required");
    const ext = extFromMime(mimeType);
    const rawName = filename ? sanitizeFilename(filename) : `upload_${Date.now()}${ext}`;
    const dir = path.join(profileDir(params.slug), PHOTOS_DIR);
    await fs.mkdir(dir, { recursive: true });
    const buf = Buffer.from(base64, "base64");
    await fs.writeFile(path.join(dir, rawName), buf);
    await appendToIndex(params.slug, rawName, tags as string[], String(caption));
    return { ok: true, filename: rawName };
  });

  r.put("/api/profiles/:slug/photos/:filename", async ({ params, body }) => {
    const safe = sanitizeFilename(params.filename);
    if (!safe) throw new HttpError(400, "invalid filename");
    const { tags, caption } = body as { tags?: string[]; caption?: string };
    await updateIndexEntry(params.slug, safe, tags, caption);
    return { ok: true };
  });

  r.delete("/api/profiles/:slug/photos/:filename", async ({ params }) => {
    const safe = sanitizeFilename(params.filename);
    if (!safe) throw new HttpError(400, "invalid filename");
    await fs.unlink(path.join(profileDir(params.slug), PHOTOS_DIR, safe)).catch(() => {});
    await removeFromIndex(params.slug, safe);
    return { ok: true };
  });
}
