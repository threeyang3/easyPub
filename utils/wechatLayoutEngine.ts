import { WechatLayoutDocument, WechatLayoutInstruction, WechatLayoutPlan, WechatThemeId, WechatAccent } from "../types";
import { componentStyle, themeStyles, WECHAT_ACCENTS, WECHAT_THEMES } from "./wechatThemes";
import { contentFingerprint, WechatBlockBinding } from "./wechatLayoutAst";

export const LAYOUT_ROLES = ["body", "lead", "key-point", "quotation", "summary"] as const;
export const LAYOUT_COMPONENT_ROLES = {plain: "body", intro: "lead", "highlight-card": "key-point", quote: "quotation", conclusion: "summary"} as const;
export const LAYOUT_COMPONENTS = ["plain", "intro", "highlight-card", "quote", "conclusion"] as const;
const obj = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("排版方案格式无效");
  return value as Record<string, unknown>;
};
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new Error("排版方案包含不支持的字段");
}
export function readWechatLayoutPlan(input: unknown): WechatLayoutPlan {
  const data = obj(input); keys(data, ["schemaVersion", "documentHash", "theme", "accentColor", "blocks", "sourceBlocks"]);
  if (data.schemaVersion !== 1 || typeof data.documentHash !== "string" || !/^[a-f0-9]{64}$/.test(data.documentHash)
    || !Object.prototype.hasOwnProperty.call(WECHAT_THEMES, String(data.theme)) || !Object.prototype.hasOwnProperty.call(WECHAT_ACCENTS, String(data.accentColor))
    || !Array.isArray(data.blocks) || data.blocks.length > 300) throw new Error("排版方案版本、主题或文章标识无效");
  const seen = new Set<string>();
  const blocks = data.blocks.map(raw => {
    const entry = obj(raw); keys(entry, ["id", "role", "component", "locked"]);
    if (typeof entry.id !== "string" || !/^b-\d+-[a-f0-9]{16}$/.test(entry.id) || seen.has(entry.id)
      || !LAYOUT_ROLES.includes(entry.role as any) || !LAYOUT_COMPONENTS.includes(entry.component as any)
      || entry.locked !== undefined && typeof entry.locked !== "boolean") throw new Error("区块排版指令无效或重复");
    seen.add(entry.id);
    return { id: entry.id, role: entry.role, component: entry.component, ...(entry.locked === true ? { locked: true } : {}) } as WechatLayoutInstruction;
  });
  let sourceBlocks: WechatLayoutPlan["sourceBlocks"];
  if (data.sourceBlocks !== undefined) {
    if (!Array.isArray(data.sourceBlocks) || data.sourceBlocks.length > 300) throw new Error("原排版区块记录无效");
    const seen = new Set<string>();
    sourceBlocks = data.sourceBlocks.map(raw => {
      const block = obj(raw); keys(block, ["id", "kind"]);
      if (typeof block.id !== "string" || !/^b-\d+-[a-f0-9]{16}$/.test(block.id) || seen.has(block.id)
        || !["paragraph","heading","list","quote","code","image","table","divider","other"].includes(String(block.kind))) throw new Error("原排版区块记录无效");
      seen.add(block.id); return {id: block.id, kind: block.kind as import("../types").WechatBlockKind};
    });
  }
  return { schemaVersion: 1, documentHash: data.documentHash, theme: data.theme as WechatThemeId, accentColor: data.accentColor as WechatAccent, blocks,
    ...(sourceBlocks ? {sourceBlocks} : {}) };
}

export function anchorWechatLayout(plan: WechatLayoutPlan, doc: WechatLayoutDocument): WechatLayoutPlan {
  return {...validateWechatLayout(plan, doc), sourceBlocks: doc.blocks.length<=300?doc.blocks.map(({id,kind}) => ({id,kind})):[]};
}

