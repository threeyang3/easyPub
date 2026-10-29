import path from "path";
import {Platform,PLATFORMS} from "../types";
import {PublishLocator} from "./publishLocator";

export interface HexoLocatorIO {
  publishDirectoryExists(platform:Platform,directory:string):Promise<boolean>;
  listPublishFiles(platform:Platform,directory:string):Promise<string[]>;
  readPublishFile(platform:Platform,file:string):Promise<string>;
  publishFileVersion?(platform:Platform,file:string):Promise<string|undefined>;
}
class HexoLocator {
  private repository="";
  private index=new PublishLocator();
  private revision=0;
  private pending=new Map<string,Promise<Map<string,string>>>();
  invalidate(file?:string,oldPath?:string){this.revision++;this.index.invalidate(file,oldPath);this.pending.clear();}
  async find(io:HexoLocatorIO,repository:string,pubId:string,strict:boolean) {
    if(!path.isAbsolute(repository)||!pubId)throw new Error("需要 Hexo 绝对路径和稿件 pub_id");
    repository=path.resolve(repository);
    if(this.repository!==repository){this.invalidate();this.repository=repository;}
    const key=JSON.stringify([repository,pubId,strict]);
    const existing=this.pending.get(key);if(existing)return existing;
    const revision=this.revision;
    const run=(async()=>{
      const platform=PLATFORMS.find(item=>item.id==="hexo")!;
      const files:string[]=[];
      for(const folder of ["_posts","_drafts"]){
        const directory=path.join(repository,"source",folder);
        if(await io.publishDirectoryExists(platform,directory))for(const file of await io.listPublishFiles(platform,directory))if(file.toLowerCase().endsWith(".md"))files.push(file);
      }
      // Read-only lookups share versioned entries; writes re-read every document.
      const matches=await (strict?new PublishLocator():this.index).find(files,pubId,{
        version:file=>io.publishFileVersion?.(platform,file)??Promise.resolve(undefined),read:file=>io.readPublishFile(platform,file),
      });
      if(revision!==this.revision||repository!==this.repository)throw new Error("Hexo 稿件查询期间目录或文件发生变化，请重新操作");
      if(matches.size>1)throw new Error(`pub_id 有多个 Hexo 匹配，已停止操作：${[...matches.keys()].join("、")}`);
      return matches;
    })();
    this.pending.set(key,run);
    try{return await run;}finally{if(this.pending.get(key)===run)this.pending.delete(key);}
  }
}
const services=new WeakMap<HexoLocatorIO,HexoLocator>();
export function locateHexoArticles(io:HexoLocatorIO,repository:string,pubId:string,strict=false){
  let service=services.get(io);if(!service){service=new HexoLocator();services.set(io,service);}return service.find(io,repository,pubId,strict);
}
export function invalidateHexoLocator(io:HexoLocatorIO,file?:string,oldPath?:string){services.get(io)?.invalidate(file,oldPath);}
