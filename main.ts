import fs from "fs/promises";
import path from "path";
import { App, Modal, Notice, Plugin, Setting, TFile, TFolder, normalizePath } from "obsidian";
import { EasyPubSettingTab } from "./settings";
import { DEFAULT_SETTINGS, PluginSettings, ArticleMeta, ArticleDiff, Platform, PLATFORMS, FrontMatterData, ParsedFrontMatter } from "./types";
import {
  parseFrontMatter,
  stringifyFrontMatter,
  generatePubId,
  getFrontMatterString,
  mergePublishedFrontMatter,
  mergeSourceFrontMatter,
} from "./utils/frontMatter";
import { deployHexo } from "./utils/hexoCommands";
import { DiffModal } from "./modals/DiffModal";
import {
  getPublishPath,
  getTargetPath,
  getSubFolder,
  createWikiLink,
  formatChildReference,
  getObsoleteChildReferences,
  getTargetDirectory,
} from "./utils/platforms";
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
    const sourceParsed = parseFrontMatter(content);

    let pubId = getFrontMatterString(sourceParsed.data, "pub_id");
    let isNew = true;
    let existingContent: string | null = null;
    let existingPath: string | null = null;

    if (pubId) {
      existingPath = await this.findArticleByPubId(platform, pubId, sourceParsed.data);
      if (existingPath) {
        isNew = false;
        existingContent = await this.readPublishFile(platform, existingPath);
      }
    } else {
      pubId = generatePubId();
    }

    const sourceDataWithPubId: FrontMatterData = {
      ...sourceParsed.data,
      pub_id: pubId,
    };
    const title = getFrontMatterString(sourceDataWithPubId, "title") || activeFile.basename;
    const subFolder = getSubFolder(platform, sourceDataWithPubId);
    const targetPath = existingPath || getTargetPath(platform, this.settings, title, subFolder);
    const proposedPublishedData = await this.buildPublishedFrontMatter(
      platform,
      activeFile,
      sourceDataWithPubId,
      existingContent,
      pubId,
      new Date().toISOString()
    );

    const diff: ArticleDiff = {
      pub_id: pubId,
      sourcePath: activeFile.path,
      targetPath: targetPath,
      sourceContent: stringifyFrontMatter(sourceParsed.content, proposedPublishedData),
      targetContent: existingContent,
      isNew,
      meta: proposedPublishedData as ArticleMeta,
      platform,
    };

    if (!isNew && existingContent) {
      new DiffModal(this.app, diff, async (confirmed) => {
        if (confirmed) {
          await this.copyAndOpenForEdit(diff, activeFile, sourceParsed);
        }
      }).open();
    } else {
      await this.copyAndOpenForEdit(diff, activeFile, sourceParsed);
    }
  }

  async findArticleByPubId(
    platform: Platform,
    pubId: string,
    meta: FrontMatterData
  ): Promise<string | null> {
    const subFolder = getSubFolder(platform, meta);

    // 先检查已知路径
    const title = getFrontMatterString(meta, "title");
    if (title) {
      const expectedPath = getTargetPath(platform, this.settings, title, subFolder);
      if (await this.publishPathExists(platform, expectedPath)) {
        const content = await this.readPublishFile(platform, expectedPath);
        const parsed = parseFrontMatter(content);
        if (getFrontMatterString(parsed.data, "pub_id") === pubId) {
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
            if (getFrontMatterString(parsed.data, "pub_id") === pubId) {
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

  async buildPublishedFrontMatter(
    platform: Platform,
    sourceFile: TFile,
    sourceData: FrontMatterData,
    existingContent: string | null,
    pubId: string,
    timestamp: string
  ): Promise<FrontMatterData> {
    const existingData = existingContent ? parseFrontMatter(existingContent).data : undefined;
    const publishedData = mergePublishedFrontMatter({
      sourceData,
      existingData,
      pubId,
      sourceFileLink: createWikiLink(sourceFile.path),
      timestamp,
    });

    if (platform.autoUrl && platform.id === "hexo" && this.settings.hexoRepoPath) {
      const url = await generateHexoUrl(this.settings.hexoRepoPath, publishedData);
      return {
        ...publishedData,
        publish_url: url ?? "",
      };
    }

    return publishedData;
  }

  async copyAndOpenForEdit(
    diff: ArticleDiff,
    sourceFile: TFile,
    sourceParsed: ParsedFrontMatter
  ) {
    const platform = diff.platform;
    const sourceDataWithPubId: FrontMatterData = {
      ...sourceParsed.data,
      pub_id: diff.pub_id,
    };
    const publishedData = await this.buildPublishedFrontMatter(
      platform,
      sourceFile,
      sourceDataWithPubId,
      diff.targetContent,
      diff.pub_id,
      new Date().toISOString()
    );
    const finalContent = stringifyFrontMatter(sourceParsed.content, publishedData);

    // 确保发布目录存在
    const publishPath = getTargetDirectory(platform, diff.targetPath);
    await this.ensurePublishDirectory(platform, publishPath);

    // 写入发布路径
    await this.writePublishFile(platform, diff.targetPath, finalContent);

    // 更新源文件的 pub_id 和子文件列表
    await this.updateSourceFile(sourceFile, sourceParsed, platform, diff.targetPath, diff.pub_id);

    new Notice(diff.isNew ? `Article copied to ${platform.name}` : `Article updated in ${platform.name}`);

    if (platform.id === "hexo" && this.settings.autoDeploy) {
      await this.deployToHexo();
    }

    // 打开发布路径中的文章供编辑
    await this.openPublishedFile(diff.targetPath, platform);
  }

  async updateSourceFile(
    sourceFile: TFile,
    sourceParsed: ParsedFrontMatter,
    platform: Platform,
    targetPath: string,
    pubId: string
  ) {
    const childReference = formatChildReference(platform, targetPath);
    const obsoleteChildReferences = getObsoleteChildReferences(platform, targetPath);
    await this.app.fileManager.processFrontMatter(sourceFile, (frontmatter) => {
      const sourceData = mergeSourceFrontMatter(
        frontmatter as FrontMatterData,
        pubId,
        childReference,
        obsoleteChildReferences
      );

      for (const key of Object.keys(frontmatter)) {
        delete frontmatter[key];
      }

      Object.assign(frontmatter, sourceData);
    });
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
      return this.app.vault.getAbstractFileByPath(filePath) instanceof TFile;
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

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      throw new Error(`Publish file not found: ${filePath}`);
    }

    return this.app.vault.read(file);
  }

  async writePublishFile(platform: Platform, filePath: string, content: string): Promise<void> {
    if (platform.isExternal) {
      await fs.writeFile(filePath, content, "utf8");
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
      return;
    }

    await this.app.vault.create(filePath, content);
  }

  async listPublishFiles(platform: Platform, directoryPath: string): Promise<string[]> {
    if (platform.isExternal) {
      const entries = await fs.readdir(directoryPath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(directoryPath, entry.name));
    }

    const folder = this.app.vault.getAbstractFileByPath(directoryPath);
    if (!(folder instanceof TFolder)) {
      throw new Error(`Publish directory not found: ${directoryPath}`);
    }

    return folder.children
      .filter((child): child is TFile => child instanceof TFile)
      .map((child) => child.path);
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
      if (!(this.app.vault.getAbstractFileByPath(currentPath) instanceof TFolder)) {
        await this.app.vault.createFolder(currentPath);
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
