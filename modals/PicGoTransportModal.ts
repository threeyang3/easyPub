import { App, Modal, Setting } from 'obsidian';

export class PicGoTransportModal extends Modal {
  private settled = false;
  constructor(app: App, private origin: string, private answer: (allowed: boolean) => void) { super(app); }
  onOpen() {
    this.contentEl.createEl('h2', { text: '确认 PicGo 未加密传输' });
    this.contentEl.createEl('p', { text: `接收服务：${this.origin}` });
    this.contentEl.createEl('p', { text: '本次上传会通过远程 HTTP 发送 Secret 和附件路径，网络中间方可能读取密钥。建议取消并改用 HTTPS 或本机回环地址。' });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText('取消').onClick(() => this.respond(false)))
      .addButton(button => button.setButtonText('仅允许本次上传').onClick(() => this.respond(true)));
    this.contentEl.querySelector('button')?.focus();
  }
  private respond(allowed: boolean) { if (this.settled) return; this.settled = true; this.close(); this.answer(allowed); }
  onClose() { if (!this.settled) { this.settled = true; this.answer(false); } this.contentEl.empty(); }
}

export function confirmPicGoTransport(app: App, origin: string): Promise<boolean> {
  return new Promise(resolve => new PicGoTransportModal(app, origin, resolve).open());
}
