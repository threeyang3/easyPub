import { App, Modal, Setting } from "obsidian";
import { PubIdBatchResult } from "../utils/batchPubIds";

export class BatchPubIdModal extends Modal {
  private locationType: "vault" | "external" = "vault";
  private folder: string;
  private running = false;
  constructor(app: App, initialFolder: string,
    private run: (scope: "vault" | "external", folder: string) => Promise<PubIdBatchResult>) {
    super(app);
    this.folder = initialFolder;
  }
  onOpen() {
    const el = this.contentEl;
    el.empty();
    el.addClass("easy-pub-batch-modal");
    el.createEl("h2", { text: "批量补齐 pub_id" });
    el.createEl("p", { text: "递归处理文件夹中的 Markdown，只补齐缺失或空的 pub_id。已有 ID 保留；不自动关联旧发布稿，也不发布或部署。外部文件的 Front Matter 排版可能调整。" });
    new Setting(el).setName("位置").addDropdown(dropdown => dropdown
      .addOption("vault", "Obsidian Vault 文件夹").addOption("external", "外部文件夹（如 Hexo source）")
      .onChange(value => { this.locationType = value === "external" ? "external" : "vault"; }));
    new Setting(el).setName("文件夹路径").setDesc("Vault 使用相对路径，/ 表示整个 Vault；外部文件夹使用绝对路径。包含子文件夹。")
      .addText(text => text.setValue(this.folder).onChange(value => { this.folder = value; }));
    const status = el.createDiv({ attr: { role: "status", "aria-live": "polite" } });
    new Setting(el).addButton(button => button.setButtonText("补齐缺失 ID").setCta().onClick(async () => {
      if (this.running) return;
      this.running = true;
      button.setDisabled(true);
      el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select").forEach(control => { control.disabled = true; });
      status.setText("正在处理…");
      try {
        const result = await this.run(this.locationType, this.folder);
        status.setText(`新增 ${result.added}，保留/跳过 ${result.skipped}，失败 ${result.failures.length}。`);
        for (const failure of result.failures) status.createEl("p", { text: `${failure.path}：${failure.message}` });
      } catch (error) {
        status.setText(error instanceof Error ? error.message : String(error));
      } finally {
        this.running = false; button.setDisabled(false);
        el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select").forEach(control => { control.disabled = false; });
      }
    }));
  }
}
