import {HexoLocatorIO,locateHexoArticles} from "./hexoLocator";
import path from "path";
import { FrontMatterData, Platform, PLATFORMS } from "../types";
import { getFrontMatterString, parseFrontMatter, stringifyFrontMatter } from "./frontMatter";
import { validateWechatArticleUrl } from "./wechatArticleUrl";

export interface AssociationIO extends HexoLocatorIO {
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
// gray-matter appends a trailing body newline when stringifying. Metadata-only
// association edits must retain exact body bytes and saved layout hashes.
function writeMetadata(body: string, data: FrontMatterData): string {
  const header = stringifyFrontMatter("", data);
  const generatedBody = parseFrontMatter(header).content;
  return header.slice(0, header.length - generatedBody.length) + body;
}
export function patchWechatDraftAssociation(raw: string, value: Association): string {
  const parsed = parseFrontMatter(raw, true);
  const previous = parsed.data.wechat;
  if (previous !== undefined && (!previous || typeof previous !== "object" || Array.isArray(previous))) throw new Error("wechat 元数据格式无效");
  const settings = {...previous as Record<string, unknown>};
  delete settings.publishedUrl; delete settings.commentsEnabled;
  if (value.publishedUrl) {
    settings.publishedUrl = validateWechatArticleUrl(value.publishedUrl);
    if (typeof value.commentsEnabled === "boolean") settings.commentsEnabled = value.commentsEnabled;
  }
  parsed.data.wechat = settings;
  return writeMetadata(parsed.content, parsed.data);
}
export function patchAssociation(raw: string, value: Association): string {
  const parsed = parseFrontMatter(raw, true);
  delete parsed.data.wechat_article_url; delete parsed.data.wechat_comments_enabled;
  if (value.publishedUrl) {
    parsed.data.wechat_article_url = validateWechatArticleUrl(value.publishedUrl);
    if (typeof value.commentsEnabled === "boolean") parsed.data.wechat_comments_enabled = value.commentsEnabled;
  }
  return writeMetadata(parsed.content, parsed.data);
}
export async function prepareAssociation(io: AssociationIO, repository: string, pubId: string, value: Association) {
  if (!path.isAbsolute(repository) || !pubId) throw new Error("需要 Hexo 绝对路径和当前稿件 pub_id，不能按标题匹配");
  value = {...value};
  if (value.publishedUrl) value.publishedUrl = validateWechatArticleUrl(value.publishedUrl);
  const platform = PLATFORMS.find(p => p.id === "hexo")!;
  const find = async (strict=false) => {
    const matches=await locateHexoArticles(io,repository,pubId,strict);
    const entry=matches.entries().next().value;
    if(!entry)throw new Error("未找到对应 pub_id 的 Hexo 发布稿");
    return {path:entry[0],raw:entry[1]};
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
        const latest = await find(true);
        if (latest.path !== target.path || latest.raw !== target.raw) throw new Error("Hexo 稿件或匹配关系已变化，请重新预览关联");
      });
    }
  };
}

/** Read-only UI state; missing targets are normal until a blog draft is created. */
export async function readAssociationStatus(io:HexoLocatorIO,repository:string,pubId:string,value:Association):Promise<string> {
  if(!repository)return value.publishedUrl?"目标不存在：请配置 Hexo 仓库":"尚未关联：未配置 Hexo 仓库";
  try {
    if(value.publishedUrl)validateWechatArticleUrl(value.publishedUrl);
    const matches=await locateHexoArticles(io,repository,pubId);
    const entry=matches.entries().next().value;
    if(!entry)return value.publishedUrl?"目标不存在：请生成对应 Hexo 稿件":"尚未关联：尚无 Hexo 稿件";
    const current=associationFields(parseFrontMatter(entry[1],true).data);
    if(!current.publishedUrl&&!value.publishedUrl)return "未关联";
    if(current.publishedUrl===value.publishedUrl&&current.commentsEnabled===value.commentsEnabled)return "已关联";
    return "关联待同步";
  } catch(error){return `关联冲突：${(error as Error).message}`;}
}
