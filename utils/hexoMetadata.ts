import { fromMarkdown } from "mdast-util-from-markdown";
import { FrontMatterData } from "../types";

// Empty visual fields deliberately inherit Butterfly's current theme defaults.
// Never freeze global defaults into each article or select an arbitrary body image.
export async function prepareHexoMetadata(
  data: FrontMatterData,
  title: string,
  prepareAttachment: (markdown: string) => Promise<string>
): Promise<FrontMatterData> {
  const result = { ...data };
  if (result.title === undefined || result.title === "") result.title = title;
  if (result.layout === undefined) result.layout = "post";
  for (const key of ["cover", "top_img"] as const) {
    const value = result[key];
    if (value === undefined || value === null) { result[key] = ""; continue; }
    if (value === false || value === "") continue;
    if (typeof value !== "string") throw new Error(`${key} 必须是图片路径、网址、空字符串或 false`);
    const reference = value.trim();
    if (!reference) { result[key] = ""; continue; }
    if (/^https?:\/\//i.test(reference)) {
      const url = new URL(reference);
      if (url.username || url.password) throw new Error(`${key} 图片网址不能包含凭据`);
      continue;
    }
    if (/^\/(?!\/)/.test(reference) || key === "top_img" && /^(?:linear|radial)-gradient\(/i.test(reference)) continue;
    if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith("//")) throw new Error(`${key} 不支持此图片地址`);
    const wiki = reference.match(/^!?\[\[([^\]\r\n]+)\]\]$/);
    const link = (wiki ? wiki[1].split("|", 1)[0] : reference).trim();
    if (!link || /[\[\]\r\n#]/.test(link)) throw new Error(`${key} 请填写完整图片附件路径`);
    const rendered = await prepareAttachment(`![[${link}]]`);
    const tree = fromMarkdown(rendered);
    const paragraph = tree.children[0];
    const image = paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;
    if (image?.type !== "image") throw new Error(`${key} 找不到可发布的图片附件：${link}`);
    result[key] = image.url;
  }
  return result;
}
