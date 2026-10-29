import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { TFile } from "obsidian";
import EasyPub from "../main";
import { PLATFORMS, WechatLayoutDocument } from "../types";
import { normalizeSettings } from "../utils/settings";
import { getPublishPath } from "../utils/platforms";
import { bodyChanges, reconcileChanges, applySyncChanges } from "../utils/draftSyncDiff";
import { DraftSyncImages, syncAttachmentPath } from "../utils/draftSyncImages";
import { DraftSyncSession } from "../utils/draftSync";
import { parseFrontMatter, stringifyFrontMatter } from "../utils/frontMatter";
import { extractWechatBlocks } from "../utils/wechatLayoutAst";
import { anchorWechatLayout, rebaseWechatLayout, validateWechatLayout } from "../utils/wechatLayoutEngine";
const doc=(body:string):WechatLayoutDocument=>{const value=extractWechatBlocks(body);return {hash:value.hash,blocks:value.blocks.map(block=>({...block,text:block.markdown,planningText:""}))};};

export async function runDraftSyncTests(){
  let seed=31;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let n=0;n<150;n++){
    const before=Array.from({length:random()%9+1},()=>String(random()%5)).join("\n");
    const after=Array.from({length:random()%9+1},()=>String(random()%5)).join("\n");
    assert.equal(applySyncChanges(before,reconcileChanges(before,after,before)),after);
    assert.equal(applySyncChanges(after,reconcileChanges(before,after,after)),after);
  }
  for(let n=0;n<80;n++){
    const line=()=>["a","b","", "![图](<https://example.com/a.png>)"][random()%4];
    const before=Array.from({length:random()%8+1},line).join("\n"),after=Array.from({length:random()%8+1},line).join("\n");
    assert.equal(applySyncChanges(before,reconcileChanges(before,after,before)),after,"Image/blank-line alignment preserves all selected changes");
  }
  const base="A\n\nB\n\nC\n",sender="A\n\n![新增](<easy-pub-sync-image://x.png>)\n\nB2\n\nC\n",target="A\n\nB\n\n目标结尾\n";
  const changes=reconcileChanges(base,sender,target);
  assert.ok(changes.some(change=>change.imagesOnly));
  assert.equal(applySyncChanges(target,changes.filter(change=>change.imagesOnly)),"A\n\n![新增](<easy-pub-sync-image://x.png>)\n\nB\n\n目标结尾\n");
  const conflicts=reconcileChanges("a\nb\nc","a\nchanged\nc","a\ntarget\nc");
  assert.equal(conflicts[0].status,"conflict");assert.equal(applySyncChanges("a\ntarget\nc",conflicts),"a\nchanged\nc");
  assert.throws(()=>bodyChanges("x\n".repeat(2100),"y\n".repeat(2100)),/正文过长/);
  assert.equal(bodyChanges("```md\n```\n","```md\n![示例](a.png)\n```\n").some(change=>change.imagesOnly),false,"Code examples are not newly inserted pictures");
  assert.equal(syncAttachmentPath('{"attachmentFolderPath":"./附件"}',"发布/微信/post.md","a.png"),"发布/微信/附件/a.png");

  const old="第一段\n\n重点段\n\n结尾\n",next="![图](a.png)\n\n"+old;
  const oldDoc=doc(old),plan=anchorWechatLayout({schemaVersion:1,documentHash:oldDoc.hash,theme:"editorial",accentColor:"preset",blocks:[{id:oldDoc.blocks[1].id,role:"key-point",component:"highlight-card",locked:true}]},oldDoc);
  const rebased=rebaseWechatLayout(plan,doc(next));
  assert.equal(rebased.plan.theme,"editorial");assert.equal(rebased.plan.blocks.length,1);assert.equal(rebased.plan.blocks[0].locked,true);
  assert.notEqual(rebased.plan.blocks[0].id,plan.blocks[0].id);validateWechatLayout(rebased.plan,doc(next));
  assert.equal(rebaseWechatLayout(plan,doc(old.replace("重点段","改写重点"))).plan.blocks.length,0);
  const repeated=doc("重复\n\n重复\n");
  const ambiguous=anchorWechatLayout({...plan,documentHash:repeated.hash,blocks:[{...plan.blocks[0],id:repeated.blocks[0].id}]},repeated);
  assert.equal(rebaseWechatLayout(ambiguous,doc("重复\n")).plan.blocks.length,0);

  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"easypub-sync-")),repo=path.join(directory,"blog"),vault=path.join(directory,"vault");
  await fs.mkdir(path.join(repo,"source/_posts"),{recursive:true});await fs.mkdir(vault,{recursive:true});
  await fs.writeFile(path.join(repo,"_config.yml"),"url: https://example.com/\nroot: /\n");
  const settings=normalizeSettings({hexoRepoPath:repo}),hexo=PLATFORMS.find(p=>p.id==="hexo")!,wechat=PLATFORMS.find(p=>p.id==="wechat")!,zhihu=PLATFORMS.find(p=>p.id==="zhihu")!;
  const sourcePath="notes/source.md",hexoPath=path.join(repo,"source/_posts/post.md"),wechatPath=`${getPublishPath(wechat,settings)}/post.md`,zhihuPath=`${getPublishPath(zhihu,settings,"文章")}/post.md`;
  const files=new Map<string,TFile>(),events=new Set<Function>();
  const write=async(p:string,text:string)=>{const absolute=path.join(vault,p);await fs.mkdir(path.dirname(absolute),{recursive:true});await fs.writeFile(absolute,text);if(!files.has(p))files.set(p,Object.assign(new TFile(),{path:p,extension:path.extname(p).slice(1),basename:path.basename(p,path.extname(p))}));};
  await write(".obsidian/app.json",'{"attachmentFolderPath":"静置/附件"}');
  await write(sourcePath,stringifyFrontMatter(old,{pub_id:"sync-id",title:"原稿"}));
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=","base64");
  await fs.mkdir(path.join(repo,"source/img"));await fs.writeFile(path.join(repo,"source/img/new.png"),png);
  const senderBody=old.replace("第一段\n\n","第一段\n\n![新增配图](/img/new.png)\n\n").replace("重点段","修改后的重点");
  await fs.writeFile(hexoPath,stringifyFrontMatter(senderBody,{pub_id:"sync-id",source_file:`[[${sourcePath}]]`}));
  await write(wechatPath,stringifyFrontMatter(old.replace("结尾","公众号独立结尾"),{title:"独立微信标题",pub_id:"sync-id",source_file:`[[${sourcePath}]]`,custom:42,wechat:{author:"作者",cover:"existing.png",layout:plan}}));
  await write(zhihuPath,stringifyFrontMatter(old,{title:"知乎标题",pub_id:"sync-id",source_file:`[[${sourcePath}]]`}));
  const adapter:any={getFullPath:(p:string)=>path.join(vault,p),exists:async(p:string)=>{try{await fs.access(path.join(vault,p));return true;}catch{return false;}},read:(p:string)=>fs.readFile(path.join(vault,p),"utf8"),write:(p:string,s:string)=>write(p,s),remove:async(p:string)=>{await fs.rm(path.join(vault,p));files.delete(p);},mkdir:(p:string)=>fs.mkdir(path.join(vault,p),{recursive:true})};
  const app:any={vault:{configDir:".obsidian",adapter,getAbstractFileByPath:(p:string)=>files.get(p)??null,getFileByPath:(p:string)=>files.get(p)??null,getFiles:()=>[...files.values()],
    read:(f:TFile)=>fs.readFile(path.join(vault,f.path),"utf8"),readBinary:(f:TFile)=>fs.readFile(path.join(vault,f.path)),
    createBinary:async(p:string,bytes:ArrayBuffer)=>{await fs.mkdir(path.dirname(path.join(vault,p)),{recursive:true});await fs.writeFile(path.join(vault,p),Buffer.from(bytes));files.set(p,Object.assign(new TFile(),{path:p,extension:"png"}));},
    on:(_event:string,fn:Function)=>{events.add(fn);return fn;},offref:(fn:Function)=>events.delete(fn)},workspace:{getLeavesOfType:()=>[]},
    metadataCache:{getFirstLinkpathDest:(p:string,from:string)=>files.get(p)??files.get(path.posix.normalize(path.posix.join(path.posix.dirname(from),p)))??null},
    fileManager:{getAvailablePathForAttachment:async(name:string,target:string)=>syncAttachmentPath(await adapter.read(".obsidian/app.json"),target,name)}};
  const plugin=Object.create(EasyPub.prototype) as EasyPub;
  Object.assign(plugin,{app,settings,manifest:{id:"easy-pub",dir:".obsidian/plugins/easy-pub"},resolvePublishingSource:async()=>files.get(sourcePath),
    findArticleByPubId:async(p:any)=>p.id==="hexo"?hexoPath:p.id==="wechat"?wechatPath:p.id==="zhihu"?zhihuPath:null,
    readPublishFile:async(p:any,file:string)=>p.isExternal?fs.readFile(file,"utf8"):adapter.read(file),
    writePublishFile:async(p:any,file:string,content:string,expected:string,active:()=>void,before:()=>Promise<void>)=>{
      await before();active();assert.equal(await(p.isExternal?fs.readFile(file,"utf8"):adapter.read(file)),expected);
      if(p.isExternal)await fs.writeFile(file,content);else await write(file,content);
    }});
  const native=Object.assign(new TFile(),{path:`file:${hexoPath}`,extension:"md"});
  let session:DraftSyncSession|undefined;
  try{
    session=await DraftSyncSession.create(plugin,native);
    const target=session.targets.find(t=>t.location.platform.id==="wechat")!;
    const selected=new Set(target.changes.flatMap((c,i)=>c.imagesOnly?[i]:[]));assert.equal(selected.size,1);
    const preview=await session.preview(target,selected);
    assert.match(preview.body,/\.\.\/\.\.\/静置\/附件|%E9%9D%99/);assert.equal(preview.assets.length,1);
    const unchanged=await adapter.read(wechatPath);assert.equal(preview.content.includes("独立微信标题"),true);
    await session.commit([preview],()=>{});session.dispose();
    const saved=parseFrontMatter(await adapter.read(wechatPath));
    assert.ok(saved.content.includes("公众号独立结尾"));assert.ok(saved.content.includes("重点段"));assert.ok(!saved.content.includes("修改后的重点"));
    assert.equal(saved.data.custom,42);assert.equal((saved.data.wechat as any).author,"作者");assert.equal((saved.data.wechat as any).layout.theme,"editorial");assert.equal((saved.data.wechat as any).layout.blocks.length,1);
    assert.deepEqual(await fs.readFile(path.join(vault,preview.assets[0].path)),png);
    assert.equal(await adapter.read(".obsidian/app.json"),'{"attachmentFolderPath":"静置/附件"}');
    session=await DraftSyncSession.create(plugin,native);
    const remaining=session.targets.find(t=>t.location.platform.id==="wechat")!;
    assert.equal(remaining.changes.some(change=>change.imagesOnly),false,"Unselected text edits remain; shared images do not repeat");
    assert.ok(remaining.changes.some(change=>change.after.join("\n").includes("修改后的重点")));
    const textPreview=await session.preview(remaining,new Set(remaining.changes.map((_,i)=>i)));
    await write(wechatPath,(await adapter.read(wechatPath))+"\nconcurrent");
    await assert.rejects(()=>session!.commit([textPreview],()=>{}),/已变化/);
    session.dispose();
    await write(wechatPath,unchanged);
    session=await DraftSyncSession.create(plugin,native);
    const one=session.targets.find(t=>t.location.platform.id==="zhihu")!;
    const imagePreview=await session.preview(one,new Set(one.changes.flatMap((c,i)=>c.imagesOnly?[i]:[])));
    await fs.writeFile(path.join(repo,"source/img/new.png"),Buffer.from("changed"));
    await assert.rejects(()=>session!.commit([imagePreview],()=>{}),/图片在预览后/);
    await fs.writeFile(path.join(repo,"source/img/new.png"),png);
    await assert.rejects(()=>session!.commit([imagePreview],()=>{throw new Error("cancelled");}),/cancelled/);
    // A target may commit before its baseline write fails or is truncated.
    await write(wechatPath,unchanged);
    const recoverySession=await DraftSyncSession.create(plugin,native);
    const recoveryTarget=recoverySession.targets.find(t=>t.location.platform.id==="wechat")!;
    const recoveryPreview=await recoverySession.preview(recoveryTarget,new Set(recoveryTarget.changes.flatMap((c,i)=>c.status!=="already"?[i]:[])));
    const adapterWrite=adapter.write;
    adapter.write=async(p:string,text:string)=>{if(p===recoveryTarget.baselinePath){await write(p,"{truncated");throw new Error("baseline disk failure");}return adapterWrite(p,text);};
    await assert.rejects(()=>recoverySession.commit([recoveryPreview],()=>{}),/正文已保存[\s\S]*基准未完成/);
    assert.equal(await adapter.read(wechatPath),recoveryPreview.content);
    assert.equal(await adapter.exists(`${recoveryTarget.baselinePath}.pending`),true);
    adapter.write=adapterWrite;recoverySession.dispose();
    const recovered=await DraftSyncSession.create(plugin,native);
    assert.equal(recovered.targets.find(t=>t.location.platform.id==="wechat")!.changes.some(c=>c.imagesOnly&&c.status!=="already"),false);
    assert.equal(await adapter.exists(`${recoveryTarget.baselinePath}.pending`),false);recovered.dispose();
    const registry=new DraftSyncImages(app,settings,"sync-id");
    const coded="```md\n![示例](/img/missing.png)\n```\n\n![真实](/img/new.png)\n";
    const canonical=await registry.canonical(coded,{platform:hexo,path:hexoPath});
    assert.ok(canonical.body.includes("![示例](/img/missing.png)"));
    const materialized=await registry.materialize(canonical.body,{platform:wechat,path:wechatPath},{body:"",originals:new Map()},await adapter.read(".obsidian/app.json"));
    assert.ok(materialized.body.includes("![示例](/img/missing.png)"));
    await write("静置/附件/original.png","");await fs.writeFile(path.join(vault,"静置/附件/original.png"),png);
    const originalFile=files.get("静置/附件/original.png")!;Object.assign(originalFile,{extension:"png"});
    const cachedImage=await registry.canonical("![缓存](/img/new.png)",{platform:hexo,path:hexoPath});
    const imageHash=cachedImage.body.match(/easy-pub-sync-image:\/\/([a-f0-9]+)/)![1];
    settings.picgoImageCache["静置/附件/original.png"]={hash:imageHash,url:"https://example.com/cached.png"};
    const remote=await registry.canonical("![缓存](https://example.com/cached.png)",{platform:hexo,path:hexoPath});
    assert.equal(remote.body,cachedImage.body,"Verified PicGo cache recognizes the same local image without network access");
    await write("静置/附件/other.png","");await fs.writeFile(path.join(vault,"静置/附件/other.png"),png);
    const distinct='before\n\n![same](../../静置/附件/original.png) and ![same](../../静置/附件/other.png)\n\nafter';
    const independent=new DraftSyncImages(app,settings,"sync-id");
    const targetRefs=await independent.canonical(distinct,{platform:wechat,path:wechatPath});
    const senderRefs=await independent.canonical(distinct.replace("before","before updated"),{platform:wechat,path:wechatPath});
    const referenceChanges=reconcileChanges(targetRefs.body,senderRefs.body,targetRefs.body);
    const referenceResult=await independent.materialize(applySyncChanges(targetRefs.body,referenceChanges),{platform:wechat,path:wechatPath},targetRefs,await adapter.read(".obsidian/app.json"),referenceChanges,senderRefs);
    assert.equal(referenceResult.body,distinct.replace("before","before updated"));
    const addedRefs=await independent.canonical('![same](../../静置/附件/other.png)\n\n'+distinct,{platform:wechat,path:wechatPath});
    const addedChanges=reconcileChanges(targetRefs.body,addedRefs.body,targetRefs.body);
    const addedResult=await independent.materialize(applySyncChanges(targetRefs.body,addedChanges),{platform:wechat,path:wechatPath},targetRefs,await adapter.read(".obsidian/app.json"),addedChanges,addedRefs);
    assert.match(addedResult.body,/other\.png/);assert(addedResult.body.endsWith(distinct));
    await fs.writeFile(path.join(vault,"静置/附件/other.png"),Buffer.from("changed identical-byte sibling"));
    await assert.rejects(independent.verify(),/图片.*变化/);
    assert.equal(await fs.readFile(hexoPath,"utf8"),stringifyFrontMatter(senderBody,{pub_id:"sync-id",source_file:`[[${sourcePath}]]`}));
    assert.equal((await app.vault.read(files.get(sourcePath))).includes("新增配图"),false);
    console.log("Cross-draft sync: bounded diff, selected image deltas, conflicts, independent edits, persisted baselines, image conversion, stale guards and layout preservation passed");
  }finally{session?.dispose();await fs.rm(directory,{recursive:true,force:true});}
}
