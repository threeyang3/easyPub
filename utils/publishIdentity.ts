import { App, TFile, normalizePath } from "obsidian";
import { getFrontMatterString, parseFrontMatter } from "./frontMatter";

/** Read-only validation: old IDs and source_file formats are never migrated. */
export async function assertPublishIdentity(app: App, sourcePath: string, pubId: string,
  targets: Array<{ path: string; content: string }>, publishedRoots: string[]): Promise<void> {
  if (targets.length > 1) throw new Error(`多个发布稿使用相同 pub_id，请先核对关联：${targets.map(t => t.path).join("、")}`);
  const conflict = (owner: string) => new Error(`pub_id 与另一篇源文章冲突：${owner}。已停止发布，不会覆盖或重新关联。若当前文章是副本，请仅删除副本的 pub_id 和子文件字段后重新发布；若是移动或重命名，请先核对原有关系。`);
  for (const target of targets) {
    const raw = getFrontMatterString(parseFrontMatter(target.content).data, "source_file");
    if (!raw) continue; // Older drafts may not carry a source link.
    const link = raw.replace(/^\[\[|\]\]$/g, "").split("|", 1)[0].split("#", 1)[0];
    const normalized = normalizePath(link.replace(/\\/g, "/"));
    const exact = app.vault.getAbstractFileByPath(normalized.endsWith(".md") ? normalized : `${normalized}.md`);
    const owner = exact instanceof TFile ? exact : app.metadataCache.getFirstLinkpathDest(link, sourcePath);
    if (owner instanceof TFile && owner.path !== sourcePath) throw conflict(owner.path);
  }
  // Copies can retain both the ID and old child references. Check source claims
  // even when the historical draft has no source_file or its link is stale.
  const targetPaths = new Set(targets.map(target => normalizePath(target.path)));
  for (const file of app.vault.getMarkdownFiles()) {
    if (file.path === sourcePath || targetPaths.has(file.path)
      || publishedRoots.some(root => file.path.startsWith(`${normalizePath(root)}/`))) continue;
    const text = await app.vault.read(file);
    let data;
    try { data = parseFrontMatter(text).data; }
    catch { continue; } // An unrelated malformed note must not break old workflows.
    if (getFrontMatterString(data, "pub_id") !== pubId || data.source_file) continue;
    throw conflict(file.path);
  }
}
