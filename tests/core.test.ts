import { runWechatAssociationTests } from "./wechatAssociation.test";
import { runPerformanceTests } from "./performance.test";
import { runHexoEditingTests } from "./hexoEditing.test";
import { runDraftSyncTests } from "./draftSync.test";
import { runAttachmentImportTests } from "./attachmentImport.test";
import { runPublishingWorkbenchTests } from "./publishingWorkbench.test";
import { runHexoFormattingTests } from "./hexoFormatting.test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { inspectPublishBackups, listPublishBackups, readPublishBackup } from "../utils/publishBackups";
import path from "node:path";
import { mergePublishedFrontMatter, mergeSourceFrontMatter } from "../utils/frontMatter";
import { generateHexoUrl, getHexoRootPath } from "../utils/linkUtils";
import {
  buildHexo,
  deployHexo,
  validateHexoBlog,
  validateHexoDeployment,
} from "../utils/hexoCommands";
import { prepareImageEmbeds } from "../utils/imageEmbeds";
import { assertPublishUnchanged, completeControlRoomMetadata } from "../utils/publishSafety";
import { writeImmutableAsset, writePublishedFile } from "../utils/publishFiles";
import { createHash } from "node:crypto";
import EasyPubPlugin from "../main";
import { TFile } from "obsidian";
import { DEFAULT_SETTINGS, PLATFORMS } from "../types";
import { getHexoAssetTargetPath } from "../utils/platforms";
import { runReliabilityTests } from "./reliability.test";
import { runBatchPubIdTests } from "./batchPubIds.test";
import { runWechatTests } from "./wechat.test";
import { runWechatLayoutTests } from "./wechat-layout.test";
import { runControlRoomLauncherTests } from "./controlRoomLauncher.test";
import {
  getPicGoHeartbeatUrl,
  normalizePicGoUploadUrl,
  uploadWithPicGo,
} from "../utils/picgo";
import {
  findControlRoomIntegration,
  getControlRoomStatusUrl,
  parseControlRoomSession,
  readControlRoomSession,
} from "../utils/controlRoom";

import { runStructureTests } from "./structure.test";
import { runArticlePropertyTests } from "./articleProperties.test";

