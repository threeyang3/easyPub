import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { App, FileSystemAdapter, Modal, Notice, Plugin, Setting, TFile, TFolder, normalizePath, requestUrl } from "obsidian";
import { EasyPubSettingTab } from "./settings";
import { PluginSettings, ArticleMeta, ArticleDiff, Platform, PLATFORMS, FrontMatterData, PublishAsset, PicGoImageCacheEntry, PicGoPendingUpload } from "./types";
import {
  parseFrontMatter,
  stringifyFrontMatter,
  generatePubId,
  getFrontMatterString,
  mergePublishedFrontMatter,
  mergeSourceFrontMatter,
} from "./utils/frontMatter";
import { buildHexo, deployHexo, validateHexoBlog } from "./utils/hexoCommands";
import { DiffModal } from "./modals/DiffModal";
import { BatchPubIdModal } from "./modals/BatchPubIdModal";
import { fillMissingPubIds, externalPubIdDocuments, needsPubId, PubIdBatchResult } from "./utils/batchPubIds";
import {
  getPublishPath,
  getTargetPath,
  getSubFolder,
  createWikiLink,
  formatChildReference,
  getObsoleteChildReferences,
  getTargetDirectory,
  getHexoAssetTargetPath,
  getHexoAssetRelativePath,
  isSourcePublishTarget,
} from "./utils/platforms";
import { generateHexoUrl, getHexoRootPath } from "./utils/linkUtils";
import { prepareImageEmbeds, PreparedImageContent } from "./utils/imageEmbeds";
import { getPicGoHeartbeatUrl, uploadWithPicGo } from "./utils/picgo";
import { assertPublishUnchanged, completeControlRoomMetadata } from "./utils/publishSafety";
import { writeImmutableAsset, writePublishedFile } from "./utils/publishFiles";
import { withTimeout } from "./utils/async";
import { assertPublishIdentity } from "./utils/publishIdentity";
import { normalizeSettings, publishSettingsFingerprint } from "./utils/settings";
import { WechatApi } from "./utils/wechatApi";
import { decryptWechatSecret, encryptWechatSecret } from "./utils/wechatSecret";
import { rebaseWechatImages } from "./utils/wechatMarkdown";
import { relativeVaultAttachment } from "./utils/platforms";
import { WECHAT_VIEW, WechatView, isWechatDraft } from "./views/WechatView";
import { WechatSetupModal } from "./modals/WechatSetupModal";
import {
  findControlRoomIntegration,
  getControlRoomStatusUrl,
  readControlRoomSession,
  requireControlRoomIntegration,
} from "./utils/controlRoom";

const HEXO_IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

interface PreparedPublishContent extends PreparedImageContent {
  picgoUploads: PicGoPendingUpload[];
  imageChecks?: Array<{ sourcePath: string; contentHash: string }>;
}

export default class EasyPub extends Plugin {
  settings: PluginSettings;
  private publishInProgress = false;
  private publishConfirmationOpen = false;
  private deployInProgress = false;
  private pubIdBatchInProgress = false;
  wechatSyncInProgress = false;
  wechatCredentialRevision = 0;
  private wechatSessionSecret = "";
  private wechatApi?: WechatApi;
  private wechatApiIdentity = "";

