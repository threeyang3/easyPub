import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TFile } from "obsidian";
import EasyPub from "../main";
import { PLATFORMS, WechatArticle, WechatImage } from "../types";
import { normalizeSettings, publishSettingsFingerprint } from "../utils/settings";
import { centeredCrop, cropCoordinates, readWechatArticleSettings, remoteFingerprint, wechatAssetKey, wechatHash, wechatStateKey } from "../utils/wechatState";
import { prepareWechatMarkdown, rebaseWechatImages, transformMarkdownImages, transformWechatWikiImages } from "../utils/wechatMarkdown";
import { imageMime, processWechatImage, isAnimatedWechatImage, readWechatImage } from "../utils/wechatImages";
import { changedSpan } from "../utils/wechatComparison";
import { digestFromWechatHtml, normalizeWechatHtml, previewWechatHtml } from "../utils/wechatRenderer";
import { WechatApi, WechatApiError, WechatRequest, WechatUncertainError } from "../utils/wechatApi";
import { validateWechatArticle, WechatSync, WechatSyncInput } from "../utils/wechatSync";
import { parseFrontMatter } from "../utils/frontMatter";
import { DiffModal } from "../modals/DiffModal";

const image = (source = "assets/p.png", bytes = "image"): WechatImage => ({ source, bytes: Buffer.from(bytes), hash: wechatHash(bytes), originalHash: wechatHash(bytes),
  width: 1200, height: 800, mime: "image/png", previewUrl: `blob:${source}`, originalSize: bytes.length });

