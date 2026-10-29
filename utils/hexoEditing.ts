import { App, Editor, MarkdownFileInfo, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { hexoEditorPath, hexoPastedImagePath, isWithinPath } from "./platforms";
import { getHexoRootPath } from "./linkUtils";
import { writeImmutableAsset } from "./publishFiles";

async function assertDraft(repository: string, target: string) {
  const [root, actual] = await Promise.all([fs.realpath(repository), fs.realpath(target)]);
  if (!["_posts", "_drafts"].some(folder => isWithinPath(path.join(root, "source", folder), actual))) {
    throw new Error("Hexo 稿件路径超出博客文章目录");
  }
}

/** One lazy path index per Vault; typing never enumerates all Vault files. */
class ExternalFiles {
  private paths?:Map<string,TFile>;
  constructor(private app:App){}
  invalidate(){this.paths=undefined;}
  find(absolute:string):TFile|null {
    const native=this.app.vault.getFileByPath?.(`file:${absolute.replace(/\\/g,"/")}`);
    if(native instanceof TFile)return native;
    const adapter=this.app.vault.adapter as unknown as {getFullPath?(p:string):string};
    if(!adapter.getFullPath)return null;
    if(!this.paths) {
      this.paths=new Map();
      for(const file of this.app.vault.getFiles())try{this.paths.set(path.resolve(adapter.getFullPath(file.path)),file);}catch{/* Unmapped files have no external path. */}
    }
    const file=this.paths.get(path.resolve(absolute));
    try{return file&&path.resolve(adapter.getFullPath(file.path))===path.resolve(absolute)?file:null;}catch{return null;}
  }
}
const externalFiles=new WeakMap<App,ExternalFiles>();
function filesFor(app:App){let files=externalFiles.get(app);if(!files){files=new ExternalFiles(app);externalFiles.set(app,files);}return files;}

export async function openHexoInObsidian(app: App, repository: string, target: string): Promise<void> {
  if (!hexoEditorPath(app, repository, target)) throw new Error("请选择博客文章目录中的 Markdown 发布稿");
  await assertDraft(repository, target);
  const existing = app.workspace.getLeavesOfType("markdown").find(leaf =>
    (leaf.view as MarkdownView).file && hexoEditorPath(app, repository, (leaf.view as MarkdownView).file!.path) === path.resolve(target));
  if (existing) { await app.workspace.revealLeaf(existing); return; }
  const file = filesFor(app).find(target);
  if (!file) throw new Error("当前 Obsidian 无法打开外部文件，请升级 Obsidian，或通过 FolderBridge 挂载博客文章目录");
  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(file, { state: { mode: "source", source: false } });
  await app.workspace.revealLeaf(leaf);
}

/** Track the selected range through edits while bytes are being saved. Overlapping edits cancel insertion. */
export function movePasteRange(before: string, after: string, from: number, to: number): {from: number; to: number} | null {
  let start = 0, oldEnd = before.length, newEnd = after.length;
  while (start < oldEnd && start < newEnd && before[start] === after[start]) start++;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  if (start === oldEnd && start === newEnd) return {from, to};
  if (oldEnd <= from) return {from: from + newEnd - oldEnd, to: to + newEnd - oldEnd};
  if (start >= to) return {from, to};
  return null;
}

function imageExtension(bytes: Buffer, declared: string): string {
  const valid: Record<string, [string, boolean]> = {
    "image/png": ["png", bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))],
    "image/jpeg": ["jpg", bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255],
    "image/gif": ["gif", ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())],
    "image/webp": ["webp", bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"],
  };
  if (!valid[declared]) throw new Error("粘贴图片支持 PNG、JPEG、GIF 和 WebP");
  if (!valid[declared][1]) throw new Error("剪贴板图片内容与格式不一致");
  return valid[declared][0];
}

