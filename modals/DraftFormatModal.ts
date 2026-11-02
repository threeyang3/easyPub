import { App, Modal, Notice, TFile } from "obsidian";
import type EasyPub from "../main";
import { DraftFormatSession } from "../utils/draftFormatting";
import { formattingChanges } from "../utils/formatChanges";
import { getFrontMatterString, parseFrontMatter } from "../utils/frontMatter";

/** Preview explicit body edits before changing the bound platform draft. */
export class DraftFormatModal extends Modal {
  private closed = false;
  private saved = false;
  constructor(app: App, private session: DraftFormatSession, private done: (saved: boolean) => void) { super(app); }
  onOpen() {
    this.modalEl.addClass("easy-pub-composer-modal", "easy-pub-basic-format-modal");
    const root = this.contentEl; root.addClass("ep-compose");
    const header = root.createDiv({cls: "ep-compose-header"});
    header.createEl("h2", {text: "基础排版"});
    header.createEl("p", {text: "统一段落缩进与间距，预览后保存。", cls: "ep-compose-subtitle"});
    const context = header.createDiv({cls: "ep-compose-context"});
    context.createEl("span", {text: this.session.platform.name, cls: "ep-compose-kind"});
    const title = getFrontMatterString(parseFrontMatter(this.session.before).data, "title")
      || this.session.targetPath.split(/[\\/]/).pop() || this.session.targetPath;
    context.createEl("span", {text: title, cls: "ep-compose-name", attr: {title: this.session.targetPath}});
    const body = root.createDiv({cls: "ep-compose-body"});
    const options = body.createDiv({cls: "ep-compose-options"});
    options.createEl("h3", {text: "整理选项"});
    const choice = (name: string, description: string, sampleClass: string, lines: string[]) => {
      const label = options.createEl("label", {cls: "ep-choice is-selected"});
      const input = label.createEl("input", {type: "checkbox", attr: {"aria-label": name}}); input.checked = true;
      const copy = label.createDiv({cls: "ep-choice-copy"});
      copy.createEl("strong", {text: name}); copy.createEl("small", {text: description});
      const sample = copy.createDiv({cls: `ep-format-sample ${sampleClass}`, attr: {"aria-hidden": "true"}});
      for (const line of lines) sample.createEl("span", {text: line});
      return {label, input};
    };
    const indent = choice("段落首行空两格", "写入两个全角空格", "ep-sample-indent", ["这是段落的第一行", "这是同一段的下一行"]);
    const separate = choice("段落之间加空行", "相邻正文行分成独立段落", "ep-sample-spacing", ["第一段正文", "下一段正文"]);
    const indentInput = indent.input, separateInput = separate.input;
    const rules = options.createEl("details", {cls: "ep-compose-disclosure"});
    rules.createEl("summary", {text: "排版规则与备份"});
    rules.createEl("p", {text: "标题、代码、列表、引用、表格、独立图片行与 HTML 保留原结构。重复应用不叠加缩进或空行。"});
    rules.createEl("p", {text: "加空行会将普通正文的软换行、显式硬换行都转换为空行分段。请核对预览。"});
    rules.createEl("p", {text: "保存前自动备份原文："});
    rules.createEl("p", {text: this.session.backupPath, cls: "ep-compose-path"});
    const previewPane = body.createDiv({cls: "ep-compose-preview"});
    const previewHeader = previewPane.createDiv({cls: "ep-compose-preview-header"});
    previewHeader.createEl("h3", {text: "正文预览"});
    const tabs = previewHeader.createDiv({cls: "ep-compose-tabs", attr: {"aria-label": "正文预览方式"}});
    const diffTab = tabs.createEl("button", {text: "仅看改动", attr: {"aria-pressed": "true"}});
    const fullTab = tabs.createEl("button", {text: "查看完整内容", attr: {"aria-pressed": "false"}});
    const summary = previewPane.createEl("p", {cls: "ep-compose-summary", attr: {"aria-live": "polite"}});
    const notice = previewPane.createEl("p", {cls: "ep-compose-notice"});
    const surface = previewPane.createDiv({cls: "ep-format-surface"});
    const changes = surface.createDiv({cls: "ep-format-diff", attr: {role: "region", "aria-label": "基础排版差异"}});
    const grid = surface.createDiv({cls: "ep-format-full"}); grid.hidden = true;
    const original = grid.createDiv(); original.createEl("h4", {text: "修改前"});
    original.createEl("pre", {text: parseFrontMatter(this.session.before).content});
    const formatted = grid.createDiv(); formatted.createEl("h4", {text: "排版后"}); const after = formatted.createEl("pre");
    previewPane.createEl("small", {text: "□ 表示一个全角空格，仅在差异中标记。", cls: "ep-compose-legend"});
    const footer = root.createDiv({cls: "ep-compose-footer"});
    const statusArea = footer.createDiv({cls: "ep-compose-feedback"});
    const status = statusArea.createEl("p", {cls: "ep-compose-status", attr: {role: "status", "aria-live": "polite"}});
    statusArea.createEl("small", {text: "保存到当前稿件，原文自动备份", cls: "ep-compose-savehint"});
    const actions = footer.createDiv({cls: "ep-compose-actions"});
    actions.createEl("button", {text: "取消"}).onclick = () => this.close();
    const save = actions.createEl("button", {text: "应用基础排版", cls: "mod-cta"});
    let preview: ReturnType<DraftFormatSession["preview"]>;
    let full = false, applying = false;
    const update = () => {
      if (applying || this.closed) return;
      try {
        preview = this.session.preview({indentParagraphs: indentInput.checked, separateParagraphs: separateInput.checked});
        summary.textContent = `调整 ${preview.indentedParagraphs} 个段落首行，增加 ${preview.addedBreaks} 处段落空行，清理 ${preview.trimmedLines} 行末尾空格。`;
        notice.textContent = preview.layoutNotice ?? ""; notice.hidden = !preview.layoutNotice;
        renderFormattingDiff(changes, formattingChanges(this.session.before, preview.content));
        after.textContent = parseFrontMatter(preview.content).content;
        indent.label.classList.toggle("is-selected", indentInput.checked);
        separate.label.classList.toggle("is-selected", separateInput.checked);
        save.disabled = preview.content === this.session.before;
        status.classList.remove("is-error");
        status.textContent = save.disabled ? "正文已符合所选格式，无需保存。" : "";
      } catch (error) { save.disabled = true; status.classList.add("is-error"); status.textContent = (error as Error).message; }
    };
    indentInput.onchange = update; separateInput.onchange = update;
    const showFull = (value: boolean) => {
      full = value; grid.hidden = !full; changes.hidden = full;
      diffTab.setAttribute("aria-pressed", String(!full)); fullTab.setAttribute("aria-pressed", String(full));
    };
    diffTab.onclick = () => showFull(false); fullTab.onclick = () => showFull(true);
    save.onclick = async () => {
      if (save.disabled || this.closed || applying) return;
      applying = true; save.disabled = true; indentInput.disabled = true; separateInput.disabled = true;
      try {
        await this.session.apply(preview, () => { if (this.closed) throw new Error("排版窗口已关闭，已取消保存"); });
        this.saved = true;
        new Notice("基础排版已保存，原文已备份");
        if (!this.closed) this.close();
      } catch (error) {
        if (!this.closed) { status.classList.add("is-error"); status.textContent = (error as Error).message; save.disabled = false; }
      } finally { applying = false; indentInput.disabled = false; separateInput.disabled = false; }
    };
    update();
  }
  onClose() { this.closed = true; this.session.dispose(); this.contentEl.empty(); this.done(this.saved); }
}

