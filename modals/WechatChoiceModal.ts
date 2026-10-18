import { App, Modal, Setting } from "obsidian";
import { renderWechatComparison, WechatComparison } from "../utils/wechatComparison";

export class WechatChoiceModal extends Modal {
  private settled = false;
  constructor(app: App, private title: string, private details: string,
    private choices: Array<{ label: string; value: string }>, private answer: (value: string) => void,
    private comparison?: WechatComparison[]) { super(app); }
  onOpen() {
    this.contentEl.addClass("easy-pub-wechat-dialog");
    this.contentEl.createEl("h2", { text: this.title });
    if (this.comparison) renderWechatComparison(this.contentEl, this.comparison);
    const raw = this.contentEl.createEl("details"); raw.open = !this.comparison;
    raw.createEl("summary", { text: "完整内容与说明" });
    raw.createEl("pre", { text: this.details, cls: "easy-pub-wechat-details" });
    const setting = new Setting(this.contentEl);
    setting.addButton(button => button.setButtonText("取消").onClick(() => this.respond("cancel")));
    const list = this.contentEl.createDiv({ cls: "easy-pub-wechat-choices" });
    for (const choice of this.choices) {
      const button = list.createEl("button", { text: choice.label });
      button.addEventListener("click", () => this.respond(choice.value));
    }
  }
  private respond(value: string) { if (this.settled) return; this.settled = true; this.close(); this.answer(value); }
  onClose() { if (!this.settled) { this.settled = true; this.answer("cancel"); } this.contentEl.empty(); }
}
export function wechatChoice(app: App, title: string, details: string, choices: Array<{ label: string; value: string }>, comparison?: WechatComparison[]): Promise<string> {
  return new Promise(resolve => new WechatChoiceModal(app, title, details, choices, resolve, comparison).open());
}
