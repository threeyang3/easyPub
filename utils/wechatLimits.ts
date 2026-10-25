/** One rule for local rendering, layout previews and final uploaded HTML. */
export const WECHAT_HTML_LIMIT_ISSUE = "排版后的正文超过 2 万字符或 1 MB，请精简后重试";
export function exceedsWechatHtmlLimit(html: string): boolean {
  // Count Unicode code points, not UTF-16 units; avoid allocating an array of the article.
  let characters = 0;
  for (const _ of html) if (++characters >= 20000) return true;
  return new TextEncoder().encode(html).byteLength >= 1024 * 1024;
}
export function assertWechatHtmlLimit(html: string): void {
  if (exceedsWechatHtmlLimit(html)) throw new Error(WECHAT_HTML_LIMIT_ISSUE);
}

export const WECHAT_ARTICLE_FIELDS = [
  ["title", "标题", 32], ["author", "作者", 16],
  ["digest", "摘要", 120], ["sourceUrl", "阅读原文链接", 1024],
] as const;
export function wechatFieldLength(key: string, value: string): number {
  return key === "sourceUrl" ? new TextEncoder().encode(value).length : Array.from(value).length;
}
