import { App, TFile } from "obsidian";
import { sanitizeFileName } from "./platforms";

export const IMPORT_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg"]);
export const IMPORT_IMAGE_ACCEPT = [...IMPORT_IMAGE_EXTENSIONS].map(extension => `.${extension}`).join(",");
export interface ImageUpload { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }

/** Respect the host's attachment location and collision handling; never replace an existing attachment. */
export async function importImageAttachment(app: App, sourcePath: string, upload: ImageUpload,
  assertActive: () => void = () => {}): Promise<TFile> {
  const extension = upload.name.split(".").pop()?.toLowerCase();
  if (!extension || !IMPORT_IMAGE_EXTENSIONS.has(extension)) throw new Error("请选择 JPG、PNG、GIF、WebP、AVIF、BMP 或 SVG 图片");
  if (upload.size > 50 * 1024 * 1024) throw new Error("单张图片不能超过 50 MB");
  const name = sanitizeFileName(upload.name.replace(/[\[\]#]/g, "-"));
  if (!name || !name.toLowerCase().endsWith(`.${extension}`)) throw new Error("图片文件名无效");
  assertActive();
  const bytes = await upload.arrayBuffer();
  assertActive();
  if (!bytes.byteLength) throw new Error("图片文件为空");
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("单张图片不能超过 50 MB");
  const target = await app.fileManager.getAvailablePathForAttachment(name, sourcePath);
  assertActive();
  if (app.vault.getAbstractFileByPath(target)) throw new Error("同名附件刚刚被创建，请重新上传以使用新文件名");
  return app.vault.createBinary(target, bytes);
}
