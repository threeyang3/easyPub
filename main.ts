import fs from "fs/promises";
import path from "path";
import { App, Modal, Notice, Plugin, Setting, TFile, TFolder, normalizePath } from "obsidian";
import { EasyPubSettingTab } from "./settings";
import { DEFAULT_SETTINGS, PluginSettings, ArticleMeta, ArticleDiff, Platform, PLATFORMS, FrontMatterData } from "./types";
import {
  parseFrontMatter,
  stringifyFrontMatter,
  generatePubId,
  getFrontMatterString,
  mergePublishedFrontMatter,
  mergeSourceFrontMatter,
} from "./utils/frontMatter";
import { deployHexo, validateHexoBlog } from "./utils/hexoCommands";
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
  private publishInProgress = false;
  private publishConfirmationOpen = false;
  private deployInProgress = false;

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
      new Notice("请先打开要发布的文章");
      return;
    }

    new PlatformSelectModal(this.app, PLATFORMS, async (platform) => {
      if (platform) {
        await this.preparePublish(platform);
      }
    }).open();
  }

  async preparePublish(platform: Platform) {
    if (this.publishInProgress || this.publishConfirmationOpen) {
      new Notice("已有发布任务正在进行，请稍候");
      return;
    }

    this.publishInProgress = true;
    try {
      await this.performPublish(platform);
    } catch (error) {
      console.error("EasyPub publish failed", error);
      new Notice(`发布失败：${this.getErrorMessage(error)}`);
    } finally {
      this.publishInProgress = false;
    }
  }

  private async performPublish(platform: Platform) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("请先打开要发布的文章");
      return;
    }
    if (activeFile.extension !== "md") {
      new Notice("请选择 Markdown 文件后再发布");
      return;
    }

    // Hexo 需要检查路径配置
    if (platform.isExternal && !this.settings.hexoRepoPath) {
      new Notice("请先在设置中填写 Hexo 仓库路径");
      return;
    }
    if (platform.id === "hexo") {
      await validateHexoBlog(this.settings.hexoRepoPath);
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
    const desiredTargetPath = getTargetPath(platform, this.settings, title, subFolder);
    let targetPath = existingPath || desiredTargetPath;
    if (!existingPath && await this.publishPathExists(platform, desiredTargetPath)) {
      targetPath = await this.getAvailableTargetPath(platform, desiredTargetPath);
      new Notice(`发现同名文件，将保存为 ${this.getDisplayFileName(platform, targetPath)}`);
    }
    const proposedPublishedData = await this.buildPublishedFrontMatter(
      platform,
      activeFile,
      sourceDataWithPubId,
      existingContent,
      pubId,
      new Date().toISOString(),
      targetPath
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

    if (!isNew && existingContent !== null) {
      this.publishConfirmationOpen = true;
      new DiffModal(this.app, diff, async (confirmed) => {
        this.publishConfirmationOpen = false;
        if (confirmed) {
          if (this.publishInProgress) {
            new Notice("已有发布任务正在进行，请稍候");
            return;
          }
          this.publishInProgress = true;
          try {
            await this.copyAndOpenForEdit(diff, activeFile);
          } catch (error) {
            console.error("EasyPub publish failed", error);
            new Notice(`发布失败：${this.getErrorMessage(error)}`);
          } finally {
            this.publishInProgress = false;
          }
        }
      }).open();
    } else {
      await this.copyAndOpenForEdit(diff, activeFile);
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
      if (!(await this.publishDirectoryExists(platform, publishPath))) {
        continue;
      }
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
    }
    return null;
  }

  async buildPublishedFrontMatter(
    platform: Platform,
    sourceFile: TFile,
    sourceData: FrontMatterData,
    existingContent: string | null,
    pubId: string,
    timestamp: string,
    targetPath: string
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
      const url = await generateHexoUrl(
        this.settings.hexoRepoPath,
        publishedData,
        targetPath
      );
      if (!url) {
        if (!getFrontMatterString(publishedData, "publish_url")) {
          new Notice("Hexo 链接将在生成后自动补全");
        }
        return publishedData;
      }
      return {
        ...publishedData,
        publish_url: url,
      };
    }

    return publishedData;
  }

  async copyAndOpenForEdit(
    diff: ArticleDiff,
    sourceFile: TFile
  ) {
    const platform = diff.platform;
    const finalContent = diff.sourceContent;

    // 确保发布目录存在
    const publishPath = getTargetDirectory(platform, diff.targetPath);
    await this.ensurePublishDirectory(platform, publishPath);

    // 写入发布路径；若源文件元数据更新失败，则恢复目标文件，避免半成功状态。
    const previousTargetContent = await this.publishPathExists(platform, diff.targetPath)
      ? await this.readPublishFile(platform, diff.targetPath)
      : null;
    if (diff.isNew && previousTargetContent !== null) {
      throw new Error("目标文件刚刚被创建，请重新发布以生成新的安全文件名");
    }
    await this.writePublishFile(platform, diff.targetPath, finalContent);

    try {
      await this.updateSourceFile(sourceFile, platform, diff.targetPath, diff.pub_id);
    } catch (error) {
      if (previousTargetContent === null) {
        await this.deletePublishFile(platform, diff.targetPath);
      } else {
        await this.writePublishFile(platform, diff.targetPath, previousTargetContent);
      }
      throw error;
    }

    new Notice(diff.isNew ? `已生成${platform.name}发布稿` : `已更新${platform.name}发布稿`);

    if (platform.id === "hexo" && this.settings.autoDeploy) {
      await this.deployToHexo();
    }

    // 打开发布路径中的文章供编辑
    await this.openPublishedFile(diff.targetPath, platform);
  }

  async updateSourceFile(
    sourceFile: TFile,
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
      new Notice(`已打开${platform.name}发布稿`);
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async publishDirectoryExists(platform: Platform, directoryPath: string): Promise<boolean> {
    if (!platform.isExternal) {
      return this.app.vault.getAbstractFileByPath(directoryPath) instanceof TFolder;
    }

    try {
      return (await fs.stat(directoryPath)).isDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
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

  async deletePublishFile(platform: Platform, filePath: string): Promise<void> {
    if (platform.isExternal) {
      await fs.unlink(filePath);
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.app.vault.delete(file);
    }
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
      new Notice("请先在设置中填写 Hexo 仓库路径");
      return;
    }
    if (this.deployInProgress) {
      new Notice("Hexo 正在部署，请稍候");
      return;
    }

    this.deployInProgress = true;
    new Notice("正在部署 Hexo...");
    try {
      await deployHexo(this.settings.hexoRepoPath);
      try {
        await this.refreshActiveHexoPublishUrl();
      } catch (error) {
        console.warn("EasyPub could not refresh Hexo publish URL", error);
        new Notice("Hexo 已部署，但本地发布链接未能自动更新");
      }
      new Notice("Hexo 部署成功");
    } catch (error) {
      console.error("EasyPub Hexo deploy failed", error);
      new Notice(`Hexo 部署失败：${this.getErrorMessage(error)}`);
    } finally {
      this.deployInProgress = false;
    }
  }

  private async getAvailableTargetPath(platform: Platform, targetPath: string): Promise<string> {
    const directory = getTargetDirectory(platform, targetPath);
    const parsed = platform.isExternal
      ? path.parse(targetPath)
      : path.posix.parse(normalizePath(targetPath));

    for (let index = 2; index < 10_000; index++) {
      const fileName = `${parsed.name} (${index})${parsed.ext}`;
      const candidate = platform.isExternal
        ? path.join(directory, fileName)
        : normalizePath(`${directory}/${fileName}`);
      if (!(await this.publishPathExists(platform, candidate))) {
        return candidate;
      }
    }

    throw new Error("无法为同名文章生成可用文件名");
  }

  private getDisplayFileName(platform: Platform, filePath: string): string {
    return platform.isExternal ? path.basename(filePath) : path.posix.basename(filePath);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async refreshActiveHexoPublishUrl(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    const hexoPlatform = PLATFORMS.find((platform) => platform.id === "hexo");
    if (!activeFile || !hexoPlatform || activeFile.extension !== "md") {
      return;
    }

    const sourceContent = await this.app.vault.read(activeFile);
    const sourceData = parseFrontMatter(sourceContent).data;
    const pubId = getFrontMatterString(sourceData, "pub_id");
    if (!pubId) {
      return;
    }

    const targetPath = await this.findArticleByPubId(hexoPlatform, pubId, sourceData);
    if (!targetPath) {
      return;
    }

    const publishedContent = await this.readPublishFile(hexoPlatform, targetPath);
    const publishedParsed = parseFrontMatter(publishedContent);
    const publishUrl = await generateHexoUrl(
      this.settings.hexoRepoPath,
      publishedParsed.data,
      targetPath
    );
    if (
      !publishUrl
      || getFrontMatterString(publishedParsed.data, "publish_url") === publishUrl
    ) {
      return;
    }

    await this.writePublishFile(
      hexoPlatform,
      targetPath,
      stringifyFrontMatter(publishedParsed.content, {
        ...publishedParsed.data,
        publish_url: publishUrl,
      })
    );
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
        .setDesc(platform.isExternal ? "保存到 Hexo 仓库" : `保存到 ${platform.path} 发布稿目录`)
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
