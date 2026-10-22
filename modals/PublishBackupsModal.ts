import { App, Modal, Setting } from "obsidian";
import { listPublishBackups, readPublishBackup } from "../utils/publishBackups";
import { getPublishBackupDirectory } from "../utils/platforms";

export class PublishBackupsModal extends Modal {
  private generation = 0;
  constructor(app: App, private repository: string) { super(app); }
  onOpen(): void { void this.load(); }
  private async load(): Promise<void> {
    const generation = ++this.generation;
    const el = this.contentEl;
    el.empty();
    el.createEl("h2", { text: "历史备份（只读）" });
    const status = el.createDiv({ attr: { role: "status", "aria-live": "polite" } });
    status.setText("正在读取备份列表…");
    new Setting(el).addButton(button => button.setButtonText("刷新列表").onClick(() => { void this.load(); }));
    try {
      el.createEl("p", { text: getPublishBackupDirectory(this.repository) });
      el.createEl("p", { text: "时间为备份文件最后修改时间，不代表文章首次发布或每次备份时间。相同内容可能复用同一备份。查看后请另存副本核对，再自行决定如何恢复。" });
      const entries = await listPublishBackups(this.repository);
      if (generation !== this.generation) return;
      status.setText(`共 ${entries.length} 份备份，每页显示 20 份。`);
      const list = el.createDiv();
      const navigation = el.createDiv();
      const detail = el.createDiv();
      let page = 0;
      let selection = 0;
      const render = () => {
        selection++;
        list.empty(); navigation.empty(); detail.empty();
        if (!entries.length) list.createEl("p", { text: "暂无备份。覆盖已有 Hexo 稿件时才会生成备份。" });
        for (const entry of entries.slice(page * 20, (page + 1) * 20)) {
          new Setting(list).setName(`${new Date(entry.savedAt).toLocaleString()} · ${entry.bytes.toLocaleString()} 字节`)
            .setDesc(entry.path).addButton(button => button.setButtonText("查看原文与来源").onClick(async () => {
              const request = ++selection;
              detail.setText("正在读取备份…");
              try {
                const preview = await readPublishBackup(this.repository, entry.name);
                if (generation !== this.generation || request !== selection) return;
                detail.empty();
                detail.createEl("h3", { text: preview.title || "未记录标题" });
                detail.createEl("p", { text: `来源记录：${preview.source || "未记录，不能自动确定来源"}` });
                detail.createEl("p", { text: `pub_id：${preview.pubId || "未记录"}` });
                detail.createEl("p", { text: preview.hashMatches ? "内容与备份文件名的哈希一致。来源仅为历史记录，可能已移动或重命名。" : "内容与文件名的哈希不一致，备份可能已修改或损坏；请谨慎核对。" });
                if (!preview.metadataValid) detail.createEl("p", { text: "元数据无法解析，以下保留原始文本供核对。" });
                const text = detail.createEl("textarea", { attr: { readonly: "", rows: "14", "aria-label": "备份原文（只读）" } });
                text.value = preview.content;
                text.style.width = "100%";
              } catch (error) {
                if (generation === this.generation && request === selection) detail.setText(`无法查看：${(error as Error).message}`);
              }
            }));
        }
        new Setting(navigation).setName(`第 ${page + 1} / ${Math.max(1, Math.ceil(entries.length / 20))} 页`)
          .addButton(button => button.setButtonText("上一页").setDisabled(page === 0).onClick(() => { page--; render(); }))
          .addButton(button => button.setButtonText("下一页").setDisabled((page + 1) * 20 >= entries.length).onClick(() => { page++; render(); }));
      };
      render();
    } catch (error) {
      if (generation === this.generation) status.setText(`无法列出备份：${(error as Error).message}`);
    }
  }
  onClose(): void { this.generation++; this.contentEl.empty(); }
}