/** Only exact, unique content matches carry component styles across changed documents. */
export function rebaseWechatLayout(input: unknown, doc: WechatLayoutDocument, previous?: WechatLayoutDocument): {plan: WechatLayoutPlan; notice?: string} {
  const old = readWechatLayoutPlan(input);
  if (old.documentHash === doc.hash) return {plan: anchorWechatLayout(old, doc)};
  const oldBlocks = previous?.hash === old.documentHash ? previous.blocks : old.sourceBlocks ?? [];
  const suffix = (id: string) => id.slice(id.lastIndexOf("-")+1);
  const oldCount = new Map<string,number>(), candidates = new Map<string, typeof doc.blocks>();
  for (const block of oldBlocks) oldCount.set(suffix(block.id), (oldCount.get(suffix(block.id)) ?? 0)+1);
  for (const block of doc.blocks) candidates.set(suffix(block.id), [...(candidates.get(suffix(block.id)) ?? []), block]);
  const blocks = old.blocks.flatMap(instruction => {
    const fingerprint = suffix(instruction.id), matches = candidates.get(fingerprint) ?? [];
    if (!oldBlocks.some(block => block.id === instruction.id) || oldCount.get(fingerprint) !== 1 || matches.length !== 1
      || !["paragraph","list","quote"].includes(matches[0].kind) && instruction.component !== "plain") return [];
    return [{...instruction, id: matches[0].id}];
  });
  const plan = anchorWechatLayout({...old, documentHash: doc.hash, blocks, sourceBlocks: undefined}, doc);
  return {plan, notice: `正文已变化，已保留主题和配色、${blocks.length} 个区块样式；${old.blocks.length-blocks.length} 个区块需重新确认。`};
}
export function validateWechatLayout(input: unknown, doc: WechatLayoutDocument): WechatLayoutPlan {
  const plan = readWechatLayoutPlan(input);
  if (plan.documentHash !== doc.hash) throw new Error("文章正文已变化，原排版方案已过期");
  const sourceBlocks = new Map(doc.blocks.map(block => [block.id, block]));
  for (const block of plan.blocks) {
    const source = sourceBlocks.get(block.id);
    if (!source) throw new Error("排版方案引用了不存在的区块");
    if (!["paragraph", "list", "quote"].includes(source.kind) && block.component !== "plain") throw new Error("代码、标题、表格、图片等区块只允许保留原结构");
    if (LAYOUT_COMPONENT_ROLES[block.component] !== block.role) throw new Error("区块角色与组件不一致");
  }
  return plan;
}
export function themePlan(doc: WechatLayoutDocument, theme: WechatThemeId, accentColor: WechatAccent = "teal"): WechatLayoutPlan {
  return {schemaVersion: 1, documentHash: doc.hash, theme, accentColor, blocks: []};
}
export function mergeLockedLayout(proposed: WechatLayoutPlan, current: WechatLayoutPlan | undefined, doc: WechatLayoutDocument): WechatLayoutPlan {
  const plan = validateWechatLayout(proposed, doc);
  if (!current || current.documentHash !== doc.hash) return plan;
  const locks = validateWechatLayout(current, doc).blocks.filter(b => b.locked);
  const lockedIds = new Set(locks.map(block => block.id));
  return validateWechatLayout({...plan, blocks: [...plan.blocks.filter(b => !lockedIds.has(b.id)), ...locks]}, doc);
}
export function applyWechatLayout(root: HTMLElement, doc: WechatLayoutDocument, bindings: WechatBlockBinding[], input?: unknown): {notice?: string} {
  let plan = themePlan(doc, "default"), notice: string | undefined;
  if (input !== undefined) {
    try { plan = validateWechatLayout(input, doc); }
    catch (error) {
      try { const rebased = rebaseWechatLayout(input, doc); plan = rebased.plan; notice = rebased.notice; }
      catch { notice = `${(error as Error).message}；本次使用默认排版，请重新规划并确认。`; }
    }
  }
  const before = contentFingerprint(root);
  const styles = themeStyles(plan.theme, plan.accentColor);
  for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
    const tag = el.tagName.toLowerCase();
    el.removeAttribute("style");
    // Block wrappers inherit the article style; only the outer section needs it.
    const style = el === root ? styles.section : tag === "section" ? undefined : styles[tag];
    if (style) el.setAttribute("style", style);
    if (tag === "pre") el.style.whiteSpace = "normal";
    if (tag === "code" && el.closest("pre")) el.setAttribute("style", "font-family:monospace;font-size:13px;line-height:1.7;white-space:normal;background:transparent;");
    if (tag === "span" && el.parentElement?.tagName === "CODE" && el.closest("pre")) el.setAttribute("style", "white-space:pre-wrap!important;overflow-wrap:anywhere;");
  }
  const bindingsById = new Map(bindings.map(binding => [binding.id, binding]));
  for (const instruction of plan.blocks) {
    const binding = bindingsById.get(instruction.id);
    if (!binding) throw new Error("区块与正文映射失效，已停止排版");
    const style = componentStyle(instruction.component, plan.accentColor, plan.theme);
    const child = binding.element.firstElementChild as HTMLElement | null;
    // Existing quotes already have a semantic wrapper; avoid a double border.
    const target = instruction.component === "quote" && child?.tagName === "BLOCKQUOTE" ? child : binding.element;
    if (style) {
      target.setAttribute("style", style);
      const last = target.lastElementChild as HTMLElement | null;
      if (last && ["P", "UL", "OL"].includes(last.tagName)) last.style.marginBottom = "0";
      if (instruction.component === "intro") for (const paragraph of Array.from(target.children).filter(el => el.tagName === "P") as HTMLElement[]) {
        paragraph.style.fontSize = target.style.fontSize || "18px"; paragraph.style.lineHeight = target.style.lineHeight || "1.9";
      }
    }
  }
  if (contentFingerprint(root) !== before) throw new Error("排版内容完整性校验失败");
  return {notice};
}
