import { PublishingView, PUBLISHING_VIEW } from "./views/PublishingView";
import { openHexoInObsidian, registerHexoEditing } from "./utils/hexoEditing";
import { DraftSyncSession } from "./utils/draftSync";
import { DraftSyncModal } from "./modals/DraftSyncModal";
import { formatHexoMarkdown } from "./utils/hexoFormatting";
import { HexoFormatModal } from "./modals/HexoFormatModal";
import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { startControlRoom } from "./utils/controlRoomLauncher";
import { HEXO_PREVIEW_VIEW, HexoPreviewView, hexoPreviewPath } from "./views/HexoPreviewView";
import type { ControlRoomSession } from "./utils/controlRoom";
import { FileSystemAdapter, Notice, Plugin, TFile, TFolder, normalizePath, requestUrl } from "obsidian";
import { EasyPubSettingTab } from "./settings";
import { PluginSettings, ArticleMeta, ArticleDiff, Platform, PLATFORMS, FrontMatterData, PublishAsset, PicGoImageCacheEntry, PicGoPendingUpload } from "./types";
import {
  parseFrontMatter,
  stringifyFrontMatter,
  generatePubId,
  getFrontMatterString,
  mergePublishedFrontMatter,
  mergeSourceFrontMatter,
  normalizeChildReferences,
} from "./utils/frontMatter";
import { buildHexo, deployHexo, validateHexoBlog } from "./utils/hexoCommands";
import { DiffModal } from "./modals/DiffModal";
import { BatchPubIdModal } from "./modals/BatchPubIdModal";
import { PublishDirectoryModal } from "./modals/PublishDirectoryModal";
import { inspectPublishDocuments } from "./utils/publishDiagnostics";
import { fillMissingPubIds, externalPubIdDocuments, needsPubId, PubIdBatchResult } from "./utils/batchPubIds";
import {
  resolveVaultAttachment,
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
import { prepareHexoMetadata } from "./utils/hexoMetadata";
import { prepareImageEmbeds, PreparedImageContent } from "./utils/imageEmbeds";
import { getPicGoHeartbeatUrl, uploadWithPicGo } from "./utils/picgo";
import { confirmPicGoTransport } from "./modals/PicGoTransportModal";
import { isDeepStrictEqual } from "util";
import { assertPublishUnchanged, completeControlRoomMetadata } from "./utils/publishSafety";
import { writeImmutableAsset } from "./utils/publishFiles";
import { withTimeout } from "./utils/async";
import { assertPublishIdentity, PublishIdentityIndex } from "./utils/publishIdentity";
import { locateHexoArticles, invalidateHexoLocator } from "./utils/hexoLocator";
import { PublishLocator } from "./utils/publishLocator";
import { PublishStore } from "./utils/publishStore";
import { PlatformSelectModal } from "./modals/PlatformSelectModal";
import { chooseArticleProperties } from "./modals/ArticlePropertiesModal";
import { applyPropertySelection, asObject, canonicalWechatTitle, initialPlatformProperties, legacyPropertyKeys, platformPropertyFields, SOURCE_FIELDS } from "./utils/articleProperties";
import { isPicGoEnabled, normalizeSettings, publishSettingsFingerprint } from "./utils/settings";
import { WechatApi } from "./utils/wechatApi";
import { decryptWechatSecret, encryptWechatSecret } from "./utils/wechatSecret";
import { restorePicGoSecret, serializePicGoSettings } from "./utils/picgoSecret";
import { rebaseWechatImages } from "./utils/wechatMarkdown";
import { relativeVaultAttachment } from "./utils/platforms";
import { WECHAT_VIEW, WechatView, isWechatDraft } from "./views/WechatView";
import { WechatSetupModal } from "./modals/WechatSetupModal";
import { WechatAiSettingsModal } from "./modals/WechatAiSettingsModal";
import { normalizeAiSettings, validateAiEndpoint } from "./utils/wechatAiProvider";
import { clearWechatLayoutCache } from "./utils/wechatAiPlanner";
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
  private controlRoomOpening = false;
  private pubIdBatchInProgress = false;
  wechatSyncInProgress = false;
  wechatCredentialRevision = 0;
  private wechatSessionSecret = "";
  private wechatAiSessionKey = "";
  private wechatAiSessionEndpoint = "";
  private wechatAiConfigPending = false;
  private settingsSaveQueue?: Promise<void>;
  settingsRecoveryRequired = false;
  private wechatApi?: WechatApi;
  private wechatApiIdentity = "";

  private identityIndex?: PublishIdentityIndex;
  private publishLocators?: Map<string, PublishLocator>;

  async onload() {
    await this.loadSettings();
    registerHexoEditing(this, () => this.settings.hexoRepoPath);
    this.registerView(PUBLISHING_VIEW, leaf => new PublishingView(leaf, this));
    this.addRibbonIcon("panels-top-left", "打开 EasyPub 发布面板", () => { void this.openPublishingPanel().catch(error => new Notice(this.getErrorMessage(error))); });
    this.addCommand({ id: "open-publishing-panel", name: "打开发布面板", callback: () => this.openPublishingPanel() });
    this.addCommand({id:"sync-draft-body",name:"将本稿改动同步到其他发布稿",callback:()=>{
      void this.syncDraftBody().catch(error=>new Notice(this.getErrorMessage(error)));
    }});
    this.addCommand({ id: "format-hexo", name: "一键排版 Hexo 发布稿", callback: () => {
      void this.formatHexoArticle().catch(error => new Notice(this.getErrorMessage(error)));
    } });
    this.app.workspace.onLayoutReady(() => {
      if (!this.settings.workbenchIntroduced && !this.settingsRecoveryRequired) {
        void this.openPublishingPanel().then(async () => {
          this.settings.workbenchIntroduced = true; await this.saveSettings();
        }).catch(error => new Notice(this.getErrorMessage(error)));
      }
    });
    this.registerView(HEXO_PREVIEW_VIEW, leaf => new HexoPreviewView(leaf));
    this.addCommand({ id: "preview-hexo", name: "预览 Hexo 发布效果", callback: () => void this.previewHexoArticle() });
    this.identityIndex = new PublishIdentityIndex();
    const invalidateIdentity = (file: {path: string}, oldPath?: string) => { this.identityIndex?.invalidate(file); invalidateHexoLocator(this,file.path,oldPath); this.publishLocators?.forEach(locator => locator.invalidate(file.path, oldPath)); };
    this.registerEvent(this.app.vault.on("create", invalidateIdentity));
    this.registerEvent(this.app.vault.on("modify", invalidateIdentity));
    this.registerEvent(this.app.vault.on("delete", invalidateIdentity));
    this.registerEvent(this.app.vault.on("rename", invalidateIdentity));

    this.registerView(WECHAT_VIEW, leaf => new WechatView(leaf, this));
    this.addCommand({ id: "wechat-setup", name: "引导配置微信公众号", callback: () => this.openWechatSetup() });
    this.addCommand({ id: "wechat-preview", name: "预览并同步公众号草稿", callback: () => {
      void this.openActiveWechatDraft().catch(error => new Notice((error as Error).message));
    } });
    this.addCommand({ id: "wechat-refresh-source", name: "从源文章更新公众号本地稿（确认后替换正文）", callback: () => {
      void this.preparePublish(PLATFORMS.find(p => p.id === "wechat")!, true, { configure: true });
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
    this.addCommand({ id: "initialize-source-properties", name: "初始化原稿属性", callback: () => {
      void this.initializeSourceProperties().catch(error => new Notice(this.getErrorMessage(error)));
    } });
    this.addCommand({ id: "refresh-platform-properties", name: "从原稿刷新平台属性（选择字段）", callback: () => this.showPlatformSelector(true) });
    this.addCommand({
      id: "fill-missing-pub-ids",
      name: "批量补齐文件夹中的 pub_id",
      callback: () => this.showBatchPubIdModal(),
    });
    this.addCommand({ id: "check-publish-directory", name: "检查发布目录（只读）", callback: () => {
      new PublishDirectoryModal(this.app, (platform, cancelled) => this.inspectPublishDirectory(platform, cancelled)).open();
    } });
  }

  async inspectPublishDirectory(platform: Platform, cancelled: () => boolean = () => false) {
    const settings = { ...this.settings };
    if (platform.isExternal) await validateHexoBlog(settings.hexoRepoPath);
    const roots = [getPublishPath(platform, settings)];
    if (platform.id === "hexo") roots.push(path.join(settings.hexoRepoPath, "source", "_drafts"));
    const files = new Set<string>();
    for (const root of roots) {
      if (cancelled()) throw new Error("检查已取消");
      if (platform.isExternal) {
        if (await this.publishDirectoryExists(platform, root)) {
          for (const file of await this.listPublishFiles(platform, root)) if (file.endsWith(".md")) files.add(file);
        }
      } else {
        for (const file of this.app.vault.getMarkdownFiles()) if (file.path.startsWith(`${root}/`)) files.add(file.path);
      }
    }
    return inspectPublishDocuments([...files].sort().map(file => ({ path: file, read: () => this.readPublishFile(platform, file) })), cancelled);
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

  onunload() { clearWechatLayoutCache(); this.wechatAiSessionKey = ""; this.wechatSessionSecret = ""; this.settings.picgoServerSecret = ""; this.wechatApi = undefined; this.identityIndex?.clear(); invalidateHexoLocator(this); this.publishLocators?.forEach(locator => locator.invalidate()); }

  openWechatAiSettings(finished?: () => void) { new WechatAiSettingsModal(this, finished).open(); }

  getWechatAiConfiguration() {
    const settings = normalizeAiSettings(this.settings.wechatAi);
    const session = this.wechatAiSessionEndpoint === settings.endpoint ? this.wechatAiSessionKey : "";
    const key = session || decryptWechatSecret(settings.encryptedKey);
    if (settings.encryptedKey && !key) throw new Error("AI 密钥无法在本机解密，请重新填写；原密文仍保留");
    return { settings, key };
  }

  async saveWechatAiConfiguration(endpoint: string, model: string, key: string, jsonMode: boolean): Promise<boolean> {
    this.assertSettingsWritable();
    if (this.wechatAiConfigPending) throw new Error("AI 服务配置正在保存，请稍候");
    endpoint = validateAiEndpoint(endpoint);
    if (!model || model.length > 200 || /[\r\n]/.test(model) || /[\r\n]/.test(key)) throw new Error("模型或密钥格式无效");
    const previous = this.settings.wechatAi, session = this.wechatAiSessionKey, sessionEndpoint = this.wechatAiSessionEndpoint;
    const sameEndpoint = previous?.endpoint === endpoint;
    const effectiveKey = key || (sameEndpoint ? this.getWechatAiConfiguration().key : "");
    this.settings.wechatAi = {endpoint, model, jsonMode,
      encryptedKey: key ? encryptWechatSecret(key) : sameEndpoint ? previous!.encryptedKey : ""};
    this.wechatAiSessionKey = effectiveKey;
    this.wechatAiSessionEndpoint = endpoint;
    this.wechatAiConfigPending = true;
    try { await this.saveSettings(); }
    catch (error) { this.settings.wechatAi = previous; this.wechatAiSessionKey = session; this.wechatAiSessionEndpoint = sessionEndpoint; throw error; }
    finally { this.wechatAiConfigPending = false; }
    return Boolean(this.settings.wechatAi.encryptedKey);
  }

  async clearWechatAiKey() {
    this.assertSettingsWritable();
    if (this.wechatAiConfigPending) throw new Error("AI 服务配置正在保存，请稍候");
    const previous = this.settings.wechatAi, session = this.wechatAiSessionKey;
    this.wechatAiSessionKey = "";
    this.settings.wechatAi = {...normalizeAiSettings(previous), encryptedKey: ""};
    this.wechatAiConfigPending = true;
    try { await this.saveSettings(); }
    catch (error) { this.settings.wechatAi = previous; this.wechatAiSessionKey = session; throw error; }
    finally { this.wechatAiConfigPending = false; }
    clearWechatLayoutCache();
  }

  relativeWechatAttachment(draftPath: string, attachmentPath: string): string {
    return relativeVaultAttachment(draftPath, attachmentPath);
  }

  async setWechatSecret(secret: string): Promise<boolean> {
    this.assertSettingsWritable();
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
    this.assertSettingsWritable();
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
    this.assertSettingsWritable();
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
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!leaf) throw new Error("无法打开公众号工作台");
    if (!existing) await leaf.setViewState({ type: WECHAT_VIEW, active: true });
    await (leaf.view as WechatView).bind(file);
    await this.app.workspace.revealLeaf(leaf);
    for (const panel of this.app.workspace.getLeavesOfType(PUBLISHING_VIEW)) {
      if (panel.view instanceof PublishingView) await panel.view.followFile(file);
    }
  }

  async openPublishingPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PUBLISHING_VIEW)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) throw new Error("无法打开 EasyPub 发布面板");
    if (!existing) await leaf.setViewState({ type: PUBLISHING_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async resolvePublishingSource(file: TFile, meta: FrontMatterData): Promise<TFile | null> {
    const raw = getFrontMatterString(meta, "source_file");
    if (!raw) return file;
    const link = raw.replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0];
    // Native external files resolve relative links outside the Vault. Source associations are Vault-root paths.
    const resolved=this.app.metadataCache.getFirstLinkpathDest(link, file.path);
    const exact = !resolved && !path.isAbsolute(link) && !link.startsWith("file:")
      ? this.app.vault.getAbstractFileByPath(link) ?? this.app.vault.getAbstractFileByPath(`${link}.md`) : null;
    const source = resolved ?? (exact instanceof TFile ? exact : null);
    if (!source || source.extension !== "md" || source === file) return null;
    const sourceMeta = parseFrontMatter(await this.app.vault.read(source), true).data;
    const id = getFrontMatterString(meta, "pub_id");
    return id && id === getFrontMatterString(sourceMeta, "pub_id") && !sourceMeta.source_file ? source : null;
  }

  async hasRelatedDraft(source: TFile, platform: Platform): Promise<boolean> {
    const meta = parseFrontMatter(await this.app.vault.read(source), true).data;
    const id = getFrontMatterString(meta, "pub_id");
    if (!id) return false;
    if (platform.isExternal) await validateHexoBlog(this.settings.hexoRepoPath);
    return Boolean(await this.findArticleByPubId(platform, id, meta, source.path));
  }

  async openRelatedDraft(source: TFile, platform: Platform): Promise<void> {
    const meta = parseFrontMatter(await this.app.vault.read(source), true).data;
    const id = getFrontMatterString(meta, "pub_id");
    if (!id) throw new Error("请先从原稿创建发布稿");
    if (platform.isExternal) await validateHexoBlog(this.settings.hexoRepoPath);
    const target = await this.findArticleByPubId(platform, id, meta, source.path);
    if (!target) throw new Error(`尚未创建${platform.name}发布稿，请使用“创建 / 更新发布稿”`);
    if (platform.isExternal) {
      await this.openPublishedFile(target, platform); return;
    }
    const file = this.app.vault.getAbstractFileByPath(target);
    if (!(file instanceof TFile)) throw new Error("发布稿已移动，请刷新后重试");
    if (platform.id === "wechat") await this.openWechatDraft(file);
    else await this.app.workspace.getLeaf(false).openFile(file);
  }

  async formatHexoArticle(selected?: TFile): Promise<void> {
    this.assertSettingsWritable();
    const active = selected ?? this.app.workspace.getActiveFile();
    if (!active || active.extension !== "md") throw new Error("请先打开关联 Hexo 稿件的原稿");
    const data = parseFrontMatter(await this.app.vault.read(active), true).data;
    const source = await this.resolvePublishingSource(active, data);
    if (!source) throw new Error("未找到关联原稿");
    const sourcePath = source.path;
    const sourceText = await this.app.vault.read(source);
    const meta = parseFrontMatter(sourceText, true).data;
    const id = getFrontMatterString(meta, "pub_id");
    if (!id) throw new Error("请先生成 Hexo 发布稿");
    const repository = this.settings.hexoRepoPath;
    await validateHexoBlog(repository);
    const hexo = PLATFORMS.find(p => p.id === "hexo")!;
    const target = await this.findArticleByPubId(hexo, id, meta, source.path);
    if (!target) throw new Error("未找到 Hexo 发布稿，请先生成稿件");
    const before = await this.readPublishFile(hexo, target);
    const result = formatHexoMarkdown(before);
    if (result.content === before) { new Notice("Hexo 发布稿已经符合排版规则"); return; }
    new HexoFormatModal(this.app, target, before, result, async assertActive => {
      if (this.publishInProgress || this.publishConfirmationOpen || this.deployInProgress) throw new Error("已有发布任务正在进行，请稍候");
      this.publishInProgress = true;
      let sourceInvalidated = false;
      const sourceEvents: ReturnType<typeof this.app.vault.on>[] = [];
      try {
        const invalidate = (file: unknown) => { if (file === source) sourceInvalidated = true; };
        sourceEvents.push(this.app.vault.on("modify", invalidate), this.app.vault.on("rename", invalidate), this.app.vault.on("delete", invalidate));
        if (repository !== this.settings.hexoRepoPath || sourceText !== await this.app.vault.read(source)) throw new Error("原稿或博客配置已变化，请重新排版");
        if (target !== await this.findArticleByPubId(hexo, id, meta, source.path)) throw new Error("发布稿已移动，请重新排版");
        const guard = () => {
          assertActive(); this.assertSettingsWritable();
          if (sourceInvalidated) throw new Error("原稿内容或状态已变化，请重新排版");
          if (repository !== this.settings.hexoRepoPath || source.path !== sourcePath) throw new Error("原稿路径或博客配置已变化，请重新排版");
        };
        guard();
        await this.getPublishStore().writePublishFile(hexo, target, result.content, before, guard, async () => {
          guard();
          if (sourceText !== await this.app.vault.read(source)) throw new Error("原稿内容已变化，请重新排版");
          guard();
        });
        new Notice("Hexo 排版已保存；需要恢复时可在设置中查看发布稿备份并手动恢复");
      } finally { sourceEvents.forEach(event => this.app.vault.offref(event)); this.publishInProgress = false; }
    }).open();
  }

  async loadSettings() {
    try {
      const data = await this.loadData();
      if (data !== null && data !== undefined && (typeof data !== "object" || Array.isArray(data))) throw new Error("Invalid settings document");
      this.settings = normalizeSettings(data);
      this.settingsRecoveryRequired = false;
    } catch {
      this.settingsRecoveryRequired = true;
      this.settings = normalizeSettings(null);
      console.warn("EasyPub settings could not be read; saving is locked");
      new Notice("EasyPub 设置读取失败，已禁止保存以保护原配置。请在插件设置中重新读取，或备份后明确重置。", 10000);
    }
    if (isPicGoEnabled(this.settings)) await this.initializePicGoCredentials();
  }

  async initializePicGoCredentials(): Promise<void> {
    if (!isPicGoEnabled(this.settings)) return;
    const legacySecret = this.settings.picgoServerSecret && !this.settings.picgoEncryptedSecret;
    if (legacySecret) this.settings.picgoEncryptedSecret = "";
    restorePicGoSecret(this.settings);
    if (legacySecret) {
      try { await this.saveSettings(); }
      catch { new Notice("PicGo 旧密钥已载入，但安全迁移保存失败；磁盘上的旧配置可能仍含明文，请重试保存。", 10000); }
      if (!this.settings.picgoEncryptedSecret) new Notice("系统加密不可用，PicGo 密钥仅在本次会话保留，重启后需要重新填写。", 10000);
    }
  }

  async saveSettings() {
    this.assertSettingsWritable();
    const secret = this.settings.picgoServerSecret;
    const saved = serializePicGoSettings(this.settings);
    const snapshot = JSON.parse(JSON.stringify(saved));
    const write = (this.settingsSaveQueue ?? Promise.resolve()).catch(() => {}).then(() => {
      this.assertSettingsWritable();
      return this.saveData(snapshot);
    });
    this.settingsSaveQueue = write;
    await write;
    if (this.settings.picgoServerSecret === secret) this.settings.picgoEncryptedSecret = saved.picgoEncryptedSecret;
  }

  assertSettingsWritable() {
    if (this.settingsRecoveryRequired) throw new Error("配置读取失败，已禁止保存；请在 EasyPub 设置中重新读取或备份后重置");
  }

  async backupAndResetSettings(): Promise<string> {
    if (!this.settingsRecoveryRequired) throw new Error("当前配置无需重置");
    if (this.wechatSyncInProgress || this.publishInProgress || this.publishConfirmationOpen) throw new Error("请先等待发布任务完成");
    await this.settingsSaveQueue?.catch(() => {});
    const adapter = this.app.vault.adapter;
    if (!this.manifest.dir) throw new Error("无法定位原配置，未重置");
    const file = `${this.manifest.dir}/data.json`;
    const original = await adapter.read(file);
    const backup = `${file}.recovery-${Date.now()}.bak`;
    if (await adapter.exists(backup)) throw new Error("备份路径已存在，请重试");
    await adapter.write(backup, original);
    if (await adapter.read(backup) !== original || await adapter.read(file) !== original) throw new Error("备份校验失败或原配置发生变化，未重置");
    const previous = this.settings;
    this.settings = normalizeSettings(null);
    this.settingsRecoveryRequired = false;
    try { await this.saveSettings(); }
    catch (error) { this.settings = previous; this.settingsRecoveryRequired = true; throw error; }
    this.wechatAiSessionKey = ""; this.wechatSessionSecret = ""; this.wechatApi = undefined;
    return backup;
  }

  async setWechatRemoteImages(allowed: boolean): Promise<void> {
    this.assertSettingsWritable();
    if ((this.settings.wechat.allowRemoteImages !== false) === allowed) return;
    this.settings.wechat.allowRemoteImages = allowed;
    for (const leaf of this.app.workspace.getLeavesOfType(WECHAT_VIEW)) {
      if (leaf.view instanceof WechatView) leaf.view.invalidateImagePolicy();
    }
    await this.saveSettings();
  }

  async testPicGoConnection(): Promise<void> {
    if (!isPicGoEnabled(this.settings)) return;
    try {
      const response = await withTimeout(requestUrl({
        url: getPicGoHeartbeatUrl(this.settings.picgoServerUrl),
        method: "POST",
        throw: false,
      }), 10000, "PicGo 连接检查超时，请确认 Server 已启动");
      const data = response.json as { success?: boolean; result?: string };
      if (response.status === 200 && data?.success === true) {
        new Notice("PicGo 服务可达；未验证上传认证和图床配置。实际上传时继续检查。");
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      console.warn("EasyPub PicGo heartbeat failed", error);
      new Notice(`无法连接 PicGo Server：${this.getErrorMessage(error)}`);
    }
  }

  async initializeSourceProperties() {
    this.assertSettingsWritable();
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") throw new Error("请先打开 Markdown 原稿");
    if (this.publishInProgress || this.publishConfirmationOpen || this.pubIdBatchInProgress) throw new Error("已有 EasyPub 任务正在进行，请稍候");
    this.publishInProgress = true;
    try {
      const filePath = file.path, snapshot = await this.app.vault.read(file);
      const parsed = parseFrontMatter(snapshot, true);
      if (parsed.data.source_file || PLATFORMS.filter(p => !p.isExternal).some(p => filePath.startsWith(`${getPublishPath(p, this.settings)}/`))) {
        throw new Error("当前文件是发布稿，请打开原稿后初始化");
      }
      const selection = await chooseArticleProperties(this.app, { title: "初始化原稿属性",
        description: "填写通用文章信息。自定义属性保留；缺失的 pub_id 在确认后生成，发布稿关联在发布后建立。",
        attachmentSourcePath: filePath, fields: SOURCE_FIELDS, current: { ...parsed.data, title: parsed.data.title || file.basename }, suggested: {} });
      if (!selection) return;
      if (file.path !== filePath || await this.app.vault.read(file) !== snapshot) throw new Error("原稿已变化，请重新初始化");
      await this.app.fileManager.processFrontMatter(file, data => {
        if (file.path !== filePath || !isDeepStrictEqual(data, parsed.data)) throw new Error("原稿属性已变化，请重新初始化");
        const result = applyPropertySelection(data, selection);
        if (needsPubId(result.pub_id)) result.pub_id = generatePubId();
        Object.assign(data, result);
      });
      new Notice("原稿属性已初始化");
    } finally { this.publishInProgress = false; }
  }

  showPlatformSelector(refreshProperties = false, selected?: TFile) {
    const activeFile = selected ?? this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("请先打开要发布的文章");
      return;
    }

    new PlatformSelectModal(this.app, PLATFORMS, async (platform) => {
      if (platform) {
        await this.preparePublish(platform, false, { configure: true, propertiesOnly: refreshProperties, sourceFile: activeFile });
      }
    }, refreshProperties).open();
  }

  async preparePublish(platform: Platform, updateWechatFromSource = false, options: { configure?: boolean; propertiesOnly?: boolean; sourceFile?: TFile } = {}) {
    if (this.publishInProgress || this.publishConfirmationOpen || this.pubIdBatchInProgress) {
      new Notice("已有发布任务正在进行，请稍候");
      return;
    }

    this.publishInProgress = true;
    try {
      await this.performPublish(platform, updateWechatFromSource, options);
    } catch (error) {
      console.error("EasyPub publish failed", error);
      new Notice(`发布失败：${this.getErrorMessage(error)}`);
    } finally {
      this.publishInProgress = false;
    }
  }

  private async performPublish(platform: Platform, updateWechatFromSource = false, options: { configure?: boolean; propertiesOnly?: boolean; sourceFile?: TFile } = {}) {
    this.assertSettingsWritable();
    const activeFile = options.sourceFile ?? this.app.workspace.getActiveFile();
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
    const settingsFingerprint = publishSettingsFingerprint(this.settings, platform.id);
    const sourceParsed = parseFrontMatter(content, true);
    if (sourceParsed.data.source_file && (platform.id !== "wechat" || options.propertiesOnly)) throw new Error("请打开原稿后生成或刷新平台稿件");
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

    if (options.propertiesOnly && !existingContent) throw new Error("未找到此平台发布稿，请先生成稿件");
    if (platform.id === "wechat" && existingPath && !updateWechatFromSource && !options.propertiesOnly) {
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
    const initial = initialPlatformProperties(platform.id, sourceDataWithPubId,
      getFrontMatterString(sourceDataWithPubId, "title") || activeFile.basename, this.settings.wechat.defaultAuthor);
    const existingData = existingContent !== null ? parseFrontMatter(existingContent, true).data : undefined;
    let selectedProperties = existingData === undefined ? initial : platform.id === "wechat" ? canonicalWechatTitle(existingData) : existingData;
    let refreshCover = !existingData;
    if (options.configure && (isNew || options.propertiesOnly)) {
      const selection = await chooseArticleProperties(this.app, { title: options.propertiesOnly ? `刷新${platform.name}属性` : `生成${platform.name}稿件`,
        description: options.propertiesOnly ? "勾选要从原稿刷新的字段，可调整建议值。正文和首次日期保留。" : "确认该平台的文章属性；后续更新正文时保留这些设置。",
        attachmentSourcePath: activeFile.path, fields: platformPropertyFields(platform.id), current: selectedProperties, suggested: initial,
        refresh: options.propertiesOnly, removable: existingData ? legacyPropertyKeys(platform.id, existingData) : [] });
      if (!selection) return;
      refreshCover = refreshCover || Object.prototype.hasOwnProperty.call(selection.values, platform.id === "wechat" ? "wechat.cover" : "cover");
      selectedProperties = applyPropertySelection(selectedProperties, selection);
    }
    const title = getFrontMatterString(selectedProperties, "title") || activeFile.basename;
    const subFolder = getSubFolder(platform, selectedProperties);
    const desiredTargetPath = getTargetPath(platform, this.settings, title, subFolder);
    let targetPath = existingPath || desiredTargetPath;
    if (!existingPath && await this.publishPathExists(platform, desiredTargetPath)) {
      targetPath = await this.getAvailableTargetPath(platform, desiredTargetPath);
      new Notice(`发现同名文件，将保存为 ${this.getDisplayFileName(platform, targetPath)}`);
    }
    const preparedContent: PreparedPublishContent = options.propertiesOnly
      ? { content: parseFrontMatter(existingContent!).content, assets: [], picgoUploads: [] }
      : platform.id === "wechat"
      ? { content: await rebaseWechatImages(this.app, sourceParsed.content, activeFile.path, targetPath), assets: [], picgoUploads: [] }
      : isPicGoEnabled(this.settings, platform.id)
      ? await this.preparePicGoContent(activeFile, sourceParsed.content)
      : platform.id === "hexo"
        ? await this.prepareHexoContent(activeFile, sourceParsed.content, pubId)
        : { content: sourceParsed.content, assets: [], picgoUploads: [] };
    let proposedPublishedData = await this.buildPublishedFrontMatter(
      platform,
      activeFile,
      sourceDataWithPubId,
      existingContent,
      pubId,
      new Date().toISOString(),
      targetPath,
      selectedProperties
    );
    if (platform.id !== "hexo" && refreshCover) {
      // Only newly inherited/refreshed cover paths are relative to the source.
      const properties = platform.id === "wechat" ? asObject(proposedPublishedData.wechat) : proposedPublishedData;
      const cover = properties.cover;
      if (typeof cover === "string" && cover) {
        if (!/^https?:\/\//i.test(cover)) {
          const link = cover.replace(/^!?\[\[|\]\]$/g, "").split("|", 1)[0];
          const attachment = resolveVaultAttachment(this.app, link, activeFile.path);
          if (!(attachment instanceof TFile) || !HEXO_IMAGE_EXTENSIONS.has(attachment.extension.toLowerCase())) throw new Error(`找不到封面附件：${cover}`);
          properties.cover = platform.id === "wechat" ? relativeVaultAttachment(targetPath, attachment.path) : `[[${attachment.path}]]`;
        }
      }
      if (platform.id === "wechat" && properties.cover !== asObject(existingData?.wechat).cover) {
        delete properties.cropWide; delete properties.cropSquare;
      }
    }
    if (platform.id === "hexo") {
      proposedPublishedData = await prepareHexoMetadata(proposedPublishedData, title, async markdown => {
        const image = isPicGoEnabled(this.settings, platform.id)
          ? await this.preparePicGoContent(activeFile, markdown)
          : await this.prepareHexoContent(activeFile, markdown, pubId);
        preparedContent.assets.push(...image.assets);
        preparedContent.picgoUploads.push(...image.picgoUploads);
        preparedContent.imageChecks = [...(preparedContent.imageChecks ?? []), ...(image.imageChecks ?? [])];
        return image.content;
      });
      preparedContent.assets = [...new Map(preparedContent.assets.map(asset => [asset.targetPath, asset])).values()];
      preparedContent.picgoUploads = [...new Map(preparedContent.picgoUploads.map(upload => [upload.token, upload])).values()];
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
    sourcePath?: string,
    strict = false
  ): Promise<string | null> {
    if(platform.id==="hexo") {
      const matches=await locateHexoArticles(this,this.settings.hexoRepoPath,pubId,strict);
      if(sourcePath)await assertPublishIdentity(this.app,sourcePath,pubId,[...matches].map(([path,content])=>({path,content})),
        PLATFORMS.filter(platform=>!platform.isExternal).map(platform=>getPublishPath(platform,this.settings)),this.identityIndex);
      return matches.keys().next().value??null;
    }
    const subFolder = getSubFolder(platform, meta);
    const candidates = new Set<string>();

    // 先检查已知路径
    const title = getFrontMatterString(meta, "title");
    if (title) {
      const expectedPath = getTargetPath(platform, this.settings, title, subFolder);
      if (await this.publishPathExists(platform, expectedPath)) {
        candidates.add(expectedPath);
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
          candidates.add(file);
        }
      }
    }
    const locators = this.publishLocators ??= new Map<string, PublishLocator>();
    let locator = locators.get(platform.id);
    if (!locator) { locator = new PublishLocator(); locators.set(platform.id, locator); }
    const matches = await locator.find([...candidates], pubId, {
      read: file => this.readPublishFile(platform, file),
      version: file => this.getPublishStore().publishFileVersion(platform, file),
    });
    if (sourcePath) await assertPublishIdentity(this.app, sourcePath, pubId,
      [...matches].map(([path, content]) => ({ path, content })),
      PLATFORMS.filter(platform => !platform.isExternal).map(platform => getPublishPath(platform, this.settings)), this.identityIndex);
    return matches.keys().next().value ?? null;
  }

  async buildPublishedFrontMatter(
    platform: Platform,
    sourceFile: TFile,
    sourceData: FrontMatterData,
    existingContent: string | null,
    pubId: string,
    timestamp: string,
    targetPath: string,
    selectedProperties?: FrontMatterData
  ): Promise<FrontMatterData> {
    const existingData = existingContent ? parseFrontMatter(existingContent).data : undefined;
    let publishedData = mergePublishedFrontMatter({
      platformId: platform.id,
      title: getFrontMatterString(sourceData, "title") || sourceFile.basename,
      defaultAuthor: this.settings.wechat.defaultAuthor,
      sourceData,
      existingData,
      pubId,
      sourceFileLink: createWikiLink(sourceFile.path),
      timestamp,
    });
    if (selectedProperties) {
      const protectedKeys = new Set(["pub_id", "source_file", "date", "updated"]);
      if (platform.id === "hexo") { protectedKeys.add("publish_url"); protectedKeys.add("workflow"); }
      for (const key of Object.keys(publishedData)) if (!protectedKeys.has(key)) delete publishedData[key];
      for (const [key, value] of Object.entries(selectedProperties)) if (!protectedKeys.has(key)) publishedData[key] = value;
    }

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
    if (!isPicGoEnabled(this.settings, platform.id) && diff.picgoUploads?.length) {
      throw new Error("PicGo 已停用，请重新生成发布预览以使用平台默认图片处理。");
    }
    const picgoResult = isPicGoEnabled(this.settings, platform.id) ? await this.resolvePicGoUploads(
      diff.sourceContent,
      diff.picgoUploads ?? []
    ) : { content: diff.sourceContent, cacheUpdates: {} };
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
        const actualPath = await this.findArticleByPubId(platform, diff.pub_id, diff.meta, sourceFile.path, true);
        if (actualPath && path.resolve(actualPath) !== path.resolve(diff.targetPath)) {
          throw new Error("文章已移动到其他位置，请重新发布以保留其状态");
        }
      }
      await this.writePublishFile(platform, diff.targetPath, finalContent, diff.targetContent);
      targetWritten = true;
      await this.validatePublishSource(diff, sourceFile);
      await this.updateSourceFile(sourceFile, platform, diff.targetPath, diff.pub_id,
        diff.sourceSnapshot === undefined ? undefined : { path: diff.sourcePath, data: parseFrontMatter(diff.sourceSnapshot).data });
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

    // The source association has already been written. A mismatch here must not
    // enter rollback or deploy an article that is no longer confirmed.
    try {
      await this.verifyCompletedPublish(diff, sourceFile, finalContent);
    } catch (error) {
      throw new Error(`发布稿及当前源稿已保留，但完成后核对未通过，未执行自动部署。${this.getErrorMessage(error)}。源稿：${sourceFile.path}；目标：${diff.targetPath}。请核对两份稿件后重新发布。`);
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

  async verifyCompletedPublish(diff: ArticleDiff, sourceFile: TFile, expectedTarget?: string): Promise<void> {
    if (diff.sourceSnapshot === undefined) return;
    if (sourceFile.path !== diff.sourcePath) throw new Error("源稿路径已变化");
    const current = parseFrontMatter(await this.app.vault.read(sourceFile));
    const snapshot = parseFrontMatter(diff.sourceSnapshot);
    // Front-matter serializers can normalize CRLF and add a terminal newline.
    const comparableBody = (body: string) => body.replace(/\r\n/g, "\n").replace(/\n$/, "");
    if (comparableBody(current.content) !== comparableBody(snapshot.content)) throw new Error("源稿正文已变化，目标可能仍是确认时的版本");
    const expected = mergeSourceFrontMatter(snapshot.data, diff.pub_id,
      formatChildReference(diff.platform, diff.targetPath), getObsoleteChildReferences(diff.platform, diff.targetPath));
    const ordinaryFields = (data: FrontMatterData) => {
      const { pub_id, source_file, 子文件, ...fields } = data;
      return fields;
    };
    if (!isDeepStrictEqual(ordinaryFields(current.data), ordinaryFields(expected))) {
      throw new Error("源稿元数据已变化，目标可能仍是确认时的版本");
    }
    if (current.data.source_file || getFrontMatterString(current.data, "pub_id") !== diff.pub_id
      || JSON.stringify(normalizeChildReferences(current.data.子文件)) !== JSON.stringify(normalizeChildReferences(expected.子文件))) {
      throw new Error("源稿关联未完成或已变化");
    }
    if (diff.settingsFingerprint !== undefined && diff.settingsFingerprint !== publishSettingsFingerprint(this.settings, diff.platform.id)) {
      throw new Error("发布设置已变化");
    }
    if (expectedTarget !== undefined && await this.readPublishFile(diff.platform, diff.targetPath) !== expectedTarget) {
      throw new Error("目标稿在完成后核对前已变化");
    }
  }

  private async validatePublishSource(diff: ArticleDiff, sourceFile: TFile): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (isSourcePublishTarget(diff.platform, sourceFile.path, diff.targetPath,
      adapter instanceof FileSystemAdapter ? adapter.getBasePath() : undefined)) {
      throw new Error("当前文件就是目标发布稿，请先打开源文章再发布");
    }
    if (diff.settingsFingerprint !== undefined
      && diff.settingsFingerprint !== publishSettingsFingerprint(this.settings, diff.platform.id)) {
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
    pubId: string,
    expected?: { path: string; data: FrontMatterData }
  ) {
    const childReference = formatChildReference(platform, targetPath);
    const obsoleteChildReferences = getObsoleteChildReferences(platform, targetPath);
    await this.app.fileManager.processFrontMatter(sourceFile, (frontmatter) => {
      if (expected && (sourceFile.path !== expected.path
        || ["pub_id", "source_file"].some(key => getFrontMatterString(frontmatter, key) !== getFrontMatterString(expected.data, key))
        || JSON.stringify(normalizeChildReferences(frontmatter.子文件)) !== JSON.stringify(normalizeChildReferences(expected.data.子文件)))) {
        throw new Error("源文章身份或关联已变化，已停止写回，请重新发布");
      }
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
      await openHexoInObsidian(this.app, this.settings.hexoRepoPath, filePath);
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

    new Notice(`稿件已保存：${filePath}`);
  }

  private publishStore?: PublishStore;
  private getPublishStore(): PublishStore {
    return this.publishStore ??= new PublishStore(() => this.app.vault, () => this.settings.hexoRepoPath,
      (message, timeout) => { new Notice(message, timeout); });
  }

  publishPathExists(platform: Platform, filePath: string): Promise<boolean> {
    return this.getPublishStore().publishPathExists(platform, filePath);
  }

  publishDirectoryExists(platform: Platform, directoryPath: string): Promise<boolean> {
    return this.getPublishStore().publishDirectoryExists(platform, directoryPath);
  }

  publishFileVersion(platform:Platform,filePath:string):Promise<string|undefined> {
    return this.getPublishStore().publishFileVersion(platform,filePath);
  }

  readPublishFile(platform: Platform, filePath: string): Promise<string> {
    return this.getPublishStore().readPublishFile(platform, filePath);
  }

  writePublishFile(platform: Platform, filePath: string, content: string, expected?: string | null, assertActive:()=>void=()=>{}, beforeCommit:()=>Promise<void>=async()=>{}): Promise<void> {
    return this.getPublishStore().writePublishFile(platform, filePath, content, expected, assertActive, beforeCommit);
  }

  async syncDraftBody(selected?:TFile):Promise<void> {
    this.assertSettingsWritable();
    if(this.publishInProgress||this.publishConfirmationOpen||this.wechatSyncInProgress||this.pubIdBatchInProgress)throw new Error("请先完成当前发布或同步任务");
    let file=selected??this.app.workspace.getActiveFile();
    const view=this.app.workspace.activeLeaf?.view;
    if(!selected&&view?.getViewType()===WECHAT_VIEW) {
      const state=view.getState();file=typeof state.path==="string"?this.app.vault.getFileByPath(state.path):null;
    }
    if(!file)throw new Error("请先打开需要同步改动的发布稿");
    this.publishInProgress=true;
    let session:DraftSyncSession|undefined;
    try {
      session=await DraftSyncSession.create(this,file);
      this.publishConfirmationOpen=true;
      const modal=new DraftSyncModal(this.app,session,async(previews,guard)=>{
        this.assertSettingsWritable();
        if(this.publishInProgress||this.wechatSyncInProgress)throw new Error("已有发布或公众号同步任务，请稍后重试");
        this.publishInProgress=true;
        try{return await session!.commit(previews,()=>{guard();this.assertSettingsWritable();});}
        finally{this.publishInProgress=false;}
      },()=>{this.publishConfirmationOpen=false;session?.dispose();});
      modal.open();
    } catch(error){this.publishConfirmationOpen=false;session?.dispose();throw error;}
    finally{this.publishInProgress=false;}
  }

  listPublishFiles(platform: Platform, directoryPath: string): Promise<string[]> {
    return this.getPublishStore().listPublishFiles(platform, directoryPath);
  }

  ensurePublishDirectory(platform: Platform, directoryPath: string): Promise<void> {
    return this.getPublishStore().ensurePublishDirectory(platform, directoryPath);
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

  async previewHexoArticle(selected?: TFile): Promise<void> {
    try {
      const file = selected ?? this.app.workspace.getActiveFile();
      if (!file || file.extension !== "md") throw new Error("请先打开要预览的源文章");
      const meta = parseFrontMatter(await this.app.vault.read(file)).data;
      const pubId = getFrontMatterString(meta, "pub_id");
      if (!pubId || !this.settings.hexoRepoPath) throw new Error("请先配置博客路径，并用 EasyPub 生成 Hexo 发布稿");
      const hexo = PLATFORMS.find(platform => platform.id === "hexo")!;
      const target = await this.findArticleByPubId(hexo, pubId, meta, file.path);
      if (!target) throw new Error("未找到 Hexo 发布稿，请先通过 Publish to platform 生成稿件");
      const published = parseFrontMatter(await this.readPublishFile(hexo, target)).data;
      const abbrlink = String(published.abbrlink ?? "");
      hexoPreviewPath(abbrlink);
      await this.openHexoControlRoom(async session => {
        new Notice("正在准备 Hexo 真实主题预览...");
        const url = new URL("/api/preview/article", session.url);
        url.searchParams.set("token", session.token);
        const response = await withTimeout(requestUrl({
          url: url.toString(), method: "POST", contentType: "application/json", body: JSON.stringify({ pubId }), throw: false,
        }), 40000, "Hexo 预览准备超时，请查看博客后台运行日志");
        if (response.status !== 200) {
          throw new Error(response.status === 404 ? "请更新并重启博客管理后台，并确认关联的稿件仍存在" : String(response.json?.error || "无法启动 Hexo 预览"));
        }
        const existing = this.app.workspace.getLeavesOfType(HEXO_PREVIEW_VIEW)[0];
        const leaf = existing || this.app.workspace.getLeaf("split");
        if (!existing) await leaf.setViewState({ type: HEXO_PREVIEW_VIEW, active: true });
        (leaf.view as HexoPreviewView).showArticle(response.json.url, String(response.json.title || file.basename), abbrlink);
        await this.app.workspace.revealLeaf(leaf);
      });
    } catch (error) { new Notice(`预览失败：${this.getErrorMessage(error)}`, 10000); }
  }

  async openHexoControlRoom(onReady?: (session: ControlRoomSession) => Promise<void>): Promise<void> {
    if (this.controlRoomOpening) {
      new Notice("博客管理后台正在打开，请稍候");
      return;
    }
    if (!this.settings.hexoRepoPath) {
      new Notice("请先在设置中填写 Hexo 仓库路径");
      return;
    }

    this.controlRoomOpening = true;
    try {
      const blogPath = this.settings.hexoRepoPath;
      const integration = await requireControlRoomIntegration(blogPath);
      const electron = require("electron") as {
        shell?: {
          openExternal(url: string): Promise<void>;
          openPath(filePath: string): Promise<string>;
        };
      };
      if (!electron.shell) throw new Error("当前环境无法调用桌面浏览器");

      const session = await readControlRoomSession(integration.sessionPath);
      if (session) {
        let verified = false;
        try {
          const response = await withTimeout(requestUrl({
            url: getControlRoomStatusUrl(session),
            method: "GET",
            throw: false,
          }), 5000, "博客管理后台响应超时");
          verified = response.status === 200;
        } catch (error) {
          console.debug("EasyPub ignored a stale Blog Control Room session", error);
        }
        if (verified) {
          if (onReady) { await onReady(session); return; }
          await electron.shell.openExternal(session.url);
          new Notice("已打开博客管理后台");
          return;
        }
      }

      if (process.platform === "darwin") {
        new Notice("正在启动博客管理后台...");
        const started = await startControlRoom(blogPath, async candidate => {
          const response = await requestUrl({ url: getControlRoomStatusUrl(candidate), method: "GET", throw: false });
          return response.status === 200;
        });
        if (onReady) { await onReady(started); return; }
        await electron.shell.openExternal(started.url);
        new Notice("已启动并打开博客管理后台");
        return;
      }
      if (process.platform !== "win32" || !integration.launcherPath) {
        new Notice("请先在博客目录的终端运行 npm run gui，并保持终端开启，再点击打开管理后台。当前系统不会执行 Windows 的 ManageBlog.bat，也不会绕过后台直接部署。", 15000);
        return;
      }
      const launchError = await electron.shell.openPath(integration.launcherPath);
      if (launchError) throw new Error(launchError);
      new Notice("正在启动博客管理后台，浏览器将自动打开");
    } catch (error) {
      console.error("EasyPub could not open Blog Control Room", error);
      new Notice(`无法打开博客管理后台：${this.getErrorMessage(error)}`);
    } finally {
      this.controlRoomOpening = false;
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
      const attachment = resolveVaultAttachment(this.app, linkPath, sourceFile.path);
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
      const attachment = resolveVaultAttachment(this.app, linkPath, sourceFile.path);
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

    if (this.settings.picgoEncryptedSecret && !this.settings.picgoServerSecret) {
      throw new Error("无法解密已保存的 PicGo Secret，请在设置中重新填写；若已关闭 Server 认证，请明确清空原密钥。");
    }
    const fingerprint = publishSettingsFingerprint(this.settings);
    const urls = await uploadWithPicGo(
      uploads.map((upload) => upload.localPath),
      {
        serverUrl: this.settings.picgoServerUrl,
        secret: this.settings.picgoServerSecret,
        confirmInsecureTransport: origin => confirmPicGoTransport(this.app, origin),
      },
      async (request) => {
        if (fingerprint !== publishSettingsFingerprint(this.settings)) throw new Error("发布设置已变化，请重新确认发布");
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
