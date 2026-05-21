/**
 * scan-channel.ts — сканирует photoChannelId из config.json,
 * находит все сообщения с фото/видео и дописывает их в photos/index.md.
 *
 * Запуск:
 *   node --import ./node_modules/tsx/dist/esm/index.cjs src/scan-channel.ts кристина
 *   node --import ./node_modules/tsx/dist/esm/index.cjs src/scan-channel.ts кристина --limit=200
 *   node --import ./node_modules/tsx/dist/esm/index.cjs src/scan-channel.ts кристина --dry-run
 */

import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const slug = process.argv[2];
if (!slug) {
  console.error("Использование: node ... src/scan-channel.ts <slug> [--limit=N] [--dry-run]");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find(a => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1]!) : 100;

const configPath = path.join(DATA_DIR, slug, "config.json");
const indexPath  = path.join(DATA_DIR, slug, "photos", "index.md");

async function main() {
  const cfg = JSON.parse(await fs.readFile(configPath, "utf8"));

  const channelId: string | undefined = cfg.photoChannelId;
  if (!channelId) {
    console.error("photoChannelId не задан в config.json");
    process.exit(1);
  }

  const { apiId, apiHash, sessionString } = cfg.telegram;
  if (!apiId || !apiHash || !sessionString) {
    console.error("Нет apiId/apiHash/sessionString в config.json");
    process.exit(1);
  }

  console.log(`Подключаюсь как userbot для профиля «${slug}»…`);
  const client = new TelegramClient(
    new StringSession(sessionString),
    Number(apiId),
    apiHash,
    { connectionRetries: 3, useWSS: cfg.telegram.useWSS !== false }
  );
  await client.connect();
  console.log("Подключено. Сканирую канал", channelId, `(limit=${limit})…`);

  // Читаем уже существующие записи в index.md чтобы не дублировать
  let existing = "";
  try { existing = await fs.readFile(indexPath, "utf8"); } catch { /* нет файла */ }
  const existingIds = new Set<number>();
  for (const line of existing.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const first = trimmed.split("|")[0]?.trim() ?? "";
    const id = parseInt(first);
    if (!isNaN(id)) existingIds.add(id);
  }
  console.log(`Уже в index.md: ${existingIds.size} записей`);

  const newLines: string[] = [];
  let scanned = 0;
  let found = 0;

  // iterMessages работает от новых к старым
  for await (const msg of client.iterMessages(channelId, { limit })) {
    scanned++;
    const m = msg as Api.Message;
    if (!m.media) continue;

    const hasPhoto = m.media instanceof Api.MessageMediaPhoto;
    const hasVideo = m.media instanceof Api.MessageMediaDocument &&
      (m.media.document instanceof Api.Document) &&
      m.media.document.mimeType?.startsWith("video/");

    if (!hasPhoto && !hasVideo) continue;

    const msgId = m.id;
    if (existingIds.has(msgId)) continue;

    const caption = (m.message ?? "").replace(/\|/g, "—").replace(/\r?\n/g, " ").trim();
    const tag = hasVideo ? "video" : "photo";
    const line = caption
      ? `${msgId} | ${tag} | ${caption}`
      : `${msgId} | ${tag}`;

    newLines.push(line);
    found++;
    console.log(`  [${msgId}] ${tag}${caption ? " — " + caption.slice(0, 60) : ""}`);
  }

  console.log(`\nПросканировано: ${scanned} сообщений. Найдено новых: ${found}`);

  if (found === 0) {
    console.log("Нечего добавлять.");
    await client.disconnect();
    return;
  }

  if (dryRun) {
    console.log("\n--dry-run: файл не изменён.");
  } else {
    // Убеждаемся что папка photos/ существует
    await fs.mkdir(path.join(DATA_DIR, slug, "photos"), { recursive: true });

    // Дописываем новые строки в конец index.md
    const toAppend = "\n" + newLines.join("\n") + "\n";
    await fs.appendFile(indexPath, toAppend, "utf8");
    console.log(`Записано ${found} строк в ${indexPath}`);
  }

  await client.disconnect();
  console.log("Готово.");
}

main().catch(e => { console.error(e); process.exit(1); });
