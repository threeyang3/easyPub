import { App, TFile, WorkspaceLeaf } from 'obsidian';
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import EasyPub from '../main';
import { PublishingView } from '../views/PublishingView';
import { WechatView } from '../views/WechatView';
import { HexoFormatModal } from '../modals/HexoFormatModal';
import { importImageAttachment } from '../utils/attachmentImport';
import { normalizeSettings } from '../utils/settings';
import { stringifyFrontMatter, parseFrontMatter } from '../utils/frontMatter';
import { formatHexoMarkdown } from '../utils/hexoFormatting';
import { relativeVaultAttachment } from '../utils/platforms';
import { writePublishedFile } from '../utils/publishFiles';

// Only synthetic files in Sandbox and a marked disposable blog. No account config, uploads or deploy.
export async function run(app: App, options: {blogPath?: string; styles?: string}) {
  if (app.vault.getName() !== 'Sandbox' || !options.blogPath || !path.isAbsolute(options.blogPath)) throw new Error('Requires Sandbox and a disposable blog');
  const blog = options.blogPath;
  await fs.access(path.join(blog,'.easypub-test-copy'));
  const id = `ep-stability-${Date.now()}`, folder = `EasyPub 验收 ${id}`;
  const checks: string[] = [], attachments: TFile[] = [], leaves: WorkspaceLeaf[] = [], backups = new Set<string>();
  const assert = (value: unknown, label: string) => {if (!value) throw new Error(label); checks.push(label);};
  const until = async (predicate:()=>boolean|Promise<boolean>, label: string) => {
    const start=Date.now(); while (!await predicate()) {if(Date.now()-start>10000) throw new Error(label); await new Promise(r=>setTimeout(r,25));}
  };
  const plugin = new EasyPub(app,{id,name:'Temporary stability acceptance',version:'0.0.0',minAppVersion:'1.5.7',author:'test',description:'Sandbox only'});
  plugin.settings = normalizeSettings({hexoRepoPath:blog,workbenchIntroduced:true,wechat:{allowRemoteImages:false}});
  plugin.saveSettings = async () => {};
  const style=document.createElement('style'); style.textContent=options.styles??''; document.head.append(style);
  const originalOpen=HexoFormatModal.prototype.open, OriginalImage=window.Image;
  const target=path.join(blog,'source/_drafts',`${id}.md`);
  let format: HexoFormatModal|undefined;
  const originalActive=app.workspace.activeLeaf;
  try {
    await app.vault.createFolder(folder);
    const source=await app.vault.create(`${folder}/source.md`,stringifyFrontMatter('第一行\n第二行\n',{title:id,pub_id:id}));
    const canvas=document.createElement('canvas'); canvas.width=1440; canvas.height=900;
    canvas.getContext('2d')!.fillStyle='#28735c'; canvas.getContext('2d')!.fillRect(0,0,1440,900);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/png'));
    const bytes=await blob.arrayBuffer();
    const upload={name:`${id}.png`,size:bytes.byteLength,arrayBuffer:async()=>bytes};
    const image=await importImageAttachment(app,source.path,upload); attachments.push(image);
    const second=await importImageAttachment(app,source.path,upload); attachments.push(second);
    assert(image.path!==second.path,'native host attachment API avoids duplicate filenames');
    assert(Buffer.from(await app.vault.readBinary(image)).equals(Buffer.from(bytes)),'native attachment bytes are preserved in configured directory');

    const panelType=`${id}-panel`;
    plugin.registerView(panelType,leaf=>new class extends PublishingView {getViewType(){return panelType;}}(leaf,plugin));
    const panelLeaf=app.workspace.getRightLeaf(false)!; leaves.push(panelLeaf);
    await panelLeaf.setViewState({type:panelType,state:{path:source.path,pinned:true},active:true});
    await app.workspace.revealLeaf(panelLeaf);
    const panel=panelLeaf.view as PublishingView;
    assert(panel.getState().path===source.path && panel.getState().pinned,'native panel restores pinned context');
    assert(panel.contentEl.textContent?.includes('Hexo 管理后台'),'native always-available management shortcut renders');
    const other=await app.vault.create(`${folder}/other.md`,'Other note');
    await panel.followFile(other);
    assert(panel.getState().path===source.path,'native pinned panel ignores another article');

    const cover=relativeVaultAttachment(`${folder}/wechat.md`,image.path);
    const draft=await app.vault.create(`${folder}/wechat.md`,stringifyFrontMatter('正文\n\n第二段\n',{title:id,pub_id:id,source_file:`[[${source.path}]]`,wechat:{cover}}));
    const wechatType=`${id}-wechat`;
    plugin.registerView(wechatType,leaf=>new class extends WechatView {getViewType(){return wechatType;}}(leaf,plugin));
    const leaf=app.workspace.getLeaf('tab'); leaves.push(leaf);
    await leaf.setViewState({type:wechatType,state:{path:draft.path},active:true});
    await app.workspace.revealLeaf(leaf);
    const view=leaf.view as WechatView, internal=view as any;
    await until(()=>!!internal.cover&&!internal.busy&&!internal.stale,'Native workbench refresh timed out');
    assert(view.contentEl.textContent?.includes('预检通过'),'native WeChat renderer and local cover preflight pass');
    let decodes=0;
    window.Image=new Proxy(OriginalImage,{construct(target,args){decodes++; return Reflect.construct(target,args,target);}});
    await internal.openCrop();
    const crop=internal.cropModal;
    const range=crop.contentEl.querySelector('input[type=range]') as HTMLInputElement;
    for(let i=0;i<30;i++){range.value=String(1+i/100);range.dispatchEvent(new Event('input'));}
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    assert(decodes===1,'native dual-ratio crop decodes one bitmap across repeated adjustments');
    const apply=Array.from(crop.contentEl.querySelectorAll('button')).find(b=>(b as HTMLElement).textContent==='应用裁剪') as HTMLButtonElement;
    apply.click();
    await until(()=>!internal.cropModal,'Native crop application timed out');
    assert(internal.dirty && internal.article.cropWide && internal.article.cropSquare,'native crop applies independent wide and square coordinates');
    await internal.saveArticle();
    const settings=parseFrontMatter(await app.vault.read(draft)).data.wechat as any;
    assert(settings.cropWide && settings.cropSquare,'native dual-ratio crop persists through Front Matter API');
    window.Image=OriginalImage;
    internal.paused=true;
    await app.vault.modifyBinary(image,new Uint8Array([...new Uint8Array(bytes),0]).buffer);
    await until(()=>internal.stale,'Attachment update did not invalidate native preview');
    let blocked=false; try {await internal.openCrop();}catch(error){blocked=/预览待更新/.test((error as Error).message);}
    assert(blocked,'native paused stale preview refuses crop entry');
    await app.vault.modifyBinary(image,bytes); await internal.refresh();
    await internal.openCrop();
    const cancelled=internal.cropModal, before=JSON.stringify(internal.article);
    const cancelApply=Array.from(cancelled.contentEl.querySelectorAll('button')).find(b=>(b as HTMLElement).textContent==='应用裁剪') as HTMLButtonElement;
    cancelApply.click(); cancelled.close();
    await new Promise(r=>setTimeout(r,100));
    assert(JSON.stringify(internal.article)===before,'native close during async apply leaves crop settings unchanged');

    await fs.mkdir(path.dirname(target),{recursive:true});
    const original=stringifyFrontMatter('第一行  \n第二行\n\n\n',{title:id,pub_id:id,source_file:`[[${source.path}]]`,date:'2020-01-01',workflow:'pending'});
    await fs.writeFile(target,original);
    HexoFormatModal.prototype.open=function(){format=this; return originalOpen.call(this);};
    await plugin.formatHexoArticle(source);
    assert(format?.contentEl.textContent?.includes('第一行'),'native Hexo formatting confirmation renders');
    const confirm=Array.from(format!.contentEl.querySelectorAll('button')).find(b=>b.textContent==='应用排版')!;
    confirm.click();
    const formatted=formatHexoMarkdown(original).content;
    await until(async()=>await fs.readFile(target,'utf8')===formatted,'Native Hexo formatting save timed out');
    const backupDir=path.join(blog,'.easy-pub-backups');
    const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
    const backup=path.join(backupDir,`${hash(original)}.bak`); backups.add(backup);
    assert(await fs.readFile(backup,'utf8')===original,'native Hexo formatting keeps a byte-identical backup');
    assert(parseFrontMatter(formatted).data.workflow==='pending','native Hexo formatting preserves target metadata and draft location');
    await writePublishedFile(target,await fs.readFile(backup,'utf8'),formatted,backupDir);
    backups.add(path.join(backupDir,`${hash(formatted)}.bak`));
    assert(await fs.readFile(target,'utf8')===original,'native disposable blog restores backup with an expected-content guard');
    return {checks,environment:{platform:process.platform,electron:process.versions.electron},attachmentLocation:path.dirname(image.path),deployments:0,remoteWrites:0};
  } finally {
    window.Image=OriginalImage; HexoFormatModal.prototype.open=originalOpen; format?.close();
    for(const leaf of leaves) leaf.detach();
    plugin.unload(); style.remove();
    const created=app.vault.getAbstractFileByPath(folder); if(created) await app.vault.delete(created,true);
    for(const file of attachments) if(app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file,true);
    await fs.rm(target,{force:true}); for(const backup of backups) await fs.rm(backup,{force:true});
    if(originalActive) app.workspace.setActiveLeaf(originalActive,{focus:false});
  }
}
