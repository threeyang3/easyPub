// Browser-only fixture. Production always imports the real Obsidian API.
import { micromark } from "micromark";
const globals = globalThis as any;
const prototype = HTMLElement.prototype as any;
prototype.empty = function () { this.replaceChildren(); };
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
export class TFile { path = ""; extension = ""; basename = ""; }
export class TFolder {}
export class FuzzySuggestModal { constructor(_app: any) {} setPlaceholder() {} open() {} }
export class Modal extends Component {
  contentEl = document.createElement("div");
  constructor(_app: any) { super(); }
  onOpen() {} onClose() {}
  open() { this.contentEl.setAttribute("role", "dialog"); this.contentEl.style.cssText = 'position:fixed;inset:10% 15%;z-index:1000;background:white;padding:24px;overflow:auto'; document.body.appendChild(this.contentEl); this.onOpen(); }
  close() { this.onClose(); this.contentEl.remove(); }
}
export class Setting {
  constructor(private el: HTMLElement) {}
  addButton(callback: (button: any) => void) {
    const el = document.createElement("button"); this.el.appendChild(el);
    const button = { setButtonText(text: string) { el.textContent = text; return button; }, onClick(fn: () => void) { el.onclick = fn; return button; } };
    callback(button); return this;
  }
}
export class MarkdownRenderer {
  static async render(_app: any, body: string, element: HTMLElement) { element.innerHTML = micromark(body, { allowDangerousHtml: true }); }
}
export const normalizePath = (path: string) => path.replace(/\\/g, "/");
export const requestUrl = async (request: any) => globals.fixtureRequest(request);
