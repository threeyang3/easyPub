import { Modal } from "obsidian";
import type EasyPub from "../main";
import { normalizeAiSettings } from "../utils/wechatAiProvider";

export class WechatAiSettingsModal extends Modal {
  constructor(private plugin: EasyPub, private finished = () => {}) { super(plugin.app); }
  onOpen() {
    const root = this.contentEl; root.empty(); root.addClass("easy-pub-layout");
    root.createEl("h2", {text: "配置智能排版服务"});
    root.createEl("p", {text: "使用兼容 Chat Completions 的 API。只有在排版窗口明确确认发送后才调用；服务方可能计费。"});
    const config = normalizeAiSettings(this.plugin.settings.wechatAi);
    const field = (label: string, value: string, type = "text") => {
      const row = root.createEl("label", {text: label, cls: "epl-field"});
      const input = row.createEl("input", {type}); input.value = value; return input;
    };
    const endpoint = field("完整接口地址（以 /chat/completions 结尾）", config.endpoint);
    endpoint.placeholder = "https://服务地址/v1/chat/completions";
    const model = field("模型名称", config.model);
    const key = field("API Key（留空保留当前地址的密钥）", "", "password");
    key.autocomplete = "off";
    const json = field("请求 JSON 模式（服务支持时启用）", "", "checkbox"); json.checked = config.jsonMode;
    root.createEl("p", {text: "密钥使用系统加密保存；加密不可用时仅用于本次会话。更换接口地址时请重新填写密钥；本机无认证服务可留空。"});
    const status = root.createEl("p", {attr: {role: "status"}});
    const actions = root.createDiv({cls: "epl-actions"});
    const save = actions.createEl("button", {text: "保存服务配置", cls: "mod-cta"});
    save.onclick = async () => {
      save.disabled = true;
      try {
        const encrypted = await this.plugin.saveWechatAiConfiguration(endpoint.value.trim(), model.value.trim(), key.value.trim(), json.checked);
        key.value = ""; status.textContent = encrypted ? "配置已保存，密钥已系统加密。" : "配置已保存；密钥仅在本次会话保留（或本机服务无需密钥）。";
        this.finished();
      } catch (error) { status.textContent = (error as Error).message; }
      finally { save.disabled = false; }
    };
    const clear = actions.createEl("button", {text: "清除 AI 密钥"});
    clear.onclick = async () => {
      try { await this.plugin.clearWechatAiKey(); status.textContent = "AI 密钥已清除。"; this.finished(); }
      catch (error) { status.textContent = (error as Error).message; }
    };
    actions.createEl("button", {text: "关闭"}).onclick = () => this.close();
  }
  onClose() { this.contentEl.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(input => input.value = ""); this.contentEl.empty(); }
}
