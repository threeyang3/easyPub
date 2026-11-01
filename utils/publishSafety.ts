import { randomBytes } from "crypto";
import { FrontMatterData } from "../types";

export function assertPublishUnchanged(expected: string | null, current: string | null): void {
  if (expected !== current) {
    throw new Error("发布稿已被修改、移动或删除，请重新发布并确认新的差异");
  }
}

export function completeControlRoomMetadata(data: FrontMatterData, title: string, used: Set<string>): FrontMatterData {
  if (Object.prototype.hasOwnProperty.call(data, "password")) {
    throw new Error("此博客禁止明文 password，请改用 password_secret");
  }
  if (data.password_secret !== undefined && !/^BLOG_ENCRYPTION_[A-Z0-9_]+$/.test(String(data.password_secret))) {
    throw new Error("password_secret 必须是 BLOG_ENCRYPTION_ 开头的密钥引用，仅包含大写字母、数字或下划线；请在博客后台配置实际密码");
  }
  const result: FrontMatterData = { ...data, title: data.title || title };
  if (result.categories === undefined || result.categories === "") result.categories = [];
  if (result.tags === undefined || result.tags === "") result.tags = [];
  if (typeof result.title !== "string" || !result.title.trim() || result.title.length > 200) {
    throw new Error("博客标题不能为空且不能超过 200 字");
  }
  if (result.description != null && (typeof result.description !== "string" || result.description.length > 500)) {
    throw new Error("博客摘要必须为文本且不能超过 500 字");
  }
  for (const key of ["tags", "categories"] as const) {
    const value = result[key];
    const values = Array.isArray(value) ? value : [value];
    const entries = key === "categories" ? values.flat() : values;
    if (entries.some(item => typeof item !== "string" || item.length > 60 || /[\r\n]/.test(item))) {
      throw new Error("博客分类或标签须为文本，每项最多 60 字且不能包含换行");
    }
    if (key === "tags" && entries.some(item => /[,，]/.test(String(item)))) {
      throw new Error("博客标签请逐项填写，不要在单个标签中使用逗号");
    }
  }
  if (!result.abbrlink) {
    if (used.size >= 65536) throw new Error("文章短链接空间已用完");
    let id: string;
    do { id = randomBytes(2).toString("hex"); } while (used.has(id));
    result.abbrlink = id;
  } else if (used.has(String(result.abbrlink))) {
    throw new Error("文章 abbrlink 与其他文章重复，请修改后再发布");
  }
  return result;
}
