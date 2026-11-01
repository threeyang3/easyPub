import fs from "fs/promises";
import path from "path";
import { asObject } from "./articleProperties";
import { parseYamlDocument } from "./frontMatter";

export interface BlogTaxonomy { categoryPaths: string[][]; tags: string[]; warnings: string[] }

/** Read optional editorial data without starting the management server. */
export async function readBlogTaxonomy(repo: string): Promise<BlogTaxonomy> {
  const result: BlogTaxonomy = { categoryPaths: [], tags: [], warnings: [] };
  if (!repo || !path.isAbsolute(repo)) return result;
  const read = async (name: string, parse: (text: string) => void) => {
    try { parse(await fs.readFile(path.join(repo, "source", "_data", name), "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") result.warnings.push(`无法读取博客 ${name}，请检查格式和读取权限；仍可手动填写属性。`);
    }
  };
  await read("discovery.yml", text => {
    const categories = asObject(parseYamlDocument(text).categories);
    for (const [name, value] of Object.entries(categories)) {
      result.categoryPaths.push([name]);
      for (const child of Object.keys(asObject(asObject(value).children))) result.categoryPaths.push([name, child]);
    }
  });
  await read("tag-taxonomy.json", text => {
    const groups = asObject(JSON.parse(text)).groups;
    if (!Array.isArray(groups)) throw new Error("标签分组必须为数组");
    for (const group of groups) {
      const tags = asObject(group).tags;
      if (!Array.isArray(tags) || tags.some(tag => typeof tag !== "string")) throw new Error("标签必须为文本数组");
      result.tags.push(...tags);
    }
  });
  result.tags = [...new Set(result.tags)];
  return result;
}
