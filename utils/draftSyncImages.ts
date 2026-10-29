import { applySyncChangesWithOrigins, SyncChange } from "./draftSyncDiff";
import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { App, TFile, normalizePath } from "obsidian";
import { PluginSettings, Platform } from "../types";
import { MarkdownNode, parseWechatMarkdown, IMAGE_EXTENSIONS, resolveVaultImage } from "./wechatMarkdown";
import { hexoEditorPath, isWithinPath, getHexoAssetTargetPath, relativeVaultAttachment } from "./platforms";
import { getHexoRootPath } from "./linkUtils";

export interface SyncLocation { path: string; platform?: Platform }
export interface SyncAsset { path: string; bytes: Buffer; hash: string; external: boolean; name: string }
export interface ImageReference { canonical:string; raw:string; image?:SyncImage }
export interface CanonicalBody { body: string; originals: Map<number,ImageReference> }
interface SyncImage { bytes: Buffer; hash: string; extension: string; vaultPath?: string; read: () => Promise<Buffer> }
export const syncHash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const altText = (value: string) => value.replace(/[\[\]\\]/g,"\\$&");
const imageMarkdown = (alt: string, url: string) => `![${altText(alt)}](<${url}>)`;

export async function readAttachmentConfiguration(app: App): Promise<string | null> {
  const file = `${app.vault.configDir}/app.json`;
  return await app.vault.adapter.exists(file) ? app.vault.adapter.read(file) : null;
}

/** Mirrors the host's documented root, note-relative and Vault-relative attachment locations. */
export function syncAttachmentPath(configuration: string | null, target: string, name: string): string {
  const setting = configuration ? JSON.parse(configuration).attachmentFolderPath : "";
  const folder = typeof setting === "string" ? setting.replace(/\\/g,"/") : "";
  const directory = folder === "." || folder === "./" ? path.posix.dirname(target)
    : folder.startsWith("./") ? path.posix.join(path.posix.dirname(target),folder.slice(2)) : folder.replace(/^\/+/,"");
  const result = normalizePath(path.posix.join(directory,name));
  if (path.posix.isAbsolute(result) || result.split("/").includes("..")) throw new Error("附件目录不是有效的 Vault 内路径");
  return result;
}

export class DraftSyncImages {
  private images = new Map<string,SyncImage>();
  private originals = new Set<SyncImage>();
  private files = new Map<string,Promise<SyncImage>>();
  constructor(private app: App, private settings: PluginSettings, private pubId: string) {}

