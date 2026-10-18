import { randomBytes } from "crypto";
import { requestUrl } from "obsidian";
import { WechatArticle, WechatImage } from "../types";
import { withTimeout } from "./async";

export interface WechatRequest { url: string; method: string; headers?: Record<string, string>; body?: string | ArrayBuffer }
export interface WechatResponse { status: number; json: unknown }
export type WechatTransport = (request: WechatRequest) => Promise<WechatResponse>;
export class WechatApiError extends Error {
  constructor(public code: number) {
    const hints: Record<number, string> = {
      40013: "AppID 无效", 40125: "AppSecret 无效", 40164: "请在公众号后台配置当前出口 IP 白名单",
      40001: "访问令牌失效，请重新检查连接", 42001: "访问令牌已过期，请重试",
      48001: "账号未获此接口权限，请检查素材和草稿箱权限", 48002: "账号没有此接口权限",
      48004: "接口被限制，请查看公众号后台通知", 45009: "接口调用额度已用尽，请稍后重试",
      40007: "素材或草稿 ID 无效", 46001: "素材或草稿不存在，可能已被删除或发布",
      45001: "图片超过接口大小限制，请替换", 40005: "图片格式不被接口接受，请转换后重试",
      45110: "作者字段过长，请缩短", 45166: "正文包含微信不接受的内容，请检查排版与嵌入",
    };
    super(`微信接口 ${code}：${hints[code] ?? "请求被拒绝，请在微信 API 诊断工具中检查此错误码"}`);
  }
}
export class WechatUncertainError extends Error {
  constructor() { super("草稿写入结果不确定，已停止自动重试。请查询近期草稿并重新关联，避免重复创建。"); }
}
export const isMissingWechatMedia = (error: unknown): boolean => error instanceof WechatApiError && [40007, 46001].includes(error.code);
const defaultTransport: WechatTransport = async request => {
  const response = await requestUrl({ ...request, throw: false });
  let json: unknown = null;
  try { json = response.json; } catch { /* Permanent image material returns binary. */ }
  return { status: response.status, json };
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("微信接口返回格式异常");
  return value as Record<string, unknown>;
};

export class WechatApi {
  private token = "";
  private expires = 0;
  private tokenPending?: Promise<string>;
  constructor(private appId: string, private secret: string, private transport: WechatTransport = defaultTransport) {}

