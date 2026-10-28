import { Modal } from "obsidian";
import type EasyPub from "../main";
import { WechatImage, WechatLayoutDocument, WechatLayoutPlan, WechatLayoutComponent, WechatThemeId } from "../types";
import { LAYOUT_COMPONENT_ROLES, mergeLockedLayout, themePlan, validateWechatLayout } from "../utils/wechatLayoutEngine";
import { COMPONENT_LABELS, WECHAT_ACCENTS, WECHAT_THEMES, WECHAT_THEME_DESIGNS, themePalette } from "../utils/wechatThemes";
import { plannerMessages, planWechatLayout } from "../utils/wechatAiPlanner";
import { validateAiEndpoint } from "../utils/wechatAiProvider";
import { layoutPreview } from "../utils/wechatLayoutPreview";
export { layoutPreview } from "../utils/wechatLayoutPreview";
import { previewWechatHtml } from "../utils/wechatRenderer";

export interface WechatLayoutContext {
  title: string; html: string; images: WechatImage[]; document: WechatLayoutDocument;
  current?: WechatLayoutPlan; history: WechatLayoutPlan[];
  assertFresh: () => Promise<void>;
  apply: (plan: WechatLayoutPlan, assertActive: () => void) => Promise<void>;
  onClose?: () => void;
}