async function testMarkdownAndHtml() {
  const body = "![alt [nested]](../a.png)\n![ref][pic]\n\n[pic]: https://example.com/p.png\n`![code](ignore.png)`\n```md\n![code](ignore2.png)\n```";
  const calls: string[] = [];
  const transformed = await transformMarkdownImages(body, async source => { calls.push(source); return "<img>"; });
  assert.deepEqual(calls, ["../a.png", "https://example.com/p.png"]);
  assert.match(transformed, /`!\[code\]\(ignore.png\)`/);
  const prepared = await prepareWechatMarkdown("![[a.png|200]]\n![[note]]\n![local](b.png)\n`![[sample.png]]`", async source => {
    if (source === "b.png") throw new Error("missing");
    return "blob:good";
  });
  assert.match(prepared.markdown, /blob:good/);
  assert.equal(prepared.issues.length, 2);
  assert.match(prepared.markdown, /`!\[\[sample.png\]\]`/);
  const examples = "> ```md\n> ![[quoted.png]]\n> ```\n\n`multi\n![[inline.png]]\nline`\n\n\\![[escaped.png]]\n\n![[actual.png]]";
  const wikiCalls: string[] = [];
  const transformedWiki = await transformWechatWikiImages(examples, async source => { wikiCalls.push(source); return "IMAGE"; });
  assert.deepEqual(wikiCalls, ["actual.png"]);
  assert.match(transformedWiki, /!\[\[quoted.png\]\]/);
  const attachment = Object.assign(new TFile(), { path: "assets/a (图)#1.png", basename: "a", extension: "png" });
  const contexts: string[] = [];
  const app = { metadataCache: { getFirstLinkpathDest: (_p: string, context: string) => { contexts.push(context); return attachment; } } } as any;
  const rebased = await rebaseWechatImages(app, "![[a.png]]\n![a](./a.png)\n`![x](x.png)`", "source/a.md", "发布/微信公众号/a.md");
  assert.equal(contexts.every(context => context === "source/a.md"), true);
  assert.match(rebased, /\.\.\/\.\.\/assets\/a%20%28/);
  assert.match(rebased, /%231.png/);
  assert.match(rebased, /`!\[x\]\(x.png\)`/);

  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const previous = (globalThis as any).document;
  const previousParser = (globalThis as any).DOMParser;
  (globalThis as any).DOMParser = dom.window.DOMParser;
  (globalThis as any).document = dom.window.document;
  try {
    const container = document.createElement("section");
    const img = image();
    container.innerHTML = '<div class="metadata-container">properties</div><h2 onclick="bad()">Heading</h2><a class="internal-link" href="source.md">Internal</a><p>Text</p><pre><button class="copy-code-button">Copy</button><code>    a\n\t b</code></pre><img src="blob:assets/p.png" onerror="bad()"><iframe src="https://example.com"></iframe><script>bad()</script>';
    const issues = normalizeWechatHtml(container, [img]);
    assert.equal(issues.length, 1);
    assert.equal(container.querySelectorAll("iframe,script,button,a,[onclick],[onerror],.metadata-container").length, 0);
    assert.match(container.textContent!, /Internal/);
    assert.equal(container.querySelector("code")!.textContent, "    a\n\t b");
    assert.equal(container.querySelector("img")!.getAttribute("src"), `easy-pub-image://${img.hash}`);
    assert.match(previewWechatHtml(container.outerHTML, [img]), /blob:assets\/p.png/);
    assert.equal(container.querySelector("h2")!.hasAttribute("style"), true);
    assert.equal(container.querySelectorAll("[class],[id]").length, 0);
    container.innerHTML = '<ul>\n<li>第一项<ol start="3">\n<li>子项</li>\n</ol></li>\n<li>第二项<pre><code>  保留\n  缩进</code></pre></li>\n</ul>';
    normalizeWechatHtml(container, []);
    assert.equal(container.querySelectorAll('li').length, 3);
    for (const list of Array.from(container.querySelectorAll('ul,ol'))) assert.ok(Array.from(list.childNodes).every(n=>n.nodeType===1));
    assert.equal(container.querySelector('code')!.textContent, '  保留\n  缩进');
    assert.equal(container.querySelector('ol')!.getAttribute('start'), '3');
    assert.equal(digestFromWechatHtml('<h1>标题</h1><p>真正的<strong>正文</strong>与<a>链接名称</a>。</p><ul><li>列表项目</li></ul><table><tr><td>表格</td></tr></table><pre>代码</pre>'), '真正的正文与链接名称。');
    assert.equal(digestFromWechatHtml('<ul><li>甲</li><li>乙</li></ul>'), '甲 乙');
  } finally { (globalThis as any).document = previous; (globalThis as any).DOMParser = previousParser; dom.window.close(); }
  assert.equal(imageMime(Buffer.from("GIF89aabc")), "image/gif");
  await assert.rejects(processWechatImage("a.gif", Buffer.from("GIF89aabc"), "body"), /JPG\/PNG/);
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.from([0,0,0,8]), Buffer.from('acTL'), Buffer.alloc(12)]);
  assert.equal(isAnimatedWechatImage(png, 'image/png'), true);
  await assert.rejects(processWechatImage('animated.png', png, 'body'), /动画/);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8X'), Buffer.from([10,0,0,0,2]), Buffer.alloc(9)]);
  assert.equal(isAnimatedWechatImage(webp, 'image/webp'), true);
  await assert.rejects(processWechatImage('animated.webp', webp, 'cover'), /动画/);
  webp[20] = 0;
  assert.equal(isAnimatedWechatImage(webp, 'image/webp'), false);
  assert.equal(isAnimatedWechatImage(Buffer.from([137,80,78]), 'image/png'), false);
  assert.deepEqual(changedSpan('甲😀乙', '甲🙂乙'), ['甲','😀','乙']);
  assert.deepEqual(changedSpan('同文', '同文'), ['同文','','']);
  assert.deepEqual(changedSpan('', '新增'), ['','','']);
  // Local resolution must use the selected draft's context, including same-name attachments.
  const first = Object.assign(new TFile(), { path:'a/p.png', extension:'png' });
  const second = Object.assign(new TFile(), { path:'b/p.png', extension:'png' });
  const vault = { metadataCache: { getFirstLinkpathDest: (_p: string, context: string) => context === 'a/draft.md' ? first : second },
    vault: { readBinary: async (file: TFile) => Buffer.from(file.path) } } as any;
  assert.equal((await readWechatImage(vault, 'p.png', 'b/draft.md')).localPath, 'b/p.png');
  await assert.rejects(readWechatImage(vault, 'file:///outside.png', 'b/draft.md'), /仅支持/);
}

