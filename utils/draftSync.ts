import { App, MarkdownView, TFile, normalizePath } from "obsidian";
import fs from "fs/promises";
import path from "path";
import type EasyPub from "../main";
import { Platform, PLATFORMS, WechatLayoutDocument } from "../types";
import { parseFrontMatter, getFrontMatterString, stringifyFrontMatter } from "./frontMatter";
import { getPublishPath, hexoEditorPath, isWithinPath } from "./platforms";
import { DraftSyncImages, CanonicalBody, SyncLocation, SyncAsset, syncHash, readAttachmentConfiguration } from "./draftSyncImages";
import { reconcileChanges, applySyncChanges, SyncChange } from "./draftSyncDiff";
import { writeImmutableAsset } from "./publishFiles";
import { extractWechatBlocks } from "./wechatLayoutAst";
import { rebaseWechatLayout } from "./wechatLayoutEngine";

export interface SyncTarget {
  location: SyncLocation & {platform:Platform}; snapshot: string; canonical: CanonicalBody;
  baseline: string; baselinePath: string; baselineSnapshot: string|null; initial: boolean; changes: SyncChange[];
}
export interface SyncPreview {
  target: SyncTarget; content: string; body: string; canonical: string; assets: SyncAsset[]; selected: SyncChange[]; layoutNotice?: string;
}
const layoutDoc = (body: string):WechatLayoutDocument => {
  const doc=extractWechatBlocks(body);return {hash:doc.hash,blocks:doc.blocks.map(block=>({...block,text:block.markdown,planningText:""}))};
};
export function preserveSyncedWechatLayout(before: string, after: string, data: Record<string,any>): {data:Record<string,any>;notice?:string} {
  if(!data.wechat?.layout||before===after)return {data};
  try {
    const result=rebaseWechatLayout(data.wechat.layout,layoutDoc(after),layoutDoc(before));
    return {data:{...data,wechat:{...data.wechat,layout:result.plan,layoutHistory:[...(Array.isArray(data.wechat.layoutHistory)?data.wechat.layoutHistory:[]),data.wechat.layout].slice(-5)}},notice:result.notice};
  } catch { return {data,notice:"原排版方案无效，已保留原设置；请在公众号工作台重新确认排版。"}; }
}

async function adapterWrite(app:App,target:string,content:string) {
  const adapter=app.vault.adapter;
  const parts=target.split("/");parts.pop();let directory="";
  for(const part of parts){directory=directory?`${directory}/${part}`:part;if(!await adapter.exists(directory))await adapter.mkdir(directory);}
  await adapter.write(target,content);
}

export class DraftSyncSession {
  readonly targets:SyncTarget[]=[];
  private images!:DraftSyncImages;
  private source!:TFile;
  private sourceSnapshot="";
  private sender!:SyncLocation&{platform:Platform};
  private senderSnapshot="";
  private senderCanonical!:CanonicalBody;
  private filePath="";
  private settingsSnapshot="";
  private configuration:string|null=null;
  private storage="";
  private pubId="";
  private sourcePath="";
  private changed=false;
  private cleanup:Array<()=>void>=[];
  private file!:TFile;
  private constructor(private plugin:EasyPub) {}
  private settingsKey(){return JSON.stringify([this.plugin.settings.hexoRepoPath,this.plugin.settings.publishBasePath]);}

