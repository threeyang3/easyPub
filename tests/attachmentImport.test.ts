import assert from "node:assert/strict";
import EasyPub from "../main";
import { DiffModal } from "../modals/DiffModal";
import { normalizeSettings } from "../utils/settings";
import { parseFrontMatter, stringifyFrontMatter } from "../utils/frontMatter";
import { PLATFORMS } from "../types";
import { JSDOM } from "jsdom";
import { TFile } from "obsidian";
import { ArticlePropertiesModal } from "../modals/ArticlePropertiesModal";
import { platformPropertyFields } from "../utils/articleProperties";
import { ImageUpload, importImageAttachment } from "../utils/attachmentImport";
import { resolveVaultAttachment } from "../utils/platforms";

export async function runAttachmentImportTests() {
  const stored = new Map<string, TFile>(), writes: Array<{path:string;bytes:number[]}> = [], destinations: string[] = [];
  let fail = false;
  const app: any = { fileManager: {getAvailablePathForAttachment:async (name: string, sourcePath: string) => {
    destinations.push(sourcePath);
    let target = `notes/附件/${name}`, number = 1;
    while (stored.has(target)) target = `notes/附件/${number++}-${name}`;
    return target;
  }}, metadataCache: {getFirstLinkpathDest:() => null}, vault: {
    getAbstractFileByPath:(path: string) => stored.get(path),
    createBinary:async (path: string, bytes: ArrayBuffer) => {
      if (fail) throw new Error('disk full');
      assert.equal(stored.has(path), false);
      const file = Object.assign(new TFile(), {path,extension:path.split('.').pop(),basename:'cover'});
      stored.set(path, file); writes.push({path,bytes:[...new Uint8Array(bytes)]}); return file;
    },
  }};
  const image = (name = 'cover.png'): ImageUpload => ({name,size:4,arrayBuffer:async () => Uint8Array.from([1,2,3,4]).buffer});
  const first = await importImageAttachment(app,'notes/source.md',image());
  const second = await importImageAttachment(app,'notes/source.md',image());
  assert.notEqual(first.path, second.path); assert.deepEqual(writes[0].bytes,[1,2,3,4]);
  assert.deepEqual(destinations,['notes/source.md','notes/source.md']);
  assert.equal(resolveVaultAttachment(app,first.path,'notes/source.md'),first,'New attachments resolve before cache indexing');
  assert.equal(resolveVaultAttachment(app,'../../notes/附件/cover.png','发布/微信公众号/draft.md'),first);
  await assert.rejects(importImageAttachment(app,'notes/source.md',image('bad.exe')),/请选择/);
  await assert.rejects(importImageAttachment(app,'notes/source.md',{...image(),size:51*1024*1024}),/50 MB/);
  await assert.rejects(importImageAttachment(app,'notes/source.md',{...image(),arrayBuffer:async () => new ArrayBuffer(0)}),/为空/);
  const count = writes.length;
  let active = true;
  await assert.rejects(importImageAttachment(app,'notes/source.md',{...image(),arrayBuffer:async () => {
    active=false; return new ArrayBuffer(1);
  }},() => { if (!active) throw new Error('cancelled'); }),/cancelled/);
  assert.equal(writes.length,count);

  const dom = new JSDOM('<body></body>');
  const prototype = dom.window.HTMLElement.prototype as any;
  prototype.empty = function () { this.replaceChildren(); };
  prototype.addClass = function (name: string) { this.classList.add(name); };
  prototype.createEl = function (tag: string, options: any = {}) {
    const el = dom.window.document.createElement(tag);
    if (options.text) el.textContent=options.text;
    if (options.cls) el.className=options.cls;
    if (options.type) el.setAttribute('type',options.type);
    for (const [key,value] of Object.entries(options.attr??{})) el.setAttribute(key,String(value));
    this.append(el); return el;
  };
  prototype.createDiv = function (options: any) { return this.createEl('div',options); };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  function setup(refresh=false) {
    let selection: any='pending';
    const modal = new ArticlePropertiesModal(app,{title:'生成公众号稿件',description:'确认属性',fields:platformPropertyFields('wechat'),
      current:{title:'标题',wechat:{cover:'old.png'}},suggested:{title:'标题'},attachmentSourcePath:'notes/source.md',refresh},value => {selection=value;});
    const el=dom.window.document.createElement('div'); dom.window.document.body.append(el);
    Object.assign(modal,{app,contentEl:el,modalEl:el,close:() => modal.onClose()}); modal.onOpen();
    const button=(text: string) => [...el.querySelectorAll('button')].find(b=>b.textContent===text)!;
    const selectFile=(file: ImageUpload) => {
      const picker=el.querySelector<HTMLInputElement>('input[type=file]')!;
      Object.defineProperty(picker,'files',{value:[file],configurable:true}); picker.dispatchEvent(new dom.window.Event('change'));
    };
    return {modal,el,button,selectFile,selection:() => selection};
  }
  try {
    const form=setup(true);
    form.selectFile(image('fresh.png'));
    assert.equal(form.button('确认并继续').disabled,true);
    assert.equal(form.button('预览属性变更').disabled,true);
    await flush();
    const cover=form.el.querySelector<HTMLInputElement>('input[aria-label="封面附件路径或网址"]')!;
    assert.equal(cover.value,'[[notes/附件/fresh.png]]'); assert.equal(cover.disabled,false);
    assert.equal(form.el.querySelector<HTMLInputElement>('input[aria-label="刷新封面附件路径或网址"]')!.checked,true);
    form.button('预览属性变更').click(); form.button('确认并继续').click();
    assert.equal(form.selection().values['wechat.cover'],'[[notes/附件/fresh.png]]');
    assert.ok(stored.has('notes/附件/fresh.png'));

    const retry=setup(); fail=true; retry.selectFile(image('retry.png')); await flush();
    assert.match(retry.el.textContent!,/disk full/); assert.equal(retry.button('预览属性变更').disabled,false);
    fail=false; retry.selectFile(image('retry.png')); await flush();
    assert.equal(retry.el.querySelector<HTMLInputElement>('input[aria-label="封面附件路径或网址"]')!.value,'[[notes/附件/retry.png]]');
    retry.modal.onClose(); assert.equal(retry.selection(),null); assert.ok(stored.has('notes/附件/retry.png'));

    const bulk=setup();
    const multiple=bulk.el.querySelector<HTMLInputElement>('input[multiple]')!;
    Object.defineProperty(multiple,'files',{value:[image('bulk.png'),image('bad.exe'),image('bulk.webp')],configurable:true});
    multiple.dispatchEvent(new dom.window.Event('change')); await flush();
    assert.equal(bulk.el.querySelectorAll('.ep-property-imported-row').length,2);
    assert.match(bulk.el.textContent!,/bad.exe/);
    bulk.button('用于封面').click();
    assert.equal(bulk.el.querySelector<HTMLInputElement>('input[aria-label="封面附件路径或网址"]')!.value,'[[notes/附件/bulk.png]]');
    bulk.modal.onClose();

    const cancelled=setup(); let release!: (data: ArrayBuffer) => void;
    const before=writes.length;
    cancelled.selectFile({...image('cancelled.png'),arrayBuffer:()=>new Promise(resolve => {release=resolve;})});
    cancelled.modal.onClose(); release(new ArrayBuffer(4)); await flush();
    assert.equal(cancelled.selection(),null); assert.equal(writes.length,before);

    const late=setup(); const create=app.vault.createBinary;
    let complete!: () => void;
    app.vault.createBinary=(path: string, bytes: ArrayBuffer) => new Promise(resolve => {
      complete=async () => resolve(await create(path,bytes));
    });
    late.selectFile(image('late.png')); await flush(); late.modal.onClose();
    complete(); await flush();
    assert.equal(late.selection(),null); assert.ok(stored.has('notes/附件/late.png'));
    app.vault.createBinary=create;
  } finally {dom.window.close();}
  // A newly uploaded cover flows through actual publishing metadata without waiting for indexing.
  const propertiesOpen=ArticlePropertiesModal.prototype.open, diffOpen=DiffModal.prototype.open;
  try {
    const plugin=Object.create(EasyPub.prototype) as EasyPub;
    plugin.settings=normalizeSettings(null);
    const source=Object.assign(new TFile(),{path:'notes/source.md',extension:'md',basename:'source'});
    Object.assign(plugin,{app:{...app,workspace:{getActiveFile:() => source},vault:{...app.vault,read:async () => stringifyFrontMatter('Source body',{title:'Source',pub_id:'stable'})}}});
    plugin.findArticleByPubId=async () => '发布/微信公众号/local.md';
    plugin.readPublishFile=async () => stringifyFrontMatter('Independent draft body',{title:'Local',pub_id:'stable',source_file:'[[notes/source]]',date:'2020-01-01',wechat:{cover:'old.png',cropWide:{x:0}}});
    ArticlePropertiesModal.prototype.open=function () {(this as any).finish({values:{'wechat.cover':`[[${first.path}]]`},remove:[]});};
    let result: any;
    DiffModal.prototype.open=function () {result=(this as any).diff; (this as any).onConfirm(false);};
    await plugin.preparePublish(PLATFORMS.find(p=>p.id==='wechat')!,false,{configure:true,propertiesOnly:true});
    assert.ok(result,'Publishing reaches the confirmation dialog');
    const parsed=parseFrontMatter(result.sourceContent);
    assert.equal(parsed.data.date,'2020-01-01'); assert.equal(parsed.content.trim(),'Independent draft body');
    assert.equal((parsed.data.wechat as any).cover,'../../notes/附件/cover.png');
    assert.equal((parsed.data.wechat as any).cropWide,undefined);
  } finally {ArticlePropertiesModal.prototype.open=propertiesOpen; DiffModal.prototype.open=diffOpen;}
  console.log('Attachment import: host paths, collision avoidance, cache lag, field assignment, cancellation and retry passed');
}
