import { App, Modal, Setting } from "obsidian";
import { ArticleDiff } from "../types";
import { parseFrontMatter } from "../utils/frontMatter";

export class DiffModal extends Modal {
  private diff: ArticleDiff;
  private onConfirm: (confirmed: boolean) => void;
  private hasResponded = false;

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
            this.respond(false);
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("继续编辑")
          .setCta()
          .onClick(() => {
            this.respond(true);
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
    contentContainer.createEl("h4", { text: "正文变更摘要" });

    const sourceLines = sourceParsed.content.split("\n");
    const targetLines = targetParsed.content.split("\n");

    const preview = contentContainer.createDiv({
      cls: "content-preview",
    });

    let prefixLength = 0;
    while (
      prefixLength < sourceLines.length
      && prefixLength < targetLines.length
      && sourceLines[prefixLength] === targetLines[prefixLength]
    ) {
      prefixLength++;
    }

    let suffixLength = 0;
    while (
      suffixLength < sourceLines.length - prefixLength
      && suffixLength < targetLines.length - prefixLength
      && sourceLines[sourceLines.length - 1 - suffixLength]
        === targetLines[targetLines.length - 1 - suffixLength]
    ) {
      suffixLength++;
    }

    const removedLines = targetLines.slice(prefixLength, targetLines.length - suffixLength);
    const addedLines = sourceLines.slice(prefixLength, sourceLines.length - suffixLength);
    const maxPreviewLines = 25;

    removedLines.slice(0, maxPreviewLines).forEach((line) => {
      const lineDiv = preview.createDiv({ cls: "content-preview-line is-removed" });
      lineDiv.setText(`- ${line}`);
    });
    addedLines.slice(0, maxPreviewLines).forEach((line) => {
      const lineDiv = preview.createDiv({ cls: "content-preview-line is-added" });
      lineDiv.setText(`+ ${line}`);
    });

    const hiddenLineCount = Math.max(0, removedLines.length - maxPreviewLines)
      + Math.max(0, addedLines.length - maxPreviewLines);
    if (hiddenLineCount > 0) {
      preview.createEl("p", { text: `另有 ${hiddenLineCount} 行变更未展开` });
    } else if (removedLines.length === 0 && addedLines.length === 0) {
      preview.createEl("p", { text: "正文无变更" });
    }
  }

  onClose() {
    if (!this.hasResponded) {
      this.hasResponded = true;
      this.onConfirm(false);
    }
    const { contentEl } = this;
    contentEl.empty();
  }

  private respond(confirmed: boolean) {
    if (this.hasResponded) {
      return;
    }
    this.hasResponded = true;
    this.close();
    this.onConfirm(confirmed);
  }
}
