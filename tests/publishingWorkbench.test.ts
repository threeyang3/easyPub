import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import EasyPub from "../main";
import { PLATFORMS } from "../types";
import { WechatView, WECHAT_VIEW } from "../views/WechatView";
import { Modal } from "obsidian";
import { TFile } from "obsidian";
import { PublishingView } from "../views/PublishingView";
import { normalizeSettings } from "../utils/settings";
import { writePublishedFile } from "../utils/publishFiles";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function runPublishingWorkbenchTests() {
  const dom = new JSDOM('<div id="panel"></div>');
  const prototype = dom.window.HTMLElement.prototype as any;
  prototype.empty = function () { this.replaceChildren(); };
  prototype.addClass = function (name: string) { this.classList.add(name); };
  prototype.createEl = function (tag: string, options: any = {}) {
    const el = dom.window.document.createElement(tag);
    if (options.text) el.textContent = options.text;
    if (options.cls) el.className = options.cls;
    this.append(el); return el;
  };
  prototype.createDiv = function (options: any) { return this.createEl('div', options); };
  const files = ['a.md', 'b.md'].map(p => Object.assign(new TFile(), { path:p, extension:'md', basename:p }));
  let active: TFile | null = null, opened = 0;
  const listeners = new Map<string, (file: TFile | null) => void>();
  let pending: ((value: string) => void) | undefined;
  const app: any = {
    vault: { getAbstractFileByPath: (path: string) => files.find(file => file.path === path) ?? null, read: async (file: TFile) => file === files[0] && pending === undefined
      ? new Promise<string>(resolve => { pending = resolve; }) : `---\ntitle: ${file.basename}\n---\nText`,
      on: (event: string, fn: (file: TFile) => void) => { listeners.set(event, fn); },
    },
    workspace: { getActiveFile: () => active, requestSaveLayout: () => {},
      on: (event: string, fn: (file: TFile) => void) => { listeners.set(event, fn); } },
  };
  const plugin: any = { app, settings:normalizeSettings(null), openHexoControlRoom: async () => { opened++; } };
  const view = new PublishingView({} as any, plugin);
  const root = dom.window.document.querySelector('#panel') as any;
  Object.assign(view, { app, contentEl:root, registerEvent:() => {} });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const button = (label: string) => [...root.querySelectorAll('button')].find((el: any) => el.textContent === label) as HTMLButtonElement;
  try {
    await view.onOpen();
    assert.match(root.textContent, /打开一篇 Markdown/);
    button('Hexo 管理后台').click(); await flush(); assert.equal(opened, 1);
    active = files[0]; listeners.get('file-open')!(active); // Read A remains pending.
    active = files[1]; listeners.get('file-open')!(active); await flush();
    pending!('---\ntitle: stale A\n---\nold'); await flush();
    assert.match(root.textContent, /b.md/); assert.doesNotMatch(root.textContent, /stale A/);
    button('固定稿件').click(); await flush();
    active = files[0]; listeners.get('file-open')!(active); await flush();
    assert.equal(view.getState().path, 'b.md');
    assert.equal(view.getState().pinned, true);
    button('取消固定').click(); await flush();
    assert.equal(view.getState().path, 'a.md');
    active = null; listeners.get('file-open')!(null); await flush();
    assert.match(root.textContent, /打开一篇 Markdown/);
    button('Hexo 管理后台').click(); await flush(); assert.equal(opened, 2);
    // Custom workbenches emit file-open(null), but still have a bound article.
    app.workspace.activeLeaf = { view:{ getViewType:() => WECHAT_VIEW, getState:() => ({path:'b.md'}) } };
    listeners.get('file-open')!(null); await flush();
    assert.equal(view.getState().path, 'b.md');
    button('固定稿件').click(); await flush();
    await view.followFile(files[0]);
    assert.equal(view.getState().path, 'b.md');
    await view.onClose();
    active = files[0];
    await view.setState({path:'b.md',pinned:true}, {} as any);
    await view.onOpen();
    assert.deepEqual(view.getState(), {path:'b.md',pinned:true});
    await view.onClose();
  } finally { dom.window.close(); }

  const source = Object.assign(new TFile(), {path:'source.md',extension:'md'});
  const draft = Object.assign(new TFile(), {path:'发布/draft.md',extension:'md'});
  let sourceBody = '---\npub_id: other-id\n---\nWrong source';
  const pluginResolver = Object.create(EasyPub.prototype) as EasyPub;
  Object.assign(pluginResolver, {app: {metadataCache: {getFirstLinkpathDest:() => source}, vault: {read:async () => sourceBody}}});
  assert.equal(await pluginResolver.resolvePublishingSource(draft, {pub_id:'draft-id',source_file:'[[source]]'}), null);
  sourceBody = '---\npub_id: draft-id\n---\nOriginal';
  assert.equal(await pluginResolver.resolvePublishingSource(draft, {pub_id:'draft-id',source_file:'[[source]]'}), source);
  sourceBody = '---\npub_id: draft-id\nsource_file: "[[another]]"\n---\nA platform draft';
  assert.equal(await pluginResolver.resolvePublishingSource(draft, {pub_id:'draft-id',source_file:'[[source]]'}), null);

  // Opening crop must reject a stale snapshot and release its lock after failed rendering.
  const cropView = Object.create(WechatView.prototype) as any;
  let readCrop = async () => 'changed body';
  Object.assign(cropView, {cover:{width:1440,height:900}, file:draft, snapshot:'saved body', snapshotPath:draft.path,
    article:{}, version:1, closed:false, busy:false, cropOpening:false, app:{vault:{read:() => readCrop()}}, renderInspector:() => {}});
  await assert.rejects(cropView.openCrop(), /已变化/);
  assert.equal(cropView.cropOpening, false); assert.equal(cropView.cropModal, undefined);
  let resolveCrop!: (text: string) => void;
  readCrop = () => new Promise(resolve => { resolveCrop = resolve; });
  const opening = cropView.openCrop();
  await assert.rejects(cropView.bind(source), /关闭编辑窗口/);
  cropView.version++; resolveCrop('saved body');
  await assert.rejects(opening, /已变化/);
  assert.equal(cropView.cropOpening, false);
  // The platform selector captures the selected note, even if the active editor changes.
  const selectorPlugin = Object.create(EasyPub.prototype) as EasyPub;
  let captured: any, prepared: any;
  Object.assign(selectorPlugin, {app:{workspace:{getActiveFile:() => draft}},
    preparePublish:async (...args: any[]) => { prepared = args; }});
  const selectorOpen = Modal.prototype.open;
  try {
    Modal.prototype.open = function () { captured = this; };
    selectorPlugin.showPlatformSelector(false, source);
    await captured.onSelect(PLATFORMS[0]);
    assert.equal(prepared[2].sourceFile, source);
    selectorPlugin.showPlatformSelector();
    await captured.onSelect(PLATFORMS[0]);
    assert.equal(prepared[2].sourceFile, draft);
  } finally { Modal.prototype.open = selectorOpen; }

  const openOriginal = Modal.prototype.open, closeOriginal = Modal.prototype.close;
  try {
    Modal.prototype.open = () => { throw new Error('render failed'); };
    Modal.prototype.close = function () { Object.assign(this, {contentEl:{empty:() => {}}}); this.onClose(); };
    readCrop = async () => 'saved body';
    await assert.rejects(cropView.openCrop(), /render failed/);
    assert.equal(cropView.cropOpening, false); assert.equal(cropView.cropModal, undefined);
  } finally { Modal.prototype.open = openOriginal; Modal.prototype.close = closeOriginal; }

  // Closing a formatting preview during IO must cancel before replacement,
  // while retaining a complete recoverable backup and cleaning temporary files.
  const directory = await mkdtemp(path.join(os.tmpdir(), 'easypub-format-'));
  try {
    const target = path.join(directory, 'post.md'), backups = path.join(directory, 'backups');
    await writeFile(target, 'before');
    await assert.rejects(writePublishedFile(target, 'after', 'before', backups, () => { throw new Error('cancelled'); }), /cancelled/);
    assert.equal(await readFile(target, 'utf8'), 'before');
    const entries = await readdir(backups);
    assert.equal(entries.length, 1); assert.equal(await readFile(path.join(backups, entries[0]), 'utf8'), 'before');
    assert.deepEqual((await readdir(directory)).sort(), ['backups', 'post.md']);
    await assert.rejects(writePublishedFile(target, 'after', 'stale', backups), /修改|changed/i);
    assert.equal(await readFile(target, 'utf8'), 'before');
  } finally { await rm(directory, { recursive:true, force:true }); }
  console.log('Publishing workbench: context restore, source identity, selector target, crop lifecycle and formatting cancellation passed');
}
