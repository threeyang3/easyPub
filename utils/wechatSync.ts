import { WechatArticle, WechatArticleSettings, WechatAssetCache, WechatImage, WechatSettings } from "../types";
import { isMissingWechatMedia, WechatApi, WechatUncertainError } from "./wechatApi";
import { centeredCrop, cropCoordinates, remoteFingerprint, wechatAssetKey, wechatStateKey } from "./wechatState";
import { escapeHtml } from "./wechatMarkdown";

export type WechatConflictAction = "cancel" | "overwrite" | "new";
export interface WechatSyncInput {
  pubId: string; html: string; images: WechatImage[]; cover: WechatImage; article: WechatArticleSettings;
  assertFresh: () => Promise<void>;
  conflict: (kind: "modified" | "missing" | "multiple", remote: unknown[]) => Promise<WechatConflictAction>;
  progress: (message: string) => void;
}

export function validateWechatArticle(article: WechatArticleSettings): void {
  if (!article.title?.trim()) throw new Error("请填写文章标题");
  for (const [label, value, limit] of [["标题", article.title, 32], ["作者", article.author, 16], ["摘要", article.digest, 120]] as const) {
    if (Array.from(value ?? "").length > limit) throw new Error(`${label}超过微信文档规定的 ${limit} 字，请缩短`);
  }
  if (article.sourceUrl && (!/^https?:\/\//i.test(article.sourceUrl) || Buffer.byteLength(article.sourceUrl) > 1024)) throw new Error("阅读原文链接需为不超过 1 KB 的 HTTP(S) 地址");
}

export class WechatSync {
  constructor(private api: Pick<WechatApi, "getDraft" | "addDraft" | "updateDraft" | "upload" | "materialExists">,
    private settings: WechatSettings, private save: () => Promise<void>) {}

  async sync(input: WechatSyncInput): Promise<string | null> {
    validateWechatArticle(input.article);
    const crop = (ratio: number, name: "cropWide" | "cropSquare", label: string) => {
      const [x1, y1, x2, y2] = cropCoordinates(input.article[name] ?? centeredCrop(input.cover.width, input.cover.height, ratio), input.cover.width, input.cover.height, ratio).split("_");
      return { ratio: label, x1, y1, x2, y2 };
    };
    const coverInfo = { crop_percent_list: [crop(2.35, "cropWide", "2.35_1"), crop(1, "cropSquare", "1_1")] };
    const appId = this.settings.appId;
    const key = wechatStateKey(appId, input.pubId);
    const previous = this.settings.drafts[key];
    if (previous?.uncertain) throw new WechatUncertainError();
    let mediaId = previous?.mediaId;
    let baseline: string | undefined;
    const fresh = async () => {
      if (this.settings.appId !== appId) throw new Error("公众号账号已变化，请重新预览");
      await input.assertFresh();
    };
    await fresh();
    if (mediaId) {
      let remote: unknown[];
      try { remote = await this.api.getDraft(mediaId); }
      catch (error) {
        if (!isMissingWechatMedia(error)) throw error;
        if (await input.conflict("missing", []) !== "new") return null;
        mediaId = undefined; remote = [];
      }
      if (mediaId) {
        baseline = remoteFingerprint(remote);
        if (remote.length !== 1 || baseline !== previous?.fingerprint) {
          const choice = await input.conflict(remote.length === 1 ? "modified" : "multiple", remote);
          if (choice === "cancel" || choice === "overwrite" && remote.length !== 1) return null;
          if (choice === "new") mediaId = undefined;
        }
      }
    }
    const cachedUpload = async (image: WechatImage, cover: boolean) => {
      await fresh();
      const cacheKey = wechatAssetKey(appId, cover ? "cover" : "body", image.hash);
      let cached: WechatAssetCache | undefined = this.settings.assets[cacheKey];
      if (cover && cached?.mediaId) {
        try { await this.api.materialExists(cached.mediaId); }
        catch (error) {
          if (!isMissingWechatMedia(error)) throw error;
          delete this.settings.assets[cacheKey]; cached = undefined;
        }
      }
      if (cached && (!cover || cached.mediaId)) return cached;
      input.progress(cover ? "正在上传封面…" : `正在上传正文图片：${image.source}`);
      const result = await this.api.upload(image, cover);
      this.settings.assets[cacheKey] = result;
      await this.save(); // Persist successful materials even when a later step fails.
      await fresh();
      return result;
    };
    let content = input.html;
    for (const image of input.images) {
      const material = await cachedUpload(image, false);
      content = content.split(`easy-pub-image://${image.hash}`).join(escapeHtml(material.url));
    }
    if (content.includes("easy-pub-image://")) throw new Error("正文仍有未处理图片，请重新预览");
    const cover = await cachedUpload(input.cover, true);
    const article: WechatArticle = {
      title: input.article.title!, author: input.article.author ?? "", digest: input.article.digest ?? "",
      content, content_source_url: input.article.sourceUrl ?? "", thumb_media_id: cover.mediaId!,
      cover_info: coverInfo,
    };
    if (Array.from(content).length >= 20000 || Buffer.byteLength(content) >= 1024 * 1024) throw new Error("排版后的正文超过微信限制（2 万字符或 1 MB），请精简后重试");
    await fresh();
    // Recheck immediately before writing, after potentially slow image uploads.
    if (mediaId && remoteFingerprint(await this.api.getDraft(mediaId)) !== baseline) throw new Error("微信后台草稿在同步期间发生变化，请重新同步查看差异");
    await fresh();
    this.settings.drafts[key] = { ...previous, mediaId, uncertain: true };
    await this.save(); // Crash recovery must be durable BEFORE sending the write.
    input.progress("正在保存到公众号草稿箱…");
    try {
      await fresh();
      if (mediaId) await this.api.updateDraft(mediaId, article, fresh);
      else mediaId = await this.api.addDraft(article, fresh);
    } catch (error) {
      if (!(error instanceof WechatUncertainError)) {
        this.settings.drafts[key] = { ...previous, uncertain: false };
        await this.save();
      }
      throw error;
    }
    // Save the known ID first; a failed readback must never cause a duplicate add.
    this.settings.drafts[key] = { mediaId, uncertain: true };
    await this.save();
    const remote = await this.api.getDraft(mediaId);
    this.settings.drafts[key] = { mediaId, fingerprint: remoteFingerprint(remote), syncedAt: new Date().toISOString() };
    await this.save();
    return mediaId;
  }
}
