import { fromMarkdown } from "mdast-util-from-markdown";
import { App, TFile } from "obsidian";
import { relativeVaultAttachment, resolveVaultAttachment } from "./platforms";
import type { WechatImage, WechatImageReference } from "../types";

export const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg"]);
export const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export interface MarkdownNode {
  type: string; url?: string; alt?: string | null; identifier?: string;
  position?: { start: { offset?: number; line: number }; end: { offset?: number } };
  children?: MarkdownNode[];
}

export function parseWechatMarkdown(body: string): MarkdownNode {
  return fromMarkdown(body) as MarkdownNode;
}

export async function transformWechatWikiImages(body: string,
  resolve: (source: string) => Promise<string | null>, tree: MarkdownNode = parseWechatMarkdown(body)): Promise<string> {
  const blocked: Array<[number, number]> = [];
  const visit = (node: MarkdownNode) => {
    if (["code", "inlineCode", "html", "image", "imageReference"].includes(node.type)) {
      if (node.position?.start.offset !== undefined && node.position.end.offset !== undefined) blocked.push([node.position.start.offset, node.position.end.offset]);
      return;
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  const pattern = /!\[\[([^\]\r\n]+)\]\]/g;
  const replacements: Array<{ start: number; end: number; content: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body))) {
    if (blocked.some(([start, end]) => match!.index >= start && match!.index < end)) continue;
    let slashes = 0;
    for (let i = match.index - 1; i >= 0 && body[i] === "\\"; i--) slashes++;
    if (slashes % 2) continue;
    const source = match[1].split("|", 1)[0].split("#", 1)[0].trim();
    const content = await resolve(source);
    if (content !== null) replacements.push({ start: match.index, end: pattern.lastIndex, content });
  }
  for (const replacement of replacements.reverse()) body = body.slice(0, replacement.start) + replacement.content + body.slice(replacement.end);
  return body;
}

// Use syntax positions, so code, escaped images, reference links and nested alt text
// cannot be accidentally rewritten by a regular-expression replacement.
export async function transformMarkdownImages(body: string,
  resolve: (source: string, alt: string, line: number) => Promise<string>,
  tree: MarkdownNode = parseWechatMarkdown(body)): Promise<string> {
  const definitions = new Map<string, string>();
  const images: MarkdownNode[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "definition" && node.identifier && node.url) definitions.set(node.identifier.toLowerCase(), node.url);
    if (node.type === "image" || node.type === "imageReference") images.push(node);
    node.children?.forEach(visit);
  };
  visit(tree);
  const replacements: Array<{ start: number; end: number; content: string }> = [];
  for (const image of images) {
    const source = image.url ?? definitions.get((image.identifier ?? "").toLowerCase());
    const start = image.position?.start.offset;
    const end = image.position?.end.offset;
    if (!source || start === undefined || end === undefined) continue;
    replacements.push({ start, end, content: await resolve(source, image.alt ?? "", image.position!.start.line) });
  }
  for (const replacement of replacements.reverse()) body = body.slice(0, replacement.start) + replacement.content + body.slice(replacement.end);
  return body;
}

export function resolveVaultImage(app: App, source: string, filePath: string): TFile {
  let decoded = source;
  try { decoded = decodeURIComponent(source); } catch { /* Keep a literal percent in a filename. */ }
  const file = resolveVaultAttachment(app, decoded, filePath);
  if (!(file instanceof TFile) || !IMAGE_EXTENSIONS.has(file.extension.toLowerCase())) throw new Error(`找不到图片附件：${source}`);
  return file;
}

export async function rebaseWechatImages(app: App, body: string, sourcePath: string, targetPath: string): Promise<string> {
  const encodedPath = (file: TFile) => relativeVaultAttachment(targetPath, file.path).split("/").map(segment => encodeURIComponent(segment).replace(/[()]/g, ch => ch === "(" ? "%28" : "%29")).join("/");
  const standard = await transformMarkdownImages(body, async (source, alt) => {
    if (/^https?:\/\//i.test(source)) return `![${alt.replace(/[\[\]\\]/g, "\\$&")}](${source})`;
    const file = resolveVaultImage(app, source, sourcePath);
    const url = encodedPath(file);
    return `![${alt.replace(/[\[\]\\]/g, "\\$&")}](${url})`;
  });
  return transformWechatWikiImages(standard, async source => {
    const file = resolveVaultAttachment(app, source, sourcePath);
    if (!(file instanceof TFile) || !IMAGE_EXTENSIONS.has(file.extension.toLowerCase())) return null;
    return `![${file.basename.replace(/[\[\]\\]/g, "\\$&")}](${encodedPath(file)})`;
  });
}

export async function prepareWechatMarkdown(body: string,
  resolve: (source: string) => Promise<string>,
  sourceTree: MarkdownNode = parseWechatMarkdown(body)): Promise<{ markdown: string; issues: string[]; imageReferences: WechatImageReference[] }> {
  const issues: string[] = [];
  const imageReferences: WechatImageReference[] = [];
  const wiki = await transformWechatWikiImages(body, async source => {
    if (!IMAGE_EXTENSIONS.has(source.split(".").pop()?.toLowerCase() ?? "")) {
      issues.push(`不支持的笔记或媒体嵌入：${source}`); return null;
    }
    // Preserve the path in a Markdown image; the AST pass resolves every format.
    const url = source.split("/").map(segment => encodeURIComponent(segment).replace(/[()]/g, ch => ch === "(" ? "%28" : "%29")).join("/");
    return `![${(source.split("/").pop() ?? source).replace(/[\[\]\\]/g, "\\$&")}](${url})`;
  }, sourceTree);
  const markdown = await transformMarkdownImages(wiki, async (source, alt, line) => {
    try {
      const url = await resolve(source);
      imageReferences.push({ source, line, status: "ready" });
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" />`;
    } catch (error) {
      const message = (error as Error).message;
      imageReferences.push({ source, line, status: "error", error: message });
      issues.push(`正文第 ${line} 行 · ${source}：${message}`);
      return `<span>图片处理失败：${escapeHtml(alt || source)}</span>`;
    }
  });
  return { markdown, issues, imageReferences };
}

export function replaceWechatImageTokens(html: string, images: WechatImage[],
  replacement: (image: WechatImage) => string): string {
  if (!images.length || !html.includes("easy-pub-image://")) return html;
  const byHash = new Map(images.map(image => [image.hash, image]));
  return html.replace(/easy-pub-image:\/\/([a-f0-9]+)/g, (token, hash: string) => {
    const image = byHash.get(hash);
    return image ? replacement(image) : token;
  });
}
