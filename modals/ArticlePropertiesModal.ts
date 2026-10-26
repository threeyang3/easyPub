import { App, Modal } from "obsidian";
import { FrontMatterData } from "../types";
import { PropertyField, PropertySelection, propertyValue } from "../utils/articleProperties";

export interface ArticlePropertiesContext {
  title: string;
  description: string;
  fields: PropertyField[];
  current: FrontMatterData;
  suggested: FrontMatterData;
  refresh?: boolean;
  removable?: string[];
}

export class ArticlePropertiesModal extends Modal {
  private responded = false;
  constructor(app: App, private context: ArticlePropertiesContext,
    private finish: (selection: PropertySelection | null) => void) { super(app); }

  onOpen() {
    const el = this.contentEl; el.empty(); el.addClass("easy-pub-properties");
    el.createEl("h2", { text: this.context.title });
    el.createEl("p", { text: this.context.description });
    const controls: Array<{ field: PropertyField; input: HTMLInputElement | HTMLSelectElement; selected?: HTMLInputElement }> = [];
    for (const field of this.context.fields) {
      const row = el.createEl("label");
      let selected: HTMLInputElement | undefined;
      if (this.context.refresh) {
        selected = row.createEl("input", { type: "checkbox" });
        selected.setAttribute("aria-label", `刷新${field.label}`);
      }
      row.createEl("span", { text: field.label });
      const input = field.choices ? row.createEl("select") : row.createEl("input", { type: "text" });
      input.setAttribute("aria-label", field.label);
      if (field.choices) for (const choice of field.choices) input.createEl("option", { value: choice, text: choice });
      const value = propertyValue(this.context.refresh ? this.context.suggested : this.context.current, field.key);
      input.value = value === undefined ? "" : value instanceof Date ? value.toISOString() : typeof value === "string" ? value : JSON.stringify(value);
      if (field.kind === "list") input.setAttribute("placeholder", '["标签一", "标签二"]');
      if (this.context.refresh) {
        input.disabled = true;
        selected!.addEventListener("change", () => { input.disabled = !selected!.checked; invalidate(); });
        row.createEl("small", { text: `当前：${JSON.stringify(propertyValue(this.context.current, field.key)) ?? "未设置"}` });
      }
      input.addEventListener("input", () => invalidate());
      input.addEventListener("change", () => invalidate());
      controls.push({ field, input, selected });
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
    const error = el.createEl("p", { attr: { role: "alert" } });
    const preview = el.createEl("pre"); preview.hidden = true;
    let proposed: PropertySelection | null = null;
    const actions = el.createDiv();
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.onclick = () => this.respond(null);
    const review = actions.createEl("button", { text: "预览属性变更" });
    const confirm = actions.createEl("button", { text: "确认并继续", cls: "mod-cta" }); confirm.disabled = true;
    function invalidate() { proposed = null; confirm.disabled = true; preview.hidden = true; }
    review.onclick = () => {
      invalidate(); error.textContent = "";
      try {
        const values: FrontMatterData = {};
        for (const { field, input, selected } of controls) {
          if (selected && !selected.checked) continue;
          const text = input.value.trim();
          // Empty optional values on initialization stay absent, preserving derived defaults.
          if (!text && !this.context.refresh && propertyValue(this.context.current, field.key) === undefined) continue;
          let value: unknown = text;
          if (field.kind === "list") {
            value = text ? JSON.parse(text) : [];
            if (!Array.isArray(value) || !value.every(item => typeof item === "string" || field.key === "categories" && Array.isArray(item) && item.every(v => typeof v === "string"))) {
              throw new Error(`${field.label}请填写 JSON 文本列表`);
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
        preview.textContent = JSON.stringify({ 写入: proposed.values, 移除: proposed.remove }, null, 2);
        preview.hidden = false; confirm.disabled = false;
      } catch (cause) { error.textContent = (cause as Error).message; }
    };
    confirm.onclick = () => { if (proposed) this.respond(proposed); };
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

export function chooseArticleProperties(app: App, context: ArticlePropertiesContext): Promise<PropertySelection | null> {
  return new Promise((resolve, reject) => {
    let failed = false;
    const modal = new ArticlePropertiesModal(app, context, value => { if (!failed) resolve(value); });
    try { modal.open(); } catch (error) { failed = true; modal.close(); reject(error); }
  });
}
