import path from "path";
import { FrontMatterData, PLATFORMS } from "../types";
import { getFrontMatterString, parseFrontMatter } from "./frontMatter";
import type { AssociationIO } from "./wechatAssociation";

export interface WechatSourceUrl { url?: string; reason?: string }
type SourceIO = Pick<AssociationIO, "publishDirectoryExists" | "listPublishFiles" | "readPublishFile">;

/** Read only: calculate from current Hexo configuration, never trust stale publish_url. */
export async function resolveWechatSourceUrl(io: SourceIO, repository: string, pubId: string,
  generate: (repository: string, data: FrontMatterData, file: string) => Promise<string | null>): Promise<WechatSourceUrl> {
  if (!repository || !pubId) return {};
  try {
    if (!path.isAbsolute(repository)) throw new Error("Hexo 仓库路径必须为绝对路径");
    const platform = PLATFORMS.find(item => item.id === "hexo")!;
    const matches: Array<{ file: string; raw: string; data: FrontMatterData }> = [];
    for (const folder of ["_posts", "_drafts"]) {
      const directory = path.join(repository, "source", folder);
      if (!await io.publishDirectoryExists(platform, directory)) continue;
      for (const file of await io.listPublishFiles(platform, directory)) {
        if (!file.toLowerCase().endsWith(".md")) continue;
        const raw = await io.readPublishFile(platform, file);
        const data = parseFrontMatter(raw, true).data;
        if (getFrontMatterString(data, "pub_id") === pubId) matches.push({ file, raw, data });
      }
    }
    if (matches.length !== 1) throw new Error(matches.length ? "同一 pub_id 有多个 Hexo 稿件，请先解决冲突" : "请先生成同一原稿的 Hexo 稿件，再刷新工作台");
    const target = matches[0];
    const url = await generate(repository, target.data, target.file);
    if (await io.readPublishFile(platform, target.file) !== target.raw) throw new Error("Hexo 稿件已变化，请刷新重试");
    if (!url) throw new Error("Hexo 网址尚不能确定，请检查博客配置和稿件固定链接");
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password
      || /[\s\\]/.test(url) || new TextEncoder().encode(url).length > 1024) throw new Error("Hexo 网址不适合作为阅读原文链接，请检查配置");
    return { url };
  } catch (error) {
    return { reason: `阅读原文未自动填写：${(error as Error).message}` };
  }
}
