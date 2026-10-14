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
import { isSourcePublishTarget } from "../utils/platforms";
import { parseFrontMatter, parseYamlDocument, stringifyFrontMatter } from "../utils/frontMatter";
import { buildHexo, getHexoNodeExecutable, validateHexoDeployment } from "../utils/hexoCommands";

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
    internals.resolvePicGoUploads = () => withTimeout(pending, 5, "upload timeout");
    internals.performPublish = () => plugin.copyAndOpenForEdit(diff, source);
    await expectReportedFailure(() => plugin.preparePublish(platform));
    assert.equal(internals.publishInProgress, false);
    completeUpload({ content: "late result", cacheUpdates: {} });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(await readFile(target, "utf8"), original);
    internals.resolvePicGoUploads = async () => ({ content: diff.sourceContent, cacheUpdates: {} });
    // Failure to open the editor must not invalidate a completed publication.
    plugin.openPublishedFile = async () => { throw new Error("editor unavailable"); };
    await expectReportedFailure(() => plugin.copyAndOpenForEdit(diff, source));
    assert.equal(await readFile(target, "utf8"), diff.sourceContent);

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