async function testApi() {
  const requests: WechatRequest[] = [];
  let expired = false;
  const api = new WechatApi("appid", "PRIVATE_SECRET", async request => {
    requests.push(request);
    if (request.url.endsWith("stable_token")) return { status: 200, json: { access_token: "token", expires_in: 7200 } };
    if (request.url.includes("draft/get") && !expired) { expired = true; return { status: 200, json: { errcode: 42001 } }; }
    if (request.url.includes("draft/get")) return { status: 200, json: { news_item: [{ title: "A" }] } };
    if (request.url.includes("add_material")) return { status: 200, json: { media_id: "cover", url: "https://mmbiz.qpic.cn/cover" } };
    if (request.url.includes("get_material?")) return { status: 200, json: null };
    return { status: 200, json: { errcode: 0, url: "https://mmbiz.qpic.cn/body" } };
  });
  assert.equal((await api.getDraft("draft")).length, 1);
  assert.equal(requests.filter(request => request.url.endsWith("stable_token")).length, 2);
  await api.upload(image(), false); await api.upload(image(), true); await api.materialExists("cover");
  const coverRequest = requests.find(request => request.url.includes("add_material"))!;
  assert.match(coverRequest.url, /type=image/);
  const multipart = Buffer.from(coverRequest.body as ArrayBuffer).toString();
  assert.match(multipart, /name="media"/);
  assert.match(multipart, /image\/png/);
  assert.equal(requests.filter(request => !request.url.endsWith("stable_token")).some(request => JSON.stringify(request).includes("PRIVATE_SECRET")), false);
  const failing = new WechatApi("app", "SECRET", async request => {
    if (request.url.endsWith("stable_token")) return { status: 200, json: { access_token: "SENSITIVE_TOKEN", expires_in: 7200 } };
    throw new Error(`network ${request.url}`);
  });
  await assert.rejects(failing.addDraft({} as WechatArticle), error => error instanceof WechatUncertainError && !error.message.includes("SENSITIVE_TOKEN"));
  let permissionCalls = 0;
  const denied = new WechatApi("app", "secret", async request => {
    if (request.url.endsWith("stable_token")) return { status: 200, json: { access_token: "t", expires_in: 7200 } };
    permissionCalls++; return { status: 200, json: { errcode: 48001 } };
  });
  await assert.rejects(denied.addDraft({} as WechatArticle), /权限/);
  assert.equal(permissionCalls, 1, "Explicit permission rejection must not retry a write");
  const beforeWrites = requests.filter(request => request.url.includes("draft/add")).length;
  await assert.rejects(api.addDraft({} as WechatArticle, async () => { throw new Error("snapshot changed after token refresh"); }), /snapshot changed/);
  assert.equal(requests.filter(request => request.url.includes("draft/add")).length, beforeWrites);
  const late = new WechatApi("app", "secret", async request => {
    if (request.url.endsWith("stable_token")) return { status: 200, json: { access_token: "t", expires_in: 7200 } };
    await new Promise(resolve => setTimeout(resolve, 30));
    return { status: 200, json: { media_id: "late-id" } };
  });
  const send = (late as any).send.bind(late);
  (late as any).send = (request: WechatRequest) => send(request, 5);
  await assert.rejects(late.addDraft({} as WechatArticle), WechatUncertainError);
  await new Promise(resolve => setTimeout(resolve, 40));
}

