import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readBlogTaxonomy } from "../utils/blogTaxonomy";
import { completeControlRoomMetadata } from "../utils/publishSafety";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import EasyPub from "../main";
import { ArticlePropertiesModal } from "../modals/ArticlePropertiesModal";
import { createSourceArticle, planNewArticle } from "../utils/sourceArticle";
import { parseFrontMatter } from "../utils/frontMatter";
import { normalizeSettings } from "../utils/settings";

export async function runSourceArticleTests() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "easypub-taxonomy-"));
  try {
    assert.deepEqual(await readBlogTaxonomy(repo), { categoryPaths: [], tags: [], warnings: [] });
    const data = path.join(repo, "source", "_data");
    await mkdir(data, { recursive: true });
    await writeFile(path.join(data, "discovery.yml"), "categories:\n  评论:\n    children:\n      读书: 观点\n  笔记:\n    children:\n      读书: 摘录\n");
    await writeFile(path.join(data, "tag-taxonomy.json"), JSON.stringify({groups: [{tags: ["写作", "物理"]}, {tags: ["写作"]}], legacy: {旧标签: []}}));
    const taxonomy = await readBlogTaxonomy(repo);
    assert.deepEqual(taxonomy.categoryPaths, [["评论"], ["评论", "读书"], ["笔记"], ["笔记", "读书"]]);
    assert.deepEqual(taxonomy.tags, ["写作", "物理"]);
    await writeFile(path.join(data, "tag-taxonomy.json"), "{");
    const invalid = await readBlogTaxonomy(repo);
    assert.equal(invalid.warnings.length, 1);
    assert.deepEqual(invalid.categoryPaths, taxonomy.categoryPaths);
    assert.deepEqual(invalid.tags, []);
  } finally { await rm(repo, { recursive: true, force: true }); }
  for (const metadata of [{tags: ["写作，物理"]}, {tags: ["a\nb"]}, {tags: ["a".repeat(61)]},
    {categories: [42]}, {description: "a".repeat(501)}, {title: "a".repeat(201)}]) {
    assert.throws(() => completeControlRoomMetadata(metadata, "标题", new Set()));
  }
  const metadata = { tags: ["自定义标签"], categories: [["评论", "读书"], ["笔记", "读书"]], custom: true };
  const completed = completeControlRoomMetadata(metadata, "标题", new Set());
  assert.deepEqual(completed.tags, metadata.tags);
  assert.deepEqual(completed.categories, metadata.categories);
  assert.equal(completed.custom, true);

  for (const folder of ["../escape", "/tmp", "C:\\tmp", ".obsidian", "notes/../escape", "notes//bad", "发布/微信公众号"])
    assert.throws(() => planNewArticle({ title: "T", folder }, "id", ["发布/微信公众号"], () => false));
  assert.throws(() => planNewArticle({title: " "}, "id", [], () => false), /标题/);
  const files = new Map<string, any>();
  const text = new Map<string, string>();
  let opened: any;
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => files.get(p),
      getMarkdownFiles: () => [...files.values()].filter(f => f instanceof TFile),
      createFolder: async (p: string) => { files.set(p, Object.assign(new TFolder(), {path: p})); },
      create: async (p: string, content: string) => {
        if (files.has(p)) throw Error("exists");
        const file = Object.assign(new TFile(), {path: p}); files.set(p, file); text.set(p, content); return file;
      },
    },
    metadataCache: { getFileCache: (f: TFile) => ({frontmatter: parseFrontMatter(text.get(f.path) ?? "").data}) },
    workspace: {getActiveFile: () => null, getLeaf: () => ({openFile: async (f: TFile) => {opened = f;}})},
  } as unknown as App;
  const values = {title: "同名文章", folder: "随笔/新稿", author: "作者", tags: ["写作"], date: "2022-04-26",
    pub_id: "copied-id", source_file: "[[wrong]]", 子文件: ["wrong"], publish_url: "wrong"};
  const first = await createSourceArticle(app, values, "first-id", []);
  const second = await createSourceArticle(app, values, "second-id", []);
  assert.equal(first.path, "随笔/新稿/同名文章.md"); assert.equal(second.path, "随笔/新稿/同名文章 (2).md");
  const fm = parseFrontMatter(text.get(second.path)!).data;
  assert.equal(fm.pub_id, "second-id"); assert.deepEqual(fm.写作状态, ["草稿📝"]);
  for (const key of ["author", "description", "tags", "categories", "cover"]) assert.ok(key in fm);
  for (const key of ["folder", "source_file", "子文件", "publish_url", "updated"]) assert.equal(key in fm, false);
  assert.equal(fm.date, "2022-04-26");
  const collision = await createSourceArticle(app, {...values, date: ""}, "first-id", []);
  const collisionFm = parseFrontMatter(text.get(collision.path)!).data;
  assert.notEqual(collisionFm.pub_id, "first-id"); assert.match(String(collisionFm.pub_id), /^[a-f0-9]{16}$/);
  assert.equal("date" in collisionFm, false);
  const blocker = Object.assign(new TFile(), {path: "blocked"}); files.set("blocked", blocker);
  await assert.rejects(createSourceArticle(app, {title:"T", folder:"blocked/nested"}, "x", []), /被文件占用/);

  const originalOpen = ArticlePropertiesModal.prototype.open, originalClose = ArticlePropertiesModal.prototype.close;
  const plugin = Object.create(EasyPub.prototype) as EasyPub;
  plugin.settings = normalizeSettings(null); plugin.app = app;
  (plugin as any).assertSettingsWritable = () => {};
  try {
    const before = files.size;
    ArticlePropertiesModal.prototype.open = function () { (this as any).finish(null); };
    await plugin.newArticle(); assert.equal(files.size, before); assert.equal((plugin as any).publishInProgress, false);
    ArticlePropertiesModal.prototype.open = function () {
      const ctx = (this as any).context;
      const selection = {values: {...ctx.current, title: "全新原稿"}, remove: []};
      const preview = ctx.previewSelection(selection);
      assert.match(preview.属性.pub_id, /^[a-f0-9]{16}$/);
      assert.deepEqual(preview.属性.写作状态, ["草稿📝"]);
      (this as any).finish(selection);
    };
    await plugin.newArticle(); assert.equal(opened.path, "随笔/全新原稿.md");
    ArticlePropertiesModal.prototype.open = function () { throw Error("render failed"); };
    ArticlePropertiesModal.prototype.close = function () {};
    await assert.rejects(plugin.newArticle(), /render failed/); assert.equal((plugin as any).publishInProgress, false);
  } finally { ArticlePropertiesModal.prototype.open = originalOpen; ArticlePropertiesModal.prototype.close = originalClose; }
}
