import { Component, FuzzySuggestModal, ItemView, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type EasyPub from "../main";
import { WechatArticleSettings, WechatCrop, WechatImage, WechatPreparedDocument } from "../types";
import { getFrontMatterString, parseFrontMatter } from "../utils/frontMatter";
import { isWechatDraftPath } from "../utils/platforms";
import { cropCoordinates, centeredCrop, readWechatArticleSettings, wechatArticleNeedsSave, wechatAssetKey, wechatHash, wechatStateKey } from "../utils/wechatState";
import { IMAGE_EXTENSIONS, replaceWechatImageTokens } from "../utils/wechatMarkdown";
import { loadWechatImage, readWechatImage, releaseWechatImages } from "../utils/wechatImages";
import { digestFromWechatHtml, previewWechatHtml, renderWechatDocument, WECHAT_HTML_LIMIT_ISSUE } from "../utils/wechatRenderer";
import { validateWechatArticle, WechatConflictAction, WechatSync } from "../utils/wechatSync";
import { wechatChoice } from "../modals/WechatChoiceModal";
import { WechatComparison, wechatReadableHtml } from "../utils/wechatComparison";
import { WechatCropModal } from "../modals/WechatCropModal";
import { WechatLayoutModal } from "../modals/WechatLayoutModal";
import { readWechatLayoutPlan, themePlan } from "../utils/wechatLayoutEngine";
import { WECHAT_ARTICLE_FIELDS, wechatFieldLength } from "../utils/wechatLimits";
import { compareWechatReadback } from "../utils/wechatReadback";

export const WECHAT_VIEW = "easy-pub-wechat";
export function isWechatDraft(file: TFile, text: string, plugin: EasyPub): boolean {
  const data = parseFrontMatter(text).data;
  return Boolean(getFrontMatterString(data, "pub_id") && data.source_file
    && (isWechatDraftPath(file.path, plugin.settings) || data.wechat && typeof data.wechat === "object"));
}
class CoverPicker extends FuzzySuggestModal<TFile> {
  constructor(private plugin: EasyPub, private selected: (file: TFile) => void) { super(plugin.app); this.setPlaceholder("选择封面图片附件"); }
  getItems() { return this.plugin.app.vault.getFiles().filter(file => IMAGE_EXTENSIONS.has(file.extension.toLowerCase())); }
  getItemText(file: TFile) { return file.path; }
  onChooseItem(file: TFile) { this.selected(file); }
}

export class WechatView extends ItemView {
  private allowRemoteImages = () => this.plugin.settings.wechat.allowRemoteImages !== false;
  private imagePolicyRevision = 0;
  private file: TFile | null = null;
  private snapshot = "";
  private snapshotPath = "";
  private prepared?: WechatPreparedDocument;
  private cover?: WechatImage;
  private article: WechatArticleSettings = {};
  private version = 0;
  private closed = false;
  private paused = false;
  private stale = true;
  private dirty = false;
  private busy = false;
  private layoutOpening = false;
  private layoutModal?: WechatLayoutModal;
  private rerenderRequested = false;
  private manualRefreshRequested = false;
  private timer?: ReturnType<typeof setTimeout>;
  private preview!: HTMLElement;
  private inspector!: HTMLElement;
  private status!: HTMLElement;
  private identity!: HTMLElement;
  private syncButton!: HTMLButtonElement;
  private pauseButton!: HTMLButtonElement;
  private previewTab!: HTMLButtonElement;
  private page: "preview" | "article" | "images" = "preview";
  private imagesTab!: HTMLButtonElement;
  private cropOpening = false;
  private cropModal?: WechatCropModal;
  private settingsTab!: HTMLButtonElement;

  constructor(leaf: WorkspaceLeaf, private plugin: EasyPub) { super(leaf); }
  getViewType() { return WECHAT_VIEW; }
  getDisplayText() { return "公众号工作台"; }
  getIcon() { return "newspaper"; }
  getState() { return { path: this.file?.path }; }
  async setState(state: { path?: string }, result: ViewStateResult) {
    await super.setState(state, result);
    const file = state.path ? this.app.vault.getAbstractFileByPath(state.path) : null;
    if (file instanceof TFile && file.extension === "md") await this.bind(file);
  }
  async onOpen() {
    this.closed = false;
    const root = this.contentEl; root.empty(); root.addClass("easy-pub-wechat");
    const header = root.createDiv({ cls: "epw-header" });
    header.createEl("h2", { text: "公众号工作台" });
    this.identity = header.createDiv({ cls: "epw-identity", text: "请从公众号本地稿打开此工作台" });
    const setup = header.createEl("details", { cls: "epw-setup-entry" });
    setup.createEl("summary", { text: "公众号连接设置" });
    setup.createEl("p", { text: this.plugin.hasWechatCredentials() ? "公众号凭据已保存，可检查连接或更换账号。" : "首次同步前，请先连接你的公众号。" });
    this.button(setup, "配置公众号", () => this.plugin.openWechatSetup(() => {
      setup.querySelector("p")!.textContent = "公众号配置已保存，请检查连接并刷新预览。";
      this.invalidate();
    }));
    const tools = root.createDiv({ cls: "epw-tools" });
    this.pauseButton = this.button(tools, "暂停刷新", () => {
      this.paused = !this.paused; this.pauseButton.textContent = this.paused ? "恢复刷新" : "暂停刷新";
      if (this.paused) {
        if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
        this.version++; // Discard any render already in flight.
        if (this.stale) this.message("预览待更新 · 已暂停自动刷新");
      }
      if (!this.paused && !this.dirty) void this.run(() => this.refresh());
    });
    this.button(tools, "刷新预览", () => {
      if (this.busy) this.manualRefreshRequested = true;
      else void this.run(() => this.refresh(true));
    });
    this.button(tools, "打开本地稿", () => this.run(async () => { if (this.file) await this.app.workspace.getLeaf(false).openFile(this.file); }));
    this.button(tools, "智能排版", () => { void this.openLayout().catch(error => this.message((error as Error).message, true)); });
    this.status = root.createDiv({ cls: "epw-status", text: "等待选择公众号本地稿", attr: { role: "status", "aria-live": "polite" } });
    const tabs = root.createDiv({ cls: "epw-tabs", attr: { "aria-label": "预览布局" } });
    this.previewTab = this.button(tabs, "正文预览", () => this.showSettings(false));
    this.settingsTab = this.button(tabs, "文章信息", () => this.showPage("article"));
    this.imagesTab = this.button(tabs, "图片与封面", () => this.showPage("images"));
    this.button(tools, "并排预览与设置", () => {
      this.contentEl.classList.toggle("epw-expanded");
      if (this.page === "preview") this.showPage("article");
    }).addClass("epw-expand");
    const body = root.createDiv({ cls: "epw-body" });
    this.preview = body.createDiv({ cls: "epw-paper", attr: { role: "region", "aria-label": "公众号正文预览", tabindex: "0" } });
    this.inspector = body.createDiv({ cls: "epw-inspector", attr: { role: "region", "aria-label": "信息、配图与封面", tabindex: "0" } });
    this.showSettings(false);
    const footer = root.createDiv({ cls: "epw-footer" });
    this.syncButton = this.button(footer, "同步草稿箱", () => this.run(() => this.sync()));
    this.syncButton.addClass("mod-cta"); this.syncButton.disabled = true;
    this.button(footer, "查询 / 恢复关联", () => this.run(() => this.recover()));
    this.button(footer, "打开公众号后台", () => this.run(() => this.plugin.openWechatBackend()));
    this.registerEvent(this.app.vault.on("modify", file => {
      if (file === this.file) this.invalidate();
      else if (this.prepared?.images.some(image => image.localPath === file.path) || this.cover?.localPath === file.path) this.invalidate();
    }));
    this.registerEvent(this.app.vault.on("rename", file => {
      if (file === this.file || this.prepared?.images.some(image => image.localPath === file.path) || this.cover?.localPath === file.path) this.invalidate();
      // Renaming any attachment can invalidate a relative reference.
      else if (file instanceof TFile && IMAGE_EXTENSIONS.has(file.extension.toLowerCase())) this.invalidate();
    }));
    this.registerEvent(this.app.vault.on("delete", file => {
      if (file === this.file || this.prepared?.images.some(image => image.localPath === file.path) || this.cover?.localPath === file.path) this.invalidate();
    }));
  }
  private button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { text: label }); button.addEventListener("click", action); return button;
  }
  private showSettings(show: boolean) { this.showPage(show ? "images" : "preview"); }
  private showPage(page: "preview" | "article" | "images") {
    this.page = page;
    this.inspector.hidden = page === "preview";
    this.preview.hidden = page !== "preview";
    this.contentEl.classList.toggle("epw-settings-open", page !== "preview");
    this.previewTab.setAttribute("aria-pressed", String(page === "preview"));
    this.settingsTab.setAttribute("aria-pressed", String(page === "article"));
    this.imagesTab.setAttribute("aria-pressed", String(page === "images"));
    for (const section of Array.from(this.inspector.querySelectorAll<HTMLElement>("[data-page]"))) section.hidden = section.dataset.page !== page;
  }
  private async run(action: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true; this.updateSyncState();
    try { await action(); }
    catch (error) { this.message((error as Error).message, true); }
    finally {
      this.busy = false; this.updateSyncState();
      if (this.manualRefreshRequested && !this.closed) {
        this.manualRefreshRequested = false;
        void this.run(() => this.refresh(true));
      } else if (this.rerenderRequested && !this.paused && !this.dirty && !this.closed) {
        if (this.timer) clearTimeout(this.timer);
        this.scheduleRefresh();
      }
    }
  }
  private message(text: string, error = false) {
    if (this.closed) return;
    this.status.textContent = text; this.status.classList.toggle("epw-error", error);
  }
  private updateSyncState() {
    if (this.syncButton) this.syncButton.disabled = this.busy || this.stale || this.dirty || !this.prepared || !this.cover || this.prepared.issues.length > 0;
  }
  private invalidate() {
    this.version++; this.stale = true; this.updateSyncState(); this.message(this.paused ? "预览待更新 · 已暂停自动刷新，请手动刷新或恢复刷新" : "预览待更新 · 本地稿或附件已变化");
    this.rerenderRequested = true;
    if (this.timer) clearTimeout(this.timer);
    if (!this.paused && !this.dirty && !this.busy) this.scheduleRefresh();
  }
  invalidateImagePolicy() {
    if (this.closed) return;
    this.imagePolicyRevision++; this.version++; this.stale = true;
    this.rerenderRequested = false; this.manualRefreshRequested = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.disposePrepared();
    this.preview.empty();
    this.renderInspector();
    this.updateSyncState();
    this.message('图片读取策略已变化 · 预览待更新，请刷新后再同步');
  }
  private scheduleRefresh() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.paused && !this.dirty && !this.closed) void this.run(() => this.refresh());
    }, 500);
  }
  async bind(file: TFile) {
    if (this.busy || this.cropOpening || this.cropModal || this.layoutModal) throw new Error("请先完成当前任务并关闭编辑窗口，再切换稿件");
    if (this.file === file && this.snapshot && (!this.stale || this.dirty)) return;
    const text = await this.app.vault.read(file);
    if (!isWechatDraft(file, text, this.plugin)) { this.message("请打开已生成的公众号本地稿，不会从源文章直接同步", true); return; }
    if (this.dirty && this.file !== file) {
      if (await wechatChoice(this.app, "切换公众号稿件", "当前设置尚未保存。切换会丢弃这些设置修改，正文不会改变。", [{ label: "丢弃未保存设置并切换", value: "switch" }]) !== "switch") return;
    }
    this.file = file; this.dirty = false; this.stale = true;
    this.app.workspace.requestSaveLayout?.();
    await this.run(() => this.refresh());
  }
  private disposePrepared() {
    if (this.prepared) releaseWechatImages(this.prepared.images);
    if (this.cover) releaseWechatImages([this.cover]);
    this.prepared = undefined; this.cover = undefined;
  }
  async refresh(preserveEdits = false) {
    if (!this.file || this.closed) return;
    if (this.cropModal) { this.rerenderRequested = true; return; }
    // A queued automatic refresh must never replace unsaved inspector edits.
    if (this.dirty && !preserveEdits) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    const keepDirty = this.dirty;
    const pendingArticle = keepDirty ? structuredClone(this.article) : undefined;
    const version = ++this.version;
    const imagePolicyRevision = this.imagePolicyRevision;
    this.rerenderRequested = false;
    this.stale = true; this.updateSyncState(); this.message("正在检查排版与图片…");
    const file = this.file, filePath = file.path;
    const snapshot = await this.app.vault.read(file);
    if (!isWechatDraft(file, snapshot, this.plugin)) throw new Error("当前文件已不再是公众号本地稿，请重新打开");
    const parsed = parseFrontMatter(snapshot);
    const saved = readWechatArticleSettings(parsed.data.wechat);
    const article: WechatArticleSettings = pendingArticle ?? { ...saved,
      title: saved.title ?? getFrontMatterString(parsed.data, "title") ?? file.basename,
      author: saved.author ?? this.plugin.settings.wechat.defaultAuthor,
      digest: saved.digest,
    };
    const component = new Component(); component.load();
    let prepared: WechatPreparedDocument;
    try { prepared = await renderWechatDocument(this.app, parsed.content, filePath, component, this.allowRemoteImages, article.layout); }
    finally { component.unload(); }
    let cover: WechatImage | undefined, installed = false;
    try {
      if (article.digest === undefined) article.digest = digestFromWechatHtml(prepared.html);
      let articleInvalid = false;
      try { validateWechatArticle(article); } catch (error) { articleInvalid = true; prepared.issues.push((error as Error).message); }
      const source = article.cover ?? prepared.images[0]?.source;
      if (source) {
        article.cover = source;
        try { cover = await loadWechatImage(this.app, source, filePath, "cover", this.allowRemoteImages); }
        catch (error) { prepared.issues.push(`封面：${(error as Error).message}`); }
      }
      if (cover) {
        try {
          if (article.cropWide) cropCoordinates(article.cropWide, cover.width, cover.height, 2.35);
          if (article.cropSquare) cropCoordinates(article.cropSquare, cover.width, cover.height, 1);
        } catch { prepared.issues.push("封面尺寸或裁剪比例已变化，请重新调整封面裁剪"); }
      }
      const latest = await this.app.vault.read(file);
      if (version !== this.version || this.closed || this.file !== file || file.path !== filePath || latest !== snapshot || imagePolicyRevision !== this.imagePolicyRevision) {
        this.rerenderRequested = !this.closed && imagePolicyRevision === this.imagePolicyRevision;
        releaseWechatImages(prepared.images); if (cover) releaseWechatImages([cover]); return;
      }
      const scroll = this.preview.scrollTop;
      this.disposePrepared(); this.prepared = prepared; this.cover = cover; this.article = article;
      installed = true;
      this.snapshot = snapshot; this.snapshotPath = filePath; this.dirty = keepDirty; this.stale = false;
      this.identity.textContent = filePath;
      this.preview.innerHTML = previewWechatHtml(prepared.html, prepared.images);
      this.preview.scrollTop = scroll;
      this.renderInspector();
      if (articleInvalid) this.showPage("article");
      else if (prepared.issues.length || !cover) this.showSettings(true);
      this.message(keepDirty ? "正文预览已更新 · 未保存设置已保留，请保存设置并刷新后同步" : prepared.issues.length ? `预检发现 ${prepared.issues.length} 个问题，请修复后刷新` : !cover ? "请选择封面，保存设置后即可同步" : "预检通过 · 同步以此本地成稿为准");
      if (prepared.layoutNotice) this.message(`${this.status.textContent} · ${prepared.layoutNotice}`, prepared.issues.length > 0);
      this.updateSyncState();
    } catch (error) {
      if (installed) {
        this.disposePrepared();
        this.stale = true;
        this.preview.empty();
        this.updateSyncState();
      } else {
        releaseWechatImages(prepared.images);
        if (cover) releaseWechatImages([cover]);
      }
      throw error;
    }
  }
  private changed() {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.version++; this.dirty = true; this.stale = true; this.updateSyncState(); this.message("设置待保存 · 点击“保存设置并刷新”查看最终效果");
  }
  private renderInspector() {
    const parent = this.inspector; parent.empty();
    const fields = parent.createEl("details", { cls: "epw-section" }); fields.open = true;
    fields.dataset.page = "article";
    fields.createEl("summary", { text: "文章信息" });
    for (const [key, label, limit] of WECHAT_ARTICLE_FIELDS) {
      const wrapper = fields.createEl("label", { cls: "epw-field", text: label });
      const input = key === "digest" ? wrapper.createEl("textarea") : wrapper.createEl("input", { type: "text" });
      input.value = this.article[key] ?? "";
      const count = wrapper.createEl("small", { cls: "epw-field-count" });
      const updateCount = () => {
        const length = wechatFieldLength(key, input.value);
        count.textContent = `${length} / ${limit} ${key === "sourceUrl" ? "字节" : "字"}${length > limit ? " · 超出限制，请缩短" : ""}`;
        input.setAttribute("aria-invalid", String(length > limit));
        count.classList.toggle("epw-error", length > limit);
      };
      updateCount();
      input.addEventListener("input", () => { this.article[key] = input.value; updateCount(); this.changed(); });
    }
    const covers = parent.createEl("details", { cls: "epw-section" }); covers.open = true; covers.dataset.page = "images";
    this.button(fields, "从正文重新提取摘要", () => {
      if (!this.prepared || this.snapshotPath !== this.file?.path) return;
      this.article.digest = digestFromWechatHtml(this.prepared.html); this.changed(); this.renderInspector();
    });
    covers.createEl("summary", { text: "封面 · 两种裁剪" });
    const select = covers.createEl("select", { attr: { "aria-label": "选择正文图片作为封面" } });
    select.createEl("option", { value: "", text: "选择正文图片" });
    for (const image of this.prepared?.images ?? []) select.createEl("option", { value: image.source, text: image.source });
    select.value = this.article.cover ?? "";
    select.addEventListener("change", () => { if (select.value) void this.run(() => this.selectCover(select.value)); });
    this.button(covers, "从附件选图", () => new CoverPicker(this.plugin, file => { void this.run(() => this.selectCover(this.relativeCoverPath(file.path))); }).open());
    if (this.article.cover) covers.createEl("small", { text: this.article.cover, cls: "epw-cover-source" });
    if (this.cover) {
      const preview = covers.createEl("img", { cls: "epw-cover-thumbnail", attr: { src: this.cover.previewUrl, alt: "当前封面原图" } });
      preview.setAttribute("loading", "lazy");
      covers.createEl("p", { text: "横版 2.35:1 与方形 1:1 的构图分别保存。" });
      this.button(covers, "调整封面裁剪", () => { void this.openCrop().catch(error => this.message((error as Error).message, true)); });
    }
    const images = parent.createEl("details", { cls: "epw-section" });
    images.dataset.page = "images";
    const references = this.prepared?.imageReferences ?? [];
    const failures = references.filter(ref => ref.status === "error").length;
    const imagesBySource = new Map((this.prepared?.images ?? []).map(image => [image.source, image]));
    images.createEl("summary", { text: `正文图片 · ${references.length} 处引用${failures ? ` · ${failures} 处失败` : ""}` });
    images.open = failures > 0;
    for (const ref of references) {
      const image = imagesBySource.get(ref.source);
      const row = images.createDiv({ cls: "epw-image-row" });
      if (image) row.createEl("img", { attr: { src: image.previewUrl, alt: ref.source } });
      const info = row.createDiv(); info.createEl("span", { text: ref.source });
      if (image) info.createEl("small", { text: `已就绪 · ${image.width} × ${image.height} · ${Math.ceil(image.originalSize / 1024)} → ${Math.ceil(image.bytes.length / 1024)} KB · ${image.mime.split("/")[1].toUpperCase()}` });
      if (ref.error) info.createEl("small", { text: `处理失败 · ${ref.error}`, cls: "epw-error" });
      this.button(info, `定位正文第 ${ref.line} 行`, () => this.run(() => this.openImageReference(ref.line)));
    }
    if (this.prepared?.issues.length) {
      const issues = parent.createDiv({ cls: "epw-issues" });
      for (const issue of this.prepared.issues) issues.createEl("p", { text: issue });
    }
    const actions = parent.createDiv({ cls: "epw-inspector-actions" });
    this.button(actions, "保存设置并刷新", () => this.run(() => this.saveArticle())).addClass("mod-cta");
    this.showPage(this.page);
  }
  private async openImageReference(bodyLine: number) {
    const file = this.file;
    if (!file || file.path !== this.snapshotPath || await this.app.vault.read(file) !== this.snapshot) {
      throw new Error("本地稿已变化，请先刷新预览再定位图片");
    }
    const body = parseFrontMatter(this.snapshot).content;
    const prefix = this.snapshot.slice(0, this.snapshot.length - body.length);
    const line = prefix.split(/\r?\n/).length - 1 + bodyLine - 1;
    await this.app.workspace.getLeaf(false).openFile(file, { eState: { line } });
  }
  private relativeCoverPath(path: string): string {
    // Stored paths use the same relative-to-draft convention as Markdown images.
    return this.plugin.relativeWechatAttachment(this.file!.path, path);
  }
  private async selectCover(source: string) {
    const version = this.version;
    const cover = await loadWechatImage(this.app, source, this.file!.path, "cover", this.allowRemoteImages);
    if (this.closed || version !== this.version) { releaseWechatImages([cover]); return; }
    if (this.cover) releaseWechatImages([this.cover]);
    this.cover = cover; this.article.cover = source;
    this.article.cropWide = centeredCrop(cover.width, cover.height, 2.35);
    this.article.cropSquare = centeredCrop(cover.width, cover.height, 1);
    this.changed(); this.renderInspector();
  }
  private async openCrop() {
    if (!this.cover || this.cropModal || this.cropOpening || this.busy || !this.file || this.closed) return;
    this.cropOpening = true;
    try {
      const version = this.version, file = this.file, snapshot = this.snapshot, cover = this.cover;
      const latest = await this.app.vault.read(file);
      if (this.closed || this.version !== version || this.file !== file || file.path !== this.snapshotPath || latest !== snapshot) {
        throw new Error("稿件或图片已变化，请先刷新预览后再调整裁剪");
      }
      const modal = new WechatCropModal(this.app, cover, this.article, (wide, square) => {
        if (this.closed || this.version !== version || this.file !== file) throw new Error("稿件或图片已变化，请关闭裁剪窗口，刷新后重试");
        this.article.cropWide = wide; this.article.cropSquare = square; this.changed();
      }, () => {
        if (this.cropModal === modal) this.cropModal = undefined;
        if (!this.closed) {
          this.renderInspector();
          if (this.rerenderRequested && !this.dirty && !this.paused) this.scheduleRefresh();
        }
      });
      this.cropModal = modal;
      try { modal.open(); }
      catch (error) { this.cropModal = undefined; modal.close(); throw error; }
    } finally { this.cropOpening = false; }
  }
  private async saveArticle(article?: WechatArticleSettings, assertActive: () => void = () => {}) {
    const file = this.file, snapshot = this.snapshot, snapshotPath = this.snapshotPath;
    if (!file) return;
    const selected = article ? structuredClone(article) : undefined;
    const latest = await this.app.vault.read(file);
    assertActive();
    if (this.closed || this.file !== file || file.path !== snapshotPath || latest !== snapshot) throw new Error("本地稿已变化，请先刷新后重新设置");
    await this.app.fileManager.processFrontMatter(file, data => {
      // The host may read asynchronously before invoking this callback. This is
      // the last cancellable boundary; after it returns the write may complete.
      assertActive();
      const previous = data.wechat && typeof data.wechat === "object" && !Array.isArray(data.wechat) ? data.wechat : {};
      const { title, ...settings } = selected ?? this.article;
      data.title = title;
      data.wechat = { ...previous, ...settings };
      delete (data.wechat as Record<string, unknown>).title;
    });
    this.dirty = false; await this.refresh();
  }
  private async openLayout() {
    if (this.layoutOpening || this.layoutModal) return;
    this.layoutOpening = true;
    try {
      // Oversized layouts remain repairable; other preflight failures block entry.
      if (this.closed || !this.file || !this.prepared || this.busy || this.stale || this.dirty || this.prepared.issues.some(issue => issue !== WECHAT_HTML_LIMIT_ISSUE)) throw new Error("请先修复问题、保存设置并刷新预览，再调整排版");
      const doc = this.prepared.layoutDocument;
      if (!doc) throw new Error("排版文档尚未就绪，请刷新预览");
      const file = this.file, snapshot = this.snapshot, version = this.version, policy = this.imagePolicyRevision;
      const assertCurrent = () => {
        if (this.closed || this.file !== file || file.path !== this.snapshotPath || this.version !== version
          || this.imagePolicyRevision !== policy || this.stale || this.dirty) throw new Error("正文、设置或图片已变化，请关闭排版窗口，刷新后重新规划");
      };
      const assertFresh = async () => {
        assertCurrent();
        const latest = await this.app.vault.read(file);
        assertCurrent();
        if (latest !== snapshot) throw new Error("正文、设置或图片已变化，请关闭排版窗口，刷新后重新规划");
      };
      await assertFresh();
      const modal = new WechatLayoutModal(this.plugin, { title: this.article.title ?? file.basename, html: this.prepared.html, images: this.prepared.images,
        document: doc, current: this.article.layout, history: this.article.layoutHistory ?? [], assertFresh,
        onClose: () => { if (this.layoutModal === modal) this.layoutModal = undefined; },
        apply: async (plan, assertActive) => {
          // Acquire the workbench lock before any await, not just within one modal.
          if (this.busy || this.layoutModal !== modal) throw new Error("公众号任务正在进行或排版窗口已关闭，请稍后重试");
          this.busy = true; this.updateSyncState();
          const guard = () => { assertActive(); assertCurrent(); this.plugin.assertSettingsWritable?.(); };
          try {
            guard();
            await assertFresh();
            guard();
            const previous = structuredClone(this.article);
            let old = themePlan(doc, "default");
            try { old = readWechatLayoutPlan(previous.layout); } catch { /* First layout or invalid old plan. */ }
            const history = [...(previous.layoutHistory ?? []), old].slice(-5);
            await this.saveArticle({...previous, layout: plan, layoutHistory: history}, guard);
          } finally {
            this.busy = false; this.updateSyncState();
            if (this.rerenderRequested && !this.closed && !this.paused && !this.dirty) this.scheduleRefresh();
          }
        },
      });
      this.layoutModal = modal;
      try { modal.open(); }
      catch (error) { this.layoutModal = undefined; modal.close(); throw error; }
    } finally { this.layoutOpening = false; }
  }
  private async sync() {
    this.plugin.assertSettingsWritable?.();
    if (!this.plugin.hasWechatCredentials()) { this.plugin.openWechatSetup(() => this.invalidate()); return; }
    if (!this.file || !this.prepared || !this.cover || this.stale || this.dirty || this.prepared.issues.length) throw new Error("请先修复问题并保存设置、刷新预览");
    if (this.plugin.wechatSyncInProgress) throw new Error("已有公众号同步任务正在进行");
    if (wechatArticleNeedsSave(parseFrontMatter(this.snapshot).data, this.article)) await this.saveArticle();
    const file = this.file, snapshot = this.snapshot, filePath = this.snapshotPath, version = this.version;
    const settings = JSON.stringify([this.plugin.settings.wechat.appId, this.plugin.settings.wechat.encryptedSecret, this.plugin.settings.wechat.defaultAuthor, this.allowRemoteImages()]);
    const credentialRevision = this.plugin.wechatCredentialRevision;
    const data = parseFrontMatter(snapshot).data;
    const article = { ...this.article };
    const assertFresh = async (imagesToCheck?: WechatImage[]) => {
      if (this.closed || this.version !== version || this.file !== file || file.path !== filePath || await this.app.vault.read(file) !== snapshot) throw new Error("本地成稿或预览已变化，请刷新后重新同步");
      if (settings !== JSON.stringify([this.plugin.settings.wechat.appId, this.plugin.settings.wechat.encryptedSecret, this.plugin.settings.wechat.defaultAuthor, this.allowRemoteImages()]) || credentialRevision !== this.plugin.wechatCredentialRevision) throw new Error("公众号配置已变化，请刷新后重试");
      const seen = new Set<string>();
      for (const image of imagesToCheck ?? []) {
        const key = `${image.localPath ?? image.source}\0${image.originalHash}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const raw = await readWechatImage(this.app, image.source, filePath, undefined, this.allowRemoteImages);
        if (wechatHash(raw.bytes) !== image.originalHash) throw new Error(`图片内容已变化，请刷新：${image.source}`);
      }
    };
    this.plugin.wechatSyncInProgress = true;
    this.contentEl.setAttribute("inert", "");
    const controls = Array.from(this.contentEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement>("input,button,textarea,select"));
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try {
      const api = this.plugin.getWechatApi();
      // Revalidate original attachment bytes, including cached and remote images.
      this.message("正在核对图片内容…");
      const result = await new WechatSync(api, this.plugin.settings.wechat, () => this.plugin.saveSettings()).sync({
        pubId: getFrontMatterString(data, "pub_id")!, html: this.prepared.html, images: this.prepared.images, cover: this.cover, article,
        assertFresh, progress: message => this.message(message),
        conflict: async (kind, remote) => {
          const details = `本地：${JSON.stringify(article, null, 2)}\n\n本地正文：\n${this.preview.textContent ?? ""}\n\n微信后台：\n${JSON.stringify(remote, null, 2)}`;
          const remoteArticle = remote[0] && typeof remote[0] === "object" ? remote[0] as Record<string, unknown> : {};
          const comparison: WechatComparison[] = [
            ...([ ["标题", "title", "title"], ["作者", "author", "author"], ["摘要", "digest", "digest"], ["阅读原文", "sourceUrl", "content_source_url"] ] as const)
              .map(([label, localKey, remoteKey]) => ({ label, local: article[localKey] ?? "", remote: String(remoteArticle[remoteKey] ?? "") })),
            { label: "正文文本及图片位置", local: wechatReadableHtml(this.prepared!.html), remote: wechatReadableHtml(String(remoteArticle.content ?? "")) },
            { label: "本地封面与远端封面素材 / 裁剪", local: JSON.stringify({ cover: article.cover, cropWide: article.cropWide, cropSquare: article.cropSquare }, null, 2),
              remote: JSON.stringify({ mediaId: remoteArticle.thumb_media_id, crop: remoteArticle.cover_info }, null, 2) },
          ];
          const choices = [{ label: "另建草稿", value: "new" }];
          if (kind === "modified") choices.push({ label: "确认用本地稿覆盖后台", value: "overwrite" });
          return await wechatChoice(this.app, kind === "missing" ? "远端草稿已删除或发布" : kind === "multiple" ? "已关联多图文，不支持覆盖" : "微信后台内容与上次同步不同", details, choices, kind === "modified" ? comparison : undefined) as WechatConflictAction;
        },
      });
      if (!result) { this.message("已取消同步"); return; }
      try {
        const remote = await api.getDraft(result);
        const expected = replaceWechatImageTokens(this.prepared.html, this.prepared.images, image => {
          const material = this.plugin.settings.wechat.assets[wechatAssetKey(this.plugin.settings.wechat.appId, "body", image.hash)];
          return material ? material.url.replace(/&/g, "&amp;").replace(/"/g, "&quot;") : `easy-pub-image://${image.hash}`;
        });
        const content = (remote[0] as {content?: unknown})?.content;
        const warnings = typeof content === "string" ? compareWechatReadback(expected, content) : ["无法核对回读正文，请在后台检查"];
        this.message(`已同步到公众号草稿箱 · ${warnings.length ? warnings.join("；") : "正文、图片与链接回读一致，请在后台预览并发布"}`, warnings.length > 0);
      } catch { this.message("已同步到公众号草稿箱，但补充内容核对失败；请在后台预览，勿重复创建草稿", true); }
    } finally {
      this.plugin.wechatSyncInProgress = false;
      this.contentEl.removeAttribute("inert");
      controls.forEach((control, index) => { control.disabled = disabled[index]; });
      this.updateSyncState();
    }
  }
  private async recover() {
    if (!this.file || !this.snapshot || this.stale || this.dirty) throw new Error("请先保存设置并刷新预览");
    if (this.plugin.wechatSyncInProgress) throw new Error("请等待当前同步完成");
    this.plugin.wechatSyncInProgress = true;
    try { await this.recoverDraft(); }
    finally { this.plugin.wechatSyncInProgress = false; }
  }
  private async recoverDraft() {
    const appId = this.plugin.settings.wechat.appId;
    const revision = this.plugin.wechatCredentialRevision;
    const version = this.version;
    const pubId = getFrontMatterString(parseFrontMatter(this.snapshot).data, "pub_id")!;
    const key = wechatStateKey(appId, pubId);
    this.message("正在查询最近 20 个草稿…");
    const api = this.plugin.getWechatApi();
    const drafts = await api.listDrafts();
    const choices = drafts.filter(item => item.content?.news_item?.length === 1).map((item, index) => ({ label: `${index + 1}. ${item.content.news_item[0].title}`, value: item.media_id }));
    choices.push({ label: "已核对后台，解除不确定状态", value: "clear" });
    const choice = await wechatChoice(this.app, "核对后台后恢复关联", "选择同一篇文章的草稿以重新关联；下一次同步仍会显示内容差异。\n若写入结果不确定，请先在公众号后台检查。只有确定没有待关联的新草稿后，才解除状态并重新同步。", choices);
    if (choice === "cancel") return;
    const fresh = () => {
      if (appId !== this.plugin.settings.wechat.appId || revision !== this.plugin.wechatCredentialRevision || version !== this.version || this.closed) throw new Error("稿件或公众号配置已变化，请刷新后重试");
    };
    fresh();
    if (choice === "clear") {
      const confirmed = await wechatChoice(this.app, "确认解除不确定状态", "此操作允许再次写入。请确认已检查微信后台，避免重复创建。已有草稿 ID 会保留。", [{ label: "确认已核对，解除状态", value: "confirm" }]);
      if (confirmed !== "confirm") return;
      fresh();
      this.plugin.settings.wechat.drafts[key] = { ...this.plugin.settings.wechat.drafts[key], uncertain: false };
    } else {
      const remote = await api.getDraft(choice);
      if (remote.length !== 1) throw new Error("只能关联单篇图文草稿");
      const confirmed = await wechatChoice(this.app, "确认关联此草稿", JSON.stringify(remote, null, 2), [{ label: "关联此草稿", value: "confirm" }]);
      if (confirmed !== "confirm") return;
      fresh();
      // No fingerprint: force conflict review before the first overwrite.
      this.plugin.settings.wechat.drafts[key] = { mediaId: choice };
    }
    await this.plugin.saveSettings(); this.message("关联状态已保存，下次同步将重新核对远端内容");
  }
  async onClose() {
    this.closed = true; this.version++;
    this.layoutModal?.close();
    this.cropModal?.close();
    if (this.timer) clearTimeout(this.timer);
    this.disposePrepared(); this.contentEl.empty();
    this.contentEl.classList.remove("easy-pub-wechat", "epw-settings-open", "epw-expanded"); this.contentEl.removeAttribute("inert");
  }
}
