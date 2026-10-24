import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { micromark } from "micromark";
import EasyPub from "../main";
import { normalizeSettings, publishSettingsFingerprint } from "../utils/settings";
import { validateHexoPreviewUrl } from "../views/HexoPreviewView";
import { sanitizeWechatHtml } from "../utils/wechatRenderer";
import { bindWechatBlocks, contentFingerprint, extractWechatBlocks } from "../utils/wechatLayoutAst";
import { applyWechatLayout, mergeLockedLayout, readWechatLayoutPlan, themePlan, validateWechatLayout } from "../utils/wechatLayoutEngine";
import { plannerMessages, planWechatLayout } from "../utils/wechatAiPlanner";
import { normalizeAiSettings, requestWechatPlan, validateAiEndpoint } from "../utils/wechatAiProvider";
import { layoutPreview } from "../modals/WechatLayoutModal";
import { readWechatArticleSettings } from "../utils/wechatState";
import { WECHAT_THEMES, themePalette, themeStyles } from "../utils/wechatThemes";
import { compareWechatReadback } from "../utils/wechatReadback";

export async function runWechatLayoutTests() {
  const plugin = Object.create(EasyPub.prototype) as EasyPub;
  plugin.loadData = async () => { throw new Error("private corrupt content"); };
  const warn = console.warn; console.warn = () => {};
  try { await plugin.loadSettings(); } finally { console.warn = warn; }
  let writes = 0;
  plugin.saveData = async () => { writes++; };
  plugin.settings.hexoRepoPath = "/unrelated-change";
  await assert.rejects(plugin.saveSettings(), /禁止保存/);
  assert.equal(writes, 0);
  let original = '{broken private cache and encrypted credentials';
  const backups = new Map<string, string>();
  Object.assign(plugin, {manifest: {dir: '.obsidian/plugins/easy-pub'}, app: {vault: {adapter: {
    read: async (file: string) => file.endsWith('data.json') ? original : backups.get(file),
    exists: async () => false,
    write: async (file: string, value: string) => { backups.set(file, value); },
  }}}});
  const backup = await plugin.backupAndResetSettings();
  assert.equal(backups.get(backup), original);
  assert.equal(writes, 1);
  assert.equal(plugin.settingsRecoveryRequired, false);
  plugin.loadData = async () => [];
  console.warn = () => {};
  try { await plugin.loadSettings(); } finally { console.warn = warn; }
  assert.equal(plugin.settingsRecoveryRequired, true);
  await assert.rejects(plugin.saveSettings(), /禁止保存/);
  (plugin.app.vault.adapter as any).write = async () => { throw new Error('backup failed'); };
  await assert.rejects(plugin.backupAndResetSettings(), /backup failed/);
  assert.equal(writes, 1);
  assert.equal(original, '{broken private cache and encrypted credentials');
  plugin.loadData = async () => ({hexoRepoPath: '/restored', wechat: {drafts: {key: {mediaId: 'known'}}}});
  await plugin.loadSettings();
  assert.equal(plugin.settingsRecoveryRequired, false);
  await plugin.saveSettings(); assert.equal(writes, 2);
  assert.equal(plugin.settings.wechat.drafts.key.mediaId, 'known');
  const ai = Object.create(EasyPub.prototype) as EasyPub;
  ai.settings = normalizeSettings(null);
  const persisted: unknown[] = [];
  ai.saveData = async value => { persisted.push(value); };
  await ai.saveWechatAiConfiguration('https://ai.example/v1/chat/completions', 'model-a', 'layout-key-sensitive', true);
  assert.equal(ai.getWechatAiConfiguration().key, 'layout-key-sensitive');
  assert.ok(!JSON.stringify(persisted).includes('layout-key-sensitive'), 'API keys must not be serialized in plaintext');
  await ai.saveWechatAiConfiguration('https://ai.example/v1/chat/completions', 'model-b', '', true);
  assert.equal(ai.getWechatAiConfiguration().key, 'layout-key-sensitive');
  await ai.saveWechatAiConfiguration('https://other.example/v1/chat/completions', 'model-b', '', true);
  assert.equal(ai.getWechatAiConfiguration().key, '', 'Endpoint changes must never reuse the old service key');
  await ai.saveWechatAiConfiguration('https://other.example/v1/chat/completions', 'model-b', 'new-key', true);
  ai.saveData = async () => { throw new Error('disk full'); };
  await assert.rejects(ai.saveWechatAiConfiguration('https://third.example/v1/chat/completions', 'model-c', 'replacement', true), /disk full/);
  assert.equal(ai.getWechatAiConfiguration().key, 'new-key', 'Failed saves restore session keys and endpoint scope');
  const concurrentAi = Object.create(EasyPub.prototype) as EasyPub;
  concurrentAi.settings = normalizeSettings(null);
  let releaseSave!: () => void;
  const gate = new Promise<void>(resolve => { releaseSave = resolve; });
  concurrentAi.saveData = async () => gate;
  const pendingSave = concurrentAi.saveWechatAiConfiguration('https://ai.example/v1/chat/completions', 'model-a', 'session-key', true);
  await assert.rejects(concurrentAi.clearWechatAiKey(), /正在保存/);
  releaseSave(); await pendingSave;
  assert.equal(concurrentAi.getWechatAiConfiguration().key, 'session-key');
  await concurrentAi.clearWechatAiKey();
  assert.equal(concurrentAi.getWechatAiConfiguration().key, '');

  for (const id of ['a12b', '123456789', 'deadbeef', 'old-post_2020', '历史短链', 'article.2020']) assert.equal(validateHexoPreviewUrl(`http://127.0.0.1:5001/posts/${encodeURIComponent(id)}/`, id), `http://127.0.0.1:5001/posts/${encodeURIComponent(id)}/`);
  for (const path of ['/admin/', '/posts/x/../../admin/', '/posts/x/?token=a', '/posts/%2e%2e/admin/', '/posts/x/%2f/']) assert.throws(() => validateHexoPreviewUrl('http://127.0.0.1:5001' + path));
  assert.throws(() => validateHexoPreviewUrl('http://127.0.0.1:5001/posts/other/', 'expected'));
  for (const url of ['https://api.example/v1/chat/completions', 'http://127.0.0.1:11434/v1/chat/completions']) assert.equal(validateAiEndpoint(url), url);
  for (const url of ['http://remote.example/v1/chat/completions', 'https://key@api.example/v1/chat/completions', 'https://api.example/v1/chat/completions?key=x', 'file:///chat/completions', 'https://api.example/other']) assert.throws(() => validateAiEndpoint(url));

  const dom = new JSDOM('<!doctype html>');
  const previous = {document: globalThis.document, DOMParser: globalThis.DOMParser};
  Object.assign(globalThis, {document: dom.window.document, DOMParser: dom.window.DOMParser});
  try {
    const body = '# 标题\n\n重复段落，标点不变。\n\n重复段落，标点不变。\n\n- 一级\n  - 二级\n\n> 引用 **重点**\n\n```ts\n  const x = "<safe>";\n\tcode();\n```\n\n[链接][ref]\n\n[ref]: https://example.com/path\n';
    const root = document.createElement('section'); root.innerHTML = micromark(body);
    const diagnosticHtml = '<p>正文 <a href="https://example.com">链接文字</a></p><pre><code>  code</code></pre><img src="https://example.com/image.png">';
    assert.deepEqual(compareWechatReadback(diagnosticHtml, diagnosticHtml), []);
    assert.match(compareWechatReadback(diagnosticHtml, diagnosticHtml.replace('<a href="https://example.com">链接文字</a>', '链接文字'))[0], /链接/);
    assert.ok(compareWechatReadback(diagnosticHtml, diagnosticHtml.replace('  code', 'code')).some(warning => warning.includes('文字')));
    assert.ok(compareWechatReadback(diagnosticHtml, diagnosticHtml.replace('image.png', 'other.png')).some(warning => warning.includes('图片')));
    assert.deepEqual(compareWechatReadback('<p>图</p><img src="http://mmbiz.qpic.cn/mmbiz_jpg/assetA/0?from=appmsg">', '<p>图</p><img data-src="https://mmbiz.qpic.cn/mmbiz_jpg/assetA/640?from=appmsg&amp;wx_fmt=jpg">'), []);
    assert.ok(compareWechatReadback('<img src="http://mmbiz.qpic.cn/mmbiz_jpg/assetA/0">', '<img data-src="https://mmbiz.qpic.cn/mmbiz_jpg/assetB/640">').some(warning => warning.includes('图片')));
    sanitizeWechatHtml(root, []);
    const source = extractWechatBlocks(body);
    assert.equal(new Set(source.blocks.map(b => b.id)).size, source.blocks.length);
    assert.notEqual(source.blocks[1].id, source.blocks[2].id);
    assert.deepEqual(extractWechatBlocks(body), source);
    const content = () => Array.from(root.querySelectorAll('h1,p,li,blockquote,code,a,img')).map(el => [el.tagName, el.textContent, el.getAttribute('href'), el.getAttribute('src')]);
    const before = content();
    const mapped = await bindWechatBlocks(body, body, root, async (markdown, target) => { target.innerHTML = micromark(markdown); return !sanitizeWechatHtml(target, []).length; });
    assert.equal(mapped.document.blocks.length, source.blocks.length);
    assert.deepEqual(content(), before);
    const semantic = themePlan(mapped.document, 'research', 'blue');
    semantic.blocks = [{id: mapped.document.blocks[1].id, role: 'lead', component: 'intro', locked: true},
      {id: mapped.document.blocks[3].id, role: 'key-point', component: 'highlight-card'}];
    for (const theme of Object.keys(WECHAT_THEMES) as Array<keyof typeof WECHAT_THEMES>) {
      applyWechatLayout(root, mapped.document, mapped.bindings, {...semantic, theme});
      assert.deepEqual(content(), before, 'Every theme must preserve text, heading, quote, list, link and code content/order');
      assert.equal(root.querySelectorAll('script,style,[onclick],[class]').length, 0);
      applyWechatLayout(root, mapped.document, mapped.bindings, {...semantic, theme, accentColor: 'preset'});
      assert.deepEqual(content(), before, 'Curated palettes must preserve article content');
      assert.ok(themePalette(theme, 'preset').accent.startsWith('#'));
    }
    assert.equal(Object.keys(WECHAT_THEMES).length, 12);
    assert.equal(new Set(Object.keys(WECHAT_THEMES).map(theme => JSON.stringify(themeStyles(theme as any, 'preset')))).size, 12, 'All presets must have distinct output styles');
    const baseline = contentFingerprint(root);
    assert.ok(layoutPreview(root.outerHTML, mapped.document, semantic).includes('border'));
    assert.equal(contentFingerprint(root), baseline, 'Candidate preview cannot modify live DOM');
    for (const invalid of [{...semantic, css: 'unsafe'}, {...semantic, schemaVersion: 2}, {...semantic, theme: 'unknown'},
      {...semantic, blocks: [semantic.blocks[0], semantic.blocks[0]]}, {...semantic, blocks: [{...semantic.blocks[0], id: 'b-999-0000000000000000'}]},
      {...semantic, blocks: [{id: mapped.document.blocks.find(b => b.kind === 'code')!.id, role: 'lead', component: 'intro'}]},
      {...semantic, blocks: [{...semantic.blocks[0], role: 'body'}]}]) assert.throws(() => validateWechatLayout(invalid, mapped.document));
    assert.throws(() => readWechatLayoutPlan({...semantic, blocks: [{...semantic.blocks[0], text: 'new text'}]}));
    const outdated = {...semantic, documentHash: '0'.repeat(64)};
    const outcome = applyWechatLayout(root, mapped.document, mapped.bindings, outdated);
    assert.match(outcome.notice!, /过期/);
    assert.deepEqual(content(), before);
    const locks = mergeLockedLayout({...semantic, blocks: []}, semantic, mapped.document);
    assert.deepEqual(locks.blocks, [semantic.blocks[0]]);
    const saved = readWechatArticleSettings({layout: semantic, layoutHistory: [semantic]});
    assert.deepEqual(saved.layout, semantic); assert.equal(saved.layoutHistory?.length, 1);
    const messages = plannerMessages('title', mapped.document, 'auto', semantic);
    const payload = messages[1].content;
    assert.ok(!payload.includes('const x'));
    assert.ok(!payload.includes('https://example.com'));
    assert.ok(payload.includes('code preserved'));
    const redacted = plannerMessages('参考 https://private.example/token', {...mapped.document, blocks: [{...mapped.document.blocks[1], text: '访问 https://private.example/token?key=hidden 查看信息。'}]}, 'auto')[1].content;
    assert.ok(!redacted.includes('private.example') && redacted.includes('[link]'));
    const config = normalizeAiSettings({endpoint: 'https://api.example/v1/chat/completions', model: 'configured-model'});
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;
    const transport = async (request: any) => {
      assert.equal(request.headers.Authorization, 'Bearer private-test-key');
      const sent = JSON.parse(request.body);
      assert.equal(sent.response_format.type, 'json_object');
      assert.equal(sent.messages[1].content, payload);
      return {status: 200, arrayBuffer: bytes({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({...semantic, blocks: [semantic.blocks[1]]})}}]})};
    };
    const planned = await planWechatLayout(config, 'private-test-key', messages, mapped.document, semantic, transport);
    assert.ok(planned.blocks.some(block => block.id === semantic.blocks[1].id && block.component === 'highlight-card'), 'A valid model decision must reach the semantic layout');
    assert.deepEqual(planned.blocks.find(block => block.locked), semantic.blocks[0], 'AI cannot override manual locks');
    const cached = await planWechatLayout(config, 'private-test-key', messages, mapped.document, semantic, async () => { throw Error('Must not request network on cache hit'); });
    assert.deepEqual(cached, planned);
    assert.notEqual(cached, planned);
    for (const [response, pattern] of [
      [{status: 401, arrayBuffer: bytes({error: 'private-test-key'})}, /HTTP 401/],
      [{status: 200, arrayBuffer: new ArrayBuffer(300000)}, /256 KB/],
      [{status: 200, arrayBuffer: bytes({choices: [{finish_reason: 'length', message: {content: '{}'}}]})}, /完整/],
    ] as const) await assert.rejects(requestWechatPlan(config, 'private-test-key', messages, async () => response), pattern);
    await assert.rejects(requestWechatPlan(config, '', messages, async () => { throw new Error('private secret and url'); }), error => !String(error).includes('private secret'));
    await assert.rejects(requestWechatPlan(config, '', messages, () => new Promise(() => {}), 5), /超时/);
    await assert.rejects(planWechatLayout(config, '', messages, mapped.document, undefined, async () => ({status: 200, arrayBuffer: bytes({choices: [{finish_reason: 'stop', message: {content: '{invalid'}}]})})), /JSON/);
    const changed = {...mapped.document, hash: '1'.repeat(64)};
    assert.throws(() => validateWechatLayout(semantic, changed), /过期/);
    const long = '# 长文\n\n' + Array.from({length: 80}, (_, i) => `第 ${i} 段。${'长文'.repeat(90)}`).join('\n\n');
    const longSource = extractWechatBlocks(long);
    const longDoc = {hash: longSource.hash, blocks: longSource.blocks.map(b => ({...b, text: b.markdown}))};
    assert.ok(Buffer.byteLength(JSON.stringify(plannerMessages('long', longDoc, 'auto'))) < 65536);
    const unmapped = document.createElement('section'); unmapped.innerHTML = '<p>different host rendering</p>';
    const fallback = await bindWechatBlocks('plain', 'plain', unmapped, async (_md, target) => {target.innerHTML = '<p>plain</p>'; return true;});
    assert.equal(fallback.document.blocks.length, 0);
    assert.equal(unmapped.innerHTML, '<p>different host rendering</p>');
  } finally { Object.assign(globalThis, previous); dom.window.close(); }
  const settings = normalizeSettings(null), fingerprint = publishSettingsFingerprint(settings, 'hexo');
  settings.wechatAi = normalizeAiSettings({endpoint: 'https://example.com/v1/chat/completions', encryptedKey: 'private'});
  assert.equal(publishSettingsFingerprint(settings, 'hexo'), fingerprint);
  console.log('WeChat layout fidelity, schema, locks, AI boundaries, config recovery and historical preview tests passed');
}
