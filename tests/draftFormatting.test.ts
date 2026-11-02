import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DraftFormatSession } from "../utils/draftFormatting";
import { normalizeSettings } from "../utils/settings";
import { getFrontMatterString, parseFrontMatter, stringifyFrontMatter } from "../utils/frontMatter";
import { writePublishedFile } from "../utils/publishFiles";
import { extractWechatBlocks } from "../utils/wechatLayoutAst";
import { anchorWechatLayout, themePlan } from "../utils/wechatLayoutEngine";

const options = {indentParagraphs:true, separateParagraphs:true};
const header = '---\npub_id: stable\nsource_file: "[[source]]"\ncustom: keep # retain this comment\n---\n';
function vaultHarness(before = header + "甲\n乙\n") {
  const file = Object.assign(new TFile(), {path:"发布/微信公众号/draft.md",extension:"md"});
  const source = Object.assign(new TFile(), {path:"source.md",extension:"md"});
  let text = before, sourceReads = 0, saves = 0, writes = 0;
  let editor = before;
  const backups = new Map<string,string>(), directories = new Set<string>();
  let onBackup: (() => void) | undefined;
  const plugin: any = {
    manifest:{id:"easy-pub",dir:".obsidian/plugins/easy-pub"}, settings:normalizeSettings(null), assertSettingsWritable:()=>{},
    app:{vault:{configDir:".obsidian",getAbstractFileByPath:(name:string)=>name===file.path?file:name===source.path?source:null,
      read:async(target:TFile)=>{if(target===source){sourceReads++;return "independent original";}return text;},
      process:async(target:TFile,fn:(current:string)=>string)=>{assert.equal(target,file);text=fn(text);writes++;},
      adapter:{exists:async(name:string)=>backups.has(name)||directories.has(name),mkdir:async(name:string)=>{directories.add(name);},
        write:async(name:string,value:string)=>{backups.set(name,value);onBackup?.();},read:async(name:string)=>backups.get(name)}},
      workspace:{getLeavesOfType:()=>[{view:{file,save:async()=>{saves++;text=editor;},getViewData:()=>editor}}]}},
    readPublishFile:async(_platform:unknown,target:string)=>{assert.equal(target,file.path);return text;},
    writePublishFile:async(_platform:unknown,target:string,next:string,expected:string,guard:()=>void,beforeCommit:()=>Promise<void>)=>{
      assert.equal(target,file.path);await beforeCommit();
      await plugin.app.vault.process(file,(current:string)=>{guard();assert.equal(current,expected);return next;});
    },
  };
  return {plugin,file,source,backups,read:()=>text,sourceReads:()=>sourceReads,saves:()=>saves,writes:()=>writes,
    edit:(value:string)=>{editor=value;},replace:(value:string)=>{text=value;},onBackup:(fn:()=>void)=>{onBackup=fn;}};
}

