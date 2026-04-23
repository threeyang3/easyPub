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

    containerEl.createEl("h2", { text: "EasyPub Settings" });

    // Hexo 配置
    containerEl.createEl("h3", { text: "Hexo" });
    new Setting(containerEl)
      .setName("Hexo Repo Path")
      .setDesc("Absolute path to your Hexo blog root directory (e.g. /path/to/blog)")
      .addText((text) =>
        text
          .setPlaceholder("/path/to/blog")
          .setValue(this.plugin.settings.hexoRepoPath)
          .onChange(async (value) => {
            this.plugin.settings.hexoRepoPath = value;
            await this.plugin.saveSettings();
          })
      );

    // 其他平台配置
    containerEl.createEl("h3", { text: "Other Platforms" });
    new Setting(containerEl)
      .setName("Publish Base Path")
      .setDesc("Base directory for other platforms (relative to vault root)")
      .addText((text) =>
        text
          .setPlaceholder("发布")
          .setValue(this.plugin.settings.publishBasePath)
          .onChange(async (value) => {
            this.plugin.settings.publishBasePath = value;
            await this.plugin.saveSettings();
          })
      );

    // 通用配置
    containerEl.createEl("h3", { text: "General" });
    new Setting(containerEl)
      .setName("Writing Path")
      .setDesc("Path to your writing directory (relative to vault root)")
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
      .setName("Auto Deploy")
      .setDesc("Automatically deploy to Hexo after publishing")
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