export async function pasteHexoImages(app: App, repository: () => string, event: ClipboardEvent, editor: Editor,
  info: MarkdownFileInfo, notify: (message: string) => void = message => { new Notice(message); }): Promise<void> {
  if (event.defaultPrevented || !info.file || !event.clipboardData) return;
  const repo = repository(), file = info.file, filePath = file.path;
  const draft = hexoEditorPath(app, repo, filePath);
  if (!draft) return;
  const items = Array.from(event.clipboardData.items ?? []).filter(item => item.kind === "file" && item.type.startsWith("image/"));
  const files = items.length ? items.map(item => item.getAsFile()).filter((file): file is File => !!file)
    : Array.from(event.clipboardData.files ?? []).filter(file => file.type.startsWith("image/"));
  if (!files.length) return;
  event.preventDefault(); // Must run before the first await, preventing the Vault's attachment handler.
  let text = editor.getValue(), range: {from: number; to: number} | null = {
    from: editor.posToOffset(editor.getCursor("from")), to: editor.posToOffset(editor.getCursor("to")),
  };
  const updateRange = () => {
    if (info.file !== file || file.path !== filePath) { range = null; return; }
    const next = editor.getValue();
    if (range) range = movePasteRange(text, next, range.from, range.to);
    text = next;
  };
  const ref = app.workspace.on("editor-change", changed => { if (changed === editor) updateRange(); });
  const links: string[] = [], failures: string[] = [];
  try {
    await assertDraft(repo, draft);
    const root = await getHexoRootPath(repo);
    for (const file of files) {
      try {
        if (!file.size || file.size > 8 * 1024 * 1024) throw new Error("单张粘贴图片不能为空且不能超过 8 MB");
        notify("正在保存图片到博客目录…");
        const bytes = Buffer.from(await file.arrayBuffer());
        if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error("单张粘贴图片不能为空且不能超过 8 MB");
        const extension = imageExtension(bytes, file.type);
        const hash = createHash("sha256").update(bytes).digest("hex");
        if (repo !== repository()) throw new Error("博客配置已变化，请重新粘贴");
        await assertDraft(repo, draft);
        const destination = hexoPastedImagePath(repo, hash, extension);
        // Validate the nearest existing ancestor before mkdir, then the created directory before writing.
        let ancestor = path.dirname(destination);
        while (true) {
          try {
            if (!isWithinPath(await fs.realpath(repo), await fs.realpath(ancestor))) throw new Error("图片目录超出博客仓库");
            break;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            ancestor = path.dirname(ancestor);
          }
        }
        await fs.mkdir(path.dirname(destination), {recursive: true});
        if (!isWithinPath(await fs.realpath(repo), await fs.realpath(path.dirname(destination)))) throw new Error("图片目录超出博客仓库");
        await writeImmutableAsset(destination, bytes, hash);
        const url = root + path.relative(path.join(repo, "source"), destination).split(path.sep).map(encodeURIComponent).join("/");
        links.push(`![图片](${url})`);
      } catch (error) { failures.push((error as Error).message); }
    }
    updateRange();
    if (links.length && range && repo === repository()) {
      editor.replaceRange(`\n${links.join("\n")}\n`, editor.offsetToPos(range.from), editor.offsetToPos(range.to));
      notify(`已保存并插入 ${links.length} 张图片${failures.length ? `；${failures.join("；")}` : ""}`);
    } else if (links.length) notify(`已保存 ${links.length} 张图片到博客素材目录；稿件或粘贴位置已变化，请从素材库插入`);
    else if (failures.length) notify(failures.join("；"));
  } finally { app.workspace.offref(ref); }
}

