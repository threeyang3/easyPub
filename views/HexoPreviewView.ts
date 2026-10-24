import { ItemView, WorkspaceLeaf } from "obsidian";

export const HEXO_PREVIEW_VIEW = "easy-pub-hexo-preview";

export function validateHexoPreviewUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("后台返回的预览地址无效");
  const url = new URL(value);
  if (url.origin !== "http://127.0.0.1:5001" || !/^\/posts\/[a-f0-9]{4}\/$/i.test(url.pathname)
    || url.username || url.password || url.search || url.hash) throw new Error("后台返回了不受信任的预览地址");
  return url.href;
}

export class HexoPreviewView extends ItemView {
  constructor(leaf: WorkspaceLeaf) { super(leaf); }
  getViewType() { return HEXO_PREVIEW_VIEW; }
  getDisplayText() { return "Hexo 发布预览"; }
  getIcon() { return "eye"; }

  showArticle(value: unknown, title: string) {
    const articleUrl = validateHexoPreviewUrl(value);
    const container = this.contentEl;
    container.empty(); container.addClass("easy-pub-hexo-preview");
    container.createEl("h3", { text: title });
    container.createEl("p", { text: "显示博客中已保存的稿件，不会发布上线。源稿修改后请先通过 EasyPub 更新 Hexo 稿件，再刷新预览。" });
    const buttons = container.createDiv({ cls: "eph-preview-actions" });
    const stage = container.createDiv({ cls: "eph-preview-stage" });
    const frame = stage.createEl("iframe");
    frame.setAttribute("title", "Hexo 真实主题预览");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.src = articleUrl;
    const button = (text: string, action: () => void) => buttons.createEl("button", { text }).addEventListener("click", action);
    button("文章页面", () => { frame.src = articleUrl; });
    button("首页封面", () => { frame.src = "http://127.0.0.1:5001/"; });
    button("手机 / 桌面", () => stage.toggleClass("is-mobile", !stage.hasClass("is-mobile")));
    button("刷新", () => { frame.src = frame.src; });
    container.createEl("small", { text: "文章顶部图由 top_img、cover 和主题默认设置决定；首页可查看封面。本地主题预览不包含加密文章，需保持后台运行。" });
  }
}