  private async send(request: WechatRequest, timeout: number): Promise<Record<string, unknown>> {
    // Never include network error objects: they can contain the token or AppSecret.
    let response: WechatResponse;
    try { response = await withTimeout(this.transport(request), timeout, "请求超时"); }
    catch { throw new Error("微信请求超时或连接失败，请检查网络"); }
    if (response.status < 200 || response.status >= 300) throw new Error(`微信 HTTP ${response.status}`);
    const data = record(response.json);
    if (typeof data.errcode === "number" && data.errcode !== 0) throw new WechatApiError(data.errcode);
    return data;
  }

  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.expires) return this.token;
    if (this.tokenPending) return this.tokenPending;
    if (!this.appId || !this.secret) throw new Error("请先配置公众号 AppID 和 AppSecret");
    this.tokenPending = (async () => {
      const data = await this.send({ url: "https://api.weixin.qq.com/cgi-bin/stable_token", method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credential", appid: this.appId, secret: this.secret, force_refresh: false }),
      }, 10000);
      if (typeof data.access_token !== "string" || typeof data.expires_in !== "number") throw new Error("微信令牌返回格式异常");
      this.token = data.access_token;
      this.expires = Date.now() + Math.max(0, data.expires_in - 120) * 1000;
      return this.token;
    })();
    try { return await this.tokenPending; } finally { this.tokenPending = undefined; }
  }

  private async call(endpoint: string, body: unknown, write = false, retry = true,
    binary?: { body: ArrayBuffer; contentType: string }, method = "POST", beforeWrite?: () => Promise<void>): Promise<Record<string, unknown>> {
    const token = await this.accessToken();
    if (write) await beforeWrite?.();
    try {
      return await this.send({ url: `https://api.weixin.qq.com/cgi-bin/${endpoint}${endpoint.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`,
        method, headers: { "Content-Type": binary?.contentType ?? "application/json" },
        ...(method === "GET" ? {} : { body: binary?.body ?? JSON.stringify(body) }) }, binary ? 60000 : write ? 30000 : 10000);
    } catch (error) {
      if (error instanceof WechatApiError) {
        if (retry && [40001, 40014, 42001].includes(error.code)) {
          this.expires = 0;
          return this.call(endpoint, body, write, false, binary, method, beforeWrite);
        }
        throw error; // An explicit API rejection did not create a draft.
      }
      if (write) throw new WechatUncertainError();
      throw error;
    }
  }

  async checkConnection(): Promise<string[]> {
    await this.accessToken();
    const results: string[] = ["访问令牌正常"];
    for (const [name, endpoint] of [["素材读取", "material/get_materialcount"], ["草稿读取", "draft/count"]]) {
      try { await this.call(endpoint, {}, false, true, undefined, "GET"); results.push(`${name}正常`); }
      catch (error) { results.push(`${name}失败：${(error as Error).message}`); }
    }
    results.push("只读检查不验证素材上传及草稿写入权限，实际同步时继续检查。");
    return results;
  }

  async upload(image: WechatImage, cover: boolean): Promise<{ url: string; mediaId?: string }> {
    const boundary = `EasyPub${randomBytes(16).toString("hex")}`;
    const extension = image.mime === "image/png" ? "png" : image.mime === "image/gif" ? "gif" : "jpg";
    const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${image.hash}.${extension}"\r\nContent-Type: ${image.mime}\r\n\r\n`);
    const payload = Buffer.concat([header, image.bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const data = await this.call(cover ? "material/add_material?type=image" : "media/uploadimg", null, false, true,
      { body: payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer, contentType: `multipart/form-data; boundary=${boundary}` });
    if (typeof data.url !== "string" || !/^https?:\/\//.test(data.url)
      || cover && typeof data.media_id !== "string") throw new Error("微信图片上传返回格式异常");
    return { url: data.url, ...(cover ? { mediaId: data.media_id as string } : {}) };
  }
  async materialExists(mediaId: string, retry = true): Promise<void> {
    // Image material returns binary, not JSON. Inspect the response without logging it.
    const token = await this.accessToken();
    try {
      const result = await withTimeout(this.transport({ url: `https://api.weixin.qq.com/cgi-bin/material/get_material?access_token=${encodeURIComponent(token)}`,
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ media_id: mediaId }) }), 10000, "素材检查超时");
      if (result.status !== 200) throw new Error("素材检查失败");
      if (result.json && typeof result.json === "object") {
        const code = (result.json as { errcode?: number }).errcode;
        if (code) throw new WechatApiError(code);
      }
    } catch (error) {
      if (error instanceof WechatApiError) {
        if (retry && [40001, 40014, 42001].includes(error.code)) { this.expires = 0; return this.materialExists(mediaId, false); }
        throw error;
      }
      throw new Error("封面素材检查失败，请检查连接后重试");
    }
  }
  async getDraft(mediaId: string): Promise<unknown[]> {
    const data = await this.call("draft/get", { media_id: mediaId });
    if (!Array.isArray(data.news_item)) throw new Error("微信草稿返回格式异常");
    return data.news_item;
  }
  async listDrafts(): Promise<Array<{ media_id: string; content: { news_item: Array<{ title: string }> } }>> {
    const data = await this.call("draft/batchget", { offset: 0, count: 20, no_content: 0 });
    if (!Array.isArray(data.item)) throw new Error("草稿列表返回格式异常");
    return data.item as Array<{ media_id: string; content: { news_item: Array<{ title: string }> } }>;
  }
  async addDraft(article: WechatArticle, beforeWrite?: () => Promise<void>): Promise<string> {
    const data = await this.call("draft/add", { articles: [{ ...article, article_type: "news" }] }, true, true, undefined, "POST", beforeWrite);
    if (typeof data.media_id !== "string") throw new WechatUncertainError();
    return data.media_id;
  }
  async updateDraft(mediaId: string, article: WechatArticle, beforeWrite?: () => Promise<void>): Promise<void> {
    const data = await this.call("draft/update", { media_id: mediaId, index: 0, articles: { ...article, article_type: "news" } }, true, true, undefined, "POST", beforeWrite);
    if (data.errcode !== 0) throw new WechatUncertainError();
  }
}
