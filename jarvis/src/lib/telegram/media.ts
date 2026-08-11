// Telegram media download — Telegram hands us `file_id`s whose
// `file_path` URLs (https://api.telegram.org/file/bot<TOKEN>/<path>)
// expire about an hour after the getFile call. So we download eagerly
// on inbound dispatch and cache the result on disk under
// `JARVIS_TMP_DIR/jarvis-tg/<chatId>/<cuid>.<ext>`.

import fs from "fs/promises";
import path from "path";
import os from "os";

const TELEGRAM_API = "https://api.telegram.org/bot";
const MEDIA_DIR =
  process.env.JARVIS_TMP_DIR?.trim() ||
  path.join(os.tmpdir(), "jarvis-tg");

export interface TelegramFileMeta {
  file_id: string;
  file_path?: string;
  file_size?: number;
}

async function ensureChatDir(chatId: number): Promise<string> {
  const dir = path.join(MEDIA_DIR, String(chatId));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Call `getFile` to translate `file_id` → `file_path`. Throws if the
 * bot doesn't have access to the file (common if a message arrives
 * during a bot restart and the file is already gone).
 */
export async function getFileMeta(
  token: string,
  fileId: string
): Promise<TelegramFileMeta> {
  const res = await fetch(`${TELEGRAM_API}${token}/getFile?file_id=${fileId}`);
  const data = await res.json().catch(() => ({} as any));
  if (!data.ok) {
    throw new Error(data.description ?? `getFile failed for ${fileId}`);
  }
  return {
    file_id: fileId,
    file_path: data.result?.file_path,
    file_size: data.result?.file_size,
  };
}

/**
 * Download a Telegram file's bytes by file_id. Throws if getFile fails
 * or the download is non-2xx.
 *
 * The download is mandatory-on-arrival because the file_path URL is
 * short-lived; we don't trust ourselves to use it later.
 */
export async function downloadTelegramFile(
  token: string,
  fileId: string
): Promise<Buffer> {
  const meta = await getFileMeta(token, fileId);
  if (!meta.file_path) {
    throw new Error(`Telegram returned no file_path for ${fileId}`);
  }
  const url = `${TELEGRAM_API}${token}/${meta.file_path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Telegram file download failed: ${res.status}`);
  }
  const arr = new Uint8Array(await res.arrayBuffer());
  return Buffer.from(arr);
}

/**
 * Save a downloaded buffer under the chat's tmp dir and return its
 * absolute path. Caller is responsible for cleanup if/when no longer
 * needed; we keep these around for the duration of the dispatch plus
 * an hour to support redelivery.
 */
export async function saveToTmp(
  chatId: number,
  ext: string,
  buf: Buffer
): Promise<string> {
  const dir = await ensureChatDir(chatId);
  const cuid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  const filePath = path.join(dir, `${cuid}.${safeExt}`);
  await fs.writeFile(filePath, buf);
  return filePath;
}

export function tmpPathFor(chatId: number, ext: string, name?: string): string {
  const dir = path.join(MEDIA_DIR, String(chatId));
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return path.join(dir, `${name ?? Date.now()}.${safeExt}`);
}
