import assert from "node:assert/strict";
import { TFile } from "obsidian";
import EasyPub from "../main";
import { ArticlePropertiesModal } from "../modals/ArticlePropertiesModal";
import { DiffModal } from "../modals/DiffModal";
import { applyPropertySelection, canonicalWechatTitle, initialPlatformProperties, legacyPropertyKeys } from "../utils/articleProperties";
import { mergePublishedFrontMatter, parseFrontMatter, stringifyFrontMatter } from "../utils/frontMatter";
import { normalizeSettings } from "../utils/settings";
import { wechatArticleNeedsSave } from "../utils/wechatState";
import { PLATFORMS } from "../types";

export async function runArticlePropertyTests() {
  const source = { title: "Source", author: "Writer", description: "Summary", tags: ["AI"], categories: ["Tech"],
    cover: "https://example.com/cover.png", date: "2020-01-01", aliases: ["private"], secret: "never export",
    zhihu_type: "想法", wechat: { author: "wrong" }, top_img: "/source-only.png", layout: "private", abbrlink: "dead" };
  const identity = { pubId: "stable", sourceFileLink: "[[source]]", timestamp: "2026-10-26" };
  for (const platform of PLATFORMS) {
    const first = mergePublishedFrontMatter({ ...identity, platformId: platform.id, sourceData: source });
    for (const key of ["aliases", "secret", "top_img", "zhihu_type", "wechat", "categories", "author", "abbrlink"]) {
      if (platform.id === "hexo" && ["top_img", "categories", "author"].includes(key)
        || platform.id === "zhihu" && key === "zhihu_type" || platform.id === "wechat" && key === "wechat") continue;
      assert.equal(key in first, false, `${platform.id} should not inherit ${key}`);
    }
    assert.equal(first.date, "2020-01-01"); assert.equal(first.pub_id, "stable");
    if (platform.id === "hexo") { assert.equal(first.layout, "post"); assert.equal(first.top_img, ""); }
    if (platform.id === "zhihu") assert.equal(first.zhihu_type, "文章");
    if (platform.id === "wechat") assert.deepEqual(first.wechat, { author: "Writer", digest: "Summary", cover: source.cover });
    const existing = { ...first, title: "Local", tags: ["Local tag"], localOnly: "keep", 子文件: ["legacy"] };
    const updated = mergePublishedFrontMatter({ ...identity, platformId: platform.id, existingData: existing,
      sourceData: { ...source, title: "Changed source", tags: ["Changed"] } });
    assert.equal(updated.title, "Local"); assert.deepEqual(updated.tags, ["Local tag"]);
    assert.equal(updated.localOnly, "keep"); assert.equal(updated.date, first.date);
    assert.deepEqual(updated.子文件, ["legacy"], "Legacy extra fields need explicit cleanup");
    const selected = applyPropertySelection(updated, { values: { title: source.title }, remove: ["localOnly"] });
    assert.equal(selected.title, source.title); assert.equal(selected.localOnly, undefined);
    assert.deepEqual(selected.tags, ["Local tag"]);
  }
  const original = { title: "old", wechat: { title: "Actual displayed title", author: "A", cropWide: { x: 0 }, cropSquare: { y: 0 }, layout: { theme: "essay" } } };
  const canonical = canonicalWechatTitle(original);
  assert.equal(canonical.title, "Actual displayed title"); assert.equal((canonical.wechat as any).title, undefined);
  assert.equal(original.wechat.title, "Actual displayed title");
  assert.equal(wechatArticleNeedsSave({ title: "T", wechat: { author: "A", digest: "D" } }, { title: "T", author: "A", digest: "D" }), false);
  assert.equal(wechatArticleNeedsSave({ title: "T", wechat: { author: "A" } }, { title: "T", author: "A", digest: "D" }), true);
  assert.equal(wechatArticleNeedsSave({ title: "T", wechat: { title: "T", author: "A" } }, { title: "T", author: "A" }), true);
  const changedCover = applyPropertySelection(canonical, { values: { "wechat.cover": "new.png" }, remove: [] });
  assert.equal((changedCover.wechat as any).cropWide, undefined);
  assert.deepEqual((changedCover.wechat as any).layout, original.wechat.layout);
  assert.deepEqual(legacyPropertyKeys("zhihu", { pub_id: "x", date: "now", title: "T", zhihu_type: "文章", categories: [], password: "x" }), ["categories", "password"]);
  assert.deepEqual(initialPlatformProperties("wechat", {}, "Filename", "Default author"), { title: "Filename", wechat: { author: "Default author" } });

  // Exercise the real orchestration with only the modal decision stubbed.
  const originalPropertiesOpen = ArticlePropertiesModal.prototype.open;
  const originalDiffOpen = DiffModal.prototype.open;
  try {
    const plugin = Object.create(EasyPub.prototype) as EasyPub;
    plugin.settings = normalizeSettings(null);
    const file = Object.assign(new TFile(), { path: "notes/source.md", basename: "source", extension: "md" });
    let sourceText = stringifyFrontMatter("Source body has changed", { ...source, pub_id: "stable" });
    const existing = stringifyFrontMatter("Platform body stays untouched", { title: "Local", pub_id: "stable", source_file: "[[notes/source]]", date: "2019-01-01", tags: ["Local"], private: true, publish_url: "https://old.example.com", workflow: "legacy" });
    let result: any, callback: ((value: boolean) => void) | undefined;
    Object.assign(plugin, { app: { workspace: { getActiveFile: () => file }, vault: { read: async () => sourceText } } });
    plugin.findArticleByPubId = async () => "发布/小红书/source.md";
    plugin.readPublishFile = async () => existing;
    plugin.copyAndOpenForEdit = async diff => { result = diff; };
    ArticlePropertiesModal.prototype.open = function () {
      (this as any).finish({ values: { title: "Reviewed" }, remove: ["private", "publish_url", "workflow"] });
    };
    DiffModal.prototype.open = function () { result = (this as any).diff; callback = (this as any).onConfirm; };
    await plugin.preparePublish(PLATFORMS.find(p => p.id === "xiaohongshu")!, false, { configure: true, propertiesOnly: true });
    const draft = parseFrontMatter(result.sourceContent);
    assert.equal(draft.content.trim(), "Platform body stays untouched");
    assert.equal(draft.data.title, "Reviewed"); assert.deepEqual(draft.data.tags, ["Local"]);
    assert.equal(draft.data.date, "2019-01-01"); assert.equal(draft.data.private, undefined);
    assert.equal(draft.data.publish_url, undefined); assert.equal(draft.data.workflow, undefined);
    callback!(false);

    // Cancel initialization and reject concurrent changes without adding IDs.
    let writes = 0;
    (plugin.app as any).fileManager = { processFrontMatter: async (_file: TFile, update: (data: any) => void) => {
      writes++; const data = parseFrontMatter(sourceText).data; update(data); sourceText = stringifyFrontMatter("Source body has changed", data);
    } };
    ArticlePropertiesModal.prototype.open = function () { (this as any).finish(null); };
    await plugin.initializeSourceProperties(); assert.equal(writes, 0);
    ArticlePropertiesModal.prototype.open = function () {
      sourceText += "\nConcurrent edit";
      (this as any).finish({ values: { title: "Stale" }, remove: [] });
    };
    await assert.rejects(plugin.initializeSourceProperties(), /已变化/); assert.equal(writes, 0);
    ArticlePropertiesModal.prototype.open = function () { (this as any).finish({ values: { title: "Initialized" }, remove: [] }); };
    await plugin.initializeSourceProperties();
    const initialized = parseFrontMatter(sourceText).data;
    assert.equal(initialized.title, "Initialized"); assert.equal(initialized.pub_id, "stable");
    assert.equal(initialized.secret, source.secret);
    sourceText = stringifyFrontMatter("Body", { title: "No ID", custom: true });
    await plugin.initializeSourceProperties();
    assert.match(String(parseFrontMatter(sourceText).data.pub_id), /^[a-f0-9]{16}$/);
    assert.equal(parseFrontMatter(sourceText).data.custom, true);
    const newId = parseFrontMatter(sourceText).data.pub_id;
    await plugin.initializeSourceProperties(); assert.equal(parseFrontMatter(sourceText).data.pub_id, newId);
  } finally { ArticlePropertiesModal.prototype.open = originalPropertiesOpen; DiffModal.prototype.open = originalDiffOpen; }
  console.log("Article properties: platform boundaries, local ownership, selected refresh, cancellation and stale-source guards passed");
}