/** Resolve only newly inserted images or changed src attributes, with a lazy Vault path index. */
export function registerHexoEditing(plugin: Plugin, repository: () => string) {
  const app = plugin.app, files=filesFor(app);
  plugin.registerEvent(app.workspace.on("editor-paste", (event, editor, info) => {
    void pasteHexoImages(app, repository, event, editor, info).catch(error => new Notice((error as Error).message));
  }));
  plugin.registerEvent(app.vault.on("create",()=>files.invalidate()));
  plugin.registerEvent(app.vault.on("rename",()=>files.invalidate()));
  plugin.registerEvent(app.vault.on("delete",()=>files.invalidate()));
  let context:{repo:string;version:string;value:Promise<{root:string;realRoot:string}>}|undefined;
  const configuration=async(repo:string)=>{
    const stat=await fs.stat(path.join(repo,"_config.yml"),{bigint:true});
    const version=`${stat.ino}:${stat.ctimeNs}:${stat.mtimeNs}:${stat.size}`;
    if(!context||context.repo!==repo||context.version!==version)context={repo,version,value:Promise.all([getHexoRootPath(repo),fs.realpath(repo)]).then(([root,realRoot])=>({root,realRoot}))};
    try{return await context.value;}catch(error){context=undefined;throw error;}
  };
  const selector="img, .internal-embed[src]";
  const fixImages = async (container: HTMLElement, source: string) => {
    const repo = repository();
    if (!hexoEditorPath(app, repo, source)) return;
    const images = Array.from(container.querySelectorAll<HTMLElement>(selector));
    if (container.matches(selector)) images.unshift(container);
    const pending=images.filter(image=>{
      const src=image.getAttribute("src")??"";
      return (src.startsWith("/")||src.startsWith("app://"))&&!(image.dataset.easyPubImage===src&&image.querySelector("img"));
    });
    if(!pending.length)return;
    const {root,realRoot}=await configuration(repo);
    for (const image of pending) {
      const original = image.getAttribute("src") || "";
      let url = original;
      if (url.startsWith("app://")) { try { url = new URL(url).pathname; } catch { continue; } }
      if (!url.startsWith(root)) continue;
      let relative: string;
      try { relative = decodeURIComponent(url.slice(root.length).split(/[?#]/)[0]); } catch { continue; }
      if (!/^(img|picture)\//.test(relative) || !/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(relative)) continue;
      const absolute = path.resolve(repo, "source", relative);
      if (!isWithinPath(path.join(repo, "source"), absolute)) continue;
      try {
        if (!isWithinPath(path.join(realRoot, "source"), await fs.realpath(absolute))) continue;
        const file = files.find(absolute);
        if (file && image.getAttribute("src") === original && repo === repository() && hexoEditorPath(app,repo,source)) {
          const resource = app.vault.getResourcePath(file);
          if (image.tagName === "IMG") (image as HTMLImageElement).src = resource;
          else {
            const img = image.ownerDocument.createElement("img");
            img.src = resource; img.alt = image.getAttribute("alt") || "图片";
            image.classList.remove("file-embed", "mod-empty-attachment");
            image.classList.add("image-embed");image.dataset.easyPubImage = original;image.replaceChildren(img);
          }
        }
      } catch { /* A missing image remains visible as a broken reference. */ }
    }
  };
  plugin.registerMarkdownPostProcessor((element, context) => fixImages(element, context.sourcePath));
  const watched = new Map<MarkdownView,{observers:MutationObserver[];source:string;repo:string;roots:HTMLElement[]}>();
  const refresh = () => {
    const views = app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view as MarkdownView);
    for (const [view, entry] of watched) {
      if (!views.includes(view)||!view.file||view.file.path!==entry.source||repository()!==entry.repo
        ||entry.roots.some(root=>!view.contentEl.contains(root))) {
        entry.observers.forEach(observer=>observer.disconnect());watched.delete(view);
      }
    }
    for (const view of views) {
      if (watched.has(view)||!view.file||!hexoEditorPath(app,repository(),view.file.path)) continue;
      const roots=Array.from(view.contentEl.querySelectorAll<HTMLElement>(".cm-content, .markdown-preview-view"));
      if(!roots.length){const source=view.contentEl.querySelector<HTMLElement>(".markdown-source-view");if(source)roots.push(source);}
      if(!roots.length)continue;
      const entry={source:view.file.path,repo:repository(),roots,observers:[] as MutationObserver[]};
      watched.set(view,entry);
      const pending=new Set<HTMLElement>();let scheduled=false;
      const enqueue=(node:HTMLElement)=>{
        if(!node.matches(selector)&&!node.querySelector(selector))return;
        pending.add(node);
        if(scheduled)return;scheduled=true;
        queueMicrotask(()=>{
          scheduled=false;const nodes=[...pending];pending.clear();
          if(watched.get(view)!==entry||view.file?.path!==entry.source||repository()!==entry.repo)return;
          for(const element of nodes)void fixImages(element,entry.source).catch(()=>{});
        });
      };
      for(const root of roots){
        const observer=new MutationObserver(records=>{
          for(const record of records){
            if(record.type==="attributes")enqueue(record.target as HTMLElement);
            else for(const node of Array.from(record.addedNodes))if(node.nodeType===1)enqueue(node as HTMLElement);
          }
        });
        observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:["src"]});entry.observers.push(observer);
        void fixImages(root,entry.source).catch(()=>{});
      }
    }
  };
  plugin.registerEvent(app.workspace.on("layout-change",refresh));
  plugin.registerEvent(app.workspace.on("file-open",refresh));
  app.workspace.onLayoutReady(refresh);
  plugin.register(()=>{watched.forEach(entry=>entry.observers.forEach(observer=>observer.disconnect()));watched.clear();files.invalidate();context=undefined;});
}
