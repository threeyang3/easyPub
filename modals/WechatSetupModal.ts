import { Modal } from "obsidian";
import type EasyPub from "../main";

/** Guided setup keeps secrets in the password field until an explicit save. */
export class WechatSetupModal extends Modal {
  private step = 0;
  private appId: string;
  private author: string;
  private secret = "";
  private busy = false;
  private closed = false;
  private storageNote = "";
  private results: string[] = [];
  private checkError = "";
  private checking = false;
  private status?: HTMLElement;
  constructor(private plugin: EasyPub, private finished: () => void = () => {}) {
    super(plugin.app);
    this.appId = plugin.settings.wechat.appId;
    this.author = plugin.settings.wechat.defaultAuthor;
  }
  onOpen() { this.closed = false; this.contentEl.addClass("easy-pub-wechat-setup"); this.render(); }
  private button(parent: HTMLElement, title: string, action: () => void, primary = false) {
    const button = parent.createEl("button", { text: title });
    if (primary) button.addClass("mod-cta");
    button.onclick = action;
    return button;
  }
  private async run(action: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.contentEl.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,button").forEach(el => { el.disabled = true; });
    try { await action(); }
    catch (error) { if (!this.closed && this.status) { this.status.textContent = (error as Error).message; this.status.classList.add("epw-setup-error"); } }
    finally {
      this.busy = false;
      if (!this.closed) this.contentEl.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,button").forEach(el => { el.disabled = false; });
    }
  }
  private render() {
    if (this.closed) return;
    const root = this.contentEl; root.empty();
    root.createEl("small", { text: "EASYPUB / CONNECT", cls: "epw-setup-kicker" });
    root.createEl("h2", { text: "连接你的公众号" });
    const steps = root.createEl("ol", { cls: "epw-setup-steps", attr: { "aria-label": "配置步骤" } });
    ["准备账号", "填写凭据", "检查连接"].forEach((label, index) => {
      const item = steps.createEl("li", { text: `${index + 1} · ${label}` });
      if (index === this.step) item.setAttribute("aria-current", "step");
    });
    if (this.step === 0) {
      root.createEl("h3", { text: "先准备好这三项" });
      const list = root.createEl("ul");
      list.createEl("li", { text: "在公众号后台找到 AppID 和 AppSecret。不要把 AppSecret 写进文章、截图或聊天。" });
      list.createEl("li", { text: "在后台 IP 白名单中配置当前网络的公网出口 IP。更换网络或代理后，出口 IP 可能变化。" });
      list.createEl("li", { text: "确认账号拥有素材与草稿接口权限；不同账号类型、认证状态的权限可能不同。" });
      this.ipHelp(root);
      root.createEl("p", { text: "本插件将单篇图文同步到草稿箱，最终发布由你在公众号后台完成。", cls: "epw-setup-note" });
      this.button(root, "打开公众号后台", () => { void this.run(() => this.plugin.openWechatBackend()); });
    } else if (this.step === 1) {
      root.createEl("h3", { text: "填写账号信息" });
      const field = (label: string, value: string, password: boolean, update: (value: string) => void) => {
        const wrapper = root.createEl("label", { cls: "epw-setup-field", text: label });
        const input = wrapper.createEl("input", { type: password ? "password" : "text" });
        input.value = value; input.autocomplete = "off"; input.spellcheck = false;
        input.oninput = () => update(input.value);
        return input;
      };
      field("AppID", this.appId, false, value => { this.appId = value; });
      const secret = field("AppSecret", this.secret, true, value => { this.secret = value; });
      secret.placeholder = this.plugin.hasWechatCredentials() && this.appId.trim() === this.plugin.settings.wechat.appId
        ? "已保存；留空保留，填写则替换" : "输入 AppSecret";
      field("默认作者（可选）", this.author, false, value => { this.author = value; });
      root.createEl("p", { text: "保存后优先使用系统加密；不可用时仅保留本次会话。切换 AppID 必须提供对应的新密钥。", cls: "epw-setup-note" });
    } else {
      root.createEl("h3", { text: "验证连接，不发送文章" });
      root.createEl("p", { text: `账号：${this.plugin.settings.wechat.appId}` });
      root.createEl("p", { text: this.storageNote, cls: "epw-setup-note" });
      const failed = this.checkError || this.results.some(text => text.includes("失败"));
      const passed = !failed && this.results.filter(text => text.endsWith("正常")).length === 3;
      const summary = root.createDiv({ cls: `epw-setup-summary ${failed ? "is-error" : passed ? "is-success" : "is-pending"}`, attr: { role: "status", "aria-live": "polite" } });
      summary.createEl("strong", { text: this.checking ? "正在检查连接…" : failed ? "连接检查未全部通过" : passed ? "连接检查通过，可以返回编辑" : "账号已保存，尚未检查连接" });
      summary.createEl("p", { text: passed ? "本次凭据验证与素材、草稿读取均正常，无需因为下方的写入待验证提示反复修改配置。" : failed ? "请按下方失败项目处理，然后重新检查。已保存的账号信息仍然保留。" : "点击运行只读检查，验证当前网络下的账号连接。不会上传图片或创建文章。" });
      this.button(root, "运行只读检查", () => { void this.run(async () => {
        const revision = this.plugin.wechatCredentialRevision;
        this.results = []; this.checkError = ""; this.checking = true; this.render();
        try {
          const results = await this.plugin.getWechatApi().checkConnection();
          if (revision !== this.plugin.wechatCredentialRevision) throw new Error("账号配置已变化，请返回上一步重新核对");
          this.results = results;
        } catch (error) { this.checkError = (error as Error).message; }
        finally { this.checking = false; this.render(); }
      }); }, true);
      const results = root.createEl("ul", { cls: "epw-setup-results" });
      this.results.filter(text => !text.startsWith("只读检查")).forEach(text => results.createEl("li", { text: `${text.endsWith("正常") ? "✓ 已通过" : "! 未通过"} · ${text}`, cls: text.endsWith("正常") ? "is-success" : "is-error" }));
      if (this.checkError) results.createEl("li", { text: this.checkError, cls: "is-error" });
      root.createEl("p", { text: "待实际同步验证 · 图片上传与草稿写入。这是只读检查的范围说明，不是报错；首次同步时再验证。", cls: "epw-setup-note" });
      if (passed) root.createEl("p", { text: "下一步：返回本地公众号稿 → 检查配图与封面 → 同步草稿箱。同步成功后在微信后台预览，最终发布由你操作。" });
      const help = root.createEl("details");
      help.open = !!failed;
      help.createEl("summary", { text: "遇到错误时如何处理" });
      help.createEl("p", { text: "40013 / 40125：核对同一账号的 AppID 与 AppSecret；40164：核对 API 白名单与请求出口；48001 / 48002：在后台检查接口权限。连接失败或超时：检查当前网络及代理分流后重试。" });
      this.ipHelp(help);
      this.button(help, "打开公众号后台", () => { void this.run(() => this.plugin.openWechatBackend()); });
    }
    this.status = root.createDiv({ cls: "epw-setup-status", attr: { role: "status", "aria-live": "polite" } });
    const footer = root.createDiv({ cls: "epw-setup-actions" });
    this.button(footer, "稍后配置", () => this.close());
    if (this.step > 0) this.button(footer, "上一步", () => { this.step--; this.results = []; this.checkError = ""; this.render(); });
    if (this.step === 0) this.button(footer, "开始配置", () => { this.step = 1; this.render(); }, true);
    else if (this.step === 1) this.button(footer, "保存并继续", () => { void this.run(async () => {
      const stored = await this.plugin.saveWechatConfiguration(this.appId.trim(), this.secret.trim(), this.author);
      this.secret = "";
      this.storageNote = stored ? "凭据已使用系统加密保存。" : "密钥仅在本次会话可用，重启后需要重新输入。";
      this.step = 2; this.results = []; this.finished(); this.render();
    }); }, true);
    else this.button(footer, "完成，返回编辑", () => this.close(), true);
    if (this.busy) root.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,button").forEach(el => { el.disabled = true; });
  }
  private ipHelp(parent: HTMLElement) {
    const help = parent.createEl("details", { cls: "epw-setup-ip-help" });
    help.createEl("summary", { text: "IP 白名单怎么填？使用代理怎么办？" });
    help.createEl("p", { text: "填写的是微信接口实际看到的公网出口 IP。192.168.x.x、10.x.x.x 等局域网地址不能代替公网出口。请在对应公众号的开发配置中找到 API IP 白名单。" });
    const list = help.createEl("ul");
    list.createEl("li", { text: "请求直连微信：填写直连网络的公网出口 IP。" });
    list.createEl("li", { text: "请求经过代理：填写代理的公网出口 IP。开启代理不等于所有请求都会走代理，取决于系统代理、TUN 与分流规则。" });
    list.createEl("li", { text: "浏览器查到的 IP 不一定与 Obsidian 请求一致。若微信的白名单错误中给出 IP，以该次请求返回的地址为准；切换网络或代理后重新检查。" });
    help.createEl("p", { text: "检查通过时，无需为了使用代理再额外修改白名单。插件不会自动修改代理或白名单。" });
  }
  onClose() { this.closed = true; this.secret = ""; this.contentEl.empty(); }
}
