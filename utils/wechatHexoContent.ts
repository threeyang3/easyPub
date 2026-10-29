import type { WechatArticleSettings, WechatImage, WechatPreparedDocument } from "../types";
import { WECHAT_HTML_LIMIT_ISSUE } from "./wechatLimits";

export interface WechatHexoInput {
  snapshot: string;
  document: WechatPreparedDocument;
  article: WechatArticleSettings;
  cover?: WechatImage;
  assertFresh: () => Promise<void>;
}
const tags = new Set("section p h1 h2 h3 h4 h5 h6 blockquote ul ol li pre code table thead tbody tfoot tr th td img a strong em del hr br span sup sub b i s figure figcaption".split(" "));
export const WECHAT_HEXO_STYLES = `.easy-pub-wechat-layout::before,.easy-pub-wechat-layout::after,.easy-pub-wechat-layout *::before,.easy-pub-wechat-layout *::after{content:none!important}.easy-pub-wechat-layout,.easy-pub-wechat-layout *{box-sizing:border-box}.easy-pub-wechat-layout{display:block;max-width:100%;text-align:left}.easy-pub-wechat-layout a{border:0!important}.easy-pub-wechat-layout pre{display:block!important}`;

/** Export the approved rendered layout, not a second Markdown rendition. */
export function exportWechatHexoContent(prepared: WechatPreparedDocument, imageUrl: (image: WechatImage) => string, stylesheetUrl?: string) {
  const issues = prepared.issues.filter(issue => issue !== WECHAT_HTML_LIMIT_ISSUE);
  if (issues.length) throw new Error(`请先修复公众号预览问题：${issues.join("；")}`);
  const parsed = new DOMParser().parseFromString(prepared.html, "text/html");
  const root = parsed.body.firstElementChild as HTMLElement | null;
  if (!root || root.tagName !== "SECTION" || parsed.body.children.length !== 1) throw new Error("公众号排版预览无效，请刷新后重试");
  const images = new Map(prepared.images.map(image => [image.hash, image]));
  for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
    if (!tags.has(element.tagName.toLowerCase())) throw new Error("公众号预览包含不支持的标签，请刷新后重试");
    for (const attribute of Array.from(element.attributes)) {
      if (!["style", "src", "alt", "href", "width", "height", "colspan", "rowspan", "start"].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (element.tagName === "IMG") {
      const hash = element.getAttribute("src")?.match(/^easy-pub-image:\/\/([a-f0-9]{64})$/)?.[1];
      const image = hash ? images.get(hash) : undefined;
      if (!image) throw new Error("图片与公众号预览不一致，请刷新后重试");
      element.setAttribute("src", imageUrl(image));
    } else element.removeAttribute("src");
    if (element.tagName === "A") {
      const href = element.getAttribute("href") ?? "";
      const url = new URL(href);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("正文链接无效，请检查公众号稿");
      element.setAttribute("rel", "noopener noreferrer");
    } else element.removeAttribute("href");
    // Inline layout wins over the blog theme, including its !important rules.
    const declarations = Array.from(element.style).map(property => `${property}:${element.style.getPropertyValue(property)} !important;`);
    if (declarations.length) element.setAttribute("style", declarations.join(""));
  }
  if (!root.style.background && !root.style.backgroundColor) root.style.setProperty("background-color", "#fff", "important");
  root.className = "easy-pub-wechat-layout";
  // Neutralize template delimiters in text/code before wrapping in Hexo's raw block.
  const html = root.outerHTML.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
  const stylesheet = stylesheetUrl ?? `data:text/css;charset=utf-8,${encodeURIComponent(WECHAT_HEXO_STYLES)}`;
  return { html: `<style>${WECHAT_HEXO_STYLES}</style>` + html, body: `{% raw %}\n<link rel="stylesheet" href="${stylesheet.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}">\n${html}\n{% endraw %}\n` };
}