async function run() {
  await runWechatAssociationTests();
  await runPerformanceTests();
  runHexoFormattingTests();
  await runAttachmentImportTests();
  await runPublishingWorkbenchTests();
  await runHexoEditingTests();
  await runDraftSyncTests();
  await runStructureTests();
  await runArticlePropertyTests();
  await runControlRoomLauncherTests();
  await runBatchPubIdTests();
  await runReliabilityTests();
  await runWechatTests();
  await runWechatLayoutTests();
  const assetsRoot = await mkdtemp(path.join(os.tmpdir(), 'easy-pub-assets-'));
  const backupRepo = await mkdtemp(path.join(os.tmpdir(), 'easy-pub-backup-git-'));
  try {
    await assert.rejects(inspectPublishBackups('relative/blog'), /绝对路径/);
    assert.equal((await inspectPublishBackups(backupRepo)).git, 'unknown');
    execFileSync('git', ['init', '--quiet', backupRepo]);
    assert.equal((await inspectPublishBackups(backupRepo)).git, 'unprotected');
    const backupFolder = path.join(backupRepo, '.easy-pub-backups');
    await mkdir(backupFolder);
    const backup = path.join(backupFolder, 'a'.repeat(64) + '.bak');
    await writeFile(backup, 'private draft');
    await writeFile(path.join(backupFolder, 'unrelated.txt'), 'not counted');
    const stats = await inspectPublishBackups(backupRepo);
    assert.equal(stats.count, 1);
    assert.equal(stats.bytes, Buffer.byteLength('private draft'));
    await writeFile(path.join(backupRepo, '.gitignore'), '.easy-pub-backups/\n');
    assert.equal((await inspectPublishBackups(backupRepo)).git, 'ignored');
    execFileSync('git', ['add', '-f', '--', backup], { cwd: backupRepo });
    assert.equal((await inspectPublishBackups(backupRepo)).git, 'tracked');
    assert.equal(await readFile(backup, 'utf8'), 'private draft');
    assert.equal(await readFile(path.join(backupRepo, '.gitignore'), 'utf8'), '.easy-pub-backups/\n');
    const backupText = '---\ntitle: Saved article\npub_id: legacy-id\nsource_file: "[[notes/old|alias]]"\n---\nOriginal body';
    const backupName = createHash('sha256').update(backupText).digest('hex') + '.bak';
    await writeFile(path.join(backupFolder, backupName), backupText);
    await writeFile(path.join(backupFolder, `${backupName}.incomplete.tmp`), 'partial');
    const listed = await listPublishBackups(backupRepo);
    assert.equal(listed.length, 2);
    assert.ok(listed.every(entry => entry.name.endsWith('.bak')));
    const preview = await readPublishBackup(backupRepo, backupName);
    assert.equal(preview.content, backupText);
    assert.equal(preview.hashMatches, true);
    assert.equal(preview.title, 'Saved article');
    assert.equal(preview.source, '[[notes/old|alias]]');
    assert.equal(preview.pubId, 'legacy-id');
    assert.equal((await readPublishBackup(backupRepo, 'a'.repeat(64) + '.bak')).hashMatches, false);
    await assert.rejects(readPublishBackup(backupRepo, '../outside.md'), /无效/);
    await assert.rejects(readPublishBackup(backupRepo, '0'.repeat(64) + '.bak'), /ENOENT/);
    const malformed = '---\ntitle: [broken\n---\nRecovery body';
    const malformedName = createHash('sha256').update(malformed).digest('hex') + '.bak';
    await writeFile(path.join(backupFolder, malformedName), malformed);
    const damagedPreview = await readPublishBackup(backupRepo, malformedName);
    assert.equal(damagedPreview.metadataValid, false);
    assert.equal(damagedPreview.content, malformed);
    assert.equal(damagedPreview.hashMatches, true);
    const largeName = 'b'.repeat(64) + '.bak';
    await writeFile(path.join(backupFolder, largeName), Buffer.alloc(2 * 1024 * 1024 + 1));
    await assert.rejects(readPublishBackup(backupRepo, largeName), /超过 2 MiB/);
    assert.equal(await readFile(path.join(backupFolder, backupName), 'utf8'), backupText);
    assert.equal(await readFile(backup, 'utf8'), 'private draft');
  } finally { await rm(backupRepo, { recursive: true, force: true }); }
  try {
    const bytes = Buffer.from('fixture image bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const target = path.join(assetsRoot, 'nested', 'image.png');
    await mkdir(path.dirname(target));
    const post = path.join(assetsRoot, 'post.md');
    await writePublishedFile(post, 'first', null);
    await assert.rejects(() => writePublishedFile(post, 'overwrite', null), /重新发布/);
    await assert.rejects(() => writePublishedFile(post, 'overwrite', 'stale'), /重新发布/);
    assert.equal(await readFile(post, 'utf8'), 'first');
    await writePublishedFile(post, 'second', 'first');
    assert.equal(await readFile(post, 'utf8'), 'second');
    const backupDirectory = path.join(assetsRoot, '.easy-pub-backups');
    const originalBackup = path.join(backupDirectory, createHash('sha256').update('first').digest('hex') + '.bak');
    assert.equal(await readFile(originalBackup, 'utf8'), 'first');
    for (const failure of ['write', 'sync']) {
      const failureTarget = path.join(assetsRoot, `${failure}.md`);
      const oldBody = `original-${failure}`;
      await writeFile(failureTarget, oldBody);
      const open = fsPromises.open;
      try {
        fsPromises.open = (async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          if (/\.bak\..*\.tmp$/.test(String(args[0]))) {
            if (failure === 'write') {
              const write = handle.writeFile.bind(handle);
              handle.writeFile = async () => { await write('partial'); throw new Error('injected write failure'); };
            } else handle.sync = async () => { throw new Error('injected sync failure'); };
          }
          return handle;
        }) as typeof open;
        await assert.rejects(writePublishedFile(failureTarget, 'replacement', oldBody), /injected/);
      } finally { fsPromises.open = open; }
      assert.equal(await readFile(failureTarget, 'utf8'), oldBody);
      const backupPath = path.join(backupDirectory, createHash('sha256').update(oldBody).digest('hex') + '.bak');
      await assert.rejects(readFile(backupPath), /ENOENT/);
      assert.ok(!(await readdir(backupDirectory)).some(name => name.endsWith('.tmp')));
      await writePublishedFile(failureTarget, 'replacement', oldBody);
      assert.equal(await readFile(backupPath, 'utf8'), oldBody);
    }
    const corruptTarget = path.join(assetsRoot, 'corrupt-backup.md');
    await writeFile(corruptTarget, 'historical');
    const corruptBackup = path.join(backupDirectory, createHash('sha256').update('historical').digest('hex') + '.bak');
    await writeFile(corruptBackup, 'existing damaged backup');
    await assert.rejects(writePublishedFile(corruptTarget, 'replacement', 'historical'), /备份损坏/);
    assert.equal(await readFile(corruptTarget, 'utf8'), 'historical');
    assert.equal(await readFile(corruptBackup, 'utf8'), 'existing damaged backup');
    const lock = path.join(assetsRoot, '.post.md.easy-pub.lock');
    await writeFile(lock, 'another instance');
    await assert.rejects(writePublishedFile(post, 'blocked', 'second'), /目标正在发布/);
    assert.equal(await readFile(post, 'utf8'), 'second');
    await rm(lock);
    const concurrent = await Promise.allSettled([
      writePublishedFile(post, 'third-a', 'second'), writePublishedFile(post, 'third-b', 'second'),
    ]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(await readFile(path.join(backupDirectory, createHash('sha256').update('second').digest('hex') + '.bak'), 'utf8'), 'second');
    const winner = await readFile(post, 'utf8');
    const blockedBackup = path.join(assetsRoot, 'not-a-directory');
    await writeFile(blockedBackup, 'fixture');
    await assert.rejects(writePublishedFile(post, 'lost', winner, blockedBackup));
    assert.equal(await readFile(post, 'utf8'), winner);
    assert.ok(!(await readdir(assetsRoot)).some(name => name.endsWith('.lock') || name.endsWith('.tmp')));
    await writePublishedFile(post, 'retry succeeds', winner);
    const unlink = fsPromises.unlink;
    const warn = console.warn;
    let cleanupWarning = false;
    try {
      fsPromises.unlink = async file => {
        if (String(file) === lock) throw new Error('lock cleanup failure');
        return unlink(file);
      };
      console.warn = () => { cleanupWarning = true; };
      await writePublishedFile(post, 'committed despite cleanup failure', 'retry succeeds');
      assert.equal(await readFile(post, 'utf8'), 'committed despite cleanup failure');
      assert.ok(cleanupWarning);
      await assert.rejects(writePublishedFile(post, 'blocked'), /目标正在发布/);
    } finally {
      fsPromises.unlink = unlink;
      console.warn = warn;
      await rm(lock, { force: true });
    }
    assert.equal(await writeImmutableAsset(target, bytes, hash), true);
    assert.equal(await writeImmutableAsset(target, bytes, hash), false);
    await assert.rejects(() => writeImmutableAsset(target, Buffer.from('changed'), hash), /重新发布/);
    await writeFile(target, 'unexpected content');
    await assert.rejects(() => writeImmutableAsset(target, bytes, hash), /内容不一致/);
    assert.equal(await readFile(target, 'utf8'), 'unexpected content');
  } finally { await rm(assetsRoot, { recursive: true, force: true }); }
  assertPublishUnchanged("original", "original");
  assertPublishUnchanged(null, null);
  assert.throws(() => assertPublishUnchanged("original", "backend edit"), /重新发布/);
  assert.throws(() => assertPublishUnchanged("original", null), /重新发布/);
  const completed = completeControlRoomMetadata({ date: "2026-10-11" }, "Title", new Set());
  assert.equal(completed.title, "Title");
  assert.deepEqual(completed.categories, []);
  assert.deepEqual(completed.tags, []);
  assert.match(String(completed.abbrlink), /^[a-f0-9]{4}$/);
  assert.equal(completeControlRoomMetadata(completed, "Title", new Set()).abbrlink, completed.abbrlink);
  assert.throws(() => completeControlRoomMetadata(completed, "Title", new Set([String(completed.abbrlink)])), /重复/);
  assert.throws(() => completeControlRoomMetadata({ password: "fixture" }, "Title", new Set()), /password_secret/);
  for (const password_secret of ["", "plaintext", "BLOG_ENCRYPTION_lower", null]) {
    assert.throws(() => completeControlRoomMetadata({ password_secret }, "Title", new Set()), /password_secret/);
  }
  assert.equal(completeControlRoomMetadata({ password_secret: "BLOG_ENCRYPTION_ARTICLE_1" }, "Title", new Set()).password_secret, "BLOG_ENCRYPTION_ARTICLE_1");
  const integrationRoot = await mkdtemp(path.join(os.tmpdir(), 'easy-pub-integration-'));
  try {
    const plugin = Object.create(EasyPubPlugin.prototype) as EasyPubPlugin;
    plugin.settings = { ...DEFAULT_SETTINGS, hexoRepoPath: integrationRoot };
    const platform = PLATFORMS.find(p => p.id === 'hexo')!;
    await mkdir(path.join(integrationRoot, 'source/_drafts/nested'), { recursive: true });
    await mkdir(path.join(integrationRoot, 'source/_posts'), { recursive: true });
    await mkdir(path.join(integrationRoot, 'admin'));
    await writeFile(path.join(integrationRoot, 'package.json'), JSON.stringify({ scripts: { gui: 'node admin/server.js' } }));
    await writeFile(path.join(integrationRoot, 'ManageBlog.bat'), 'fixture');
    await writeFile(path.join(integrationRoot, 'admin/server.js'), 'fixture');
    await writeFile(path.join(integrationRoot, '_config.yml'), 'url: https://example.com\npermalink: posts/:abbrlink/\n');
    const target = path.join(integrationRoot, 'source/_drafts/nested/Draft.md');
    const original = '---\ntitle: Draft\npub_id: draft-id\nabbrlink: abcd\nworkflow: pending\n---\nOriginal';
    await writeFile(target, original);
    const source = Object.assign(new TFile(), { path: 'Draft.md', basename: 'Draft', extension: 'md' });
    assert.equal(await plugin.findArticleByPubId(platform, 'draft-id', { title: 'Draft' }), target);
    const brokenTargets = [path.join(integrationRoot, 'source/_posts/broken-one.md'), path.join(integrationRoot, 'source/_drafts/broken-two.md')];
    for (const broken of brokenTargets) await writeFile(broken, '---\npub_id: [broken\n---\nuntouched');
    const directoryReport = await plugin.inspectPublishDirectory(platform);
    assert.equal(directoryReport.checked, 3);
    assert.deepEqual(directoryReport.issues.flatMap(issue => issue.paths).sort(), [...brokenTargets].sort());
    assert.equal(await readFile(target, 'utf8'), original);
    await assert.rejects(plugin.findArticleByPubId(platform, 'draft-id', { title: 'Draft' }), error => {
      assert.match(String(error), /不能排除 pub_id 冲突/);
      for (const broken of brokenTargets) assert.ok(String(error).includes(broken));
      return true;
    });
    for (const broken of brokenTargets) {
      assert.equal(await readFile(broken, 'utf8'), '---\npub_id: [broken\n---\nuntouched');
      await rm(broken);
    }
    const meta = await plugin.buildPublishedFrontMatter(platform, source, { title: 'Draft', workflow: 'published' }, original, 'draft-id', '2026-10-11', target);
    assert.equal(meta.workflow, 'pending');
    assert.equal(meta.abbrlink, 'abcd');
    assert.deepEqual(meta.tags, []);
    const bytes = Buffer.from('fixture');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const assetTarget = getHexoAssetTargetPath(plugin.settings, 'draft-id', 'image.png', hash);
    assert.ok(assetTarget.includes(path.join('source', 'picture', 'easy-pub')));
    const diff = { pub_id: 'draft-id', sourcePath: source.path, targetPath: target, sourceContent: original + ' updated', targetContent: original, isNew: false, meta: { pub_id: 'draft-id', title: 'Draft' }, platform, assets: [{ sourcePath: 'image.png', targetPath: assetTarget, contentHash: hash }] };
    Object.assign(plugin, { app: { vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => new TFile(), readBinary: async () => bytes } } });
    await writeFile(target, original + ' backend edit');
    await assert.rejects(() => plugin.copyAndOpenForEdit(diff, source), /重新发布/);
    assert.equal(await readFile(target, 'utf8'), original + ' backend edit');
    await writeFile(target, original);
    plugin.updateSourceFile = async () => { throw new Error('source update failed'); };
    await assert.rejects(() => plugin.copyAndOpenForEdit(diff, source), /source update failed/);
    assert.equal(await readFile(target, 'utf8'), original);
    assert.equal(await readFile(path.join(integrationRoot, '.easy-pub-backups',
      createHash('sha256').update(original).digest('hex') + '.bak'), 'utf8'), original);
    assert.deepEqual(await readFile(assetTarget), bytes);
    plugin.updateSourceFile = async () => {
      await writeFile(target, 'edited while updating source');
      throw new Error('source update failed');
    };
    await assert.rejects(plugin.copyAndOpenForEdit(diff, source), error => {
      assert.match(String(error), /source update failed/);
      assert.match(String(error), /未能恢复旧稿/);
      assert.ok(String(error).includes(target));
      return true;
    });
    assert.equal(await readFile(target, 'utf8'), 'edited while updating source');
    await rm(target);
    plugin.updateSourceFile = async () => {
      await writeFile(target, 'new draft edited by user');
      throw new Error('source update failed');
    };
    await assert.rejects(plugin.copyAndOpenForEdit({ ...diff, isNew: true, targetContent: null }, source), /新建稿件已保留/);
    assert.equal(await readFile(target, 'utf8'), 'new draft edited by user');
    assert.deepEqual(await readFile(assetTarget), bytes);
  } finally { await rm(integrationRoot, { recursive: true, force: true }); }
  const controlRoomSession = parseControlRoomSession({
    version: 1,
    pid: 1234,
    host: "127.0.0.1",
    port: 4173,
    url: `http://127.0.0.1:4173/?token=${"a".repeat(48)}`,
  });
  assert.ok(controlRoomSession);
  assert.equal(
    getControlRoomStatusUrl(controlRoomSession),
    `http://127.0.0.1:4173/api/status?token=${"a".repeat(48)}`
  );
  assert.equal(
    parseControlRoomSession({
      version: 1,
      pid: 1234,
      host: "127.0.0.1",
      port: 4173,
      url: `https://example.com/?token=${"a".repeat(48)}`,
    }),
    null
  );
  assert.equal(
    parseControlRoomSession({
      version: 1,
      pid: 1234,
      host: "127.0.0.1",
      port: 4173,
      url: `http://127.0.0.1:4173/?token=${"a".repeat(48)}&next=https://example.com`,
    }),
    null
  );
  assert.equal(await findControlRoomIntegration(""), null);
  assert.equal(await findControlRoomIntegration("relative/blog"), null);
  assert.equal(
    parseControlRoomSession({
      version: 1,
      pid: 1234,
      host: "127.0.0.1",
      port: 4173,
      url: "http://127.0.0.1:4173/?token=too-short",
    }),
    null
  );

  const merged = mergePublishedFrontMatter({
    platformId: "hexo",
    sourceData: {
      title: "新标题",
      tags: ["新标签"],
      pub_id: "source-id",
      子文件: ["不应发布"],
    },
    existingData: {
      title: "旧标题",
      tags: ["旧标签"],
      date: "2026-01-01",
      platform_status: "draft",
    },
    pubId: "article-id",
    sourceFileLink: "[[文章/来源]]",
    timestamp: "2026-07-27T00:00:00.000Z",
  });

  assert.equal(merged.title, "旧标题");
  assert.deepEqual(merged.tags, ["旧标签"]);
  assert.equal(merged.date, "2026-01-01");
  assert.equal(merged.platform_status, "draft");
  assert.equal(merged.pub_id, "article-id");
  assert.equal(merged.source_file, "[[文章/来源]]");
  assert.equal("子文件" in merged, false);
  assert.equal("publish_url" in merged, false);

  // Platform editors own their properties even when the source sets the same keys.
  for (const top_img of [false, "/picture/top.png", "https://example.com/top.png"]) {
    const existingData = { top_img, cover: "/picture/cover.png", description: "后台摘要", workflow: "pending", password_secret: "BLOG_ENCRYPTION_POST" };
    const options = { platformId: "hexo", existingData, pubId: "legacy-id", sourceFileLink: "[[旧稿]]", timestamp: "2026-10-23" };
    const updated = mergePublishedFrontMatter({ ...options, sourceData: { title: "修改正文" } });
    for (const [key, value] of Object.entries(existingData)) assert.equal(updated[key], value);
    const overridden = mergePublishedFrontMatter({ ...options, sourceData: { top_img: false, cover: "/picture/source.png" } });
    assert.equal(overridden.top_img, top_img);
    assert.equal(overridden.cover, "/picture/cover.png");
  }

  const source = mergeSourceFrontMatter(
    {
      title: "来源",
      source_file: "[[旧来源]]",
      publish_url: "https://old.example.com",
      updated: "2025-01-01",
    },
    "article-id",
    "[[发布/知乎/文章/来源]]"
  );
  assert.equal("source_file" in source, false);
  assert.equal("publish_url" in source, false);
  assert.equal("updated" in source, false);
  assert.deepEqual(source.子文件, ["[[发布/知乎/文章/来源]]"]);

  const preparedImages = await prepareImageEmbeds(
    [
      "正文 ![[images/Cover Image.PNG|300]]",
      "`![[inline.png]]`",
      "``![[double-inline.png]]``",
      "```md",
      "![[inside-code.png]]",
      "```",
      "![[note]]",
      "再次引用 ![[images/Cover Image.PNG]]",
    ].join("\n"),
    async (linkPath) => linkPath === "images/Cover Image.PNG"
      ? {
          sourcePath: "images/Cover Image.PNG",
          url: "/images/easy-pub/id/cover.png",
          alt: "Cover Image",
          asset: {
            sourcePath: "images/Cover Image.PNG",
            targetPath: "/blog/source/images/easy-pub/id/cover.png",
          },
        }
      : null
  );
  assert.equal(
    preparedImages.content,
    [
      "正文 ![Cover Image](/images/easy-pub/id/cover.png)",
      "`![[inline.png]]`",
      "``![[double-inline.png]]``",
      "```md",
      "![[inside-code.png]]",
      "```",
      "![[note]]",
      "再次引用 ![Cover Image](/images/easy-pub/id/cover.png)",
    ].join("\n")
  );
  assert.deepEqual(preparedImages.assets, [{
    sourcePath: "images/Cover Image.PNG",
    targetPath: "/blog/source/images/easy-pub/id/cover.png",
  }]);

  // These are code/escaped examples, not attachment upload requests. Preserve
  // CRLF and every character outside genuine body embeds.
  const protectedExamples = [
    '```md\n```not-a-close\n![[example.png]]\n```',
    '~~~~md\n~~~\n![[example.png]]\n~~~~',
    '```\n~~~\n![[example.png]]\n```',
    '```md\n![[example.png]]',
    '> ```md\n> ![[example.png]]\n> ```',
    '- ```md\n  ![[example.png]]\n  ```',
    '    ![[example.png]]',
    '`line one\n![[example.png]]`',
    '\\![[example.png]]',
    '<!-- ![[example.png]] -->',
  ];
  for (const example of protectedExamples) {
    for (const text of [example, example.replace(/\n/g, '\r\n')]) {
      const result = await prepareImageEmbeds(text, async () => {
        assert.fail('Code examples must not resolve or upload attachments');
      });
      assert.equal(result.content, text);
      assert.deepEqual(result.assets, []);
    }
  }
  const bodyAfterCode = '```md\r\n![[code.png]]\r\n``` \t\r\n正文 ![[body.png]]\r\n';
  const resolvedPaths: string[] = [];
  const afterCode = await prepareImageEmbeds(bodyAfterCode, async source => {
    resolvedPaths.push(source);
    return { url: '/body.png', alt: 'body' };
  });
  assert.deepEqual(resolvedPaths, ['body.png']);
  assert.equal(afterCode.content, bodyAfterCode.replace('![[body.png]]', '![body](/body.png)'));

  assert.equal(
    normalizePicGoUploadUrl("http://127.0.0.1:36677"),
    "http://127.0.0.1:36677/upload"
  );
  assert.equal(
    getPicGoHeartbeatUrl("http://127.0.0.1:36677/upload"),
    "http://127.0.0.1:36677/heartbeat"
  );
  const picgoUrls = await uploadWithPicGo(
    ["C:\\vault\\image.png"],
    {
      serverUrl: "http://127.0.0.1:36677/upload",
      secret: "test-secret",
    },
    async (request) => {
      assert.equal(request.url, "http://127.0.0.1:36677/upload");
      assert.equal(request.headers.Authorization, "Bearer test-secret");
      assert.deepEqual(JSON.parse(request.body), {
        list: ["C:\\vault\\image.png"],
      });
      return {
        status: 200,
        json: {
          success: true,
          result: ["https://images.example.com/image.png"],
        },
      };
    }
  );
  assert.deepEqual(picgoUrls, ["https://images.example.com/image.png"]);
  await assert.rejects(
    uploadWithPicGo(
      ["C:\\vault\\image.png"],
      { serverUrl: "http://127.0.0.1:36677" },
      async () => ({
        status: 401,
        json: { success: false, message: "Unauthorized" },
      })
    ),
    /PicGo 上传失败：Unauthorized/
  );

  const blogDirectory = await mkdtemp(path.join(os.tmpdir(), "easy-pub-hexo-"));
  try {
    await writeFile(
      path.join(blogDirectory, "_config.yml"),
      [
        "url: 'https://example.com/blog' # site URL",
        "filename_case: 1",
        "permalink: :year/:month/:title/",
      ].join("\n")
    );
    const targetPath = path.join(
      blogDirectory,
      "source",
      "_posts",
      "File Name.md"
    );
    const url = await generateHexoUrl(blogDirectory, {
      title: "Front Matter 标题",
      date: "2026-07-27T00:00:00.000Z",
    }, targetPath);
    assert.equal(url, "https://example.com/blog/2026/07/file-name/");
    assert.equal(await getHexoRootPath(blogDirectory), "/blog/");

    await writeFile(
      path.join(blogDirectory, "_config.yml"),
      [
        "url: http://threeyang3.github.io",
        "permalink: posts/:abbrlink/",
      ].join("\n")
    );
    assert.equal(
      await generateHexoUrl(blogDirectory, { abbrlink: "8d48" }, targetPath),
      "http://threeyang3.github.io/posts/8d48/"
    );
    assert.equal(
      await generateHexoUrl(blogDirectory, {}, targetPath),
      null
    );

    await assert.rejects(
      validateHexoBlog(path.join(blogDirectory, "missing")),
      /路径不存在/
    );
    await assert.rejects(
      validateHexoDeployment(blogDirectory),
      /deploy\.type/
    );

    await writeFile(
      path.join(blogDirectory, "_config.yml"),
      [
        "url: 'https://example.com/blog'",
        "filename_case: 1",
        "permalink: :year/:month/:title/",
        "deploy:",
        "  type: git",
      ].join("\n")
    );
    await assert.rejects(
      deployHexo(blogDirectory),
      /未安装本地 Hexo/
    );

    const hexoPackageDirectory = path.join(blogDirectory, "node_modules", "hexo");
    await mkdir(path.join(hexoPackageDirectory, "bin"), { recursive: true });
    await writeFile(
      path.join(hexoPackageDirectory, "package.json"),
      JSON.stringify({
        name: "hexo",
        version: "test",
        bin: { hexo: "bin/hexo.js" },
      })
    );
    await writeFile(
      path.join(hexoPackageDirectory, "bin", "hexo.js"),
      [
        'const fs = require("fs");',
        'const path = require("path");',
        'if (process.versions.electron) throw new Error("Hexo must run in Node");',
        'fs.appendFileSync(path.join(process.cwd(), "commands.log"), process.argv.slice(2).join(" ") + "\\n");',
        'if (process.argv[2] === "deploy" && fs.existsSync(path.join(process.cwd(), "fail-deploy"))) {',
        '  console.error("simulated deploy failure");',
        "  process.exit(2);",
        "}",
      ].join("\n")
    );

    await buildHexo(blogDirectory);
    let commands = await readFile(path.join(blogDirectory, "commands.log"), "utf8");
    assert.deepEqual(commands.trim().split("\n"), [
      "clean",
      "generate --bail",
    ]);

    await writeFile(path.join(blogDirectory, "commands.log"), "");
    await deployHexo(blogDirectory);
    commands = await readFile(path.join(blogDirectory, "commands.log"), "utf8");
    assert.deepEqual(commands.trim().split("\n"), [
      "clean",
      "generate --bail",
      "deploy",
    ]);

    await writeFile(path.join(blogDirectory, "fail-deploy"), "");
    await assert.rejects(
      deployHexo(blogDirectory),
      /Hexo deploy 失败：simulated deploy failure/
    );

    await mkdir(path.join(blogDirectory, "admin"), { recursive: true });
    await mkdir(path.join(blogDirectory, ".blog-admin"), { recursive: true });
    await writeFile(path.join(blogDirectory, "ManageBlog.bat"), "@echo off\nnpm run gui\n");
    await writeFile(path.join(blogDirectory, "admin", "server.js"), "'use strict';\n");
    await writeFile(
      path.join(blogDirectory, "package.json"),
      JSON.stringify({ scripts: { gui: "node unsafe-server.js" } })
    );
    await assert.rejects(findControlRoomIntegration(blogDirectory), /不完整.*Control Room|不完整的 Blog Control Room/);

    await writeFile(
      path.join(blogDirectory, "package.json"),
      JSON.stringify({ scripts: { gui: "node admin/server.js" } })
    );
    const integration = await findControlRoomIntegration(blogDirectory);
    assert.ok(integration);
    assert.equal(integration.launcherPath, path.join(blogDirectory, "ManageBlog.bat"));
    assert.equal(
      integration.sessionPath,
      path.join(blogDirectory, ".blog-admin", "control-room.json")
    );

    await writeFile(
      integration.sessionPath,
      JSON.stringify({
        version: 1,
        pid: 1234,
        host: "127.0.0.1",
        port: 4173,
        url: `http://127.0.0.1:4173/?token=${"b".repeat(48)}`,
      })
    );
    const discoveredSession = await readControlRoomSession(integration.sessionPath);
    assert.ok(discoveredSession);
    assert.equal(discoveredSession.token, "b".repeat(48));
  } finally {
    await rm(blogDirectory, { recursive: true, force: true });
  }

  console.log("EasyPub core tests passed");
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
