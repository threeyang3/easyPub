import path from "path";
import { FrontMatterData, PLATFORMS } from "../types";
import { getFrontMatterString, parseFrontMatter } from "./frontMatter";
import { HexoLocatorIO, locateHexoArticles } from "./hexoLocator";

export interface WechatSourceUrl { url?: string; reason?: string }
type SourceIO = HexoLocatorIO;

/** Read only: calculate from current Hexo configuration, never trust stale publish_url. */
export async function resolveWechatSourceUrl(io: SourceIO, repository: string, pubId: string,
  generate: (repository: string, data: FrontMatterData, file: string) => Promise<string | null>): Promise<WechatSourceUrl> {
  if (!repository || !pubId) return {};
  try {
    if (!path.isAbsolute(repository)) throw new Error("Hexo 仓库路径必须为绝对路径");
    const platform = PLATFORMS.find(item => item.id === "hexo")!;
    const matches = await locateHexoArticles(io,repository,pubId);
    const entry = matches.entries().next().value;
    if (!entry) throw new Error("请先生成同一原稿的 Hexo 稿件，再刷新工作台");
    const target = {file:entry[0],raw:entry[1],data:parseFrontMatter(entry[1],true).data};
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
