import fs from "fs/promises";
import path from "path";
import { App, Modal, Notice, Plugin, TFile, Setting, normalizePath } from "obsidian";
import { EasyPubSettingTab } from "./settings";
import { DEFAULT_SETTINGS, PluginSettings, ArticleMeta, ArticleDiff, Platform, PLATFORMS } from "./types";
import { parseFrontMatter, stringifyFrontMatter, generatePubId } from "./utils/frontMatter";
import { deployHexo } from "./utils/hexoCommands";
import { DiffModal } from "./modals/DiffModal";
import { getPublishPath, getTargetPath, getSubFolder, createWikiLink } from "./utils/platforms";
import { generateHexoUrl } from "./utils/linkUtils";

export default class EasyPub extends Plugin {
  settings: PluginSettings;

  async onload() {
    await this.loadSettings();

    // 发布命令 - 显示平台选择
    this.addRibbonIcon("upload-cloud", "Publish", () => {
      this.showPlatformSelector();
    });

    this.addCommand({
      id: "publish",
      name: "Publish to platform",
      callback: () => this.showPlatformSelector(),
    });

    // Hexo 部署命令
    this.addCommand({
      id: "deploy-hexo",
      name: "Deploy to Hexo",
      callback: () => this.deployToHexo(),
    });

    this.addSettingTab(new EasyPubSettingTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  showPlatformSelector() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file");
      return;
    }

    new PlatformSelectModal(this.app, PLATFORMS, async (platform) => {
      if (platform) {
        await this.preparePublish(platform);
      }
    }).open();
  }

