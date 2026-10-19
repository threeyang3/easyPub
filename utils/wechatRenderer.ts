import { App, Component, MarkdownRenderer } from "obsidian";
import { WechatImage, WechatPreparedDocument } from "../types";
import { escapeHtml, prepareWechatMarkdown } from "./wechatMarkdown";
import { loadWechatImage, releaseWechatImages } from "./wechatImages";

export const WECHAT_TEMPLATE: Record<string, string> = {
  section: "font-family: sans-serif;font-size:16px;line-height:1.8;color:#292d32;overflow-wrap:break-word;",
  p: "margin:0 0 20px;font-size:16px;line-height:1.8;",
  h1: "margin:32px 0 18px;font-size:24px;line-height:1.5;font-weight:bold;color:#184f42;",
  h2: "margin:28px 0 16px;padding-left:12px;border-left:3px solid #28735c;font-size:21px;line-height:1.5;font-weight:bold;",
  h3: "margin:24px 0 14px;font-size:18px;line-height:1.6;font-weight:bold;",
  h4: "margin:20px 0 12px;font-size:17px;line-height:1.6;font-weight:bold;",
  h5: "margin:20px 0 12px;font-size:16px;line-height:1.6;font-weight:bold;",
  h6: "margin:20px 0 12px;font-size:16px;line-height:1.6;font-weight:bold;",
  blockquote: "margin:22px 0;padding:12px 16px;border-left:3px solid #9ab8aa;background:#f3f6f4;color:#53635b;",
  ul: "margin:0 0 20px;padding-left:26px;", ol: "margin:0 0 20px;padding-left:26px;",
  li: "margin:6px 0;font-size:16px;line-height:1.8;",
  pre: "margin:20px 0;padding:16px;background:#f4f5f6;border:1px solid #e5e7eb;border-radius:4px;font-size:13px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;",
  code: "font-family:monospace;background:#f4f5f6;font-size:0.9em;white-space:pre-wrap;",
  table: "width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;table-layout:fixed;",
  th: "border:1px solid #d9dfdc;padding:8px;background:#f3f6f4;text-align:left;overflow-wrap:anywhere;",
  td: "border:1px solid #d9dfdc;padding:8px;text-align:left;overflow-wrap:anywhere;",
  img: "display:block;max-width:100%;height:auto;margin:22px auto;",
  a: "color:#28735c;text-decoration:underline;", strong: "font-weight:bold;", em: "font-style:italic;",
  del: "text-decoration:line-through;", hr: "border:0;border-top:1px solid #d9dfdc;margin:28px 0;",
};
const allowed = new Set("section p h1 h2 h3 h4 h5 h6 blockquote ul ol li pre code table thead tbody tfoot tr th td img a strong em del hr br span sup sub b i s figure figcaption".split(" "));

export function normalizeWechatHtml(container: HTMLElement, images: WechatImage[]): string[] {
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
    const style = WECHAT_TEMPLATE[tag];
    if (style) el.setAttribute("style", style);
    if (tag === "code" && el.closest("pre")) el.setAttribute("style", "font-family:monospace;font-size:13px;line-height:1.7;white-space:pre-wrap;background:transparent;");
  }
  // WeChat's editor may promote whitespace siblings under a list to empty
  // bullets. Remove only structural whitespace; never touch code/text in li.
  container.querySelectorAll("ul,ol").forEach(list => {
    Array.from(list.childNodes).forEach(node => {
      if (node.nodeType === 3 && !node.textContent?.trim()) node.remove();
    });
  });
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

export async function renderWechatDocument(app: App, body: string, filePath: string, component: Component): Promise<WechatPreparedDocument> {
  const images: WechatImage[] = [];
  const bySource = new Map<string, WechatImage>();
  try {
    const prepared = await prepareWechatMarkdown(body, async source => {
      let image = bySource.get(source);
      if (!image) {
        image = await loadWechatImage(app, source, filePath, "body");
        bySource.set(source, image); images.push(image);
      }
      return image.previewUrl;
    });
    const container = document.createElement("section");
    await MarkdownRenderer.render(app, prepared.markdown, container, filePath, component);
    const issues = [...prepared.issues, ...normalizeWechatHtml(container, images)];
    container.setAttribute("style", WECHAT_TEMPLATE.section);
    return { html: container.outerHTML, images, issues: [...new Set(issues)], imageReferences: prepared.imageReferences };
  } catch (error) { releaseWechatImages(images); throw error; }
}

export function previewWechatHtml(html: string, images: WechatImage[]): string {
  for (const image of images) html = html.split(`easy-pub-image://${image.hash}`).join(escapeHtml(image.previewUrl));
  return html;
}