  static async create(plugin:EasyPub,file:TFile):Promise<DraftSyncSession> {
    const session=new DraftSyncSession(plugin);await session.prepare(file);
    const changed=(file:unknown)=>{if(file===session.file||file===session.source)session.changed=true;};
    for(const ref of [plugin.app.vault.on("modify",changed),plugin.app.vault.on("rename",changed),plugin.app.vault.on("delete",changed)])session.cleanup.push(()=>plugin.app.vault.offref(ref));
    return session;
  }
  dispose(){this.cleanup.splice(0).forEach(fn=>fn());}
  private editorPath(file:TFile){return hexoEditorPath(this.plugin.app,this.plugin.settings.hexoRepoPath,file.path)??file.path;}
  private async prepare(file:TFile) {
    const {app,settings}=this.plugin;this.file=file;this.filePath=file.path;
    const external=hexoEditorPath(app,settings.hexoRepoPath,file.path);
    const platform=PLATFORMS.find(p=>p.id==="hexo"?!!external:!p.isExternal&&file.path.startsWith(`${getPublishPath(p,settings)}/`));
    if(!platform)throw new Error("请打开一篇发布稿后同步；原稿更新请使用创建 / 更新发布稿");
    // Flush the initiating editor before taking an immutable disk snapshot.
    for(const leaf of app.workspace.getLeavesOfType("markdown")) {
      const view=leaf.view as MarkdownView;
      if(view.file&&this.editorPath(view.file)===(external??file.path))await view.save();
    }
    this.sender={platform,path:external??file.path};
    this.senderSnapshot=await this.plugin.readPublishFile(platform,this.sender.path);
    const meta=parseFrontMatter(this.senderSnapshot,true).data;
    this.pubId=getFrontMatterString(meta,"pub_id")??"";
    if(!this.pubId||!meta.source_file)throw new Error("发布稿缺少 pub_id 或原稿关联，无法安全同步");
    const source=await this.plugin.resolvePublishingSource(file,meta);
    if(!source)throw new Error("原稿关联无效或身份不一致，请先修复 source_file 和 pub_id");
    this.source=source;this.sourcePath=source.path;this.sourceSnapshot=await app.vault.read(source);
    const sourceMeta=parseFrontMatter(this.sourceSnapshot,true);
    this.images=new DraftSyncImages(app,settings,this.pubId);
    this.senderCanonical=await this.images.canonical(parseFrontMatter(this.senderSnapshot).content,this.sender);
    const sourceBody=await this.images.canonical(sourceMeta.content,{path:source.path});
    const directory=this.plugin.manifest.dir??`${app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
    this.storage=normalizePath(`${directory}/draft-sync`);
    this.settingsSnapshot=this.settingsKey();this.configuration=await readAttachmentConfiguration(app);
    for(const target of PLATFORMS) {
      if(target.id==="hexo"&&!settings.hexoRepoPath)continue;
      const targetPath=await this.plugin.findArticleByPubId(target,this.pubId,sourceMeta.data,source.path);
      if(!targetPath)continue;
      if(target.id===platform.id) {
        if(targetPath!==this.sender.path)throw new Error("当前发布稿已移动或存在重复身份，请重新打开稿件");
        continue;
      }
      const snapshot=await this.plugin.readPublishFile(target,targetPath);
      const parsed=parseFrontMatter(snapshot,true);
      if(getFrontMatterString(parsed.data,"pub_id")!==this.pubId)throw new Error("目标稿件身份已变化");
      const location={platform:target,path:targetPath};
      const canonical=await this.images.canonical(parsed.content,location);
      const baselinePath=`${this.storage}/baselines/${syncHash(JSON.stringify([this.pubId,this.sender,target.id,targetPath]))}.json`;
      const baselineSnapshot=await app.vault.adapter.exists(baselinePath)?await app.vault.adapter.read(baselinePath):null;
      let baseline=sourceBody.body;
      if(baselineSnapshot!==null) {
        const stored=JSON.parse(baselineSnapshot);
        if(stored.schemaVersion!==1||stored.pubId!==this.pubId||stored.sender!==this.sender.path||stored.target!==targetPath
          ||typeof stored.body!=="string"||syncHash(stored.body)!==stored.hash)throw new Error("同步基准记录损坏，请从插件备份恢复该记录");
        baseline=stored.body;
      }
      this.targets.push({location,snapshot,canonical,baseline,baselinePath,baselineSnapshot,initial:baselineSnapshot===null,
        changes:reconcileChanges(baseline,this.senderCanonical.body,canonical.body)});
    }
    if(!this.targets.length)throw new Error("尚无其他关联发布稿；请先从原稿生成需要同步的平台稿");
    await this.assertFresh();
  }

  async preview(target:SyncTarget,indices:Set<number>):Promise<SyncPreview> {
    const selected=target.changes.filter((change,i)=>indices.has(i)&&change.status!=="already");
    if(!selected.length)throw new Error("请至少选择一项尚未同步的改动");
    const canonical=applySyncChanges(target.canonical.body,selected);
    const prepared=await this.images.materialize(canonical,target.location,target.canonical,this.configuration);
    const parsed=parseFrontMatter(target.snapshot,true);
    const body=target.snapshot.includes("\r\n")?prepared.body.replace(/\r?\n/g,"\r\n"):prepared.body;
    const layout=target.location.platform.id==="wechat"?preserveSyncedWechatLayout(parsed.content,body,parsed.data):{data:parsed.data,notice:undefined};
    // Keep the original Front Matter bytes for non-WeChat targets, including comments and custom values.
    const content=layout.data===parsed.data?target.snapshot.slice(0,target.snapshot.length-parsed.content.length)+body:stringifyFrontMatter(body,layout.data);
    return {target,content,body,canonical,assets:prepared.assets,selected,layoutNotice:layout.notice};
  }

  async assertFresh(assertActive:()=>void=()=>{}) {
    assertActive();const {app}=this.plugin;
    if(this.file.path!==this.filePath||this.source.path!==this.sourcePath||this.settingsKey()!==this.settingsSnapshot
      ||await app.vault.read(this.source)!==this.sourceSnapshot||await this.plugin.readPublishFile(this.sender.platform,this.sender.path)!==this.senderSnapshot
      ||await readAttachmentConfiguration(app)!==this.configuration)throw new Error("原稿、当前稿或附件/博客设置已变化，请重新打开同步窗口");
    for(const leaf of app.workspace.getLeavesOfType("markdown")) {
      const view=leaf.view as MarkdownView;
      if(view.file&&this.editorPath(view.file)===this.sender.path&&view.getViewData()!==this.senderSnapshot)throw new Error("当前稿还有新的编辑，请重新打开同步窗口");
    }
    this.changed=false;assertActive();
  }

  async commit(previews:SyncPreview[],assertActive:()=>void):Promise<string[]> {
    if(!previews.length||new Set(previews.map(p=>p.target)).size!==previews.length)throw new Error("请选择目标稿并预览");
    const {app}=this.plugin;const completed:string[]=[];
    const checkTarget=async(preview:SyncPreview)=>{
      const target=preview.target;
      await this.assertFresh(assertActive);
      if(await this.plugin.readPublishFile(target.location.platform,target.location.path)!==target.snapshot)throw new Error(`${target.location.platform.name}稿已变化，请重新预览`);
      for(const leaf of app.workspace.getLeavesOfType("markdown")) {
        const view=leaf.view as MarkdownView;
        if(view.file&&this.editorPath(view.file)===target.location.path&&view.getViewData()!==target.snapshot)throw new Error(`${target.location.platform.name}稿存在未保存的编辑，请先保存再同步`);
      }
      const baseline=await app.vault.adapter.exists(target.baselinePath)?await app.vault.adapter.read(target.baselinePath):null;
      if(baseline!==target.baselineSnapshot)throw new Error("同步基准已变化，请重新预览");
    };
    await this.images.verify();for(const preview of previews)await checkTarget(preview);
    try {
      for(const preview of previews) {
        await checkTarget(preview);
        // Recoverable Vault backup precedes attachment or Markdown writes.
        await adapterWrite(app,`${this.storage}/backups/${syncHash(preview.target.location.path)}-${syncHash(preview.target.snapshot)}.md`,preview.target.snapshot);
        for(const asset of preview.assets) {
          await this.assertFresh(assertActive);
          if(asset.external) {
            let ancestor=path.dirname(asset.path);
            while(true){try{if(!isWithinPath(await fs.realpath(this.plugin.settings.hexoRepoPath),await fs.realpath(ancestor)))throw new Error("同步图片目录超出博客仓库");break;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;ancestor=path.dirname(ancestor);}}
            await writeImmutableAsset(asset.path,asset.bytes,asset.hash);
          } else {
            const existing=app.vault.getAbstractFileByPath(asset.path);
            if(existing) {
              if(!(existing instanceof TFile)||syncHash(Buffer.from(await app.vault.readBinary(existing)))!==asset.hash)throw new Error("附件目标已变化，请重新预览");
            } else {
              const available=await app.fileManager.getAvailablePathForAttachment(asset.name,preview.target.location.path);
              if(available!==asset.path)throw new Error("附件目录或同名文件已变化，请重新预览");
              await this.assertFresh(assertActive);
              await app.vault.createBinary(asset.path,Uint8Array.from(asset.bytes).buffer);
            }
          }
        }
        await this.images.verify();
        const guard=()=>{assertActive();if(this.changed||this.settingsKey()!==this.settingsSnapshot||this.file.path!==this.filePath||this.source.path!==this.sourcePath)throw new Error("原稿、当前稿或设置在写入前发生变化，已停止同步");
          for(const leaf of app.workspace.getLeavesOfType("markdown")){const view=leaf.view as MarkdownView;if(view.file&&[this.sender.path,this.sourcePath].includes(this.editorPath(view.file))&&view.getViewData()!==(this.editorPath(view.file)===this.sender.path?this.senderSnapshot:this.sourceSnapshot))throw new Error("原稿或当前稿有新的编辑，已停止同步");}};
        await this.plugin.writePublishFile(preview.target.location.platform,preview.target.location.path,preview.content,preview.target.snapshot,guard,
          async()=>{await checkTarget(preview);await this.images.verify();});
        completed.push(preview.target.location.platform.name);
        // Advance only selected deltas; unchecked changes remain available on the next run.
        const baseline=preview.target.baseline.split("\n");
        for(const change of [...preview.selected].sort((a,b)=>b.start-a.start||b.end-a.end||(b.order??0)-(a.order??0)))baseline.splice(change.start,change.end-change.start,...change.after);
        const body=baseline.join("\n");
        await adapterWrite(app,preview.target.baselinePath,JSON.stringify({schemaVersion:1,pubId:this.pubId,sender:this.sender.path,target:preview.target.location.path,body,hash:syncHash(body)}));
      }
      return completed;
    } catch(error) {throw new Error(`${(error as Error).message}${completed.length?`。已完成：${completed.join("、")}；其余稿件未完成，请重新检查后继续。`:"。未完成的稿件保留原文，已导入图片予以保留。"}`);}
  }
}