/** Keep the exact diff content, with visual gutters instead of terminal syntax. */
function renderFormattingDiff(container: HTMLElement, diff: string) {
  container.empty();
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@ ")) {
      container.createDiv({cls: "ep-format-location", text: line.slice(3, -3)});
    } else if (line.startsWith("+ ") || line.startsWith("- ")) {
      const added = line.startsWith("+");
      const row = container.createDiv({cls: `ep-format-line ${added ? "is-added" : "is-removed"}`, attr: {role: "group", "aria-label": added ? "新增行" : "原文行"}});
      row.createEl("span", {text: added ? "+" : "−", cls: "ep-format-gutter", attr: {"aria-hidden": "true"}});
      row.createEl("code", {text: line.slice(2).replace(/\u3000/g, "□")});
    } else container.createDiv({cls: "ep-format-unchanged", text: line});
  }
}

export async function openDraftFormatting(plugin: EasyPub, file: TFile, opened?: (modal: DraftFormatModal) => void): Promise<boolean> {
  const session = await DraftFormatSession.create(plugin, file);
  return new Promise<boolean>((resolve, reject) => {
    const modal = new DraftFormatModal(plugin.app, session, resolve);
    try { opened?.(modal); modal.open(); }
    catch (error) { session.dispose(); reject(error); }
  });
}
