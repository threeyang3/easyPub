import { App, Modal, Setting } from "obsidian";
import { ArticleDiff } from "../types";
import { parseFrontMatter } from "../utils/frontMatter";

export class DiffModal extends Modal {
  private diff: ArticleDiff;
  private onConfirm: (confirmed: boolean) => void;

  constructor(app: App, diff: ArticleDiff, onConfirm: (confirmed: boolean) => void) {
    super(app);
    this.diff = diff;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("easy-pub-diff-modal");

    contentEl.createEl("h2", {
      text: this.diff.isNew ? "新文章" : "文章有变更",
    });

    contentEl.createEl("p", {
      text: `标题：${this.diff.meta.title || "Untitled"}`,
    });

    if (!this.diff.isNew && this.diff.targetContent) {
      this.renderDiff(contentEl);
    } else {
      contentEl.createEl("p", {
        text: "这是新文章，将复制到目标发布路径并打开编辑。",
      });
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("取消")
          .onClick(() => {
            this.close();
            this.onConfirm(false);
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("继续编辑")
          .setCta()
          .onClick(() => {
            this.close();
            this.onConfirm(true);
          })
      );
  }

  renderDiff(contentEl: HTMLElement) {
    const container = contentEl.createDiv({ cls: "diff-container" });

    const sourceParsed = parseFrontMatter(this.diff.sourceContent);
    const targetParsed = parseFrontMatter(this.diff.targetContent!);

    const fmContainer = container.createDiv();
    fmContainer.createEl("h4", { text: "Front Matter 变更" });

    const changes: string[] = [];
    const keys = new Set([...Object.keys(sourceParsed.data), ...Object.keys(targetParsed.data)]);
    keys.forEach((key) => {
      const sourceVal = JSON.stringify(sourceParsed.data[key]);
      const targetVal = JSON.stringify(targetParsed.data[key]);
      if (sourceVal !== targetVal) {
        changes.push(`${key}: ${targetVal} → ${sourceVal}`);
      }
    });

    if (changes.length > 0) {
      const list = fmContainer.createEl("ul");
      changes.forEach((change) => {
        list.createEl("li", { text: change });
      });
    } else {
      fmContainer.createEl("p", { text: "Front Matter 无变更" });
    }

    const contentContainer = container.createDiv();
    contentContainer.createEl("h4", { text: "正文预览" });

    const sourceLines = sourceParsed.content.split("\n");
    const targetLines = targetParsed.content.split("\n");

    const preview = contentContainer.createDiv({
      cls: "content-preview",
    });

    const maxLines = Math.max(sourceLines.length, targetLines.length);
    const displayLines = Math.min(maxLines, 50);

    for (let i = 0; i < displayLines; i++) {
      const sourceLine = sourceLines[i] || "";
      const targetLine = targetLines[i] || "";

      if (sourceLine !== targetLine) {
        const lineDiv = preview.createDiv({ cls: "content-preview-line is-removed" });
        lineDiv.setText(`- ${targetLine}`);
        const newLineDiv = preview.createDiv({ cls: "content-preview-line is-added" });
        newLineDiv.setText(`+ ${sourceLine}`);
      }
    }

    if (maxLines > 50) {
      preview.createEl("p", { text: `... (${maxLines - 50} more lines)` });
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
