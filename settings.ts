import { App, PluginSettingTab, Setting } from "obsidian";
import type EasyPub from "./main";

export class EasyPubSettingTab extends PluginSettingTab {
  plugin: EasyPub;

  constructor(app: App, plugin: EasyPub) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("EasyPub").setHeading();
    new Setting(containerEl).setName("Hexo").setHeading();
    new Setting(containerEl)
      .setName("Hexo 仓库路径")
      .setDesc("Hexo 博客根目录的绝对路径，例如 /path/to/blog")
      .addText((text) =>
        text
          .setPlaceholder("/path/to/blog")
          .setValue(this.plugin.settings.hexoRepoPath)
          .onChange(async (value) => {
            this.plugin.settings.hexoRepoPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("其他平台").setHeading();
    new Setting(containerEl)
      .setName("发布根目录")
      .setDesc("其他平台的发布目录，相对于 Vault 根目录")
      .addText((text) =>
        text
          .setPlaceholder("发布")
          .setValue(this.plugin.settings.publishBasePath)
          .onChange(async (value) => {
            this.plugin.settings.publishBasePath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("通用").setHeading();
    new Setting(containerEl)
      .setName("写作目录")
      .setDesc("写作目录路径，相对于 Vault 根目录")
      .addText((text) =>
        text
          .setPlaceholder("articles")
          .setValue(this.plugin.settings.writingPath)
          .onChange(async (value) => {
            this.plugin.settings.writingPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("自动部署")
      .setDesc("发布到 Hexo 后自动执行部署")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoDeploy)
          .onChange(async (value) => {
            this.plugin.settings.autoDeploy = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
