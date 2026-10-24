import { App, Component, MarkdownRenderer } from "obsidian";
import { fromMarkdown } from 'mdast-util-from-markdown';
import { WechatImage, WechatPreparedDocument } from "../types";
import { escapeHtml, prepareWechatMarkdown } from "./wechatMarkdown";
import { loadWechatImage, releaseWechatImages } from "./wechatImages";

export { WECHAT_TEMPLATE } from "./wechatThemes";
import { bindWechatBlocks, extractWechatBlocks } from "./wechatLayoutAst";
import { applyWechatLayout } from "./wechatLayoutEngine";
import { prepareWechatCode } from "./wechatCode";
const allowed = new Set("section p h1 h2 h3 h4 h5 h6 blockquote ul ol li pre code table thead tbody tfoot tr th td img a strong em del hr br span sup sub b i s figure figcaption".split(" "));
export const WECHAT_HTML_LIMIT_ISSUE = "排版后的正文超过 2 万字符或 1 MB，请精简后重试";

export function sanitizeWechatHtml(container: HTMLElement, images: WechatImage[]): string[] {
  const issues: string[] = [];
  container.querySelectorAll(".frontmatter,.metadata-container,.copy-code-button,.heading-collapse-indicator,.list-collapse-indicator,.footnote-backref,.internal-link .link-icon").forEach(el => el.remove());
  for (const el of Array.from(container.querySelectorAll(".math,.mermaid,svg,video,audio,iframe,object,embed,canvas,.internal-embed"))) {
    issues.push(`不支持直接同步的内容：${el.getAttribute("src") || el.getAttribute("data-type") || el.className || el.tagName}`);
    el.replaceWith(document.createTextNode("[此内容需要转换为普通图片或文本]"));
  }
  container.querySelectorAll("script,style,link,meta,button,input,textarea,select").forEach(el => el.remove());
  const imageMap = new Map(images.map(image => [image.previewUrl, image]));
  for (const el of Array.from(container.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();
    if (!allowed.has(tag)) { el.replaceWith(...Array.from(el.childNodes)); continue; }
    const src = el.getAttribute("src") ?? "";
    const alt = el.getAttribute("alt") ?? "";
    const href = el.getAttribute("href") ?? "";
    const internal = el.classList.contains("internal-link");
    const span = el.getAttribute("colspan");
    const row = el.getAttribute("rowspan");
    const start = el.getAttribute("start");
    Array.from(el.attributes).forEach(attribute => el.removeAttribute(attribute.name));
    if (tag === "img") {
      const image = imageMap.get(src);
      if (!image) { issues.push(`未能处理的 HTML 图片：${alt || src}`); el.remove(); continue; }
      el.setAttribute("src", `easy-pub-image://${image.hash}`); el.setAttribute("alt", alt);
      // Reserve the image's aspect ratio before decoding, so refresh does not
      // temporarily collapse the preview and clamp its reading position.
      el.setAttribute("width", String(image.width)); el.setAttribute("height", String(image.height));
    }
    if (tag === "a") {
      if (internal || !/^https?:\/\//i.test(href)) { el.replaceWith(...Array.from(el.childNodes)); continue; }
      el.setAttribute("href", href);
    }
    if (["th", "td"].includes(tag)) {
      if (span && /^\d{1,2}$/.test(span)) el.setAttribute("colspan", span);
      if (row && /^\d{1,2}$/.test(row)) el.setAttribute("rowspan", row);
    }
    if (tag === "ol" && start && /^\d{1,6}$/.test(start)) el.setAttribute("start", start);
  }
  // WeChat's editor may promote whitespace siblings under a list to empty
  // bullets. Remove only structural whitespace; never touch code/text in li.
  container.querySelectorAll("ul,ol").forEach(list => {
    Array.from(list.childNodes).forEach(node => {
      if (node.nodeType === 3 && !node.textContent?.trim()) node.remove();
    });
  });
  prepareWechatCode(container);
  return issues;
}

// Backward-compatible default normalization entry point for existing integrations.
export function normalizeWechatHtml(container: HTMLElement, images: WechatImage[]): string[] {
  const issues = sanitizeWechatHtml(container, images);
  applyWechatLayout(container, {hash: "0".repeat(64), blocks: []}, []);
  return issues;
}

export function digestFromWechatHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,pre,table,img,h1,h2,h3,h4,h5,h6").forEach(el => el.remove());
  const paragraphs = Array.from(doc.querySelectorAll("p")).filter(el => !el.closest("li,blockquote"))
    .map(el => el.textContent?.trim() ?? "").filter(Boolean);
  doc.querySelectorAll("li,blockquote,br").forEach(el => el.appendChild(doc.createTextNode(" ")));
  const text = paragraphs.length ? paragraphs.join(" ") : doc.body.textContent ?? "";
  return Array.from(text.replace(/\s+/g, " ").trim()).slice(0, 100).join("");
}

export async function renderWechatDocument(app: App, body: string, filePath: string, component: Component, allowRemote = () => true, layout?: unknown): Promise<WechatPreparedDocument> {
  const images: WechatImage[] = [];
  const bySource = new Map<string, WechatImage>();
  try {
    // Do not hand raw HTML to the host in local-only mode: <img>, CSS URLs and
    // media embeds could otherwise bypass the controlled image downloader.
    const hasHtml = (node: { type: string; children?: any[] }): boolean => node.type === 'html' || Boolean(node.children?.some(hasHtml));
    const rawHtml = hasHtml(fromMarkdown(body));
    const rawHtmlIssue = '仅 Vault 附件模式不渲染原始 HTML，请转换为 Markdown 后刷新';
    if (!allowRemote() && rawHtml) {
      return { html: '<section></section>', images: [], imageReferences: [], issues: [rawHtmlIssue] };
    }
    const prepared = await prepareWechatMarkdown(body, async source => {
      let image = bySource.get(source);
      if (!image) {
        image = await loadWechatImage(app, source, filePath, "body", allowRemote);
        bySource.set(source, image); images.push(image);
      }
      return image.previewUrl;
    });
    if (!allowRemote() && images.some(image => !image.localPath)) {
      throw new Error('网络图片权限已变化，本轮预览已丢弃，请刷新');
    }
    if (!allowRemote() && (prepared.issues.length || rawHtml)) {
      return { html: '<section></section>', images, issues: [...prepared.issues, ...(rawHtml ? [rawHtmlIssue] : [])], imageReferences: prepared.imageReferences };
    }
    const container = document.createElement("section");
    await MarkdownRenderer.render(app, prepared.markdown, container, filePath, component);
    if (!allowRemote() && (rawHtml || images.some(image => !image.localPath))) {
      throw new Error('网络图片权限已变化，本轮预览已丢弃，请刷新');
    }
    const issues = [...prepared.issues, ...sanitizeWechatHtml(container, images)];
    // Raw HTML may have host-side resource effects; never render it a second time
    // to infer source mapping. It remains eligible for safe tag-based themes.
    const mapped = rawHtml ? {document: {hash: extractWechatBlocks(body).hash, blocks: []}, bindings: []} : await bindWechatBlocks(body, prepared.markdown, container, async (markdown, target) => {
      await MarkdownRenderer.render(app, markdown, target, filePath, component);
      return sanitizeWechatHtml(target, images).length === 0;
    });
    if (!allowRemote() && (rawHtml || images.some(image => !image.localPath))) throw new Error('网络图片权限已变化，请刷新');
    const outcome = applyWechatLayout(container, mapped.document, mapped.bindings, layout);
    const html = container.outerHTML;
    if (Array.from(html).length >= 20000 || new TextEncoder().encode(html).length >= 1024 * 1024) issues.push(WECHAT_HTML_LIMIT_ISSUE);
    return { html, images, issues: [...new Set(issues)], imageReferences: prepared.imageReferences,
      layoutDocument: mapped.document, layoutNotice: outcome.notice };
  } catch (error) { releaseWechatImages(images); throw error; }
}

export function previewWechatHtml(html: string, images: WechatImage[]): string {
  for (const image of images) html = html.split(`easy-pub-image://${image.hash}`).join(escapeHtml(image.previewUrl));
  return html;
}
