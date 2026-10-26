import { wechatHash } from "./wechatHash";
export { wechatHash } from "./wechatHash";
import { readWechatLayoutPlan } from "./wechatLayoutEngine";
import { FrontMatterData, WechatArticleSettings, WechatCrop, WechatSettings } from "../types";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";
export const wechatStateKey = (appId: string, pubId: string): string => `${appId}:${pubId}`;
export const wechatAssetKey = (appId: string, purpose: "body" | "cover", hash: string): string => `${appId}:${purpose}:${hash}`;

export function normalizeWechatSettings(input: unknown): WechatSettings {
  const value = object(input);
  const result: WechatSettings = {
    appId: text(value.appId).trim(), encryptedSecret: text(value.encryptedSecret),
    defaultAuthor: text(value.defaultAuthor), allowRemoteImages: value.allowRemoteImages !== false, assets: {}, drafts: {},
  };
  for (const [key, item] of Object.entries(object(value.assets))) {
    const entry = object(item);
    if (/^https?:\/\//.test(text(entry.url))) result.assets[key] = {
      url: text(entry.url), ...(text(entry.mediaId) ? { mediaId: text(entry.mediaId) } : {}),
    };
  }
  for (const [key, item] of Object.entries(object(value.drafts))) {
    const entry = object(item);
    result.drafts[key] = {
      ...(text(entry.mediaId) ? { mediaId: text(entry.mediaId) } : {}),
      ...(text(entry.fingerprint) ? { fingerprint: text(entry.fingerprint) } : {}),
      ...(text(entry.syncedAt) ? { syncedAt: text(entry.syncedAt) } : {}),
      ...(entry.uncertain === true ? { uncertain: true } : {}),
    };
  }
  return result;
}

export function readWechatArticleSettings(value: unknown): WechatArticleSettings {
  const data = object(value);
  const result: WechatArticleSettings = {};
  for (const key of ["title", "author", "digest", "sourceUrl", "cover"] as const) {
    if (typeof data[key] === "string") result[key] = data[key] as string;
  }
  for (const key of ["cropWide", "cropSquare"] as const) {
    const crop = object(data[key]);
    if ([crop.x, crop.y, crop.width, crop.height].every(n => typeof n === "number" && Number.isFinite(n))
      && Number(crop.x) >= 0 && Number(crop.y) >= 0 && Number(crop.width) > 0 && Number(crop.height) > 0
      && Number(crop.x) + Number(crop.width) <= 1.000001 && Number(crop.y) + Number(crop.height) <= 1.000001) {
      result[key] = crop as unknown as WechatCrop;
    }
  }
  // Invalid plans remain visible so rendering can explain safe fallback.
  if (data.layout !== undefined) result.layout = data.layout as WechatArticleSettings["layout"];
  if (Array.isArray(data.layoutHistory)) result.layoutHistory = data.layoutHistory.slice(-5).flatMap(plan => {
    try { return [readWechatLayoutPlan(plan)]; } catch { return []; }
  });
  return result;
}

export function wechatArticleNeedsSave(data: FrontMatterData, article: WechatArticleSettings): boolean {
  const saved = readWechatArticleSettings(data.wechat);
  const { title, ...settings } = article;
  return data.title !== title || saved.title !== undefined
    || (Object.keys({ ...saved, ...settings }) as Array<Exclude<keyof WechatArticleSettings, "title">>)
      .some(key => JSON.stringify(saved[key]) !== JSON.stringify(settings[key]));
}

export function centeredCrop(width: number, height: number, ratio: number, zoom = 1, x = 0.5, y = 0.5): WechatCrop {
  const w = Math.min(1, height * ratio / width) / Math.max(1, zoom);
  const h = w * width / ratio / height;
  return { x: Math.max(0, Math.min(1 - w, x - w / 2)), y: Math.max(0, Math.min(1 - h, y - h / 2)), width: w, height: h };
}

export function cropCoordinates(crop: WechatCrop, width: number, height: number, ratio: number): string {
  const valid = readWechatArticleSettings({ cropWide: crop }).cropWide;
  if (!valid || Math.abs(crop.width * width / (crop.height * height) / ratio - 1) > 0.005) {
    throw new Error("封面裁剪比例无效，请重新调整");
  }
  return [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height].map(n => n.toFixed(6)).join("_");
}

// Compare only fields owned by this plugin; WeChat adds URLs and other metadata.
export function remoteFingerprint(articles: unknown[]): string {
  const keys = ["title", "author", "digest", "content", "content_source_url", "thumb_media_id"];
  return wechatHash(JSON.stringify(articles.map(article => {
    const value = object(article);
    return [...keys.map(key => text(value[key])), JSON.stringify(value.cover_info ?? {}),
      text(value.pic_crop_235_1), text(value.pic_crop_1_1)];
  })));
}

export function defaultDigest(body: string): string {
  return Array.from(body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "")
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#>*_`~\[\]]/g, "").replace(/\s+/g, " ").trim()).slice(0, 100).join("");
}
