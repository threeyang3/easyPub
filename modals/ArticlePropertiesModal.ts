import { App, FuzzySuggestModal, Modal, Notice, TFile } from "obsidian";
import { FrontMatterData } from "../types";
import { IMPORT_IMAGE_ACCEPT, IMPORT_IMAGE_EXTENSIONS, ImageUpload, importImageAttachment } from "../utils/attachmentImport";
import { PropertyField, PropertySelection, propertyValue } from "../utils/articleProperties";

export interface ArticlePropertiesContext {
  title: string;
  description: string;
  fields: PropertyField[];
  current: FrontMatterData;
  suggested: FrontMatterData;
  refresh?: boolean;
  removable?: string[];
  attachmentSourcePath?: string;
  previewSelection?: (selection: PropertySelection) => unknown;
  suggestions?: Record<string, string[]>;
}

class AttachmentPicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private picked: (file: TFile) => void) { super(app); this.setPlaceholder("选择图片附件"); }
  getItems() { return this.app.vault.getFiles().filter(file => IMPORT_IMAGE_EXTENSIONS.has(file.extension.toLowerCase())); }
  getItemText(file: TFile) { return file.path; }
  onChooseItem(file: TFile) { this.picked(file); }
}

export class ArticlePropertiesModal extends Modal {
  private responded = false;
  constructor(app: App, private context: ArticlePropertiesContext,
    private finish: (selection: PropertySelection | null) => void) { super(app); }