export async function runDraftFormattingTests() {
  const harness = vaultHarness();
  // Opening and previewing flush the bound editor but never read its original or write a draft/backup.
  const session = await DraftFormatSession.create(harness.plugin,harness.file);
  assert.equal(harness.saves(),1);
  const preview = session.preview(options);
  assert.equal(preview.content, header + "　　甲\n\n　　乙\n");
  assert.equal(harness.read(),session.before);assert.equal(harness.writes(),0);assert.equal(harness.backups.size,0);
  assert.equal(harness.sourceReads(),0);assert.equal(session.targetPath,harness.file.path);
  await session.apply(preview);
  assert.equal(harness.read(),preview.content);assert.equal(harness.backups.get(session.backupPath),session.before);
  assert.equal(harness.sourceReads(),0);assert.equal(harness.writes(),1);
  await assert.rejects(session.apply(preview),/关闭/);
  session.dispose();

  const unchanged = vaultHarness();
  const unchangedSession = await DraftFormatSession.create(unchanged.plugin,unchanged.file);
  await assert.rejects(unchangedSession.apply(unchangedSession.preview({indentParagraphs:false,separateParagraphs:false})),/符合/);
  assert.equal(unchanged.backups.size,0);assert.equal(unchanged.writes(),0);unchangedSession.dispose();

  // Guard every write path against fresh editor content, saved edits, moved files and changed settings.
  for (const mutation of ["editor","disk","path","settings"] as const) {
    const item = vaultHarness(); const bound = await DraftFormatSession.create(item.plugin,item.file);
    const planned = bound.preview(options);
    if(mutation==="editor") item.edit(bound.before+"unsaved");
    if(mutation==="disk") item.replace(bound.before+"saved elsewhere");
    if(mutation==="path") item.file.path="发布/微信公众号/renamed.md";
    if(mutation==="settings") item.plugin.settings.publishBasePath="different";
    await assert.rejects(bound.apply(planned),/编辑|变化|移动/);
    assert.equal(item.writes(),0);bound.dispose();
  }
  const closed = vaultHarness(); const closing = await DraftFormatSession.create(closed.plugin,closed.file);
  const closingPreview = closing.preview(options);
  closed.onBackup(()=>closing.dispose());
  await assert.rejects(closing.apply(closingPreview),/关闭/);
  assert.equal(closed.read(),closing.before);assert.equal(closed.backups.get(closing.backupPath),closing.before);assert.equal(closed.writes(),0);
  const cancelled = vaultHarness(); const cancellation = await DraftFormatSession.create(cancelled.plugin,cancelled.file);
  await assert.rejects(cancellation.apply(cancellation.preview(options),()=>{throw new Error("window closed");}),/window closed/);
  assert.equal(cancelled.writes(),0);assert.equal(cancelled.backups.size,0);cancellation.dispose();

  // A corrupt backup prevents modification; a preview from another session is never accepted.
  const corrupt = vaultHarness();const corruption=await DraftFormatSession.create(corrupt.plugin,corrupt.file);
  corrupt.backups.set(corruption.backupPath,"bad backup");
  await assert.rejects(corruption.apply(corruption.preview(options)),/备份校验/);assert.equal(corrupt.writes(),0);
  await assert.rejects(corruption.apply(preview),/不属于/);corruption.dispose();
  // Vault originals may have source-owned metadata or no front matter/identity at all.
  for (const originalText of ["---\ntitle: 原稿 # keep comment\npub_id: original-id\n子文件: ['[[发布/微信公众号/draft]]']\ncustom: preserve\n---\n甲\n乙\n", "甲\n乙\n"]) {
    const original = vaultHarness(originalText);original.file.path="notes/source.md";
    const originalSession=await DraftFormatSession.create(original.plugin,original.file);
    assert.equal(originalSession.platform.id,"source");assert.equal(originalSession.platform.name,"原稿");
    const originalPreview=originalSession.preview(options);
    assert.equal(originalPreview.content,originalText.replace("甲\n乙\n","　　甲\n\n　　乙\n"));
    assert.equal(originalPreview.layoutNotice,undefined);assert.equal(original.read(),originalText);assert.equal(original.writes(),0);
    await originalSession.apply(originalPreview);
    assert.equal(original.read(),originalPreview.content);assert.equal(original.backups.get(originalSession.backupPath),originalText);
    assert.equal(original.sourceReads(),0);assert.equal(original.writes(),1);originalSession.dispose();
  }
  const otherExternal=vaultHarness();otherExternal.file.path="/outside-blog/arbitrary.md";
  otherExternal.plugin.app.vault.getAbstractFileByPath=()=>null;
  await assert.rejects(DraftFormatSession.create(otherExternal.plugin,otherExternal.file),/Vault/);
  for (const [draftPath,platformId] of [["发布/知乎/文章/post.md","zhihu"],["发布/小红书/post.md","xiaohongshu"]]) {
    const sibling=vaultHarness();sibling.file.path=draftPath;
    const siblingSession=await DraftFormatSession.create(sibling.plugin,sibling.file);
    assert.equal(siblingSession.platform.id,platformId);
    const siblingPreview=siblingSession.preview(options);await siblingSession.apply(siblingPreview);
    assert.equal(sibling.read(),header+"　　甲\n\n　　乙\n");assert.equal(sibling.backups.get(siblingSession.backupPath),siblingSession.before);
    assert.equal(sibling.sourceReads(),0);siblingSession.dispose();
  }
  const noIdentity = vaultHarness("正文\n");
  await assert.rejects(DraftFormatSession.create(noIdentity.plugin,noIdentity.file),/pub_id/);
  const openingRace = vaultHarness();
  openingRace.plugin.readPublishFile=async()=>{openingRace.plugin.settings.publishBasePath="changed during read";return header+"甲\n乙\n";};
  await assert.rejects(DraftFormatSession.create(openingRace.plugin,openingRace.file),/设置已变化/);
  assert.equal(openingRace.writes(),0);

  const body="段落一\n\n> 引用\n";
  const extracted=extractWechatBlocks(body), document={hash:extracted.hash,blocks:extracted.blocks.map(block=>({...block,text:block.markdown,planningText:""}))};
  const plan=anchorWechatLayout({...themePlan(document,"paper"),blocks:[{id:document.blocks[1].id,role:"quotation",component:"quote",locked:true}]},document);
  const layoutRaw=stringifyFrontMatter(body,{pub_id:"stable",source_file:"[[source]]",custom:"keep",wechat:{layout:plan,cover:"cover.png"}});
  const layout=vaultHarness(layoutRaw);const layoutSession=await DraftFormatSession.create(layout.plugin,layout.file);
  const layoutPreview=layoutSession.preview({indentParagraphs:true,separateParagraphs:false});
  const parsed=parseFrontMatter(layoutPreview.content,true);
  assert.match(layoutPreview.layoutNotice!,/保留主题/);
  assert.equal(parsed.content,"　　段落一\n\n> 引用\n");
  const wechat=parsed.data.wechat as any;
  assert.equal(wechat.layout.theme,"paper");assert.equal(wechat.cover,"cover.png");assert.equal(parsed.data.custom,"keep");
  assert.equal(wechat.layout.blocks.length,1);assert.equal(wechat.layout.blocks[0].locked,true);
  assert.equal(wechat.layout.documentHash,extractWechatBlocks(parsed.content).hash);assert.equal(wechat.layoutHistory.length,1);
  await layoutSession.apply(layoutPreview);assert.equal(layout.backups.get(layoutSession.backupPath),layoutSession.before);layoutSession.dispose();

  // Native external Hexo and mapped Vault paths use the exact associated file, keeping draft status/metadata.
  const directory=await mkdtemp(path.join(os.tmpdir(),"ep-draft-format-"));
  try {
    const target=path.join(directory,"source/_drafts/nested/post.md");await mkdir(path.dirname(target),{recursive:true});
    const raw='---\npub_id: external\nsource_file: "[[source]]"\nabbrlink: ab12\nworkflow: draft\n---\n甲\n乙\n';
    await writeFile(target,raw);
    const file=Object.assign(new TFile(),{path:`file://${target}`,extension:"md"});
    const plugin:any={manifest:{id:"easy-pub"},settings:normalizeSettings({hexoRepoPath:directory}),assertSettingsWritable:()=>{},
      app:{vault:{configDir:".obsidian",adapter:{getFullPath:(name:string)=>name==="mapped.md"?target:name}},workspace:{getLeavesOfType:()=>[]}},
      readPublishFile:async(_platform:unknown,name:string)=>readFile(name,"utf8"),
      writePublishFile:async(_platform:unknown,name:string,next:string,expected:string,guard:()=>void,beforeCommit:()=>Promise<void>)=>
        writePublishedFile(name,next,expected,path.join(directory,".easy-pub-backups"),guard,beforeCommit)};
    const external=await DraftFormatSession.create(plugin,file);assert.equal(external.targetPath,target);assert.equal(external.platform.id,"hexo");
    const formatted=external.preview(options);await external.apply(formatted);
    assert.equal(await readFile(target,"utf8"),formatted.content);assert.equal(await readFile(external.backupPath,"utf8"),raw);
    assert.equal(getFrontMatterString(parseFrontMatter(formatted.content).data,"abbrlink"),"ab12");
    assert.equal(parseFrontMatter(formatted.content).data.workflow,"draft");
    assert.deepEqual(await readdir(path.dirname(target)),["post.md"]);external.dispose();
    file.path="mapped.md";const mapped=await DraftFormatSession.create(plugin,file);assert.equal(mapped.targetPath,target);mapped.dispose();
    file.path=`file://${target}`;await writeFile(target,raw);const stale=await DraftFormatSession.create(plugin,file);
    const stalePreview=stale.preview(options);await writeFile(target,"External edit");
    await assert.rejects(stale.apply(stalePreview),/变化/);assert.equal(await readFile(target,"utf8"),"External edit");stale.dispose();
  } finally {await rm(directory,{recursive:true,force:true});}
  console.log("Draft formatting: originals/all platform drafts, real fullwidth indent, previews, recoverable backups, editor/disk/path/settings/cancel guards and WeChat layout preservation passed");
}
