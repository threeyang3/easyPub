import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, rename } from "node:fs/promises";
import path from "path";
import os from "os";
import EasyPub from "../main";
import { DEFAULT_SETTINGS, PLATFORMS } from "../types";
import { generateHexoUrl } from "../utils/linkUtils";
import { parseFrontMatter } from "../utils/frontMatter";
import { resolveWechatSourceUrl } from "../utils/wechatSourceUrl";

export async function runWechatSourceUrlTests() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ep-source-link-"));
  try {
    const directory = path.join(root, "source/_drafts/nested");
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, "renamed.md");
    const raw = "---\npub_id: stable\ntitle: Same title\nabbrlink: ab12\npublish_url: https://stale.example/wrong\n---\nBody without final newline";
    const config = path.join(root, "_config.yml");
    await writeFile(config, "url: https://blog.example/sub/\npermalink: posts/:abbrlink/\n");
    const plugin = Object.assign(Object.create(EasyPub.prototype), { settings: { ...DEFAULT_SETTINGS, hexoRepoPath: root } });
    const expected = "https://blog.example/sub/posts/ab12/";
    assert.match((await plugin.resolveWechatSourceUrl("stable")).reason!, /请先生成/);
    await writeFile(target, raw);
    await writeFile(path.join(directory, "same-title.md"), raw.replace("stable", "unrelated"));
    assert.equal((await plugin.resolveWechatSourceUrl("stable")).url, expected);
    assert.equal(await readFile(target, "utf8"), raw); // Lookup never rewrites drafts.
    const wechat = PLATFORMS.find(p => p.id === "wechat")!;
    const source = {path: "source.md", basename: "source"};
    const build = (wechatData?: Record<string, unknown>) => plugin.buildPublishedFrontMatter(wechat, source,
      {wechat: {sourceUrl: "https://source-must-not-leak.example"}}, null, "stable", "now", "local.md",
      {title: "New title", wechat: wechatData ?? {}});
    assert.equal((await build()).wechat.sourceUrl, expected);
    assert.equal((await build({sourceUrl: "https://manual.example/"})).wechat.sourceUrl, "https://manual.example/");
    assert.equal((await build({sourceUrl: ""})).wechat.sourceUrl, "");
    const existing = "---\npub_id: stable\nwechat:\n  sourceUrl: https://manual.example/\n  publishedUrl: https://mp.weixin.qq.com/s/article\n  custom: keep\n---\nBody";
    const updated = await plugin.buildPublishedFrontMatter(wechat, source, {}, existing, "stable", "now", "local.md");
    assert.equal(updated.wechat.sourceUrl, "https://manual.example/");
    assert.equal(updated.wechat.custom, "keep");
    const duplicate = path.join(root, "source/_posts/duplicate.md");
    await mkdir(path.dirname(duplicate), {recursive: true}); await writeFile(duplicate, raw);
    assert.match((await plugin.resolveWechatSourceUrl("stable")).reason!, /多个/);
    assert.equal((await build()).wechat.sourceUrl, undefined);
    await rm(duplicate);
    const post = path.join(root, "source/_posts/nested/another-name.md");
    await mkdir(path.dirname(post), {recursive: true}); await rename(target, post);
    assert.equal((await plugin.resolveWechatSourceUrl("stable")).url, expected);
    await writeFile(config, "url: https://new.example\npermalink: changed/:abbrlink/\n");
    assert.equal((await plugin.resolveWechatSourceUrl("stable")).url, "https://new.example/changed/ab12/");
    await writeFile(config, "url: https://blog.example\npermalink: posts/:unknown/\n");
    assert.match((await plugin.resolveWechatSourceUrl("stable")).reason!, /尚不能确定/);
    await writeFile(config, "url: https://user:secret@blog.example\npermalink: posts/:abbrlink/\n");
    assert.equal((await plugin.resolveWechatSourceUrl("stable")).url, undefined);
    await writeFile(config, "url: https://blog.example\npermalink: posts/:abbrlink/\n");
    const changed = await resolveWechatSourceUrl({
      publishDirectoryExists: plugin.publishDirectoryExists.bind(plugin), listPublishFiles: plugin.listPublishFiles.bind(plugin),
      readPublishFile: plugin.readPublishFile.bind(plugin),
    }, root, "stable", async (...args) => { const url = await generateHexoUrl(...args); await writeFile(post, raw + "changed"); return url; });
    assert.match(changed.reason!, /已变化/);
    await writeFile(path.join(directory, "broken.md"), "---\ninvalid: [\n---\n");
    assert.equal((await plugin.resolveWechatSourceUrl("stable")).url, undefined);
    assert.equal(await generateHexoUrl(root, parseFrontMatter(raw).data, path.join(root, "outside.md")), null);
    assert.deepEqual(await resolveWechatSourceUrl({} as any, "", "stable", generateHexoUrl), {});
  } finally { await rm(root, {recursive: true, force: true}); }
  console.log("WeChat original link: draft/post URL, identity, manual/empty preservation, current config, conflicts and read-only lookup passed");
}
