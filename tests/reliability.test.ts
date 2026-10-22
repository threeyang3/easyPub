import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { FileSystemAdapter, TFile } from "obsidian";
import EasyPub from "../main";
import { ArticleDiff, DEFAULT_SETTINGS, PLATFORMS } from "../types";
import { normalizeSettings, publishSettingsFingerprint } from "../utils/settings";
import { withTimeout } from "../utils/async";
import { isSourcePublishTarget, formatChildReference } from "../utils/platforms";
import { parseFrontMatter, parseYamlDocument, stringifyFrontMatter } from "../utils/frontMatter";
import { buildHexo, getHexoNodeExecutable, validateHexoDeployment } from "../utils/hexoCommands";
import { assertPublishIdentity, PublishIdentityIndex } from "../utils/publishIdentity";
import { inspectPublishDocuments } from "../utils/publishDiagnostics";
import { restorePicGoSecret, serializePicGoSettings } from "../utils/picgoSecret";
import { uploadWithPicGo, hasInsecurePicGoSecretTransport } from "../utils/picgo";
import { downloadWechatImage, validateImageDownloadUrl, ImageRequest } from "../utils/wechatDownload";
import { EventEmitter } from "events";

async function expectReportedFailure(action: () => Promise<unknown>) {
  const error = console.error;
  const warn = console.warn;
  const messages: unknown[][] = [];
  console.error = console.warn = (...args: unknown[]) => { messages.push(args); };
  try {
    await action();
    assert.ok(messages.length > 0, "Failure should be reported rather than silently ignored");
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

export async function runReliabilityTests() {
  for (const address of ['http://127.1/a', 'http://0x7f000001/a', 'http://10.0.0.1/a', 'http://[::1]/a', 'http://[::ffff:127.0.0.1]/a', 'http://localhost/a', 'http://host.local/a', 'https://user:pass@example.com/a', 'file:///a']) {
    assert.throws(() => validateImageDownloadUrl(address));
  }
  assert.equal(validateImageDownloadUrl('https://example.com/a').hostname, 'example.com');
  const downloadScenario = async (scenario: string) => {
    let aborted = 0, requests = 0;
    const run = downloadWechatImage('https://example.com/image', () => {
      const req = new EventEmitter() as EventEmitter & ImageRequest;
      requests++;
      req.abort = () => { aborted++; req.emit('error', new Error('abort')); };
      req.end = () => queueMicrotask(() => {
        if (scenario === 'timeout') return;
        if (scenario === 'private redirect') { req.emit('redirect', 302, 'GET', 'http://127.0.0.1/image'); return; }
        if (scenario === 'loop') { req.emit('redirect', 302, 'GET', 'https://example.com/loop'); return; }
        const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: scenario === 'header' ? { 'content-length': '100' } : {} });
        req.emit('response', response);
        response.emit('data', new Uint8Array([1, 2]));
        response.emit('data', new Uint8Array(scenario === 'stream' ? [3, 4, 5] : [3, 4]));
        response.emit('end');
      });
      return req;
    }, 4, 10);
    if (scenario === 'success') assert.deepEqual(await run, new Uint8Array([1, 2, 3, 4]));
    else { await assert.rejects(run); assert.ok(aborted > 0); }
    if (scenario === 'private redirect') assert.equal(requests, 1);
    if (scenario === 'loop') assert.equal(requests, 6);
  };
  for (const scenario of ['success', 'header', 'stream', 'timeout', 'private redirect', 'loop']) await downloadScenario(scenario);
  for (const url of ['http://localhost:36677', 'http://127.0.0.2:36677', 'http://[::1]:36677', 'https://remote.example/upload']) {
    assert.equal(hasInsecurePicGoSecretTransport(url, 'secret'), false);
  }
  for (const url of ['http://remote.example/upload', 'http://192.168.1.2/upload', 'http://localhost.example/upload']) {
    assert.equal(hasInsecurePicGoSecretTransport(url, 'secret'), true);
    assert.equal(hasInsecurePicGoSecretTransport(url, ''), false);
  }
  const legacyPicGo = normalizeSettings({ picgoServerSecret: "legacy-secret", picgoImageCache: { image: { hash: "a".repeat(64), url: "https://old.example/image.png" } } });
  const encryptedPicGo = serializePicGoSettings(legacyPicGo, value => `encrypted:${value.length}`);
  assert.equal(encryptedPicGo.picgoServerSecret, "");
  assert.equal(JSON.stringify(encryptedPicGo).includes("legacy-secret"), false);
  assert.deepEqual(encryptedPicGo.picgoImageCache, legacyPicGo.picgoImageCache);
  assert.equal(legacyPicGo.picgoServerSecret, "legacy-secret");
  assert.equal(serializePicGoSettings({ ...legacyPicGo, picgoEncryptedSecret: "existing" }, () => { throw new Error("Disabled saved credentials must not use encryption"); }).picgoEncryptedSecret, "existing");
  const restoredPicGo = normalizeSettings(encryptedPicGo);
  restorePicGoSecret(restoredPicGo, () => "legacy-secret");
  assert.equal(restoredPicGo.picgoServerSecret, "legacy-secret");
  assert.equal(publishSettingsFingerprint(restoredPicGo), publishSettingsFingerprint(legacyPicGo));
  assert.equal(serializePicGoSettings(legacyPicGo, () => "").picgoEncryptedSecret, "");
  const unavailablePicGo = normalizeSettings(encryptedPicGo);
  restorePicGoSecret(unavailablePicGo, () => "");
  assert.equal(serializePicGoSettings(unavailablePicGo, () => "").picgoEncryptedSecret, encryptedPicGo.picgoEncryptedSecret);
  unavailablePicGo.picgoEncryptedSecret = "";
  assert.equal(serializePicGoSettings(unavailablePicGo).picgoEncryptedSecret, "");
  const migratingPicGo = Object.create(EasyPub.prototype) as EasyPub;
  migratingPicGo.loadData = async () => ({ imageHandling: "picgo", picgoServerSecret: "legacy-secret" });
  let storedPicGo: any;
  migratingPicGo.saveData = async data => { storedPicGo = data; };
  await migratingPicGo.loadSettings();
  assert.equal(migratingPicGo.settings.picgoServerSecret, "legacy-secret");
  assert.equal(storedPicGo.picgoServerSecret, "");
  const writes: any[] = [];
  let finishFirst!: () => void;
  const firstWrite = new Promise<void>(resolve => { finishFirst = resolve; });
  migratingPicGo.saveData = async data => { writes.push(data); if (writes.length === 1) await firstWrite; };
  migratingPicGo.settings.picgoServerUrl = "http://localhost:36677/upload";
  const savingFirst = migratingPicGo.saveSettings();
  migratingPicGo.settings.picgoServerUrl = "http://localhost:36678/upload";
  const savingSecond = migratingPicGo.saveSettings();
  finishFirst();
  await Promise.all([savingFirst, savingSecond]);
  assert.deepEqual(writes.map(value => value.picgoServerUrl), ["http://localhost:36677/upload", "http://localhost:36678/upload"]);
  assert.ok(writes.every(value => value.picgoServerSecret === ""));
  migratingPicGo.saveData = async () => { throw new Error("disk full"); };
  await assert.rejects(migratingPicGo.saveSettings(), /disk full/);
  migratingPicGo.saveData = async data => { storedPicGo = data; };
  await migratingPicGo.saveSettings();
  migratingPicGo.settings.picgoServerSecret = "";
  migratingPicGo.settings.picgoEncryptedSecret = "unreadable";
  await assert.rejects((migratingPicGo as any).resolvePicGoUploads("text", [{ absolutePath: "image.png" }]), /无法解密/);
  for (const failRequest of [false, true]) {
    await assert.rejects(uploadWithPicGo(["file.png"], { serverUrl: "http://127.0.0.1:36677", secret: "sensitive-key" }, async () => {
      if (failRequest) throw new Error("Authorization: Bearer sensitive-key");
      return { status: 401, json: { message: "rejected sensitive-key" } };
    }), error => error instanceof Error && !error.message.includes("sensitive-key") && error.message.includes("已隐藏"));
  }
  const diagnosticContents = new Map([
    ['good.md', '---\npub_id: old-id\ncustom: keep\n---\nbody'],
    ['copy.md', '---\npub_id: old-id\n---\ncopy'],
    ['legacy.md', 'old document without metadata'],
    ['broken.md', '---\ntitle: [broken\n---\nbody'],
  ]);
  const beforeDiagnostics = [...diagnosticContents];
  const diagnosticDocuments = [...diagnosticContents].map(([path, text]) => ({ path, read: async () => text }));
  const diagnosticReport = await inspectPublishDocuments([
    ...diagnosticDocuments, diagnosticDocuments[0],
    { path: 'unreadable.md', read: async () => { throw new Error('denied'); } },
  ]);
  assert.equal(diagnosticReport.checked, 5);
  assert.deepEqual(diagnosticReport.issues.map(issue => issue.kind).sort(), ['duplicate', 'invalid', 'missing-id', 'unreadable']);
  assert.deepEqual(diagnosticReport.issues.find(issue => issue.kind === 'duplicate')?.paths, ['good.md', 'copy.md']);
  assert.deepEqual([...diagnosticContents], beforeDiagnostics);
  let diagnosticsCancelled = false;
  let diagnosticReads = 0;
  await assert.rejects(inspectPublishDocuments([
    { path: 'one.md', read: async () => { diagnosticReads++; diagnosticsCancelled = true; return 'body'; } },
    { path: 'two.md', read: async () => { diagnosticReads++; return 'body'; } },
  ], () => diagnosticsCancelled), /已取消/);
  assert.equal(diagnosticReads, 1);
  const diagnosticPlugin = Object.create(EasyPub.prototype) as EasyPub;
  diagnosticPlugin.settings = { ...DEFAULT_SETTINGS };
  const platformFiles = ['发布/知乎/文章/a.md', '发布/知乎/想法/b.md', '发布/微信公众号/c.md', '发布/知乎副本/d.md'];
  diagnosticPlugin.app = { vault: { getMarkdownFiles: () => platformFiles.map(path => ({ path })) } } as any;
  const diagnosticPaths: string[] = [];
  diagnosticPlugin.readPublishFile = async (_platform, path) => {
    diagnosticPaths.push(path);
    return '---\npub_id: shared-id\n---\nunchanged';
  };
  const scopedReport = await diagnosticPlugin.inspectPublishDirectory(PLATFORMS.find(platform => platform.id === 'zhihu')!);
  assert.deepEqual(diagnosticPaths, platformFiles.slice(0, 2).sort());
  assert.equal(scopedReport.checked, 2);
  assert.equal(scopedReport.issues.length, 1);
  const identityIndex = new PublishIdentityIndex();
  const indexedFiles = Array.from({ length: 200 }, (_, i) => Object.assign(new TFile(), {
    path: `notes/${i}.md`, stat: { mtime: 1, size: 100 },
  }));
  let indexedBody = '---\npub_id: unrelated\n---\nbody';
  let reads = 0;
  const indexedApp = { vault: {
    getMarkdownFiles: () => indexedFiles,
    read: async () => { reads++; return indexedBody; },
  } } as any;
  const checkIndexed = () => assertPublishIdentity(indexedApp, 'source.md', 'wanted', [], [], identityIndex);
  await checkIndexed();
  assert.equal(reads, 200);
  await checkIndexed();
  assert.equal(reads, 200, 'Unchanged unrelated notes should not be re-read');
  indexedBody = '---\npub_id: wanted\n---\nbody';
  identityIndex.invalidate(indexedFiles[0]); // Even when mtime and size are identical.
  await assert.rejects(checkIndexed(), /另一篇源文章/);
  const afterConflict = reads;
  await assert.rejects(checkIndexed(), /另一篇源文章/);
  assert.equal(reads, afterConflict + 1, 'Matching candidates must always be read again');
  indexedBody = '---\npub_id: unrelated\n---\nbody';
  await checkIndexed();
  indexedFiles[1].stat.mtime++;
  const beforeStatChange = reads;
  await checkIndexed();
  assert.equal(reads, beforeStatChange + 1);
  identityIndex.invalidate({}); // Folder rename invalidates all entries.
  const beforeFolderChange = reads;
  await checkIndexed();
  assert.equal(reads, beforeFolderChange + 200);
  identityIndex.clear();
  let invalidateDuringRead = true;
  indexedApp.vault.read = async () => {
    reads++;
    if (invalidateDuringRead) { invalidateDuringRead = false; identityIndex.invalidate(indexedFiles[0]); }
    return indexedBody;
  };
  await assert.rejects(checkIndexed(), /身份检查期间笔记发生变化/);
  const afterRacingRead = reads;
  await checkIndexed();
  assert.equal(reads, afterRacingRead + 1, 'In-flight invalidation must not install stale cache');
  identityIndex.clear();
  let changeIdentityDuringRead = true;
  indexedApp.vault.read = async () => {
    const snapshot = indexedBody;
    if (changeIdentityDuringRead) {
      changeIdentityDuringRead = false;
      indexedBody = '---\npub_id: wanted\n---\nbody';
      identityIndex.invalidate(indexedFiles[0]);
    }
    // Return old contents for this scan to simulate a read already in flight.
    return snapshot.replace('wanted', 'unrelated');
  };
  await assert.rejects(checkIndexed(), /身份检查期间笔记发生变化/);
  indexedApp.vault.read = async () => indexedBody;
  await assert.rejects(checkIndexed(), /另一篇源文章/);
  identityIndex.invalidate(indexedFiles[0]);
  indexedApp.vault.read = async () => { throw new Error('read denied'); };
  await assert.rejects(checkIndexed(), /read denied/);
  const atomicPlugin = Object.create(EasyPub.prototype) as EasyPub;
  const atomicFile = Object.assign(new TFile(), { path: '发布/知乎/atomic.md' });
  let atomicContent = 'concurrent edit';
  atomicPlugin.app = { vault: {
    getAbstractFileByPath: () => atomicFile,
    process: async (_file: TFile, transform: (data: string) => string) => { atomicContent = transform(atomicContent); return atomicContent; },
    modify: async () => { throw new Error('Non-atomic write must not be used'); },
  } } as any;
  const vaultPlatform = PLATFORMS.find(p => p.id === 'zhihu')!;
  const originalIdentity = { pub_id: 'legacy-id', 子文件: ['[[old]]'], custom: 'preserved' };
  for (const changed of [
    { ...originalIdentity, pub_id: 'another-id' },
    { ...originalIdentity, pub_id: undefined },
    { ...originalIdentity, source_file: '[[another-source]]' },
    { ...originalIdentity, 子文件: ['[[different]]'] },
  ]) {
    const before = JSON.stringify(changed);
    atomicPlugin.app.fileManager = { processFrontMatter: async (_file: TFile, callback: (data: any) => void) => callback(changed) } as any;
    await assert.rejects(atomicPlugin.updateSourceFile(atomicFile, vaultPlatform, 'published.md', 'legacy-id',
      { path: atomicFile.path, data: originalIdentity }), /身份或关联已变化/);
    assert.equal(JSON.stringify(changed), before);
  }
  const unchanged = { ...originalIdentity };
  atomicPlugin.app.fileManager = { processFrontMatter: async (_file: TFile, callback: (data: any) => void) => callback(unchanged) } as any;
  await assert.rejects(atomicPlugin.updateSourceFile(atomicFile, vaultPlatform, 'published.md', 'legacy-id',
    { path: 'old-source-name.md', data: originalIdentity }), /身份或关联已变化/);
  await atomicPlugin.updateSourceFile(atomicFile, vaultPlatform, 'published.md', 'legacy-id',
    { path: atomicFile.path, data: originalIdentity });
  assert.equal(unchanged.pub_id, 'legacy-id');
  assert.equal(unchanged.custom, 'preserved');
  assert.ok(unchanged.子文件.includes('[[old]]'));
  const legacyWithoutId: Record<string, unknown> = { title: 'Old source', custom: 'keep' };
  atomicPlugin.app.fileManager = { processFrontMatter: async (_file: TFile, callback: (data: any) => void) => callback(legacyWithoutId) } as any;
  await atomicPlugin.updateSourceFile(atomicFile, vaultPlatform, 'published.md', 'new-id',
    { path: atomicFile.path, data: { ...legacyWithoutId } });
  assert.equal(legacyWithoutId.pub_id, 'new-id');
  assert.equal(legacyWithoutId.custom, 'keep');
  await assert.rejects(atomicPlugin.writePublishFile(vaultPlatform, atomicFile.path, 'replacement', 'old'), /重新发布/);
  assert.equal(atomicContent, 'concurrent edit');
  await atomicPlugin.writePublishFile(vaultPlatform, atomicFile.path, 'replacement', 'concurrent edit');
  assert.equal(atomicContent, 'replacement');
  const sourceA = Object.assign(new TFile(), { path: "notes/A.md", extension: "md" });
  const sourceB = Object.assign(new TFile(), { path: "notes/B.md", extension: "md" });
  const legacyTarget = Object.assign(new TFile(), { path: "发布/知乎/old.md", extension: "md" });
  let notes = [sourceA, sourceB, legacyTarget];
  const contents = new Map(notes.map(file => [file.path, stringifyFrontMatter("unchanged body", { pub_id: "old-123" })]));
  const identityApp = { vault: {
    getMarkdownFiles: () => notes,
    getAbstractFileByPath: (path: string) => notes.find(file => file.path === path),
    read: async (file: TFile) => contents.get(file.path)!,
  }, metadataCache: { getFirstLinkpathDest: (link: string) => notes.find(file => file.path.replace(/\.md$/, "").endsWith(link.replace(/\.md$/, ""))) } } as any;
  const target = (owner?: string) => [{ path: legacyTarget.path, content: stringifyFrontMatter("edited draft", { pub_id: "old-123", ...(owner ? { source_file: owner } : {}) }) }];
  for (const owner of ['[[notes/A]]', '[[notes/A.md|alias]]', 'notes/A.md', '[[A]]']) {
    await assert.rejects(assertPublishIdentity(identityApp, sourceB.path, 'old-123', target(owner), ['发布/知乎']), /另一篇源文章/);
  }
  await assert.rejects(assertPublishIdentity(identityApp, sourceB.path, 'old-123', target(), ['发布/知乎']), /另一篇源文章/);
  await assert.rejects(assertPublishIdentity(identityApp, sourceB.path, 'old-123', [], ['发布/知乎']), /另一篇源文章/);
  notes = [sourceB, legacyTarget]; // Original source moved/renamed; legacy ID still valid.
  for (const owner of [undefined, '[[notes/A]]', '[[notes/B]]']) {
    await assertPublishIdentity(identityApp, sourceB.path, 'old-123', target(owner), ['发布/知乎']);
  }
  await assert.rejects(assertPublishIdentity(identityApp, sourceB.path, 'old-123', [...target(), { ...target()[0], path:'发布/知乎/duplicate.md' }], ['发布/知乎']), /多个发布稿/);
  assert.equal(contents.get(sourceB.path), stringifyFrontMatter('unchanged body', { pub_id:'old-123' }));
  const unrelated = Object.assign(new TFile(), { path:'notes/broken.md', extension:'md' });
  contents.set(unrelated.path, '---\ntitle: [broken\n---\nUnrelated');
  notes.push(unrelated);
  await assertPublishIdentity(identityApp, sourceB.path, 'old-123', target(), ['发布/知乎']);
  assert.equal(contents.get(unrelated.path), '---\ntitle: [broken\n---\nUnrelated');
  const zhihu = PLATFORMS.find(p => p.id === "zhihu")!;
  assert.equal(isSourcePublishTarget(zhihu, "发布/知乎/文章/a.md", "发布/知乎/文章/a.md"), true);
  assert.equal(isSourcePublishTarget(zhihu, "文章/a.md", "发布/知乎/文章/a.md"), false);
  assert.equal(getHexoNodeExecutable("43.0.0"), process.platform === "win32" ? "node.exe" : "node");
  assert.equal(getHexoNodeExecutable(""), process.execPath);
  const normalized = normalizeSettings({
    hexoRepoPath: 42, publishBasePath: "  ", autoDeploy: "false", imageHandling: null,
    picgoServerSecret: [], picgoImageCache: { stale: null, broken: { url: 42 } },
  });
  assert.deepEqual(normalized, DEFAULT_SETTINGS);
  const disabledPicGo = normalizeSettings({ imageHandling: "local", picgoServerUrl: "invalid address", picgoEncryptedSecret: "unreadable" });
  assert.equal(publishSettingsFingerprint(disabledPicGo), publishSettingsFingerprint(normalized));
  assert.equal(publishSettingsFingerprint({ ...disabledPicGo, picgoServerSecret: "changed" }), publishSettingsFingerprint(normalized));
  assert.notEqual(publishSettingsFingerprint({ ...disabledPicGo, imageHandling: "picgo" }), publishSettingsFingerprint(normalized));
  assert.equal(publishSettingsFingerprint({ ...disabledPicGo, imageHandling: "picgo" }, "wechat"), publishSettingsFingerprint(normalized, "wechat"));
  assert.notEqual(publishSettingsFingerprint({ ...disabledPicGo, imageHandling: "picgo", picgoServerSecret: "one" }), publishSettingsFingerprint({ ...disabledPicGo, imageHandling: "picgo", picgoServerSecret: "two" }));
  const inactivePlugin = Object.create(EasyPub.prototype) as EasyPub;
  inactivePlugin.loadData = async () => disabledPicGo;
  inactivePlugin.saveData = async () => { throw new Error("Inactive PicGo must not migrate settings on startup"); };
  inactivePlugin.initializePicGoCredentials = async () => { throw new Error("Inactive PicGo must not access credentials"); };
  await inactivePlugin.loadSettings();
  await inactivePlugin.testPicGoConnection(); // Network fixture throws if contacted.
  assert.equal(inactivePlugin.settings.picgoEncryptedSecret, "unreadable");
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  const oldCache = { image: { hash: "a".repeat(64), url: "https://example.com/image.png" } };
  assert.deepEqual(normalizeSettings({ picgoImageCache: oldCache }).picgoImageCache, oldCache);
  assert.equal(publishSettingsFingerprint(normalized), publishSettingsFingerprint({ ...normalized, picgoImageCache: oldCache }));
  assert.notEqual(publishSettingsFingerprint(normalized), publishSettingsFingerprint({ ...normalized, hexoRepoPath: "new-blog" }));

  // Executable front matter must not run, even while scanning another article.
  const state = globalThis as typeof globalThis & { easyPubExecuted?: boolean };
  for (const language of ["js", "javascript"]) {
    assert.throws(() => parseFrontMatter(`---${language}\nglobalThis.easyPubExecuted = true; return {};\n---\nText`), /JavaScript/);
    assert.equal(state.easyPubExecuted, undefined);
  }
  assert.equal(parseFrontMatter('---json\n{"title":"JSON"}\n---\nText').data.title, "JSON");
  for (const body of ["---\nA horizontal rule\n---\nText", "---js\nglobalThis.easyPubExecuted=true; return {};\n---\nText"]) {
    assert.equal(parseFrontMatter(stringifyFrontMatter(body, { title: "Example" })).content.trim(), body);
    assert.equal(state.easyPubExecuted, undefined);
  }
  assert.equal(parseYamlDocument("---\nurl: https://example.com\n...\n").url, "https://example.com");
  assert.throws(() => parseYamlDocument("title: [broken"));

  assert.equal(await withTimeout(Promise.resolve("ok"), 100, "timeout"), "ok");
  await assert.rejects(withTimeout(Promise.reject(new Error("request failed")), 100, "timeout"), /request failed/);

  const root = await mkdtemp(path.join(os.tmpdir(), "easy-pub-reliability-"));
  try {
    const config = path.join(root, "_config.yml");
    for (const invalid of ["deploy: {type: ''}", "deploy:\n  type: # git", "deploy: []", "deploy: [{type: git}, {}]"]) {
      await writeFile(config, invalid);
      await assert.rejects(validateHexoDeployment(root), /deploy.type/);
    }
    await writeFile(config, "deploy: [{type: git}, {type: rsync}]");
    await validateHexoDeployment(root);
    await writeFile(config, "deploy: [unterminated");
    await assert.rejects(buildHexo(root), /格式错误/);
    await assert.rejects(readFile(path.join(root, "commands.log")), /ENOENT/);

    const plugin = Object.create(EasyPub.prototype) as EasyPub;
    plugin.settings = normalizeSettings({ hexoRepoPath: root });
    const source = Object.assign(new TFile(), { path: "source.md", basename: "source", extension: "md" });
    const image = Object.assign(new TFile(), { path: "image.png", basename: "image", extension: "png" });
    const platform = PLATFORMS.find(p => p.id === "hexo")!;
    const target = path.join(root, "source/_posts/article.md");
    await mkdir(path.dirname(target), { recursive: true });
    const original = "---\npub_id: test-id\n---\nOriginal";
    await writeFile(target, original);
    let sourceText = "Source";
    let imageBytes = Buffer.from("original image");
    Object.assign(plugin, { app: {
      vault: {
        getMarkdownFiles: () => [source],
        read: async () => sourceText,
        getAbstractFileByPath: () => image,
        readBinary: async () => imageBytes,
      },
    } });
    plugin.updateSourceFile = async () => {};
    plugin.openPublishedFile = async () => {};
    const diff: ArticleDiff = {
      pub_id: "test-id", sourcePath: source.path, sourceSnapshot: sourceText,
      settingsFingerprint: publishSettingsFingerprint(plugin.settings),
      targetPath: target, targetContent: original, sourceContent: original + " updated",
      isNew: false, platform, meta: { pub_id: "test-id" },
    };
    sourceText = "Edited while reviewing";
    await assert.rejects(plugin.copyAndOpenForEdit(diff, source), /源文章已变化/);
    sourceText = "Source";
    plugin.settings.autoDeploy = true;
    await assert.rejects(plugin.copyAndOpenForEdit(diff, source), /发布设置已变化/);
    plugin.settings.autoDeploy = false;
    diff.imageChecks = [{ sourcePath: image.path, contentHash: createHash("sha256").update(imageBytes).digest("hex") }];
    imageBytes = Buffer.from("changed image");
    await assert.rejects(plugin.copyAndOpenForEdit(diff, source), /图片在确认期间发生变化/);
    assert.equal(await readFile(target, "utf8"), original);
    delete diff.imageChecks;
    await assert.rejects(plugin.copyAndOpenForEdit({ ...diff, platform: zhihu, targetPath: source.path }, source), /目标发布稿/);

    // Simulate an upload that completes after the timeout. It must never write the target.
    let completeUpload!: (value: { content: string; cacheUpdates: {} }) => void;
    const pending = new Promise<{ content: string; cacheUpdates: {} }>(resolve => { completeUpload = resolve; });
    const internals = plugin as any;
    plugin.settings.imageHandling = "picgo";
    diff.settingsFingerprint = publishSettingsFingerprint(plugin.settings);
    internals.resolvePicGoUploads = () => withTimeout(pending, 5, "upload timeout");
    internals.performPublish = () => plugin.copyAndOpenForEdit(diff, source);
    await expectReportedFailure(() => plugin.preparePublish(platform));
    assert.equal(internals.publishInProgress, false);
    completeUpload({ content: "late result", cacheUpdates: {} });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(await readFile(target, "utf8"), original);
    plugin.settings.imageHandling = "local";
    diff.settingsFingerprint = publishSettingsFingerprint(plugin.settings);
    plugin.settings.picgoServerUrl = "invalid";
    plugin.settings.picgoEncryptedSecret = "unreadable";
    internals.resolvePicGoUploads = async () => { throw new Error("Local publishing must bypass PicGo entirely"); };
    plugin.updateSourceFile = async () => {
      sourceText = stringifyFrontMatter('Source', { pub_id: diff.pub_id, 子文件: [formatChildReference(platform, target)] });
    };
    // Failure to open the editor must not invalidate a completed publication.
    plugin.openPublishedFile = async () => { throw new Error("editor unavailable"); };
    await expectReportedFailure(() => plugin.copyAndOpenForEdit(diff, source));
    assert.equal(await readFile(target, "utf8"), diff.sourceContent);

    // A body edit during association must preserve both versions and block deployment.
    await writeFile(target, original);
    sourceText = 'Source';
    plugin.settings.autoDeploy = true;
    const racingDiff = { ...diff, settingsFingerprint: publishSettingsFingerprint(plugin.settings) };
    let deployed = false;
    plugin.deployToHexo = async () => { deployed = true; };
    plugin.updateSourceFile = async () => {
      sourceText = stringifyFrontMatter('Edited during association', { pub_id: diff.pub_id, 子文件: [formatChildReference(platform, target)] });
    };
    await assert.rejects(plugin.copyAndOpenForEdit(racingDiff, source), /完成后核对未通过.*源稿正文已变化/);
    assert.equal(deployed, false);
    assert.equal(await readFile(target, 'utf8'), diff.sourceContent);
    assert.equal(parseFrontMatter(sourceText).content, 'Edited during association\n');
    for (const fields of [{ title: 'changed' }, { tags: ['Robotics'] }, { custom: { nested: [1, 2] } }]) {
      await writeFile(target, original);
      sourceText = 'Source';
      plugin.updateSourceFile = async () => {
        sourceText = stringifyFrontMatter('Source', { ...fields, pub_id: diff.pub_id, 子文件: [formatChildReference(platform, target)] });
      };
      await assert.rejects(plugin.copyAndOpenForEdit(racingDiff, source), /完成后核对未通过.*源稿元数据已变化/);
      assert.equal(deployed, false);
      assert.equal(await readFile(target, 'utf8'), diff.sourceContent);
    }
    const semanticSnapshot = '---\ntitle: Same\ncustom: {a: 1, b: 2}\ndate: 2026-10-22\n---\nSource';
    sourceText = stringifyFrontMatter('Source', { ...parseFrontMatter(semanticSnapshot).data, custom: { b: 2, a: 1 }, pub_id: diff.pub_id, 子文件: [formatChildReference(platform, target)] });
    await plugin.verifyCompletedPublish({ ...racingDiff, sourceSnapshot: semanticSnapshot }, source);
    sourceText = stringifyFrontMatter('Source', { pub_id: 'other-id' });
    await assert.rejects(plugin.verifyCompletedPublish(racingDiff, source), /源稿关联/);
    sourceText = stringifyFrontMatter('Source', { pub_id: diff.pub_id, 子文件: [formatChildReference(platform, target)] });
    await plugin.verifyCompletedPublish(racingDiff, source, diff.sourceContent);
    await writeFile(target, 'edited target');
    await assert.rejects(plugin.verifyCompletedPublish(racingDiff, source, diff.sourceContent), /目标稿.*变化/);
    assert.equal(await readFile(target, 'utf8'), 'edited target');
    source.path = 'renamed-source.md';
    await assert.rejects(plugin.verifyCompletedPublish(racingDiff, source), /源稿路径/);
    source.path = diff.sourcePath;

    // Invalid persisted JSON must not prevent plugin commands from being registered.
    const recovering = Object.create(EasyPub.prototype) as EasyPub;
    recovering.loadData = async () => { throw new Error("invalid data.json"); };
    await expectReportedFailure(() => recovering.loadSettings());
    assert.deepEqual(recovering.settings, DEFAULT_SETTINGS);

    // Different local paths with identical bytes need independent replacement tokens.
    const uploader = Object.create(EasyPub.prototype) as EasyPub;
    uploader.settings = normalizeSettings({ imageHandling: "picgo" });
    const adapter = Object.assign(new FileSystemAdapter(), { getFullPath: (p: string) => path.join(root, p) });
    Object.assign(uploader, { app: {
      vault: { adapter, readBinary: async () => Buffer.from("same bytes") },
      metadataCache: { getFirstLinkpathDest: (p: string) => Object.assign(new TFile(), { path: p, basename: p, extension: "png" }) },
    } });
    const prepared = await (uploader as any).preparePicGoContent(source, "![[a.png]]\n![[b.png]]");
    assert.equal(prepared.picgoUploads.length, 2);
    assert.notEqual(prepared.picgoUploads[0].token, prepared.picgoUploads[1].token);
    assert.equal(prepared.imageChecks.length, 2);
    const hash = createHash("sha256").update("same bytes").digest("hex");
    uploader.settings.picgoImageCache["a.png"] = { hash, url: "https://example.com/cached.png" };
    const cached = await (uploader as any).preparePicGoContent(source, "![[a.png]]");
    assert.equal(cached.picgoUploads.length, 0);
    assert.equal(cached.imageChecks.length, 1);

    const modalPlugin = Object.create(EasyPub.prototype) as EasyPub;
    modalPlugin.settings = normalizeSettings({ hexoRepoPath: root });
    Object.assign(modalPlugin, { app: {
      workspace: { getActiveFile: () => source },
      vault: { read: async () => original },
    } });
    modalPlugin.findArticleByPubId = async () => target;
    modalPlugin.buildPublishedFrontMatter = async () => ({ pub_id: "test-id" });
    // The minimal Modal runtime has no open(): emulate host failure during rendering.
    await expectReportedFailure(() => modalPlugin.preparePublish(platform));
    assert.equal((modalPlugin as any).publishConfirmationOpen, false);
    assert.equal((modalPlugin as any).publishInProgress, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log("EasyPub reliability tests passed");
}