export class WechatLayoutModal extends Modal {
  private selected: WechatLayoutPlan;
  private blockControls = new Map<string, {select: HTMLSelectElement; lock: HTMLInputElement}>();
  private savedSelect?: HTMLSelectElement;
  private candidateNames = "";
  private previewFrame?: number;
  private candidates: Array<{name: string; plan: WechatLayoutPlan}> = [];
  private undo: WechatLayoutPlan[] = [];
  private requestVersion = 0;
  private closed = false;
  // Transport lifetime is separate from authority to change the current plan.
  private requests = new Set<number>();
  private get pending(): boolean { return this.requests.has(this.requestVersion); }
  private canRequest(): boolean { return !this.pending && this.requests.size < 2; }
  private status!: HTMLElement;
  private preview!: HTMLElement;
  private controls!: HTMLElement;
  private gallery!: HTMLElement;
  private sendArea!: HTMLElement;
  private applyButton!: HTMLButtonElement;
  private requestButton!: HTMLButtonElement;
  private original = false;
  private selectedRenderable = true;
  private previewReady = false;
  private applying = false;
  private compareButton!: HTMLButtonElement;
  private undoButton!: HTMLButtonElement;
  private previewLabel!: HTMLElement;
  private aiTheme: WechatThemeId | "auto" = "auto";
  constructor(private plugin: EasyPub, private context: WechatLayoutContext) {
    super(plugin.app);
    try { this.selected = validateWechatLayout(context.current, context.document); }
    catch { this.selected = themePlan(context.document, "default"); }
    this.candidates = [{name: "打开时的方案", plan: structuredClone(this.selected)},
      ...context.history.flatMap(plan => {
        try { return [validateWechatLayout(plan, context.document)]; }
        catch { return []; } // Historical metadata can outlive its block mapping.
      }).slice(-4).map((plan, i) => ({name: `已保存历史 ${i + 1}`, plan}))];
  }
  onOpen() {
    const root = this.contentEl; root.empty(); root.addClass("easy-pub-layout");
    this.modalEl?.addClass("easy-pub-layout-modal");
    root.createEl("h2", {text: "智能排版"});
    root.createEl("p", {cls: "epl-intro", text: "选择风格 → 调整重点 → 应用到本地稿。文字与图片保持原样，同步公众号草稿箱需单独操作。"});
    this.status = root.createDiv({attr: {role: "status", "aria-live": "polite"}});
    const mobileTabs = root.createDiv({cls: "epl-mobile-tabs", attr: {"aria-label": "排版工作区"}});
    const showPane = (preview: boolean) => {
      root.classList.toggle("epl-show-preview", preview);
      editTab.setAttribute("aria-pressed", String(!preview));
      previewTab.setAttribute("aria-pressed", String(preview));
    };
    const editTab = this.button(mobileTabs, "风格与调整", () => showPane(false));
    const previewTab = this.button(mobileTabs, "查看排版预览", () => showPane(true));
    showPane(false);
    const main = root.createDiv({cls: "epl-main"});
    const options = main.createDiv({cls: "epl-options"});
    options.createEl("h3", {text: "正文风格"});
    const theme = options.createEl("label", {text: "排版风格", cls: "epl-field"}).createEl("select", {attr: {"aria-label": "排版风格"}});
    for (const [id, name] of Object.entries(WECHAT_THEMES)) theme.createEl("option", {value: id, text: name});
    theme.value = this.selected.theme;
    theme.onchange = () => { this.change({...this.selected, theme: theme.value as WechatThemeId, accentColor: "preset"}); };
    const gallery = options.createEl("details", {cls: "epl-theme-browser"}); gallery.open = true;
    gallery.createEl("summary", {text: `风格画廊 · ${Object.keys(WECHAT_THEMES).length} 套正文排版`});
    this.gallery = gallery.createDiv({cls: "epl-theme-grid", attr: {role: "group", "aria-label": "正文风格预设"}});
    const accent = options.createEl("label", {text: "强调色", cls: "epl-field"}).createEl("select", {attr: {"aria-label": "强调色"}});
    const colors = {preset: "跟随风格配色", teal: "青绿", blue: "蓝色", amber: "暖棕", rose: "玫红"};
    for (const id of Object.keys(WECHAT_ACCENTS) as Array<keyof typeof colors>) accent.createEl("option", {value: id, text: colors[id]});
    accent.value = this.selected.accentColor;
    accent.onchange = () => this.change({...this.selected, accentColor: accent.value as WechatLayoutPlan["accentColor"]});
    const tools = options.createDiv({cls: "epl-actions"});
    this.compareButton = this.button(tools, "对比默认 / 当前方案", () => { this.original = !this.original; this.updatePreview(); });
    this.undoButton = this.button(tools, "撤销本次调整", () => { if (this.applying) return; const last = this.undo.pop(); if (last) { this.requestVersion++; this.selected = last; this.original = false; this.sendArea.empty(); this.status.textContent = "已撤销调整，尚未保存；旧 AI 响应不会覆盖当前方案。"; this.redraw(); } });
    this.button(tools, "恢复默认排版", () => this.change(themePlan(this.context.document, "default")));
    const ai = options.createEl("details", {cls: "epl-ai-section"});
    ai.createEl("summary", {text: "AI 辅助排版（可选）"});
    ai.createEl("p", {text: "本地风格可直接使用；AI 可建议重点与组件，发送前会展示请求内容。"});
    const aiTools = ai.createDiv({cls: "epl-actions"});
    this.button(aiTools, "配置 AI 服务", () => this.plugin.openWechatAiSettings(() => { this.requestVersion++; this.sendArea.empty(); this.status.textContent = "服务配置已更新，请重新准备请求；旧响应不会应用。"; this.updatePreview(); }));
    const preference = ai.createEl("label", {text: "AI 风格偏好", cls: "epl-field"}).createEl("select", {attr: {"aria-label": "AI 风格偏好"}});
    preference.createEl("option", {value: "auto", text: "AI 自动判断"});
    for (const [id, name] of Object.entries(WECHAT_THEMES)) preference.createEl("option", {value: id, text: name});
    preference.onchange = () => { this.aiTheme = preference.value as typeof this.aiTheme; this.requestVersion++; this.sendArea.empty(); this.status.textContent = "AI 风格偏好已更新，请重新准备请求；旧响应不会应用。"; this.updatePreview(); };
    this.requestButton = this.button(aiTools, "准备 AI 排版请求", () => { void this.prepareRequest(); });
    this.sendArea = ai.createDiv({cls: "epl-request"});
    if (!this.context.document.blocks.length) options.createEl("p", {text: "此文章无法可靠映射语义区块，仍可切换本地主题。AI 与逐块调整暂不可用。"});
    this.controls = options.createDiv({cls: "epl-controls"});
    const previewPane = main.createDiv({cls: "epl-preview-pane"});
    this.previewLabel = previewPane.createEl("h3", {cls: "epl-preview-label"});
    this.preview = previewPane.createDiv({cls: "epl-preview", attr: {role: "region", "aria-label": "排版方案预览", tabindex: "0"}});
    const footer = root.createDiv({cls: "epl-actions epl-footer"});
    this.applyButton = this.button(footer, "应用排版到本地稿", () => { void this.apply(); }); this.applyButton.addClass("mod-cta");
    this.button(footer, "取消", () => this.close());
    this.renderThemeGallery();
    this.redraw();
  }
  private button(parent: HTMLElement, text: string, action: () => void) {
    const button = parent.createEl("button", {text}); button.onclick = action; return button;
  }
  private change(plan: WechatLayoutPlan) {
    if (this.applying || this.closed) return;
    const validated = validateWechatLayout(plan, this.context.document);
    this.undo.push(structuredClone(this.selected)); this.undo = this.undo.slice(-20);
    this.selected = validated; this.original = false;
    this.status.textContent = this.requests.size ? "手工调整已保留，旧 AI 响应将被丢弃；预览校验后可应用当前方案。" : "方案已调整，尚未保存到本地稿。";
    this.requestVersion++; this.sendArea.empty(); this.redraw();
  }
  private redraw() {
    const root = this.contentEl;
    const theme = root.querySelector<HTMLSelectElement>('select[aria-label="排版风格"]'); if (theme) theme.value = this.selected.theme;
    const color = root.querySelector<HTMLSelectElement>('select[aria-label="强调色"]'); if (color) color.value = this.selected.accentColor;
    this.gallery.querySelectorAll<HTMLButtonElement>("button[data-theme]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.theme === this.selected.theme));
    });
    this.undoButton.disabled = !this.undo.length || this.applying;
    if (!this.savedSelect) {
      const saved = this.controls.createEl("label", {text: "候选与历史", cls: "epl-field"}).createEl("select", {attr: {"aria-label": "候选与历史"}});
      saved.createEl("option", {value: "", text: "选择已有方案"});
      this.savedSelect = saved;
      saved.onchange = () => { if (saved.value !== "") this.change(mergeLockedLayout(this.candidates[Number(saved.value)].plan, this.selected, this.context.document)); };
      const details = this.controls.createEl("details"); details.createEl("summary", {text: `逐块调整与锁定 · ${this.context.document.blocks.length} 个区块`});
      details.open = false;
      const instructions = new Map(this.selected.blocks.map(block => [block.id, block]));
      for (const block of this.context.document.blocks) {
        const row = details.createDiv({cls: "epl-block"});
        const kinds = {paragraph: "段落", heading: "标题", list: "列表", quote: "引用", code: "代码", image: "图片", table: "表格", divider: "分隔线", other: "其他内容"};
        row.createEl("p", {text: `第 ${block.line} 行 · ${kinds[block.kind]} · ${block.text.slice(0, 90) || "（图片或分隔线）"}`});
        const instruction = instructions.get(block.id);
        const select = row.createEl("select", {attr: {"aria-label": `第 ${block.line} 行排版`}});
        for (const [id, label] of Object.entries(COMPONENT_LABELS)) if (id === "plain" || ["paragraph", "list", "quote"].includes(block.kind)) select.createEl("option", {value: id, text: label});
        select.value = instruction?.component ?? "plain";
        select.onchange = () => this.setBlock(block.id, select.value as WechatLayoutComponent, lock.checked);
        const lock = row.createEl("label", {text: "锁定此区块"}).createEl("input", {type: "checkbox", attr: {"aria-label": `锁定第 ${block.line} 行`}});
        lock.checked = instruction?.locked === true;
        lock.onchange = () => this.setBlock(block.id, select.value as WechatLayoutComponent, lock.checked);
        this.blockControls.set(block.id, {select, lock});
      }
    }
    const names = JSON.stringify(this.candidates.map(candidate => candidate.name));
    if (names !== this.candidateNames) {
      this.candidateNames = names;
      this.savedSelect!.length = 1;
      this.candidates.forEach((candidate, i) => this.savedSelect!.createEl("option", {value: String(i), text: candidate.name}));
    }
    this.savedSelect!.value = "";
    const instructions = new Map(this.selected.blocks.map(block => [block.id, block]));
    for (const [id, controls] of this.blockControls) {
      const instruction = instructions.get(id);
      controls.select.value = instruction?.component ?? "plain";
      controls.lock.checked = instruction?.locked === true;
    }
    // Disable apply until the coalesced preview has passed the full safety check.
    this.applyButton.disabled = true;
    if (this.previewFrame === undefined) this.previewFrame = requestAnimationFrame(() => {
      this.previewFrame = undefined;
      if (!this.closed) this.updatePreview();
    });
  }
  private renderThemeGallery() {
    this.gallery.empty();
    for (const [id, name] of Object.entries(WECHAT_THEMES) as Array<[WechatThemeId, string]>) {
      const design = WECHAT_THEME_DESIGNS[id], palette = themePalette(id, "preset");
      const button = this.button(this.gallery, "", () => this.change({...this.selected, theme: id, accentColor: "preset"}));
      button.className = "epl-theme-card"; button.dataset.theme = id;
      button.setAttribute("aria-label", `使用${name}风格`);
      button.setAttribute("aria-pressed", String(this.selected.theme === id));
      const sample = button.createEl("span", {cls: "epl-theme-sample", attr: {"aria-hidden": "true"}});
      sample.style.background = palette.canvas; sample.style.color = palette.text; sample.style.fontFamily = palette.font;
      const heading = sample.createEl("span", {text: "让文字有温度", cls: "epl-theme-sample-title"});
      heading.style.color = palette.accent;
      if (design.motif === "band") { heading.style.background = palette.accent; heading.style.color = "#fff"; heading.style.padding = "3px 4px"; }
      if (design.motif === "line") { heading.style.borderBottom = `1px solid ${palette.accent}`; heading.style.paddingBottom = "4px"; }
      if (design.motif === "bar") { heading.style.borderLeft = `2px solid ${palette.accent}`; heading.style.paddingLeft = "5px"; }
      if (design.motif === "center") { heading.style.textAlign = "center"; heading.style.borderBottom = `1px solid ${palette.line}`; heading.style.paddingBottom = "4px"; }
      for (const width of ["96%", "72%"]) { const line = sample.createEl("span", {cls: "epl-theme-sample-line"}); line.style.width = width; line.style.background = palette.line; }
      button.createEl("span", {text: name, cls: "epl-theme-name"});
      button.createEl("span", {text: design.description, cls: "epl-theme-description"});
    }
  }
  private setBlock(id: string, component: WechatLayoutComponent, locked: boolean) {
    this.change({...this.selected, blocks: [...this.selected.blocks.filter(b => b.id !== id), {id, role: LAYOUT_COMPONENT_ROLES[component], component, ...(locked ? {locked: true} : {})}]});
  }
  private updateActionState() {
    this.requestButton.disabled = !this.canRequest() || this.applying || !this.context.document.blocks.length;
    this.requestButton.title = this.requests.size >= 2 ? "仍有两个 AI 请求等待结束；可继续手工调整并应用，释放名额后可再次请求。" : "";
    this.applyButton.disabled = this.applying || this.pending || !this.selectedRenderable
      || !this.previewReady || this.previewFrame !== undefined;
  }
  private updatePreview() {
    this.compareButton.setAttribute("aria-pressed", String(this.original));
    this.previewLabel.textContent = this.original ? "默认模板 · 仅供对比" : `当前方案 · ${WECHAT_THEMES[this.selected.theme]}`;
    try {
      const plan = this.original ? themePlan(this.context.document, "default") : this.selected;
      const scroll = this.preview.scrollTop;
      this.preview.innerHTML = previewWechatHtml(layoutPreview(this.context.html, this.context.document, plan), this.context.images);
      this.preview.scrollTop = scroll;
      if (!this.original) this.selectedRenderable = true;
      this.preview.setAttribute("aria-label", this.original ? "默认模板预览" : "排版方案预览");
      this.previewReady = true;
    } catch (error) {
      this.status.textContent = (error as Error).message;
      this.previewReady = false;
      if (!this.original) {
        this.selectedRenderable = false;
        this.preview.empty();
        this.preview.createEl("p", {text: "当前方案无法预览，请调整风格或减少重点组件。也可切换默认模板对比。"});
      }
    }
    this.updateActionState();
  }
  private async prepareRequest() {
    if (!this.canRequest() || this.applying || this.closed) return;
    const version = ++this.requestVersion;
    this.sendArea.empty();
    try {
      await this.context.assertFresh();
      if (this.closed || this.applying || version !== this.requestVersion) return;
      const config = this.plugin.getWechatAiConfiguration();
      const destination = validateAiEndpoint(config.settings.endpoint);
      if (!config.settings.model) throw new Error("请先配置模型名称");
      const messages = plannerMessages(this.context.title, this.context.document, this.aiTheme, this.selected);
      this.sendArea.empty();
      this.sendArea.createEl("p", {text: `发送到 ${destination} · 模型 ${config.settings.model}。以下为完整请求内容，只包含标题、区块类型、文字片段和排版指令；不含图片字节、Vault 文件、公众号凭据与草稿缓存。`});
      const details = this.sendArea.createEl("details"); details.createEl("summary", {text: "查看将发送的全部内容"});
      const data = details.createEl("textarea", {attr: {"aria-label": "将发送的全部内容", readonly: ""}}); data.value = JSON.stringify(messages, null, 2);
      const send = this.button(this.sendArea, "确认发送这些片段并生成方案", () => { void this.generate(messages, config, version); });
      send.disabled = !this.canRequest();
    } catch (error) { if (!this.closed && version === this.requestVersion) this.status.textContent = (error as Error).message; }
  }
  private async generate(messages: ReturnType<typeof plannerMessages>, config: ReturnType<EasyPub["getWechatAiConfiguration"]>, version: number) {
    if (!this.canRequest() || this.applying || this.closed || version !== this.requestVersion) return;
    this.requests.add(version); this.updateActionState();
    this.status.textContent = "AI 正在规划，可继续查看；修改方案或关闭窗口会丢弃旧响应。";
    try {
      await this.context.assertFresh();
      if (this.closed || version !== this.requestVersion) return;
      if (JSON.stringify(config) !== JSON.stringify(this.plugin.getWechatAiConfiguration())) throw new Error("服务配置已变化，请重新准备请求");
      const proposed = await planWechatLayout(config.settings, config.key, messages, this.context.document, structuredClone(this.selected));
      await this.context.assertFresh();
      if (this.closed || version !== this.requestVersion || JSON.stringify(config) !== JSON.stringify(this.plugin.getWechatAiConfiguration())) return;
      this.candidates.push({name: `AI 方案 ${this.candidates.filter(c => c.name.startsWith("AI")).length + 1}`, plan: proposed});
      this.candidates = this.candidates.slice(-8); this.change(proposed);
      this.status.textContent = "AI 方案已生成，请预览并逐块调整；尚未应用到本地稿。";
    } catch (error) {
      if (this.closed || version !== this.requestVersion) return;
      this.change(themePlan(this.context.document, "default"));
      this.status.textContent = `${(error as Error).message}。预览已回退默认模板；本地已保存的排版未变化。`;
    } finally { this.requests.delete(version); if (!this.closed) this.updateActionState(); }
  }
  private async apply() {
    if (this.applying || this.pending || this.closed || this.applyButton.disabled) return;
    this.applying = true;
    const version = ++this.requestVersion;
    const selected = structuredClone(this.selected);
    this.sendArea.empty();
    this.applyButton.disabled = true;
    this.applyButton.textContent = "正在保存排版…";
    this.contentEl.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>(".epl-options button, .epl-options select, .epl-options input").forEach(el => { el.disabled = true; });
    try {
      await this.context.assertFresh();
      if (this.closed || version !== this.requestVersion) return;
      const plan = validateWechatLayout(selected, this.context.document);
      layoutPreview(this.context.html, this.context.document, plan);
      await this.context.apply(plan, () => {
        if (this.closed || version !== this.requestVersion) throw new Error("排版应用已取消");
      });
      if (!this.closed) this.close();
    }
    catch (error) { if (!this.closed) this.status.textContent = (error as Error).message; }
    finally {
      this.applying = false;
      if (!this.closed) {
        this.applyButton.textContent = "应用排版到本地稿";
        this.contentEl.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>(".epl-options button, .epl-options select, .epl-options input").forEach(el => { el.disabled = false; });
        this.redraw();
      }
    }
  }
  onClose() {
    if (this.previewFrame !== undefined) cancelAnimationFrame(this.previewFrame);
    this.previewFrame = undefined;
    this.closed = true; this.requestVersion++; this.contentEl.empty();
    this.context.onClose?.();
  }
}
