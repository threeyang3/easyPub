import { App, Modal, Setting } from "obsidian";
import { Platform } from "../types";

export class PlatformSelectModal extends Modal {
  private platforms: Platform[];
  private onSelect: (platform: Platform | null) => void;

  constructor(app: App, platforms: Platform[], onSelect: (platform: Platform | null) => void, private refreshProperties = false) {
    super(app);
    this.platforms = platforms;
    this.onSelect = onSelect;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: this.refreshProperties ? "选择要刷新属性的平台稿" : "选择发布平台" });
    contentEl.addClass("easy-pub-platform-modal");
    contentEl.createEl("p", { text: this.refreshProperties ? "从当前原稿定位已有平台稿，再选择属性并预览变更。" : "首次生成时设置该平台属性；更新正文时保留平台稿设置。微信公众号最终发布在微信后台完成。" });

    for (const platform of this.platforms) {
      new Setting(contentEl)
        .setName(platform.name)
        .setDesc(platform.isExternal ? "保存到 Hexo 仓库；后续构建与部署按设置执行" : platform.id === "wechat" ? "打开已有本地成稿，或首次生成后进入预览工作台" : `生成或更新 ${platform.path} 本地稿，供后续编辑`)
        .addButton((btn) =>
          btn.setButtonText(this.refreshProperties ? "选择稿件" : platform.id === "wechat" ? "打开工作台" : "准备稿件").onClick(() => {
            this.close();
            this.onSelect(platform);
          })
        );
    }

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("取消").onClick(() => {
        this.close();
        this.onSelect(null);
      })
    );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
