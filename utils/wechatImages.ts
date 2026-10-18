import { App, requestUrl } from "obsidian";
import { WechatImage } from "../types";
import { withTimeout } from "./async";
import { resolveVaultImage } from "./wechatMarkdown";
import { wechatHash } from "./wechatState";

// Keep the stricter body-image limit for reliable uploads. Cover uses permanent
// image material (not the 64 KB temporary thumbnail endpoint).
export const WECHAT_BODY_IMAGE_LIMIT = 1024 * 1024;
export const WECHAT_COVER_IMAGE_LIMIT = 10 * 1024 * 1024;
export async function readWechatImage(app: App, source: string, filePath: string): Promise<{ bytes: Uint8Array; localPath?: string }> {
  if (/^https?:\/\//i.test(source)) {
    const response = await withTimeout(requestUrl({ url: source, method: "GET", throw: false }), 15000, "下载图片超时");
    if (response.status !== 200) throw new Error(`下载失败 HTTP ${response.status}`);
    const bytes = new Uint8Array(response.arrayBuffer);
    if (bytes.length > 20 * 1024 * 1024) throw new Error("原图超过 20 MB，请先缩小或替换");
    return { bytes };
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(source)) throw new Error("仅支持 Vault 附件和 HTTP(S) 图片");
  const file = resolveVaultImage(app, source, filePath);
  const bytes = new Uint8Array(await app.vault.readBinary(file));
  if (bytes.length > 20 * 1024 * 1024) throw new Error("原图超过 20 MB，请先缩小或替换");
  return { bytes, localPath: file.path };
}

export function imageMime(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return "image/png";
  if (String.fromCharCode(...bytes.slice(0, 6)).startsWith("GIF8")) return "image/gif";
  if (String.fromCharCode(...bytes.slice(0, 12)).includes("WEBP")) return "image/webp";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
  const header = new TextDecoder().decode(bytes.slice(0, 512));
  if (header.includes("<svg")) return "image/svg+xml";
  if (header.includes("ftypavif") || header.includes("ftypavis")) return "image/avif";
  throw new Error("文件不是支持的图片格式");
}

export function isAnimatedWechatImage(bytes: Uint8Array, mime: string): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  if (mime === "image/gif") return true;
  if (mime === "image/png") {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = view.getUint32(offset);
      if (size > bytes.length - offset - 12) break;
      if (tag(offset + 4) === "acTL") return true;
      offset += size + 12;
    }
  }
  if (mime === "image/webp") {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset + 4, true);
      if (size > bytes.length - offset - 8) break;
      const type = tag(offset);
      if (type === "ANIM" || type === "ANMF" || type === "VP8X" && size > 0 && (bytes[offset + 8] & 2) !== 0) return true;
      offset += 8 + size + (size % 2);
    }
  }
  if (mime === "image/avif") {
    // AVIF image sequences carry the avis brand in ftyp (major or compatible).
    const size = bytes.length >= 16 ? view.getUint32(0) : 0;
    if (tag(4) === "ftyp") for (let offset = 8; offset + 4 <= Math.min(size, bytes.length); offset += 4) {
      if (offset !== 12 && tag(offset) === "avis") return true;
    }
  }
  return false;
}

async function decodeImage(bytes: Uint8Array, mime: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime }));
  const image = new Image();
  try {
    await withTimeout(new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error("图片无法解码，请转换格式或替换")); image.src = url;
    }), 15000, "图片解码超时");
    return image;
  } finally { URL.revokeObjectURL(url); }
}

async function encodeCanvas(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    value => value ? resolve(value) : reject(new Error("图片转换失败")), mime, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function processWechatImage(source: string, input: Uint8Array, purpose: "body" | "cover", localPath?: string): Promise<WechatImage> {
  const originalHash = wechatHash(input);
  const originalMime = imageMime(input);
  if (originalMime === "image/gif" && purpose === "body") throw new Error("微信正文图片接口仅支持 JPG/PNG，请将 GIF 替换为静态图片；原动画不会被修改或自动取首帧");
  if (isAnimatedWechatImage(input, originalMime)) throw new Error("检测到动画图片，请明确导出静态图片后使用；不会自动截取动画首帧");
  // SVG may reference remote resources or scripts. Never execute it in the Vault
  // renderer; require an explicit raster export instead.
  if (originalMime === "image/svg+xml") throw new Error("SVG 请先导出为 PNG 后使用");
  const image = await decodeImage(input, originalMime);
  let width = image.naturalWidth, height = image.naturalHeight;
  if (!width || !height || width * height > 80000000) throw new Error("图片尺寸异常或超过 8000 万像素，请缩小后重试");
  const limit = (purpose === "body" ? WECHAT_BODY_IMAGE_LIMIT : WECHAT_COVER_IMAGE_LIMIT) - 1;
  let bytes = input, mime = originalMime;
  if (mime === "image/gif") {
    if (bytes.length > limit) throw new Error("GIF 超过上传限制，请压缩动画或替换，不会自动转为首帧");
    if (purpose === "cover") throw new Error("封面请使用静态图片，不会将 GIF 静默转为首帧");
  } else {
    const scale = Math.min(1, (purpose === "body" ? 1280 : 2560) / width, 8192 / height);
    width = Math.max(1, Math.round(width * scale)); height = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法创建图片处理画布");
    // Chromium decodes EXIF orientation before drawImage.
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    let transparent = false;
    for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] < 255) { transparent = true; break; } }
    mime = transparent ? "image/png" : "image/jpeg";
    for (let attempt = 0; attempt < 7; attempt++) {
      bytes = await encodeCanvas(canvas, mime, Math.max(0.55, 0.9 - attempt * 0.08));
      if (bytes.length <= limit) break;
      const previous = document.createElement("canvas"); previous.width = canvas.width; previous.height = canvas.height;
      previous.getContext("2d")!.drawImage(canvas, 0, 0);
      canvas.width = Math.max(1, Math.floor(canvas.width * 0.8)); canvas.height = Math.max(1, Math.floor(canvas.height * 0.8));
      context.drawImage(previous, 0, 0, canvas.width, canvas.height);
    }
    width = canvas.width; height = canvas.height;
    if (bytes.length > limit) throw new Error("图片压缩后仍超过上传限制，请替换");
  }
  return { source, bytes, mime, width, height, originalHash, hash: wechatHash(bytes), originalSize: input.length, localPath,
    previewUrl: URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime })) };
}

export async function loadWechatImage(app: App, source: string, filePath: string, purpose: "body" | "cover"): Promise<WechatImage> {
  const raw = await readWechatImage(app, source, filePath);
  return processWechatImage(source, raw.bytes, purpose, raw.localPath);
}
export function releaseWechatImages(images: WechatImage[]): void {
  images.forEach(image => URL.revokeObjectURL(image.previewUrl));
}
