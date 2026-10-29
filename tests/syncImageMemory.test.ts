import assert from "node:assert/strict";
import {TFile} from "obsidian";
import {DraftSyncImages} from "../utils/draftSyncImages";
import {normalizeSettings} from "../utils/settings";
export async function runSyncImageMemoryTests(){
  for(const count of [5,20,50]){
    const file=Object.assign(new TFile(),{path:"assets/large.png",extension:"png"});
    let reads=0,peak=process.memoryUsage().rss,changed=false;
    const app:any={metadataCache:{getFirstLinkpathDest:()=>file},vault:{readBinary:async()=>{
      reads++;const bytes=new Uint8Array(10*1024*1024);bytes[0]=changed?2:1;peak=Math.max(peak,process.memoryUsage().rss);return bytes.buffer;
    }}};
    const registry=new DraftSyncImages(app,normalizeSettings(null),"memory");
    const body=Array.from({length:count},()=>"![same](assets/large.png)").join("\n\n");
    const documents=await Promise.all([registry.canonical(body,{path:"source.md"}),registry.canonical(body,{path:"publish/post.md"})]);
    const references=documents.flatMap(document=>[...document.originals.values()]);
    const images=new Set(references.map(reference=>reference.image!));
    assert.equal(reads,1);assert.equal(images.size,1);assert.equal(references.length,count*2);
    const retained=[...images].reduce((sum,image)=>sum+image.bytes.byteLength,0);assert.equal(retained,10*1024*1024);
    await registry.verify();assert.equal(reads,2,"Verify reads each unique file afresh");
    changed=true;await assert.rejects(registry.verify(),/图片.*变化/);
    peak=Math.max(peak,process.memoryUsage().rss);
    console.log(`Sync image ${count} references x 2 drafts: 1 initial read, 10 MiB retained bytes; sampled process peak RSS ${(peak/1024/1024).toFixed(1)} MiB (whole test process)`);
  }
  const files=["a.png","b.png"].map(path=>Object.assign(new TFile(),{path,extension:"png"}));
  let reads=0,changed=false;
  const app:any={metadataCache:{getFirstLinkpathDest:(path:string)=>files.find(file=>file.path===path)},vault:{readBinary:async(file:TFile)=>{reads++;return new Uint8Array([file===files[1]&&changed?2:1]).buffer;}}};
  const registry=new DraftSyncImages(app,normalizeSettings(null),"distinct");
  const document=await registry.canonical("![same](a.png)\n\n![same](b.png)",{path:"post.md"});
  assert.equal(reads,2);const refs=[...document.originals.values()];assert.notEqual(refs[0].image,refs[1].image);assert.equal(refs[0].image?.hash,refs[1].image?.hash);
  const restored=await registry.materialize(document.body,{path:"post.md"},document,null);assert.equal(restored.body,"![same](a.png)\n\n![same](b.png)");
  changed=true;await assert.rejects(registry.verify(),/图片.*变化/);
}
