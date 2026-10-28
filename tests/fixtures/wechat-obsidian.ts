// Browser-only fixture. Production always imports the real Obsidian API.
import { micromark } from "micromark";
const globals = globalThis as any;
const prototype = HTMLElement.prototype as any;
prototype.empty = function () { this.replaceChildren(); };
prototype.setText = function (text: string) { this.textContent = text; };
prototype.addClass = function (...names: string[]) { this.classList.add(...names); };
prototype.createEl = function (tag: string, options: any = {}) {
  const el = document.createElement(tag);
  if (options.text) el.textContent = options.text;
  if (options.cls) el.className = options.cls;
  if (options.type) el.setAttribute("type", options.type);
  if (options.value !== undefined) (el as HTMLInputElement).value = options.value;
  for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, String(value));
  this.appendChild(el); return el;
};
prototype.createDiv = function (options: any = {}) { return this.createEl("div", options); };
export class Component {
  events: Array<() => void> = [];
  load() {} unload() { this.events.forEach(event => event()); this.events = []; }
  registerEvent(event: () => void) { this.events.push(event); }
}
export class ItemView extends Component {
  app: any;
  contentEl: HTMLElement;
  constructor(leaf: any) { super(); this.app = leaf.app; this.contentEl = leaf.contentEl; }
  async setState() {}
}
export class Notice { constructor(message: string) { console.info(message); } }
export class TFile { path = ""; extension = ""; basename = ""; }
export class TFolder {}
export class FuzzySuggestModal { app: any; constructor(app: any) { this.app = app; } setPlaceholder() {} open() {} }
export class Modal extends Component {
  app: any;
  contentEl = document.createElement("div");
  modalEl = document.createElement("div");
  constructor(app: any) { super(); this.app = app; }
  onOpen() {} onClose() {}
  open() {
    this.contentEl.setAttribute("role", "dialog");
    this.contentEl.style.cssText = 'padding:24px;overflow:auto';
    this.modalEl.style.cssText = 'position:fixed;top:5vh;left:50%;transform:translateX(-50%);z-index:1000;background:var(--background-primary,white);max-height:90vh;overflow:auto;border-radius:12px;box-shadow:0 12px 60px #0003';
    this.modalEl.appendChild(this.contentEl); document.body.appendChild(this.modalEl); this.onOpen();
    if (!this.modalEl.classList.contains('easy-pub-layout-modal') && !this.modalEl.classList.contains('easy-pub-crop-modal') && !this.modalEl.classList.contains('easy-pub-properties-modal')) this.modalEl.style.width = 'min(700px,94vw)';
  }
  close() { this.onClose(); this.modalEl.remove(); }
}
export class Setting {
  settingEl: HTMLElement;
  constructor(private el: HTMLElement) { this.settingEl = el.createDiv(); }
  setName(text: string) { this.settingEl.createDiv({ text }); return this; }
  setDesc(text: string) { this.settingEl.createDiv({ text }); return this; }
  addDropdown(callback: (control: any) => void) {
    const el = document.createElement("select"); this.settingEl.appendChild(el);
    const control = {
      addOption(value: string, text: string) { el.add(new Option(text, value)); return control; },
      setValue(value: string) { el.value = value; return control; },
      onChange(fn: (value: string) => void) { el.onchange = () => fn(el.value); return control; },
    };
    callback(control); return this;
  }
  addButton(callback: (button: any) => void) {
    const el = document.createElement("button"); this.settingEl.appendChild(el);
    const button = { setButtonText(text: string) { el.textContent = text; return button; }, setDisabled(value: boolean) { el.disabled = value; return button; }, setCta() { return button; }, onClick(fn: () => void) { el.onclick = fn; return button; } };
    callback(button); return this;
  }
}
export class MarkdownRenderer {
  static async render(_app: any, body: string, element: HTMLElement) { element.innerHTML = micromark(body, { allowDangerousHtml: true }); }
}
export const normalizePath = (path: string) => path.replace(/\\/g, "/");
export const requestUrl = async (request: any) => globals.fixtureRequest(request);
