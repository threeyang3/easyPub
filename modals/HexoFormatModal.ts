import { App, Modal } from "obsidian";
import { HexoFormatResult } from "../utils/hexoFormatting";

export class HexoFormatModal extends Modal {
  private closed = false;
  constructor(app: App, private target: string, private before: string, private result: HexoFormatResult,
    private apply: (assertActive: () => void) => Promise<void>) { super(app); }
  onOpen() {
    this.closed = false;
    this.modalEl.addClass("easy-pub-format-modal");
    this.contentEl.createEl("h2", { text: "排版 Hexo 发布稿" });
    this.contentEl.createEl("p", { text: this.target, cls: "ep-panel-path" });
    this.contentEl.createEl("p", { text: `增加 ${this.result.addedBreaks} 处段落空行，清理 ${this.result.trimmedLines} 行末尾空格，并清理文末空行。保存前自动备份。` });
    this.contentEl.createEl("p", { text: "换行规则：普通正文的软换行和显式硬换行（两个尾随空格或反斜杠）都会转换为空行分段。请核对下方结果。" });
    const grid = this.contentEl.createDiv({ cls: "ep-format-comparison" });
    for (const [title, text] of [["当前内容", this.before], ["排版结果", this.result.content]]) {
      const section = grid.createDiv(); section.createEl("h3", { text: title }); section.createEl("pre", { text });
    }
    const status = this.contentEl.createEl("p", { attr: { role: "status" } });
    const actions = this.contentEl.createDiv({ cls: "ep-panel-actions" });
    actions.createEl("button", { text: "取消" }).onclick = () => this.close();
    const save = actions.createEl("button", { text: "应用排版", cls: "mod-cta" });
    save.onclick = async () => {
      if (save.disabled || this.closed) return;
      save.disabled = true;
      try { await this.apply(() => { if (this.closed) throw new Error("排版窗口已关闭，已取消保存"); }); if (!this.closed) this.close(); }
      catch (error) { if (!this.closed) { status.textContent = (error as Error).message; save.disabled = false; } }
    };
  }
  onClose() { this.closed = true; this.contentEl.empty(); }
}
