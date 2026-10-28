import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";
import { micromark } from "micromark";
import { TFile, MarkdownRenderer } from "obsidian";
import { processWechatImage, releaseWechatImages } from "../utils/wechatImages";
import { canReuseWechatPreview } from "../utils/wechatPreviewReuse";
import { PublishLocator } from "../utils/publishLocator";
import { formattingChanges } from "../utils/formatChanges";
import { renderWechatDocument } from "../utils/wechatRenderer";
import { themePlan } from "../utils/wechatLayoutEngine";
import { HexoFormatModal } from "../modals/HexoFormatModal";
import { WechatLayoutModal } from "../modals/WechatLayoutModal";

export async function runPerformanceTests() {
  for (const size of [100, 1000, 5000]) {
    const locator = new PublishLocator();
    const files = Array.from({length: size}, (_, i) => `draft-${i}.md`);
    let reads = 0, revision = "1", changeDuringRead = false;
    const contents = new Map(files.map((file, i) => [file, `---\npub_id: id-${i}\n---\nbody`]));
    const io = {version: async () => revision, read: async (file: string) => {
      reads++; if (changeDuringRead) locator.invalidate(file); return contents.get(file)!;
    }};
    const start = performance.now();
    assert.equal((await locator.find(files, 'id-0', io)).size, 1);
    const cold = performance.now() - start;
    assert.equal(reads, size);
    reads = 0;
    const warmStart = performance.now();
    assert.equal((await locator.find(files, 'id-0', io)).size, 1);
    const warm = performance.now() - warmStart;
    assert.equal(reads, 1, 'Only matching IDs are re-read on a warm lookup');
    // Additions and duplicate IDs are discovered without relying on cache invalidation.
    contents.set('new.md', '---\npub_id: id-0\n---\nduplicate');
    assert.equal((await locator.find([...files, 'new.md'], 'id-0', io)).size, 2);
    contents.set(files[1], '---\npub_id: id-0\n---\nchanged identity');
    locator.invalidate(files[1]);
    assert.equal((await locator.find(files, 'id-0', io)).size, 2);
    // External modifications are detected by version, even without Vault events.
    revision = "2";
    contents.set(files[1], '---\nbroken: [\n---\ninvalid');
    await assert.rejects(locator.find(files, 'id-0', io), /Front Matter/);
    await assert.rejects(locator.find(files, 'id-0', io), /Front Matter/);
    contents.set(files[1], '---\npub_id: other\n---\nfixed'); revision = "3";
    await locator.find(files, 'id-0', io);
    changeDuringRead = true;
    await assert.rejects(locator.find(files, 'id-0', io), /发生变化/);
    console.log(`Locator fixture ${size}: cold ${cold.toFixed(1)} ms / ${size} reads; warm ${warm.toFixed(1)} ms / 1 read`);
  }
  assert.equal(formattingChanges('same', 'same'), '内容无变更');
  assert.equal(formattingChanges('甲\r\n乙', '甲\r\n\r\n乙'), formattingChanges('甲\n乙', '甲\n\n乙'));
  assert.match(formattingChanges('甲\r\n乙', '甲\r\n\r\n乙'), /\+ （空行）/);
  assert.doesNotMatch(formattingChanges('甲\r\n乙', '甲\r\n\r\n乙'), /\r/);
  assert.match(formattingChanges('甲\r\n\r\n', '甲\r\n'), /- （空行）/);
  assert.equal(formattingChanges('甲\r\n乙\r\n', '甲\n乙\n'), '内容无变更');
  const changes = formattingChanges('first\nsecond\n\nunchanged\nlast  ', 'first\n\nsecond\n\nunchanged\nlast');
  assert.match(changes, /\+ （空行）/);
  assert.match(changes, /- last  /);
  assert.doesNotMatch(changes, /[+-] unchanged/);
  assert.match(formattingChanges('end\n\n', 'end\n'), /- （空行）/);

  const dom = new JSDOM('<!doctype html>');
  const keys = ['document', 'DOMParser', 'requestAnimationFrame', 'cancelAnimationFrame', 'Image'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, (globalThis as any)[key]]));
  const originalRender = MarkdownRenderer.render;
  let renders = 0;
  const frames = new Map<number, FrameRequestCallback>(); let frameId = 0;
  Object.assign(globalThis, {document: dom.window.document, DOMParser: dom.window.DOMParser,
    requestAnimationFrame: (fn: FrameRequestCallback) => { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id)});
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(0)); };
  MarkdownRenderer.render = async (_app, markdown, target) => { renders++; target.innerHTML = micromark(markdown); };
  const proto = dom.window.HTMLElement.prototype as any;
  proto.empty = function() { this.replaceChildren(); };
  proto.addClass = function(name: string) { this.classList.add(name); };
  proto.createEl = function(tag: string, options: any = {}) {
    const el: any = dom.window.document.createElement(tag);
    if (options.text) el.textContent = options.text;
    if (options.cls) el.className = options.cls;
    if (options.value !== undefined) el.value = options.value;
    if (options.type) el.type = options.type;
    for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, String(value));
    this.append(el); return el;
  };
  proto.createDiv = function(options: any) { return this.createEl('div', options); };
  try {
    const formatRoot = document.createElement('div');
    const formatModal = new HexoFormatModal({} as any, 'post.md', '甲\n乙',
      {content:'甲\n\n乙', addedBreaks:1, trimmedLines:0} as any, async () => {});
    Object.assign(formatModal, {contentEl:formatRoot, modalEl:formatRoot}); formatModal.onOpen();
    const grid = formatRoot.querySelector<HTMLElement>('.ep-format-comparison')!;
    assert.equal(grid.hidden, true); assert.equal(grid.childElementCount, 0);
    const toggle = [...formatRoot.querySelectorAll('button')].find(el => el.textContent === '查看完整内容')!;
    toggle.click(); assert.equal(grid.hidden, false); assert.equal(grid.childElementCount, 2);
    toggle.click(); assert.equal(grid.hidden, true);
    formatModal.onClose();
    const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL;
    let urlId = 0, pixelReads = 0;
    URL.createObjectURL = () => `blob:test-${++urlId}`; URL.revokeObjectURL = () => {};
    (globalThis as any).Image = class {
      naturalWidth = 32; naturalHeight = 32; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    };
    dom.window.HTMLCanvasElement.prototype.getContext = (() => ({drawImage: () => {}, getImageData: () => {
      pixelReads++; return {data: new Uint8ClampedArray([255, 255, 255, 0])};
    }})) as any;
    dom.window.HTMLCanvasElement.prototype.toBlob = function(callback, mime) { callback(new Blob([new Uint8Array([1,2,3])], {type: mime}) as any); };
    try {
      const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
      const png = new Uint8Array([0x89, 0x50, 0x4e]);
      const opaque = await processWechatImage('asset.jpg', jpeg, 'body', 'asset.jpg');
      assert.equal(opaque.mime, 'image/jpeg'); assert.equal(pixelReads, 0);
      const transparent = await processWechatImage('alpha.png', png, 'body', 'alpha.png');
      assert.equal(transparent.mime, 'image/png'); assert.equal(pixelReads, 1);
      releaseWechatImages([opaque, transparent]);
      const file = Object.assign(new TFile(), {path: 'asset.jpg', extension: 'jpg'});
      let bytes = jpeg;
      const app = {metadataCache: {getFirstLinkpathDest: () => file}, vault: {readBinary: async () => bytes.buffer}} as any;
      const prepared = {html: '', images: [opaque], issues: [], imageReferences: []};
      assert.equal(await canReuseWechatPreview(app, prepared, 'draft.md', () => false), true);
      bytes = new Uint8Array([0xff, 0xd8, 1]);
      assert.equal(await canReuseWechatPreview(app, prepared, 'draft.md', () => false), false, 'Changed originals prevent reuse');
      assert.equal(await canReuseWechatPreview(app, {...prepared, images: [{...opaque, localPath: undefined}]}, 'draft.md', () => true), false, 'Remote originals always take the fresh renderer path');
      bytes = jpeg;
      for (const count of [0, 5, 20]) {
        renders = 0; pixelReads = 0;
        const body = Array.from({length: count}, (_, i) => `![image ${i}](asset-${i}.jpg)`).join('\n\n') || 'no images';
        const document = await renderWechatDocument(app, body, 'draft.md', {} as any, () => false, undefined, false);
        assert.equal(document.images.length, count);
        assert.equal(document.issues.length, 0);
        assert.equal(renders, 1); assert.equal(pixelReads, 0);
        releaseWechatImages(document.images);
      }
    } finally { URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl; }
    for (const count of [20, 100, 300]) {
      const body = Array.from({length: count}, (_, i) => `paragraph ${i}`).join('\n\n');
      renders = 0;
      const base = await renderWechatDocument({} as any, body, '', {} as any, () => false, undefined, false);
      assert.equal(renders, 1);
      assert.equal(base.layoutDocument?.blocks.length, 0);
      const mapped = await renderWechatDocument({} as any, body, '', {} as any);
      assert.equal(renders, 3, 'Opening the editor builds the second strict mapping render');
      assert.equal(mapped.layoutDocument!.blocks.length, count);
      const themed = await renderWechatDocument({} as any, body, '', {} as any, () => false, themePlan(mapped.layoutDocument!, 'essay'), false);
      assert.equal(renders, 5, 'Saved layouts keep strict mapping even on the ordinary preview path');
      assert.equal(themed.layoutDocument!.blocks.length, count);
      assert.ok(base.issues.every(issue => issue.includes("超过") || issue.includes("超出")), JSON.stringify(base.issues));
      const modal = new WechatLayoutModal({app: {}} as any, {title: 'test', html: mapped.html, images: [],
        document: mapped.layoutDocument!, history: [], assertFresh: async () => {}, apply: async () => {}});
      const root = document.createElement('div'); document.body.append(root);
      Object.assign(modal, {contentEl: root, modalEl: root}); modal.onOpen(); flush();
      const select = root.querySelector<HTMLSelectElement>('.epl-block select')!;
      const lock = root.querySelector<HTMLInputElement>('.epl-block input')!;
      select.value = 'highlight-card'; select.dispatchEvent(new dom.window.Event('change'));
      lock.checked = true; lock.dispatchEvent(new dom.window.Event('change'));
      assert.equal(root.querySelector('.epl-block select'), select, 'Controls retain DOM identity');
      assert.equal(frames.size, 1, 'Several changes coalesce into one frame');
      assert.equal((modal as any).selected.blocks[0].component, 'highlight-card', 'Lock handler sees the current component');
      assert.equal((modal as any).selected.blocks[0].locked, true);
      flush();
      assert.equal(root.querySelector<HTMLButtonElement>('.epl-footer .mod-cta')!.disabled, count === 300, 'Oversized layouts retain the apply guard');
      if (count === 20) {
        const editor = modal as any;
        const reads: Array<() => void> = [];
        editor.context.assertFresh = () => new Promise<void>(resolve => reads.push(resolve));
        const config = {settings: {endpoint:'https://ai.example/v1/chat/completions', model:'fixture', jsonMode:true, encryptedKey:''}, key:''};
        const first = editor.generate([], config, editor.requestVersion);
        assert.equal(editor.pending, true);
        editor.change(themePlan(mapped.layoutDocument!, 'essay'));
        assert.equal(root.querySelector<HTMLButtonElement>('.epl-footer .mod-cta')!.disabled, true, 'Manual edits wait for their scheduled validation');
        flush();
        assert.equal(root.querySelector<HTMLButtonElement>('.epl-footer .mod-cta')!.disabled, false, 'Validated manual edits do not wait for obsolete AI');
        assert.equal(editor.canRequest(), true, 'One obsolete request leaves room for a new explicit request');
        const second = editor.generate([], config, editor.requestVersion);
        assert.equal(editor.requests.size, 2);
        assert.equal(editor.canRequest(), false);
        const preview = root.querySelector<HTMLElement>('.epl-preview')!;
        const previewNode = preview.firstElementChild;
        preview.scrollTop = 12;
        const selectedText = preview.querySelector('p')!.firstChild!;
        const range = document.createRange(); range.setStart(selectedText, 0); range.setEnd(selectedText, 3);
        const selection = dom.window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        const textBeforeCompletion = selection.toString();
        reads.shift()!(); await first;
        assert.equal(preview.firstElementChild, previewNode, 'Obsolete AI completion must not rebuild preview DOM');
        assert.equal(selection.toString(), textBeforeCompletion, 'Obsolete completion preserves text selection');
        assert.equal(preview.scrollTop, 12);
        assert.equal(editor.pending, true, 'An old finally must not clear a newer active request');
        assert.equal(root.querySelector<HTMLButtonElement>('.epl-footer .mod-cta')!.disabled, true);
        editor.change(themePlan(mapped.layoutDocument!, 'minimal')); flush();
        assert.equal(editor.pending, false);
        assert.equal(editor.canRequest(), true);
        const latestPreviewNode = preview.firstElementChild;
        reads.shift()!(); await second;
        assert.equal(preview.firstElementChild, latestPreviewNode);
        assert.equal(editor.requests.size, 0);
        assert.equal(editor.selected.theme, 'minimal');
      }
      (modal as any).setBlock(mapped.layoutDocument!.blocks[0].id, 'plain', false);
      modal.onClose(); assert.equal(frames.size, 0, 'Closing cancels pending preview work');
      root.remove();
      console.log(`Preview fixture ${count} blocks: ordinary 1 host render, mapped 2; controls retained and frame updates coalesced`);
    }
  } finally {
    MarkdownRenderer.render = originalRender;
    Object.assign(globalThis, previous); dom.window.close();
  }
}
