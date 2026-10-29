import { App, Modal, Setting } from "obsidian";
import { Association } from "../utils/wechatAssociation";
import { validateWechatArticleUrl } from "../utils/wechatArticleUrl";
export class WechatAssociationModal extends Modal {
  constructor(app: App, private value: Association, private submit: (value: Association) => Promise<void>) { super(app); }
  onOpen() {
    this.contentEl.createEl("h2", {text:"关联已发布的公众号文章"});
    this.contentEl.createEl("p", {text:"粘贴正式发布的公开链接。仅验证格式，请手动打开核验可访问性。不会修改微信远端文章。"});
    let url = this.value.publishedUrl ?? "", comments = this.value.commentsEnabled === undefined ? "unknown" : String(this.value.commentsEnabled);
    new Setting(this.contentEl).setName("公众号文章 URL").addText(input => { input.inputEl.setAttribute("aria-label", "公众号文章 URL"); input.setValue(url).onChange(value => url = value); });
    new Setting(this.contentEl).setName("留言状态").addDropdown(input => { input.selectEl.setAttribute("aria-label", "留言状态"); input.addOptions({unknown:"未知",true:"已确认开放留言",false:"未开放留言"}).setValue(comments).onChange(value => comments = value); });
    const error = this.contentEl.createEl("p", {attr:{role:"alert"}});
    new Setting(this.contentEl).addButton(button => button.setButtonText("下一步：预览关联").onClick(async () => {
      button.setDisabled(true);
      try { await this.submit({publishedUrl:validateWechatArticleUrl(url.trim()), ...(comments === "unknown" ? {} : {commentsEnabled:comments === "true"})}); this.close(); }
      catch (failure) { error.textContent = (failure as Error).message; }
      finally { button.setDisabled(false); }
    })).addButton(button => button.setButtonText("取消").onClick(() => this.close()));
  }
  onClose() {this.contentEl.empty();}
}
