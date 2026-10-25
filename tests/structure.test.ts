import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import EasyPub from "../main";
import { EasyPubSettingTab } from "../settings";
import { PLATFORMS } from "../types";
import { normalizeSettings } from "../utils/settings";

export async function runStructureTests() {
  // Moving a local platform draft into a subfolder must not cause a duplicate draft.
  const draft = Object.assign(new TFile(), { path: "发布/小红书/archive/renamed.md" });
  const nested = Object.assign(new TFolder(), { path: "发布/小红书/archive", children: [draft] });
  const root = Object.assign(new TFolder(), { path: "发布/小红书", children: [nested] });
  const files = new Map([root, nested, draft].map(file => [file.path, file]));
  const plugin = Object.create(EasyPub.prototype) as EasyPub;
  plugin.settings = normalizeSettings(null);
  Object.assign(plugin, {app: {vault: {
    getAbstractFileByPath: (path: string) => files.get(path),
    read: async () => "---\npub_id: stable-id\n---\nOriginal draft",
  }}});
  const platform = PLATFORMS.find(item => item.id === "xiaohongshu")!;
  assert.deepEqual(await plugin.listPublishFiles(platform, root.path), [draft.path]);
  assert.equal(await plugin.findArticleByPubId(platform, "stable-id", {title: "new title"}), draft.path);
  assert.equal(await plugin.findArticleByPubId(platform, "unknown", {}), null);

  // Ordinary setting callbacks must absorb save failures and only display the newest result.
  const tab = Object.create(EasyPubSettingTab.prototype) as any;
  tab.saveSequence = 0;
  tab.saveStatus = {textContent: ""};
  const pending: Array<{resolve: () => void; reject: () => void}> = [];
  tab.plugin = {saveSettings: () => new Promise<void>((resolve, reject) => pending.push({resolve, reject: () => reject(new Error("disk unavailable"))}))};
  const first = tab.saveOrdinarySettings();
  const second = tab.saveOrdinarySettings();
  pending[1].reject(); await second;
  assert.match(tab.saveStatus.textContent, /保存失败/);
  pending[0].resolve(); await first;
  assert.match(tab.saveStatus.textContent, /保存失败/);
  const retry = tab.saveOrdinarySettings(); pending[2].resolve(); await retry;
  assert.equal(tab.saveStatus.textContent, "设置已保存");
  const detached = tab.saveOrdinarySettings();
  tab.saveStatus = {textContent: "new display"};
  pending[3].resolve(); await detached;
  assert.equal(tab.saveStatus.textContent, "new display");
  console.log("Structure regressions: nested local drafts and settings save feedback passed");
}
