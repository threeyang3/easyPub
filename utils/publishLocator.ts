import { getFrontMatterString, parseFrontMatter } from "./frontMatter";

interface LocatorEntry { version: string; pubId?: string; invalid: boolean }
export interface PublishLocatorIO {
  version: (path: string) => Promise<string | undefined>;
  read: (path: string) => Promise<string>;
}

/** Read-derived session index. Enumerate on each lookup to discover new files;
 * re-read every matching ID. External versions must include ctime and inode.
 * This is a lookup accelerator, never authorization to overwrite a target. */
export class PublishLocator {
  private entries = new Map<string, LocatorEntry>();
  private revision = 0;
  invalidate(path?: string, oldPath?: string): void {
    this.revision++;
    if (!path) { this.entries.clear(); return; }
    for (const key of this.entries.keys()) if ([path, oldPath].some(candidate => candidate
      && (key === candidate || key.startsWith(`${candidate}/`)))) this.entries.delete(key);
  }
  async find(files: string[], pubId: string, io: PublishLocatorIO): Promise<Map<string, string>> {
    const revision = this.revision;
    const current = new Set(files);
    for (const file of this.entries.keys()) if (!current.has(file)) this.entries.delete(file);
    const matches = new Map<string, string>(), invalid: string[] = [];
    for (const file of current) {
      const version = await io.version(file);
      const cached = this.entries.get(file);
      if (version !== undefined && cached?.version === version && cached.pubId !== pubId) {
        if (cached.invalid) invalid.push(file);
        continue;
      }
      const content = await io.read(file);
      let entry: LocatorEntry;
      try { entry = {version: version ?? "", pubId: getFrontMatterString(parseFrontMatter(content, true).data, "pub_id"), invalid: false}; }
      catch { entry = {version: version ?? "", invalid: true}; }
      if (version !== undefined && revision === this.revision && await io.version(file) === version) this.entries.set(file, entry);
      if (entry.invalid) invalid.push(file);
      else if (entry.pubId === pubId) matches.set(file, content);
    }
    if (revision !== this.revision) throw new Error("稿件查找期间文件发生变化，请重新操作");
    if (invalid.length) throw new Error(`以下发布稿的 Front Matter 无法解析，不能排除 pub_id 冲突。请修复后重新发布，文件未被修改：\n${invalid.join("\n")}`);
    return matches;
  }
}