  onOpen() {
    this.modalEl.addClass("easy-pub-properties-modal");
    const root = this.contentEl; root.empty(); root.addClass("easy-pub-properties");
    const el = root.createDiv({ cls: "ep-property-form" });
    el.createEl("h2", { text: this.context.title });
    el.createEl("p", { text: this.context.description });
    let uploading = false;
    const importButtons: HTMLButtonElement[] = [];
    const controls: Array<{ field: PropertyField; input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; customInput?: HTMLInputElement; selected?: HTMLInputElement }> = [];
    for (const field of this.context.fields) {
      const row = el.createEl("label");
      let selected: HTMLInputElement | undefined;
      if (this.context.refresh) {
        selected = row.createEl("input", { type: "checkbox" });
        selected.setAttribute("aria-label", `刷新${field.label}`);
      }
      row.createEl("span", { text: field.label });
      let customInput: HTMLInputElement | undefined;
      const input = field.choices
        ? row.createEl("select")
        : field.kind === "list"
          ? row.createEl("textarea", { attr: { rows: "2" } })
          : row.createEl("input", { type: "text" });
      input.setAttribute("aria-label", field.label);
      if (field.choices) {
        for (const choice of field.choices) input.createEl("option", { value: choice, text: choice || "Vault 根目录" });
        if (field.allowCustom) input.createEl("option", { value: "__custom__", text: "自定义目录…" });
        if (field.allowCustom) {
          customInput = row.createEl("input", { type: "text", placeholder: "输入仓库内相对目录" });
          const currentText = propertyValue(this.context.refresh ? this.context.suggested : this.context.current, field.key);
          const currentValue = currentText === undefined ? "" : String(currentText);
          if (field.choices.includes(currentValue)) input.value = currentValue;
          else { input.value = "__custom__"; customInput.value = currentValue; }
          customInput.hidden = input.value !== "__custom__";
          input.addEventListener("change", () => { customInput!.hidden = input.value !== "__custom__"; invalidate(); });
          customInput.addEventListener("input", () => invalidate());
        }
      }
      const value = propertyValue(this.context.refresh ? this.context.suggested : this.context.current, field.key);
      if (!customInput) input.value = value === undefined ? "" : value instanceof Date ? value.toISOString() : typeof value === "string" ? value : JSON.stringify(value);
      if (field.kind === "list") {
        input.setAttribute("placeholder", field.key === "tags" ? "每行一个标签，例如：\n写作\nAI\n\n也支持 JSON：[\"写作\", \"AI\"]" : '["随笔", "生活"]');
        row.createEl("small", { text: field.key === "tags" ? "可点选已有标签，也可每行添加自定义标签；每项最多 60 字，不要用逗号分隔。" : "可点选已有分类，也可填写 JSON 文本列表。" });
      }
      const suggestions = field.suggestions ?? this.context.suggestions?.[field.key];
      if (suggestions?.length) {
        const picker = row.createDiv({ cls: "ep-property-suggestions" });
        picker.createEl("small", { text: field.kind === "list" ? "已有选项 · 点击切换" : "已有目录 · 点击填入" });
        for (const suggestion of suggestions) {
          const button = picker.createEl("button", { text: suggestion, attr: { type: "button" } });
          button.onclick = () => {
            if (field.kind === "list") {
              let values: unknown[];
              try { values = parsePropertyList(input.value, field.key); }
              catch { values = []; }
              const index = values.findIndex(value => value === suggestion);
              if (index >= 0) values.splice(index, 1); else values.push(suggestion);
              input.value = JSON.stringify(values);
            } else input.value = suggestion;
            input.dispatchEvent(new Event("input"));
          };
        }
      }
      if (this.context.refresh) {
        input.disabled = true;
        selected!.addEventListener("change", () => { input.disabled = !selected!.checked; invalidate(); });
        row.createEl("small", { text: `当前：${JSON.stringify(propertyValue(this.context.current, field.key)) ?? "未设置"}` });
      }
      input.addEventListener("input", () => invalidate());
      input.addEventListener("change", () => invalidate());
      controls.push({ field, input, customInput, selected });
      if (field.kind === "image" && this.context.attachmentSourcePath) {
        const purpose = field.key === "top_img" ? "顶部图片" : "封面";
        const actions = row.createDiv({ cls: "ep-property-image-actions" });
        const choose = actions.createEl("button", { text: "选择已有附件", attr: { type: "button", "aria-label": `为${purpose}选择已有附件` } });
        choose.onclick = () => new AttachmentPicker(this.app, file => fillImage(field.key, file)).open();
        const upload = actions.createEl("button", { text: "上传图片", attr: { type: "button", "aria-label": `上传${purpose}` } });
        const picker = actions.createEl("input", { type: "file", attr: { accept: IMPORT_IMAGE_ACCEPT, "aria-label": `上传文件：${purpose}` } });
        picker.hidden = true; importButtons.push(upload, choose);
        upload.onclick = () => picker.click();
        picker.onchange = () => { const file = picker.files?.[0]; picker.value = ""; if (file) void importFiles([file], field.key); };
      }
    }
    const removals: Array<{ key: string; input: HTMLInputElement }> = [];
    if (this.context.removable?.length) {
      el.createEl("h3", { text: "旧稿额外属性" });
      el.createEl("p", { text: "默认保留。勾选后将在预览中列出待移除的属性。" });
      for (const key of this.context.removable) {
        const row = el.createEl("label"), input = row.createEl("input", { type: "checkbox" });
        input.setAttribute("aria-label", `移除 ${key}`);
        row.createEl("span", { text: `${key}：${JSON.stringify(this.context.current[key])}` });
        input.addEventListener("change", () => invalidate()); removals.push({ key, input });
      }
    }
    const uploads = this.context.attachmentSourcePath ? el.createDiv({ cls: "ep-property-attachments" }) : null;
    let importedList: HTMLElement | undefined;
    if (uploads) {
      uploads.createEl("h3", { text: "图片附件" });
      uploads.createEl("p", { text: "按 Obsidian 的附件目录设置保存，可用于封面或复制引用到正文。" });
      const bulk = uploads.createEl("button", { text: "添加图片附件", attr: { type: "button" } }); importButtons.push(bulk);
      const picker = uploads.createEl("input", { type: "file", attr: { accept: IMPORT_IMAGE_ACCEPT, multiple: "", "aria-label": "批量上传图片附件" } }); picker.hidden = true;
      bulk.onclick = () => picker.click();
      picker.onchange = () => { const files = Array.from(picker.files ?? []); picker.value = ""; if (files.length) void importFiles(files); };
      importedList = uploads.createDiv({ cls: "ep-property-imported" });
    }
    const owner = this;
    const status = el.createEl("p", { attr: { role: "status", "aria-live": "polite" } });
    const error = el.createEl("p", { attr: { role: "alert" } });
    const preview = el.createEl("pre"); preview.hidden = true;
    let proposed: PropertySelection | null = null;
    const actions = root.createDiv({ cls: "ep-property-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.onclick = () => this.respond(null);
    const review = actions.createEl("button", { text: "预览属性变更" });
    const confirm = actions.createEl("button", { text: "确认并继续", cls: "mod-cta" }); confirm.disabled = true;
    function invalidate() { proposed = null; confirm.disabled = true; preview.hidden = true; }
    function fillImage(key: string, file: TFile) {
      if (owner.responded) return;
      const control = controls.find(item => item.field.key === key);
      if (!control) return;
      control.input.value = `[[${file.path}]]`;
      if (control.selected) { control.selected.checked = true; control.input.disabled = false; }
      invalidate();
    }
    function addImported(file: TFile) {
      if (!importedList || owner.responded) return;
      const row = importedList.createDiv({ cls: "ep-property-imported-row" });
      row.createEl("small", { text: file.path });
      for (const { field } of controls.filter(item => item.field.kind === "image")) {
        const assign = row.createEl("button", { text: `用于${field.key === "top_img" ? "顶部图片" : "封面"}`, attr: { type: "button" } });
        assign.onclick = () => fillImage(field.key, file);
      }
      const reference = row.createEl("input", { type: "text", attr: { readonly: "", "aria-label": `图片引用：${file.path}` } });
      reference.value = `![[${file.path}]]`;
      reference.onclick = () => reference.select();
    }
    async function importFiles(files: ImageUpload[], key?: string) {
      if (uploading || owner.responded) return;
      uploading = true; invalidate(); review.disabled = true;
      importButtons.forEach(button => { button.disabled = true; });
      error.textContent = ""; status.textContent = "正在保存图片附件…";
      const failures: string[] = [], saved: string[] = [];
      const assertActive = () => { if (owner.responded) throw new Error("窗口已关闭，已取消后续导入"); };
      try {
        for (const file of files) {
          if (owner.responded) break;
          try {
            const attachment = await importImageAttachment(owner.app, owner.context.attachmentSourcePath!, file, assertActive);
            saved.push(attachment.path);
            if (owner.responded) { new Notice(`图片已保存到附件：${attachment.path}`); break; }
            addImported(attachment);
            if (key) fillImage(key, attachment);
          } catch (cause) { if (!owner.responded) failures.push(`${file.name}：${(cause as Error).message}`); }
        }
      } finally {
        uploading = false;
        if (!owner.responded) {
          review.disabled = false; importButtons.forEach(button => { button.disabled = false; });
          error.textContent = failures.join("；");
          status.textContent = saved.length ? `已保存 ${saved.length} 张图片。取消生成仍保留已上传的附件。` : "";
        }
      }
    }
    review.onclick = () => {
      if (uploading || this.responded) return;
      invalidate(); error.textContent = "";
      try {
        const values: FrontMatterData = {};
        for (const { field, input, selected, customInput } of controls) {
          if (selected && !selected.checked) continue;
          const rawValue = field.allowCustom && (input as HTMLSelectElement).value === "__custom__" ? customInput?.value : input.value;
          const text = rawValue?.trim() ?? "";
          // Empty optional values on initialization stay absent, preserving derived defaults.
          if (!text && !this.context.refresh && propertyValue(this.context.current, field.key) === undefined) continue;
          let value: unknown = text;
          if (field.kind === "list") {
            value = parsePropertyList(text, field.key);
            if (!Array.isArray(value) || !value.every(item => typeof item === "string" || field.key === "categories" && Array.isArray(item) && item.every(v => typeof v === "string"))) {
              throw new Error(`${field.label}请填写列表；标签可每行一个，或使用 JSON 文本列表`);
            }
          }
          if (field.kind === "image" && text === "false" && !field.key.startsWith("wechat.")) value = false;
          if (field.key === "title" && !text) throw new Error("请填写标题");
          if (field.kind === "date" && text && Number.isNaN(Date.parse(text))) throw new Error("日期格式无效，请使用 YYYY-MM-DD 或 ISO 日期时间");
          if (field.key === "password_secret" && text && !/^BLOG_ENCRYPTION_[A-Z0-9_]+$/.test(text)) throw new Error("密码引用需以 BLOG_ENCRYPTION_ 开头，仅使用大写字母、数字及下划线");
          values[field.key] = value;
        }
        proposed = { values, remove: removals.filter(item => item.input.checked).map(item => item.key) };
        if (this.context.refresh && !Object.keys(values).length && !proposed.remove.length) throw new Error("请至少选择一个字段或待清理属性");
        preview.textContent = JSON.stringify(this.context.previewSelection ? this.context.previewSelection(proposed)
          : { 写入: proposed.values, 移除: proposed.remove }, null, 2);
        preview.hidden = false; confirm.disabled = false;
      } catch (cause) { invalidate(); error.textContent = (cause as Error).message; }
    };
    confirm.onclick = () => { if (!uploading && proposed) this.respond(proposed); };
  }
  private respond(value: PropertySelection | null) {
    if (this.responded) return;
    this.responded = true; this.close(); this.finish(value);
  }
  onClose() {
    this.contentEl.empty();
    if (!this.responded) { this.responded = true; this.finish(null); }
  }
}

export function parsePropertyList(text: string, key: string): unknown[] {
  if (!text.trim()) return [];
  if (text.trimStart().startsWith("[")) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("列表必须是数组");
    if (key === "tags") {
      if (parsed.some(value => typeof value === "string" && /[,，]/.test(value))) {
        throw new Error("标签请每项填写一个，不要在单个标签中使用逗号；也可每行填写");
      }
      if (parsed.some(value => typeof value === "string" && value.length > 60)) {
        throw new Error("单个标签最多 60 个字符");
      }
    }
    return parsed;
  }
  const values = text.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (key === "tags" && values.some(value => /[,，]/.test(value))) throw new Error("标签请每行填写一个，不要用逗号分隔；也可填写 JSON 文本列表");
  if (key === "tags" && values.some(value => value.length > 60)) throw new Error("单个标签最多 60 个字符");
  return values;
}

export function chooseArticleProperties(app: App, context: ArticlePropertiesContext): Promise<PropertySelection | null> {
  return new Promise((resolve, reject) => {
    let failed = false;
    const modal = new ArticlePropertiesModal(app, context, value => { if (!failed) resolve(value); });
    try { modal.open(); } catch (error) { failed = true; modal.close(); reject(error); }
  });
}
