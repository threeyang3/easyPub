import { App, MarkdownView, Plugin, WorkspaceLeaf } from "obsidian";
import fs from "fs/promises";
import os from "os";
import path from "path";
import EasyPub from "../main";
import { normalizeSettings } from "../utils/settings";
import { PLATFORMS } from "../types";
import { registerHexoEditing } from "../utils/hexoEditing";
import { stringifyFrontMatter } from "../utils/frontMatter";

export async function run(this: Plugin, app: App) {
  if(app.vault.getName()!=="Sandbox") throw new Error("Requires Sandbox");
  const checks: string[]=[];
  const assert=(value: unknown,label:string)=>{if(!value)throw new Error(label);checks.push(label);};
  const wait=async(fn:()=>boolean)=>{for(let i=0;i<80;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error("Native condition timed out");};
  const repo=await fs.mkdtemp(path.join(os.tmpdir(),"easypub-editor-native-"));
  const id=`easypub-editor-${Date.now()}`,folder=id;
  const original=app.workspace.activeLeaf;
  let leaf:WorkspaceLeaf|undefined;
  try {
    await fs.mkdir(path.join(repo,"source/_posts"),{recursive:true});
    await fs.writeFile(path.join(repo,"_config.yml"),"url: https://example.com/\nroot: /\n");
    await app.vault.createFolder(folder);
    const source=await app.vault.create(`${folder}/source.md`,stringifyFrontMatter("source",{pub_id:id,title:id}));
    const draft=path.join(repo,"source/_posts",`${id}.md`);
    await fs.writeFile(draft,stringifyFrontMatter("原始正文\n",{pub_id:id,title:id,source_file:`[[${source.path}]]`}));
    const plugin=Object.create(EasyPub.prototype) as EasyPub;
    Object.assign(plugin,{app,settings:normalizeSettings({hexoRepoPath:repo})});
    registerHexoEditing(this,()=>repo);
    await plugin.openRelatedDraft(source,PLATFORMS.find(p=>p.id==="hexo")!);
    leaf=app.workspace.getLeavesOfType("markdown").find(l=>(l.view as MarkdownView).file?.path===`file:${draft}`);
    assert(leaf,"Sidebar openRelatedDraft opens the exact Hexo file inside Obsidian");
    const count=app.workspace.getLeavesOfType("markdown").length;
    await plugin.openRelatedDraft(source,PLATFORMS.find(p=>p.id==="hexo")!);
    assert(app.workspace.getLeavesOfType("markdown").length===count,"Reopening reuses the native tab");
    const view=leaf!.view as MarkdownView;
    const editor=view.editor;
    editor.setCursor(editor.lastLine(),editor.getLine(editor.lastLine()).length);
    const canvas=document.createElement("canvas");canvas.width=80;canvas.height=40;
    canvas.getContext("2d")!.fillStyle="#238557";canvas.getContext("2d")!.fillRect(0,0,80,40);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),"image/png"));
    const bytes=Buffer.from(await blob.arrayBuffer());
    const clipboard=new DataTransfer();clipboard.items.add(new File([blob],"native-paste.png",{type:"image/png"}));
    const paste=new ClipboardEvent("paste",{clipboardData:clipboard,bubbles:true,cancelable:true});
    const content=view.contentEl.querySelector(".cm-content");
    assert(content,"Native Markdown editor content is available");
    content!.dispatchEvent(paste);
    await wait(()=>editor.getValue().includes("![图片](/img/uploads/"));
    assert(paste.defaultPrevented,"Native paste is handled before Obsidian's default Vault attachment save");
    const relative=editor.getValue().match(/!\[图片\]\(\/([^\)]+)\)/)![1];
    assert(Buffer.from(await fs.readFile(path.join(repo,"source",relative))).equals(bytes),"Pasted bytes are stored in the blog's image directory");
    editor.setCursor(0,0);
    await wait(()=>Array.from(view.contentEl.querySelectorAll<HTMLImageElement>("img")).some(img=>img.naturalWidth===80));
    assert(true,"Pasted blog-root image displays in native live preview");
    await leaf!.setViewState({type:"markdown",state:{file:`file:${draft}`,mode:"preview"}});
    await wait(()=>Array.from((leaf!.view as MarkdownView).contentEl.querySelectorAll<HTMLImageElement>("img")).some(img=>img.naturalWidth===80));
    assert(true,"Pasted blog-root image displays in reading mode");
    for(let i=0;i<80;i++) {
      if((await fs.readFile(draft,"utf8")).includes(`![图片](/${relative})`))break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert((await fs.readFile(draft,"utf8")).includes(`![图片](/${relative})`),"Obsidian saves the image reference to the original external Markdown file");
    assert((await app.vault.read(source)).includes("source") && !(await app.vault.read(source)).includes("![图片]"),"Editing Hexo draft preserves the source note");
    return {checks};
  } catch(error) {
    throw new Error(`${(error as Error).message}; checks=${JSON.stringify(checks)}; state=${JSON.stringify(leaf?.getViewState())}; html=${leaf ? (leaf.view as MarkdownView).contentEl.innerHTML.slice(-6500) : "none"}`);
  } finally {
    leaf?.detach();
    const testFolder=app.vault.getAbstractFileByPath(folder);if(testFolder)await app.vault.delete(testFolder,true);
    if(original)await app.workspace.revealLeaf(original);
    await fs.rm(repo,{recursive:true,force:true});
  }
}
