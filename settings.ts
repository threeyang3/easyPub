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
    containerEl.addClass("easy-pub-settings");

    new Setting(containerEl).setName("EasyPub").setHeading();
    containerEl.createEl("p", { text: "按需要配置使用的平台。公众号账号通过向导保存；其余设置修改后自动保存。", cls: "ep-settings-intro" });
    new Setting(containerEl).setName("Hexo").setHeading();
    new Setting(containerEl)
      .setName("Hexo 仓库路径")
      .setDesc("Hexo 博客根目录的绝对路径，例如 E:\\Blog 或 /home/user/blog")
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

    new Setting(containerEl).setName("本地发布稿").setHeading();
    new Setting(containerEl)
      .setName("发布根目录")
      .setDesc("知乎、微信公众号、小红书的本地稿目录，相对于 Vault 根目录")
      .addText((text) =>
        text
          .setPlaceholder("发布")
          .setValue(this.plugin.settings.publishBasePath)
          .onChange(async (value) => {
            this.plugin.settings.publishBasePath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("微信公众号").setHeading();
    new Setting(containerEl).setName(this.plugin.hasWechatCredentials() ? "管理公众号账号" : "连接公众号")
      .setDesc(this.plugin.hasWechatCredentials() ? `当前 AppID：${this.plugin.settings.wechat.appId}。通过向导检查连接或更换账号，确认保存后生效。` : "准备账号 → 保存凭据 → 检查连接；需要 AppID、AppSecret 和 API IP 白名单。")
      .addButton(button => button.setButtonText("引导配置公众号").setCta().onClick(() => this.plugin.openWechatSetup(() => this.display())));
    new Setting(containerEl).setName("默认作者").setDesc("仅用于尚未设置作者的公众号本地稿")
      .addText(text => text.setValue(this.plugin.settings.wechat.defaultAuthor).onChange(async value => {
        this.plugin.settings.wechat.defaultAuthor = value;
        await this.plugin.saveSettings();
      }));
    const connection = new Setting(containerEl).setName("公众号连接检查")
      .setDesc("检查令牌、素材读取和草稿读取；不会上传图片或创建草稿。需配置出口 IP 白名单。")
      .addButton(button => button.setButtonText("检查连接").onClick(async () => {
        button.setDisabled(true);
        try { connection.setDesc((await this.plugin.getWechatApi().checkConnection()).join("；")); }
        catch (error) { connection.setDesc((error as Error).message); }
        finally { button.setDisabled(false); }
      }));

    new Setting(containerEl).setName("图片").setHeading();
    new Setting(containerEl)
      .setName("本地图片处理")
      .setDesc("Hexo、知乎、小红书的图片设置；微信公众号使用独立的微信素材上传流程")
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
