import assert from "node:assert/strict";
import {JSDOM} from "jsdom";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {performance} from "node:perf_hooks";
import {TFile} from "obsidian";
import {registerHexoEditing} from "../utils/hexoEditing";

export async function runHexoPreviewPerformanceTests(){
  const repository=await fs.mkdtemp(path.join(os.tmpdir(),"hexo-preview-perf-"));
  const saved=globalThis.MutationObserver;
  const wait=async(test:()=>boolean)=>{for(let i=0;i<3000;i++){if(test())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail("Preview resolution did not finish");};
  try{
    await fs.mkdir(path.join(repository,"source/img"),{recursive:true});await fs.mkdir(path.join(repository,"source/_drafts"));
    await fs.writeFile(path.join(repository,"source/img/pic.png"),"fixture");await fs.writeFile(path.join(repository,"_config.yml"),"url: https://example.test/\n");
    for(const size of [100,1000,5000]){
      const dom=new JSDOM('<div class="view"><div class="chrome"></div><div class="markdown-source-view"><div class="cm-content"><img src="/img/pic.png"></div></div></div>');
      const document=dom.window.document,container=document.querySelector('.view') as HTMLElement;
      const content=document.querySelector('.cm-content')!;
      let callbacks=0,scans=0,pathLookups=0,resources=0;
      const scopes:Node[]=[];
      globalThis.MutationObserver=class extends dom.window.MutationObserver{
        constructor(callback:MutationCallback){super((records,observer)=>{callbacks++;callback(records as any,observer as any);});}
        observe(target:Node,options:MutationObserverInit){scopes.push(target);super.observe(target as any,options);}
      } as any;
      const files=Array.from({length:size},(_,index)=>Object.assign(new TFile(),{path:`vault/${index}.png`,extension:"png"}));
      const image=files[size-1];
      const listeners=new Map<string,Function[]>(),cleanup:Function[]=[];
      const on=(event:string,fn:Function)=>{listeners.set(event,[...(listeners.get(event)??[]),fn]);return fn;};
      const view={file:{path:`file:${path.join(repository,"source/_drafts/post.md")}`},contentEl:container};
      const app:any={vault:{adapter:{getFullPath:(file:string)=>{pathLookups++;return file===image.path?path.join(repository,"source/img/pic.png"):path.join(repository,"other",file);}},
        getFiles:()=>{scans++;return files;},getFileByPath:()=>null,getResourcePath:()=>{resources++;return "app://resource/image.png";},on},
        workspace:{getLeavesOfType:()=>[{view}],on,onLayoutReady:(fn:Function)=>fn()}};
      const plugin:any={app,registerEvent:()=>{},register:(fn:Function)=>cleanup.push(fn),registerMarkdownPostProcessor:()=>{}};
      const started=performance.now();registerHexoEditing(plugin,()=>repository);
      await wait(()=>resources===1);
      const cold=performance.now()-started;
      assert.equal(scans,1);assert(scopes.every(scope=>scope!==container),"Never observe the entire view");
      const initialLookups=pathLookups,initialResources=resources;
      const typingStart=performance.now(),initialCallbacks=callbacks;
      for(let i=0;i<100;i++){
        const span=document.createElement('span');span.textContent=`typing ${i}`;content.append(span);
        await new Promise(resolve=>setImmediate(resolve));
      }
      const typing=performance.now()-typingStart,typingCallbacks=callbacks-initialCallbacks;
      assert.equal(scans,1);assert.equal(resources,initialResources);assert.equal(pathLookups,initialLookups,"Text-only mutations never locate images");
      const next=document.createElement('img');next.src='/img/pic.png';content.append(next);
      await wait(()=>resources===2);assert.equal(scans,1,"New image reuses the Vault path index");
      for(const fn of listeners.get('rename')??[])fn(image);
      const renamed=document.createElement('img');renamed.src='/img/pic.png';content.append(renamed);
      await wait(()=>resources===3);assert.equal(scans,2,"Topology changes invalidate the index");
      view.file.path='ordinary.md';for(const fn of listeners.get('file-open')??[])fn();
      const final=document.createElement('img');final.src='/img/pic.png';content.append(final);await new Promise(resolve=>setImmediate(resolve));
      assert.equal(resources,3,"Switching to an ordinary note disconnects the observer");
      cleanup.forEach(fn=>fn());dom.window.close();
      console.log(`Hexo preview ${size} files: cold ${cold.toFixed(1)} ms / 1 Vault scan; 100 input batches ${typing.toFixed(1)} ms / ${typingCallbacks} observer callbacks, 0 new path lookups or scans`);
    }
  }finally{globalThis.MutationObserver=saved;await fs.rm(repository,{recursive:true,force:true});}
}
