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

    new Setting(containerEl).setName("微信公众号").setHeading();
    new Setting(containerEl).setName("首次配置向导").setDesc("准备账号 → 保存凭据 → 检查连接；也可用于更换账号")
      .addButton(button => button.setButtonText("引导配置公众号").setCta().onClick(() => this.plugin.openWechatSetup(() => this.display())));
    new Setting(containerEl).setName("AppID").setDesc("单个公众号；切换账号后素材缓存与草稿关联自动隔离")
      .addText(text => text.setValue(this.plugin.settings.wechat.appId).onChange(async value => {
        await this.plugin.setWechatAppId(value.trim());
      }));
    new Setting(containerEl).setName("AppSecret")
      .setDesc("点击保存后使用系统加密保存；系统加密不可用时仅在本次会话有效。不会显示已保存的密钥。")
      .addText(text => {
        text.inputEl.type = "password";
        text.setPlaceholder(this.plugin.settings.wechat.encryptedSecret ? "已加密保存；输入新值替换" : "输入 AppSecret");
        text.inputEl.autocomplete = "off";
        new Setting(containerEl).setName("保存密钥").addButton(button => button.setButtonText("保存 AppSecret").onClick(async () => {
          if (!text.getValue().trim()) return;
          try {
            const persisted = await this.plugin.setWechatSecret(text.getValue().trim());
            text.setValue("");
            text.setPlaceholder(persisted ? "已加密保存" : "本次会话已保存，重启后需重新输入");
          } catch { text.setPlaceholder("密钥保存失败，请重试"); }
        }));
      });
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