  private async localImage(source: string, location: SyncLocation): Promise<SyncImage> {
    const draft = location.platform?.id === "hexo" ? location.path : hexoEditorPath(this.app,this.settings.hexoRepoPath,location.path);
    let read: () => Promise<Buffer>, extension: string, vaultPath: string | undefined, identity:string;
    if (draft) {
      const root = await getHexoRootPath(this.settings.hexoRepoPath);
      let decoded = decodeURIComponent(source.split(/[?#]/)[0]);
      if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith("//")) throw new Error(`不支持的博客本地图片引用：${source}`);
      const absolute = decoded.startsWith(root) ? path.resolve(this.settings.hexoRepoPath,"source",decoded.slice(root.length))
        : decoded.startsWith("/") ? path.resolve(this.settings.hexoRepoPath,"source",decoded.slice(1)) : path.resolve(path.dirname(draft),decoded);
      identity=`external:${absolute}`;
      const sourceRoot = path.join(await fs.realpath(this.settings.hexoRepoPath),"source");
      const safeRead = async () => {
        if (!isWithinPath(sourceRoot,await fs.realpath(absolute))) throw new Error("图片引用超出博客 source 目录");
        const stat = await fs.stat(absolute);
        if (!stat.isFile() || stat.size > 50*1024*1024) throw new Error("图片文件不存在或超过 50 MB");
        return fs.readFile(absolute);
      };
      read = safeRead; extension = path.extname(absolute).slice(1).toLowerCase();
    } else {
      const file = resolveVaultImage(this.app,source,location.path);
      if (file.path.startsWith("file:")) throw new Error("同步仅支持 Vault 附件和配置博客中的图片");
      identity=`vault:${file.path}`;
      vaultPath = file.path; extension = file.extension.toLowerCase();
      read = async () => {
        if (file.path !== vaultPath || file.stat?.size > 50*1024*1024) throw new Error("附件已移动或超过 50 MB");
        return Buffer.from(await this.app.vault.readBinary(file));
      };
    }
    if (!IMAGE_EXTENSIONS.has(extension)) throw new Error(`不支持的图片附件：${source}`);
    const cached=this.files.get(identity);
    if(cached)return cached;
    const loading=(async()=>{
      const bytes = await read();
      if (!bytes.length || bytes.length > 50*1024*1024) throw new Error("图片为空或超过 50 MB");
      const image = {bytes,hash:syncHash(bytes),extension,vaultPath,read};
      this.originals.add(image);
      return image;
    })();
    this.files.set(identity,loading);
    try{return await loading;}catch(error){if(this.files.get(identity)===loading)this.files.delete(identity);throw error;}
  }

  async canonical(body: string, location: SyncLocation): Promise<CanonicalBody> {
    body = body.replace(/\r\n/g,"\n");
    const originals = new Map<number,ImageReference>(), definitions = new Map<string,string>();
    const replacements: Array<{start:number;end:number;source:string;alt:string}> = [], blocked: Array<[number,number]> = [];
    const tree = parseWechatMarkdown(body);
    const visit = (node: MarkdownNode) => {
      const start=node.position?.start.offset,end=node.position?.end.offset;
      if (["code","inlineCode","html"].includes(node.type)) {if(start!==undefined&&end!==undefined)blocked.push([start,end]);return;}
      if(node.type==="definition"&&node.identifier&&node.url)definitions.set(node.identifier.toLowerCase(),node.url);
      node.children?.forEach(visit);
    };visit(tree);
    const collect = (node: MarkdownNode) => {
      if(["code","inlineCode","html"].includes(node.type))return;
      if(["image","imageReference"].includes(node.type)) {
        const start=node.position?.start.offset,end=node.position?.end.offset;
        const source=node.url??definitions.get((node.identifier??"").toLowerCase());
        if(start!==undefined&&end!==undefined&&source) {replacements.push({start,end,source,alt:node.alt??""});blocked.push([start,end]);}
      }
      node.children?.forEach(collect);
    };collect(tree);
    const wiki=/!\[\[([^\]\r\n]+)\]\]/g;let match:RegExpExecArray|null;
    while((match=wiki.exec(body))) {
      let slashes=0;for(let p=match.index-1;p>=0&&body[p]==="\\";p--)slashes++;
      if(slashes%2||blocked.some(([start,end])=>match!.index>=start&&match!.index<end))continue;
      const [source,alias]=match[1].split("|");
      if(!IMAGE_EXTENSIONS.has(source.split(".").pop()?.toLowerCase()??""))continue;
      replacements.push({start:match.index,end:wiki.lastIndex,source,alt:alias&&!/^\d+(x\d+)?$/.test(alias)?alias:path.basename(source,path.extname(source))});
    }
    let result="", last=0;
    for(const replacement of replacements.sort((a,b)=>a.start-b.start)) {
      let url=replacement.source, referenceImage:SyncImage|undefined;
      if(!/^https?:\/\//i.test(url)) {
        const image=await this.localImage(url,location),key=`easy-pub-sync-image://${image.hash}.${image.extension}`;
        if(!this.images.has(key))this.images.set(key,image);referenceImage=image;
        url=key;
      } else {
        const parsed=new URL(url);if(parsed.username||parsed.password)throw new Error("图片网址不能包含账号或密码");
        // A verified local PicGo cache bridges URL-vs-local references without downloading remote images.
        const cached=Object.entries(this.settings.picgoImageCache).find(([,entry])=>entry.url===url);
        if(cached){try{const image=await this.localImage(cached[0],{path:""});if(image.hash===cached[1].hash){const key=`easy-pub-sync-image://${image.hash}.${image.extension}`;if(!this.images.has(key))this.images.set(key,image);referenceImage=image;url=key;}}catch{/* An unavailable or changed local original is not equivalent to the remote URL. */}}
      }
      const canonical=imageMarkdown(replacement.alt,url);
      result+=body.slice(last,replacement.start);
      originals.set(result.length,{canonical,raw:body.slice(replacement.start,replacement.end),image:referenceImage});
      result+=canonical;last=replacement.end;
    }
    return {body:result+body.slice(last),originals};
  }

  async materialize(canonical: string, target: SyncLocation, original: CanonicalBody, configuration: string|null, changes?:SyncChange[], sender?:CanonicalBody): Promise<{body:string;assets:SyncAsset[]}> {
    const assets=new Map<string,SyncAsset>();
    const references=new Map<number,{reference:ImageReference;reuse:boolean}>();
    if(changes&&sender) {
      const applied=applySyncChangesWithOrigins(original.body,changes);
      if(applied.body!==canonical)throw new Error("图片引用位置与预览不一致，请重新预览");
      const offsets=(body:string)=>{let offset=0;return body.split("\n").map(line=>{const start=offset;offset+=line.length+1;return start;});};
      const starts={target:offsets(original.body),sender:offsets(sender.body)};
      const byLine=(document:CanonicalBody,starts:number[])=>{
        const lines=new Map<number,Array<[number,ImageReference]>>();let line=0;
        for(const [offset,reference]of document.originals){while(line+1<starts.length&&starts[line+1]<=offset)line++;const row=lines.get(line)??[];row.push([offset-starts[line],reference]);lines.set(line,row);}return lines;
      };
      const rows={target:byLine(original,starts.target),sender:byLine(sender,starts.sender)};
      let offset=0;
      for(const [index,line]of canonical.split("\n").entries()) {
        const origin=applied.origins[index];
        if(origin)for(const [column,reference]of rows[origin.side].get(origin.line)??[])references.set(offset+column,{reference,reuse:origin.side==="target"});
        offset+=line.length+1;
      }
    } else if(original.body===canonical) for(const [offset,reference]of original.originals) references.set(offset,{reference,reuse:true});
    const blocked:Array<[number,number]>=[];
    const visit=(node:MarkdownNode)=>{if(["code","inlineCode","html"].includes(node.type)){if(node.position?.start.offset!==undefined&&node.position.end.offset!==undefined)blocked.push([node.position.start.offset,node.position.end.offset]);return;}node.children?.forEach(visit);};
    visit(parseWechatMarkdown(canonical));
    const pattern=/!\[((?:\\.|[^\]\n])*)\]\(<([^\n>]+)>\)/g;
    let result="",last=0,match:RegExpExecArray|null;
    while((match=pattern.exec(canonical))) {
      if(blocked.some(([start,end])=>match!.index>=start&&match!.index<end))continue;
      result+=canonical.slice(last,match.index);
      const binding=references.get(match.index);
      const reference=binding?.reference.canonical===match[0]?binding:undefined;
      if(reference?.reuse)result+=reference.reference.raw;
      else if(match[2].startsWith("easy-pub-sync-image://")) {
        const image=reference?.reference.image??this.images.get(match[2]);if(!image)throw new Error("同步图片已失效，请重新预览");
        let url:string;
        if(target.platform?.id==="hexo") {
          const destination=getHexoAssetTargetPath(this.settings,this.pubId,`sync.${image.extension}`,image.hash);
          url=(await getHexoRootPath(this.settings.hexoRepoPath))+path.relative(path.join(this.settings.hexoRepoPath,"source"),destination).split(path.sep).map(encodeURIComponent).join("/");
          assets.set(destination,{path:destination,bytes:image.bytes,hash:image.hash,external:true,name:path.basename(destination)});
        } else if(image.vaultPath) url=relativeVaultAttachment(target.path,image.vaultPath).split("/").map(encodeURIComponent).join("/");
        else {
          const name=`easypub-sync-${image.hash}.${image.extension}`;
          let destination=syncAttachmentPath(configuration,target.path,name),counter=1;
          while(true) {
            const existing=this.app.vault.getAbstractFileByPath(destination);
            if(!existing)break;
            if(existing instanceof TFile&&syncHash(Buffer.from(await this.app.vault.readBinary(existing)))===image.hash)break;
            destination=syncAttachmentPath(configuration,target.path,`${counter++}-${name}`);
          }
          url=relativeVaultAttachment(target.path,destination).split("/").map(encodeURIComponent).join("/");
          assets.set(destination,{path:destination,bytes:image.bytes,hash:image.hash,external:false,name:path.basename(destination)});
        }
        result+=`![${match[1]}](<${url}>)`;
      } else result+=match[0];
      last=pattern.lastIndex;
    }
    return {body:result+canonical.slice(last),assets:[...assets.values()]};
  }

  async verify():Promise<void> {
    for(const image of this.originals)if(syncHash(await image.read())!==image.hash)throw new Error("图片在预览后发生变化，请重新预览");
  }
}
