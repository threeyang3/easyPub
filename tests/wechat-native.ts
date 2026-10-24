// Run inside Obsidian through the CLI; no vault files or account data are changed.
import { App, Component } from "obsidian";
import { renderWechatDocument } from "../utils/wechatRenderer";
import { loadWechatImage, processWechatImage, releaseWechatImages } from "../utils/wechatImages";
import { encryptWechatSecret, decryptWechatSecret } from "../utils/wechatSecret";
import { changedSpan, wechatReadableHtml } from "../utils/wechatComparison";
import { themePlan } from "../utils/wechatLayoutEngine";
import { WECHAT_THEMES } from "../utils/wechatThemes";
import { WechatThemeId } from "../types";

export async function run(app: App) {
  const checks: string[] = [];
  const assert = (condition: unknown, name: string) => { if (!condition) throw new Error(name); checks.push(name); };
  const component = new Component(); component.load();
  try {
    const localOnly = await renderWechatDocument(app, '<img src="https://example.com/no-request.png">', '', component, () => false);
    assert(localOnly.issues.some(issue => issue.includes('原始 HTML')) && localOnly.images.length === 0, 'local-only raw HTML blocked before host rendering');
    let permissionChecks = 0;
    const switched = await renderWechatDocument(app, '<img src="https://example.com/no-request.png">', '', component, () => permissionChecks++ === 0);
    assert(switched.issues.some(issue => issue.includes('原始 HTML')), 'permission change during preparation blocks raw HTML');
    const markdown = '# 标题\n\n段落 **加粗**\n\n- 一级\n  - 二级\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts\n    const x = 1;\n' + 'long'.repeat(100) + '\n```\n\n[[不存在的内部链接|可读名称]]';
    const doc = await renderWechatDocument(app, markdown, "", component);
    const html = new DOMParser().parseFromString(doc.html, 'text/html');
    assert(doc.issues.length === 0, 'native supported Markdown preflight: ' + doc.issues.join(';'));
    assert(html.querySelectorAll('table tr').length === 2, 'native table');
    assert(Boolean(html.querySelector('ul ul')), 'native nested lists');
    assert(Array.from(html.querySelectorAll('ul,ol')).every(list=>Array.from(list.childNodes).every(n=>n.nodeType===1)), 'no whitespace list children sent to WeChat');
    assert(html.querySelector('pre code')?.textContent?.includes('    const x = 1;'), 'native code indentation');
    assert(html.body.textContent?.includes('可读名称') && !html.querySelector('.internal-link'), 'native internal link readable');
    assert((doc.layoutDocument?.blocks.length ?? 0) >= 5, 'native source blocks match rendered DOM including table and internal link');
    const layout = themePlan(doc.layoutDocument!, 'research', 'blue');
    const paragraph = doc.layoutDocument!.blocks.find(block => block.kind === 'paragraph')!;
    layout.blocks.push({id: paragraph.id, role: 'lead', component: 'intro', locked: true});
    const themed = await renderWechatDocument(app, markdown, '', component, () => true, layout);
    const themedHtml = new DOMParser().parseFromString(themed.html, 'text/html');
    const tokens = (doc: Document) => Array.from(doc.querySelectorAll('h1,h2,p,li,code,a,img,td,th')).map(el => [el.tagName, el.textContent, el.getAttribute('src'), el.getAttribute('href')]);
    assert(JSON.stringify(tokens(html)) === JSON.stringify(tokens(themedHtml)), 'native semantic layout preserves complete content and order');
    assert(!themed.layoutNotice && themed.html.includes('border-left:3px solid #285c91'), 'native semantic component applied with controlled style');
    for (const theme of Object.keys(WECHAT_THEMES) as WechatThemeId[]) {
      const plan = {...layout, theme, accentColor: 'preset' as const};
      const variant = await renderWechatDocument(app, markdown, '', component, () => true, plan);
      assert(!variant.layoutNotice && !variant.issues.length && JSON.stringify(tokens(html)) === JSON.stringify(tokens(new DOMParser().parseFromString(variant.html, 'text/html'))), `native ${theme} preset preserves content through complete renderer`);
    }
    const longMarkdown = '长'.repeat(20001);
    const longBase = await renderWechatDocument(app, longMarkdown, '', component);
    const longThemed = await renderWechatDocument(app, longMarkdown, '', component, () => true, themePlan(longBase.layoutDocument!, 'noir', 'preset'));
    assert(longThemed.issues.some(issue => issue.includes('排版后的正文超过')) && !longThemed.layoutNotice,
      'native oversized themed article is blocked after layout');
    assert(new DOMParser().parseFromString(longThemed.html, 'text/html').body.textContent === longMarkdown,
      'native length rejection never truncates the article');
    const edited = await renderWechatDocument(app, markdown + '\n\n新段落', '', component, () => true, layout);
    assert(edited.layoutNotice?.includes('过期'), 'native stale layout safely falls back after body edit');
    const unsupported = await renderWechatDocument(app, '$$x^2$$\n\n![[不存在的笔记]]\n\n<audio src="test.mp3"></audio>', '', component);
    assert(unsupported.issues.length >= 2, 'unsupported content blocked');
    const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 20;
    canvas.getContext('2d')!.fillRect(0, 0, 40, 20);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/jpeg'));
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    for (const purpose of ['body', 'cover'] as const) {
      let allowed = true;
      const created: string[] = [], revoked: string[] = [];
      const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
      URL.createObjectURL = value => {
        const url = create.call(URL, value); created.push(url);
        allowed = false; // Download has finished; native decoding is beginning.
        return url;
      };
      URL.revokeObjectURL = url => { revoked.push(url); revoke.call(URL, url); };
      try {
        let rejected = false;
        try { await loadWechatImage(app, 'https://example.com/test.jpg', '', purpose, () => allowed, async () => jpeg); }
        catch (error) { rejected = (error as Error).message.includes('处理结果已丢弃'); }
        assert(rejected && created.length >= 2 && created.every(url => revoked.includes(url)), `native ${purpose} decode permission race releases all URLs`);
      } finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
    }
    // EXIF IFD0 orientation=6 rotates 40x20 to 20x40.
    const exif = new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
    const oriented = new Uint8Array(jpeg.length + exif.length); oriented.set(jpeg.slice(0,2)); oriented.set(exif,2); oriented.set(jpeg.slice(2),2+exif.length);
    const result = await processWechatImage('orientation.jpg', oriented, 'body');
    try { assert(result.width === 20 && result.height === 40, 'native EXIF orientation'); } finally { releaseWechatImages([result]); }
    canvas.width = 400; canvas.height = 12000;
    canvas.getContext('2d')!.fillRect(0, 0, 400, 12000);
    const longBlob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
    const original = new Uint8Array(await longBlob.arrayBuffer()), before = original.slice();
    const long = await processWechatImage('long.png', original, 'body');
    try {
      assert(long.height <= 8192 && Math.abs(long.width / long.height - 400 / 12000) < 0.001, 'native long screenshot proportional resize');
      assert(original.every((value, index) => value === before[index]), 'original attachment bytes preserved');
    } finally { releaseWechatImages([long]); }
    let rejected = false;
    try { await processWechatImage('broken.png', new Uint8Array([137,80,78,71,13,10,26,10]), 'body'); } catch { rejected = true; }
    assert(rejected, 'native corrupt image rejected');
    const text = wechatReadableHtml('<p>第一段</p><img src="x" alt="图"><script>bad()</script><p>第二段</p>');
    assert(text.includes('[图片：图]') && !text.includes('bad()'), 'comparison strips executable content');
    assert(changedSpan('甲😀乙','甲🙂乙')[1] === '😀', 'comparison Unicode boundaries');
    const encrypted = encryptWechatSecret('easypub-test-not-a-real-secret');
    if (encrypted) assert(decryptWechatSecret(encrypted) === 'easypub-test-not-a-real-secret', 'native system encryption roundtrip');
    return { checks, secretStorage: encrypted ? 'system encryption available' : 'session-only fallback', vaultWrites: 0, wechatRequests: 0 };
  } finally { component.unload(); }
}
