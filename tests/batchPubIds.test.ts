import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { externalPubIdDocuments, fillMissingPubIds } from "../utils/batchPubIds";
import { parseFrontMatter } from "../utils/frontMatter";
import EasyPub from "../main";
import { TFolder } from "obsidian";

export async function runBatchPubIdTests() {
  const plugin = Object.create(EasyPub.prototype) as EasyPub;
  const inside = { path: "articles/new.md", metadata: {} as Record<string, unknown> };
  const adjacent = { path: "articles-other/new.md", metadata: {} as Record<string, unknown> };
  let processed = 0;
  (plugin as any).app = {
    vault: {
      getAbstractFileByPath: (folder: string) => folder === "articles" ? new TFolder() : null,
      getMarkdownFiles: () => [inside, adjacent],
      read: async () => "body",
    },
    fileManager: { processFrontMatter: async (file: typeof inside, update: (data: Record<string, unknown>) => void) => {
      processed++;
      // Another actor added an ID after the scan; preserve it.
      file.metadata.pub_id = "concurrent-id";
      update(file.metadata);
    } },
  };
  const vaultResult = await plugin.fillFolderPubIds("vault", "articles");
  assert.equal(processed, 1);
  assert.equal(vaultResult.added, 0);
  assert.equal(vaultResult.skipped, 1);
  assert.equal(inside.metadata.pub_id, "concurrent-id");
  assert.deepEqual(adjacent.metadata, {});
  await assert.rejects(plugin.fillFolderPubIds("vault", "../articles"), /相对路径/);
  await assert.rejects(plugin.fillFolderPubIds("vault", "missing"), /不存在/);
  (plugin as any).publishConfirmationOpen = true;
  await assert.rejects(plugin.fillFolderPubIds("vault", "articles"), /任务/);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "easy-pub-ids-"));
  try {
    await fs.mkdir(path.join(root, "nested"));
    const body = "# Article\n\n![[photo.png]]\n```yaml\npub_id: example\n```\n";
    await fs.writeFile(path.join(root, "new.md"), body);
    await fs.writeFile(path.join(root, "nested", "empty.md"), "---\ntitle: Old\ncustom: [one, two]\npub_id: ''\n---\n" + body);
    const existing = "---\npub_id: keep-this\n---\nunchanged\n";
    await fs.writeFile(path.join(root, "existing.md"), existing);
    const invalid = "---\ntags: [broken\n---\nbody";
    await fs.writeFile(path.join(root, "bad.md"), invalid);
    await fs.writeFile(path.join(root, "array.md"), "---\n- one\n- two\n---\nbody");
    await fs.writeFile(path.join(root, "ignore.txt"), "ignore");
    const documents = await externalPubIdDocuments(root);
    const result = await fillMissingPubIds(documents);
    assert.equal(result.added, 2);
    assert.equal(result.skipped, 1);
    assert.equal(result.failures.length, 2);
    const a = parseFrontMatter(await fs.readFile(path.join(root, "new.md"), "utf8"));
    const b = parseFrontMatter(await fs.readFile(path.join(root, "nested", "empty.md"), "utf8"));
    assert.match(String(a.data.pub_id), /^[a-f0-9]{16}$/);
    assert.notEqual(a.data.pub_id, b.data.pub_id);
    assert.equal(a.content, body);
    assert.equal(b.content, body);
    assert.deepEqual(b.data.custom, ["one", "two"]);
    assert.equal(await fs.readFile(path.join(root, "existing.md"), "utf8"), existing);
    assert.equal(await fs.readFile(path.join(root, "bad.md"), "utf8"), invalid);
    assert.equal((await fillMissingPubIds(await externalPubIdDocuments(root))).added, 0);
    await fs.writeFile(path.join(root, "race.md"), "original");
    const race = (await externalPubIdDocuments(root)).find(d => d.path.endsWith("race.md"))!;
    const originalRead = race.read;
    race.read = async () => { const content = await originalRead(); await fs.writeFile(race.path, "concurrent edit"); return content; };
    assert.equal((await fillMissingPubIds([race])).failures.length, 1);
    assert.equal(await fs.readFile(race.path, "utf8"), "concurrent edit");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
