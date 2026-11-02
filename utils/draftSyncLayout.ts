import type { WechatLayoutDocument } from "../types";
import { extractWechatBlocks } from "./wechatLayoutAst";
import { rebaseWechatLayout } from "./wechatLayoutEngine";

const layoutDoc = (body: string): WechatLayoutDocument => {
  const doc = extractWechatBlocks(body);
  return {hash:doc.hash, blocks:doc.blocks.map(block => ({...block, text:block.markdown, planningText:""}))};
};

/** Keep local layout metadata aligned with an explicitly approved body edit. */
export function preserveSyncedWechatLayout(before: string, after: string, data: Record<string,any>): {data:Record<string,any>;notice?:string} {
  if (!data.wechat?.layout || before === after) return {data};
  try {
    const result = rebaseWechatLayout(data.wechat.layout, layoutDoc(after), layoutDoc(before));
    return {data:{...data, wechat:{...data.wechat, layout:result.plan,
      layoutHistory:[...(Array.isArray(data.wechat.layoutHistory) ? data.wechat.layoutHistory : []), data.wechat.layout].slice(-5)}}, notice:result.notice};
  } catch { return {data, notice:"原排版方案无效，已保留原设置；请在公众号工作台重新确认排版。"}; }
}