async function testSync() {
  const settings = normalizeSettings(null).wechat; settings.appId = "app";
  const body = image(), cover = image("cover.png", "cover");
  let remote: unknown[] = [], writes = 0, uploads = 0, saves = 0, fresh = true;
  const api = {
    getDraft: async () => remote,
    addDraft: async (article: WechatArticle) => { writes++; remote = [article]; return "draft"; },
    updateDraft: async (_id: string, article: WechatArticle) => { writes++; remote = [article]; },
    upload: async (_img: WechatImage, isCover: boolean) => { uploads++; return { url: `https://mmbiz.qpic.cn/${isCover ? "cover" : "body"}`, ...(isCover ? { mediaId: "cover-id" } : {}) }; },
    materialExists: async () => {},
  };
  const input: WechatSyncInput = { pubId: "pub", html: `<img src="easy-pub-image://${body.hash}">`, images: [body, body], cover,
    article: { title: "Edited local draft", digest: "Local", cropWide: centeredCrop(1200, 800, 2.35), cropSquare: centeredCrop(1200, 800, 1) },
    assertFresh: async () => { if (!fresh) throw new Error("changed"); }, progress: () => {}, conflict: async () => "cancel" };
  const sync = new WechatSync(api, settings, async () => { saves++; });
  assert.equal(await sync.sync(input), "draft");
  assert.equal(writes, 1); assert.equal(uploads, 2, "Repeated body images upload only once; cover cache is separate");
  assert.equal(settings.drafts["app:pub"].uncertain, undefined);
  const result = remote[0] as WechatArticle;
  assert.equal(result.title, "Edited local draft");
  assert.equal(result.cover_info.crop_percent_list.length, 2);
  assert.match(result.content, /https:\/\/mmbiz/); assert.doesNotMatch(result.content, /easy-pub-image/);
  assert.equal(await sync.sync(input), "draft"); assert.equal(writes, 2); assert.equal(uploads, 2);
  remote = [{ ...result, title: "Backend edit" }];
  assert.equal(await sync.sync(input), null); assert.equal(writes, 2);
  assert.equal(await sync.sync({ ...input, conflict: async () => "overwrite" }), "draft"); assert.equal(writes, 3);
  fresh = false; await assert.rejects(sync.sync(input), /changed/); assert.equal(writes, 3); fresh = true;

  settings.drafts["app:pub"].uncertain = true;
  await assert.rejects(sync.sync(input), WechatUncertainError); assert.equal(writes, 3);
  delete settings.drafts["app:pub"];
  const uncertain = new WechatSync({ ...api, addDraft: async () => { throw new WechatUncertainError(); } }, settings, async () => {});
  await assert.rejects(uncertain.sync(input), WechatUncertainError);
  assert.equal(settings.drafts["app:pub"].uncertain, true);
  delete settings.drafts["app:pub"];
  const denied = new WechatSync({ ...api, addDraft: async () => { throw new WechatApiError(48001); } }, settings, async () => {});
  await assert.rejects(denied.sync(input), /权限/);
  assert.equal(settings.drafts["app:pub"].uncertain, false);
  assert.ok(saves > 0);

  delete settings.drafts["app:pub"];
  let staleCover = true;
  const replaced = new WechatSync({ ...api, materialExists: async () => { if (staleCover) { staleCover = false; throw new WechatApiError(46001); } } }, settings, async () => {});
  await replaced.sync(input); assert.equal(uploads, 3, "A deleted permanent cover must be uploaded again");
  settings.drafts["app:pub"].fingerprint = remoteFingerprint(remote);
  const missing = new WechatSync({ ...api, getDraft: async () => { throw new WechatApiError(46001); } }, settings, async () => {});
  assert.equal(await missing.sync(input), null, "Missing drafts must not silently create a new draft");

  const changedDuringUpload = normalizeSettings(null).wechat; changedDuringUpload.appId = "new";
  const changedSync = new WechatSync({ ...api, upload: async (...args: [WechatImage, boolean]) => { fresh = false; return api.upload(...args); } }, changedDuringUpload, async () => {});
  await assert.rejects(changedSync.sync(input), /changed/); fresh = true;
  assert.equal(changedDuringUpload.drafts["new:pub"], undefined);

  const partial = normalizeSettings(null).wechat; partial.appId = 'partial';
  let bodyCalls = 0, failCover = true;
  const partialSync = new WechatSync({ ...api, upload: async (img: WechatImage, isCover: boolean) => {
    if (!isCover) bodyCalls++;
    if (isCover && failCover) throw new Error('upload failed');
    return api.upload(img, isCover);
  } }, partial, async () => {});
  await assert.rejects(partialSync.sync(input), /upload failed/);
  assert.ok(partial.assets[wechatAssetKey('partial','body',body.hash)]);
  failCover = false; await partialSync.sync(input);
  assert.equal(bodyCalls, 1, 'Retry reuses the successful body upload');

  const readback = normalizeSettings(null).wechat; readback.appId = 'readback';
  const readbackSync = new WechatSync({ ...api, getDraft: async () => { throw new Error('readback failed'); } }, readback, async () => {});
  await assert.rejects(readbackSync.sync(input), /readback failed/);
  assert.equal(readback.drafts['readback:pub'].mediaId, 'draft');
  assert.equal(readback.drafts['readback:pub'].uncertain, true);
  await assert.rejects(readbackSync.sync(input), WechatUncertainError);

  const changeDuringSave = normalizeSettings(null).wechat; changeDuringSave.appId = "save-race";
  const beforeWrites = writes;
  const saveRace = new WechatSync(api, changeDuringSave, async () => {
    if (changeDuringSave.drafts["save-race:pub"]?.uncertain) fresh = false;
  });
  await assert.rejects(saveRace.sync(input), /changed/); fresh = true;
  assert.equal(writes, beforeWrites, "A change during durable pre-write save must prevent sending the draft");
}

