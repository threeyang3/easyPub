import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TFile } from "obsidian";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import os from "os";
import path from "path";
import EasyPub from "../main";
import { normalizeSettings } from "../utils/settings";
import { parseFrontMatter, stringifyFrontMatter } from "../utils/frontMatter";
import { exportWechatHexoContent, exportWechatHexoMarkdown } from "../utils/wechatHexoContent";
import { WECHAT_HTML_LIMIT_ISSUE } from "../utils/wechatLimits";
import { parseWechatMarkdown, MarkdownNode } from "../utils/wechatMarkdown";
import { applyWechatLayout, themePlan } from "../utils/wechatLayoutEngine";
import { wechatHash } from "../utils/wechatHash";
import type { WechatPreparedDocument } from "../types";
import { micromark } from "micromark";

export async function runWechatHexoTests() {
  const dom = new JSDOM("<!doctype html>");
  const previous = {DOMParser:globalThis.DOMParser};
  globalThis.DOMParser = dom.window.DOMParser;
  const directory = await mkdtemp(path.join(os.tmpdir(), "ep-wechat-hexo-"));
  try {
    const element = dom.window.document.createElement("section");
    element.innerHTML = '<h2>公众号标题</h2><p>公众号独立编辑的正文</p><blockquote><p>卡片与引用</p></blockquote><pre><code><span>  {% endraw %} {{ title }}</span><br>\n<span>  next()</span></code></pre>';
    const plan = themePlan({hash:"0".repeat(64),blocks:[]}, "paper", "preset");
    applyWechatLayout(element as any,{hash:"0".repeat(64),blocks:[]},[],plan);
    const bytes = new Uint8Array([137,80,78,71,1,2,3]); const hash = wechatHash(bytes);
    const img = dom.window.document.createElement("img");img.src=`easy-pub-image://${hash}`;img.style.margin="22px auto"; element.append(img);
    const image = {source:"../../assets/cover.png",localPath:"assets/cover.png",bytes,hash,originalHash:hash,mime:"image/png",width:100,height:80,previewUrl:"blob:test",originalSize:bytes.length};
    const document: WechatPreparedDocument = {html:element.outerHTML, images:[image], issues:[]};
    const result = exportWechatHexoContent(document, () => "/sub/picture/test.png");
    assert.match(result.body, /^\{% raw %\}/); assert.match(result.body, /\{% endraw %\}\n$/);
    assert.equal(result.body.match(/\{% endraw %\}/g)?.length,1);
    assert.match(result.body, /&#123;% endraw %&#125;/);
    const exported = new dom.window.DOMParser().parseFromString(result.html, "text/html");
    assert.equal(exported.querySelector("h2")?.textContent,"公众号标题");
    assert.equal(exported.querySelector("pre")?.textContent, element.querySelector("pre")?.textContent);
    assert.equal(exported.querySelector("img")?.getAttribute("src"),"/sub/picture/test.png");
    assert.equal((exported.querySelector("section") as HTMLElement).style.getPropertyPriority("background"),"important");
    assert.equal((exported.querySelector("section") as HTMLElement).style.background,(element as HTMLElement).style.background);
    assert.throws(()=>exportWechatHexoContent({...document,issues:["missing image"]},()=>"/image.png"),/修复/);
    assert.throws(()=>exportWechatHexoContent({...document,html:'<section><script>alert(1)</script></section>'},()=>"/image.png"),/不支持/);
    assert.throws(()=>exportWechatHexoContent({...document,images:[]},()=>"/image.png"),/图片/);
    const markdownBody = '## 本地稿标题\n\n　　公众号本地稿，保留 **Markdown**。\n\n![标准图片](../../assets/cover.png)\n\n![引用图片][cover]\n\n[cover]: ../../assets/cover.png\n\n![[assets/cover.png]]\n\n```md\n![代码图片](missing.png)\n![[missing.png]]\n```\n\n`![行内代码](missing.png)`\n';
    const markdownExport = await exportWechatHexoMarkdown(markdownBody, async () => "/blog/image.png");
    assert.match(markdownExport,/## 本地稿标题/);assert.match(markdownExport,/　　公众号本地稿，保留 \*\*Markdown\*\*。/);
    assert.match(markdownExport,/!\[标准图片\]\(\/blog\/image.png\)/);
    assert.match(markdownExport,/!\[引用图片\]\(\/blog\/image.png\)/);
    assert.match(markdownExport,/```md\n!\[代码图片\]\(missing.png\)\n!\[\[missing.png\]\]\n```/);
    assert.match(markdownExport,/`!\[行内代码\]\(missing.png\)`/);
    assert.doesNotMatch(markdownExport,/<img|style=|easy-pub-wechat-layout|\{% raw/);
    const localInline = String.raw`![本地行内](assets/cover.png "本地说明 \"引号\"")`;
    const remoteInline = `![远程行内]( <https://example.com/a)b.png>  '远程说明' )`;
    const remoteReference = "![远程引用][REMOTE]";
    const remoteDefinition = '[REMOTE]: <https://example.com/reference.png> "远程引用说明"';
    const titledImages = [localInline, '![本地引用][LOCAL]', '[LOCAL]: assets/cover.png \'本地引用说明\'',
      remoteInline, remoteReference, remoteDefinition].join("\n\n");
    const imageCopies: string[] = [];
    const withTitles = await exportWechatHexoMarkdown(titledImages, async source => {imageCopies.push(source);return "/picture/copied.png";});
    assert.deepEqual(imageCopies,["assets/cover.png","assets/cover.png"]);
    assert(withTitles.includes(remoteInline));assert(withTitles.includes(remoteReference));assert(withTitles.includes(remoteDefinition));
    const localImages: MarkdownNode[] = [];
    const collectImages = (node: MarkdownNode) => {if(node.type === "image" && node.url === "/picture/copied.png")localImages.push(node);node.children?.forEach(collectImages);};
    collectImages(parseWechatMarkdown(withTitles));
    assert.deepEqual(localImages.map(({alt,title})=>({alt,title})),[
      {alt:"本地行内",title:'本地说明 "引号"'}, {alt:"本地引用",title:"本地引用说明"}]);
    // Decoded alt/title strings cannot be inserted as fresh Markdown: escapes and
    // entities would be interpreted again, changing what screen readers receive.
    for (const original of [
      String.raw`![\*literal emphasis\*](assets/cover.png)`,
      '![literal \\`backticks\\`](assets/cover.png)',
      '![literal &amp;copy; and \\&copy;](assets/cover.png "&amp;copy;")',
      '![*formatted* and **strong**](assets/cover.png "*literal title*")',
      '![outer [nested] and `]` label](assets/cover.png)',
      '![<span title="]">label</span>](assets/cover.png)',
      '![unmatched ` and *formatted*](assets/cover.png)',
      String.raw`![\*reference\*][escaped]` + '\n\n[escaped]: assets/cover.png "&amp;copy;"',
    ]) {
      const rewritten = await exportWechatHexoMarkdown(original, async () => "/picture/copied.png");
      const attributes = (markdown: string) => {
        const img = new dom.window.DOMParser().parseFromString(micromark(markdown), "text/html").querySelector("img");
        assert(img, `Fixture must render an image: ${markdown}`);
        return {alt:img.getAttribute("alt"), title:img.getAttribute("title")};
      };
      assert.deepEqual(attributes(rewritten), attributes(original), original);
      assert.match(rewritten, /\/picture\/copied\.png/);
    }
    const source = Object.assign(new TFile(),{path:"source.md",basename:"source",extension:"md"});
    const draft = Object.assign(new TFile(),{path:"发布/微信公众号/local.md",basename:"local",extension:"md"});
    const attachment = Object.assign(new TFile(),{path:"assets/cover.png",basename:"cover",extension:"png"});
    const originals = new Map<any,string>([[source,'---\npub_id: stable\ntitle: Original title\ntags: [source-tag]\n---\nOriginal source stays independent'],[draft,'---\npub_id: stable\nsource_file: "[[source]]"\n---\n'+markdownBody]]);
    await writeFile(path.join(directory,"_config.yml"),"url: https://blog.example/sub/\npermalink: posts/:abbrlink/\n");
    // Minimal compatible Control Room markers exercise required metadata and stable abbrlink.
    await mkdir(path.join(directory,"admin"));await writeFile(path.join(directory,"admin/server.js"),"");
    await writeFile(path.join(directory,"package.json"),JSON.stringify({scripts:{gui:"node admin/server.js"}}));
    const app: any = {vault:{getAbstractFileByPath:(name:string)=>[source,draft,attachment].find(file=>file.path===name),
      getMarkdownFiles:()=>[source,draft],read:async(file:any)=>originals.get(file),readBinary:async()=>bytes.slice().buffer},
      metadataCache:{getFirstLinkpathDest:(link:string)=>link==="source"?source:null},
      workspace:{getLeavesOfType:()=>[]},fileManager:{processFrontMatter:async(file:any,fn:any)=>{const parsed=parseFrontMatter(originals.get(file)!);fn(parsed.data); originals.set(file,stringifyFrontMatter(parsed.content,parsed.data));}}};
    const plugin = Object.assign(Object.create(EasyPub.prototype),{app,settings:{...normalizeSettings(null),hexoRepoPath:directory,autoDeploy:true},openPublishedFile:async()=>{},deployToHexo:async()=>{throw new Error("must not deploy");}});
    const input = {snapshot:originals.get(draft)!,document,cover:image,article:{title:"Wechat title",author:"Wechat author",digest:"Wechat digest"},assertFresh:async()=>{}};
    const collision = path.join(directory,"source/_drafts/Wechat title.md");
    await mkdir(path.dirname(collision), {recursive:true});
    await writeFile(collision,"---\npub_id: unrelated\ntitle: Wechat title\n---\nOther article");
    const markdown = await plugin.prepareHexoFromWechat(draft,{...input,cover:undefined,
      document:{...document,html:'<section>layout preview is independent</section>',issues:[WECHAT_HTML_LIMIT_ISSUE]}});
    assert.equal(markdown.mode,"markdown");
    assert.match(parseFrontMatter(markdown.diff.sourceContent).content,/公众号本地稿，保留 \*\*Markdown\*\*/);
    assert.doesNotMatch(markdown.diff.sourceContent,/公众号独立编辑的正文|Original source stays independent|<section|style=|<link|\{% raw/);
    assert.match(markdown.diff.sourceContent,/!\[标准图片\]\(\/sub\/picture\/easy-pub\/stable\//);
    assert.equal(markdown.diff.assets?.length,1);assert.equal(markdown.diff.assets?.some((asset:any)=>asset.targetPath.endsWith('.css')),false);
    assert.deepEqual(markdown.diff.assets?.[0].bytes,bytes);
    assert.equal(markdown.preview,parseFrontMatter(markdown.diff.sourceContent).content.trimEnd()+"\n");
    await markdown.assertFresh();
    await assert.rejects(readFile(markdown.diff.targetPath),/ENOENT/);
    const prepared = await plugin.prepareHexoFromWechat(draft,input,"layout");
    assert.equal(prepared.mode,"layout");
    assert.notEqual(prepared.diff.targetPath,collision);
    assert.match(prepared.diff.targetPath,/[_]drafts/);assert.equal(prepared.diff.isNew,true);
    const meta=parseFrontMatter(prepared.diff.sourceContent).data;
    assert.equal(meta.title,"Wechat title");assert.equal(meta.source_file,"[[source]]");
    assert.equal(meta.author,"Wechat author");assert.deepEqual(meta.tags,["source-tag"]);
    assert.match(meta.publish_url as string,/https:\/\/blog.example\/sub\/posts\/[a-f0-9]+\//);
    assert.match(meta.cover as string,/^\/sub\/picture\/easy-pub\/stable\//);
    assert.equal(prepared.diff.assets?.length,2);assert.notEqual(prepared.diff.assets?.[0].bytes,bytes);
    assert.match(prepared.diff.sourceContent,/公众号独立编辑/);
    assert.doesNotMatch(prepared.diff.sourceContent,/Original source stays independent/);
    const target=prepared.diff.targetPath;
    const duplicate = path.join(directory,"source/_drafts/duplicate.md");
    await writeFile(duplicate, "---\npub_id: stable\n---\nCompeting draft");
    await assert.rejects(prepared.assertFresh(), /匹配关系|多个/);await rm(duplicate);
    // Preparation/cancellation creates no files.
    await assert.rejects(readFile(target),/ENOENT/);
    originals.set(draft,input.snapshot+"changed");await assert.rejects(prepared.assertFresh(),/已变化/);originals.set(draft,input.snapshot);
    await writeFile(path.join(directory,"_config.yml"),"url: https://changed.example\n");await assert.rejects(prepared.assertFresh(),/已变化/);
    await writeFile(path.join(directory,"_config.yml"),"url: https://blog.example/sub/\npermalink: posts/:abbrlink/\n");
    await plugin.copyAndOpenForEdit(prepared.diff,prepared.source,{beforeWrite:prepared.assertFresh,skipAutoDeploy:true});
    assert.equal(await readFile(target,"utf8"),prepared.diff.sourceContent);
    assert.doesNotMatch(prepared.diff.sourceContent, /<style>/);
    const cssAsset = prepared.diff.assets!.find((asset: any) => asset.targetPath.endsWith(".css"))!;
    assert.match(await readFile(cssAsset.targetPath,"utf8"), /content:none!important/);
    assert.deepEqual(new Uint8Array(await readFile(prepared.diff.assets![0].targetPath)),bytes);
    assert.equal(originals.get(draft),input.snapshot); // WeChat draft and its layout are unchanged.
    assert.match(parseFrontMatter(originals.get(source)!).content,/Original source stays independent/);
    const stored = parseFrontMatter(await readFile(target,"utf8"));
    Object.assign(stored.data,{title:"Local blog title",abbrlink:"b123",categories:["local"],custom:"keep",wechat_article_url:"https://mp.weixin.qq.com/s/published"});
    await writeFile(target,stringifyFrontMatter("Independent blog body",stored.data));
    const update = await plugin.prepareHexoFromWechat(draft,input,"layout");
    assert.equal(update.diff.targetPath,target);assert.equal(update.diff.isNew,false);
    const updateMeta=parseFrontMatter(update.diff.sourceContent).data;
    for(const key of ["title","abbrlink","categories","custom","wechat_article_url"])assert.deepEqual(updateMeta[key],stored.data[key]);
    await plugin.copyAndOpenForEdit(update.diff,update.source,{beforeWrite:update.assertFresh,skipAutoDeploy:true});
    assert((await readdir(path.join(directory,".easy-pub-backups"))).length>0);
    const markdownUpdate = await plugin.prepareHexoFromWechat(draft,input);
    assert.equal(markdownUpdate.diff.targetPath,target);
    assert.equal(parseFrontMatter(markdownUpdate.diff.sourceContent).data.abbrlink,"b123");
    await plugin.copyAndOpenForEdit(markdownUpdate.diff,markdownUpdate.source,{beforeWrite:markdownUpdate.assertFresh,skipAutoDeploy:true});
    assert.match(await readFile(target,"utf8"),/公众号本地稿，保留 \*\*Markdown\*\*/);
    assert.doesNotMatch(parseFrontMatter(await readFile(target,"utf8")).content,/style=|<link|\{% raw/);
    assert.equal(originals.get(draft),input.snapshot);
    const stale = await plugin.prepareHexoFromWechat(draft,input);await writeFile(target,"External edit");
    await assert.rejects(()=>plugin.copyAndOpenForEdit(stale.diff,stale.source,{beforeWrite:stale.assertFresh,skipAutoDeploy:true}),/变化|修改/);
    assert.equal(await readFile(target,"utf8"),"External edit");
    console.log("WeChat to Hexo: Markdown/layout modes, local body and code fidelity, image copies, identity, backups, independent source and stale-write guards passed");
  } finally {globalThis.DOMParser=previous.DOMParser;dom.window.close();await rm(directory,{recursive:true,force:true});}
}
