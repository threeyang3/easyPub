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

    new Setting(containerEl)
      .setName("博客管理后台")
      .setDesc("打开兼容的 Blog Control Room；后台已运行时会安全复用当前本机会话")
      .addButton((button) =>
        button
          .setButtonText("打开管理后台")
          .setCta()
          .onClick(async () => {
            await this.plugin.openHexoControlRoom();
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

    new Setting(containerEl).setName("图片").setHeading();
    new Setting(containerEl)
      .setName("本地图片处理")
      .setDesc("默认复制到 Hexo；也可以交给 PicGo 上传并写入网络链接")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("local", "平台默认")
          .addOption("picgo", "上传到 PicGo")
          .setValue(this.plugin.settings.imageHandling)
          .onChange(async (value) => {
            this.plugin.settings.imageHandling = value === "picgo" ? "picgo" : "local";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.imageHandling === "picgo") {
      new Setting(containerEl)
        .setName("PicGo Server 地址")
        .setDesc("PicGo 默认地址为 http://127.0.0.1:36677/upload")
        .addText((text) =>
          text
            .setPlaceholder("http://127.0.0.1:36677/upload")
            .setValue(this.plugin.settings.picgoServerUrl)
            .onChange(async (value) => {
              this.plugin.settings.picgoServerUrl = value.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("PicGo Server Secret")
        .setDesc("可选；仅在 PicGo Server 启用了认证时填写")
        .addText((text) => {
          text.inputEl.type = "password";
          text
            .setPlaceholder("留空表示不使用认证")
            .setValue(this.plugin.settings.picgoServerSecret)
            .onChange(async (value) => {
              this.plugin.settings.picgoServerSecret = value;
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName("连接检查")
        .setDesc("确认 PicGo 已启动并开启 Server")
        .addButton((button) =>
          button
            .setButtonText("测试连接")
            .onClick(async () => {
              await this.plugin.testPicGoConnection();
            })
        );
    }

    new Setting(containerEl).setName("部署").setHeading();
    new Setting(containerEl)
      .setName("自动部署")
      .setDesc("普通 Hexo 仓库会自动部署；启用 Blog Control Room 的仓库会改为打开受保护的发布流程")
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