async function testDraftIsolation() {
  const plugin = Object.create(EasyPub.prototype) as EasyPub;
  plugin.settings = normalizeSettings({ imageHandling: "picgo" });
  const source = Object.assign(new TFile(), { path: "source/a.md", basename: "a", extension: "md" });
  const draft = Object.assign(new TFile(), { path: "发布/微信公众号/a.md", basename: "a", extension: "md" });
  const sourceText = "---\npub_id: shared\n---\nSource changed";
  const local = "---\npub_id: shared\nsource_file: '[[source/a]]'\nwechat:\n  author: local-author\n---\nEdited local draft";
  let opened = "", writes = 0, uploaded = 0;
  Object.assign(plugin, { app: { workspace: { getActiveFile: () => source }, vault: {
    read: async (file: TFile) => file === source ? sourceText : local,
    getAbstractFileByPath: () => draft,
  } } });
  plugin.findArticleByPubId = async () => draft.path;
  plugin.openPublishedFile = async path => { opened = path; };
  plugin.copyAndOpenForEdit = async () => { writes++; };
  (plugin as any).preparePicGoContent = async () => { uploaded++; throw new Error("Must not use PicGo"); };
  await plugin.preparePublish(PLATFORMS.find(p => p.id === "wechat")!);
  assert.equal(opened, draft.path); assert.equal(writes, 0); assert.equal(uploaded, 0);
  assert.equal(parseFrontMatter(local).content.trim(), "Edited local draft");
  // Explicit source refresh retains locally owned WeChat settings and still
  // passes through the existing confirmation modal before touching the draft.
  const originalOpen = DiffModal.prototype.open;
  let proposed = "";
  DiffModal.prototype.open = function () { proposed = (this as any).diff.sourceContent; };
  plugin.readPublishFile = async () => local;
  plugin.buildPublishedFrontMatter = async () => ({ pub_id: "shared", source_file: "[[source/a]]", wechat: { author: "source-author" } });
  try { await plugin.preparePublish(PLATFORMS.find(p => p.id === "wechat")!, true); }
  finally { DiffModal.prototype.open = originalOpen; (plugin as any).publishConfirmationOpen = false; }
  assert.equal(readWechatArticleSettings(parseFrontMatter(proposed).data.wechat).author, "local-author");
  assert.match(proposed, /Source changed/); assert.equal(writes, 0);
  // New drafts bypass global PicGo too, and rebase only their own image references.
  plugin.findArticleByPubId = async () => null;
  plugin.publishPathExists = async () => false;
  plugin.buildPublishedFrontMatter = async () => ({ pub_id: "shared", source_file: "[[source/a]]" });
  let generated = "";
  plugin.copyAndOpenForEdit = async diff => { generated = diff.sourceContent; };
  await plugin.preparePublish(PLATFORMS.find(p => p.id === "wechat")!);
  assert.equal(uploaded, 0); assert.match(generated, /Source changed/);
  assert.deepEqual(parseFrontMatter(generated).data.wechat, {});
}

