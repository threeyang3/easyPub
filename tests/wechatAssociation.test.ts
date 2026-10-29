import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateWechatArticleUrl } from "../utils/wechatArticleUrl";
import { AssociationIO, patchAssociation, prepareAssociation, patchWechatDraftAssociation } from "../utils/wechatAssociation";
import { writePublishedFile } from "../utils/publishFiles";
import { parseFrontMatter, mergePublishedFrontMatter } from "../utils/frontMatter";
import { readWechatArticleSettings } from "../utils/wechatState";
import EasyPub from "../main";
import { DEFAULT_SETTINGS, PLATFORMS } from "../types";
import { legacyPropertyKeys } from "../utils/articleProperties";

export async function runWechatAssociationTests() {
  const url = "https://mp.weixin.qq.com/s/test_Article-123";
  assert.equal(validateWechatArticleUrl(url),url);
  assert.equal(validateWechatArticleUrl("https://mp.weixin.qq.com/s?__biz=x&mid=1&idx=1&sn=a&chksm=b"),"https://mp.weixin.qq.com/s?__biz=x&mid=1&idx=1&sn=a&chksm=b");
  for (const bad of ["http://mp.weixin.qq.com/s/a","https://mp.weixin.qq.com.evil.test/s/a","https://mp.weixin.qq.com@evil.test/s/a","https://user@mp.weixin.qq.com/s/a","https://mp.weixin.qq.com:443/s/a","https://mp.weixin.qq.com/s/../admin","https://mp.weixin.qq.com\\@evil.test/s/a","https://mp.weixin.qq.com/s?mid=1","javascript:alert(1)","https://mp.weixin.qq.com/s/a#b", "https://mp.weixin.qq.com/s/a\n", "https://mp.weixin.qq.com/s/"+"a".repeat(2048), "https://mp.weixin.qq.com/s/a?q="+"文".repeat(250)]) assert.throws(()=>validateWechatArticleUrl(bad),bad);
  const noNewline = '---\npub_id: stable\nwechat:\n  sourceUrl: https://example.com\n  custom: keep\n---\nBody without final newline';
  for (const value of [{publishedUrl:url,commentsEnabled:false},{}]) {
    assert.equal(parseFrontMatter(patchWechatDraftAssociation(noNewline,value)).content,parseFrontMatter(noNewline).content);
    assert.equal(parseFrontMatter(patchAssociation(noNewline,value)).content,parseFrontMatter(noNewline).content);
    assert.equal((parseFrontMatter(patchWechatDraftAssociation(noNewline,value)).data.wechat as Record<string,unknown>).sourceUrl,'https://example.com');
    assert.equal((parseFrontMatter(patchWechatDraftAssociation(noNewline,value)).data.wechat as Record<string,unknown>).custom,'keep');
  }
  const original = `---\npub_id: stable\ntitle: same title\nabbrlink: ab12\ncustom:\n  nested: keep\n---\n# Body\n`;
  const linked = patchAssociation(original,{publishedUrl:url,commentsEnabled:false});
  assert.equal(parseFrontMatter(linked).data.wechat_comments_enabled,false);
  const detached = parseFrontMatter(patchAssociation(linked,{}));
  assert.deepEqual(detached.data,parseFrontMatter(original).data);
  assert.equal(detached.content,parseFrontMatter(original).content);
  assert(!legacyPropertyKeys("hexo",parseFrontMatter(linked).data).includes("wechat_article_url"));
  const refreshed = mergePublishedFrontMatter({platformId:"hexo",sourceData:{title:"new"},existingData:parseFrontMatter(linked).data,pubId:"stable",sourceFileLink:"new name",timestamp:"now"});
  assert.equal(refreshed.wechat_article_url,url);
  const settings = readWechatArticleSettings({sourceUrl:"https://example.com",publishedUrl:url,commentsEnabled:false});
  assert.equal(settings.publishedUrl,url); assert.equal(settings.commentsEnabled,false); assert.equal(settings.sourceUrl,"https://example.com");
  const root = await mkdtemp(path.join(os.tmpdir(),"ep-association-"));
  try {
    const posts=path.join(root,"source/_posts"), drafts=path.join(root,"source/_drafts/nested");
    await mkdir(posts,{recursive:true});await mkdir(drafts,{recursive:true});
    const plugin = Object.assign(Object.create(EasyPub.prototype),{settings:{...DEFAULT_SETTINGS,hexoRepoPath:root}});
    const sourceFile = {path:"source-renamed.md",basename:"source-renamed"};
    const updated = await plugin.buildPublishedFrontMatter({...PLATFORMS.find(p=>p.id==="hexo"),autoUrl:false},sourceFile,{},linked,"stable","now",path.join(drafts,"renamed.md"),{title:"Changed title"});
    assert.equal(updated.wechat_article_url,url); assert.equal(updated.wechat_comments_enabled,false);
    const wechatRaw = `---\npub_id: stable\nwechat:\n  publishedUrl: ${url}\n  commentsEnabled: false\n  sourceUrl: https://example.com/original\n---\nLocal body`;
    const wechatUpdate = await plugin.buildPublishedFrontMatter(PLATFORMS.find(p=>p.id==="wechat"),sourceFile,{},wechatRaw,"stable","now","local.md",{title:"Changed",wechat:{sourceUrl:"https://example.com/new"}});
    assert.equal(wechatUpdate.wechat.publishedUrl,url); assert.equal(wechatUpdate.wechat.commentsEnabled,false);
    assert.equal(wechatUpdate.wechat.sourceUrl,"https://example.com/new");
    const target=path.join(drafts,"renamed.md"), unrelated=path.join(posts,"same-title.md");
    await writeFile(target,original);await writeFile(unrelated,original.replace("stable","unrelated"));
    const list = async (directory:string):Promise<string[]> => {
      const result:string[]=[];
      for (const entry of await readdir(directory,{withFileTypes:true})) {
        const file=path.join(directory,entry.name);
        if(entry.isDirectory())result.push(...await list(file));else if(entry.isFile())result.push(file);
      } return result;
    };
    const io:AssociationIO={publishDirectoryExists:async()=>true,listPublishFiles:async(_,dir)=>list(dir),readPublishFile:async(_,file)=>readFile(file,"utf8"),writePublishFile:async(_,file,content,expected,guard,before)=>writePublishedFile(file,content,expected,path.join(root,"backups"),guard,before)};
    const plan=await prepareAssociation(io,root,"stable",{publishedUrl:url});assert.equal(plan.path,target);
    await plan.commit(()=>{},async()=>{});
    assert.equal(parseFrontMatter(await readFile(target,"utf8")).data.wechat_article_url,url);
    assert.equal(await readFile(unrelated,"utf8"),original.replace("stable","unrelated"));
    assert.equal((await readdir(path.join(root,"backups"))).length,1);
    await assert.rejects(()=>prepareAssociation(io,root,"missing",{}),/未找到/);
    await writeFile(path.join(posts,"duplicate.md"),original);
    await assert.rejects(()=>prepareAssociation(io,root,"stable",{}),/多个/);
    await rm(path.join(posts,"duplicate.md"));
    const stale=await prepareAssociation(io,root,"stable",{});await writeFile(target,linked+"concurrent");
    await assert.rejects(()=>stale.commit(()=>{},async()=>{}),/变化|修改/);
    assert.equal(await readFile(target,"utf8"),linked+"concurrent");
    const failed=await prepareAssociation(io,root,"stable",{});
    await assert.rejects(()=>failed.commit(()=>{},async()=>{throw new Error("local changed");}),/local changed/);
    assert.equal(await readFile(target,"utf8"),linked+"concurrent");
    const dupRace=await prepareAssociation(io,root,"stable",{});await writeFile(path.join(posts,"duplicate.md"),original);
    await assert.rejects(()=>dupRace.commit(()=>{},async()=>{}),/多个/);
    await rm(path.join(posts,"duplicate.md"));
    const moved = path.join(posts,"new-filename.md"); await rename(target,moved);
    const afterMove = await prepareAssociation(io,root,"stable",{}); assert.equal(afterMove.path,moved);
    await afterMove.commit(()=>{},async()=>{});
    assert.equal(parseFrontMatter(await readFile(moved,"utf8")).data.wechat_article_url,undefined);
    assert.equal(parseFrontMatter(await readFile(moved,"utf8")).data.abbrlink,"ab12");
  } finally {await rm(root,{recursive:true,force:true});}
  console.log("WeChat association: URL boundaries, stable identity, duplicates, backups, concurrent writes, failure recovery and metadata preservation passed");
}
