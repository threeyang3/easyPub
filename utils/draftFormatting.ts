import { MarkdownView, TFile, normalizePath } from "obsidian";
import { createHash } from "crypto";
import type EasyPub from "../main";
import { Platform, PLATFORMS } from "../types";
import { getFrontMatterString, parseFrontMatter, stringifyFrontMatter } from "./frontMatter";
import { getPublishBackupDirectory, getPublishPath, hexoEditorPath } from "./platforms";
import { formatMarkdownBody, MarkdownFormatOptions, MarkdownFormatResult } from "./markdownFormatting";
import { preserveSyncedWechatLayout } from "./draftSyncLayout";

export interface DraftFormatPreview extends MarkdownFormatResult { layoutNotice?: string }
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const SOURCE_PLATFORM: Platform = {id:"source", name:"原稿", path:"", hasSubFolders:false, autoUrl:false, isExternal:false};

/** A formatting preview is bound to one saved article; it never updates other related drafts. */
export class DraftFormatSession {
  readonly targetPath: string;
  readonly platform: Platform;
  readonly before: string;
  readonly backupPath: string;
  private readonly filePath: string;
  private readonly settingsSnapshot: string;
  private previews = new WeakSet<DraftFormatPreview>();
  private disposed = false;
  private writing = false;
  private saved = false;

  private constructor(private plugin: EasyPub, private file: TFile, platform: Platform, targetPath: string, before: string) {
    this.platform = platform; this.targetPath = targetPath; this.before = before;
    this.filePath = file.path; this.settingsSnapshot = this.settingsKey();
    const directory = plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
    this.backupPath = platform.isExternal
      ? `${getPublishBackupDirectory(plugin.settings.hexoRepoPath)}/${hash(before)}.bak`
      : normalizePath(`${directory}/formatting/backups/${hash(targetPath)}-${hash(before)}.md`);
  }

