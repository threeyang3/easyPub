import { App, Modal, Setting, Notice } from "obsidian";
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

    contentEl.createEl("h2", {
      text: this.diff.isNew ? "New Article" : "Article Changed",
    });

    contentEl.createEl("p", {
      text: `Title: ${this.diff.meta.title || "Untitled"}`,
    });

    if (!this.diff.isNew && this.diff.targetContent) {
      this.renderDiff(contentEl);
    } else {
      contentEl.createEl("p", {
        text: "This is a new article. It will be copied to the publish path for editing.",
      });
    }

    // Buttons
    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Cancel")
          .onClick(() => {
            this.close();
            this.onConfirm(false);
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Continue to Edit")
          .setCta()
          .onClick(() => {
            this.close();
            this.onConfirm(true);
          })
      );
  }

  renderDiff(contentEl: HTMLElement) {
    const container = contentEl.createDiv({ cls: "diff-container" });
    container.style.cssText = "max-height: 400px; overflow-y: auto; margin: 10px 0; padding: 10px; background: var(--background-secondary); border-radius: 5px;";

    const sourceParsed = parseFrontMatter(this.diff.sourceContent);
    const targetParsed = parseFrontMatter(this.diff.targetContent!);

    // Front Matter comparison
    const fmContainer = container.createDiv();
    fmContainer.createEl("h4", { text: "Front Matter Changes" });

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
      fmContainer.createEl("p", { text: "No front matter changes" });
    }

    // Content comparison
    const contentContainer = container.createDiv();
    contentContainer.createEl("h4", { text: "Content Preview" });

    const sourceLines = sourceParsed.content.split("\n");
    const targetLines = targetParsed.content.split("\n");

    const preview = contentContainer.createDiv({
      cls: "content-preview",
    });
    preview.style.cssText = "font-family: monospace; white-space: pre-wrap; font-size: 12px;";

    const maxLines = Math.max(sourceLines.length, targetLines.length);
    const displayLines = Math.min(maxLines, 50);

    for (let i = 0; i < displayLines; i++) {
      const sourceLine = sourceLines[i] || "";
      const targetLine = targetLines[i] || "";

      if (sourceLine !== targetLine) {
        const lineDiv = preview.createDiv();
        lineDiv.style.cssText = "background: var(--text-error); opacity: 0.3; margin: 2px 0; padding: 2px;";
        lineDiv.setText(`- ${targetLine}`);
        const newLineDiv = preview.createDiv();
        newLineDiv.style.cssText = "background: var(--text-success); opacity: 0.3; margin: 2px 0; padding: 2px;";
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
