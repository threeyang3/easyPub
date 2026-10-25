import { WechatLayoutDocument, WechatLayoutPlan } from "../types";
import { applyWechatLayout } from "./wechatLayoutEngine";
import { assertWechatHtmlLimit } from "./wechatLimits";

export function layoutPreview(html: string, doc: WechatLayoutDocument, plan: WechatLayoutPlan): string {
  const root = new DOMParser().parseFromString(html, "text/html").body.firstElementChild as HTMLElement;
  if (!root) throw new Error("正文预览不可用");
  const wrappers = Array.from(root.children).filter(el => el.tagName === "SECTION") as HTMLElement[];
  if (doc.blocks.length && wrappers.length !== doc.blocks.length) throw new Error("正文区块映射失效，请重新打开排版窗口");
  applyWechatLayout(root, doc, doc.blocks.map((block, i) => ({id: block.id, element: wrappers[i]})), plan);
  const result = root.outerHTML;
  assertWechatHtmlLimit(result);
  return result;
}

