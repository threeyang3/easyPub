import { App, TFolder } from "obsidian";
import { FrontMatterData } from "../types";
import { generatePubId, stringifyFrontMatter } from "./frontMatter";
import { sanitizeFileName } from "./platforms";

export interface NewArticlePlan { folder: string; path: string; metadata: FrontMatterData }

/** Validate vault-relative destinations before creating folders or files. */
export function planNewArticle(values: FrontMatterData, pubId: string, publishDirectories: string[],
  occupied: (path: string) => boolean): NewArticlePlan {
  const folder = String(values.folder ?? "").trim().replace(/\\/g, "/").replace(/\/$/, "");
  if (folder && (folder.startsWith("/") || /^[a-z]:/i.test(folder)
    || folder.split("/").some(part => !part || part.startsWith(".") || /[<>:"|?*\x00-\x1f]/.test(part)))) {
    throw new Error("保存目录须为仓库内的普通文件夹路径，不能使用绝对路径、隐藏目录或 ..");
  }
  if (publishDirectories.some(dir => folder === dir || folder.startsWith(`${dir}/`))) {
    throw new Error("原稿请保存在发布目录之外");
  }
  const title = String(values.title ?? "").trim();
  if (!title) throw new Error("请填写标题");
  const name = sanitizeFileName(title.replace(/[\[\]#^]/g, "-"));
  const stem = folder ? `${folder}/${name}` : name;
  let target = `${stem}.md`, sequence = 2;
  while (occupied(target)) target = `${stem} (${sequence++}).md`;
  const metadata: FrontMatterData = { title, author: String(values.author ?? "").trim(),
    description: String(values.description ?? "").trim(), tags: values.tags ?? [],
    categories: values.categories ?? ["随笔"], cover: values.cover ?? "", pub_id: pubId,
    写作状态: ["草稿📝"], 版次: ["初稿"] };
  for (const key of ["tags", "categories"]) {
    if (!Array.isArray(metadata[key])) throw new Error("标签和分类请填写文本列表");
  }
  if (values.date) {
    if (Number.isNaN(Date.parse(String(values.date)))) throw new Error("日期格式无效");
    metadata.date = values.date;
  }
  return { folder, path: target, metadata };
}

export async function createSourceArticle(app: App, values: FrontMatterData, pubId: string,
  publishDirectories: string[]) {
  const occupied = (p: string) => !!app.vault.getAbstractFileByPath(p);
  let plan = planNewArticle(values, pubId, publishDirectories, occupied);
  const reserved = new Set(app.vault.getMarkdownFiles().map(file => app.metadataCache.getFileCache(file)?.frontmatter?.pub_id));
  while (reserved.has(pubId)) pubId = generatePubId();
  let folder = "";
  for (const part of plan.folder.split("/").filter(Boolean)) {
    folder = folder ? `${folder}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(folder);
    if (existing && !(existing instanceof TFolder)) throw new Error(`保存目录被文件占用：${folder}`);
    if (!existing) {
      try { await app.vault.createFolder(folder); }
      catch (error) { if (!(app.vault.getAbstractFileByPath(folder) instanceof TFolder)) throw error; }
    }
  }
  plan = planNewArticle(values, pubId, publishDirectories, occupied);
  // vault.create is exclusive: a concurrent file creation fails without overwriting.
  return app.vault.create(plan.path, stringifyFrontMatter("\n", plan.metadata));
}
