import { App, Modal } from "obsidian";
import { WechatArticleSettings, WechatCrop, WechatImage } from "../types";
import { centeredCrop } from "../utils/wechatState";

export class WechatCropModal extends Modal {
  private article: WechatArticleSettings;
  private thumbnails: Array<{ canvas: HTMLCanvasElement; key: "cropWide" | "cropSquare" }> = [];
  private closed = false;
  constructor(app: App, private cover: WechatImage, article: WechatArticleSettings,
    private apply: (wide: WechatCrop, square: WechatCrop) => void, private finished: () => void) {
    super(app); this.article = structuredClone(article);
  }
  onOpen() {
    this.closed = false;
    this.modalEl.addClass("easy-pub-crop-modal");
    this.contentEl.addClass("easy-pub-wechat");
    this.contentEl.createEl("h2", { text: "调整封面裁剪" });
    this.contentEl.createEl("p", { text: "分别调整横版和方形封面。拖动图片选择构图，方向键微调位置。" });
    const tabs = this.contentEl.createDiv({ cls: "epw-tabs" });
    const stage = this.contentEl.createDiv({ cls: "epw-crop-stage" });
    const panels: HTMLElement[] = [], buttons: HTMLButtonElement[] = [];
    for (const [key, ratio, label] of [["cropWide", 2.35, "横版 2.35:1"], ["cropSquare", 1, "方形 1:1"]] as const) {
      const panel = stage.createDiv(); panels.push(panel);
      this.cropEditor(panel, key, ratio, label);
      const button = tabs.createEl("button", { text: label }); buttons.push(button);
      button.onclick = () => panels.forEach((p, i) => { p.hidden = p !== panel; buttons[i].setAttribute("aria-pressed", String(p === panel)); });
    }
    buttons[0].click();
    const previews = this.contentEl.createDiv({ cls: "epw-crop-thumbnails" });
    for (const [key, ratio, label] of [["cropWide", 2.35, "横版效果"], ["cropSquare", 1, "方形效果"]] as const) {
      const box = previews.createDiv(); box.createEl("small", { text: label });
      const canvas = box.createEl("canvas"); canvas.width = 188; canvas.height = Math.round(188 / ratio);
      this.thumbnails.push({ canvas, key });
    }
    this.drawThumbnails();
    const actions = this.contentEl.createDiv({ cls: "ep-panel-actions epw-crop-actions" });
    actions.createEl("button", { text: "取消" }).onclick = () => this.close();
    actions.createEl("button", { text: "应用裁剪", cls: "mod-cta" }).onclick = () => {
      if (this.closed) return;
      try { this.apply(this.article.cropWide!, this.article.cropSquare!); this.close(); }
      catch (error) { status.textContent = (error as Error).message; }
    };
    const status = this.contentEl.createEl("p", { attr: { role: "status" } });
  }
  private drawThumbnails() {
    const bitmap = new Image(); bitmap.onload = () => {
      if (this.closed) return;
      for (const { canvas, key } of this.thumbnails) {
        const crop = this.article[key]; if (!crop) continue;
        canvas.getContext("2d")?.drawImage(bitmap, crop.x * this.cover.width, crop.y * this.cover.height,
          crop.width * this.cover.width, crop.height * this.cover.height, 0, 0, canvas.width, canvas.height);
      }
    }; bitmap.src = this.cover.previewUrl;
  }
  private cropEditor(parent: HTMLElement, key: "cropWide" | "cropSquare", ratio: number, label: string) {
    const image = this.cover!;
    let crop = this.article[key] ?? centeredCrop(image.width, image.height, ratio);
    if (Math.abs(crop.width * image.width / (crop.height * image.height) / ratio - 1) > 0.005) crop = centeredCrop(image.width, image.height, ratio);
    this.article[key] = crop;
    parent.createEl("small", { text: `${label} · 拖动图片调整位置` });
    const canvas = parent.createEl("canvas", { cls: "epw-crop", attr: { "aria-label": label, tabindex: "0" } });
    canvas.title = "虚线为构图参考安全区，不会上传；文字与主体尽量远离裁剪边缘";
    canvas.style.maxWidth = `min(760px, ${ratio * 38}vh)`;
    canvas.style.width = "100%";
    canvas.style.maxHeight = "none";
    canvas.width = 940; canvas.height = Math.round(940 / ratio);
    const resolution = parent.createEl("p", { cls: "epw-crop-resolution" });
    const updateResolution = () => {
      const width = Math.floor(crop.width * image.width), height = Math.floor(crop.height * image.height);
      const minWidth = ratio === 1 ? 383 : 900, minHeight = 383;
      const low = width < minWidth || height < minHeight;
      resolution.textContent = `${label}选区：${width} × ${height} 像素${low ? ` · 清晰度较低，建议至少 ${minWidth} × ${minHeight}，请减小缩放或换图` : " · 清晰度充足"}`;
      resolution.classList.toggle("epw-warning", low);
    };
    updateResolution();
    const bitmap = new Image(); bitmap.src = image.previewUrl;
    const draw = () => {
      const context = canvas.getContext("2d"); if (!context || !bitmap.complete) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, crop.x * image.width, crop.y * image.height, crop.width * image.width, crop.height * image.height, 0, 0, canvas.width, canvas.height);
      context.save(); context.strokeStyle = "rgba(255,255,255,.9)"; context.lineWidth = 2; context.setLineDash([6,5]);
      context.strokeRect(canvas.width * 0.08, canvas.height * 0.08, canvas.width * 0.84, canvas.height * 0.84); context.restore();
    };
    bitmap.onload = () => { draw(); this.drawThumbnails(); }; draw();
    const zoom = parent.createEl("input", { type: "range", cls: "epw-zoom", attr: { min: "1", max: "4", step: "0.01", "aria-label": `${label}缩放` } });
    zoom.value = String(centeredCrop(image.width, image.height, ratio).width / crop.width);
    const commit = () => { this.article[key] = { ...crop }; updateResolution(); draw(); this.drawThumbnails(); };
    const position = parent.createEl("select", { attr: { "aria-label": `${label}构图位置` } });
    for (const [value, text] of [["", "快速调整构图"], ["center", "居中"], ["top", "顶部居中"], ["top-left", "左上对齐"], ["bottom", "底部居中"]]) position.createEl("option", { value, text });
    position.onchange = () => {
      if (!position.value) return;
      crop = { ...crop, x: position.value === "top-left" ? 0 : (1 - crop.width) / 2,
        y: position.value === "center" ? (1 - crop.height) / 2 : position.value === "bottom" ? 1 - crop.height : 0 };
      commit(); position.value = "";
    };
    zoom.addEventListener("input", () => { crop = centeredCrop(image.width, image.height, ratio, Number(zoom.value), crop.x + crop.width / 2, crop.y + crop.height / 2); commit(); });
    const reset = parent.createEl("button", { text: "重置裁剪" });
    reset.onclick = () => { crop = centeredCrop(image.width, image.height, ratio); zoom.value = "1"; commit(); };
    let drag: { x: number; y: number; crop: WechatCrop } | undefined;
    canvas.addEventListener("pointerdown", event => { drag = { x: event.clientX, y: event.clientY, crop: { ...crop } }; canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener("pointermove", event => {
      if (!drag) return;
      const rect = canvas.getBoundingClientRect();
      crop = { ...crop, x: Math.max(0, Math.min(1 - crop.width, drag.crop.x - (event.clientX - drag.x) / rect.width * crop.width)),
        y: Math.max(0, Math.min(1 - crop.height, drag.crop.y - (event.clientY - drag.y) / rect.height * crop.height)) }; commit();
    });
    canvas.addEventListener("pointerup", () => { drag = undefined; }); canvas.addEventListener("pointercancel", () => { drag = undefined; });
    canvas.addEventListener("keydown", event => {
      const delta = 0.01;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      crop.x = Math.max(0, Math.min(1 - crop.width, crop.x + (event.key === "ArrowRight" ? delta : event.key === "ArrowLeft" ? -delta : 0)));
      crop.y = Math.max(0, Math.min(1 - crop.height, crop.y + (event.key === "ArrowDown" ? delta : event.key === "ArrowUp" ? -delta : 0))); commit();
    });
  }
  onClose() { this.closed = true; this.thumbnails = []; this.contentEl.empty(); this.finished(); }
}
