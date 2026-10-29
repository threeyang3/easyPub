import path from "path";
import { FrontMatterData, Platform, PLATFORMS } from "../types";
import { getFrontMatterString, parseFrontMatter, stringifyFrontMatter } from "./frontMatter";
import { validateWechatArticleUrl } from "./wechatArticleUrl";

export interface AssociationIO {
  publishDirectoryExists(platform: Platform, directory: string): Promise<boolean>;
  listPublishFiles(platform: Platform, directory: string): Promise<string[]>;
  readPublishFile(platform: Platform, file: string): Promise<string>;
  writePublishFile(platform: Platform, file: string, content: string, expected: string, guard: () => void, beforeCommit: () => Promise<void>): Promise<void>;
}
export interface Association { publishedUrl?: string; commentsEnabled?: boolean }
export function associationFields(data: FrontMatterData): Association {
  return { publishedUrl: typeof data.wechat_article_url === "string" ? data.wechat_article_url : undefined,
    commentsEnabled: typeof data.wechat_comments_enabled === "boolean" ? data.wechat_comments_enabled : undefined };
}
export function patchAssociation(raw: string, value: Association): string {
  const parsed = parseFrontMatter(raw, true);
  delete parsed.data.wechat_article_url; delete parsed.data.wechat_comments_enabled;
  if (value.publishedUrl) {
    parsed.data.wechat_article_url = validateWechatArticleUrl(value.publishedUrl);
    if (typeof value.commentsEnabled === "boolean") parsed.data.wechat_comments_enabled = value.commentsEnabled;
  }
  return stringifyFrontMatter(parsed.content, parsed.data);
}
export async function prepareAssociation(io: AssociationIO, repository: string, pubId: string, value: Association) {
  if (!path.isAbsolute(repository) || !pubId) throw new Error("需要 Hexo 绝对路径和当前稿件 pub_id，不能按标题匹配");
  value = {...value};
  if (value.publishedUrl) value.publishedUrl = validateWechatArticleUrl(value.publishedUrl);
  const platform = PLATFORMS.find(p => p.id === "hexo")!;
  const find = async () => {
    const matches: Array<{path: string; raw: string}> = [];
    for (const folder of ["_posts", "_drafts"]) {
      const directory = path.join(repository, "source", folder);
      if (!await io.publishDirectoryExists(platform, directory)) continue;
      for (const file of await io.listPublishFiles(platform, directory)) {
        if (!file.toLowerCase().endsWith(".md")) continue;
        const raw = await io.readPublishFile(platform, file);
        if (getFrontMatterString(parseFrontMatter(raw, true).data, "pub_id") === pubId) matches.push({path:file, raw});
      }
    }
    if (matches.length !== 1) throw new Error(matches.length ? "pub_id 有多个 Hexo 匹配，已停止修改" : "未找到对应 pub_id 的 Hexo 发布稿");
    return matches[0];
  };
  const target = await find();
  const data = parseFrontMatter(target.raw, true).data;
  const current = associationFields(data);
  const next = patchAssociation(target.raw, value);
  return { ...target, title: getFrontMatterString(data,"title") ?? "未命名", current, value,
    synced: JSON.stringify(current) === JSON.stringify(value),
    async commit(guard: () => void, checkLocal: () => Promise<void>) {
      await io.writePublishFile(platform, target.path, next, target.raw, guard, async () => {
        await checkLocal();
        const latest = await find();
        if (latest.path !== target.path || latest.raw !== target.raw) throw new Error("Hexo 稿件或匹配关系已变化，请重新预览关联");
      });
    }
  };
}
