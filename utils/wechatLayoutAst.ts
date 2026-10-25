import { WechatBlockKind, WechatLayoutDocument } from "../types";
import { wechatHash } from "./wechatHash";
import { MarkdownNode, parseWechatMarkdown } from "./wechatMarkdown";

export interface LayoutSourceBlock { id: string; kind: WechatBlockKind; line: number; markdown: string }
export function extractWechatBlocks(body: string, tree: MarkdownNode = parseWechatMarkdown(body)):
  { hash: string; blocks: LayoutSourceBlock[]; definitions: string } {
  const children = tree.children ?? [];
  const slice = (node: MarkdownNode) => body.slice(node.position!.start.offset!, node.position!.end.offset!);
  const definitions = children.filter(node => node.type === "definition").map(slice).join("\n");
  const blocks = children.filter(node => node.type !== "definition").map(node => {
    const markdown = slice(node);
    const types: Record<string, WechatBlockKind> = { paragraph: "paragraph", heading: "heading", list: "list", blockquote: "quote", code: "code", thematicBreak: "divider" };
    return { id: `b-${node.position!.start.offset}-${wechatHash(markdown).slice(0, 16)}`,
      kind: types[node.type] ?? "other", line: node.position!.start.line, markdown };
  });
  return { hash: wechatHash(body), blocks, definitions };
}

// Compare structure, every character and all surviving attributes, not paragraph indexes.
// Whitespace between root nodes may differ when rendering isolated Markdown blocks.
export function contentFingerprint(root: HTMLElement): string {
  const output: string[] = [];
  const text = (value: string) => output.push(`${value.length}:${value}`);
  const visit = (node: Node, structural = false) => {
    if (node.nodeType === 3) {
      if (!structural || node.textContent?.trim()) text(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    output.push(`<${el.tagName}`);
    for (const attribute of Array.from(el.attributes).filter(a => a.name !== "style")
      .sort((a, b) => a.name.localeCompare(b.name))) {
      text(attribute.name);
      text(attribute.value);
    }
    output.push(">");
    for (const child of Array.from(el.childNodes)) visit(child);
    output.push("</>");
  };
  for (const child of Array.from(root.childNodes)) visit(child, true);
  return wechatHash(output.join(""));
}

export interface WechatBlockBinding { id: string; element: HTMLElement }
export async function bindWechatBlocks(body: string, preparedMarkdown: string, root: HTMLElement,
  renderSafe: (markdown: string, target: HTMLElement) => Promise<boolean>,
  sourceTree: MarkdownNode = parseWechatMarkdown(body)):
  Promise<{ document: WechatLayoutDocument; bindings: WechatBlockBinding[] }> {
  const source = extractWechatBlocks(body, sourceTree), prepared = extractWechatBlocks(preparedMarkdown);
  const empty = { document: { hash: source.hash, blocks: [] }, bindings: [] };
  if (source.blocks.length !== prepared.blocks.length || source.blocks.length > 300) return empty;
  // Render all blocks in one host call. Isolated per-block rendering is much
  // slower for long articles and repeatedly initializes Markdown extensions.
  let salt = source.hash.slice(0, 16);
  while (preparedMarkdown.includes(`EPBLOCK${salt}`)) salt += "x";
  const markers = prepared.blocks.map((_block, index) => `EPBLOCK${salt}N${index}Z`);
  const markerIndexes = new Map(markers.map((marker, index) => [marker, index]));
  const batch = prepared.blocks.map((block, index) => `${markers[index]}\n\n${block.markdown}`).join("\n\n");
  const rendered = document.createElement("section");
  if (!await renderSafe(`${batch}\n\n${prepared.definitions}`, rendered)) return empty;
  const renderedNodes = Array.from(rendered.childNodes).filter(node => node.nodeType !== 3 || node.textContent?.trim());
  const replicas: HTMLElement[] = [];
  let replica: HTMLElement | undefined;
  let markerIndex = -1;
  for (const node of renderedNodes) {
    const marker = node.nodeType === 1 && (node as HTMLElement).tagName === "P"
      ? markerIndexes.get((node.textContent ?? "").trim()) ?? -1 : -1;
    if (marker >= 0) {
      if (marker !== markerIndex + 1) return empty;
      markerIndex = marker;
      replica = document.createElement("section");
      replicas.push(replica);
    } else if (replica) {
      replica.append(node.cloneNode(true));
    } else {
      return empty;
    }
  }
  if (replicas.length !== prepared.blocks.length) return empty;
  const flat = document.createElement("section");
  for (const replica of replicas) flat.append(...Array.from(replica.childNodes).map(n => n.cloneNode(true)));
  if (contentFingerprint(flat) !== contentFingerprint(root)) return empty;
  const rootNodes = Array.from(root.childNodes).filter(n => n.nodeType !== 3 || n.textContent?.trim());
  const bindings: WechatBlockBinding[] = [];
  const blocks: WechatLayoutDocument["blocks"] = [];
  let cursor = 0;
  for (let i = 0; i < replicas.length; i++) {
    const replica = replicas[i];
    const count = Array.from(replica.childNodes).filter(n => n.nodeType !== 3 || n.textContent?.trim()).length;
    if (!count) continue;
    const group = rootNodes.slice(cursor, cursor + count); cursor += count;
    const wrapper = document.createElement("section");
    group[0].before(wrapper); wrapper.append(...group);
    const original = source.blocks[i];
    const kind: WechatBlockKind = replica.querySelector("table") ? "table" : replica.querySelector("img") && !replica.textContent?.trim() ? "image" : original.kind;
    // A list, quote or paragraph can contain code/images at any depth. Keep
    // complete text for the inspector, and a separate redacted model input.
    const planning = wrapper.cloneNode(true) as HTMLElement;
    planning.querySelectorAll("pre,code,img").forEach(el => el.replaceWith(document.createTextNode(el.tagName === "IMG" ? "[image preserved]" : "[code preserved]")));
    blocks.push({ id: original.id, kind, line: original.line, text: wrapper.textContent ?? "", planningText: planning.textContent ?? "" });
    bindings.push({ id: original.id, element: wrapper });
  }
  return { document: { hash: source.hash, blocks }, bindings };
}
