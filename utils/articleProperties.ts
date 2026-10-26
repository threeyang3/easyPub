import type { FrontMatterData } from "../types";

export interface PropertyField {
  key: string;
  label: string;
  kind?: "list" | "date" | "image" | "choice";
  choices?: string[];
}

export const SOURCE_FIELDS: PropertyField[] = [
  { key: "title", label: "标题" }, { key: "author", label: "作者" },
  { key: "description", label: "摘要" }, { key: "tags", label: "标签", kind: "list" },
  { key: "categories", label: "分类", kind: "list" },
  { key: "cover", label: "封面附件路径或网址", kind: "image" },
  { key: "date", label: "原稿创作日期（可选）", kind: "date" },
];

const select = (...keys: string[]) => SOURCE_FIELDS.filter(field => keys.includes(field.key));
export function platformPropertyFields(platform: string): PropertyField[] {
  switch (platform) {
    case "hexo": return [...select("title", "author", "description", "tags", "categories", "cover"),
      { key: "layout", label: "布局" }, { key: "top_img", label: "顶部图片（空值沿用主题）", kind: "image" },
      { key: "abbrlink", label: "博客短链接（可选）" },
      { key: "password_secret", label: "密码密钥引用（可选）" }];
    case "zhihu": return [...select("title", "description", "tags", "cover"),
      { key: "zhihu_type", label: "知乎类型", kind: "choice", choices: ["文章", "想法"] }];
    case "xiaohongshu": return select("title", "description", "tags", "cover");
    case "wechat": return [{ key: "title", label: "公众号标题" },
      { key: "wechat.author", label: "公众号作者" }, { key: "wechat.digest", label: "公众号摘要" },
      { key: "wechat.sourceUrl", label: "阅读原文链接（可选）" },
      { key: "wechat.cover", label: "封面附件路径或网址" }];
    default: throw new Error(`不支持的平台：${platform}`);
  }
}

export function propertyValue(data: FrontMatterData, key: string): unknown {
  const [parent, child] = key.split(".");
  return child ? asObject(data[parent])[child] : data[parent];
}

export function asObject(value: unknown): FrontMatterData {
  return value && typeof value === "object" && !Array.isArray(value) ? value as FrontMatterData : {};
}

export function setPropertyValue(data: FrontMatterData, key: string, value: unknown): void {
  const [parent, child] = key.split(".");
  if (child) data[parent] = { ...asObject(data[parent]), [child]: value };
  else data[parent] = value;
}

/** Source notebook metadata never implicitly crosses a platform boundary. */
export function initialPlatformProperties(platform: string, source: FrontMatterData, title: string,
  defaultAuthor = ""): FrontMatterData {
  const result: FrontMatterData = {};
  const inherited = platform === "hexo" ? ["title", "author", "description", "tags", "categories", "cover"]
    : platform === "wechat" ? ["title"] : ["title", "description", "tags", "cover"];
  for (const key of inherited) if (source[key] !== undefined) result[key] = structuredClone(source[key]);
  result.title = result.title || title;
  if (platform === "hexo") Object.assign(result, { layout: "post", top_img: "", cover: result.cover ?? "",
    tags: result.tags ?? [], categories: result.categories ?? [] });
  if (platform === "zhihu") result.zhihu_type = "文章";
  if (platform === "wechat") result.wechat = {
    author: typeof source.author === "string" ? source.author : defaultAuthor,
    ...(typeof source.description === "string" ? { digest: source.description } : {}),
    ...(typeof source.cover === "string" && source.cover ? { cover: source.cover } : {}),
  };
  return result;
}

export function legacyPropertyKeys(platform: string, data: FrontMatterData): string[] {
  const allowed = new Set(platformPropertyFields(platform).map(field => field.key.split(".")[0]));
  for (const key of ["pub_id", "source_file", "date", "updated"]) allowed.add(key);
  if (platform === "hexo") for (const key of ["publish_url", "workflow"]) allowed.add(key);
  return Object.keys(data).filter(key => !allowed.has(key));
}

export interface PropertySelection { values: FrontMatterData; remove: string[] }

export function applyPropertySelection(data: FrontMatterData, selection: PropertySelection): FrontMatterData {
  const result = structuredClone(data);
  for (const key of selection.remove) delete result[key];
  for (const [key, value] of Object.entries(selection.values)) {
    if ((key === "password_secret" || key === "abbrlink") && value === "") delete result[key];
    else setPropertyValue(result, key, value);
  }
  // A new cover needs a new crop. A cancelled dialog never reaches this helper.
  if ("wechat.cover" in selection.values
    && selection.values["wechat.cover"] !== propertyValue(data, "wechat.cover")) {
    const wechat = asObject(result.wechat);
    delete wechat.cropWide; delete wechat.cropSquare;
  }
  return result;
}

/** Migrate the old duplicate title without losing the actual displayed title. */
export function canonicalWechatTitle(data: FrontMatterData): FrontMatterData {
  const result = structuredClone(data), wechat = { ...asObject(result.wechat) };
  if (typeof wechat.title === "string") result.title = wechat.title;
  delete wechat.title;
  result.wechat = wechat;
  return result;
}
