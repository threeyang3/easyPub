import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type EasyPub from "./main";
import { PublishBackupsModal } from "./modals/PublishBackupsModal";
import { backupGitMessage, inspectPublishBackups } from "./utils/publishBackups";

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

    const backups = new Setting(containerEl).setName("发布历史备份")
      .setDesc("覆盖 Hexo 稿件前保留全文备份，可能包含未公开内容。不会自动清理。")
      .addButton(button => button.setButtonText("查看备份").onClick(() => new PublishBackupsModal(this.app, this.plugin.settings.hexoRepoPath).open()))
      .addButton(button => button.setButtonText("检查备份").onClick(async () => {
        const repository = this.plugin.settings.hexoRepoPath;
        button.setDisabled(true);
        try {
          const status = await inspectPublishBackups(repository);
          if (repository !== this.plugin.settings.hexoRepoPath || !containerEl.contains(backups.settingEl)) return;
          backups.setDesc(`${status.directory}；${status.count} 份备份，共 ${status.bytes.toLocaleString()} 字节。${backupGitMessage(status.git)} 恢复或清理前请停止发布，打开 .bak 核对原文，另存需要保留的副本后再手动处理。`);
        } catch (error) { backups.setDesc(`无法检查备份：${(error as Error).message}`); }
        finally { button.setDisabled(false); }
      }));

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
      .setDesc("PicGo 为可选功能。平台默认模式无需安装或启动 PicGo，也不会检查其连接。微信公众号始终使用独立上传流程。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("local", "平台默认")
          .addOption("picgo", "上传到 PicGo")
          .setValue(this.plugin.settings.imageHandling)
          .onChange(async (value) => {
            this.plugin.settings.imageHandling = value === "picgo" ? "picgo" : "local";
            await this.plugin.initializePicGoCredentials();
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.imageHandling === "picgo") {
      new Setting(containerEl)
        .setName("PicGo Server 地址")
        .setDesc("默认 http://127.0.0.1:36677/upload。远程 Server 配合 Secret 时请使用 HTTPS；非回环 HTTP 会明文传输密钥。")
        .addText((text) =>
          text
            .setPlaceholder("http://127.0.0.1:36677/upload")
            .setValue(this.plugin.settings.picgoServerUrl)
            .onChange(async (value) => {
              this.plugin.settings.picgoServerUrl = value.trim();
              await this.plugin.saveSettings();
            })
        );

      const secretSetting = new Setting(containerEl)
        .setName("PicGo Server Secret")
        .setDesc("可选；使用系统加密保存，加密不可用时仅本次会话有效。" + (this.plugin.settings.picgoEncryptedSecret && !this.plugin.settings.picgoServerSecret ? "已保存的密钥无法解密，请重新填写。" : this.plugin.settings.picgoServerSecret && !this.plugin.settings.picgoEncryptedSecret ? "当前密钥仅在本次会话保留。" : "") + "修改将替换原密钥。")
        .addText((text) => {
          text.inputEl.type = "password";
          text
            .setPlaceholder("留空表示不使用认证")
            .setValue(this.plugin.settings.picgoServerSecret)
            .onChange(async (value) => {
              this.plugin.settings.picgoServerSecret = value;
              this.plugin.settings.picgoEncryptedSecret = "";
              try {
                await this.plugin.saveSettings();
                secretSetting.setDesc(this.plugin.settings.picgoServerSecret
                  ? this.plugin.settings.picgoEncryptedSecret ? "密钥已使用系统加密保存。修改或清除将替换原密钥。" : "系统加密不可用：密钥仅本次会话有效，重启后需重新填写。"
                  : "未设置密钥；仅在 PicGo Server 启用了认证时填写。");
              }
              catch { new Notice("PicGo 密钥保存失败，请重新填写并保存。", 8000); }
            });
        })
        .addButton(button => button.setButtonText("清除密钥").onClick(async () => {
          this.plugin.settings.picgoServerSecret = "";
          this.plugin.settings.picgoEncryptedSecret = "";
          try { await this.plugin.saveSettings(); this.display(); }
          catch { new Notice("清除密钥保存失败，请重试。", 8000); }
        }));

      new Setting(containerEl)
        .setName("服务可达性检查")
        .setDesc("仅检查心跳接口，不验证 Secret、上传权限或图床配置，也不会上传图片")
        .addButton((button) =>
          button
            .setButtonText("检测服务可达性")
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
