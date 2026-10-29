import assert from "node:assert/strict";
import path from "path";
import {performance} from "node:perf_hooks";
import {HexoLocatorIO,locateHexoArticles,invalidateHexoLocator} from "../utils/hexoLocator";
export async function runHexoLocatorTests(){
  const repository=path.resolve("hexo-locator-fixture");
  for(const size of [100,1000,5000]){
    const entries=new Map(Array.from({length:size},(_,i)=>[path.join(repository,"source",i%2?"_drafts":"_posts",`${i}.md`),{raw:`---\npub_id: id-${i}\n---\nbody`,version:"1"}]));
    let reads=0,lists=0;
    const io:HexoLocatorIO={publishDirectoryExists:async()=>true,listPublishFiles:async(_,directory)=>{lists++;return [...entries.keys()].filter(file=>path.dirname(file)===directory);},
      readPublishFile:async(_,file)=>{reads++;return entries.get(file)!.raw;},publishFileVersion:async(_,file)=>entries.get(file)?.version};
    let start=performance.now();assert.equal((await locateHexoArticles(io,repository,"id-0")).size,1);const cold=performance.now()-start;assert.equal(reads,size);
    reads=0;lists=0;start=performance.now();
    const [a,b]=await Promise.all([locateHexoArticles(io,repository,"id-0"),locateHexoArticles(io,repository,"id-0")]);
    const warm=performance.now()-start;assert.equal(a,b);assert.equal(lists,2);assert.equal(reads,1);
    reads=0;await locateHexoArticles(io,repository,"id-0",true);assert.equal(reads,size,"Writes re-read all identities instead of authorizing from cached metadata");
    const added=path.join(repository,"source/_drafts/new.md");entries.set(added,{raw:"---\npub_id: id-0\n---\nduplicate",version:"1"});
    await assert.rejects(()=>locateHexoArticles(io,repository,"id-0"),/多个/);entries.delete(added);
    const file=[...entries.keys()][1];entries.set(file,{raw:"---\nbroken: [\n---\n",version:"2"});await assert.rejects(()=>locateHexoArticles(io,repository,"id-0"),/Front Matter/);
    entries.set(file,{raw:"---\npub_id: other\n---\n",version:"3"});invalidateHexoLocator(io,file);await locateHexoArticles(io,repository,"id-0");
    const read=io.readPublishFile;io.readPublishFile=async(platform,file)=>{const raw=await read(platform,file);invalidateHexoLocator(io);return raw;};
    await assert.rejects(()=>locateHexoArticles(io,repository,"id-0"),/变化/);io.readPublishFile=read;
    console.log(`Shared Hexo locator ${size}: cold ${cold.toFixed(1)} ms / ${size} reads; coalesced warm ${warm.toFixed(1)} ms / 1 read; strict writes, duplicates and invalidation passed`);
  }
}