  async onload() {
    await this.loadSettings();

    this.registerView(WECHAT_VIEW, leaf => new WechatView(leaf, this));
    this.addCommand({ id: "wechat-setup", name: "引导配置微信公众号", callback: () => this.openWechatSetup() });
    this.addCommand({ id: "wechat-preview", name: "预览并同步公众号草稿", callback: () => {
      void this.openActiveWechatDraft().catch(error => new Notice((error as Error).message));
    } });
    this.addCommand({ id: "wechat-refresh-source", name: "从源文章更新公众号本地稿（确认后替换正文）", callback: () => {
      void this.preparePublish(PLATFORMS.find(p => p.id === "wechat")!, true);
    } });

    // 发布命令 - 显示平台选择
    this.addRibbonIcon("upload-cloud", "Publish", () => {
      this.showPlatformSelector();
    });

    this.addRibbonIcon("layout-dashboard", "打开博客管理后台", () => {
      void this.openHexoControlRoom();
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

    this.addCommand({
      id: "build-hexo",
      name: "Build Hexo locally (no deploy)",
      callback: () => this.buildHexoLocally(),
    });

    this.addCommand({
      id: "open-hexo-control-room",
      name: "Open Hexo management console",
      callback: () => this.openHexoControlRoom(),
    });

    this.addSettingTab(new EasyPubSettingTab(this.app, this));
    this.addCommand({
      id: "fill-missing-pub-ids",
      name: "批量补齐文件夹中的 pub_id",
      callback: () => this.showBatchPubIdModal(),
    });
  }

  showBatchPubIdModal() {
    new BatchPubIdModal(this.app, this.app.workspace.getActiveFile()?.parent?.path || "/",
      (scope, folder) => this.fillFolderPubIds(scope, folder)).open();
  }

  async fillFolderPubIds(scope: "vault" | "external", folder: string): Promise<PubIdBatchResult> {
    if (this.pubIdBatchInProgress || this.publishInProgress || this.publishConfirmationOpen || this.deployInProgress) {
      throw new Error("已有 EasyPub 任务正在进行，请稍候");
    }
    this.pubIdBatchInProgress = true;
    try {
      if (scope === "external") return await fillMissingPubIds(await externalPubIdDocuments(folder.trim()));
      const input = folder.trim().replace(/\\/g, "/");
      if (!input) throw new Error("请输入文件夹路径；/ 表示整个 Vault");
      if (input !== "/" && (path.isAbsolute(input) || input.split("/").includes(".."))) {
        throw new Error("Vault 文件夹请使用库内相对路径");
      }
      const root = input === "/" ? "" : normalizePath(input).replace(/\/$/, "");
      const directory = root ? this.app.vault.getAbstractFileByPath(root) : this.app.vault.getRoot();
      if (!(directory instanceof TFolder)) throw new Error("Vault 文件夹不存在");
      const files = this.app.vault.getMarkdownFiles().filter(file => !root || file.path.startsWith(`${root}/`));
      return await fillMissingPubIds(files.map(file => ({
        path: file.path,
        read: () => this.app.vault.read(file),
        assign: async (id: string) => {
          let added = false;
          await this.app.fileManager.processFrontMatter(file, data => {
            if (needsPubId(data.pub_id)) { data.pub_id = id; added = true; }
          });
          return added;
        },
      })));
    } finally { this.pubIdBatchInProgress = false; }
  }

  onunload() { this.wechatSessionSecret = ""; this.wechatApi = undefined; }

  relativeWechatAttachment(draftPath: string, attachmentPath: string): string {
    return relativeVaultAttachment(draftPath, attachmentPath);
  }

  async setWechatSecret(secret: string): Promise<boolean> {
    this.wechatSessionSecret = secret;
    this.settings.wechat.encryptedSecret = encryptWechatSecret(secret);
    this.wechatCredentialRevision++;
    this.wechatApi = undefined;
    await this.saveSettings();
    return Boolean(this.settings.wechat.encryptedSecret);
  }

  hasWechatCredentials(): boolean {
    return Boolean(this.settings.wechat.appId && (this.wechatSessionSecret || decryptWechatSecret(this.settings.wechat.encryptedSecret)));
  }

  openWechatSetup(finished?: () => void): void { new WechatSetupModal(this, finished).open(); }

  async saveWechatConfiguration(appId: string, secret: string, author: string): Promise<boolean> {
    if (this.wechatSyncInProgress) throw new Error("请等待当前公众号同步任务完成后再修改账号");
    if (!appId || /\s/.test(appId)) throw new Error("请填写有效的 AppID，不应包含空格");
    if (!secret && (appId !== this.settings.wechat.appId || !this.hasWechatCredentials())) throw new Error("请填写此账号的 AppSecret");
    const previous = { appId: this.settings.wechat.appId, encryptedSecret: this.settings.wechat.encryptedSecret, defaultAuthor: this.settings.wechat.defaultAuthor };
    const session = this.wechatSessionSecret;
    Object.assign(this.settings.wechat, { appId, defaultAuthor: author });
    if (secret) { this.wechatSessionSecret = secret; this.settings.wechat.encryptedSecret = encryptWechatSecret(secret); }
    this.wechatCredentialRevision++; this.wechatApi = undefined;
    try { await this.saveSettings(); }
    catch { Object.assign(this.settings.wechat, previous); this.wechatSessionSecret = session; this.wechatCredentialRevision++; throw new Error("公众号配置保存失败，请重试"); }
    return Boolean(this.settings.wechat.encryptedSecret);
  }

  async setWechatAppId(appId: string): Promise<void> {
    if (appId === this.settings.wechat.appId) return;
    this.settings.wechat.appId = appId;
    this.settings.wechat.encryptedSecret = "";
    this.wechatSessionSecret = "";
    this.wechatApi = undefined;
    this.wechatCredentialRevision++;
    await this.saveSettings();
  }

  getWechatApi(): WechatApi {
    const secret = this.wechatSessionSecret || decryptWechatSecret(this.settings.wechat.encryptedSecret);
    const identity = createHash("sha256").update(this.settings.wechat.appId + "\0" + secret).digest("hex");
    if (!this.wechatApi || identity !== this.wechatApiIdentity) {
      this.wechatApi = new WechatApi(this.settings.wechat.appId, secret);
      this.wechatApiIdentity = identity;
    }
    return this.wechatApi;
  }

  async openWechatBackend(): Promise<void> {
    const electron = require("electron") as { shell?: { openExternal(url: string): Promise<void> } };
    if (!electron.shell) throw new Error("当前环境无法打开桌面浏览器");
    await electron.shell.openExternal("https://mp.weixin.qq.com/");
  }

  async openActiveWechatDraft(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md" || !isWechatDraft(file, await this.app.vault.read(file), this)) {
      throw new Error("请先打开公众号本地稿；可从源文章选择“发布 → 微信公众号”生成");
    }
    await this.openWechatDraft(file);
  }

  async openWechatDraft(file: TFile): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(WECHAT_VIEW)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) throw new Error("无法打开公众号工作台");
    if (!existing) await leaf.setViewState({ type: WECHAT_VIEW, active: true });
    await (leaf.view as WechatView).bind(file);
    await this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    try {
      this.settings = normalizeSettings(await this.loadData());
    } catch (error) {
      this.settings = normalizeSettings(null);
      console.warn("EasyPub could not load settings", error);
      new Notice("EasyPub 设置读取失败，已使用默认值。请检查插件 data.json 或重新配置发布路径。", 10000);
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async testPicGoConnection(): Promise<void> {
    try {
      const response = await withTimeout(requestUrl({
        url: getPicGoHeartbeatUrl(this.settings.picgoServerUrl),
        method: "POST",
        throw: false,
      }), 10000, "PicGo 连接检查超时，请确认 Server 已启动");
      const data = response.json as { success?: boolean; result?: string };
      if (response.status === 200 && data?.success === true) {
        new Notice("PicGo Server 连接成功");
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      console.warn("EasyPub PicGo heartbeat failed", error);
      new Notice(`无法连接 PicGo Server：${this.getErrorMessage(error)}`);
    }
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

  async preparePublish(platform: Platform, updateWechatFromSource = false) {
    if (this.publishInProgress || this.publishConfirmationOpen || this.pubIdBatchInProgress) {
      new Notice("已有发布任务正在进行，请稍候");
      return;
    }

    this.publishInProgress = true;
    try {
      await this.performPublish(platform, updateWechatFromSource);
    } catch (error) {
      console.error("EasyPub publish failed", error);
      new Notice(`发布失败：${this.getErrorMessage(error)}`);
    } finally {
      this.publishInProgress = false;
    }
  }

  private async performPublish(platform: Platform, updateWechatFromSource = false) {
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
    const settingsFingerprint = publishSettingsFingerprint(this.settings);
    const sourceParsed = parseFrontMatter(content);
    if (platform.id === "wechat" && isWechatDraft(activeFile, content, this)) {
      if (updateWechatFromSource) throw new Error("请打开源文章后执行更新，不会把本地成稿再次当作源文章");
      await this.openWechatDraft(activeFile);
      return;
    }

    let pubId = getFrontMatterString(sourceParsed.data, "pub_id");
    let isNew = true;
    let existingContent: string | null = null;
    let existingPath: string | null = null;

    if (pubId) {
      existingPath = await this.findArticleByPubId(platform, pubId, sourceParsed.data, activeFile.path);
      if (existingPath) {
        isNew = false;
        existingContent = await this.readPublishFile(platform, existingPath);
      }
    } else {
      pubId = generatePubId();
    }

    if (platform.id === "wechat" && existingPath && !updateWechatFromSource) {
      const draft = this.app.vault.getAbstractFileByPath(existingPath);
      if (draft instanceof TFile) {
        await this.openPublishedFile(existingPath, platform);
        return;
      }
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
    const preparedContent: PreparedPublishContent = platform.id === "wechat"
      ? { content: await rebaseWechatImages(this.app, sourceParsed.content, activeFile.path, targetPath), assets: [], picgoUploads: [] }
      : this.settings.imageHandling === "picgo"
      ? await this.preparePicGoContent(activeFile, sourceParsed.content)
      : platform.id === "hexo"
        ? await this.prepareHexoContent(activeFile, sourceParsed.content, pubId)
        : { content: sourceParsed.content, assets: [], picgoUploads: [] };
    const proposedPublishedData = await this.buildPublishedFrontMatter(
      platform,
      activeFile,
      sourceDataWithPubId,
      existingContent,
      pubId,
      new Date().toISOString(),
      targetPath
    );
    if (platform.id === "wechat") {
      // The local draft owns its platform-specific settings, even on an explicit
      // source refresh. Never import a source's WeChat settings over them.
      proposedPublishedData.wechat = existingContent ? parseFrontMatter(existingContent).data.wechat ?? {} : {};
    }

    const diff: ArticleDiff = {
      pub_id: pubId,
      sourcePath: activeFile.path,
      targetPath: targetPath,
      sourceContent: stringifyFrontMatter(preparedContent.content, proposedPublishedData),
      targetContent: existingContent,
      isNew,
      meta: proposedPublishedData as ArticleMeta,
      platform,
      assets: preparedContent.assets,
      picgoUploads: preparedContent.picgoUploads,
      sourceSnapshot: content,
      settingsFingerprint,
      imageChecks: preparedContent.imageChecks,
    };

    if (!isNew && existingContent !== null) {
      this.publishConfirmationOpen = true;
      try {
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
      } catch (error) {
        this.publishConfirmationOpen = false;
        throw error;
      }
    } else {
      await this.copyAndOpenForEdit(diff, activeFile);
    }
  }

  async findArticleByPubId(
    platform: Platform,
    pubId: string,
    meta: FrontMatterData,
    sourcePath?: string
  ): Promise<string | null> {
    const subFolder = getSubFolder(platform, meta);
    const matches = new Map<string, string>();

    // 先检查已知路径
    const title = getFrontMatterString(meta, "title");
    if (title) {
      const expectedPath = getTargetPath(platform, this.settings, title, subFolder);
      if (await this.publishPathExists(platform, expectedPath)) {
        const content = await this.readPublishFile(platform, expectedPath);
        const parsed = parseFrontMatter(content);
        if (getFrontMatterString(parsed.data, "pub_id") === pubId) {
          matches.set(expectedPath, content);
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
      if (platform.id === "hexo") searchPaths.push(path.join(this.settings.hexoRepoPath, "source", "_drafts"));
    }

    for (const publishPath of searchPaths) {
      if (!(await this.publishDirectoryExists(platform, publishPath))) {
        continue;
      }
      const files = platform.id === "wechat"
        ? this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(`${publishPath}/`)).map(file => file.path)
        : await this.listPublishFiles(platform, publishPath);
      for (const file of files) {
        if (file.endsWith(".md")) {
          const content = await this.readPublishFile(platform, file);
          const parsed = parseFrontMatter(content);
          if (getFrontMatterString(parsed.data, "pub_id") === pubId) {
            matches.set(file, content);
          }
        }
      }
    }
    if (sourcePath) await assertPublishIdentity(this.app, sourcePath, pubId,
      [...matches].map(([path, content]) => ({ path, content })),
      PLATFORMS.filter(platform => !platform.isExternal).map(platform => getPublishPath(platform, this.settings)));
    return matches.keys().next().value ?? null;
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
    let publishedData = mergePublishedFrontMatter({
      sourceData,
      existingData,
      pubId,
      sourceFileLink: createWikiLink(sourceFile.path),
      timestamp,
    });

    if (platform.id === "hexo" && await findControlRoomIntegration(this.settings.hexoRepoPath)) {
      const used = new Set<string>();
      for (const directory of ["_posts", "_drafts"]) {
        const root = path.join(this.settings.hexoRepoPath, "source", directory);
        if (!await this.publishDirectoryExists(platform, root)) continue;
        for (const file of await this.listPublishFiles(platform, root)) {
          if (!file.endsWith(".md") || path.resolve(file) === path.resolve(targetPath)) continue;
          const meta = parseFrontMatter(await this.readPublishFile(platform, file)).data;
          if (meta.abbrlink !== undefined) used.add(String(meta.abbrlink));
        }
      }
      publishedData = completeControlRoomMetadata(publishedData, sourceFile.basename, used);
      if (path.relative(path.join(this.settings.hexoRepoPath, "source"), targetPath).split(path.sep)[0] === "_drafts") {
        publishedData.workflow = existingData?.workflow === "pending" ? "pending" : "draft";
      } else delete publishedData.workflow;
    }

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
    await this.validatePublishSource(diff, sourceFile);

    // 确保发布目录存在
    const publishPath = getTargetDirectory(platform, diff.targetPath);
    await this.ensurePublishDirectory(platform, publishPath);

    // Existing targets may be restored with a content guard. Never delete a newly
    // created target on failure: an editor may have changed it since creation.
    const previousTargetContent = await this.publishPathExists(platform, diff.targetPath)
      ? await this.readPublishFile(platform, diff.targetPath)
      : null;
    if (diff.isNew && previousTargetContent !== null) {
      throw new Error("目标文件刚刚被创建，请重新发布以生成新的安全文件名");
    }
    assertPublishUnchanged(diff.targetContent, previousTargetContent);
    const picgoResult = await this.resolvePicGoUploads(
      diff.sourceContent,
      diff.picgoUploads ?? []
    );
    const finalContent = picgoResult.content;
    const createdAssets: string[] = [];
    let targetWritten = false;
    try {
      await this.copyPublishAssets(diff.assets ?? [], createdAssets);
      await this.validatePublishSource(diff, sourceFile);
      const current = await this.publishPathExists(platform, diff.targetPath)
        ? await this.readPublishFile(platform, diff.targetPath) : null;
      assertPublishUnchanged(diff.targetContent, current);
      {
        const actualPath = await this.findArticleByPubId(platform, diff.pub_id, diff.meta, sourceFile.path);
        if (actualPath && path.resolve(actualPath) !== path.resolve(diff.targetPath)) {
          throw new Error("文章已移动到其他位置，请重新发布以保留其状态");
        }
      }
      await this.writePublishFile(platform, diff.targetPath, finalContent, diff.targetContent);
      targetWritten = true;
      await this.updateSourceFile(sourceFile, platform, diff.targetPath, diff.pub_id);
    } catch (error) {
      if (targetWritten) {
        let recovery: string;
        if (previousTargetContent === null) {
          recovery = "新建稿件已保留，请核对稿件和源文章的关联后重试";
        } else {
          try {
            await this.writePublishFile(platform, diff.targetPath, previousTargetContent, finalContent);
            recovery = "发布稿已恢复为本次操作前的内容，请核对源文章关联后重试";
          } catch (restoreError) {
            recovery = `未能恢复旧稿，未继续执行删除或强制覆盖，请核对当前稿件。恢复错误：${this.getErrorMessage(restoreError)}`;
          }
        }
        // A written target or another editor can still reference these assets.
        // Retention is safer than a scan followed by an unguarded delete.
        throw new Error(`发布未完成：${this.getErrorMessage(error)}。${recovery}。目标：${diff.targetPath}。本次新增附件已保留。`);
      }
      // Only remove assets which no current post or draft references.
      if (createdAssets.length) {
        try {
          const documents: string[] = [];
          for (const directory of ["_posts", "_drafts"]) {
            const root = path.join(this.settings.hexoRepoPath, "source", directory);
            if (!await this.publishDirectoryExists(platform, root)) continue;
            for (const file of await this.listPublishFiles(platform, root)) {
              if (file.endsWith(".md")) documents.push(await this.readPublishFile(platform, file));
            }
          }
          for (const file of createdAssets) {
            const name = path.basename(file);
            if (!documents.some(text => text.includes(name) || text.includes(encodeURIComponent(name)))) {
              await fs.unlink(file).catch(() => {});
            }
          }
        } catch { /* Retain assets if reference discovery fails. */ }
      }
      throw error;
    }

    if (Object.keys(picgoResult.cacheUpdates).length > 0) {
      Object.assign(this.settings.picgoImageCache, picgoResult.cacheUpdates);
      try {
        await this.saveSettings();
      } catch (error) {
        console.warn("EasyPub could not persist PicGo image cache", error);
      }
    }

    new Notice(diff.isNew ? `已生成${platform.name}发布稿` : `已更新${platform.name}发布稿`);

    if (platform.id === "hexo" && this.settings.autoDeploy) {
      await this.deployToHexo();
    }

    // 打开发布路径中的文章供编辑
    try {
      await this.openPublishedFile(diff.targetPath, platform);
    } catch (error) {
      console.warn("EasyPub saved the article but could not open it", error);
      new Notice(`发布稿已保存，但无法自动打开：${diff.targetPath}`, 10000);
    }
  }

  private async validatePublishSource(diff: ArticleDiff, sourceFile: TFile): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (isSourcePublishTarget(diff.platform, sourceFile.path, diff.targetPath,
      adapter instanceof FileSystemAdapter ? adapter.getBasePath() : undefined)) {
      throw new Error("当前文件就是目标发布稿，请先打开源文章再发布");
    }
    if (diff.settingsFingerprint !== undefined
      && diff.settingsFingerprint !== publishSettingsFingerprint(this.settings)) {
      throw new Error("发布设置已变化，请重新发布并确认新的差异");
    }
    if (diff.sourceSnapshot !== undefined && (sourceFile.path !== diff.sourcePath
      || await this.app.vault.read(sourceFile) !== diff.sourceSnapshot)) {
      throw new Error("源文章已变化，请重新发布并确认新的差异");
    }
    for (const image of diff.imageChecks ?? diff.picgoUploads ?? []) {
      const attachment = this.app.vault.getAbstractFileByPath(image.sourcePath);
      if (!(attachment instanceof TFile)) throw new Error("图片已删除，请重新发布");
      const current = await this.app.vault.readBinary(attachment);
      if (createHash("sha256").update(new Uint8Array(current)).digest("hex") !== image.contentHash) {
        throw new Error("图片在确认期间发生变化，请重新发布");
      }
    }
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
      if (platform.id === "wechat") await this.openWechatDraft(file);
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

  async writePublishFile(platform: Platform, filePath: string, content: string, expected?: string | null): Promise<void> {
    if (platform.isExternal) {
      await writePublishedFile(filePath, content, expected,
        path.join(path.resolve(this.settings.hexoRepoPath), ".easy-pub-backups"));
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.app.vault.process(file, current => {
        if (expected !== undefined) assertPublishUnchanged(expected, current);
        return content;
      });
      return;
    }

    if (expected !== undefined) assertPublishUnchanged(expected, null);
    await this.app.vault.create(filePath, content);
  }

  async listPublishFiles(platform: Platform, directoryPath: string): Promise<string[]> {
    if (platform.isExternal) {
      const entries = await fs.readdir(directoryPath, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isFile()) files.push(fullPath);
        else if (entry.isDirectory()) files.push(...await this.listPublishFiles(platform, fullPath));
      }
      return files;
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
    if (this.deployInProgress || this.pubIdBatchInProgress) {
      new Notice("Hexo 任务正在进行，请稍候");
      return;
    }

    this.deployInProgress = true;
    try {
      const controlRoom = await findControlRoomIntegration(this.settings.hexoRepoPath);
      if (controlRoom) {
        new Notice("此博客启用了部署保护，请在管理后台完成源码同步与部署");
        await this.openHexoControlRoom();
        return;
      }
      new Notice("正在部署 Hexo...");
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

  async openHexoControlRoom(): Promise<void> {
    if (!this.settings.hexoRepoPath) {
      new Notice("请先在设置中填写 Hexo 仓库路径");
      return;
    }

    try {
      const integration = await requireControlRoomIntegration(this.settings.hexoRepoPath);
      const electron = require("electron") as {
        shell?: {
          openExternal(url: string): Promise<void>;
          openPath(filePath: string): Promise<string>;
        };
      };
      if (!electron.shell) throw new Error("当前环境无法调用桌面浏览器");

      const session = await readControlRoomSession(integration.sessionPath);
      if (session) {
        try {
          const response = await withTimeout(requestUrl({
            url: getControlRoomStatusUrl(session),
            method: "GET",
            throw: false,
          }), 5000, "博客管理后台响应超时");
          if (response.status === 200) {
            await electron.shell.openExternal(session.url);
            new Notice("已打开博客管理后台");
            return;
          }
        } catch (error) {
          console.debug("EasyPub ignored a stale Blog Control Room session", error);
        }
      }

      const launchError = await electron.shell.openPath(integration.launcherPath);
      if (launchError) throw new Error(launchError);
      new Notice("正在启动博客管理后台，浏览器将自动打开");
    } catch (error) {
      console.error("EasyPub could not open Blog Control Room", error);
      new Notice(`无法打开博客管理后台：${this.getErrorMessage(error)}`);
    }
  }

  async buildHexoLocally() {
    if (!this.settings.hexoRepoPath) {
      new Notice("请先在设置中填写 Hexo 仓库路径");
      return;
    }
    if (this.deployInProgress || this.pubIdBatchInProgress) {
      new Notice("Hexo 任务正在进行，请稍候");
      return;
    }

    this.deployInProgress = true;
    new Notice("正在本地生成 Hexo 站点...");
    try {
      await buildHexo(this.settings.hexoRepoPath);
      try {
        await this.refreshActiveHexoPublishUrl();
      } catch (error) {
        console.warn("EasyPub could not refresh Hexo publish URL", error);
      }
      new Notice("Hexo 本地生成成功，未执行部署");
    } catch (error) {
      console.error("EasyPub Hexo build failed", error);
      new Notice(`Hexo 生成失败：${this.getErrorMessage(error)}`);
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

  private async prepareHexoContent(
    sourceFile: TFile,
    content: string,
    pubId: string
  ): Promise<PreparedPublishContent> {
    if (!content.includes("![[")) {
      return { content, assets: [], picgoUploads: [] };
    }

    const rootPath = await getHexoRootPath(this.settings.hexoRepoPath);
    const prepared = await prepareImageEmbeds(content, async (linkPath) => {
      const attachment = this.app.metadataCache.getFirstLinkpathDest(
        linkPath,
        sourceFile.path
      );
      const requestedExtension = path.extname(linkPath).slice(1).toLowerCase();
      if (!attachment) {
        if (HEXO_IMAGE_EXTENSIONS.has(requestedExtension)) {
          throw new Error(`找不到图片附件：${linkPath}`);
        }
        return null;
      }
      if (!HEXO_IMAGE_EXTENSIONS.has(attachment.extension.toLowerCase())) {
        return null;
      }

      const binary = await this.app.vault.readBinary(attachment);
      const contentHash = createHash("sha256").update(new Uint8Array(binary)).digest("hex");
      const targetPath = getHexoAssetTargetPath(this.settings, pubId, attachment.path, contentHash);
      const relativePath = getHexoAssetRelativePath(pubId, targetPath);
      const encodedRelativePath = relativePath
        .split("/")
        .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`))
        .join("/");
      return {
        url: `${rootPath}${encodedRelativePath}`,
        alt: attachment.basename,
        asset: {
          sourcePath: attachment.path,
          targetPath,
          contentHash,
        },
      };
    });
    return { ...prepared, picgoUploads: [] };
  }

  private async preparePicGoContent(
    sourceFile: TFile,
    content: string
  ): Promise<PreparedPublishContent> {
    if (!content.includes("![[")) {
      return { content, assets: [], picgoUploads: [] };
    }
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("当前 Vault 不是本地文件系统，无法通过 PicGo 上传附件");
    }

    const uploads = new Map<string, PicGoPendingUpload>();
    const imageChecks: Array<{ sourcePath: string; contentHash: string }> = [];
    const resolvedImages = new Map<string, { url: string; alt: string }>();
    const prepared = await prepareImageEmbeds(content, async (linkPath) => {
      const attachment = this.app.metadataCache.getFirstLinkpathDest(
        linkPath,
        sourceFile.path
      );
      const requestedExtension = path.extname(linkPath).slice(1).toLowerCase();
      if (!attachment) {
        if (HEXO_IMAGE_EXTENSIONS.has(requestedExtension)) {
          throw new Error(`找不到图片附件：${linkPath}`);
        }
        return null;
      }
      if (!HEXO_IMAGE_EXTENSIONS.has(attachment.extension.toLowerCase())) {
        return null;
      }

      const known = resolvedImages.get(attachment.path);
      if (known) {
        return known;
      }

      const binary = await this.app.vault.readBinary(attachment);
      const contentHash = createHash("sha256")
        .update(new Uint8Array(binary))
        .digest("hex");
      imageChecks.push({ sourcePath: attachment.path, contentHash });
      const cached = this.settings.picgoImageCache[attachment.path];
      if (
        cached?.hash === contentHash
        && /^https?:\/\//.test(cached.url)
      ) {
        const result = { url: cached.url, alt: attachment.basename };
        resolvedImages.set(attachment.path, result);
        return result;
      }

      const token = `easy-pub-picgo://${createHash("sha256").update(attachment.path).digest("hex")}${contentHash}`;
      uploads.set(attachment.path, {
        sourcePath: attachment.path,
        localPath: adapter.getFullPath(attachment.path),
        contentHash,
        token,
      });
      const result = { url: token, alt: attachment.basename };
      resolvedImages.set(attachment.path, result);
      return result;
    });

    return {
      ...prepared,
      picgoUploads: [...uploads.values()],
      imageChecks,
    };
  }

  private async resolvePicGoUploads(
    content: string,
    uploads: PicGoPendingUpload[]
  ): Promise<{
    content: string;
    cacheUpdates: Record<string, PicGoImageCacheEntry>;
  }> {
    if (uploads.length === 0) {
      return { content, cacheUpdates: {} };
    }

    const urls = await uploadWithPicGo(
      uploads.map((upload) => upload.localPath),
      {
        serverUrl: this.settings.picgoServerUrl,
        secret: this.settings.picgoServerSecret,
      },
      async (request) => {
        const response = await withTimeout(requestUrl({
          url: request.url,
          method: "POST",
          headers: request.headers,
          body: request.body,
          throw: false,
        }), 60000, "PicGo 上传等待超过 60 秒，本次发布已停止；请先检查 PicGo 中的上传结果");
        return { status: response.status, json: response.json };
      }
    );

    let resolvedContent = content;
    const cacheUpdates: Record<string, PicGoImageCacheEntry> = {};
    uploads.forEach((upload, index) => {
      const url = urls[index];
      resolvedContent = resolvedContent.split(upload.token).join(url);
      cacheUpdates[upload.sourcePath] = {
        hash: upload.contentHash,
        url,
      };
    });
    return { content: resolvedContent, cacheUpdates };
  }

  private async copyPublishAssets(assets: PublishAsset[], created: string[]): Promise<void> {
    for (const asset of assets) {
      const sourceFile = this.app.vault.getAbstractFileByPath(asset.sourcePath);
      if (!(sourceFile instanceof TFile)) {
        throw new Error(`找不到图片附件：${asset.sourcePath}`);
      }
      const content = await this.app.vault.readBinary(sourceFile);
      const bytes = new Uint8Array(content);
      if (!asset.contentHash || createHash("sha256").update(bytes).digest("hex") !== asset.contentHash) {
        throw new Error("图片在确认期间发生变化，请重新发布");
      }
      if (await writeImmutableAsset(asset.targetPath, bytes, asset.contentHash)) created.push(asset.targetPath);
    }
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

    const targetPath = await this.findArticleByPubId(hexoPlatform, pubId, sourceData, activeFile.path);
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

    assertPublishUnchanged(publishedContent, await this.readPublishFile(hexoPlatform, targetPath));
    await this.writePublishFile(
      hexoPlatform,
      targetPath,
      stringifyFrontMatter(publishedParsed.content, {
        ...publishedParsed.data,
        publish_url: publishUrl,
      }),
      publishedContent
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
    contentEl.addClass("easy-pub-platform-modal");
    contentEl.createEl("p", { text: "选择目标平台后生成或打开对应稿件。微信公众号最终发布在微信后台完成。" });

    for (const platform of this.platforms) {
      new Setting(contentEl)
        .setName(platform.name)
        .setDesc(platform.isExternal ? "保存到 Hexo 仓库；后续构建与部署按设置执行" : platform.id === "wechat" ? "打开已有本地成稿，或首次生成后进入预览工作台" : `生成或更新 ${platform.path} 本地稿，供后续编辑`)
        .addButton((btn) =>
          btn.setButtonText(platform.id === "wechat" ? "打开工作台" : "准备稿件").onClick(() => {
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