export async function runWechatTests() {
  const configuring = Object.create(EasyPub.prototype) as EasyPub;
  configuring.settings = normalizeSettings(null);
  configuring.wechatCredentialRevision = 0;
  configuring.saveSettings = async () => {};
  assert.equal(configuring.hasWechatCredentials(), false);
  await assert.rejects(configuring.saveWechatConfiguration('new-app', '', ''), /AppSecret/);
  assert.equal(configuring.settings.wechat.appId, '');
  await configuring.saveWechatConfiguration('app-one', 'not-a-real-secret', 'Author');
  assert.equal(configuring.hasWechatCredentials(), true);
  await configuring.saveWechatConfiguration('app-one', '', 'New Author');
  assert.equal(configuring.settings.wechat.defaultAuthor, 'New Author');
  await assert.rejects(configuring.saveWechatConfiguration('app-two', '', ''), /AppSecret/);
  configuring.saveSettings = async () => { throw Error('disk failed'); };
  await assert.rejects(configuring.saveWechatConfiguration('app-two', 'different-secret', ''), /保存失败/);
  assert.equal(configuring.settings.wechat.appId, 'app-one');
  assert.equal((configuring as any).wechatSessionSecret, 'not-a-real-secret');
  configuring.wechatSyncInProgress = true;
  await assert.rejects(configuring.saveWechatConfiguration('app-one', '', ''), /同步任务/);
  const settings = normalizeSettings(null);
  const changed = normalizeSettings({ wechat: { appId: "different", defaultAuthor: "author", encryptedSecret: "cipher" } });
  assert.equal(publishSettingsFingerprint(settings), publishSettingsFingerprint(changed));
  assert.notEqual(wechatAssetKey("a", "body", "hash"), wechatAssetKey("a", "cover", "hash"));
  assert.notEqual(wechatStateKey("a", "id"), wechatStateKey("b", "id"));
  assert.deepEqual(readWechatArticleSettings({ title: "Local", cropWide: { x: -1, y: 0, width: 1, height: 1 } }), { title: "Local" });
  for (const [w, h] of [[1200, 800], [400, 3000], [4000, 200]]) {
    for (const ratio of [2.35, 1]) {
      const crop = centeredCrop(w, h, ratio, 3, 0.9, 0.1);
      assert.equal(cropCoordinates(crop, w, h, ratio).split("_").length, 4);
      assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001);
    }
  }
  assert.throws(() => validateWechatArticle({ title: "长".repeat(33) }), /32/);
  assert.throws(() => validateWechatArticle({ title: "ok", sourceUrl: "javascript:bad" }), /HTTP/);
  await testMarkdownAndHtml(); await testApi(); await testSync(); await testDraftIsolation();
  console.log("EasyPub WeChat tests passed");
}
