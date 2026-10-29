import { App, Modal } from "obsidian";
import type { ArticleDiff } from "../types";
import { DiffModal } from "./DiffModal";

/** Waits for a concrete, guarded write; cancel/close never creates a draft. */
export class WechatHexoModal extends Modal {
  private closed = false;
  private saved = false;
  constructor(app: App, private diff: ArticleDiff, private preview: string,
    private apply: (assertActive: () => void) => Promise<void>, private done: (saved: boolean) => void) { super(app); }
  onOpen() {
    this.contentEl.addClass("easy-pub-wechat-dialog");
    this.contentEl.createEl("h2", {text: "由公众号稿生成 Hexo 稿"});
    this.contentEl.createEl("p", {text: `目标：${this.diff.targetPath}`});
    this.contentEl.createEl("p", {text: this.diff.isNew ? "将新建 Hexo 草稿，保留当前公众号预览的字体、主题色、卡片、间距及图片。" : "同篇 Hexo 稿已存在，确认后更新其正文；保留博客网址、分类、标签及其他设置。保存前自动备份。"});
    this.contentEl.createEl("p", {text: "正文将保存为 HTML 排版。后续可继续在公众号稿中编辑并重新生成；博客的页面外框沿用博客主题。"});
    const preview = this.contentEl.createDiv({cls: "ep-wechat-hexo-preview"});
    preview.innerHTML = this.preview;
    const details = this.contentEl.createEl("details"); details.createEl("summary", {text:"查看元数据与正文差异"});
    if (this.diff.targetContent !== null) new DiffModal(this.app, this.diff, () => {}).renderDiff(details);
    else details.createEl("pre", {text:this.diff.sourceContent});
    const status = this.contentEl.createEl("p", {attr:{role:"status"}});
    const actions = this.contentEl.createDiv({cls:"ep-panel-actions"});
    actions.createEl("button", {text:"取消"}).onclick = () => this.close();
    const save = actions.createEl("button", {text:this.diff.isNew ? "确认生成 Hexo 草稿" : "确认更新 Hexo 稿",cls:"mod-cta"});
    save.onclick = async () => {
      if (save.disabled || this.closed) return;
      save.disabled = true;
      try {
        await this.apply(() => {if (this.closed) throw new Error("生成窗口已关闭，已取消写入");});
        this.saved = true; if (!this.closed) this.close();
      } catch (error) {if (!this.closed) {status.textContent = (error as Error).message; save.disabled = false;}}
    };
  }
  onClose() {this.closed = true; this.contentEl.empty(); this.done(this.saved);}
}
