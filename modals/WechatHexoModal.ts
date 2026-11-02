import { App, Modal } from "obsidian";
import type { ArticleDiff } from "../types";
import type { WechatHexoMode } from "../utils/wechatHexoContent";
import { DiffModal } from "./DiffModal";

export interface WechatHexoPreview {
  mode: WechatHexoMode;
  diff: ArticleDiff;
  preview: string;
}

/** Waits for a concrete, guarded write; cancel/close never creates a draft. */
export class WechatHexoModal<Plan extends WechatHexoPreview> extends Modal {
  private closed = false;
  private saved = false;
  private applying = false;
  private generation = 0;
  private current?: Plan;
  private mode!: WechatHexoMode;
  private choices = new Map<WechatHexoMode, {input: HTMLInputElement; label: HTMLElement}>();
  private target!: HTMLElement;
  private saveNote!: HTMLElement;
  private body!: HTMLElement;
  private status!: HTMLElement;
  private save!: HTMLButtonElement;
  constructor(app: App, private initial: Plan, private prepare: (mode: WechatHexoMode) => Promise<Plan>,
    private apply: (plan: Plan, assertActive: () => void) => Promise<void>, private done: (saved: boolean) => void) { super(app); }
  onOpen() {
    this.modalEl.addClass("easy-pub-composer-modal", "easy-pub-hexo-modal");
    const root = this.contentEl;
    root.addClass("ep-compose");
    const header = root.createDiv({cls:"ep-compose-header"});
    header.createEl("h2", {text: "生成 Hexo 稿"});
    header.createEl("p", {text:"选择正文格式，核对后保存到博客。", cls:"ep-compose-subtitle"});
    this.target = header.createDiv({cls:"ep-compose-path ep-compose-target"});
    const workspace = root.createDiv({cls:"ep-compose-body"});
    const options = workspace.createDiv({cls:"ep-compose-options"});
    options.createEl("h3", {text:"正文格式"});
    const formats = options.createDiv({attr:{role:"radiogroup", "aria-label":"Hexo 正文格式"}});
    this.mode = this.initial.mode;
    const labels: Array<{mode:WechatHexoMode; title:string; description:string}> = [
      {mode:"markdown", title:"普通 Markdown", description:"保留可编辑正文，外观跟随博客主题。"},
      {mode:"layout", title:"保留公众号排版", description:"沿用字体、配色和卡片，保存为 HTML。"},
    ];
    for (const item of labels) {
      const label = formats.createEl("label", {cls:"ep-choice"});
      const input = label.createEl("input", {type:"radio", attr:{name:"ep-hexo-format", value:item.mode, "aria-label":item.title}});
      input.checked = this.mode === item.mode;
      const copy = label.createDiv({cls:"ep-choice-copy"});
      const title = copy.createDiv({cls:"ep-choice-title"});
      title.createEl("strong", {text:item.title});
      if (item.mode === "markdown") title.createEl("span", {text:"推荐", cls:"ep-choice-tag"});
      copy.createEl("small", {text:item.description});
      label.classList.toggle("is-selected", input.checked);
      this.choices.set(item.mode, {input,label});
      input.onchange = () => {
        if (!input.checked || this.closed || this.applying) return;
        this.mode = item.mode;
        for (const [mode, choice] of this.choices) choice.label.classList.toggle("is-selected", mode === this.mode);
        void this.switchMode(this.mode);
      };
    }
    options.createEl("p", {text:"两种格式都使用当前公众号本地稿，并将本地图片复制到博客。", cls:"ep-compose-mode-note"});
    this.body = workspace.createDiv({cls:"ep-compose-preview"});
    const footer = root.createDiv({cls:"ep-compose-footer"});
    const feedback = footer.createDiv({cls:"ep-compose-feedback"});
    this.saveNote = feedback.createEl("p", {cls:"ep-compose-footer-note"});
    this.status = feedback.createEl("p", {cls:"ep-compose-status", attr:{role:"status", "aria-live":"polite"}});
    const actions = footer.createDiv({cls:"ep-compose-actions"});
    actions.createEl("button", {text:"取消"}).onclick = () => this.close();
    this.save = actions.createEl("button", {cls:"mod-cta"});
    this.show(this.initial);
    this.save.onclick = async () => {
      const plan = this.current;
      if (this.save.disabled || this.closed || this.applying || !plan || plan.mode !== this.mode) return;
      this.applying = true;
      this.save.disabled = true;
      for (const {input} of this.choices.values()) input.disabled = true;
      const generation = this.generation;
      try {
        await this.apply(plan, () => {
          if (this.closed || generation !== this.generation || this.current !== plan) throw new Error("生成预览已关闭或变化，已取消写入");
        });
        this.saved = true; if (!this.closed) this.close();
      } catch (error) {
        if (!this.closed) {
          this.status.classList.add("is-error"); this.status.textContent = (error as Error).message; this.save.disabled = false;
          for (const {input} of this.choices.values()) input.disabled = false;
        }
      } finally {this.applying = false;}
    };
  }
  private show(plan: Plan) {
    this.current = plan;
    this.body.empty();
    this.target.textContent = plan.diff.targetPath;
    this.target.setAttribute("title", plan.diff.targetPath);
    this.saveNote.textContent = plan.diff.isNew ? "将新建 Hexo 草稿，不自动部署。" : "更新已有稿件，保存前自动备份；博客属性保持不变。";
    const markdown = plan.mode === "markdown";
    const heading = this.body.createDiv({cls:"ep-compose-preview-header"});
    heading.createEl("h3", {text:markdown ? "Markdown 正文" : "公众号排版预览"});
    heading.createEl("span", {text:markdown ? "跟随博客主题" : "保留当前视觉风格", cls:"ep-compose-preview-label"});
    const preview = this.body.createDiv({cls: `ep-wechat-hexo-preview ${markdown ? "is-markdown" : "is-layout"}`});
    if (markdown) preview.createEl("pre", {text:plan.preview});
    else preview.innerHTML = plan.preview;
    const details = this.body.createEl("details", {cls:"ep-compose-disclosure"}); details.createEl("summary", {text:"查看元数据与正文差异"});
    if (plan.diff.targetContent !== null) new DiffModal(this.app, plan.diff, () => {}).renderDiff(details);
    else details.createEl("pre", {text:plan.diff.sourceContent});
    this.save.textContent = plan.diff.isNew ? "确认生成 Hexo 草稿" : "确认更新 Hexo 稿";
    this.save.disabled = false;
  }
  private async switchMode(mode: WechatHexoMode) {
    if (this.closed || this.applying) return;
    const generation = ++this.generation;
    this.current = undefined;
    this.save.disabled = true;
    this.body.empty();
    this.body.createDiv({text:"正在准备预览…", cls:"ep-compose-loading"});
    this.status.classList.remove("is-error");
    this.status.textContent = "正在准备所选格式的正文与差异…";
    try {
      const plan = await this.prepare(mode);
      if (this.closed || generation !== this.generation || mode !== this.mode) return;
      this.show(plan);
      this.status.textContent = "请核对所选格式的正文后确认。";
    } catch (error) {
      if (!this.closed && generation === this.generation) {this.status.classList.add("is-error"); this.status.textContent = (error as Error).message;}
    }
  }
  onClose() {this.closed = true; this.generation++; this.current = undefined; this.contentEl.empty(); this.done(this.saved);}
}
