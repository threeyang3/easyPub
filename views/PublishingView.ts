import { ItemView, Notice, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { WECHAT_VIEW } from "./WechatView";
import { HEXO_PREVIEW_VIEW } from "./HexoPreviewView";
import { PublishDirectoryModal } from "../modals/PublishDirectoryModal";
import type EasyPub from "../main";
import { PLATFORMS } from "../types";
import { parseFrontMatter, getFrontMatterString } from "../utils/frontMatter";
import { getPublishPath } from "../utils/platforms";

export const PUBLISHING_VIEW = "easy-pub-publishing";

/** Always available, even without a selected article. Long-running tools keep their own pinned context. */
export class PublishingView extends ItemView {
  private file: TFile | null = null;
  private pinned = false;
  private generation = 0;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private displayKey?: string;
  private displayPath?: string;
  private closed = false;
  private article!: HTMLElement;
  private pin!: HTMLButtonElement;
  constructor(leaf: WorkspaceLeaf, private plugin: EasyPub) { super(leaf); }
  getViewType() { return PUBLISHING_VIEW; }
  getDisplayText() { return "EasyPub"; }
  getIcon() { return "panels-top-left"; }
  getState() { return { path: this.file?.path, pinned: this.pinned }; }
  async setState(state: { path?: string; pinned?: boolean }, result: ViewStateResult) {
    await super.setState(state, result);
    const file = state.path ? this.app.vault.getAbstractFileByPath(state.path) : null;
    this.pinned = state.pinned === true && file instanceof TFile;
    this.file = this.pinned ? file as TFile : this.currentFile();
    await this.renderArticle();
  }
  async onOpen() {
    this.closed = false;
    const root = this.contentEl; root.empty(); root.addClass("easy-pub-panel");
    const heading = root.createDiv({ cls: "ep-panel-heading" }); heading.createEl("h2", { text: "EasyPub" });
    this.pin = this.button(heading, "固定稿件", async () => {
      this.pinned = !this.pinned;
      if (!this.pinned) this.file = this.currentFile();
      this.app.workspace.requestSaveLayout(); await this.renderArticle();
    });
    const shortcuts = root.createDiv({ cls: "ep-panel-shortcuts" });
    this.button(shortcuts, "Hexo 管理后台", () => this.plugin.openHexoControlRoom());
    this.article = root.createDiv({ cls: "ep-panel-article" });
    const tools = root.createDiv({ cls: "ep-panel-tools" });
    tools.createEl("h3", { text: "常用工具" });
    this.button(tools, "本地构建 Hexo", () => this.plugin.buildHexoLocally());
    this.button(tools, "检查发布目录", async () => new PublishDirectoryModal(this.app, (platform, cancelled) => this.plugin.inspectPublishDirectory(platform, cancelled)).open());
    this.button(tools, "EasyPub 设置", async () => {
      const settings = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
      if (!settings) throw new Error("请通过 Obsidian 设置打开 EasyPub");
      settings.open(); settings.openTabById(this.plugin.manifest.id);
    });
    this.registerEvent(this.app.workspace.on("file-open", file => {
      if (!this.pinned && file?.extension === "md") { this.file = file; void this.renderArticle(); }
      else if (!this.pinned && !file) { this.file = this.currentFile(); void this.renderArticle(); }
    }));
    this.registerEvent(this.app.vault.on("modify", file => { if (file === this.file) this.scheduleArticle(); }));
    this.registerEvent(this.app.vault.on("rename", file => { if (file === this.file) this.scheduleArticle(); }));
    this.registerEvent(this.app.vault.on("delete", file => {
      if (file === this.file) { this.file = null; this.pinned = false; void this.renderArticle(); }
    }));
    if (!this.pinned || !this.file) this.file = this.currentFile();
    await this.renderArticle();
  }
  private currentFile(): TFile | null {
    const active = this.app.workspace.getActiveFile();
    if (active) return active;
    const view = this.app.workspace.activeLeaf?.view;
    if (view?.getViewType() === HEXO_PREVIEW_VIEW) return this.file;
    if (view?.getViewType() === WECHAT_VIEW) {
      const state = view.getState();
      const file = typeof state.path === "string" ? this.app.vault.getAbstractFileByPath(state.path) : null;
      if (file instanceof TFile) return file;
    }
    return null;
  }
  async followFile(file: TFile) {
    if (!this.pinned && !this.closed) { this.file = file; await this.renderArticle(); }
  }
  private button(parent: HTMLElement, text: string, action: () => Promise<unknown>) {
    const button = parent.createEl("button", { text });
    button.onclick = async () => {
      if (button.disabled) return;
      button.disabled = true;
      try { await action(); } catch (error) { new Notice((error as Error).message); }
      finally { button.disabled = false; }
    };
    return button;
  }
  private scheduleArticle() {
    this.generation++; // Invalidate a read immediately, before the debounce fires.
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => { this.refreshTimer = undefined; void this.renderArticle(); }, 200);
  }
  private async renderArticle() {
    if (!this.article || this.closed) return;
    const generation = ++this.generation, file = this.file;
    this.pin.textContent = this.pinned ? "取消固定" : "固定稿件";
    this.pin.setAttribute("aria-pressed", String(this.pinned)); this.pin.disabled = !file;
    if (!file || file.extension !== "md") { this.displayKey = undefined; this.displayPath = undefined; this.article.empty(); this.article.createEl("p", { text: "打开一篇 Markdown 文章，开始准备发布稿。下方工具随时可用。" }); return; }
    if (this.displayPath !== file.path) {
      this.displayPath = file.path; this.displayKey = undefined;
      this.article.empty(); this.article.createEl("p", {text: "正在读取文章…"});
    }
    try {
      const meta = parseFrontMatter(await this.app.vault.read(file), true).data;
      if (generation !== this.generation || this.closed) return;
      const source = meta.source_file ? await this.plugin.resolvePublishingSource(file, meta) : file;
      if (generation !== this.generation || this.closed) return;
      const key = JSON.stringify([file.path, getFrontMatterString(meta, "title") || file.basename,
        meta.pub_id, meta.source_file, source?.path, this.plugin.settings.publishBasePath]);
      if (key === this.displayKey) return;
      this.displayKey = key;
      this.article.empty();
      const platform = PLATFORMS.find(p => !p.isExternal && file.path.startsWith(`${getPublishPath(p, this.plugin.settings)}/`));
      this.article.createEl("small", { text: meta.source_file ? `${platform?.name ?? "平台"}发布稿` : "原稿" });
      this.article.createEl("h3", { text: getFrontMatterString(meta, "title") || file.basename });
      this.article.createEl("p", { text: file.path, cls: "ep-panel-path" });
      const actions = this.article.createDiv({ cls: "ep-panel-actions" });
      this.button(actions, "打开当前文章", () => this.app.workspace.getLeaf(false).openFile(file));
      if (meta.source_file) {
        if (source) this.button(actions, "返回原稿", () => this.app.workspace.getLeaf(false).openFile(source));
        else this.article.createEl("p", { text: "原稿关联无效，请检查 source_file 和 pub_id。" });
      }
      if (source) {
        this.button(actions, "创建 / 更新发布稿", async () => {
          this.plugin.showPlatformSelector(false, source);
        }).addClass("mod-cta");
        this.button(actions, "刷新平台属性", async () => {
          this.plugin.showPlatformSelector(true, source);
        });
      }
      if (platform?.id === "wechat") this.button(actions, "打开公众号工作台", () => this.plugin.openWechatDraft(file));
      if (!source) return;
      const related = this.article.createDiv({ cls: "ep-panel-related" });
      related.createEl("h3", { text: "平台稿件" });
      // Scan only on explicit action, rather than traversing external repositories on each keystroke.
      for (const target of PLATFORMS) {
        const row = related.createDiv({ cls: "ep-panel-platform" }); row.createEl("strong", { text: target.name });
        let state: "unknown" | "checking" | "exists" | "missing" = "unknown";
        const reset = () => { state = "unknown"; draft.textContent = "检查稿件"; };
        const draft = this.button(row, "检查稿件", async () => {
          try {
            if (state === "unknown") {
              state = "checking"; draft.textContent = "正在检查…";
              const exists = await this.plugin.hasRelatedDraft(source, target);
              state = exists ? "exists" : "missing";
              draft.textContent = exists ? "打开稿件" : "创建稿件";
            } else if (state === "exists") await this.plugin.openRelatedDraft(source, target);
            else if (state === "missing") {
              await this.plugin.preparePublish(target, false, {configure: true, sourceFile: source});
              reset();
            }
          } catch (error) {
            // A target may move or disappear after a successful explicit check.
            // Keep the failure notice and make the next click a fresh query.
            reset(); throw error;
          }
        });
        if (target.id === "hexo") {
          this.button(row, "预览", () => this.plugin.previewHexoArticle(source));
          this.button(row, "一键排版", () => this.plugin.formatHexoArticle(source));
        }
      }
    } catch (error) {
      if (generation === this.generation && !this.closed) { this.displayKey = undefined; this.article.empty(); this.article.createEl("p", { text: (error as Error).message }); }
    }
  }
  async onClose() { if (this.refreshTimer) clearTimeout(this.refreshTimer); this.displayKey = undefined; this.displayPath = undefined; this.closed = true; this.generation++; this.contentEl.empty(); }
}