  async preparePublish(platform: Platform) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file");
      return;
    }

    // Hexo 需要检查路径配置
    if (platform.isExternal && !this.settings.hexoRepoPath) {
      new Notice("Please configure Hexo repo path in settings");
      return;
    }

    const content = await this.app.vault.read(activeFile);
    const parsed = parseFrontMatter(content);

    let pubId = parsed.data.pub_id;
    let isNew = true;
    let existingContent: string | null = null;
    let existingPath: string | null = null;

    if (pubId) {
      existingPath = await this.findArticleByPubId(platform, pubId, parsed.data);
      if (existingPath) {
        isNew = false;
        existingContent = await this.readPublishFile(platform, existingPath);
      }
    } else {
      pubId = generatePubId();
      parsed.data.pub_id = pubId;
    }

    const title = parsed.data.title || activeFile.basename;
    const subFolder = getSubFolder(platform, parsed.data);
    const targetPath = existingPath || getTargetPath(platform, this.settings, title, subFolder);

    const diff: ArticleDiff = {
      pub_id: pubId,
      sourcePath: activeFile.path,
      targetPath: targetPath,
      sourceContent: stringifyFrontMatter(parsed.content, parsed.data),
      targetContent: existingContent,
      isNew,
      meta: parsed.data as ArticleMeta,
      platform,
    };

    if (!isNew && existingContent) {
      new DiffModal(this.app, diff, async (confirmed) => {
        if (confirmed) {
          await this.copyAndOpenForEdit(diff, activeFile, parsed);
        }
      }).open();
    } else {
      await this.copyAndOpenForEdit(diff, activeFile, parsed);
    }
  }

  async findArticleByPubId(
    platform: Platform,
    pubId: string,
    meta: Record<string, any>
  ): Promise<string | null> {
    const subFolder = getSubFolder(platform, meta);

    // 先检查已知路径
    const title = meta.title;
    if (title) {
      const expectedPath = getTargetPath(platform, this.settings, title, subFolder);
      if (await this.publishPathExists(platform, expectedPath)) {
        const content = await this.readPublishFile(platform, expectedPath);
        const parsed = parseFrontMatter(content);
        if (parsed.data.pub_id === pubId) {
          return expectedPath;
        }
      }
    }

    // 搜索发布路径（包括所有子文件夹）
    const searchPaths: string[] = [];

    if (platform.hasSubFolders && platform.subFolders) {
      // 搜索所有子文件夹
      for (const sub of platform.subFolders) {
        searchPaths.push(getPublishPath(platform, this.settings, sub));
      }
    } else {
      searchPaths.push(getPublishPath(platform, this.settings, subFolder));
    }

    for (const publishPath of searchPaths) {
      try {
        const files = await this.listPublishFiles(platform, publishPath);
        for (const file of files) {
          if (file.endsWith(".md")) {
            const content = await this.readPublishFile(platform, file);
            const parsed = parseFrontMatter(content);
            if (parsed.data.pub_id === pubId) {
              return file;
            }
          }
        }
      } catch {
        // Directory may not exist
      }
    }
    return null;
  }

  async copyAndOpenForEdit(
    diff: ArticleDiff,
    sourceFile: TFile,
    parsed: { data: any; content: string }
  ) {
    const platform = diff.platform;

    // 保留原有创建日期
    if (!diff.isNew && diff.targetContent) {
      const existingParsed = parseFrontMatter(diff.targetContent);
      if (existingParsed.data.date) {
        parsed.data.date = existingParsed.data.date;
      }
      if (existingParsed.data.publish_url) {
        parsed.data.publish_url = existingParsed.data.publish_url;
      }
    }

    // 设置日期
    if (!parsed.data.date) {
      parsed.data.date = new Date().toISOString();
    }
    parsed.data.updated = new Date().toISOString();

    // 添加源文件链接
    parsed.data.source_file = createWikiLink(sourceFile.path);

    // Hexo 自动生成发布链接
    if (platform.autoUrl && platform.id === "hexo" && this.settings.hexoRepoPath) {
      const url = await generateHexoUrl(this.settings.hexoRepoPath, parsed.data);
      if (url) {
        parsed.data.publish_url = url;
      }
    } else if (!parsed.data.publish_url) {
      parsed.data.publish_url = "";
    }

    const finalContent = stringifyFrontMatter(parsed.content, parsed.data);

    // 确保发布目录存在
    const publishPath = getPublishPath(platform, this.settings, getSubFolder(platform, parsed.data));
    await this.ensurePublishDirectory(platform, publishPath);

    // 写入发布路径
    await this.writePublishFile(platform, diff.targetPath, finalContent);

    // 更新源文件的 pub_id 和子文件列表
    await this.updateSourceFile(sourceFile, parsed, diff.targetPath);

    new Notice(diff.isNew ? `Article copied to ${platform.name}` : `Article updated in ${platform.name}`);

    if (platform.id === "hexo" && this.settings.autoDeploy) {
      await this.deployToHexo();
    }

    // 打开发布路径中的文章供编辑
    await this.openPublishedFile(diff.targetPath, platform);
  }

  async updateSourceFile(
    sourceFile: TFile,
    parsed: { data: any; content: string },
    targetPath: string
  ) {
    // 更新 pub_id
    if (!parsed.data.pub_id) {
      parsed.data.pub_id = generatePubId();
    }

    // 更新子文件列表
    const wikiLink = createWikiLink(targetPath);
    if (!parsed.data.子文件) {
      parsed.data.子文件 = [];
    }
    if (!parsed.data.子文件.includes(wikiLink)) {
      parsed.data.子文件.push(wikiLink);
    }

    const updatedContent = stringifyFrontMatter(parsed.content, parsed.data);
    await this.app.vault.modify(sourceFile, updatedContent);
  }

  async openPublishedFile(filePath: string, platform: Platform) {
    if (platform.isExternal) {
      try {
        const electron = require("electron") as {
          shell?: { openPath(filePath: string): Promise<string> };
        };
        const error = await electron.shell?.openPath(filePath);
        new Notice(error ? `File saved to: ${filePath}` : "File opened. Edit and save.");
      } catch {
        new Notice(`File saved to: ${filePath}`);
      }
      return;
    }

    // 检查是否在 vault 内部
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      new Notice("Edit the article, then run 'Deploy to Hexo' if needed");
      return;
    }

    new Notice(`File saved to: ${filePath}`);
  }

  async publishPathExists(platform: Platform, filePath: string): Promise<boolean> {
    if (!platform.isExternal) {
      return this.app.vault.adapter.exists(filePath);
    }

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async readPublishFile(platform: Platform, filePath: string): Promise<string> {
    if (platform.isExternal) {
      return fs.readFile(filePath, "utf8");
    }
    return this.app.vault.adapter.read(filePath);
  }

  async writePublishFile(platform: Platform, filePath: string, content: string): Promise<void> {
    if (platform.isExternal) {
      await fs.writeFile(filePath, content, "utf8");
      return;
    }
    await this.app.vault.adapter.write(filePath, content);
  }

  async listPublishFiles(platform: Platform, directoryPath: string): Promise<string[]> {
    if (platform.isExternal) {
      const entries = await fs.readdir(directoryPath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(directoryPath, entry.name));
    }

    const files = await this.app.vault.adapter.list(directoryPath);
    return files.files;
  }

  async ensurePublishDirectory(platform: Platform, directoryPath: string): Promise<void> {
    if (platform.isExternal) {
      await fs.mkdir(directoryPath, { recursive: true });
      return;
    }

    const normalizedPath = normalizePath(directoryPath);
    const parts = normalizedPath.split("/").filter(Boolean);
    let currentPath = "";

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(currentPath))) {
        await this.app.vault.adapter.mkdir(currentPath);
      }
    }
  }

  async deployToHexo() {
    if (!this.settings.hexoRepoPath) {
      new Notice("Please configure Hexo repo path in settings");
      return;
    }

    new Notice("Deploying to Hexo...");
    try {
      await deployHexo(this.settings.hexoRepoPath);
      new Notice("Deployed successfully!");
    } catch (error) {
      new Notice(`Deploy failed: ${error}`);
    }
  }
}

class PlatformSelectModal extends Modal {
  private platforms: Platform[];
  private onSelect: (platform: Platform | null) => void;

  constructor(app: App, platforms: Platform[], onSelect: (platform: Platform | null) => void) {
    super(app);
    this.platforms = platforms;
    this.onSelect = onSelect;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "选择发布平台" });

    for (const platform of this.platforms) {
      new Setting(contentEl)
        .setName(platform.name)
        .setDesc(`发布到 ${platform.path}`)
        .addButton((btn) =>
          btn.setButtonText("发布").onClick(() => {
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
