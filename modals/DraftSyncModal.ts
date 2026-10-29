import { App, Modal, Notice } from "obsidian";
import { DraftSyncSession, SyncPreview, SyncTarget } from "../utils/draftSync";
import { parseFrontMatter } from "../utils/frontMatter";

export class DraftSyncModal extends Modal {
  private closed=false;
  private previews:SyncPreview[]=[];
  private selected=new Map<SyncTarget,{enabled:HTMLInputElement;changes:Map<number,HTMLInputElement>}>();
  constructor(app:App,private session:DraftSyncSession,private apply:(previews:SyncPreview[],guard:()=>void)=>Promise<string[]>,private finished:()=>void){super(app);}
  onOpen(){
    this.closed=false;this.modalEl.addClass("easy-pub-draft-sync");
    const root=this.contentEl;root.empty();root.createEl("h2",{text:"同步正文改动到其他发布稿"});
    root.createEl("p",{text:"勾选目标和改动 → 预览最终正文 → 确认同步。保留各稿标题、封面与平台属性，只保存本地稿。"});
    root.createEl("p",{text:"首次以当前原稿为比较基准，可能包含平台独立修改，请逐项核对；以后按本稿到各目标的已同步记录比较。冲突默认不选。"});
    const modeLabel=root.createEl("label",{text:"同步范围 "});
    const mode=modeLabel.createEl("select",{attr:{"aria-label":"同步范围"}});
    mode.createEl("option",{text:"正文改动与配图",value:"all"});mode.createEl("option",{text:"仅新增配图（独立图片行）",value:"images"});
    const status=root.createEl("p",{attr:{role:"status","aria-live":"polite"}});
    const previewArea=root.createDiv();
    const controls=root.createDiv({cls:"ep-panel-actions"});
    const preview=controls.createEl("button",{text:"预览所选改动"});
    const save=controls.createEl("button",{text:"确认同步到所选稿件",cls:"mod-cta"});save.disabled=true;
    controls.createEl("button",{text:"取消"}).onclick=()=>this.close();
    const invalidate=()=>{this.previews=[];save.disabled=true;previewArea.empty();status.textContent="选择已变化，请重新预览。";};
    const display=(text:string)=>text.replace(/easy-pub-sync-image:\/\/([a-f0-9]{64})\.([a-z]+)/g,(_m,hash,ext)=>`图片-${hash.slice(0,8)}.${ext}`);
    for(const target of this.session.targets){
      const section=root.createEl("section");section.addClass("ep-sync-target");
      const label=section.createEl("label");const enabled=label.createEl("input",{type:"checkbox"});enabled.setAttribute("aria-label",`同步到${target.location.platform.name}`);
      label.appendText(` ${target.location.platform.name}${target.initial?" · 首次比较":" · 使用上次同步基准"}`);
      enabled.onchange=invalidate;section.createEl("small",{text:target.location.path,cls:"ep-panel-path"});
      const changes=new Map<number,HTMLInputElement>();this.selected.set(target,{enabled,changes});
      if(!target.changes.length)section.createEl("p",{text:"当前稿相对于同步基准没有改动。"});
      target.changes.forEach((change,index)=>{
        const details=section.createEl("details");const summary=details.createEl("summary");
        const checkbox=summary.createEl("input",{type:"checkbox"});checkbox.checked=change.status==="ready";checkbox.disabled=change.status==="already";
        checkbox.setAttribute("aria-label",`${target.location.platform.name}改动 ${index+1}`);
        checkbox.onclick=event=>event.stopPropagation();checkbox.onchange=invalidate;changes.set(index,checkbox);
        summary.appendText(` 第 ${change.start+1} 行 · ${change.status==="conflict"?"冲突：选择后替换下方目标片段":change.status==="already"?"目标已包含此改动":change.imagesOnly?"新增配图":"正文改动"}`);
        details.createEl("p",{text:"目标当前片段"});details.createEl("pre",{text:display(change.targetText.join("\n"))||"（插入位置）"});
        details.createEl("p",{text:"选中后写入"});details.createEl("pre",{text:display(change.replacement.join("\n"))||"（删除该片段）"});
      });
    }
    mode.onchange=()=>{for(const target of this.session.targets){const selection=this.selected.get(target)!;selection.changes.forEach((input,index)=>{
      input.disabled=target.changes[index].status==="already"||(mode.value==="images"&&!target.changes[index].imagesOnly);
      if(input.disabled)input.checked=false;
    });}invalidate();};
    let version=0;
    preview.onclick=async()=>{
      const generation=++version;invalidate();preview.disabled=true;
      try{
        const selections=[...this.selected].filter(([,selection])=>selection.enabled.checked);
        if(!selections.length)throw new Error("请勾选至少一个目标稿件");
        await this.session.assertFresh();
        const prepared:SyncPreview[]=[];
        for(const[target,selection]of selections){const indices=new Set([...selection.changes].filter(([,input])=>input.checked&&!input.disabled).map(([index])=>index));prepared.push(await this.session.preview(target,indices));}
        if(this.closed||generation!==version)return;
        this.previews=prepared;previewArea.empty();
        for(const result of prepared){const item=previewArea.createEl("section");item.createEl("h3",{text:`${result.target.location.platform.name} · 最终正文预览`});
          item.createEl("p",{text:`${result.selected.length} 项改动；${result.assets.length} 个图片文件需复制或核对。${result.layoutNotice??""}`});
          const comparison=item.createDiv({cls:"ep-format-comparison"});
          const before=comparison.createDiv();before.createEl("h4",{text:"当前目标稿"});before.createEl("pre",{text:parseFrontMatter(result.target.snapshot).content});
          const after=comparison.createDiv();after.createEl("h4",{text:"确认后正文"});after.createEl("pre",{text:result.body});
        }
        status.textContent="请核对完整正文。目标稿将在写入前备份；确认后不自动上传或发布。";save.disabled=false;
      }catch(error){if(!this.closed)status.textContent=(error as Error).message;}
      finally{preview.disabled=false;}
    };
    // Any selection change cancels in-flight preview authority as well as the previous result.
    root.addEventListener("change",()=>{version++;});
    save.onclick=async()=>{
      if(save.disabled||this.closed)return;
      const prepared=this.previews;save.disabled=true;preview.disabled=true;
      const inputs=Array.from(root.querySelectorAll<HTMLInputElement|HTMLSelectElement>("input,select"));inputs.forEach(input=>input.disabled=true);
      try{
        const completed=await this.apply(prepared,()=>{if(this.closed)throw new Error("同步窗口已关闭，已停止后续写入");});
        new Notice(`正文已同步到：${completed.join("、")}。尚未上传或发布。`);this.close();
      }catch(error){if(!this.closed){status.textContent=(error as Error).message;this.previews=[];preview.disabled=false;inputs.forEach(input=>input.disabled=false);}}
    };
    // Keep the final preview and actions after the target selection list.
    root.append(previewArea,status,controls);
  }
  onClose(){this.closed=true;this.previews=[];this.session.dispose();this.finished();this.contentEl.empty();}
}
