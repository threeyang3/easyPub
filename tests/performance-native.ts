// Synthetic Sandbox-only benchmark. No credentials, uploads or deployed blog writes.
import { App, Component, TFolder } from 'obsidian';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { PublishLocator } from '../utils/publishLocator';
import { PublishStore } from '../utils/publishStore';
import { PLATFORMS } from '../types';
import { renderWechatDocument } from '../utils/wechatRenderer';
import { releaseWechatImages } from '../utils/wechatImages';
import { themePlan } from '../utils/wechatLayoutEngine';

export async function run(app: App) {
  if (app.vault.getName() !== 'Sandbox') throw new Error('Performance acceptance requires Sandbox');
  const checks: string[] = [], disk: unknown[] = [], previews: unknown[] = [];
  const blog = await fs.mkdtemp(path.join(os.tmpdir(), 'easypub-performance-'));
  const folder = `EasyPub performance ${Date.now()}`;
  let createdFolder: TFolder | undefined;
  const pause = () => new Promise(resolve => setTimeout(resolve, 25));
  const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  const memory = () => process.memoryUsage().heapUsed;
  const heapBefore = memory(); let heapPeak = heapBefore, lastTick = performance.now(), maxTimerDelayMs = 0;
  const timer = setInterval(() => {
    const now = performance.now(); maxTimerDelayMs = Math.max(maxTimerDelayMs, now - lastTick - 16);
    lastTick = now; heapPeak = Math.max(heapPeak, memory());
  }, 16);
  const longTasks: number[] = [];
  let observer: PerformanceObserver | undefined;
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
    observer.observe({entryTypes:['longtask']});
  }
  try {
    const posts = path.join(blog, 'source', '_posts'); await fs.mkdir(posts, {recursive:true});
    const platform = PLATFORMS.find(platform => platform.id === 'hexo')!;
    const store = new PublishStore(() => app.vault, () => blog, () => {});
    let written = 0;
    for (const size of [100, 1000, 5000]) {
      while (written < size) {
        const start = written, end = Math.min(size, written + 32);
        await Promise.all(Array.from({length:end-start}, (_, offset) => {
          const i = start + offset;
          return fs.writeFile(path.join(posts, `article-${i}.md`), `---\npub_id: perf-${i}\ntitle: Synthetic ${i}\n---\n${'Synthetic article text. '.repeat(40)}`);
        })); written = end;
      }
      const locator = new PublishLocator();
      const samples = [];
      for (let iteration = 0; iteration < 4; iteration++) {
        let reads = 0, stats = 0;
        const start = performance.now();
        const files = (await store.listPublishFiles(platform, posts)).filter(file => file.endsWith('.md'));
        const matches = await locator.find(files, 'perf-0', {
          version: file => {stats++; return store.publishFileVersion(platform, file);},
          read: file => {reads++; return store.readPublishFile(platform, file);},
        });
        samples.push({phase:iteration ? 'warm' : 'cold-index', durationMs:performance.now()-start, reads, stats});
        assert(matches.size === 1 && reads === (iteration ? 1 : size), `${size} files lookup ${iteration} preserves identity and expected reads`);
        heapPeak = Math.max(heapPeak, memory()); await pause();
      }
      disk.push({files:size, samples});
    }
    const canvas = document.createElement('canvas'); canvas.width = 1440; canvas.height = 900;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#327568'; context.fillRect(0, 0, 1440, 900);
    context.fillStyle = '#f0d7a8'; context.fillRect(700, 0, 740, 900);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('encode fixture')), 'image/jpeg', 0.9));
    const bytes = await blob.arrayBuffer();
    createdFolder = await app.vault.createFolder(folder);
    for (let i = 0; i < 20; i++) await app.vault.createBinary(`${folder}/image-${i}.jpg`, bytes.slice(0));
    const source = await app.vault.create(`${folder}/article.md`, '# Synthetic performance source');
    for (const blocks of [20, 100, 300]) for (const imageCount of [0, 5, 20]) {
      const body = [...Array.from({length:blocks-imageCount}, (_, i) => `测试段落 ${i}。用于验证原生长文排版。`),
        ...Array.from({length:imageCount}, (_, i) => `![测试 ${i}](image-${i}.jpg)`)].join('\n\n');
      for (const mapping of [false, true]) {
        const component = new Component(); component.load();
        const start = performance.now();
        try {
          const prepared = await renderWechatDocument(app, body, source.path, component, () => false, undefined, mapping);
          try {
            previews.push({blocks, images:imageCount, mode:mapping ? 'strict-mapping' : 'ordinary', durationMs:performance.now()-start,
              htmlCharacters:Array.from(prepared.html).length, mappedBlocks:prepared.layoutDocument?.blocks.length,
              processedImageBytes:prepared.images.reduce((total, image) => total + image.bytes.length, 0), issues:prepared.issues});
            assert(prepared.images.length === imageCount && (!mapping || prepared.layoutDocument?.blocks.length === blocks), `${blocks} blocks / ${imageCount} images / mapping ${mapping}`);
            // A saved layout still uses the complete strict path; one representative long article.
            if (blocks === 100 && imageCount === 5 && mapping) {
              const savedStart = performance.now();
              const saved = await renderWechatDocument(app, body, source.path, component, () => false, themePlan(prepared.layoutDocument!, 'research'), false);
              try { previews.push({blocks, images:imageCount, mode:'saved-layout', durationMs:performance.now()-savedStart, mappedBlocks:saved.layoutDocument?.blocks.length});
                assert(saved.layoutDocument?.blocks.length === blocks, 'Saved layout keeps native strict mapping'); }
              finally {releaseWechatImages(saved.images);}
            }
          } finally {releaseWechatImages(prepared.images);}
        } finally {component.unload();}
        heapPeak = Math.max(heapPeak, memory()); await pause();
      }
    }
    await pause();
    return {checks, environment:{platform:process.platform, node:process.versions.node, electron:process.versions.electron, vault:app.vault.getName()},
      disk, previews, observations:{heapBeforeBytes:heapBefore, heapAfterBytes:memory(), heapObservedPeakBytes:heapPeak,
        maxTimerDelayMs, longTaskObserverAvailable:Boolean(observer), longTasksMs:longTasks},
      limits:['Cold means new session index; OS filesystem caches were not flushed.', 'Temporary local SSD files; not a network disk or a copied user blog.',
        'Heap and timer samples include other plugins in the Sandbox renderer; no forced GC and no claim of exact process memory peak.']};
  } finally {
    clearInterval(timer); observer?.disconnect();
    try {if (createdFolder) await app.vault.delete(createdFolder, true);}
    finally {await fs.rm(blog, {recursive:true, force:true});}
  }
}
