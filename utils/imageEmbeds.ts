import { fromMarkdown } from "mdast-util-from-markdown";
import { PublishAsset } from "../types";

export interface ResolvedImage {
  url: string;
  alt: string;
  asset?: PublishAsset;
}

export interface PreparedImageContent {
  content: string;
  assets: PublishAsset[];
}

export async function prepareImageEmbeds(
  content: string,
  resolveImage: (linkPath: string) => Promise<ResolvedImage | null>
): Promise<PreparedImageContent> {
  const assets = new Map<string, PublishAsset>();
  // Read syntax positions only. Never reserialize the author's Markdown.
  const blocked: Array<[number, number]> = [];
  type Node = { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: Node[] };
  const visit = (node: Node) => {
    if (["code", "inlineCode", "html", "image", "imageReference"].includes(node.type)) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) blocked.push([start, end]);
      return;
    }
    node.children?.forEach(visit);
  };
  visit(fromMarkdown(content));
  const embedPattern = /!\[\[([^\]\r\n]+)\]\]/g;
  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = embedPattern.exec(content)) !== null) {
    result += content.slice(lastIndex, match.index);
    let slashes = 0;
    for (let cursor = match.index - 1; cursor >= 0 && content[cursor] === "\\"; cursor--) slashes++;
    if (slashes % 2 || blocked.some(([start, end]) => match!.index >= start && match!.index < end)) {
      result += match[0];
      lastIndex = embedPattern.lastIndex;
      continue;
    }
    const linkPath = match[1].split("|", 1)[0].split("#", 1)[0].trim();
    const resolved = linkPath ? await resolveImage(linkPath) : null;
    if (!resolved) {
      result += match[0];
    } else {
      if (resolved.asset) assets.set(resolved.asset.targetPath, resolved.asset);
      result += `![${escapeAltText(resolved.alt)}](${resolved.url})`;
    }
    lastIndex = embedPattern.lastIndex;
  }
  return { content: result + content.slice(lastIndex), assets: [...assets.values()] };
}

function escapeAltText(value: string): string {
  return value.replace(/[[\]\\]/g, "\\$&");
}