  static async create(plugin: EasyPub, file: TFile): Promise<DraftFormatSession> {
    plugin.assertSettingsWritable();
    if (file.extension !== "md") throw new Error("请打开一篇 Markdown 文章后排版");
    const originalPath = file.path;
    const settingsSnapshot = JSON.stringify([plugin.settings.hexoRepoPath, plugin.settings.publishBasePath]);
    const external = hexoEditorPath(plugin.app, plugin.settings.hexoRepoPath, file.path);
    const matchingPlatform = PLATFORMS.find(item => item.id === "hexo" ? Boolean(external)
      : !item.isExternal && normalizePath(file.path).startsWith(`${getPublishPath(item, plugin.settings)}/`));
    if (!matchingPlatform && plugin.app.vault.getAbstractFileByPath(file.path) !== file) throw new Error("请打开 Vault 内的原稿或关联 Hexo 稿件后排版");
    const platform = matchingPlatform ?? SOURCE_PLATFORM;
    const target = external ?? file.path;
    for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view as MarkdownView;
      if (view.file && (hexoEditorPath(plugin.app, plugin.settings.hexoRepoPath, view.file.path) ?? view.file.path) === target) await view.save();
    }
    if (file.path !== originalPath) throw new Error("稿件已移动，请重新打开排版");
    const before = await plugin.readPublishFile(platform, target);
    if (file.path !== originalPath || settingsSnapshot !== JSON.stringify([plugin.settings.hexoRepoPath, plugin.settings.publishBasePath])) throw new Error("稿件路径或发布设置已变化，请重新预览");
    const meta = parseFrontMatter(before, true).data;
    if (platform.id !== "source" && (!getFrontMatterString(meta, "pub_id") || typeof meta.source_file !== "string" || !meta.source_file.trim())) throw new Error("发布稿缺少 pub_id 或原稿关联，请先修复稿件属性");
    const session = new DraftFormatSession(plugin, file, platform, target, before);
    await session.assertFresh();
    return session;
  }

  private settingsKey() { return JSON.stringify([this.plugin.settings.hexoRepoPath, this.plugin.settings.publishBasePath]); }
  dispose() { this.disposed = true; }

  preview(options: MarkdownFormatOptions): DraftFormatPreview {
    if (this.disposed || this.saved) throw new Error("排版窗口已关闭，请重新打开");
    const result = formatMarkdownBody(this.before, options);
    let layoutNotice: string | undefined;
    if (this.platform.id === "wechat" && result.content !== this.before) {
      const parsed = parseFrontMatter(result.content, true);
      const rebased = preserveSyncedWechatLayout(parseFrontMatter(this.before, true).content, parsed.content, parsed.data);
      layoutNotice = rebased.notice;
      if (rebased.data !== parsed.data) {
        // Regenerate only the metadata header; retain the exact previewed body/EOL.
        const generated = stringifyFrontMatter("", rebased.data);
        const suffix = parseFrontMatter(generated).content;
        const eol = this.before.includes("\r\n") ? "\r\n" : "\n";
        result.content = generated.slice(0, generated.length - suffix.length).replace(/\r?\n/g, eol) + parsed.content;
      }
    }
    const preview = Object.freeze({...result, ...(layoutNotice ? {layoutNotice} : {})});
    this.previews.add(preview);
    return preview;
  }

  private assertActive(assertActive: () => void) {
    assertActive(); this.plugin.assertSettingsWritable();
    if (this.disposed || this.saved) throw new Error("排版窗口已关闭，已取消保存");
    if (this.file.path !== this.filePath || this.settingsKey() !== this.settingsSnapshot) throw new Error("稿件路径或发布设置已变化，请重新预览");
    if ((hexoEditorPath(this.plugin.app, this.plugin.settings.hexoRepoPath, this.file.path) ?? this.file.path) !== this.targetPath) throw new Error("稿件路径映射已变化，请重新打开排版");
    if (!this.platform.isExternal && this.plugin.app.vault.getAbstractFileByPath(this.filePath) !== this.file) throw new Error("稿件已移动或删除，请重新打开排版");
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view as MarkdownView;
      if (view.file && (hexoEditorPath(this.plugin.app, this.plugin.settings.hexoRepoPath, view.file.path) ?? view.file.path) === this.targetPath
        && view.getViewData() !== this.before) throw new Error("稿件存在新的编辑，请先保存并重新预览");
    }
  }

  private async assertFresh(assertActive: () => void = () => {}) {
    this.assertActive(assertActive);
    if (await this.plugin.readPublishFile(this.platform, this.targetPath) !== this.before) throw new Error("稿件正文已变化，请重新预览");
    this.assertActive(assertActive);
  }

  private async backupVaultDraft() {
    const adapter = this.plugin.app.vault.adapter;
    const parts = this.backupPath.split("/"); parts.pop();
    let directory = "";
    for (const part of parts) {
      directory = directory ? `${directory}/${part}` : part;
      if (!await adapter.exists(directory)) await adapter.mkdir(directory);
    }
    if (!await adapter.exists(this.backupPath)) await adapter.write(this.backupPath, this.before);
    if (await adapter.read(this.backupPath) !== this.before) throw new Error("原文备份校验失败，稿件尚未修改");
  }

  async apply(preview: DraftFormatPreview, assertActive: () => void = () => {}): Promise<void> {
    if (!this.previews.has(preview)) throw new Error("排版预览不属于当前稿件，请重新预览");
    if (this.writing) throw new Error("正在保存排版，请稍候");
    if (preview.content === this.before) throw new Error("正文已经符合所选排版规则");
    this.writing = true;
    try {
      await this.assertFresh(assertActive);
      if (!this.platform.isExternal) await this.backupVaultDraft();
      await this.assertFresh(assertActive);
      await this.plugin.writePublishFile(this.platform, this.targetPath, preview.content, this.before,
        () => this.assertActive(assertActive), () => this.assertFresh(assertActive));
      this.saved = true;
    } finally { this.writing = false; }
  }
}
