import { App, Modal, Setting } from "obsidian";
import { PLATFORMS, Platform, PublishDirectoryReport } from "../types";

export class PublishDirectoryModal extends Modal {
  private generation = 0;
  constructor(app: App, private inspect: (platform: Platform, cancelled: () => boolean) => Promise<PublishDirectoryReport>) {
    super(app);
  }
  onOpen(): void {
    const el = this.contentEl;
    el.empty();
    el.createEl("h2", { text: "检查发布目录" });
    el.createEl("p", { text: "只检查所选平台的发布目录及子目录。Hexo 包括文章和草稿；检查不会改写稿件、补齐 ID 或触发发布。" });
    let platform = PLATFORMS[0];
    const selection = new Setting(el).setName("平台").addDropdown(control => {
      for (const item of PLATFORMS) control.addOption(item.id, item.name);
      control.setValue(platform.id).onChange(id => {
        platform = PLATFORMS.find(item => item.id === id)!;
        results.empty();
        status.setText(`已切换到${platform.name}，请重新检查。`);
      });
    });
    const status = el.createDiv({ attr: { role: "status", "aria-live": "polite" } });
    const results = el.createDiv();
    new Setting(el).addButton(button => button.setButtonText("开始检查").setCta().onClick(async () => {
      const generation = ++this.generation;
      const cancelled = () => generation !== this.generation;
      button.setDisabled(true);
      selection.settingEl.querySelectorAll("select").forEach(control => { control.disabled = true; });
      status.setText(`正在检查${platform.name}…`);
      results.empty();
      try {
        const report = await this.inspect(platform, cancelled);
        if (cancelled()) return;
        status.setText(`已检查 ${report.checked} 份稿件，发现 ${report.issues.length} 项需核对的问题。`);
        if (!report.checked) results.createEl("p", { text: "目录不存在或没有 Markdown 稿件，请核对平台目录设置。" });
        for (const issue of report.issues) {
          results.createEl("p", { text: issue.message });
          const list = results.createEl("ul");
          for (const path of issue.paths) list.createEl("li", { text: path });
        }
        results.createEl("p", { text: "结果仅反映本次读取，不代替发布前的身份检查。修复元数据前建议先另存副本。关闭此窗口即可停止后续检查。" });
      } catch (error) {
        if (!cancelled()) status.setText(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled()) {
          button.setDisabled(false);
          selection.settingEl.querySelectorAll("select").forEach(control => { control.disabled = false; });
        }
      }
    }));
  }
  onClose(): void { this.generation++; this.contentEl.empty(); }
}
