import { fromMarkdown } from "mdast-util-from-markdown";
import { WechatBlockKind, WechatLayoutDocument } from "../types";
import { wechatHash } from "./wechatHash";

export interface LayoutSourceBlock { id: string; kind: WechatBlockKind; line: number; markdown: string }
export function extractWechatBlocks(body: string): { hash: string; blocks: LayoutSourceBlock[]; definitions: string } {
  const tree = fromMarkdown(body);
  const slice = (node: typeof tree.children[number]) => body.slice(node.position!.start.offset!, node.position!.end.offset!);
  const definitions = tree.children.filter(node => node.type === "definition").map(slice).join("\n");
  const blocks = tree.children.filter(node => node.type !== "definition").map(node => {
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
  const visit = (node: Node, structural = false): unknown => {
    if (node.nodeType === 3) return structural && !node.textContent?.trim() ? null : node.textContent;
    if (node.nodeType !== 1) return null;
    const el = node as HTMLElement;
    return [el.tagName, Array.from(el.attributes).filter(a => a.name !== "style").map(a => [a.name, a.value]).sort(),
      Array.from(el.childNodes).map(n => visit(n)).filter(n => n !== null)];
  };
  return JSON.stringify(Array.from(root.childNodes).map(n => visit(n, true)).filter(n => n !== null));
}

export interface WechatBlockBinding { id: string; element: HTMLElement }
export async function bindWechatBlocks(body: string, preparedMarkdown: string, root: HTMLElement,
  renderSafe: (markdown: string, target: HTMLElement) => Promise<boolean>): Promise<{ document: WechatLayoutDocument; bindings: WechatBlockBinding[] }> {
  const source = extractWechatBlocks(body), prepared = extractWechatBlocks(preparedMarkdown);
  const empty = { document: { hash: source.hash, blocks: [] }, bindings: [] };
  if (source.blocks.length !== prepared.blocks.length || source.blocks.length > 300) return empty;
  const replicas: HTMLElement[] = [];
  for (const block of prepared.blocks) {
    const replica = document.createElement("section");
    if (!await renderSafe(`${block.markdown}\n\n${prepared.definitions}`, replica)) return empty;
    replicas.push(replica);
  }
  const flat = document.createElement("section");
  for (const replica of replicas) flat.append(...Array.from(replica.childNodes).map(n => n.cloneNode(true)));
  if (contentFingerprint(flat) !== contentFingerprint(root)) return empty;
  const nodes = Array.from(root.childNodes).filter(n => n.nodeType !== 3 || n.textContent?.trim());
  const bindings: WechatBlockBinding[] = [];
  const blocks: WechatLayoutDocument["blocks"] = [];
  let cursor = 0;
  for (let i = 0; i < replicas.length; i++) {
    const replica = replicas[i];
    const count = Array.from(replica.childNodes).filter(n => n.nodeType !== 3 || n.textContent?.trim()).length;
    if (!count) continue;
    const group = nodes.slice(cursor, cursor + count); cursor += count;
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
