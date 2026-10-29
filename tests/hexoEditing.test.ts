import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TFile } from "obsidian";
import { hexoEditorPath } from "../utils/platforms";
import { movePasteRange, openHexoInObsidian, pasteHexoImages } from "../utils/hexoEditing";
import EasyPub from "../main";
import { PLATFORMS } from "../types";

export async function runHexoEditingTests() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "hexo-editing-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "hexo-editing-outside-"));
  const draft = path.join(repo, "source/_posts/article.md");
  await fs.mkdir(path.dirname(draft), {recursive:true});
  await fs.writeFile(draft, "original draft");
  await fs.writeFile(path.join(repo, "_config.yml"), "url: https://example.com/blog/\nroot: /blog/\n");
  const native = Object.assign(new TFile(), {path:`file:${draft}`, extension:"md"});
  const mapped = Object.assign(new TFile(), {path:"hexo/article.md", extension:"md"});
  let listeners = new Set<(...args: any[]) => void>(), opened = 0, revealed = 0;
  const app: any = {vault: {
    adapter:{getFullPath:(p: string) => p.startsWith("hexo/") ? path.join(repo, "source/_posts", p.slice(5)) : path.join(outside, p)},
    getFileByPath: (p: string) => p === native.path ? native : null, getFiles: () => [mapped],
  }, workspace: {
    getLeavesOfType: () => [],
    getLeaf: () => ({openFile:async (file: TFile) => {assert.ok(file === native || file === mapped); opened++;}}),
    revealLeaf:async () => {revealed++;},
    on: (_event: string, fn: (...args: any[]) => void) => {listeners.add(fn); return fn;},
    offref: (fn: (...args: any[]) => void) => listeners.delete(fn),
  }};
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=", "base64");
  const image = {type:"image/png",size:bytes.length,arrayBuffer:async () => bytes};
  const makeEditor = () => {
    let value = "prefix selected suffix";
    const editor: any = {
      getValue:() => value, getCursor:(side: string) => ({line:0,ch:side === "from" ? 7 : 15}),
      posToOffset: (p: {line:number;ch:number}) => value.split("\n").slice(0,p.line).reduce((a,b) => a+b.length+1,0)+p.ch,
      offsetToPos:(offset: number) => {const lines=value.slice(0,offset).split("\n");return {line:lines.length-1,ch:lines[lines.length-1].length};},
      replaceRange:(replacement: string, from: any, to: any) => {
        const start=editor.posToOffset(from),end=editor.posToOffset(to);
        value=value.slice(0,start)+replacement+value.slice(end);
        listeners.forEach(fn=>fn(editor));
      },
      setValue:(text: string) => {value=text;listeners.forEach(fn=>fn(editor));},
    };
    return editor;
  };
  const event = (files: any[] = [image]) => ({defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},
    clipboardData:{items:files.map(file=>({kind:"file",type:file.type,getAsFile:()=>file})),files:[]}});
  let currentRepository=repo;
  const messages: string[]=[];
  const paste = (e: any, editor: any, info: any = {file:native}) => pasteHexoImages(app,()=>currentRepository,e,editor,info,m=>messages.push(m));
  try {
    assert.equal(hexoEditorPath(app,repo,native.path),draft);
    assert.equal(hexoEditorPath(app,repo,mapped.path),draft);
    assert.equal(hexoEditorPath(app,repo,"source.md"),null);
    assert.equal(hexoEditorPath(app,repo,path.join(repo,"source/_posts-other/x.md")),null);
    await openHexoInObsidian(app,repo,draft);
    assert.equal(opened,1);
    app.workspace.getLeavesOfType=()=>[{view:{file:native}}];
    await openHexoInObsidian(app,repo,draft);
    assert.equal(opened,1);assert.equal(revealed,2);
    app.workspace.getLeavesOfType=()=>[];
    app.vault.getFileByPath=()=>null;
    await openHexoInObsidian(app,repo,draft);
    assert.equal(opened,2,"Mounted file fallback opens inside Obsidian");
    const plugin=Object.create(EasyPub.prototype) as EasyPub;
    let targetOpened="";
    Object.assign(plugin,{app,settings:{hexoRepoPath:repo},findArticleByPubId:async()=>draft,
      openPublishedFile:async(p:string)=>{targetOpened=p;},
      openHexoControlRoom:async()=>assert.fail("Opening a draft must not navigate to management")});
    app.vault.read=async()=>"---\npub_id: test\n---\nsource";
    await fs.writeFile(path.join(repo,"_config.yml"),"url: https://example.com/blog/\nroot: /blog/\n");
    await plugin.openRelatedDraft(native,PLATFORMS.find(p=>p.id==="hexo")!);
    assert.equal(targetOpened,draft);

    const editor=makeEditor(), e=event();
    const first=paste(e,editor);
    assert.equal(e.defaultPrevented,true,"Prevent native Vault attachment save synchronously");
    await first;
    assert.match(editor.getValue(),/^prefix \n!\[图片\]\(\/blog\/img\/uploads\//);
    assert.ok(editor.getValue().endsWith("\n suffix"));
    const relative=editor.getValue().match(/\(\/blog\/([^\)]+)\)/)![1];
    assert.deepEqual(await fs.readFile(path.join(repo,"source",relative)),bytes);
    const directory=path.dirname(path.join(repo,"source",relative));
    await paste(event(),makeEditor(),{file:mapped});
    assert.equal((await fs.readdir(directory)).length,1,"Repeated content reuses immutable image");
    const text=event([]), plain=makeEditor(); await paste(text,plain);
    assert.equal(text.defaultPrevented,false);
    const other=event(), ordinary=makeEditor(); await paste(other,ordinary,{file:{path:"source.md"}});
    assert.equal(other.defaultPrevented,false);
    for (const bad of [{...image,size:9*1024*1024},{...image,type:"image/svg+xml"},{...image,arrayBuffer:async()=>Buffer.from("bad")}]) {
      const editor=makeEditor(); await paste(event([bad]),editor);
      assert.equal(editor.getValue(),"prefix selected suffix");
    }
    for (const mode of ["typing","overlap","switch","settings"]) {
      let release!: (bytes: Buffer)=>void;
      const delayed={...image,arrayBuffer:()=>new Promise<Buffer>(resolve=>{release=resolve;})};
      const editor=makeEditor(),info={file:native};
      const pending=paste(event([delayed]),editor,info);
      while (!release) await new Promise(resolve=>setImmediate(resolve));
      if(mode==="typing") editor.setValue("typed "+editor.getValue());
      if(mode==="overlap") editor.setValue("prefix replacement suffix");
      if(mode==="switch") {info.file=mapped;editor.setValue("another article");}
      if(mode==="settings") currentRepository=outside;
      release(bytes);await pending;
      if(mode==="typing") assert.ok(editor.getValue().startsWith("typed prefix \n![图片]"));
      else assert.equal(editor.getValue().includes("![图片]"),false,mode);
      currentRepository=repo;
    }
    assert.equal(listeners.size,0,"Temporary change listeners are released");
    await fs.writeFile(path.join(outside,"escape.md"),"outside");
    await fs.symlink(path.join(outside,"escape.md"),path.join(repo,"source/_posts/escape.md"));
    await assert.rejects(()=>openHexoInObsidian(app,repo,path.join(repo,"source/_posts/escape.md")),/超出/);
    assert.equal(await fs.readFile(draft,"utf8"),"original draft","Paste does not write Markdown behind the editor");
    assert.deepEqual(movePasteRange("abc","Xabc",1,2),{from:2,to:3});
    assert.equal(movePasteRange("abc","aZc",1,2),null);
    console.log("Hexo editor: native/mounted opening, sidebar routing, image bytes, deduplication, paste selection, failures, concurrent edits and stale guards passed");
  } finally {await fs.rm(repo,{recursive:true,force:true});await fs.rm(outside,{recursive:true,force:true});}
}
